/**
 * 「以思维导图打开」偏好恢复器回归（open-as-restore.ts）。
 *
 * 覆盖 restoreMarkdownLeaves 的分支矩阵（经 register 的 file-open 事件与
 * scheduleStartupRestore 两入口触发）与 active-leaf-change 自动切换守卫；
 * openAsMindMap 以 spy 替代（isMindMapMarkdownFile 用真实实现），
 * workspace/leaf/view 用最小桩（MarkdownView/TFile 来自 obsidian mock，
 * instanceof 判定与插件运行时同源）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownView, TFile } from 'obsidian';
import { VIEW_TYPE } from '../src/constants';
import { OpenAsPreferenceRestorer } from '../src/open-as-restore';

/** openAsMindMap 的 spy（vi.hoisted 保证先于 mock 工厂可用；默认成功兑现） */
const openAsMindMapMock = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
);

vi.mock('../src/md-open', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../src/md-open')>();
	return { ...mod, openAsMindMap: openAsMindMapMock };
});

function fakeFile(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: path.endsWith('.md') ? 'md' : 'png',
	});
}

interface RestorerHarness {
	restorer: OpenAsPreferenceRestorer;
	openAsResult: (path: string) => 'mindmap' | 'markdown' | undefined;
	fileOpenCallbacks: Array<() => void>;
	leafChangeCallbacks: Array<(leaf: unknown) => void>;
	leaves: unknown[];
}

/** 构造带 file 的 MarkdownView 桩（构造参按真实 obsidian 类型补位） */
function markdownViewWith(fields: Record<string, unknown>): MarkdownView {
	return Object.assign(new MarkdownView(null as never), fields);
}

function setupHarness(openAsMap: Record<string, 'mindmap' | 'markdown' | undefined>): RestorerHarness {
	const fileOpenCallbacks: Array<() => void> = [];
	const leafChangeCallbacks: Array<(leaf: unknown) => void> = [];
	const workspace = {
		on: (name: string, callback: (leaf?: unknown) => void): unknown => {
			if (name === 'file-open') {
				fileOpenCallbacks.push(() => callback());
			} else if (name === 'active-leaf-change') {
				leafChangeCallbacks.push((leaf) => callback(leaf));
			}
			return { name };
		},
		getLeavesOfType: (type: string) =>
			type === 'markdown' ? harness.leaves : [],
	};
	const restorer = new OpenAsPreferenceRestorer(
		new App(),
		workspace as never,
		{
			getOpenAs: (path: string) => openAsMap[path],
		},
		(view: unknown) => Boolean(view && (view as { own?: boolean }).own),
	);
	const harness: RestorerHarness = {
		restorer,
		openAsResult: (path: string) => openAsMap[path],
		fileOpenCallbacks,
		leafChangeCallbacks,
		leaves: [],
	};
	return harness;
}

afterEach(() => {
	openAsMindMapMock.mockClear();
	vi.useRealTimers();
});

describe('restoreMarkdownLeaves（file-open 触发）', () => {
	it('偏好为 mindmap 的 .mindmap.md：切换到导图视图', async () => {
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const file = fakeFile('a.mindmap.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.leaves = [leaf];
		harness.restorer.register({
			registerEvent: () => {},
		} as never);

		harness.fileOpenCallbacks.forEach((cb) => cb());
		await vi.waitFor(() => {
			expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		});
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
	});

	it('非 .mindmap.md / 偏好非 mindmap / 视图非 MarkdownView / 无文件：均不切换', async () => {
		const harness = setupHarness({
			'note.md': 'mindmap', // 非 .mindmap.md
			'b.mindmap.md': 'markdown', // 偏好非 mindmap
		});
		harness.leaves = [
			{ view: markdownViewWith({ file: fakeFile('note.md') }) },
			{ view: markdownViewWith({ file: fakeFile('b.mindmap.md') }) },
			{ view: {} }, // 非本插件认知的视图实例
			{ view: markdownViewWith({ file: null }) }, // 无文件
		];
		harness.restorer.register({ registerEvent: () => {} } as never);

		harness.fileOpenCallbacks.forEach((cb) => cb());
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});

	it('openAsMindMap 失败被捕获并记录，不产生未处理拒绝', async () => {
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		openAsMindMapMock.mockRejectedValueOnce(new Error('leaf gone'));
		harness.leaves = [{ view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) }];
		harness.restorer.register({ registerEvent: () => {} } as never);

		harness.fileOpenCallbacks.forEach((cb) => cb());
		await vi.waitFor(() => {
			expect(errorSpy).toHaveBeenCalled();
		});
		expect(errorSpy.mock.calls[0]?.[0]).toContain('自动切换思维导图视图失败');
		errorSpy.mockRestore();
	});
});

describe('active-leaf-change 自动切换', () => {
	it('激活非本插件的 markdown 视图且文件匹配：切换', async () => {
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const file = fakeFile('a.mindmap.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.restorer.register({ registerEvent: () => {} } as never);

		harness.leafChangeCallbacks.forEach((cb) => cb(leaf));
		await vi.waitFor(() => {
			expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		});
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
	});

	it('本插件视图 / 无 leaf / 文件不匹配：不切换', async () => {
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const ownLeaf = { view: markdownViewWith({ own: true }) };
		const foreignLeaf = { view: markdownViewWith({ file: fakeFile('note.md') }) };
		harness.restorer.register({ registerEvent: () => {} } as never);

		harness.leafChangeCallbacks.forEach((cb) => {
			cb(ownLeaf);
			cb(foreignLeaf);
			cb(undefined);
		});
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});
});

describe('scheduleStartupRestore：多档延时扫描', () => {
	it('早/中/晚各扫描一次，恢复流程逐档重试', async () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const leaf = { view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) };
		harness.leaves = [leaf];
		harness.restorer.scheduleStartupRestore();

		await vi.advanceTimersByTimeAsync(400);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);

		// 恢复调用的最终落点是导图视图 ViewState
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, leaf.view.file);
		expect(VIEW_TYPE).toBe('mindmap-view');
	});
});
