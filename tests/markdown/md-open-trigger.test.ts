/** 打开方式只影响当前标签；普通笔记不因打开、返回或重启恢复被改写属性。 */
import { describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../../src/core/constants';
import {
	canAutoOpenMindMap, isExplicitMindMapOpen, isMindMapFile,
	openAsMarkdown, openAsMindMap, readDeclaredLayout,
} from '../../src/markdown/md-open';

function file(path = 'notes/OS.md'): TFile {
	return Object.assign(new TFile(), { path, extension: 'md' });
}

function leaf(mode = 'preview') {
	const view = Object.assign(new MarkdownView(null as never), { getMode: () => mode });
	const setViewState = vi.fn(async (): Promise<void> => undefined);
	return { leaf: { view, setViewState } as never, setViewState };
}

describe('临时导图的视图切换', () => {
	it('普通笔记只切视图，返回恢复阅读模式，不将选择应用到其它标签', async () => {
		const f = file();
		const h = leaf();
		const other = leaf();
		await openAsMindMap(h.leaf, f);
		expect(h.setViewState).toHaveBeenLastCalledWith({
			type: VIEW_TYPE, state: { file: f.path, mdBackMode: 'preview' },
		});
		expect(isExplicitMindMapOpen(h.leaf, f)).toBe(true);
		expect(isExplicitMindMapOpen(other.leaf, f)).toBe(false);
		await openAsMarkdown(h.leaf, f, 'preview');
		expect(h.setViewState).toHaveBeenLastCalledWith({
			type: CORE_VIEW_TYPE.MARKDOWN, state: { file: f.path, mode: 'preview' },
		});
		expect(isExplicitMindMapOpen(h.leaf, f)).toBe(false);
	});

	it('已声明专用文件切回 Markdown 后，后台扫描不能立即切回来', async () => {
		const f = file('React.mindmap.md');
		const h = leaf();
		await openAsMarkdown(h.leaf, f);
		expect(canAutoOpenMindMap(h.leaf, f)).toBe(false);
		expect(canAutoOpenMindMap(leaf().leaf, f)).toBe(true);
		await openAsMindMap(h.leaf, f);
		expect(canAutoOpenMindMap(h.leaf, f)).toBe(true);
	});

	it('外部重命名沿用同一个 TFile，当前标签的临时导图选择保持有效', async () => {
		const f = file('OS.md'); const h = leaf();
		await openAsMindMap(h.leaf, f);
		f.path = 'System.md';
		expect(isExplicitMindMapOpen(h.leaf, f)).toBe(true);
		await openAsMarkdown(h.leaf, f);
		f.path = 'OperatingSystem.md';
		expect(canAutoOpenMindMap(h.leaf, f)).toBe(false);
	});

	it('导航到其它文件后，同标签上一次打开方式失效', async () => {
		const h = leaf();
		const f = file('React.mindmap.md');
		await openAsMarkdown(h.leaf, f);
		expect(canAutoOpenMindMap(h.leaf, file('Other.md'))).toBe(true);
		expect(canAutoOpenMindMap(h.leaf, f)).toBe(true);
	});

	it('并发打开同标签只切换一次', async () => {
		const h = leaf();
		const f = file();
		await Promise.all([openAsMindMap(h.leaf, f), openAsMindMap(h.leaf, f)]);
		expect(h.setViewState).toHaveBeenCalledOnce();
	});

	it('同标签连续请求不同文件时，后一个请求不会被前一个在途切换吞掉', async () => {
		const h = leaf();
		let release: () => void = () => undefined;
		h.setViewState.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
		const first = openAsMindMap(h.leaf, file('A.md'));
		const second = openAsMindMap(h.leaf, file('B.md'));
		expect(h.setViewState).toHaveBeenCalledOnce();
		release();
		await Promise.all([first, second]);
		expect(h.setViewState).toHaveBeenCalledTimes(2);
		expect(h.setViewState).toHaveBeenLastCalledWith({ type: VIEW_TYPE, state: { file: 'B.md', mdBackMode: 'preview' } });
		expect(isExplicitMindMapOpen(h.leaf, file('B.md'))).toBe(true);
	});

	it('切换失败可重试，后续打开不被在途状态卡住', async () => {
		const h = leaf();
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		h.setViewState.mockRejectedValueOnce(new Error('unavailable'));
		await openAsMindMap(h.leaf, file());
		await openAsMindMap(h.leaf, file());
		expect(h.setViewState).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});
});

describe('专用导图与普通笔记的属性边界', () => {
	it.each([
		['React.mindmap.md', { Mindmap: 'Mindmap', 'Mindmap Layout': 'timeline' }, true, 'timeline'],
		['React.md', { Mindmap: 'Mindmap', 'Mindmap Layout': 'timeline' }, false, null],
		['React.mindmap.md', { Mindmap: 'Markdown' }, false, null],
		['React.mindmap.md', {}, false, null],
	] as const)('%s 与 %j', async (path, frontmatter, enabled, layout) => {
		const getFileCache = vi.fn(() => ({ frontmatter }));
		const write = vi.fn();
		const app = { metadataCache: { getFileCache }, fileManager: { processFrontMatter: write } };
		const before = JSON.stringify(frontmatter);
		const f = file(path);
		expect(isMindMapFile(app as never, f)).toBe(enabled);
		expect(readDeclaredLayout(app as never, f)).toBe(layout);
		const h = leaf();
		await openAsMindMap(h.leaf, f);
		await openAsMarkdown(h.leaf, f);
		expect(write).not.toHaveBeenCalled();
		expect(JSON.stringify(frontmatter)).toBe(before);
	});
});
