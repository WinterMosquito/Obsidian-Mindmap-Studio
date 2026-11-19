/** 测量/导出使用冻结副本；屏上活组件不被克隆，不锁定响应式样式。 */
export function pluginPresentation(root: HTMLElement): HTMLElement {
	const clone = root.cloneNode(true) as HTMLElement;
	const originals = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
	const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
	const win = root.ownerDocument.defaultView;
	if (!win) return clone;
	for (let i = 0; i < originals.length; i++) {
		const original = originals[i]!;
		const copy = copies[i]!;
		if (original.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
		const computed = win.getComputedStyle(original);
		for (const property of Array.from(computed)) {
			copy.style.setProperty(property, computed.getPropertyValue(property));
		}
		if (original.tagName === 'CANVAS') {
			try {
				const image = root.ownerDocument.createElement('img');
				image.src = (original as HTMLCanvasElement).toDataURL();
				image.style.cssText = copy.style.cssText;
				copy.replaceWith(image);
			} catch { /* 不可读画布仍保留原尺寸，导出不影响用户的活组件。 */ }
		}
	}
	Object.assign(clone.style, { pointerEvents: 'none' });
	for (const button of Array.from(clone.querySelectorAll<HTMLButtonElement>('button:not([role="tab"])'))) {
		Object.assign(button.style, { visibility: 'hidden' });
	}
	return clone;
}
