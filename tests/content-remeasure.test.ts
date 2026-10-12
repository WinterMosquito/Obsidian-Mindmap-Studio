/**
 * 自绘内容「定稿 → 尺寸同步」会话（features/content-remeasure.ts）单元回归。
 *
 * 背景（2026-10-11 外置）：该会话此前内联在 view.ts（约 200 行，6 字段 + 5 方法），
 * 只靠 `verify:visual` 的 inline 探针间接覆盖——本文件把它从 view 拆出后**首次直测**。
 *
 * 三条不变式（与模块文件头一致，这里逐条用行为锁定）：
 * ① 批量合并：同帧多段定稿 → 恰好一次批量重排（`refreshNodesCustomContent` 一次）；
 * ② 解析失败的两条回退顺序：holder 反查 → 产物元素反查（过包含去重）→
 *    渲染窗口暂存重试一次 → 仍失败才告警一次（幂等，防「重排→渲染→再重排」循环）；
 * ③ 生命周期：视图关闭（dispose）取消未决批次并清空已同步集合；字体监听经
 *    host.register 随视图卸载摘除，字体分批就绪时对**已同步**节点再同步。
 *
 * 引擎防腐函数（resolveNodesByDoms / findNodesByContentProducts /
 * refreshNodesCustomContent）以桩替换：它们的契约各有专属测试
 * （find-node-by-dom / engine-refresh-nodes），这里只验证会话的编排逻辑。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import { ContentRemeasureSession } from '../src/features/content-remeasure';

const engine = vi.hoisted(() => ({
	resolveNodesByDoms: vi.fn(),
	findNodesByContentProducts: vi.fn(),
	refreshNodesCustomContent: vi.fn(),
}));

vi.mock('../src/engine/mindmap', () => ({
	resolveNodesByDoms: engine.resolveNodesByDoms,
	findNodesByContentProducts: engine.findNodesByContentProducts,
	refreshNodesCustomContent: engine.refreshNodesCustomContent,
}));

/** holder 与节点桩：对会话而言都是不透明引用（编排逻辑只看身份） */
const holder = (): HTMLElement => ({}) as unknown as HTMLElement;
const node = (uid: string): MindMapNode => ({ uid }) as unknown as MindMapNode;

/** 字体面桩：记录 loadingdone 监听并可手动触发 */
function makeFontSet() {
	const listeners: Array<() => void> = [];
	return {
		fonts: {
			addEventListener: (type: string, listener: () => void): void => {
				if (type === 'loadingdone') {
					listeners.push(listener);
				}
			},
			removeEventListener: (type: string, listener: () => void): void => {
				const index = listeners.indexOf(listener);
				if (index >= 0) {
					listeners.splice(index, 1);
				}
			},
		},
		fire: (): void => {
			for (const listener of [...listeners]) {
				listener();
			}
		},
		listenerCount: (): number => listeners.length,
	};
}

describe('ContentRemeasureSession（自绘内容定稿 → 尺寸同步会话）', () => {
	let map: MindMap | null;
	let cleanups: Array<() => void>;
	let fontSet: ReturnType<typeof makeFontSet>;
	let session: ContentRemeasureSession;

	const makeSession = (): ContentRemeasureSession =>
		new ContentRemeasureSession(
			{
				getMindMap: () => map,
				register: (cleanup) => {
					cleanups.push(cleanup);
				},
			},
			() => fontSet.fonts,
		);

	beforeEach(() => {
		vi.useFakeTimers();
		map = { stub: true } as unknown as MindMap;
		cleanups = [];
		fontSet = makeFontSet();
		session = makeSession();
		engine.resolveNodesByDoms.mockReset();
		engine.findNodesByContentProducts.mockReset();
		engine.refreshNodesCustomContent.mockReset();
	});

	afterEach(() => {
		session.dispose();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('批量合并：同帧三段定稿 → 恰好一次批量重排（resolve 一次、refresh 一次）', () => {
		const n1 = node('n1');
		const n2 = node('n2');
		const n3 = node('n3');
		engine.resolveNodesByDoms.mockReturnValue([n1, n2, n3]);

		session.schedule(holder());
		session.schedule(holder());
		session.schedule(holder());
		vi.advanceTimersByTime(0);

		expect(engine.resolveNodesByDoms).toHaveBeenCalledTimes(1);
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [
			n1,
			n2,
			n3,
		]);
	});

	it('批次窗口内引擎已销毁（getMindMap → null）：静默结束，不反查不重排不告警', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		session.schedule(holder());
		map = null;

		vi.advanceTimersByTime(0);

		expect(engine.resolveNodesByDoms).not.toHaveBeenCalled();
		expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('解析部分失败：命中者重排，失败者走产物反查回退（过包含去重，不重复重排）', () => {
		const n1 = node('n1');
		const nFallback = node('fallback');
		engine.resolveNodesByDoms.mockReturnValue([n1, null]);
		// 产物兜底是「过包含」的：返回 n1（已在集合，须跳过）与 nFallback
		engine.findNodesByContentProducts.mockReturnValue([n1, nFallback]);

		session.schedule(holder());
		session.schedule(holder());
		vi.advanceTimersByTime(0);

		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [
			n1,
			nFallback,
		]);
	});

	it('渲染窗口（K104）：全落空先暂存不告警；retry 后仍全空才告警一次且不重排', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		engine.resolveNodesByDoms.mockReturnValue([null]);
		engine.findNodesByContentProducts.mockReturnValue([]);

		session.schedule(holder());
		vi.advanceTimersByTime(0);
		expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();

		// node_tree_render_end → 重试：root 已回填但仍解析不到（真异常）→ 告警一次
		session.retryDeferred();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain('MindMap Studio：');
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain('未能定位归属节点');
		expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();

		// 只重试一次：再触发 retry 无暂存可重试，不重复告警（防重排循环）
		session.retryDeferred();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});

	it('暂存被后续成功批次清空：不再重试、不再告警', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// 第一批全落空 → 暂存
		engine.resolveNodesByDoms.mockReturnValue([null]);
		engine.findNodesByContentProducts.mockReturnValue([]);
		session.schedule(holder());
		vi.advanceTimersByTime(0);

		// 第二批命中（真实场景：渲染完成后再定稿/再次编辑）
		const n1 = node('n1');
		engine.resolveNodesByDoms.mockReturnValue([n1]);
		session.schedule(holder());
		vi.advanceTimersByTime(0);
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);

		// 暂存已被成功批次清掉：retry 是 no-op
		session.retryDeferred();
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('字体分批就绪：监听只装一次；每次触发对「已同步」节点再同步一次', () => {
		const n1 = node('n1');
		engine.resolveNodesByDoms.mockReturnValue([n1]);
		session.schedule(holder());
		vi.advanceTimersByTime(0);
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);

		// 首个 schedule 已装钩子；后续 schedule 不重复装
		session.schedule(holder());
		expect(fontSet.listenerCount()).toBe(1);
		// 清理回调经 host.register 登记（随视图卸载摘除）
		expect(cleanups).toHaveLength(1);

		// 字体第二批就绪 → 对已同步节点再同步（引擎为当前实例）
		fontSet.fire();
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(2);
		expect(engine.refreshNodesCustomContent).toHaveBeenLastCalledWith(map, [
			n1,
		]);

		// 已同步集合为空时（如引擎重建后）再触发：不重排
		session.resetNodes();
		fontSet.fire();
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(2);
	});

	it('resetNodes：清空已同步集合（引擎重建后旧节点引用不可持有）', () => {
		const n1 = node('n1');
		engine.resolveNodesByDoms.mockReturnValue([n1]);
		session.schedule(holder());
		vi.advanceTimersByTime(0);
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);

		session.resetNodes();
		fontSet.fire();
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);
	});

	it('dispose：取消未决批次（不再 flush）、清空已同步集合、幂等', () => {
		const n1 = node('n1');
		engine.resolveNodesByDoms.mockReturnValue([n1]);
		session.schedule(holder());
		session.dispose();

		vi.advanceTimersByTime(0);
		expect(engine.resolveNodesByDoms).not.toHaveBeenCalled();
		expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();

		// 幂等：重复 dispose 不抛错、无副作用
		expect(() => session.dispose()).not.toThrow();
	});

	it('host.register 的清理回调摘除字体监听（随视图卸载）', () => {
		engine.resolveNodesByDoms.mockReturnValue([node('n1')]);
		session.schedule(holder());
		vi.advanceTimersByTime(0);
		expect(fontSet.listenerCount()).toBe(1);

		for (const cleanup of cleanups) {
			cleanup();
		}
		expect(fontSet.listenerCount()).toBe(0);
		// 监听已摘除：字体再就绪也不触发任何重排
		fontSet.fire();
		expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);
	});
});
