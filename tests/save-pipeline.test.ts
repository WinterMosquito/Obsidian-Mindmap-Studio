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
	/** 每次写盘的「目标文件 + 正文」（跨文件用例断言写盘归属） */
	writes: { path: string; content: string }[];
	onSaveError: ReturnType<typeof vi.fn>;
	file: TFile;
	setTree(tree: MindMapTreeNode | null): void;
	setFile(file: TFile | null): void;
	/** 按文件键设置 frontmatter（视图侧 frontmatterByPath 的等价物） */
	setFrontmatter(path: string, value: string | null): void;
	/** 注册第二个文件（文件切换用例） */
	addFile(path: string): TFile;
	/** 文件是否仍在库中（删除守卫用例） */
	setExists(exists: boolean): void;
	/** 让接下来 count 次写盘挂起（未决 Promise），由 release/fail 控制 */
	gate(count: number): void;
	release(index: number): void;
	fail(index: number, error: unknown): void;
}

function makeHarness(
	overrides: Partial<
		Pick<SavePipelineDeps, 'isAutoSave' | 'getFrontmatterFor'>
	> = {},
	/**
	 * vault 上的可选追加成员：仅「无差异写盘跳过」用例需要 `cachedRead`。
	 * 缺省不挂载——SavePipeline 读到 undefined 即退化为照常写盘，
	 * 既有用例（断言每次 save 必写盘）语义不受影响。
	 */
	vaultExtras: { cachedRead?: (target: TFile) => Promise<string> } = {},
): Harness {
	const written: string[] = [];
	const writes: { path: string; content: string }[] = [];
	const gates: ReturnType<typeof deferred>[] = [];
	let gatedCalls = 0;

	const file = Object.assign(new TFile(), {
		path: FILE_PATH,
		basename: 'a.mindmap',
	});
	let currentFile: TFile | null = file;
	/** 每个文件各自的树快照（引擎同一时刻只持有一份 → 非当前文件取到 null） */
	const trees = new Map<string, MindMapTreeNode | null>([
		[FILE_PATH, node('Root', [node('A')])],
	]);
	/** 每个文件各自的 frontmatter（视图侧 frontmatterByPath 的等价物） */
	const frontmatters = new Map<string, string | null>();
	const paths = new Map<string, TFile>([[FILE_PATH, file]]);

	const modify = vi.fn((target: TFile, content: string): Promise<void> => {
		written.push(content);
		writes.push({ path: target.path, content });
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
			getFileByPath: (path: string) => paths.get(path) ?? null,
			...vaultExtras,
		},
	});

	const onSaveError = vi.fn();
	const deps: SavePipelineDeps = {
		app,
		getFile: () => currentFile,
		// 归属语义与 view.ts 一致：引擎只持有**当前文件**的树，别的文件取到 null
		getSnapshotFor: (f) =>
			currentFile?.path === f.path ? (trees.get(f.path) ?? null) : null,
		getFrontmatterFor: (f) => frontmatters.get(f.path) ?? null,
		isAutoSave: () => true,
		onSaveError,
		...overrides,
	};

	return {
		pipeline: new SavePipeline(deps),
		modify,
		written,
		writes,
		onSaveError,
		file,
		setTree: (t) => {
			if (currentFile) {
				trees.set(currentFile.path, t);
			}
		},
		setFile: (f) => {
			currentFile = f;
		},
		setFrontmatter: (path, value) => {
			frontmatters.set(path, value);
		},
		addFile: (path) => {
			const added = Object.assign(new TFile(), { path, basename: path });
			paths.set(path, added);
			return added;
		},
		setExists: (exists) => {
			if (exists) {
				paths.set(FILE_PATH, file);
			} else {
				paths.delete(FILE_PATH);
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
			getFrontmatterFor: () => '---\ntitle: demo\n---',
		});
		h.setTree(node('Root', [node('A', [node('A1')])]));

		await h.pipeline.save();

		expect(h.written).toEqual(['---\ntitle: demo\n---\n- A\n  - A1\n']);
		expect(h.written[0]).not.toContain('Root');
	});

	it('frontmatter 自带尾换行时不重复补换行', async () => {
		const h = makeHarness({
			getFrontmatterFor: () => '---\ntitle: demo\n---\n',
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
		const h = makeHarness({ getFrontmatterFor: () => '---\nx: 1\n---' });
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

/**
 * 写盘归属（P0 回归）：core 切换 FileView 的文件时**不 await** onUnloadFile，
 * 故 await 期间 `getFile()`/引擎都可能已交班给新文件。管线必须保证
 * 「一次写盘的目标文件与其内容属于同一个文件」——否则新文档正文会被写进旧文件、
 * 旧文件会丢掉自己的 frontmatter。桩里的 getSnapshotFor/getFrontmatterFor 与
 * view.ts 同语义（引擎只持有当前文件的树；frontmatter 按文件键取）。
 */
describe('SavePipeline 写盘归属（换文件期间的排空）', () => {
	const B_PATH = 'notes/b.mindmap.md';

	it('排空期间卸载旧文件：只写旧文件自己的内容，绝不写入新文件的树', async () => {
		const h = makeHarness();
		h.gate(2);
		const first = h.pipeline.save(); // A 首写（挂起）
		await flushMicrotasks();
		expect(h.written).toEqual(['- A\n']);

		// 换文件：this.file 与引擎都已交班给 B（getSnapshotFor(A) 随即为 null）
		const b = h.addFile(B_PATH);
		h.setFile(b);
		h.setTree(node('Root', [node('B-child')]));

		// 卸载 A：显式传入 A 与**同步抓取**的 A 树快照
		const unload = h.pipeline.save(h.file, node('Root', [node('A-child')]));
		await flushMicrotasks();
		// 同一文件的写入中再触发 → 并入本轮排空，不新增写盘
		expect(h.modify).toHaveBeenCalledTimes(1);

		h.release(0);
		await flushMicrotasks();

		// 两趟都落在 A：首写原文 + 兜底快照补写；B 的内容从未落到 A
		expect(h.writes).toEqual([
			{ path: FILE_PATH, content: '- A\n' },
			{ path: FILE_PATH, content: '- A-child\n' },
		]);
		expect(h.written.some((content) => content.includes('B-child'))).toBe(
			false,
		);

		h.release(1);
		await Promise.all([first, unload]);
	});

	it('排空期间另存新文件：独立排队，各自只写自己的内容', async () => {
		const h = makeHarness();
		h.gate(2);
		const first = h.pipeline.save(); // A 首写（挂起）
		await flushMicrotasks();

		const b = h.addFile(B_PATH);
		h.setFile(b);
		h.setTree(node('Root', [node('B-child')]));
		const second = h.pipeline.save(); // 目标 = 当前文件 B
		await flushMicrotasks();
		// 不并入 A 那一轮：此刻仍只有 A 的首写
		expect(h.modify).toHaveBeenCalledTimes(1);

		h.release(0);
		await flushMicrotasks();
		// A 的一轮收尾后 B 才入队（B 取自己的当前快照）
		expect(h.writes).toEqual([
			{ path: FILE_PATH, content: '- A\n' },
			{ path: B_PATH, content: '- B-child\n' },
		]);

		h.release(1);
		await Promise.all([first, second]);
		expect(h.modify).toHaveBeenCalledTimes(2);
	});

	it('卸载旧文件时引擎已交班且无兜底快照：宁可少写，也不写错文件', async () => {
		const h = makeHarness();
		const b = h.addFile(B_PATH);
		h.setFile(b);
		h.setTree(node('Root', [node('B-child')]));

		await h.pipeline.save(h.file); // 目标 A，但引擎已无 A、也无兜底快照
		expect(h.modify).not.toHaveBeenCalled();
	});

	it('frontmatter 按文件取：排空期换文件不会把新文件头拼进旧文件', async () => {
		const h = makeHarness();
		h.setFrontmatter(FILE_PATH, '---\ntitle: A\n---');
		h.gate(2);
		const first = h.pipeline.save(); // A 首写（已带 A 的文件头）
		await flushMicrotasks();

		const b = h.addFile(B_PATH);
		h.setFrontmatter(B_PATH, '---\ntitle: B\n---');
		h.setFile(b);
		h.setTree(node('Root', [node('B-child')]));

		const unload = h.pipeline.save(h.file, node('Root', [node('A-child')]));
		h.release(0);
		await flushMicrotasks();

		expect(h.writes[1]).toEqual({
			path: FILE_PATH,
			content: '---\ntitle: A\n---\n- A-child\n',
		});
		expect(h.written.some((content) => content.includes('title: B'))).toBe(
			false,
		);

		h.release(1);
		await Promise.all([first, unload]);
	});
});

describe('SavePipeline.save（无差异写盘跳过）', () => {
	it('文件当前内容与将要写入的内容一致时不写盘（mtime/元数据缓存零惊动）', async () => {
		// 典型场景：「自动整理」只清拖拽坐标，Markdown 文本一字未变
		const cachedRead = vi.fn(async () => '- A\n');
		const h = makeHarness({}, { cachedRead });

		await h.pipeline.save();

		expect(cachedRead).toHaveBeenCalledWith(h.file);
		expect(h.modify).not.toHaveBeenCalled();
		expect(h.onSaveError).not.toHaveBeenCalled();
	});

	it('文件当前内容不同（首次写入 / 外部改动）时照常写盘', async () => {
		const cachedRead = vi.fn(async () => '- 旧内容\n');
		const h = makeHarness({}, { cachedRead });

		await h.pipeline.save();

		expect(h.modify).toHaveBeenCalledTimes(1);
		expect(h.written[0]).toBe('- A\n');
	});

	it('cachedRead 抛错时回退写盘（fail-open：绝不因读失败而丢写）', async () => {
		const cachedRead = vi.fn(async () => {
			throw new Error('读取失败');
		});
		const h = makeHarness({}, { cachedRead });

		await h.pipeline.save();

		expect(h.modify).toHaveBeenCalledTimes(1);
		expect(h.onSaveError).not.toHaveBeenCalled();
	});

	it('无 cachedRead（老运行时/桩环境）时照常写盘', async () => {
		const h = makeHarness();

		await h.pipeline.save();

		expect(h.modify).toHaveBeenCalledTimes(1);
	});

	it('跳过写盘后管线状态复位：内容随后变化仍能正常写盘', async () => {
		let content = '- A\n';
		const cachedRead = vi.fn(async () => content);
		const h = makeHarness({}, { cachedRead });

		await h.pipeline.save();
		expect(h.modify).not.toHaveBeenCalled();

		content = '- 旧版本\n';
		await h.pipeline.save();
		expect(h.modify).toHaveBeenCalledTimes(1);
		expect(h.written[0]).toBe('- A\n');
	});
});
