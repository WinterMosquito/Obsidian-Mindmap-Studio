/**
 * 文件右键「以 Markdown 打开」的**分支选择**（组合根 `main.ts`，2026-10-15 新增的
 * 路径守卫）：
 * - 该文件的导图视图已在**任意**标签打开（含后台标签）→ `setActiveLeaf` 带到
 *   前台并复用视图自带 `backToMarkdown()`（恢复进入前模式，与工具栏/命令同语义）；
 * - 未命中（导图在别的文件 / 尚未以导图打开）→ 回落 `openAsMarkdown(…, 'source')`，
 *   且**不许**顶掉无关标签页。
 *
 * 建实例方式：`Object.create(原型)` 不跑构造器（真实例要完整宿主面与 App），与
 * `tests/view-md-back-mode.test.ts` 同款处置；引擎防腐面整体桩掉（顶层会加载
 * vendor bundle，Node 环境不可加载）。`Menu` 桩须自建——官方 `Menu` 与
 * `tests/mocks/obsidian.ts` 的桩都不保留 `addItem` 回调，无法断言菜单项与点击。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App, type Menu, type WorkspaceLeaf } from 'obsidian';
import MindMapStudioPlugin from '../src/main';
import { MindMapView } from '../src/features/view';
import type { MindMapStudioSettings } from '../src/settings';

vi.mock('../src/engine/mindmap', () => ({}));

const mdOpen = vi.hoisted(() => ({
	isMindMapFile: vi.fn(() => true),
	openAsMarkdown: vi.fn(),
	declareAndOpenAsMindMap: vi.fn(),
}));
vi.mock('../src/markdown/md-open', () => mdOpen);

/** 断言基准路径（读写两侧共用；改名即全用例同步） */
const FILE_PATH = 'a.mindmap.md';

function makeFile(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: 'md',
		basename: path.replace(/\.md$/, ''),
	});
}

interface CapturedItem {
	title?: string;
	icon?: string;
	click?: () => void;
}

/** 自建最小 `Menu` 桩：记录 `addItem` 的链式字段与 `onClick` */
function captureMenu(): { menu: Menu; items: CapturedItem[] } {
	const items: CapturedItem[] = [];
	const menu = {
		addItem: (cb: (item: unknown) => void): unknown => {
			const captured: CapturedItem = {};
			const chain = {
				setTitle: (value: string): unknown => {
					captured.title = value;
					return chain;
				},
				setIcon: (value: string): unknown => {
					captured.icon = value;
					return chain;
				},
				onClick: (handler: () => void): unknown => {
					captured.click = handler;
					return chain;
				},
			};
			cb(chain);
			items.push(captured);
			return menu;
		},
	};
	return { menu: menu as unknown as Menu, items };
}

/** 导图 leaf 桩：只铺本分支碰的两面（`file` / `backToMarkdown`） */
function makeMindMapLeaf(path: string): {
	leaf: WorkspaceLeaf;
	backToMarkdown: ReturnType<typeof vi.fn>;
} {
	const backToMarkdown = vi.fn();
	// 与 view-md-back-mode.test.ts 同款：Object.create 的返回值先显式断言为视图类型，
	// 再铺字段（`as MindMapView` 也满足 lint 的 no-unsafe-assignment）
	const view = Object.create(MindMapView.prototype) as MindMapView;
	Object.assign(view, { file: makeFile(path), backToMarkdown });
	return { leaf: { view } as unknown as WorkspaceLeaf, backToMarkdown };
}

interface Harness {
	app: App;
	getLeaf: ReturnType<typeof vi.fn>;
	setActiveLeaf: ReturnType<typeof vi.fn>;
	/** 触发「以 Markdown 打开」项（顺带断言「互斥一项」） */
	clickOpenAsMarkdown(file: TFile): CapturedItem;
}

function buildHarness(leaves: readonly unknown[]): Harness {
	const setActiveLeaf = vi.fn();
	const getLeaf = vi.fn(() => ({}) as unknown as WorkspaceLeaf);
	const app = {
		workspace: {
			getLeavesOfType: (): readonly unknown[] => leaves,
			setActiveLeaf,
			getLeaf,
		},
	} as unknown as App;
	const plugin = Object.create(
		MindMapStudioPlugin.prototype,
	) as MindMapStudioPlugin;
	Object.assign(plugin, {
		app,
		settings: { language: 'zh' } as unknown as MindMapStudioSettings,
	});
	return {
		app,
		getLeaf,
		setActiveLeaf,
		clickOpenAsMarkdown(file) {
			const { menu, items } = captureMenu();
			(
				plugin as unknown as {
					addMarkdownFileMenuItems(menu: Menu, file: TFile): void;
				}
			).addMarkdownFileMenuItems(menu, file);
			// 互斥一项：同一动作不得同时给出「打开 Markdown」与「打开导图」
			expect(items).toHaveLength(1);
			const item = items[0]!;
			item.click?.();
			return item;
		},
	};
}

describe('文件右键「以 Markdown 打开」的分支选择（main.ts）', () => {
	beforeEach(() => {
		mdOpen.isMindMapFile.mockReturnValue(true);
		mdOpen.openAsMarkdown.mockClear();
		mdOpen.declareAndOpenAsMindMap.mockClear();
	});

	it('该文件的导图视图在后台标签：带到前台并复用视图返回入口，不做降级', () => {
		const other = makeMindMapLeaf('b.mindmap.md');
		const same = makeMindMapLeaf(FILE_PATH);
		const h = buildHarness([other.leaf, same.leaf]);

		const item = h.clickOpenAsMarkdown(makeFile(FILE_PATH));

		expect(item.click).toBeTypeOf('function');
		expect(h.setActiveLeaf).toHaveBeenCalledTimes(1);
		expect(h.setActiveLeaf).toHaveBeenCalledWith(same.leaf, { focus: true });
		expect(same.backToMarkdown).toHaveBeenCalledTimes(1);
		expect(other.backToMarkdown).not.toHaveBeenCalled();
		expect(mdOpen.openAsMarkdown).not.toHaveBeenCalled();
	});

	it('导图在别的文件：不碰任何 leaf，回落 openAsMarkdown(source)', () => {
		const other = makeMindMapLeaf('b.mindmap.md');
		const h = buildHarness([other.leaf]);
		const file = makeFile(FILE_PATH);

		h.clickOpenAsMarkdown(file);

		expect(h.setActiveLeaf).not.toHaveBeenCalled();
		expect(other.backToMarkdown).not.toHaveBeenCalled();
		expect(mdOpen.openAsMarkdown).toHaveBeenCalledTimes(1);
		expect(mdOpen.openAsMarkdown).toHaveBeenCalledWith(
			h.app,
			h.getLeaf.mock.results[0]?.value,
			file,
			'source',
			'zh',
		);
	});

	it('同路径但不是导图视图的 leaf：instanceof 守卫拦下，走回落路径', () => {
		// 同路径的 Markdown 视图（或任何非导图 leaf）不得被当成命中：否则会调
		// 不存在的 backToMarkdown 而静默失败
		const impostor = {
			leaf: { view: { file: makeFile(FILE_PATH) } } as unknown as WorkspaceLeaf,
		};
		const h = buildHarness([impostor.leaf]);

		h.clickOpenAsMarkdown(makeFile(FILE_PATH));

		expect(h.setActiveLeaf).not.toHaveBeenCalled();
		expect(mdOpen.openAsMarkdown).toHaveBeenCalledTimes(1);
	});

	it('判据为假（普通笔记）：走「以思维导图打开」一支，不出现降级项', () => {
		mdOpen.isMindMapFile.mockReturnValue(false);
		const h = buildHarness([]);
		const file = makeFile('notes/plain.md');

		const item = h.clickOpenAsMarkdown(file);

		expect(item.click).toBeTypeOf('function');
		expect(mdOpen.openAsMarkdown).not.toHaveBeenCalled();
		expect(mdOpen.declareAndOpenAsMindMap).toHaveBeenCalledTimes(1);
		expect(mdOpen.declareAndOpenAsMindMap).toHaveBeenCalledWith(
			h.app,
			h.getLeaf.mock.results[0]?.value,
			file,
			'zh',
		);
	});
});
