/** 临时视图仍可编辑和换布局，但外观操作不写 YAML 或按文件状态。 */
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { MindMapView } from '../../../src/features/view/view';

vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});
vi.mock('../../../src/features/view/view-minimap', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../../../src/features/view/view-minimap')>();
	return { ...mod, refreshMiniMap: vi.fn(), refreshMiniMapAfterRender: vi.fn() };
});

function harness(path: string) {
	const order: string[] = [];
	const frontmatter: Record<string, unknown> = { Mindmap: 'Mindmap', 'Mindmap Layout': 'logical' };
	const file = Object.assign(new TFile(), { path, extension: 'md' });
	const flush = vi.fn(async () => { order.push('flush'); });
	const write = vi.fn(async (_file: TFile, update: (fm: Record<string, unknown>) => void) => {
		order.push('property'); update(frontmatter);
	});
	const setPreference = vi.fn();
	const apply = vi.fn((_layout: string) => { order.push('apply'); });
	const view = Object.create(MindMapView.prototype) as MindMapView;
	Object.assign(view, {
		file, currentLayout: 'logicalStructure', session: { flush },
		app: { fileManager: { processFrontMatter: write }, metadataCache: { getFileCache: () => ({ frontmatter }) } },
		plugin: { viewState: { setPreference }, settings: { defaultLineStyle: 'straight' } },
		engine: { setLineStyle: vi.fn(), applyTheme: vi.fn() }, applyLayoutToEngine: apply,
	});
	return { view, frontmatter, flush, write, setPreference, apply, order };
}

describe('临时导图的布局和外观', () => {
	it('普通笔记换布局/连线/配色/边框均只在当前视图生效', async () => {
		const h = harness('OS.md');
		const before = JSON.stringify(h.frontmatter);
		await h.view.applyLayout('timeline');
		h.view.applyLineStyle('curve'); h.view.applyPalette('mint'); h.view.applyThemeStyle('borderless');
		expect(h.apply).toHaveBeenCalledWith('timeline');
		expect(h.view.resolvePreference('lineStyle')).toBe('curve');
		expect(h.write).not.toHaveBeenCalled();
		expect(h.flush).not.toHaveBeenCalled();
		expect(h.setPreference).not.toHaveBeenCalled();
		expect(JSON.stringify(h.frontmatter)).toBe(before);
		h.view.syncDeclaredLayout();
		expect(h.apply).toHaveBeenCalledOnce();
	});

	it('专用文件保持先保存正文、再写布局、最后更新画面的顺序', async () => {
		const h = harness('OS.mindmap.md');
		await h.view.applyLayout('timeline');
		expect(h.order).toEqual(['flush', 'property', 'apply']);
		expect(h.frontmatter['Mindmap Layout']).toBe('timeline');
		h.view.applyLineStyle('curve');
		expect(h.setPreference).toHaveBeenCalledWith('OS.mindmap.md', 'lineStyle', 'curve');
	});
});
