/**
 * 导出 SVG 后处理链共用的 `<style>` 注入原语。
 *
 * `injectObsidianCssVarsIntoExportSvg`（export-css-vars.ts）与
 * `injectMathStylesIntoExportSvg`（math-jax.ts）此前各自内联了一份
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
