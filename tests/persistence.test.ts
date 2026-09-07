/**
 * PluginDataWriter 回归测试（persistence.ts）。
 *
 * 覆盖 data.json 写盘语义三契约：
 * - 写前重读合并：写盘前重读宿主最新内容，入参键覆盖、其余键保留
 *   （设置与视图状态两个调用方合并写同一文件时不丢键）；
 * - 串行队列：并发 write 按提交顺序执行，最终内容 = 最后一次写基于
 *   前序写完成后的重读合并结果；
 * - 内部吞错：loadData/saveData 抛错仅 console.error，write 不产生拒绝
 *   （调用方 void 安全）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginDataWriter } from '../src/persistence';
import type { PluginDataHost } from '../src/persistence';

interface HostStub extends PluginDataHost {
	/** 每次 saveData 成功落下的内容快照（按序） */
	readonly saved: unknown[];
	/** 注入故障开关 */
	failSave: boolean;
	failLoad: boolean;
}

/** 宿主桩：内存 data.json（saveData 即落「盘」）*/
function makeHost(initial: Record<string, unknown> = {}): HostStub {
	const disk: Record<string, unknown> = { ...initial };
	const saved: unknown[] = [];
	const stub = {
		saved,
		failSave: false,
		failLoad: false,
	} as HostStub & { failSave: boolean; failLoad: boolean };
	stub.loadData = vi.fn(async () => {
		if (stub.failLoad) {
			throw new Error('load failed');
		}
		return { ...disk };
	});
	stub.saveData = vi.fn(async (data: unknown) => {
		if (stub.failSave) {
			throw new Error('save failed');
		}
		saved.push(data);
		Object.assign(disk, data as Record<string, unknown>);
	});
	return stub;
}

describe('PluginDataWriter（data.json 写盘器）', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('写前重读合并：入参键覆盖，宿主既有键保留', async () => {
		const host = makeHost({ viewState: { a: 1 }, language: 'zh' });
		const writer = new PluginDataWriter(host);
		await writer.write({ viewState: { a: 2 } });
		expect(host.saved[0]).toEqual({ viewState: { a: 2 }, language: 'zh' });
	});

	it('并发 write 串行执行：后写基于前写结果合并，不丢键', async () => {
		const host = makeHost();
		const writer = new PluginDataWriter(host);
		// 不 await，制造并发提交（串行队列应保证顺序与合并不丢）
		const p1 = writer.write({ settings: { autoSave: true } });
		const p2 = writer.write({ viewState: { x: 1 } });
		await Promise.all([p1, p2]);
		expect(host.saved).toHaveLength(2);
		expect(host.saved[0]).toEqual({ settings: { autoSave: true } });
		// 第二次写入时重读到了第一次的 settings → 合并保留
		expect(host.saved[1]).toEqual({
			settings: { autoSave: true },
			viewState: { x: 1 },
		});
	});

	it('loadData 抛错：内部吞错，write 正常 resolve', async () => {
		const host = makeHost();
		host.failLoad = true;
		const writer = new PluginDataWriter(host);
		await expect(writer.write({ a: 1 })).resolves.toBeUndefined();
		expect(host.saved).toHaveLength(0);
		expect(console.error).toHaveBeenCalled();
	});

	it('saveData 抛错：内部吞错，write 正常 resolve', async () => {
		const host = makeHost();
		host.failSave = true;
		const writer = new PluginDataWriter(host);
		await expect(writer.write({ a: 1 })).resolves.toBeUndefined();
		expect(console.error).toHaveBeenCalled();
	});

	it('宿主返回 null（空 data.json）：按空对象合并', async () => {
		const host = makeHost();
		(host.loadData as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			null,
		);
		const writer = new PluginDataWriter(host);
		await writer.write({ a: 1 });
		expect(host.saved[0]).toEqual({ a: 1 });
	});
});
