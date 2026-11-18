/** K215：真实引擎 + 真实 DOM/CSS；仅 Workspace/ItemView 用公开 API 的最小宿主替身。 */
import { join } from 'node:path';

export function buildMiniMapSidebarProbe(root) {
	const modulePath = (path) => JSON.stringify(join(root, path).replaceAll('\\', '/'));
	return `
import { ItemView } from 'obsidian';
import { createMindMap, getDrawTransform, applyThemeConfig, captureMiniMap, getCanvasSize } from ${modulePath('src/engine/mindmap.ts')};
import { projectViewportBox } from ${modulePath('src/core/minimap-geometry.ts')};
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
const cleanups = [], contexts = [], fitReports = [];
const rootSplit = {}, rightSplit = { parent: rootSplit, collapsed: false };
const events = new Map();
// 使用真实 ItemView 层级与宿主更高 specificity 的盒模型，另加图片主题约束压力。
const constraints = document.createElement('style');
constraints.textContent = '.workspace-leaf-content .view-content {padding:4px 12px 32px;overflow:auto;box-sizing:border-box}.workspace-split.mod-right-split .view-content {height:100%;overflow:auto}.workspace-leaf-content img:not([width]) {max-width:100%}.workspace-leaf-content .view-content img {min-width:900px;height:auto;object-fit:cover;border-radius:4px}';
document.head.appendChild(constraints);
const side = document.body.createDiv('workspace-split mod-right-split');
const core = side.createDiv('workspace-leaf-content'); core.dataset.type='outline'; core.style.cssText = 'position:relative;width:360px;height:420px';
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
function makeContext(id, children, layout = 'logicalStructure') {
	const shell = document.body.createDiv('mindmap-view-container'); shell.style.cssText = 'width:640px;height:400px;position:relative';
	const canvas = shell.createDiv('mindmap-canvas-container'); canvas.style.cssText = 'width:100%;height:100%';
	const map = createMindMap(canvas, { data: { uid: id, text: id }, children }, {
		layout, lineStyle: 'straight', themePref: 'light', themeStyle: 'default',
		palette: 'slate', isDark: false, enableDrag: true, performanceMode: true,
	});
	const domListeners = [];
	const context = { mindMap: map, containerEl: shell, canvasEl: canvas, engineEvents: {
		onEngine: (engine, event, callback) => engine.on(event, callback),
		onDom: (el, event, callback, options) => { el.addEventListener(event, callback, options); domListeners.push(() => el.removeEventListener(event, callback, options)); },
	} };
	contexts.push({ context, domListeners }); return context;
}
function assertFit(context, label) {
	const panel = content.querySelector('.mindmap-minimap'), image = panel.querySelector('img');
	const host = panel.parentElement.getBoundingClientRect(), rect = panel.getBoundingClientRect(), imgRect = image.getBoundingClientRect();
	for (const candidate of [rect, imgRect]) {
		assert(Math.abs(candidate.x-host.x)<0.1 && Math.abs(candidate.y-host.y)<0.1 && Math.abs(candidate.width-host.width)<1 && Math.abs(candidate.height-host.height)<1, label + ': host/panel/image share origin and size');
	}
	assert(content.scrollWidth <= Math.ceil(host.width) && content.scrollLeft === 0, label + ': no horizontal scroll hiding overflow');
	assert(getComputedStyle(content).paddingLeft === '0px' && getComputedStyle(content).overflow === 'hidden', label + ': host padding and overflow override');
	const size = {width:Math.floor(host.width),height:Math.floor(host.height)};
	const frame = captureMiniMap(context.mindMap, undefined, getCanvasSize(context.mindMap), size);
	assert(frame && frame.image === image.src, label + ': image uses current geometry, no stale bounds');
	const drawing = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',')+1)), 'image/svg+xml').documentElement;
	const holder = document.body.createDiv(); holder.style.cssText='position:absolute;left:-20000px'; holder.appendChild(document.importNode(drawing,true));
	let shapes = 0;
	for (const shape of holder.querySelectorAll('svg > g rect, svg > g path')) {
		const b = shape.getBBox(); shapes++;
		assert(b.x>=10 && b.y>=10 && b.x+b.width<=size.width-10 && b.y+b.height<=size.height-10, label + ': every painted node/path fits with edge space: ' + JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height}));
	}
	holder.remove();
	assert(shapes>0, label + ': actual shapes measured');
	const expected = projectViewportBox({content:frame.content,panel:frame.panel,canvas:getCanvasSize(context.mindMap),transform:getDrawTransform(context.mindMap)});
	const box = panel.querySelector('.mindmap-minimap-view'), actual = box.getBoundingClientRect();
	assert(!box.classList.contains('is-hidden') && Math.abs(actual.x-rect.x-expected.x)<1.2 && Math.abs(actual.y-rect.y-expected.y)<1.2 && Math.abs(actual.width-expected.width)<1.2 && Math.abs(actual.height-expected.height)<1.2, label + ': blue frame screen projection agrees with SVG coordinates');
	fitReports.push({label,shapes,width:size.width,height:size.height,inset:frame.panel.inset});
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
		assertFit(one,'single root');
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
		assertFit(two,'dragged viewport');
		const scale = getDrawTransform(two.mindMap).scaleX;
		next.dispatchEvent(new WheelEvent('wheel', {deltaY: -120, ctrlKey: true, clientX: 1000, clientY: 10, bubbles: true, cancelable: true})); await pause();
		assert(getDrawTransform(two.mindMap).scaleX !== scale, 'sidebar wheel zoom uses canvas engine');
		assertFit(two,'zoomed viewport');
		core.style.width = '500px'; await pause();
		assert(next.getBoundingClientRect().width === 500 && next.querySelector('img').naturalWidth === 500,
			'resize redraws full panel: ' + JSON.stringify({ panel: next.getBoundingClientRect().width, image: next.querySelector('img').naturalWidth, host: next.parentElement.getBoundingClientRect().width }));
		const oldSvg = next.querySelector('img').src;
		two.mindMap.setLayout('organizationStructure'); refreshMiniMapAfterRender(two); await pause(450);
		assert(next.querySelector('img').src !== oldSvg, 'layout updates thumbnail without waiting 30 seconds');
		const layoutSvg = next.querySelector('img').src;
		applyThemeConfig(two.mindMap, { isDark: false, themePref: 'light', layout: 'organizationStructure', lineStyle: 'straight', themeStyle: 'default', palette: '#ff6600' });
		refreshMiniMap(two); await pause();
		assert(next.querySelector('img').src !== layoutSvg, 'colour updates thumbnail immediately');
		assertFit(two,'layout and colour update');
		const chain = depth => depth ? [{data:{uid:'wide-'+depth,text:'Long branch '.repeat(12)},children:chain(depth-1)}] : [];
		const samples = [
			['wide',chain(60),'logicalStructure'],
			['tall',Array.from({length:1500},(_,n)=>({data:{uid:'tall-'+n,text:'Branch '+n}})),'logicalStructure'],
			['sampled-large',Array.from({length:2300},(_,n)=>({data:{uid:'large-'+n,text:'Branch '+n}})),'logicalStructure'],
			...['mindMap','organizationStructure','catalogOrganization','timeline','fishbone'].map(layout=>[layout,Array.from({length:6},(_,n)=>({data:{uid:layout+n,text:'Branch '+n},children:[{data:{uid:layout+'leaf'+n,text:'Child '+n}}]})),layout]),
		];
		core.style.width='528px';core.style.height='1138px';
		for (const [label,children,layout] of samples) {
			const context = makeContext(label,children,layout); await pause(); setupMiniMap(context,{floating:false}); recent={context}; manager.refresh(); await pause();
			assertFit(context,label+' 528×1138');
			content.dir='rtl'; assertFit(context,label+' RTL'); content.dir='ltr';
		}
		// 回到原来源继续生命周期验证，保持其它场景的预期宽度。
		core.style.width='500px';core.style.height='420px';recent={context:two};manager.refresh();await pause();
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
		probe.textContent = JSON.stringify({ ok: true, checks: 17, fitReports });
	} catch (error) { probe.textContent = JSON.stringify({ ok: false, error: error.stack || String(error) }); }
	finally { for (const entry of contexts) { teardownMiniMap(entry.context); entry.domListeners.forEach(cleanup => cleanup()); entry.context.mindMap.destroy(); } }
})();
`;
}
