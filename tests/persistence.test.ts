/**
 * PluginDataWriter 回归（src/persistence.ts）。
 *
 * data.json 写入器承载三条契约，缺一即出现"设置丢失/视图状态被覆盖/未处理拒绝"：
 * - 写前重读合并：每次写盘前重新读宿主最新内容再合并（{...current, ...data}），
 *   设置与视图状态两个调用方先后写同一文件时不互相抹掉对方的键；
 * - 串行队列：并发 write 严格排队，后写的"重读"发生在前写的 saveData 之后
 *   （否则两个 read-modify-write 交错，后写基于陈旧快照覆盖前写）；
 * - 内部吞错：loadData/saveData 抛错只走 onError（缺省 console.error），
 *   write 自身不拒绝——调用方普遍 `void writer.write(...)`，拒绝会变成未处理拒绝。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginDataWriter } from '../src/persistence';
import type { PluginDataHost } from '../src/persistence';

interface HostHarness {
	host: PluginDataHost;
	/** 内存 data.json 的当前内容 */
	disk: Record<string, unknown>;
	/** 每次成功 saveData 落下的载荷（按序） */
	saved: Record<string, unknown>[];
	loadData: ReturnType<typeof vi.fn>;
	saveData: ReturnType<typeof vi.fn>;
	/** 故障注入开关 */
	fail: { load: boolean; save: boolean };
}

/** 宿主桩：saveData 即落「盘」（内存），loadData 返回当前盘内容的新副本 */
function makeHost(initial: Record<string, unknown> = {}): HostHarness {
	const disk: Record<string, unknown> = { ...initial };
	const saved: Record<string, unknown>[] = [];
	const fail = { load: false, save: false };
	const loadData = vi.fn(async (): Promise<unknown> => {
		if (fail.load) {
			throw new Error('load failed');
		}
		// 返回副本：调用方若就地改动不应污染"盘"
		return { ...disk };
	});
	const saveData = vi.fn(async (data: unknown): Promise<void> => {
		if (fail.save) {
			throw new Error('save failed');
		}
		const payload = data as Record<string, unknown>;
		saved.push(payload);
		Object.assign(disk, payload);
	});
	return { host: { loadData, saveData }, disk, saved, loadData, saveData, fail };
}

/** 手动 deferred：串行化断言需要「先卡住第一次写盘，再验证第二次未开始」 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

async function flushMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

describe('PluginDataWriter（data.json 写盘器）', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('写前重读合并：入参键覆盖同名键，宿主既有键保留', async () => {
		const h = makeHost({ viewState: { 'a.mindmap.md': { layout: 'x' } }, language: 'zh' });
		const writer = new PluginDataWriter(h.host);

		await expect(writer.write({ viewState: { 'b.mindmap.md': {} } })).resolves
			.toBeUndefined();

		expect(h.saved).toHaveLength(1);
		expect(h.saved[0]).toEqual({
			viewState: { 'b.mindmap.md': {} },
			language: 'zh',
		});
		// 合并结果也回落到「盘」上：磁盘内容与载荷一致
		expect(h.disk).toEqual(h.saved[0]);
		// 顺序契约：先读后写（先写后读会把本次载荷吞掉）
		expect(h.loadData.mock.invocationCallOrder[0]).toBeLessThan(
			h.saveData.mock.invocationCallOrder[0]!,
		);
	});

	it('每次 write 都重新读取，不复用上次快照', async () => {
		const h = makeHost({ language: 'zh' });
		const writer = new PluginDataWriter(h.host);

		await writer.write({ exportScale: 2 });
		// 外部（另一实例/手工编辑）在此期间改了盘内容
		h.disk['defaultTheme'] = 'dark';
		await writer.write({ exportScale: 3 });

		expect(h.loadData).toHaveBeenCalledTimes(2);
		// 若复用上次快照，第二次载荷会丢掉外部写入的 defaultTheme
		expect(h.saved[1]).toEqual({
			language: 'zh',
			defaultTheme: 'dark',
			exportScale: 3,
		});
	});

	it('并发 write 严格串行：第二次重读发生在前一次落盘之后', async () => {
		const h = makeHost();
		const writer = new PluginDataWriter(h.host);
		const gate = deferred();
		h.saveData.mockImplementationOnce(async (data: unknown) => {
			await gate.promise;
			h.saved.push(data as Record<string, unknown>);
			Object.assign(h.disk, data as Record<string, unknown>);
		});

		const first = writer.write({ settings: { autoSave: true } });
		const second = writer.write({ viewState: { 'a.mindmap.md': {} } });
		await flushMicrotasks();

		// 第一次仍在途 → 第二次连"重读"都不该发生（队列而非并发）
		expect(h.loadData).toHaveBeenCalledTimes(1);
		expect(h.saveData).toHaveBeenCalledTimes(1);

		gate.resolve();
		await Promise.all([first, second]);

		expect(h.loadData).toHaveBeenCalledTimes(2);
		expect(h.saveData).toHaveBeenCalledTimes(2);
		// 后写基于前写结果合并 → settings 不丢
		expect(h.saved[1]).toEqual({
			settings: { autoSave: true },
			viewState: { 'a.mindmap.md': {} },
		});
		// 全序：load1 < save1 < load2 < save2
		const [load1, load2] = h.loadData.mock.invocationCallOrder;
		const [save1, save2] = h.saveData.mock.invocationCallOrder;
		expect(load1! < save1! && save1! < load2! && load2! < save2!).toBe(true);
	});

	it('宿主返回 null（空 data.json）时按空对象合并', async () => {
		const h = makeHost();
		h.loadData.mockResolvedValueOnce(null);
		const writer = new PluginDataWriter(h.host);

		await writer.write({ language: 'en' });

		expect(h.saved[0]).toEqual({ language: 'en' });
	});

	it('loadData 抛错：缺省仅 console.error，write 正常 resolve 且不写盘', async () => {
		const h = makeHost({ language: 'zh' });
		h.fail.load = true;
		const writer = new PluginDataWriter(h.host);

		await expect(writer.write({ language: 'en' })).resolves.toBeUndefined();

		expect(h.saveData).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalledWith(
			'写入插件配置失败',
			expect.any(Error),
		);
	});

	it('saveData 抛错：写入被吞掉，磁盘保持原内容', async () => {
		const h = makeHost({ language: 'zh' });
		h.fail.save = true;
		const writer = new PluginDataWriter(h.host);

		await expect(writer.write({ language: 'en' })).resolves.toBeUndefined();

		expect(h.saved).toHaveLength(0);
		expect(h.disk).toEqual({ language: 'zh' });
		expect(console.error).toHaveBeenCalledTimes(1);
	});

	it('注入 onError 时由其接管（console.error 不再介入），错误对象原样透传', async () => {
		const h = makeHost();
		const boom = new Error('save failed');
		h.saveData.mockRejectedValueOnce(boom);
		const onError = vi.fn();
		const writer = new PluginDataWriter(h.host, { onError });

		await expect(writer.write({ a: 1 })).resolves.toBeUndefined();

		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(boom);
		// 调用方已决定如何提示（NotifyError），不得再叠一份 console 噪音
		expect(console.error).not.toHaveBeenCalled();
	});

	it('一次写入失败不阻断队列：后续 write 照常落盘', async () => {
		const h = makeHost();
		h.fail.save = true;
		const writer = new PluginDataWriter(h.host);

		await writer.write({ first: 1 });
		expect(h.saved).toHaveLength(0);

		h.fail.save = false;
		await writer.write({ second: 2 });

		expect(h.saved).toEqual([{ second: 2 }]);
	});

	it('load 失败后队列继续推进（写前重读失败不构成断链）', async () => {
		const h = makeHost({ language: 'zh' });
		h.fail.load = true;
		const writer = new PluginDataWriter(h.host);

		await writer.write({ first: 1 });
		h.fail.load = false;
		await writer.write({ second: 2 });

		expect(h.saved).toEqual([{ language: 'zh', second: 2 }]);
	});
});
