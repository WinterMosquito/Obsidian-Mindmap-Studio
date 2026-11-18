/** K215：真实引擎 + 真实 DOM/CSS；仅 Workspace/ItemView 用公开 API 的最小宿主替身。 */
import { join } from 'node:path';

export function buildMiniMapSidebarProbe(root) {
	const modulePath = (path) => JSON.stringify(join(root, path).replaceAll('\\', '/'));
	return `
import { ItemView } from 'obsidian';
import { createMindMap, getDrawTransform, applyThemeConfig } from ${modulePath('src/engine/mindmap.ts')};
import { setupMiniMap, attachMiniMap, refreshAttachedMiniMap, refreshMiniMap, refreshMiniMapAfterRender, teardownMiniMap } from ${modulePath('src/features/view/view-minimap.ts')};
import { MiniMapSidebar } from ${modulePath('src/platform/workspace/minimap-sidebar.ts')};
HTMLElement.prototype.createEl = function(tag, info = {}) {
	const el = document.createElement(tag);
	el.className = typeof info === 'string' ? info : info.cls || '';
	this.appendChild(el); return el;
};
HTMLElement.prototype.createDiv = function(info) { return this.createEl('div', info); };
HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
HTMLElement.prototype.removeClass = function(name) { this.classList.remove(name); };
Object.defineProperty(HTMLElement.prototype, 'win', { get() { return this.ownerDocument.defaultView; } });
const probe = document.createElement('pre'); probe.id = 'minimap-sidebar-probe'; document.body.appendChild(probe);
const assert = (condition, label) => { if (!condition) throw new Error(label); };
const pause = (ms = 160) => new Promise(resolve => setTimeout(resolve, ms));
const cleanups = [], contexts = [], failures = [];
const rootSplit = {}, rightSplit = { parent: rootSplit, collapsed: false };
const events = new Map();
const core = document.createElement('div'); core.style.cssText = 'position:relative;width:360px;height:420px'; document.body.appendChild(core);
const toolbar = core.createDiv('core-toolbar'); toolbar.textContent = 'search / follow / collapse';
const content = core.createDiv('view-content'); content.style.cssText = 'height:100%;width:100%';
const originalTree = content.createDiv('core-tree'); originalTree.textContent = 'Outline';
const tag = document.body.createDiv('tag-pane'); tag.textContent = '# tag';
const outlineView = Object.assign(Object.create(ItemView.prototype), { containerEl: core, contentEl: content, getViewType: () => 'outline' });
const outline = { parent: { parent: rightSplit }, view: outlineView, getContainer: () => rootSplit };
let recent = null;
const workspace = { rootSplit, rightSplit,
	getMostRecentLeaf: () => recent,
	getLeavesOfType: type => type === 'outline' ? [outline] : [],
	on: (name, callback) => { events.set(name, callback); return {}; },
	onLayoutReady: () => {},
	ensureSideLeaf: () => Promise.reject(new Error('unexpected fallback')),
};
const plugin = { app: { workspace }, registerView() {}, registerEvent() {}, register(callback) { cleanups.push(callback); } };
const manager = new MiniMapSidebar(plugin, leaf => leaf?.context ? {
	key: leaf.context.mindMap, mount: host => attachMiniMap(leaf.context, host), refresh: () => refreshAttachedMiniMap(leaf.context),
} : null, () => 'en');
function makeContext(id, children) {
	const shell = document.body.createDiv('mindmap-view-container'); shell.style.cssText = 'width:640px;height:400px;position:relative';
	const canvas = shell.createDiv('mindmap-canvas-container'); canvas.style.cssText = 'width:100%;height:100%';
	const map = createMindMap(canvas, { data: { uid: id, text: id }, children }, {
		layout: 'logicalStructure', lineStyle: 'straight', themePref: 'light', themeStyle: 'default',
		palette: 'slate', isDark: false, enableDrag: true,
	});
	const domListeners = [];
	const context = { mindMap: map, containerEl: shell, canvasEl: canvas, engineEvents: {
		onEngine: (engine, event, callback) => engine.on(event, callback),
		onDom: (el, event, callback, options) => { el.addEventListener(event, callback, options); domListeners.push(() => el.removeEventListener(event, callback, options)); },
	} };
	contexts.push({ context, domListeners }); return context;
}
(async () => {
	try {
		const one = makeContext('one', []);
		await pause(); setupMiniMap(one, { floating: false }); recent = { context: one }; manager.refresh();
		await pause();
		const panel = content.querySelector('.mindmap-minimap');
		const image = panel.querySelector('img');
		assert(image.naturalWidth > 0, 'SVG decode');
		assert(panel.getBoundingClientRect().width === 360 && panel.getBoundingClientRect().height === 420, 'full sidebar dimensions');
		assert(!one.containerEl.querySelector('.mindmap-minimap'), 'no duplicate canvas overlay');
		assert(getComputedStyle(originalTree).display === 'none' && getComputedStyle(toolbar).display === 'none', 'hide original tree and controls');
		const appended = content.createDiv('core-empty'); appended.textContent = 'refreshed Outline';
		assert(getComputedStyle(appended).display === 'none', 'new core child is scoped hidden');
		assert(getComputedStyle(tag).display !== 'none', 'tag pane remains visible');
		const two = makeContext('two', Array.from({length: 15}, (_, n) => ({ data: { uid: 'n' + n, text: 'branch ' + n }, children: [{ data: { uid: 'leaf' + n, text: 'child ' + n } }] })));
		await pause(); setupMiniMap(two, { floating: false }); recent = { context: two }; manager.refresh(); await pause();
		assert(content.querySelector('.mindmap-minimap') !== panel && !panel.isConnected, 'different source binds independent component');
		const next = content.querySelector('.mindmap-minimap');
		const box = next.querySelector('.mindmap-minimap-view');
		const before = getDrawTransform(two.mindMap);
		box.dispatchEvent(new MouseEvent('mousedown', {button: 0, clientX: 100, clientY: 100, bubbles: true, cancelable: true}));
		window.dispatchEvent(new MouseEvent('mousemove', {clientX: 120, clientY: 110}));
		window.dispatchEvent(new MouseEvent('mouseup', {button: 0})); await pause();
		assert(getDrawTransform(two.mindMap).translateX !== before.translateX, 'viewport drag navigates real engine');
		const scale = getDrawTransform(two.mindMap).scaleX;
		next.dispatchEvent(new WheelEvent('wheel', {deltaY: -120, ctrlKey: true, clientX: 1000, clientY: 10, bubbles: true, cancelable: true})); await pause();
		assert(getDrawTransform(two.mindMap).scaleX !== scale, 'sidebar wheel zoom uses canvas engine');
		// dump-dom 虚拟时钟不保证 ResizeObserver 交付；走同一官方 layout-change 尺寸路径。
		core.style.width = '500px'; events.get('layout-change')(); await pause();
		assert(next.getBoundingClientRect().width === 500 && next.querySelector('img').naturalWidth === 500,
			'resize redraws full panel: ' + JSON.stringify({ panel: next.getBoundingClientRect().width, image: next.querySelector('img').naturalWidth, host: next.parentElement.getBoundingClientRect().width }));
		const oldSvg = next.querySelector('img').src;
		two.mindMap.setLayout('organizationStructure'); refreshMiniMapAfterRender(two); await pause(450);
		assert(next.querySelector('img').src !== oldSvg, 'layout updates thumbnail without waiting 30 seconds');
		const layoutSvg = next.querySelector('img').src;
		applyThemeConfig(two.mindMap, { isDark: false, themePref: 'light', layout: 'organizationStructure', lineStyle: 'straight', themeStyle: 'default', palette: '#ff6600' });
		refreshMiniMap(two); await pause();
		assert(next.querySelector('img').src !== layoutSvg, 'colour updates thumbnail immediately');
		core.style.display = 'none'; await pause();
		core.style.display = ''; events.get('layout-change')(); await pause();
		assert(next.querySelector('img').naturalWidth === 500, 'hidden tab resumes at actual size');
		rightSplit.collapsed = true; events.get('layout-change')();
		assert(!content.querySelector('.mindmap-minimap'), 'collapsed sidebar unmounts sampling');
		rightSplit.collapsed = false; events.get('layout-change')(); await pause();
		assert(content.querySelector('.mindmap-minimap'), 'reopening sidebar rebinds source');
		recent = {}; manager.refresh();
		assert(getComputedStyle(originalTree).display !== 'none' && getComputedStyle(toolbar).display !== 'none', 'Markdown restores Outline and controls');
		assert(!core.classList.contains('mindmap-outline-host'), 'restore host marker');
		cleanups.forEach(cleanup => cleanup());
		probe.textContent = JSON.stringify({ ok: true, checks: 17 });
	} catch (error) { probe.textContent = JSON.stringify({ ok: false, error: error.stack || String(error) }); }
	finally { for (const entry of contexts) { teardownMiniMap(entry.context); entry.domListeners.forEach(cleanup => cleanup()); entry.context.mindMap.destroy(); } }
})();
`;
}
