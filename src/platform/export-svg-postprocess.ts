/**
 * 导出 SVG 后处理链的 **platform 侧收口**（2026-10-17 合并，原三文件：
 * `export-svg-style.ts` / `export-css-vars.ts` / `export-foreign-object-padding.ts`）。
 *
 * ## 为什么合并
 * 三者是链上**必须按序**的前两步及其共用 `<style>` 注入原语：几何先落地、
 * CSS 变量随后注入。该顺序此前只存在于 `features/view.ts` 的数组字面量里，
 * 合并后由 `postProcessExportSvg` 一处保证。
 *
 * ## 为什么不是「全链一个函数」
 * 链尾两处无法并入：`hideCopyButtonsInExportSvg` 在 `features`（K51 禁止
 * platform 依赖 features）；数学后处理虽同层，但反向引用本文件的
 * `appendSvgStyle`，再引它即成环——整链仍由组合根装配。
 *
 * ## 共同口径
 * 两个后处理都只改克隆 SVG、形态不符时原样返回（引擎要求）；`appendSvgStyle`
 * 是二者共用的注入原语，返回 boolean。
 */

// ---------------------------------------------------------------------------
// 共用：克隆 SVG 根收窄 + `<style>` 注入原语
// ---------------------------------------------------------------------------

/**
 * 导出 SVG 后处理链共用的 `<style>` 注入原语。
 *
 * `injectObsidianCssVarsIntoExportSvg`（本文件）与
 * `injectMathStylesIntoExportSvg`（math-jax-export.ts）此前各自内联了一份
 * 「按属主文档 `win.createSvg('style')` → 赋 `textContent` → 追加到克隆
 * SVG 根」的同款机制（AGENTS.md 硬规则 5 的「第二份机制」），收口到本函数。
 *
 * 只改动克隆 SVG，不触碰屏上视图与导出源 DOM；宿主不可用 / 无法创建
 * style 元素时安全 no-op，返回 false（调用方据此原样返回传入的 svg 对象）。
 *
 * @param root    克隆 SVG 的根元素（`svg.js` 对象的 `.node`），需具备
 *                `appendChild`（已在调用方校验存在）
 * @param cssText 注入的 CSS 文本（调用方已完成取值/清洗/选择器组装）
 * @returns 是否成功追加（false ＝ 安全 no-op，调用方应原样返回传入 svg 对象）
 */
export function appendSvgStyle(root: Element, cssText: string): boolean {
	const win = (
		root.ownerDocument as unknown as
			| { win?: { createSvg?: (tag: 'style') => SVGStyleElement } }
			| undefined
	)?.win;
	const styleEl = win?.createSvg?.('style');
	if (!styleEl) {
		return false;
	}
	styleEl.textContent = cssText;
	root.appendChild(styleEl);
	return true;
}

/**
 * 取 svg.js 元素对象背后的 DOM 根（形态窄化）：两个后处理共用，避免各写一份
 * `(svg as { node?: Element }).node` 而在异常宿主上分叉（一处 no-op、一处抛错）。
 */
function svgRootOf(svgElement: unknown): Element | null {
	const root = (svgElement as { node?: Element } | null | undefined)?.node;
	return root ?? null;
}

// ---------------------------------------------------------------------------
// 一、Obsidian CSS 变量注入（K99 / K105）
// ---------------------------------------------------------------------------

/**
 * 导出 SVG 的 **Obsidian CSS 变量注入**（K99；值安全校验于 K105 重写为
 * 结构性字符拒绝——Unicode 字体名不再被误杀，见 UNSAFE_CSS_VALUE_CHARS）。
 *
 * 背景：自绘节点内容大量使用文档级 CSS 变量——正文/代码字体
 * `var(--font-interface, sans-serif)` / `var(--font-monospace, monospace)`、
 * 代码背景 `var(--code-background, …)`、链接三态色 `var(--link-color, …)`、
 * 勾色 `var(--text-on-accent, …)` 等（来源 `features/node-inline-html` 的样式表）。
 *
 * **屏幕上**这些变量由 Obsidian 在宿主元素上定义，渲染正确；**导出时**引擎克隆
 * SVG 后处于独立渲染环境（序列化 → data URL → `<img>` 解码），文档级样式表不在
 * 其中 → 变量未定义 → 回退到内联兜底值（如 `sans-serif`）——兜底字体的度量与
 * 屏上字体不同 → **换行点漂移、行高变化** → 内容超出 foreignObject 的固定高度
 * **被裁切**（用户实测：多行文字节点第二行被切半、LaTeX 节点文字不全）。
 *
 * 修复：导出时把**宿主上实际生效的变量值**取出来，以 `<style>` 注入克隆 SVG 根
 * （自定义属性沿后代继承，foreignObject 内的 HTML 同样生效）⇒ 导出环境的字体度量
 * 与屏上一致（WYSIWYG）。与 `injectMathStylesIntoExportSvg` 同模式：只改克隆。
 *
 * 接线：由 `postProcessExportSvg` 在几何余量之后调用（组合根
 * `exportSvgTransforms` 链首）。
 */

/** 自绘内容实际消费的 Obsidian 变量（保守白名单：只注入确实被用到的） */
const CSS_VARS_TO_EXPORT: readonly string[] = [
	'--font-interface',
	'--font-text',
	'--font-text-size',
	'--font-monospace',
	'--code-background',
	'--code-normal',
	'--link-color',
	'--link-external-color',
	'--link-unresolved-color',
	'--link-unresolved-opacity',
	'--text-accent',
	'--text-on-accent',
	'--text-normal',
	'--text-muted',
	'--text-highlight-bg',
	'--icon-color',
];

/**
 * 变量值安全校验（K99 加固 → K105 重写，2026-09-29 实机诊断修订）。
 *
 * 背景：变量值来自**宿主主题**（用户可安装第三方主题与 CSS 片段，内容不受控），
 * 若原样拼进 `svg { … }` 规则块，形如 `Arial} svg{opacity:0` 的值会**闭合
 * 规则块并注入任意 CSS 规则** → 导出图被篡改（内容隐藏/错位等）。
 * `textContent` 不会被解析为 HTML，故**无脚本执行面**；但样式注入成立，
 * 因此注入前过滤——不安全的值**跳过该变量**（导出回退内联兜底值，功能仍可用）。
 *
 * **K105 修订原因**：K99 原实现为正向字符白名单 `/^[\w\s#'"(),.:/%!-]+$/`，
 * 而 `\w` 只匹配 ASCII——中文环境的字体栈含非 ASCII 字体名时（2026-09-29
 * 实机证据：`--font-interface` = `"HarmonyOS Sans", "HarmonyOS Sans SC",
 * '??', …`，`'??'` 为非 ASCII 字符在控制台的降级显示）**三个字体变量被全部
 * 静默跳过** → 导出图字体回退 `sans-serif`、换行点漂移、多行节点被
 * foreignObject 裁切（与 K99 修复前同症状）。字符枚举白名单对「合法但非
 * ASCII」的值天然漏杀，故改为**拒绝结构性字符**（CSS 注入的唯一载体）：
 * - `{` `}` 闭合/开启规则块；`;` 提前结束声明；
 * - `\` 转义构造（`\7d` 可生成 `}`，绕过前述过滤）；
 * - `<` `>` `&` 标记构造（XML 序列化环境纵深防御）；
 * - `@` at-规则（`@import` 等）；
 * - 控制字符（含换行/制表——值上下文不可能合法含它们）。
 * 拒绝以上字符后，值无法提前闭合声明/规则块、无法开新规则、无法转义重构
 * ⇒ 注入面封闭；其余（中文 / PUA / emoji / 任意 Unicode）全部放行。
 */
const UNSAFE_CSS_VALUE_CHARS = /[{};\\<>&@]/;

/**
 * 值长度上限（K105 防御纵深）：真实字体栈远小于此（数千字符即异常值）；
 * 超长值既无合法用途、又会放大导出样式表体积，直接跳过。
 */
const MAX_CSS_VALUE_LENGTH = 1000;

/**
 * 值是否可安全注入：无结构性字符、无控制字符且不超长。
 *
 * 控制字符（码点 `< 0x20` 与 `0x7F`，含换行/制表）不用正则表达：字符类里的
 * 控制字符范围会触发 `no-control-regex`（该规则意图拦截编码事故，此处是
 * **有意过滤**）——项目不引入 eslint-disable，故以码点判断落实现。
 */
function isSafeCssValue(value: string): boolean {
	if (value.length > MAX_CSS_VALUE_LENGTH) {
		return false;
	}
	if (UNSAFE_CSS_VALUE_CHARS.test(value)) {
		return false;
	}
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) {
			return false;
		}
	}
	return true;
}

/**
 * 把宿主上实际生效的 CSS 变量注入克隆 SVG。
 *
 * @returns 原样返回传入的 svg.js 元素对象（引擎要求）；宿主环境不可用、
 *   变量全部为空或对象形态不符时**原样返回、不做任何修改**（安全 no-op）。
 */
export function injectObsidianCssVarsIntoExportSvg(svgElement: unknown): unknown {
	if (
		typeof document === 'undefined' ||
		typeof getComputedStyle !== 'function'
	) {
		return svgElement; // 单测桩/异常宿主：安全 no-op
	}
	const root = svgRootOf(svgElement);
	if (!root || typeof root.appendChild !== 'function') {
		return svgElement;
	}
	const style = getComputedStyle(document.body);
	const decls = CSS_VARS_TO_EXPORT.map((name) => {
		const value = style.getPropertyValue(name).trim();
		// 空值跳过；含结构性字符/超长（可能闭合规则块注入样式）同跳过——见 isSafeCssValue
		if (!value || !isSafeCssValue(value)) {
			return null;
		}
		return `${name}: ${value}`;
	}).filter((line): line is string => line !== null);
	if (decls.length === 0) {
		return svgElement;
	}
	// 选择器 `svg` 匹配克隆 SVG 的根元素：自定义属性沿后代继承，
	// foreignObject 内的 HTML 同样生效。注入机制收口在本文件的 appendSvgStyle
	appendSvgStyle(root, `svg { ${decls.join('; ')}; }`);
	return svgElement;
}

/**
 * 导出 SVG 的 **foreignObject 几何余量**（K106）。
 *
 * 背景：`<img>` 解码的 SVG 独立文档与主文档对**同一内容、同一 CSS 变量、
 * 同一字体**的文本度量存在约 2px 级偏差（2026-09-29 CLI 实机定位，K105
 * 之后的残余边界）——对照实验：同内容在主文档真实 foreignObject 里渲染
 * 1 行（高 26），在 `<img>` 解码路径里换行为 2 行，第二行超出 foreignObject
 * 的固定高度被裁（用户实拍导出图）。根因**不在变量注入**（K105 已实证注入
 * 生效）也**不在字体缺失**（`'??'` 是空壳 @font-face、屏上实际命中系统
 * 字体 Cascadia Mono）——变量注入无法消除该环境级渲染差异，故在导出侧
 * 加几何余量兜底（方案经实机扫描验证：FO 宽 +2px 即恢复单行；2026-09-29
 * 二次实机发现偏差随内容而异——标点/特殊字符密集的长文本行可达 ~12px，
 * 表现为"末字符贴右线"，故余量按分布上界取 {@link PAD_WIDTH}）。
 *
 * 口径：
 * - **宽度 + {@link PAD_WIDTH}**：覆盖实测最大 ~12px 宽度偏差，
 *   把"临界换行"节点救回单行、为长文本行留出视觉右 padding；
 * - **高度 + {@link PAD_HEIGHT}**：兜底——万一某节点仍换行，第二行
 *   **完整可见**而非被裁（保"内容不丢"底线）。
 *
 * 取舍（2026-09-29 实测与推演）：
 * - 加宽后内容右端最大 ≈ 左 padding + 新可用宽 < 节点形状右缘
 *   （形状总宽 = 原 FO 宽，余量在形状内部消耗）→ **不溢出节点形状**；
 * - 不换行时**零视觉差异**（内容够不到新增余量）；
 * - 屏上恰好临界换行的极少数节点，导出可能少一行（罕见，且优于缺字）；
 *   极端节点导出"多一行但完整"（优于"缺半行"）。
 */

/**
 * 宽度余量（px）：覆盖实测导出环境文本度量偏差（2026-09-29 实机分布：
 * 轻量节点 ~2px、标点/特殊字符密集的长文本行可达 ~12px——"）"贴右线即其形态）。
 * 安全性：内容右端 ≤ 左 padding + (原可用宽 + 12) < 形状右缘（余量在形状内部
 * 消耗），任何已知节点至少保留 ~4px 视觉右 padding，不溢出形状。
 */
const PAD_WIDTH = 12;

/**
 * 高度余量（px）：≈1 行自绘行高（13px × 1.2 = 15.6，取整留裕）——
 * 仅作"换行也不裁"的兜底，不参与横向布局。
 */
const PAD_HEIGHT = 20;

// ---------------------------------------------------------------------------
// 二、foreignObject 几何余量（K106）
// ---------------------------------------------------------------------------

/**
 * 给克隆 SVG 的每个 foreignObject 增加几何余量。
 *
 * @returns 原样返回传入的 svg.js 元素对象（引擎要求）；对象形态不符、
 *   无 foreignObject 或尺寸属性非法时**原样返回/跳过，不做修改**（安全 no-op）。
 */
export function padForeignObjectsForExport(svgElement: unknown): unknown {
	const root = svgRootOf(svgElement);
	if (!root) {
		return svgElement;
	}
	// 直接调用 + 异常兜底（形态不符 → TypeError → 原样返回）。勿改回
	// `typeof root.querySelectorAll !== 'function'` 这类**方法引用**形态：
	// 它会命中 DOM lib 的 deprecated 重载签名（HTMLElementDeprecatedTagNameMap），
	// 触发 no-deprecated 告警；try/catch 写法与 platform/math-jax /
	// features/node-codeblock 的查询形态同款（lib 无 DOM.Iterable，须 Array.from）。
	let foreignObjects: Element[];
	try {
		foreignObjects = Array.from(root.querySelectorAll('foreignObject'));
	} catch {
		return svgElement;
	}
	for (const fo of foreignObjects) {
		const width = Number.parseFloat(fo.getAttribute('width') ?? '');
		const height = Number.parseFloat(fo.getAttribute('height') ?? '');
		if (!Number.isFinite(width) || !Number.isFinite(height)) {
			continue; // 非法尺寸：跳过该 FO（保持原状）
		}
		// 只改尺寸、不动 x/y：可用文本区向右/下扩展，与形状左缘保持对齐
		fo.setAttribute('width', String(width + PAD_WIDTH));
		fo.setAttribute('height', String(height + PAD_HEIGHT));
	}
	return svgElement;
}

// ---------------------------------------------------------------------------
// 三、platform 侧单入口
// ---------------------------------------------------------------------------

/**
 * platform 侧的导出后处理**单入口**：几何余量 → CSS 变量注入，顺序由此保证。
 *
 * 两步都是「原样返回传入对象」的安全 no-op 语义，故可无条件串接；任一步 skips
 * （无 foreignObject / 宿主不可用）不影响另一步。整链剩余项（数学样式、容器高度
 * 钉扎、复制按钮隐身）由组合根 `exportSvgTransforms` 在本函数之后追加。
 *
 * @returns 原样返回传入的 svg.js 元素对象（引擎要求）
 */
export function postProcessExportSvg(svgElement: unknown): unknown {
	// 管道式串联：后一步吃前一步的返回值，避免把「原样返回同一对象」当成隐式契约。
	return injectObsidianCssVarsIntoExportSvg(
		padForeignObjectsForExport(svgElement),
	);
}
