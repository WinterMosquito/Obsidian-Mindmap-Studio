/** 导出仅内联当前插件图使用的已加载 data 字体，不下载资源或复制插件的字体库。 */
export function embedPluginFonts(svg: Element): void {
	const families = new Set<string>();
	for (const text of Array.from(svg.querySelectorAll('[font-family]'))) {
		const family = text.getAttribute('font-family')?.replace(/["']/g, '').trim();
		if (family) families.add(family);
	}
	if (!families.size) return;
	const faces = new Set<string>();
	for (const sheet of Array.from(svg.ownerDocument.styleSheets)) {
		try {
			for (const rule of Array.from(sheet.cssRules)) {
				if (!rule.cssText.startsWith('@font-face')) continue;
				const face = rule as CSSFontFaceRule;
				const family = face.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
				if (families.has(family) && face.style.getPropertyValue('src').includes('data:')) faces.add(face.cssText);
			}
		} catch { /* 跨源样式表不可读时不探测，也不改变屏上字体。 */ }
	}
	if (!faces.size) return;
	const style = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
	style.textContent = Array.from(faces).join('\n');
	svg.prepend(style);
}
