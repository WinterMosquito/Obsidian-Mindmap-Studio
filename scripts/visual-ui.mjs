/** 工具栏/搜索栏的真实 DOM 与 CSS 迁移探针；复用 verify-visual 的 Chrome 驱动。 */
import { join } from 'node:path';

export function buildUiEntrySource(root, baselineCss, currentCss) {
	const toolbar = join(root, 'src/ui/toolbar/toolbar.ts').replaceAll('\\', '/');
	const search = join(root, 'src/ui/search/search-bar.ts').replaceAll('\\', '/');
	return `
import { Toolbar } from ${JSON.stringify(toolbar)};
import { SearchBar } from ${JSON.stringify(search)};
// 仅补宿主公开 DOM 扩展；不替换组件逻辑。
HTMLElement.prototype.createEl = function(tag, info = {}) {
	const el = document.createElement(tag);
	el.className = typeof info === 'string' ? info : info.cls || '';
	for (const [key, value] of Object.entries(info.attr || {})) el.setAttribute(key, value);
	this.appendChild(el);
	return el;
};
HTMLElement.prototype.createDiv = function(info) { return this.createEl('div', info); };
HTMLElement.prototype.createSpan = function(info) { return this.createEl('span', info); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
HTMLElement.prototype.toggleClass = function(name, enabled) { this.classList.toggle(name, enabled); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
const probe = document.createElement('pre');
probe.id = 'ui-components-probe';
document.body.appendChild(probe);
const assert = (value, label) => { if (!value) throw new Error(label); };
(async () => {
	try {
		const shell = document.createElement('div');
		shell.className = 'mindmap-view-container';
		shell.style.cssText = 'width:640px;height:400px';
		document.body.appendChild(shell);
		const canvas = shell.createDiv('mindmap-canvas-container');
		canvas.tabIndex = 0;
		const toolbarRoot = shell.createDiv('mindmap-toolbar');
		let pressed = true;
		let canUndo = false;
		let clicks = 0;
		const action = (id, icon) => ({ id, describe: () => ({ icon, tooltip: id }), onClick: () => clicks++ });
		const hud = new Toolbar(toolbarRoot, [
			[action('markdown', 'file-text'), action('export', 'image')],
			[{ id: 'border', describe: () => ({ icon: pressed ? 'square' : 'square-dashed', tooltip: 'border', pressed }), onClick: () => { pressed = !pressed; clicks++; } }, action('line', 'slash')],
			[action('zoom-in', 'zoom-in'), action('reset', 'rotate-ccw'), action('fit', 'maximize'), action('zoom-out', 'zoom-out')],
			[{ id: 'undo', describe: () => ({ icon: 'undo', tooltip: 'undo', disabled: !canUndo }), onClick: () => clicks++ }, action('redo', 'redo')],
		]);
		const buttons = [...toolbarRoot.querySelectorAll('button')];
		assert(buttons.length === 10 && toolbarRoot.querySelectorAll('.mindmap-hud-group').length === 4, '四组十按钮');
		assert(buttons.every(b => b.dataset.tooltipPosition === 'left'), '所有 toolbar tooltip 位于左侧');
		buttons[2].click();
		assert(buttons[2].getAttribute('aria-pressed') === 'false' && clicks === 1, '切换反馈与一次动作');
		buttons[8].click();
		assert(clicks === 1, '无历史时 disabled 阻止动作');
		const rail = toolbarRoot.firstChild;
		canUndo = true;
		hud.refresh(['undo', 'redo']);
		assert(toolbarRoot.firstChild === rail && !buttons[8].disabled, '历史状态就地刷新');
		const searchRoot = shell.createDiv('mindmap-search-bar');
		let inputs = 0, next = 0, prev = 0;
		const labels = { placeholder: '搜索', prev: '上一个', next: '下一个', close: '关闭' };
		const bar = new SearchBar(searchRoot, labels, {
			input: () => inputs++, next: () => next++, prev: () => prev++, close: () => bar.close(),
		});
		bar.input.dispatchEvent(new Event('input'));
		bar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		bar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }));
		assert(inputs === 1 && next === 1 && prev === 1, '搜索 input / Enter / Shift+Enter');
		const oldInput = bar.input;
		bar.updateLabels({ ...labels, placeholder: 'Search' });
		assert(bar.input === oldInput && bar.input.placeholder === 'Search', '语言更新保留输入 DOM');
		bar.open(); bar.close(); canvas.focus();
		await new Promise(resolve => setTimeout(resolve, 60));
		assert(document.activeElement === canvas, '关闭取消延迟焦点');
		bar.open(); bar.setCount('无匹配', true);
		const baseCss = ${JSON.stringify(baselineCss)};
		const newCss = ${JSON.stringify(currentCss)};
		let compared = 0;
		// iframe 宽度产生真正的媒体查询；亮暗变量、hover/focus 与 disabled 同时走 CSS。
		for (const width of [480, 1200]) for (const dark of [false, true]) {
			const frame = document.createElement('iframe');
			frame.style.cssText = 'position:absolute;left:-10000px;width:' + width + 'px;height:500px;border:0';
			document.body.appendChild(frame);
			const doc = frame.contentDocument;
			doc.body.style.margin = '0';
			doc.body.innerHTML = shell.outerHTML;
			doc.querySelector('.mindmap-view-container').style.width = '100%';
			const variables = doc.createElement('style');
			variables.textContent = ':root{--background-primary:' + (dark ? '#181818' : '#fff') + ';--background-modifier-border:#888;--background-modifier-hover:#888;--interactive-normal:#777;--text-normal:#777;--text-muted:#999;--text-accent:#58a;--text-accent-hover:#acf;--text-error:#c55;--radius-s:4px;--input-shadow:none;--shadow-s:none;}';
			doc.head.appendChild(variables);
			const style = doc.createElement('style'); doc.head.appendChild(style);
			doc.querySelector('input').focus();
			const elements = [...doc.querySelectorAll('.mindmap-view-container, .mindmap-view-container *')];
			const snapshot = () => elements.map(el => {
				const computed = frame.contentWindow.getComputedStyle(el);
				return [...computed].map(key => [key, computed.getPropertyValue(key)]);
			});
			style.textContent = baseCss;
			const before = snapshot();
			style.textContent = newCss;
			const after = snapshot();
			assert(JSON.stringify(before) === JSON.stringify(after), 'CSS 计算值改变: width=' + width + ', dark=' + dark);
			assert(frame.contentWindow.getComputedStyle(doc.querySelector('.mindmap-toolbar')).pointerEvents === 'none', '工具栏穿透层');
			assert(frame.contentWindow.getComputedStyle(doc.querySelector('.mindmap-hud')).pointerEvents === 'auto', '按钮组可点击');
			assert(frame.contentWindow.getComputedStyle(doc.querySelector('.mindmap-search-bar')).display === 'flex', '展开搜索栏仍为浮层');
			assert(frame.contentWindow.getComputedStyle(doc.querySelector('.mindmap-tool-btn')).width === '32px', '按钮尺寸保留');
			compared += elements.length;
			frame.remove();
		}
		bar.dispose(); hud.dispose();
		oldInput.dispatchEvent(new Event('input'));
		assert(inputs === 1 && buttons.every(b => b.onclick === null), '销毁解绑真实监听与按钮');
		shell.remove();
		probe.textContent = JSON.stringify({ ok: true, compared });
	} catch (error) { probe.textContent = JSON.stringify({ error: error.stack || String(error) }); }
})();
`;
}

/** 最小 Obsidian 呈现替身：生成带尺寸的 SVG，tooltip 写官方属性。 */
export const UI_SHIM_SOURCE = `
export function setIcon(el, id) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
	svg.dataset.icon = id; el.replaceChildren(svg);
}
export function setTooltip(el, text, options = {}) {
	el.setAttribute('aria-label', text);
	if (options.placement) el.dataset.tooltipPosition = options.placement;
}
`;
