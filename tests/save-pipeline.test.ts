/**
 * SavePipeline 回归测试（document-service.ts）。
 *
 * 覆盖审查报告点名的 P0 竞态场景：
 * - 写入进行中再触发 → 待写标记 + 排空后补写最新快照（编辑不丢）；
 * - 写盘失败 → 错误经 onSaveError 上报、管线不复位卡死；
 * - 防抖调度 / 取消、autoSave 开关、文件已删除守卫、frontmatter 拼接。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import {
	SavePipeline,
	type SavePipelineDeps,
} from '../src/services/document-service';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

function node(text: string, children: MindMapTreeNode[] = []): MindMapTreeNode {
	return { data: { text }, children };
}

interface Harness {
	pipeline: SavePipeline;
	modify: ReturnType<typeof vi.fn>;
	written: string[];
	onSaveError: ReturnType<typeof vi.fn>;
	setTree(tree: MindMapTreeNode | null): void;
	setFile(file: TFile | null): void;
}

function makeHarness(
	overrides: Partial<Pick<SavePipelineDeps, 'isAutoSave' | 'getFrontmatter'>> = {},
): Harness {
	const written: string[] = [];
	const modify = vi.fn(async (_file: TFile, content: string) => {
		written.push(content);
	});
	const existing = new Set(['a.mindmap.md']);
	const app = Object.assign(new App(), {
		vault: {
			modify,
			getAbstractFileByPath: (path: string) =>
				existing.has(path) ? { path } : null,
		},
	});
	const file = Object.assign(new TFile(), {
		path: 'a.mindmap.md',
		basename: 'a.mindmap',
	});
	let currentFile: TFile | null = file;
	let tree: MindMapTreeNode | null = node('Root', [node('A')]);
	const onSaveError = vi.fn();
	const deps: SavePipelineDeps = {
		app,
		getFile: () => currentFile,
		getSnapshot: () => tree,
		getFrontmatter: () => null,
		isAutoSave: () => true,
		onSaveError,
		...overrides,
	};
	return {
		pipeline: new SavePipeline(deps),
		modify,
		written,
		onSaveError,
		setTree: (t) => {
			tree = t;
		},
		setFile: (f) => {
			currentFile = f;
		},
	};
}

describe('SavePipeline.schedule（防抖自动保存）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('800ms 防抖后自动保存', async () => {
		const h = makeHarness();
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(799);
		expect(h.modify).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('窗口内重复 schedule 重置计时（不叠加保存）', async () => {
		const h = makeHarness();
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(600);
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(600);
		expect(h.modify).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('cancelTimer 取消挂起的保存', async () => {
		const h = makeHarness();
		h.pipeline.schedule();
		h.pipeline.cancelTimer();
		await vi.advanceTimersByTimeAsync(2000);
		expect(h.modify).not.toHaveBeenCalled();
	});

	it('autoSave 关闭时 schedule 不生效，显式 save 仍可用', async () => {
		const h = makeHarness({ isAutoSave: () => false });
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(2000);
		expect(h.modify).not.toHaveBeenCalled();
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('视图无文件时 schedule 不保存', async () => {
		const h = makeHarness();
		h.setFile(null);
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(2000);
		expect(h.modify).not.toHaveBeenCalled();
	});
});

describe('SavePipeline.save（写盘守卫与内容）', () => {
	it('写入内容：frontmatter 拼回文件头 + 大纲 + 尾随换行', async () => {
		const h = makeHarness({
			getFrontmatter: () => '---\ntitle: demo\n---',
		});
		await h.pipeline.save();
		const content = h.written[0];
		expect(content?.startsWith('---\ntitle: demo\n---\n')).toBe(true);
		expect(content?.endsWith('\n')).toBe(true);
		// 渲染层语义：根（中心主题）= 文件名，不入正文；正文只含子级大纲
		expect(content).toContain('A');
		expect(content).not.toContain('Root');
	});

	it('frontmatter 已带尾换行时不重复补换行', async () => {
		const h = makeHarness({
			getFrontmatter: () => '---\ntitle: demo\n---\n',
		});
		await h.pipeline.save();
		expect(h.written[0]?.startsWith('---\ntitle: demo\n---\n')).toBe(true);
		expect(h.written[0]?.includes('---\n\n')).toBe(false);
	});

	it('文件已被删除时不重新保存（防"删两次"）', async () => {
		const h = makeHarness();
		h.setFile(Object.assign(new TFile(), { path: 'gone.mindmap.md' }));
		await h.pipeline.save();
		expect(h.modify).not.toHaveBeenCalled();
	});

	it('引擎快照为 null 时跳过写盘', async () => {
		const h = makeHarness();
		h.setTree(null);
		await h.pipeline.save();
		expect(h.modify).not.toHaveBeenCalled();
	});
});

describe('SavePipeline 写入中再触发（排空语义）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('标记待写并快照最新数据，首次写完后补写最新快照', async () => {
		const h = makeHarness();
		let resolveFirst!: () => void;
		const gate = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		h.modify.mockImplementationOnce(() => gate);

		const first = h.pipeline.save();
		await vi.advanceTimersByTimeAsync(0); // 冲刷微任务：进入写入挂起
		expect(h.modify).toHaveBeenCalledTimes(1);

		// 写入期间编辑树并再次 save → 等待同一排空链（async 包装 promise，
		// 不比标识，比时序：second 在 first 完成后立即完成）
		h.setTree(node('Root', [node('A'), node('B')]));
		const second = h.pipeline.save();

		resolveFirst();
		const order: string[] = [];
		void first.then(() => order.push('first'));
		void second.then(() => order.push('second'));
		await vi.advanceTimersByTimeAsync(0);
		await second;

		expect(order).toEqual(['first', 'second']);
		// 第一次写 + 排空补写，共 2 次；补写内容含最新节点
		expect(h.modify).toHaveBeenCalledTimes(2);
		expect(h.written).toHaveLength(1); // gate 首写不入 written
		expect(h.written[0]).toContain('B');
	});
});

describe('SavePipeline 写盘失败（onSaveError）', () => {
	it('错误上报但不抛出，管线复位后可再次保存', async () => {
		const h = makeHarness();
		h.modify.mockRejectedValueOnce(new Error('disk full'));

		await expect(h.pipeline.save()).resolves.toBeUndefined();
		expect(h.onSaveError).toHaveBeenCalledTimes(1);
		expect(h.onSaveError.mock.calls[0]?.[0]).toBeInstanceOf(Error);

		// saveInProgress 已复位：后续保存正常
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(2);
		expect(h.written).toHaveLength(1);
	});
});
