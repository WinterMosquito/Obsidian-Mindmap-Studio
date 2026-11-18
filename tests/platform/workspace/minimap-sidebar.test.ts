import { describe, expect, it, vi } from 'vitest';
import { ItemView, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { MiniMapSidebar, type SidebarMiniMapSource } from '../../../src/platform/workspace/minimap-sidebar';

class El {
	classes = new Set<string>();
	children: El[] = [];
	parentElement: El | null = null;
	addClass(name: string): void { this.classes.add(name); }
	removeClass(name: string): void { this.classes.delete(name); }
	createDiv(name: string): El {
		const child = new El();
		child.addClass(name);
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	remove(): void {
		if (this.parentElement) {
			this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
			this.parentElement = null;
		}
	}
}

function harness() {
	const root = {};
	const right = { parent: root, collapsed: false };
	const left = { parent: root };
	const callbacks = new Map<string, () => void>();
	const cleanups: Array<() => void> = [];
	const leaves: Array<WorkspaceLeaf> = [];
	const recent = {} as WorkspaceLeaf;
	const release = vi.fn();
	const refresh = vi.fn();
	let source: SidebarMiniMapSource | null = { key: {}, mount: vi.fn(() => release), refresh };
	const workspace = {
		rootSplit: root, rightSplit: right,
		getMostRecentLeaf: vi.fn(() => recent),
		getLeavesOfType: (type: string) => leaves.filter((leaf) => leaf.view.getViewType() === type),
		on: (name: string, callback: () => void) => { callbacks.set(name, callback); return {}; },
		onLayoutReady: (callback: () => void) => { callbacks.set('ready', callback); },
		ensureSideLeaf: vi.fn<(...args: unknown[]) => Promise<WorkspaceLeaf>>(),
	};
	const plugin = {
		app: { workspace }, registerView: vi.fn(), registerEvent: vi.fn(),
		register: (cleanup: () => void) => cleanups.push(cleanup),
	} as unknown as Plugin;
	const manager = new MiniMapSidebar(plugin, () => source, () => 'en');
	function leaf(type = 'outline', parent: object = right, container: object = root) {
		const containerEl = new El();
		const contentEl = containerEl.createDiv('view-content');
		contentEl.createDiv('core-tree');
		const view = Object.assign(Object.create(ItemView.prototype) as ItemView, {
			contentEl, containerEl, getViewType: () => type,
		});
		const detach = vi.fn();
		const result = {
			parent, view, getContainer: () => container, detach,
		} as unknown as WorkspaceLeaf;
		leaves.push(result);
		return { leaf: result, contentEl, containerEl, detach };
	}
	return { root, right, left, workspace, manager, leaf, release, refresh, callbacks,
		setSource: (value: SidebarMiniMapSource | null) => { source = value; },
		dispose: () => cleanups.forEach((cleanup) => cleanup()),
	};
}

describe('K215 Outline temporary sidebar host', () => {
	it('only borrows one right-side Outline, preserving its original content and view state', () => {
		const h = harness();
		const first = h.leaf();
		const second = h.leaf();
		const left = h.leaf('outline', h.left);
		const popout = h.leaf('outline', h.right, {});
		h.manager.refresh();
		expect(first.contentEl.classes.has('mindmap-outline-content')).toBe(true);
		expect(first.contentEl.children[0]?.classes.has('core-tree')).toBe(true);
		for (const entry of [second, left, popout]) {
			expect(entry.contentEl.classes.has('mindmap-outline-content')).toBe(false);
		}
		expect(h.workspace.getMostRecentLeaf).toHaveBeenCalledWith(h.root);
		h.setSource(null);
		h.manager.refresh();
		expect(first.contentEl.children).toHaveLength(1);
		expect(first.containerEl.classes.has('mindmap-outline-host')).toBe(false);
		expect(h.release).toHaveBeenCalledTimes(1);
	});

	it('sidebar focus preserves the recent document, changing engine/view rebinds the source', () => {
		const h = harness();
		const outline = h.leaf();
		h.manager.refresh();
		h.callbacks.get('active-leaf-change')?.();
		expect(h.release).not.toHaveBeenCalled();
		expect(h.refresh).toHaveBeenCalledTimes(1);
		h.setSource({ key: {}, mount: () => vi.fn(), refresh: vi.fn() });
		h.manager.refresh();
		expect(h.release).toHaveBeenCalledTimes(1);
		expect(outline.contentEl.children).toHaveLength(2);
		h.dispose();
		expect(outline.contentEl.classes.has('mindmap-outline-content')).toBe(false);
	});

	it('collapsed sidebar releases the panel and never expands or creates a leaf', () => {
		const h = harness();
		h.leaf();
		h.manager.refresh();
		h.right.collapsed = true;
		h.callbacks.get('layout-change')?.();
		expect(h.release).toHaveBeenCalledTimes(1);
		expect(h.workspace.ensureSideLeaf).not.toHaveBeenCalled();
	});

	it('cleans the original container even if its leaf has changed views', () => {
		const h = harness();
		const original = h.leaf();
		h.manager.refresh();
		original.leaf.view = h.leaf('markdown', h.left).leaf.view;
		h.setSource(null);
		h.manager.refresh();
		expect(original.containerEl.classes.has('mindmap-outline-host')).toBe(false);
		expect(original.contentEl.classes.has('mindmap-outline-content')).toBe(false);
	});

	it.each(['markdown', 'unload'])('pending fallback cleans its created leaf after %s', async (exit) => {
		const h = harness();
		let resolve!: (leaf: WorkspaceLeaf) => void;
		h.workspace.ensureSideLeaf.mockImplementation(() => new Promise((done) => { resolve = done; }));
		h.manager.refresh();
		if (exit === 'unload') { h.dispose(); } else { h.setSource(null); h.manager.refresh(); }
		const fallback = h.leaf('mindmap-studio-minimap');
		resolve(fallback.leaf);
		await new Promise<void>((done) => setImmediate(done));
		expect(fallback.detach).toHaveBeenCalledTimes(1);
		expect(fallback.contentEl.classes.has('mindmap-outline-content')).toBe(false);
	});
});
