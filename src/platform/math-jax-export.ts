/**
 * 数学渲染通道的**导出 SVG 后处理链**（2026-10-16 自 `platform/math-jax.ts` 拆出）。
 *
 * 本模块是**纯 DOM/CSSOM 后处理**：不依赖任何渲染态（`renderedMathCache` /
 * `unsettledMath` / `pendingMath` / `charRuleIndex` / `flushGeneration` 均不碰）
 * ——这是它能被干净抽出的依据。唯一隐式前提是「CHTML 样式表元素已挂入文档」，
 * 由渲染侧 flush 保证（代码层无状态读取）。
 */
import { createWarnOnce } from '../core/errors';
import { appendSvgStyle } from './export-svg-postprocess';
import { relaxMathGlyphClipPaths } from './math-jax-export-clip';
import { primeMathJaxFonts, withInlinedMathFonts } from './math-jax-fonts';

/**
 * MathJax 注入的 CHTML 样式表元素 id（字形与 @font-face 的载体）。
 *
 * 导出（模块内共享）：渲染侧 `readCharRuleIndex` 也需按同一 id 取样式表元素
 * ——本模块是它的主用户，故常量收口于此，由 `math-jax.ts` 回引（不回吐公共 API）。
 */
export const CHTML_STYLES_ID = 'MJX-CHTML-styles';

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
		// 样式元素在、CSSOM 不可读：退回 textContent（丢逐字符规则）——影响面只在
		// 导出 SVG，用户不可感 ⇒ 必须留痕，否则该失效无痕退化。
		warnCssSheetUnreadableOnce(
			'数学样式表元素存在但 CSSOM 不可读，导出 SVG 将退回 textContent（导出图数学可能不可见）',
		);
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

// 字形裁切放宽已拆至 ./math-jax-export-clip（纯字符串改写、可直测）；
// 此处导入后原样转发（`export … from` 不引入本地绑定，注入链仍需本地符号）。
export { relaxMathGlyphClipPaths };


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
 * 注入前两步改写（均为纯字符串、顺序无关）：
 * 1. 字体：快照就绪（`primeExportMathFonts` 已预取）→ **按需内联 data URI
 *    @font-face**（`withInlinedMathFonts`，2026-10-23 A 方案）；未就绪 → 退回
 *    `stripFontFaceRules` 剥离（导出上下文加载不了 `app://`）；
 * 2. `relaxMathGlyphClipPaths`：放宽 `mjx-c` 纵向裁切窗（无字体时的兜底；
 *    字体就位时无害）。
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
	const inlined = withInlinedMathFonts(css, root);
	appendSvgStyle(
		root,
		relaxMathGlyphClipPaths(inlined ?? stripFontFaceRules(css)),
	);
	return svgElement;
}

/**
 * 导出前预取 MathJax 字体（入口是 async，可等）：导出钩子 `handleBeingExportSvg`
 * 是**同步**的，字体缓存必须先就绪，否则那一次导出仍走无字体回退。
 *
 * 幂等、并发去重、失败不抛（返回 false，导出链自动回退）。
 */
export function primeExportMathFonts(): Promise<boolean> {
	return primeMathJaxFonts(readMathJaxCss());
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
			// export-svg-postprocess（padForeignObjectsForExport）的查询形态同款写法
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
 * 「CHTML 样式表元素存在但 `sheet` 不可读」告警留痕：同一会话只提醒一次。
 *
 * 为什么必须留痕：`readMathJaxCss` 此时退回 `textContent`，而 MathJax 的逐字符
 * 字形规则（`mjx-c…::before{content:…}`）是渲染期 `insertRule` 动态插入的、
 * **不在 textContent 里** ⇒ 导出 SVG 会丢这些规则、**导出图数学不可见**，而屏上
 * 一切正常（单测与视觉闸门都触不到真宿主）。静默即无痕退化（K85 ① 教训）。
 */
const warnCssSheetUnreadableOnce = createWarnOnce();
