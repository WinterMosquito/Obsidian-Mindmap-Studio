/**
 * 行内数学渲染（官方 `loadMathJax()` 通道，生产实现的唯一落点）。
 *
 * 职责：把 `node-inline-content` 生成的**字面占位**（行内 `$…$` / 单行块级
 * `$$…$$`，见 `buildMathElement`）异步替换为 MathJax 产物。设计约束：
 * - **注入式**：`node-inline-content` 保持零 Obsidian 依赖（无运行时可打包/
 *   可单测），本模块是唯一 import `obsidian` 的数学渲染实现；
 * - **占位即回退**：MathJax 未就绪、渲染方法缺失、渲染抛错、holder 始终未挂载
 *   （导出快照/离屏克隆）四种情形都**不替换**——字面显示与「未闭合标记按字面」
 *   同一条安全口径；其中「渲染方法缺失」会**显式告警一次**（见
 *   warnRenderApiMissing），不再全静默；
 * - **挂载后补替换**：holder 未连接时产物入队、随后帧重试（见 pumpPending）。
 *   引擎「首帧前预测量 + 元素复用」（vendor BUILD.md 补丁 5 / A2）会在**尚未
 *   挂载**的状态下走本函数的构建链；若替换只尝试一次就放弃，这类节点会永久
 *   停在字面占位（实机复验：MathJax 热加载时"关闭再打开文件"必现，
 *   冷加载时因 await 期间元素已挂载而侥幸成功——两条路径都要正确）。
 * - **样式就绪：flush 驱动 + 精确就绪判据**（三段实测 + S0.5 双环境定稿）：
 *   ① CHTML 的逐字符规则（`mjx-c.…::before { content; padding }`）只在样式表
 *   **flush**（官方 `finishRenderMath()`）时写入——未 flush 的产物「**非零但塌缩**」
 *   （实测：`mjx-c` 宽度全为 0；`14×20` vs flush 后 `130×20`；高度 114 vs 171）。
 *   「容器宽高 > 0」无法识别这种形态，会把错误尺寸送进产物缓存与节点重排
 *   （＝「块级公式只给一行高度」一类实机症状的根因）。本模块渲染后按批合并
 *   调度 flush（单次实测 ≈1s：本机 1006ms / 隔离实例 981–1046ms——绝不逐段等待），
 *   完成后重试全部待定段。
 *   ② **就绪判据**：产物内**全部 `mjx-c` 宽度 > 0**（实测：未 flush 11/11 为 0、
 *   flush 后 0/11 为 0）；无 `mjx-c` 的产物形态退回「宽高皆 > 0」保守判定。
 *   例外（实测补）：零宽但 `::before` content 为**空串**的字符是
 *   MathJax 的不可见操作符（U+2061 函数应用等，设计上恒零宽），视为就绪——
 *   否则含 `\sin/\cos/\log…` 的公式永不就绪、重试耗尽退字面（用户实机复现）。
 *   未就绪的产物**在同一同步块内撤回为字面**——浏览器不绘制中间态，不存在
 *   「先空白、后出现」的窗口；产物只在就绪后才**入缓存并通知定稿**（P4 重排）。
 *   ③ **字体**：产物用**私有区码点**（U+1D438 等）承载字形，只有 MathJax 自带
 *   字体有对应字形，系统回退字体渲染不出来（用户控制台可见 Chromium 的
 *   「Slow network … Fallback font will be used」干预，src 为本地
 *   `app://obsidian.md/lib/mathjax/...woff`）——渲染前 `await ensureMathFonts()`
 *   （2.5s 上限）。字体是**渐进渲染**：产物 DOM 到位后字体数据到达即自动显形，
 *   故**不设字体就绪重试**（重试只服务于可检测成因：规则未 flush / 未挂载）。
 *   ④ **最终回退**：重试预算耗尽仍未就绪 → 保留字面占位并告警一次——宁可见的
 *   字面，不要看不出原因的空白。
 *   ⚠ **不要**调用 `MathJax.startup.document.updateDocument()` 去"补"样式：实测它
 *   会把用户环境里完整的样式表（15380 字节、含字形规则）重写为 MathJax 内部快照
 *   （6858 字节、无字形规则），反而抹掉字形（因此回滚过一次部署）。
 *   官方 `finishRenderMath()` 已在本机与隔离实例双环境实测**只增不减**（S0.5）。
 * - 已知边界：导出 PNG/SVG 走离屏克隆时序；克隆时尚未就绪的段在导出图中显示为
 *   字面 `$…$`（屏上视图不受影响；已就绪段由导出样式注入保证可见）。
 *
 * **MathJax 面（实机取证修正）**：Obsidian 1.13.7 经 `loadMathJax()`
 * 注入的 MathJax 3.2.2 是 **CHTML 组件**，只暴露 `tex2chtml` / `tex2chtmlPromise`，
 * **没有 `tex2svg`**——而旧实现唯一调用的正是 `tex2svg`（实机恒为 undefined）：
 * 替换永不发生、数学永久停在字面占位，且被「占位即回退」静默吞掉（单测注入
 * 假 MathJax 未覆盖该 API 面，视觉闸门也不含真 MathJax）。故渲染优先级改为：
 * `tex2chtml`（阅读视图同款 CHTML 通道）→ `tex2svg`（兼容回退）。
 *
 * 产物形态提示：`<mjx-container class="MathJax" jax="CHTML">`——定位要按**标签
 * 名** `mjx-container`（class 是 `MathJax`，`.mjx-container` 类选择器匹配不到）。
 */
import { finishRenderMath, loadMathJax } from 'obsidian';
import { MATH_RENDERED_HOLDER_CLASS } from '../core/constants';

/**
 * 本模块实际消费的 MathJax 面（窄化，避免 any）。
 *
 * ⚠ 样式**不再**经 `startup.document.updateDocument()` 处理（历史事故：会把用户
 * 环境完整样式表重写为内部快照并抹掉字形，见文件头 ⚠）——flush 统一走官方
 * `finishRenderMath()`（顶层 import，双环境实测只增不减）。
 */
interface MathJaxLike {
	/**
	 * CHTML 输出（**Obsidian 实机通道**，与阅读视图产物同源：
	 * `<mjx-container class="MathJax" jax="CHTML">`）。
	 */
	tex2chtml?: (tex: string, options?: { display?: boolean }) => Node | null;
	/** SVG 输出（兼容回退：其他注入形态/旧版可能提供；1.13.7 实机无此方法） */
	tex2svg?: (tex: string, options?: { display?: boolean }) => Node | null;
}

/** 行内数学的显示类名（主题/调试定位用；样式交宿主全局 `.mjx-container` 规则） */
/** 值收口在 core/constants：与 node-inline-content 的缓存命中路径共用 */
const MATH_CONTAINER_CLASS = MATH_RENDERED_HOLDER_CLASS;

/**
 * 产物模板缓存：`I:`/`B:` + TeX → 已渲染产物节点（复用时 `cloneNode`）。
 *
 * 用途（P4 尺寸同步）：引擎的离屏测量是**同步**的，而 MathJax 替换
 * 是**异步**的——首次渲染必然「按字面占位测量」。替换定稿后由视图层触发该节点
 * 重建，重建时本缓存已命中 ⇒ **同步**放入产物 ⇒ 引擎量到**真实宽高**；且因
 * 不再触发异步替换，重建不会再回调重排（无循环，见 refreshNodesCustomContent）。
 */
const renderedMathCache = new Map<string, Node>();

/** 缓存上限（简单 FIFO 淘汰）：数学段规模远小于此，超限只影响复用率 */
const RENDERED_CACHE_MAX = 200;

function mathCacheKey(tex: string, display: boolean): string {
	return (display ? 'B:' : 'I:') + tex;
}

/**
 * 取**已渲染产物**的克隆：同 TeX 渲染过一次即命中；未命中返回 null
 * （调用方回落到「字面占位 + 异步替换」路径）。
 *
 * 注入面：`features/node-inline-content` 经 `InlineContentOptions.getCachedMath`
 * 消费（该模块不 import 本层，保持无 Obsidian 依赖）。
 */
export function getRenderedMathNode(tex: string, display: boolean): Node | null {
	const template = renderedMathCache.get(mathCacheKey(tex, display));
	return template ? template.cloneNode(true) : null;
}

/** 记入模板缓存（**仅在可见性自检通过后**调用：不可见的产物不值得复用） */
function rememberRenderedMath(
	tex: string,
	display: boolean,
	rendered: Node,
): void {
	const key = mathCacheKey(tex, display);
	if (renderedMathCache.has(key)) {
		return;
	}
	if (renderedMathCache.size >= RENDERED_CACHE_MAX) {
		const oldest = renderedMathCache.keys().next().value;
		if (oldest !== undefined) {
			renderedMathCache.delete(oldest);
		}
	}
	renderedMathCache.set(key, rendered);
}

/**
 * 「定稿」回调登记（WeakMap）：holder → 通知函数（**回调收到 holder**）。
 *
 * 定稿 = 该数学段**已就绪并替换为产物**（见 attemptPlace / isProductReady），
 * 视图层据此触发节点尺寸同步（`refreshNodesCustomContent`）。用 WeakMap 而非
 * 逐层传参：替换贯穿「渲染即就绪（attemptPlace）/ 待定重试（pumpPending）」
 * 两条路径，逐层加参数会污染多处签名，而 WeakMap 在两条路径上**同点通知**。
 *
 * ⚠ 回调参数是 **holder** 而非构建期的 node 对象（K88）：节点内容可能由
 * 引擎预测量路径用轻量代理构建，A2 元素复用会让该内容直接进入真实节点——
 * 闭包里的 node 是代理（无 `reRender`），据此重排会静默失败。视图层应经
 * holder 反查真实节点（`findNodeByDom`）。
 */
const settleCallbacks = new WeakMap<
	HTMLElement,
	(holder: HTMLElement) => void
>();

/** 通知该 holder 的观察者（一次性：取后即删，避免重建后被重复通知） */
function notifyMathSettled(holder: HTMLElement): void {
	const callback = settleCallbacks.get(holder);
	if (!callback) {
		return;
	}
	settleCallbacks.delete(holder);
	callback(holder);
}

/** 「渲染方法缺失」告警去重：同一会话只提醒一次（按节点逐条会刷屏） */
let renderApiMissingWarned = false;

/**
 * MathJax 已就绪但没有任何可用渲染方法：显式告警一次。
 *
 * 教训：此前该情形静默保留字面占位，实机 API 假设错误因此长期
 * 不可见（单测与视觉闸门都触不到真 MathJax）。告警让这类失效**可被发现**。
 */
function warnRenderApiMissing(): void {
	if (renderApiMissingWarned) {
		return;
	}
	renderApiMissingWarned = true;
	console.warn(
		'MindMap Studio：行内数学渲染不可用——MathJax 缺少 tex2chtml/tex2svg，保留字面显示',
	);
}

/** MathJax 注入的 CHTML 样式表元素 id（字形与 @font-face 的载体） */
const CHTML_STYLES_ID = 'MJX-CHTML-styles';

/**
 * 剥离 `@font-face` 声明块（导出注入专用）。
 *
 * 导出 SVG 在**独立上下文**渲染（data URI → `Image` → canvas），
 * `@font-face` 里的 `src: url("app://obsidian.md/lib/mathjax/…woff")` 在该
 * 上下文**无法加载**——保留只会产生失败请求；字形改由系统 fallback 提供
 * （位置/尺寸由 per-char 规则的 em `padding` 保证，公式结构仍然正确）。
 */
/**
 * 读取当前 MathJax CHTML 样式表的**完整 CSS**。
 *
 * ⚠ `textContent` 与 CSSOM 是**两套视图**：MathJax 的逐字符字形规则
 * （`mjx-c.mjx-c1D438.TEX-I::before { content: "E"; … }`）是渲染时经
 * `sheet.insertRule()` **动态插入**的，**不出现在 `textContent` 里**——
 * 实测：仅按 textContent 注入导出 SVG 时，基础/间距段与
 * `@font-face` 都在、`::before` 规则**全丢**（导出图里数学仍不可见）。
 * 必须从 `sheet.cssRules` 序列化（`rule.cssText`）才能拿到全部规则。
 *
 * `sheet` 不可用（极端宿主）时退回 `textContent`（至少基础段可用）。
 */
function readMathJaxCss(): string {
	const el =
		typeof document === 'undefined'
			? null
			: (document.getElementById(CHTML_STYLES_ID) as HTMLStyleElement | null);
	if (!el) {
		return '';
	}
	const sheet = el.sheet;
	if (!sheet) {
		return el.textContent ?? '';
	}
	const parts: string[] = [];
	for (const rule of Array.from(sheet.cssRules)) {
		parts.push(rule.cssText);
	}
	return parts.join('\n');
}

/**
 * 剥离 `@font-face` 声明块（导出注入专用）。
 *
 * 导出 SVG 在**独立上下文**渲染（data URI → `Image` → canvas），
 * `@font-face` 里的 `src: url("app://obsidian.md/lib/mathjax/…woff")` 在该
 * 上下文**无法加载**——保留只会产生失败请求；字形改由系统 fallback 提供
 * （位置/尺寸由 per-char 规则的 em `padding` 保证，公式结构仍然正确）。
 *
 * ⚠ MathJax 的声明形态是 `@font-face /* 0 *&#47; {`（带序号注释）——大括号前
 * 必须容忍任意字符（`[^{]*`），否则剥离静默失效（实测踩坑）。
 */
export function stripFontFaceRules(css: string): string {
	return css.replace(/@font-face[^{]*\{[^}]*\}/g, '');
}

/**
 * 导出 SVG 后处理（方案 B，用户确认）：把 MathJax CHTML 样式表
 * 注入克隆 SVG，使导出图中数学**可见**（此前为空白）。
 *
 * 背景：CHTML 字形靠 `<style id="MJX-CHTML-styles">` 的逐字符规则
 * （`mjx-c.mjx-c1D438.TEX-I::before { content: "E" }` + em `padding`）承载；
 * 引擎导出只注入自身 CSS（vendor `getSvgData`），文档级样式表不在导出 SVG
 * 里 → `<mjx-c>` 无内容 → 导出图空白（实测：导出 SVG 含完整 `mjx-container`
 * 结构、但 `<style>` 里只有 `.smm-*` 规则）。
 *
 * 接线：`engine/mindmap.ts` 的 `handleBeingExportSvg` 选项（组合根传入
 * 本函数）。**不修改**屏上视图与导出源 DOM——只在克隆 SVG 末尾追加一个
 * `<style>`（SVG 允许 style 子元素；与引擎自带 style 并存）。
 *
 * @returns 原样返回传入的 svg.js 元素对象（引擎要求）；无样式表或对象形态
 *   不符时**原样返回、不做任何修改**（安全 no-op）。
 */
export function injectMathStylesIntoExportSvg(svgElement: unknown): unknown {
	const css = readMathJaxCss();
	if (!css) {
		return svgElement;
	}
	const root = (svgElement as { node?: Element } | null)?.node;
	if (!root || typeof root.appendChild !== 'function') {
		return svgElement;
	}
	// 按属主文档创建 SVG style（popout 兼容；obsidian 的 Document 扩展
	// `win.createSvg` 与 lint 规则 prefer-create-el 同口径）
	const win = (
		root.ownerDocument as unknown as {
			win?: { createSvg?: (tag: 'style') => SVGStyleElement };
		}
	).win;
	const styleEl = win?.createSvg?.('style');
	if (!styleEl) {
		return svgElement;
	}
	styleEl.textContent = stripFontFaceRules(css);
	root.appendChild(styleEl);
	return svgElement;
}

/** MathJax CHTML 产物根：定位按**标签名**（class 是 `MathJax`，类选择器不可靠） */
const MJX_CONTAINER_SELECTOR = 'mjx-container';

/**
 * 收集主文档中可与导出克隆配对的 `mjx-container`（数量必须与克隆一致才返回；
 * 候选限定 `<svg>` 内，见 isInsideSvg）。
 *
 * 精确域优先（`.mindmap-canvas-container` = 本插件画布——多视图/阅读视图里的
 * 数学不会混入计数）；域内数量不符时退回全文计数；仍不符返回空数组（调用方
 * no-op，宁可不修也不错配）。`doc` 取克隆的属主文档（popout 兼容）。
 */
function listLiveMathContainers(doc: Document, expectCount: number): Element[] {
	const scopes = [
		`.mindmap-canvas-container ${MJX_CONTAINER_SELECTOR}`,
		MJX_CONTAINER_SELECTOR,
	];
	for (const scope of scopes) {
		try {
			const list = Array.from(doc.querySelectorAll(scope)).filter(isInsideSvg);
			if (list.length === expectCount) {
				return list;
			}
		} catch {
			// 宿主查询不可用：尝试下一域
		}
	}
	return [];
}

/**
 * 候选必须位于 `<svg>` 内。
 *
 * 引擎的离屏**测量容器**挂在画布容器下（`<svg>` 外）、内含一份内容克隆
 * （带 mjx-container）——实机配对曾因此「实机 8 vs 克隆 7」全链 no-op（导出
 * 字节与修复前完全一致，误导"修复无效"）；只保留 svg 内候选即恢复一一配对。
 */
function isInsideSvg(el: Element): boolean {
	try {
		return el.closest('svg') !== null;
	} catch {
		return false;
	}
}

/**
 * 读取实机 `mjx-container` 的**布局高度**（剔除画布缩放）。
 *
 * 屏上 `getBoundingClientRect` 为缩放后的屏幕像素；用元素自身
 * `rect.width / offsetWidth` 推导画布缩放并回除（`offsetWidth` 不含祖先
 * 变换）。元素自身不可推导（未渲染 / `offsetWidth` 为 0）时退回节点内容块
 * 归一；仍不可得返回 null（调用方跳过该元素，保持自然高度）。
 */
function measureMathContainerLayoutHeight(el: Element): number | null {
	try {
		const rect = el.getBoundingClientRect();
		if (!(rect.width > 0) || !(rect.height > 0)) {
			return null;
		}
		const ownWidth = (el as { offsetWidth?: number }).offsetWidth ?? 0;
		if (ownWidth > 0) {
			return (rect.height * ownWidth) / rect.width;
		}
		const host = el.closest('.mindmap-node-inline-content');
		if (!host) {
			return null;
		}
		const hostRect = host.getBoundingClientRect();
		const hostWidth = (host as { offsetWidth?: number }).offsetWidth ?? 0;
		if (hostWidth > 0 && hostRect.width > 0) {
			return (rect.height * hostWidth) / hostRect.width;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * 导出 SVG 后处理（K107）：把克隆内每个 `mjx-container` 的 height 钉为
 * **主文档对应容器的实测高度**，使导出纵向流与屏上一致。
 *
 * 背景（2026-09-29 实机像素取证）：导出渲染环境（`<img>` 解码的独立文档）
 * 里 MJX 字体不可用，回退字体度量把 `mjx-container` 盒子撑大（实测屏上
 * 31.24px → 导出 ~56.3px，≈1.8 倍）——数学所在行的行盒随之变高，**其下方
 * 文字整体下移 ~8px**，长数学节点末行文字压到节点底边框线（用户实拍：
 * "（无裁切、无空洞）"被底边穿过）。K106 的 FO 余量只解决"被裁切"，不解决
 * 这种"纵向流漂移"；`line-height` / `display` / `vertical-align` 覆盖实测
 * 无效（对照实验 v3/v4/v8），仅"钉高度"命中（v7：文字带 [87.3, 100.3] →
 * [78.3, 91.3]，与屏上重合）。数学字形自身仍可能越过自身盒底 ~5px——
 * 落在数学与文字之间的行间隙内，无碰撞、无视觉影响。
 *
 * 修法：克隆内 `mjx-container` 与主文档同名元素**按文档序一一配对**（克隆
 * 深拷贝保持文档序；实机候选**限定 `<svg>` 内**——引擎离屏测量容器挂在
 * svg 外、其内容克隆的 mjx 不参与，否则计数永不相等、全链 no-op），把实测
 * 高度（屏幕像素 ÷ 画布缩放 = 布局像素）以内联 `height: Npx !important`
 * 钉入克隆。
 *
 * 安全边界：形态不符 / 无 `mjx-container` → 原样返回；配对数量不符（多视图
 * 等无法可靠配对）→ no-op；单元素实测不可用 → 跳过该元素、其余照常。
 *
 * 接线：`exportSvgTransforms` 链（紧随 `injectMathStylesIntoExportSvg`）。
 *
 * @returns 原样返回传入的 svg.js 元素对象（引擎要求）。
 */
export function pinMathContainerHeightsInExportSvg(
	svgElement: unknown,
): unknown {
	const root = (svgElement as { node?: Element } | null)?.node;
	if (!root) {
		return svgElement;
	}
	let cloneList: Element[];
	try {
		cloneList = Array.from(root.querySelectorAll(MJX_CONTAINER_SELECTOR));
	} catch {
		return svgElement;
	}
	if (cloneList.length === 0) {
		return svgElement;
	}
	const doc = (root as { ownerDocument?: Document }).ownerDocument;
	if (!doc) {
		return svgElement;
	}
	const liveList = listLiveMathContainers(doc, cloneList.length);
	if (liveList.length !== cloneList.length) {
		return svgElement;
	}
	for (let i = 0; i < cloneList.length; i += 1) {
		const live = liveList[i];
		if (!live) {
			continue; // 长度守卫已保证配对；此处为 noUncheckedIndexedAccess 的类型层防御
		}
		const height = measureMathContainerLayoutHeight(live);
		if (height === null) {
			continue;
		}
		try {
			// 直接调用 + 异常兜底（形态不符 → TypeError → 跳过该元素），与
			// export-foreign-object-padding 的查询形态同款写法
			(cloneList[i] as { style?: CSSStyleDeclaration }).style?.setProperty(
				'height',
				`${Math.round(height * 100) / 100}px`,
				'important',
			);
		} catch {
			continue;
		}
	}
	return svgElement;
}

/**
 * 产物就绪判定（S0.5 实测锁定）：产物内**全部 `mjx-c` 宽度 > 0**。
 *
 * 依据：CHTML 的字符宽度来自逐字符规则的 em `padding`，规则只在样式表 flush
 * 时写入——未 flush 时全为 0、产物「非零但塌缩」（实测：未 flush `14×20` 且
 * 11 个 `mjx-c` 全 0 宽；flush 后 `130×20` 且全 > 0）。「容器宽高 > 0」无法识别
 * 这种形态，会把错误尺寸送进产物缓存与节点重排（＝「块级公式只给一行高度」
 * 一类实机症状的根因）。无 `mjx-c` 的产物形态（异常/空公式）退回「宽高皆 > 0」
 * 保守判定。
 *
 * 例外（用户实机复现 + 无头 MathJax 3.2.2 取证）：MathJax 会在命名
 * 函数与其参数之间插入**不可见操作符**（`\sin x` → U+2061 函数应用符，
 * U+2062/2063 同理）——其逐字符规则 content 为**空串**、宽度设计上恒为 0，
 * flush 前后都不变。对这类字符按「全部 > 0」判定会**永久不就绪**（3 轮 flush
 * 重试耗尽退字面 + 误告警「字体/样式未就绪」），故零宽字符按其 `::before`
 * content 分流：`""` = 显式空内容规则（不可见字符）→ 视为就绪；其余（含规则
 * 未落盘的 `none`）→ 仍未就绪（保留对「塌缩态」的检测力，不放行部分塌缩）。
 */
function isProductReady(holder: HTMLElement): boolean {
	let chars: Element[] = [];
	try {
		chars = Array.from(holder.querySelectorAll('mjx-c'));
	} catch {
		chars = [];
	}
	if (chars.length === 0) {
		const box = holder.getBoundingClientRect();
		return box.width > 0 && box.height > 0;
	}
	for (const char of chars) {
		if (char.getBoundingClientRect().width > 0) {
			continue;
		}
		if (!isInvisibleCharByDesign(char)) {
			return false;
		}
	}
	return true;
}

/**
 * 零宽字符是否为「设计上不可见」：其 `::before` 的 content 为**空串**（MathJax
 * 为 U+2061 等不可见操作符写入的显式空规则，flush 后可读）。`none`（规则未
 * 落盘，未 flush 的塌缩形态）与任何非空内容（字形规则在而宽度为 0 的异常态）
 * 都不算。判定环境不可用（单测桩无 getComputedStyle / 异常宿主）时按 false
 * 处理，维持旧的保守行为。
 */
function isInvisibleCharByDesign(char: Element): boolean {
	try {
		if (typeof getComputedStyle !== 'function') {
			return false;
		}
		return getComputedStyle(char, '::before').content === '""';
	} catch {
		return false;
	}
}

/** flush 合并窗口（毫秒）：同批异步渲染的微任务几乎同时到达，合并为一次官方 flush */
const FLUSH_COALESCE_MS = 100;

/** flush 排程标志（单飞：不并发调用 `finishRenderMath`；标记只保证一次合并窗口） */
let flushScheduled = false;

/** flush 代际：每完成一次 flush 递增，作为「规则未就绪段」的放行依据 */
let flushGeneration = 0;

/**
 * 按批合并调度一次官方样式表 flush（`finishRenderMath`）。
 *
 * 背景：逐字符规则只在 flush 时写入（见 isProductReady 与文件头 ①）；不驱动
 * flush 就只能依赖「本会话阅读视图恰好渲染过数学」这一环境事实——冷启动下
 * 数学永久塌缩/不可见（此前实机与隔离实例均复现）。单次 flush 实测 ≈1s
 * （本机 1006ms / 隔离实例 981–1046ms），故**只按批调用**、绝不逐段等待；
 * 完成后由 pumpPending 重试全部待定段。
 */
function scheduleFlush(holder: HTMLElement): void {
	if (flushScheduled) {
		return;
	}
	const view = holder.ownerDocument ? holder.ownerDocument.defaultView : null;
	if (!view || typeof view.setTimeout !== 'function') {
		return;
	}
	flushScheduled = true;
	view.setTimeout(() => {
		flushScheduled = false;
		void runFlush();
	}, FLUSH_COALESCE_MS);
}

/**
 * 执行 flush 并在完成后触发一轮重试。
 *
 * 失败不致命：产物保持字面（可见），由重试预算与最终回退兜底；代际照常递增，
 * 让待定段获得一次重试机会（失败即再次排队 flush，直至预算耗尽）。
 */
async function runFlush(): Promise<void> {
	try {
		await finishRenderMath();
	} catch {
		/* flush 失败：保持字面显示，由重试预算兜底，不打断渲染链 */
	}
	flushGeneration += 1;
	schedulePumpForPending();
}

/**
 * 待定段：产物已生成但**尚未就绪**——三种成因共用一个队列：
 * ① holder 未挂载（预测量构建 → 首帧复用挂载）；② 规则未 flush（`mjx-c` 全 0
 * 宽，见 isProductReady）；③ 字体未加载完成（`loadingdone` / `ready` 后再试）。
 * 就绪前 holder 保持**可见的字面占位**；就绪即替换 + 入缓存 + 通知定稿（P4 重排）。
 */
interface PendingMath {
	rendered: Node;
	holder: HTMLElement;
	/** 原文 TeX 与显示模式：未就绪时回退字面占位需要 */
	tex: string;
	display: boolean;
	/** 因未挂载而等待的剩余泵数（未连接时递减；耗尽即放弃——导出快照等离屏场景） */
	mountPumpsLeft: number;
	/** 规则未就绪的重试轮数（每轮 flush 后尝试一次；耗尽即放弃，保持字面） */
	ruleRetriesLeft: number;
	/** 已确认"规则未就绪"：等下一次 flush 完成（代际前进）后再试，避免空转插入/测量 */
	ruleWait: boolean;
	/** 上次确认规则未就绪时的 flush 代际 */
	failedGeneration: number;
}

const pendingMath = new Set<PendingMath>();

/**
 * 挂载等待预算：覆盖「预测量构建 → 首帧挂载」的 1-2 帧，并为分片渲染（补丁 6）
 * 的延迟挂载留足余量——每泵一次 `isConnected` 检查（仅待定段存在时），成本可忽略；
 * 预算耗尽即放弃（导出快照等离屏场景的安全回退，保持可见字面）。
 */
const PENDING_MAX_PUMPS = 200;

/** 泵间隔（毫秒）：≈一帧，兼顾挂载延迟（等挂载的段）与开销 */
const PUMP_INTERVAL_MS = 16;

/** 规则未就绪的重试预算：每轮 flush 后试一次，仍不成就放弃（保持可见字面） */
const RULE_RETRY_LIMIT = 3;

/**
 * 取队首段的 holder 排一次泵（`runFlush` 完成后调用——让「规则等待」中的段获得
 * 放行重试；队空则 no-op）。
 */
function schedulePumpForPending(): void {
	const first = pendingMath.values().next().value;
	if (first) {
		schedulePump(first.holder);
	}
}

/**
 * 字体面说明（定稿）：**不设字体就绪重试**——字形的显示是渐进式的，
 * 产物 DOM 一旦到位，字体数据到达即自动显形，无需任何重试动作；渲染前的
 * `ensureMathFonts()`（2.5s 上限）已消除绝大部分「产物在而字形空」的窗口。
 * 重试机制只服务于两种**可检测**成因：规则未 flush（见 isProductReady）与
 * holder 未挂载。
 */

/** 避免重复排程（多个节点同帧入队时只排一次） */
let pumpScheduled = false;

/**
 * 尝试把待定段的产物放入 holder，并做**精确就绪判定**（见 isProductReady）。
 *
 * 成功：替换 + 标记类名 + **入缓存**（重建路径的复用模板）+ 通知定稿（P4 重排）。
 * 失败：**在同一同步块内撤回为字面**（浏览器不绘制中间态——不存在「先空白、
 * 后出现」的窗口），并按成因登记等待（未挂载 / 等 flush / 等字体）。
 *
 * @returns true = 已就绪并定稿；false = 保持待定
 */
function attemptPlace(item: PendingMath): boolean {
	const { holder, rendered, tex, display } = item;
	if (!holder.isConnected) {
		return false; // 等挂载（由泵轮询）
	}
	if (item.ruleWait && flushGeneration === item.failedGeneration) {
		return false; // 已确认规则未就绪：等下一次 flush 完成（runFlush 会再泵）
	}
	holder.replaceChildren(rendered);
	holder.classList.add(MATH_CONTAINER_CLASS);
	if (isProductReady(holder)) {
		rememberRenderedMath(tex, display, rendered);
		notifyMathSettled(holder);
		return true;
	}
	// 未就绪（逐字符规则尚未 flush → 产物「非零但塌缩」）：同步撤回字面 + 排队 flush
	holder.textContent = display ? `$$${tex}$$` : `$${tex}$`;
	holder.classList.remove(MATH_CONTAINER_CLASS);
	item.ruleWait = true;
	item.failedGeneration = flushGeneration;
	scheduleFlush(holder);
	return false;
}

/**
 * 排一次待定检查（`PUMP_INTERVAL_MS` 定时器——**不用 rAF**：后台/隐藏窗口的
 * rAF 会被节流甚至暂停，定时器更可靠；holder 属主窗口取定时器，popout 同）。
 */
function schedulePump(holder: HTMLElement): void {
	if (pumpScheduled) {
		return;
	}
	const view = holder.ownerDocument ? holder.ownerDocument.defaultView : null;
	if (!view || typeof view.setTimeout !== 'function') {
		return;
	}
	pumpScheduled = true;
	view.setTimeout(() => {
		pumpScheduled = false;
		pumpPending();
	}, PUMP_INTERVAL_MS);
}

/**
 * 待定检查：逐项尝试定稿；未挂载的段扣挂载预算，规则未就绪的段**等 flush 唤醒**
 * （不空转插入/测量）。预算或重试耗尽即放弃——**保持可见的字面**并告警一次。
 */
function pumpPending(): void {
	for (const item of Array.from(pendingMath)) {
		if (!item.holder.isConnected) {
			item.mountPumpsLeft -= 1;
			if (item.mountPumpsLeft <= 0) {
				pendingMath.delete(item);
			}
			continue;
		}
		if (item.ruleWait && flushGeneration === item.failedGeneration) {
			continue; // 等 flush（runFlush 完成后会再泵）
		}
		if (attemptPlace(item)) {
			pendingMath.delete(item);
			continue;
		}
		if (item.ruleWait) {
			if (item.ruleRetriesLeft <= 0) {
				pendingMath.delete(item);
				warnRenderInvisibleOnce();
				continue;
			}
			item.ruleRetriesLeft -= 1;
		}
	}
	// 仅"等挂载"的段需要继续轮询；"等 flush"的段由 runFlush 唤醒
	const needsPolling = Array.from(pendingMath).some(
		(item) => !item.ruleWait || !item.holder.isConnected,
	);
	if (needsPolling) {
		schedulePumpForPending();
	}
}

/** 字体触发 memo：一次会话只等一轮（私有区字符依赖 MathJax 自带字体） */
const FONT_WAIT_TIMEOUT_MS = 2500;

let mathFontsPromise: Promise<void> | null = null;

/**
 * 显式等待 MathJax 字体加载完成。
 *
 * CHTML 产物用**私有区码点**（如 U+1D438）承载字形，只有 MathJax 自带字体有
 * 对应字形——系统回退字体**渲染不出来**（用户控制台可见 Chromium 干预日志
 *「Slow network … Fallback font will be used: MathJax_Math-Italic.woff」，src 为
 * 本地 `app://obsidian.md/lib/mathjax/...`）。不等字体就替换，会经历一段
 * 「产物已在 DOM 但视觉空白」的窗口期（用户实机截图空白的主因）。
 */
function ensureMathFonts(): Promise<void> {
	if (!mathFontsPromise) {
		mathFontsPromise = (async () => {
			try {
				if (typeof document === 'undefined') {
					return;
				}
				// 窄化访问：tsconfig 的 lib 不含 FontFaceSet 全局类型（与其余外部
				// 面同一防御口径——运行时检测 + 结构类型，不依赖声明面）
				const fontSet = (
					document as unknown as {
						fonts?: Iterable<{ family: string; load(): Promise<unknown> }>;
					}
				).fonts;
				if (!fontSet) {
					return;
				}
				const faces = Array.from(fontSet).filter((face) =>
					/MJX/i.test(face.family),
				);
				let timer: number | null = null;
				try {
					await Promise.race([
						Promise.all(
							faces.map((face) => face.load().catch(() => undefined)),
						),
						new Promise<void>((resolve) => {
							timer = window.setTimeout(resolve, FONT_WAIT_TIMEOUT_MS);
						}),
					]);
				} finally {
					if (timer !== null) {
						window.clearTimeout(timer);
					}
				}
			} catch {
				/* 字体加载失败：由替换后的可见性自检兜底（回退字面，见下） */
			}
		})();
	}
	return mathFontsPromise;
}

/** 「产物不可见并已回退字面」告警去重：同一会话只提醒一次 */
let renderInvisibleWarned = false;

function warnRenderInvisibleOnce(): void {
	if (renderInvisibleWarned) {
		return;
	}
	renderInvisibleWarned = true;
	console.warn(
		'MindMap Studio：数学产物不可见（字体/样式未就绪），已回退为字面显示',
	);
}

/**
 * 渲染一段 TeX 到 holder（异步，fire-and-forget；调用方无需等待）。
 * 多个节点并发渲染安全：`loadMathJax()` 内部对加载去重，渲染方法为纯函数。
 *
 * 就绪前 holder 保持**可见的字面占位**；就绪（见 isProductReady）即替换产物、
 * 入缓存并通知 `onSettled`（P4 尺寸同步）。未就绪的段进入待定队列——flush
 * 完成 / 字体就绪 / 挂载后自动重试，预算耗尽则保留字面并告警（最终回退）。
 *
 * @param display 单行 `$$…$$`（display / 块级）传 true → 渲染为独立居中公式；
 *   行内 `$…$` 传 false（缺省）。原样透传给 MathJax 通道的 `{ display }` 选项。
 */
export function renderMathWithMathJax(
	tex: string,
	holder: HTMLElement,
	display = false,
	onSettled?: (holder: HTMLElement) => void,
): void {
	if (onSettled) {
		settleCallbacks.set(holder, onSettled);
	}
	void (async () => {
		try {
			await loadMathJax();
			// 字体就绪：私有区字符依赖 MathJax 自带字体，不等会经历「产物已在
			// DOM 但视觉空白」的窗口期（见 ensureMathFonts）
			await ensureMathFonts();
			// MathJax 由官方 loadMathJax 注入**主窗口**（popout 视图的 holder 挂
			// 跨文档节点合法，appendChild 自动 adopt）；不取 activeWindow——
			// 渲染产物属于主窗口 document
			const mathJax = (window as unknown as { MathJax?: MathJaxLike }).MathJax;
			// 通道优先级：tex2chtml（实机唯一可用）→ tex2svg（兼容回退）；
			// 两者皆缺 = API 面缺失 → 告警一次并保留字面占位（安全回退）
			const rendered =
				mathJax?.tex2chtml?.(tex, { display }) ??
				mathJax?.tex2svg?.(tex, { display }) ??
				null;
			if (!rendered) {
				warnRenderApiMissing();
				return;
			}
			const item: PendingMath = {
				rendered,
				holder,
				tex,
				display,
				mountPumpsLeft: PENDING_MAX_PUMPS,
				ruleRetriesLeft: RULE_RETRY_LIMIT,
				ruleWait: false,
				failedGeneration: flushGeneration,
			};
			if (attemptPlace(item)) {
				return; // 就绪：已替换 + 入缓存 + 通知定稿
			}
			// 未就绪（未挂载 / 规则未 flush）：入队等自动重试
			pendingMath.add(item);
			schedulePump(holder);
		} catch (error) {
			console.warn('行内数学渲染失败，保留字面显示', error);
		}
	})();
}
