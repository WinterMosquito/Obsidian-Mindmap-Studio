/** 工具栏/搜索栏的真实 DOM 与 CSS 迁移探针；复用 verify-visual 的 Chrome 驱动。 */
import { join } from 'node:path';

export function buildUiEntrySource(root, baselineCss, currentCss) {
	const toolbar = join(root, 'src/ui/toolbar/toolbar.ts').replaceAll('\\', '/');
	const search = join(root, 'src/ui/search/search-bar.ts').replaceAll('\\', '/');
	const nameModal = join(root, 'src/ui/modal-name.ts').replaceAll('\\', '/');
	const markdownAction = join(root, 'src/platform/workspace/markdown-mindmap-action.ts').replaceAll('\\', '/');
	return `
import { Toolbar } from ${JSON.stringify(toolbar)};
import { SearchBar } from ${JSON.stringify(search)};
import { openNameInputModal } from ${JSON.stringify(nameModal)};
import { MarkdownMindMapAction } from ${JSON.stringify(markdownAction)};
import { MarkdownView } from 'obsidian';
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
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
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
		// 创建弹窗使用真实表单代码，宿主 Modal/按钮只补公开 DOM 装配与关闭契约。
		let modals = 0;
		for (const width of [360, 1200]) for (const dark of [false, true]) {
			const frame = document.createElement('iframe');
			frame.style.cssText = 'width:' + width + 'px;height:320px;border:0';
			document.body.appendChild(frame);
			const doc = frame.contentDocument;
			for (const key of ['createEl', 'createDiv', 'addClass', 'setText']) {
				frame.contentWindow.HTMLElement.prototype[key] = HTMLElement.prototype[key];
			}
			const native = doc.createElement('style');
			native.textContent = ':root{--radius-m:' + (dark ? 6 : 8) + 'px;--modal-radius:12px;--input-radius:' + (dark ? 3 : 5) + 'px;--input-height:30px;--font-ui-small:13px;--size-4-3:12px;--size-4-4:16px;--background-primary:' + (dark ? '#181818' : '#fff') + ';--text-normal:' + (dark ? '#eee' : '#222') + ';--text-muted:#888;}body{margin:0}.modal{box-sizing:border-box;border-radius:var(--modal-radius);padding:16px;width:min(420px,calc(100vw - 32px));background:var(--background-primary);color:var(--text-normal)}input[type=text]{box-sizing:border-box;height:var(--input-height);border-radius:var(--input-radius);font-size:14px;border:1px solid #888;padding:4px 8px}input[type=text]:focus{outline:2px solid #58a}button{border-radius:var(--input-radius)}';
			doc.head.appendChild(native);
			const pluginStyle = doc.createElement('style');
			pluginStyle.textContent = newCss;
			doc.head.appendChild(pluginStyle);
			const result = openNameInputModal({ document: doc }, '思维导图2026-11-18', '/', dark ? 'en' : 'zh');
			const modal = doc.querySelector('.mindmap-name-modal');
			const input = modal.querySelector('input');
			const buttons = [...modal.querySelectorAll('button')];
			const computed = el => frame.contentWindow.getComputedStyle(el);
			assert(computed(modal).borderTopLeftRadius === (dark ? '6px' : '8px'), '弹窗圆角随宿主中号变量变化');
			assert(computed(input).borderTopLeftRadius === (dark ? '3px' : '5px'), '输入框继承宿主圆角');
			assert(input.getBoundingClientRect().width <= modal.getBoundingClientRect().width - 32, '窄窗输入框不溢出');
			assert(buttons.length === 2 && buttons[1].classList.contains('mod-cta'), '原生取消/创建按钮');
			input.value = '   ';
			input.dispatchEvent(new frame.contentWindow.Event('input'));
			assert(buttons[1].disabled, '空名禁用创建');
			input.value = '知识体系';
			input.dispatchEvent(new frame.contentWindow.Event('input'));
			assert(!buttons[1].disabled, '有效名字恢复创建');
			input.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
			assert(await result === '知识体系' && !doc.querySelector('.mindmap-name-modal'), 'Enter 完成一次并关闭');
			const cancelled = openNameInputModal({ document: doc }, '取消测试', '/', 'zh');
			doc.querySelector('input').dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
			assert(await cancelled === null, 'Escape 取消');
			modals++;
			frame.remove();
		}
		// 原生标题栏按钮按具体视图归属打开文件；重复布局与语言刷新不叠加按钮。
		const opened = [];
		const leaf = { setViewState: async state => { opened.push(state); } };
		const mdView = new MarkdownView(leaf); leaf.view = mdView;
		mdView.file = { path: 'OS.md', extension: 'md' };
		let lang = 'zh';
		const cleanups = [];
		const headerActions = new MarkdownMindMapAction({
			getLeavesOfType: () => [leaf], on: () => ({}), onLayoutReady: callback => callback(),
		}, () => lang);
		headerActions.register({ register: callback => cleanups.push(callback), registerEvent: () => {} });
		headerActions.refresh(); lang = 'en'; headerActions.refresh();
		const headerButton = mdView.header.querySelector('.mindmap-open-action');
		assert(mdView.header.children.length === 1 && headerButton.getAttribute('aria-label') === 'Open as mind map', '原生标题栏按钮去重与语言刷新');
		headerButton.click(); await Promise.resolve(); await Promise.resolve();
		assert(opened.length === 1 && opened[0].state.file === 'OS.md' && opened[0].state.mdBackMode === 'source', '标题栏按钮点击切换当前文件');
		cleanups.forEach(callback => callback());
		assert(!mdView.header.querySelector('.mindmap-open-action'), '标题栏按钮随卸载移除');
		mdView.header.remove();
		bar.dispose(); hud.dispose();
		oldInput.dispatchEvent(new Event('input'));
		assert(inputs === 1 && buttons.every(b => b.onclick === null), '销毁解绑真实监听与按钮');
		shell.remove();
		probe.textContent = JSON.stringify({ ok: true, compared, modals });
	} catch (error) { probe.textContent = JSON.stringify({ error: error.stack || String(error) }); }
})();
`;
}

/** 最小 Obsidian 呈现替身：生成带尺寸的 SVG，tooltip 写官方属性。 */
export const UI_SHIM_SOURCE = `
export class App {}
export class TFile {}
export class AbstractInputSuggest {}
export class MarkdownView {
	constructor(leaf) { this.leaf = leaf; this.header = document.createElement('div'); document.body.appendChild(this.header); }
	getMode() { return 'source'; }
	addAction(icon, title, callback) {
		const button = this.header.createDiv('clickable-icon view-action');
		setIcon(button, icon); setTooltip(button, title); button.addEventListener('click', callback);
		return button;
	}
}
export class Modal {
	constructor(app) {
		this.containerEl = app.document.createElement('div');
		this.modalEl = this.containerEl.createDiv('modal');
		this.titleEl = this.modalEl.createDiv('modal-title');
		this.contentEl = this.modalEl.createDiv('modal-content');
	}
	setCloseCallback(callback) { this.closeCallback = callback; }
	open() {
		this.modalEl.ownerDocument.body.appendChild(this.containerEl);
		this.modalEl.querySelector('input')?.focus();
	}
	close() { this.closeCallback?.(); this.containerEl.remove(); }
}
export class ButtonComponent {
	constructor(parent) { this.buttonEl = parent.createEl('button'); }
	setButtonText(text) { this.buttonEl.textContent = text; return this; }
	setCta() { this.buttonEl.classList.add('mod-cta'); return this; }
	setDisabled(disabled) { this.buttonEl.disabled = disabled; return this; }
	onClick(callback) { this.buttonEl.addEventListener('click', callback); return this; }
}
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
