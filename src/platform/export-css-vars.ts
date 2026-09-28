/**
 * 导出 SVG 的 **Obsidian CSS 变量注入**（K99）。
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
 * 变量值安全校验（K99 加固，2026-09-28 复核发现）。
 *
 * 变量值来自**宿主主题**（用户可安装第三方主题与 CSS 片段，内容不受控），
 * 若原样拼进 `svg { … }` 规则块，形如 `Arial} svg{opacity:0` 的值会**闭合
 * 规则块并注入任意 CSS 规则** → 导出图被篡改（内容隐藏/错位等）。
 * `textContent` 不会被解析为 HTML，故**无脚本执行面**；但样式注入成立，
 * 因此注入前过滤：只放行不可能闭合块或引入新规则的字符。
 * 不合法的值**跳过该变量**（导出回退内联兜底值，功能仍可用）。
 */
const SAFE_CSS_VALUE = /^[\w\s#'"(),.:/%!-]+$/;

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
		// 空值跳过；形态可疑（可能闭合规则块注入样式）同跳过——见 SAFE_CSS_VALUE
		if (!value || !SAFE_CSS_VALUE.test(value)) {
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
