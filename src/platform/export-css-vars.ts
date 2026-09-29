/**
 * 导出 SVG 的 **Obsidian CSS 变量注入**（K99；值安全校验于 K105 重写为
 * 结构性字符拒绝——Unicode 字体名不再被误杀，见 UNSAFE_CSS_VALUE_CHARS）。
 *
 * 背景：自绘节点内容大量使用文档级 CSS 变量——正文/代码字体
 * `var(--font-interface, sans-serif)` / `var(--font-monospace, monospace)`、
 * 代码背景 `var(--code-background, …)`、链接三态色 `var(--link-color, …)` 等
 * （唯一来源 `features/node-inline-content.ts` 的 CONTENT_STYLES 与 token 样式）。
 *
 * **屏幕上**这些变量由 Obsidian 在宿主元素上定义，渲染正确；**导出时**引擎克隆
 * SVG 后处于独立渲染环境（序列化 → data URL → `<img>` 解码），文档级样式表不在
 * 其中 → 变量未定义 → 回退到内联兜底值（如 `sans-serif`）——兜底字体的度量与
 * 屏上字体不同 → **换行点漂移、行高变化** → 内容超出 foreignObject 的固定高度
 * **被裁切**（用户实测：多行文字节点第二行被切半、LaTeX 节点文字不全）。
 *
 * 修复：导出时把**宿主上实际生效的变量值**取出来，以 `<style>` 注入克隆 SVG 根
 * （CSS 自定义属性沿后代继承，foreignObject 内的 HTML 同样生效），使导出环境的
 * 字体度量与屏上一致（WYSIWYG）。与 `injectMathStylesIntoExportSvg` 同一模式
 * （只改克隆 SVG，不触碰屏上视图与导出源 DOM）。
 *
 * 接线：组合根 `exportSvgTransforms`（组合根传入 `handleBeingExportSvg`）。
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
	const root = (svgElement as { node?: Element } | null)?.node;
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
	// 按属主文档创建 SVG style（popout 兼容；obsidian 的 Document 扩展
	// `win.createSvg` 与 lint 规则 prefer-create-el 同口径——同
	// injectMathStylesIntoExportSvg）
	const win = (
		root.ownerDocument as unknown as
			| { win?: { createSvg?: (tag: 'style') => SVGStyleElement } }
			| undefined
	)?.win;
	const styleEl = win?.createSvg?.('style');
	if (!styleEl) {
		return svgElement;
	}
	// 选择器 `svg` 匹配克隆 SVG 的根元素：自定义属性沿后代继承，
	// foreignObject 内的 HTML 同样生效
	styleEl.textContent = `svg { ${decls.join('; ')}; }`;
	root.appendChild(styleEl);
	return svgElement;
}
