/**
 * SavePipeline 回归（src/services/document-service.ts）。
 *
 * 覆盖保存管线的竞态与守卫（审查报告点名的 P0 场景）：
 * - 写入进行中再次触发保存 → 标记待写 + 立即快照，排空后补写最新快照
 *   （视图卸载时引擎可能随即销毁，晚快照就晚了）；
 * - 排空循环中快照不可得（引擎已销毁）→ 回落到 pendingTree 兜底快照；
 * - 写盘失败经 onSaveError 上报、不抛出、状态复位（不沿错误链继续排空）；
 * - 防抖调度 / cancelTimer、autoSave 开关、无文件与文件已删除守卫、frontmatter 拼接。
 *
 * 桩：App.vault 只提供管线实际使用的两个方法（getFileByPath 存在性检查、
 * modify 写盘）；App/TFile 取 tests/mocks/obsidian.ts 的类，保证 instanceof 成立。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import {
	SavePipeline,
	type SavePipelineDeps,
} from '../src/services/document-service';
import { AUTO_SAVE_DEBOUNCE_MS } from '../src/constants';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

const FILE_PATH = 'notes/a.mindmap.md';

/** 构造引擎树节点（无 mdRaw → 走合成序列化路径，正文即 "- 文本"） */
function node(text: string, children: MindMapTreeNode[] = []): MindMapTreeNode {
	return { data: { text }, children };
}

/** 手动 deferred：竞态用例要能精确卡住某一次写盘并决定其成败 */
function deferred(): {
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
} {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function flushMicrotasks(times = 6): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

interface Harness {
	pipeline: SavePipeline;
	/** vault.modify 调用记录（入参含目标文件） */
	modify: ReturnType<typeof vi.fn>;
	/** 每次 modify 被调用当下记录的正文（按序） */
	written: string[];
	onSaveError: ReturnType<typeof vi.fn>;
	file: TFile;
	setTree(tree: MindMapTreeNode | null): void;
	setFile(file: TFile | null): void;
	/** 文件是否仍在库中（删除守卫用例） */
	setExists(exists: boolean): void;
	/** 让接下来 count 次写盘挂起（未决 Promise），由 release/fail 控制 */
	gate(count: number): void;
	release(index: number): void;
	fail(index: number, error: unknown): void;
}

function makeHarness(
	overrides: Partial<Pick<SavePipelineDeps, 'isAutoSave' | 'getFrontmatter'>> = {},
): Harness {
	const written: string[] = [];
	const gates: ReturnType<typeof deferred>[] = [];
	let gatedCalls = 0;

	const file = Object.assign(new TFile(), {
		path: FILE_PATH,
		basename: 'a.mindmap',
	});
	let currentFile: TFile | null = file;
	let tree: MindMapTreeNode | null = node('Root', [node('A')]);
	const existing = new Set([FILE_PATH]);

	const modify = vi.fn((_file: TFile, content: string): Promise<void> => {
		written.push(content);
		if (gatedCalls <= 0) {
			return Promise.resolve();
		}
		gatedCalls--;
		const gate = deferred();
		gates.push(gate);
		return gate.promise;
	});

	const app = Object.assign(new App(), {
		vault: {
			modify,
			// 模块用官方推荐的类型化 getter 做存在性守卫（删除后不重建文件）
			getFileByPath: (path: string) => (existing.has(path) ? file : null),
		},
	});

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
		file,
		setTree: (t) => {
			tree = t;
		},
		setFile: (f) => {
			currentFile = f;
		},
		setExists: (exists) => {
			if (exists) {
				existing.add(FILE_PATH);
			} else {
				existing.clear();
			}
		},
		gate: (count) => {
			gatedCalls = count;
		},
		release: (index) => {
			gates[index]?.resolve();
		},
		fail: (index, error) => {
			gates[index]?.reject(error);
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

	it('防抖窗口（AUTO_SAVE_DEBOUNCE_MS）到期后自动写盘一次', async () => {
		const h = makeHarness();
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 1);
		expect(h.modify).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(h.modify).toHaveBeenCalledTimes(1);
		// 写盘目标是视图当前文件本身，内容是当前树的序列化结果
		expect(h.modify.mock.calls[0]?.[0]).toBe(h.file);
		expect(h.written[0]).toBe('- A\n');
	});

	it('窗口内重复 schedule 重置计时，只落盘一次', async () => {
		const h = makeHarness();
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(600);
		h.pipeline.schedule(); // 重置窗口
		await vi.advanceTimersByTimeAsync(600);
		// 距首次已 1200ms，但窗口被重置 → 仍未写盘
		expect(h.modify).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 600);
		expect(h.modify).toHaveBeenCalledTimes(1);
		// 已排空：再推进时间不重复写盘
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('cancelTimer 取消挂起的自动保存（文件切换/视图关闭路径）', async () => {
		const h = makeHarness();
		h.pipeline.schedule();
		h.pipeline.cancelTimer();
		await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 3);
		expect(h.modify).not.toHaveBeenCalled();

		// 取消后仍可重新调度（取消只丢弃未决任务，不废弃实例）
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('autoSave 关闭时 schedule 不生效，显式 save 仍可用', async () => {
		const h = makeHarness({ isAutoSave: () => false });
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2);
		expect(h.modify).not.toHaveBeenCalled();

		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('视图无当前文件时 schedule 不保存', async () => {
		const h = makeHarness();
		h.setFile(null);
		h.pipeline.schedule();
		await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2);
		expect(h.modify).not.toHaveBeenCalled();
	});
});

describe('SavePipeline.save（写盘内容与守卫）', () => {
	it('正文 = frontmatter + 大纲 + 尾随换行；根文本（中心主题=文件名）不入正文', async () => {
		const h = makeHarness({
			getFrontmatter: () => '---\ntitle: demo\n---',
		});
		h.setTree(node('Root', [node('A', [node('A1')])]));

		await h.pipeline.save();

		expect(h.written).toEqual(['---\ntitle: demo\n---\n- A\n  - A1\n']);
		expect(h.written[0]).not.toContain('Root');
	});

	it('frontmatter 自带尾换行时不重复补换行', async () => {
		const h = makeHarness({
			getFrontmatter: () => '---\ntitle: demo\n---\n',
		});
		await h.pipeline.save();
		expect(h.written[0]).toBe('---\ntitle: demo\n---\n- A\n');
		expect(h.written[0]).not.toContain('---\n\n');
	});

	it('无 frontmatter 时只写大纲', async () => {
		const h = makeHarness();
		await h.pipeline.save();
		expect(h.written[0]).toBe('- A\n');
	});

	it('空树（根无子节点）写出的正文仅剩 frontmatter，仍保证尾随换行', async () => {
		const h = makeHarness({ getFrontmatter: () => '---\nx: 1\n---' });
		h.setTree(node('Root'));
		await h.pipeline.save();
		expect(h.written[0]).toBe('---\nx: 1\n---\n');
	});

	it('文件已被删除（getFileByPath 为 null）时不重新写盘，避免"删两次"', async () => {
		const h = makeHarness();
		h.setExists(false);
		await h.pipeline.save();
		expect(h.modify).not.toHaveBeenCalled();
	});

	it('视图无文件时 save 直接返回，不写盘', async () => {
		const h = makeHarness();
		h.setFile(null);
		await expect(h.pipeline.save()).resolves.toBeUndefined();
		expect(h.modify).not.toHaveBeenCalled();
	});

	it('引擎快照为 null 时跳过写盘，且管线状态复位（不卡死）', async () => {
		const h = makeHarness();
		h.setTree(null);
		await h.pipeline.save();
		expect(h.modify).not.toHaveBeenCalled();

		// 快照恢复后仍能保存（saveInProgress 已在 finally 中复位）
		h.setTree(node('Root', [node('B')]));
		await h.pipeline.save();
		expect(h.written).toEqual(['- B\n']);
	});
});

describe('SavePipeline 写入中再次触发（排空语义）', () => {
	it('写入中再触发不重复入队，补写最新快照后两个调用一起完成', async () => {
		const h = makeHarness();
		h.gate(2);
		const first = h.pipeline.save();
		await flushMicrotasks();
		expect(h.modify).toHaveBeenCalledTimes(1);

		// 写入期间编辑树并再次触发
		h.setTree(node('Root', [node('A'), node('B')]));
		const second = h.pipeline.save();
		await flushMicrotasks();
		// 第二次调用不得立刻再写盘（尾部执行由排空循环负责）
		expect(h.modify).toHaveBeenCalledTimes(1);

		const order: string[] = [];
		void first.then(() => order.push('first'));
		void second.then(() => order.push('second'));

		h.release(0);
		await flushMicrotasks();
		// 首写完成后立刻补写最新快照（新增的 B 已在正文里）
		expect(h.modify).toHaveBeenCalledTimes(2);
		expect(h.written).toEqual(['- A\n', '- A\n- B\n']);

		h.release(1);
		await Promise.all([first, second]);
		// 两个 promise 都在排空结束后才完成（第二次调用不早退）
		expect(order).toEqual(['first', 'second']);
	});

	it('连续两轮排空：写入中再次编辑再触发，逐轮补写当时的最新快照', async () => {
		const h = makeHarness();
		h.gate(3);
		const first = h.pipeline.save();
		await flushMicrotasks();
		expect(h.written).toEqual(['- A\n']);

		// 第一轮写入期间触发 → 待写快照 = B
		h.setTree(node('Root', [node('B')]));
		const second = h.pipeline.save();
		await flushMicrotasks();

		h.release(0);
		await flushMicrotasks();
		expect(h.written).toEqual(['- A\n', '- B\n']);

		// 第二轮写入仍在途时再次编辑并触发 → 第三轮写最新快照 C
		h.setTree(node('Root', [node('C')]));
		const third = h.pipeline.save();
		await flushMicrotasks();
		expect(h.modify).toHaveBeenCalledTimes(2);

		h.release(1);
		await flushMicrotasks();
		expect(h.written).toEqual(['- A\n', '- B\n', '- C\n']);

		h.release(2);
		await Promise.all([first, second, third]);
		expect(h.modify).toHaveBeenCalledTimes(3);
	});

	it('排空时引擎已销毁（快照为 null）：回落到 pendingTree 兜底快照，最后编辑不丢', async () => {
		const h = makeHarness();
		h.gate(2);
		const first = h.pipeline.save();
		await flushMicrotasks();
		expect(h.modify).toHaveBeenCalledTimes(1);

		// 写入期间产生新编辑（此刻快照可得 → 立即快照），随后引擎被销毁
		h.setTree(node('Root', [node('最后编辑')]));
		void h.pipeline.save();
		await flushMicrotasks();
		h.setTree(null);

		h.release(0);
		await flushMicrotasks();

		expect(h.modify).toHaveBeenCalledTimes(2);
		expect(h.written[1]).toBe('- 最后编辑\n');

		h.release(1);
		await first;
	});

	it('写入完成时无待写标记 → 不产生多余的补写', async () => {
		const h = makeHarness();
		h.gate(1);
		const first = h.pipeline.save();
		await flushMicrotasks();
		h.release(0);
		await first;

		expect(h.modify).toHaveBeenCalledTimes(1);
		// 排空后 saveInProgress/待写标记均已复位：下一次 save 立即正常入队
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(2);
		expect(h.written).toEqual(['- A\n', '- A\n']);
	});
});

describe('SavePipeline 写盘失败（onSaveError）', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('失败经 onSaveError 上报且不抛出；状态复位后仍可再次保存', async () => {
		const h = makeHarness();
		const boom = new Error('disk full');
		h.modify.mockRejectedValueOnce(boom);

		await expect(h.pipeline.save()).resolves.toBeUndefined();
		expect(h.onSaveError).toHaveBeenCalledTimes(1);
		expect(h.onSaveError).toHaveBeenCalledWith(boom);
		// 管线自身仍打日志（通知之外留一条可排查的痕迹）
		expect(console.error).toHaveBeenCalledWith('保存思维导图失败', boom);

		// saveInProgress 已复位 → 重试从头再来
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(2);
		expect(h.written).toEqual(['- A\n']);
	});

	it('失败时清空待写状态：不沿错误链补写陈旧快照', async () => {
		const h = makeHarness();
		h.gate(1);
		const first = h.pipeline.save();
		await flushMicrotasks();

		// 失败写入期间还发生了编辑（已标记待写并快照）→ 失败必须连待写标记一起复位
		h.setTree(node('Root', [node('新编辑')]));
		void h.pipeline.save();
		await flushMicrotasks();

		const boom = new Error('disk full');
		h.fail(0, boom);
		await first;

		expect(h.onSaveError).toHaveBeenCalledTimes(1);
		expect(h.modify).toHaveBeenCalledTimes(1); // 不重试、不补写

		// 引擎随后销毁：若 pendingTree 未清空，这里会写出陈旧快照
		h.setTree(null);
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('排空循环中途失败：上报一次并终止循环，之后可正常再保存', async () => {
		const h = makeHarness();
		h.gate(2);
		const first = h.pipeline.save();
		await flushMicrotasks();

		h.setTree(node('Root', [node('B')]));
		void h.pipeline.save();
		await flushMicrotasks();

		// 首写成功放行 → 循环补写第二次，第二次失败
		h.release(0);
		await flushMicrotasks();
		expect(h.modify).toHaveBeenCalledTimes(2);

		const boom = new Error('second write failed');
		h.fail(1, boom);
		await first;

		expect(h.onSaveError).toHaveBeenCalledTimes(1);
		expect(h.onSaveError).toHaveBeenCalledWith(boom);
		expect(h.modify).toHaveBeenCalledTimes(2); // 失败即终止循环，不反复重试

		// 管线未被错误链卡住：新的编辑照常落盘
		h.setTree(node('Root', [node('恢复')]));
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(3);
		expect(h.written[2]).toBe('- 恢复\n');
	});
});
