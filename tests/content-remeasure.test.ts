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
	isNodeCollapsed: vi.fn(),
}));

vi.mock('../src/engine/mindmap', () => ({
	resolveNodesByDoms: engine.resolveNodesByDoms,
	findNodesByContentProducts: engine.findNodesByContentProducts,
	refreshNodesCustomContent: engine.refreshNodesCustomContent,
	isNodeCollapsed: engine.isNodeCollapsed,
}));

/** 平台层（未定稿修复 / 登记面清理）：本套件只验证会话的**调用编排** */
const platform = vi.hoisted(() => ({
	repairUnsettledMath: vi.fn(),
	clearUnsettledMath: vi.fn(),
	pruneUnsettledMathOwnedBy: vi.fn(),
}));

vi.mock('../src/platform/math-jax', () => ({
	repairUnsettledMath: platform.repairUnsettledMath,
	clearUnsettledMath: platform.clearUnsettledMath,
	pruneUnsettledMathOwnedBy: platform.pruneUnsettledMathOwnedBy,
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
	/** 宿主可见性（不变式 ④）：用例就地翻转以模拟「切到后台 / 切回前台」 */
	let visible: boolean;
	/** 画布根（⑤ 修复作用域；platform 层被 mock，此处只是不透明引用） */
	let contentRoot: Node | null;

	const makeSession = (): ContentRemeasureSession =>
		new ContentRemeasureSession(
			{
				getMindMap: () => map,
				register: (cleanup) => {
					cleanups.push(cleanup);
				},
				isVisible: () => visible,
				getContentRoot: () => contentRoot,
			},
			() => fontSet.fonts,
		);

	beforeEach(() => {
		vi.useFakeTimers();
		map = { stub: true } as unknown as MindMap;
		cleanups = [];
		fontSet = makeFontSet();
		visible = true;
		contentRoot = { root: true } as unknown as Node;
		platform.repairUnsettledMath.mockReset();
		platform.clearUnsettledMath.mockReset();
		platform.pruneUnsettledMathOwnedBy.mockReset();
		session = makeSession();
		engine.resolveNodesByDoms.mockReset();
		// 症状扫描的默认形状：无产物节点（可见自愈的 ③ 分支不介入既有用例）
		engine.findNodesByContentProducts.mockReset();
		engine.findNodesByContentProducts.mockReturnValue([]);
		engine.refreshNodesCustomContent.mockReset();
		engine.isNodeCollapsed.mockReset();
		engine.isNodeCollapsed.mockReturnValue(true);
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

	describe('④ 可见性不变式（隐藏态不测量 + 转可见自愈）', () => {
		it('隐藏态定稿：不反查不重排；切回前台自动补做（无需重开文件）', () => {
			const n1 = node('n1');
			engine.resolveNodesByDoms.mockReturnValue([n1]);
			visible = false;

			session.schedule(holder());
			vi.advanceTimersByTime(0);

			expect(engine.resolveNodesByDoms).not.toHaveBeenCalled();
			expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();

			// 切回前台：可见性采样 → 自愈（一拍宏任务）→ 挂起的 holder 重新入批
			visible = true;
			session.syncVisibility();
			vi.advanceTimersByTime(1); // 自愈拍（+1ms：让随后排定的批量拍一并到期）
			vi.advanceTimersByTime(1); // 重新入批的批量拍
			expect(engine.resolveNodesByDoms).toHaveBeenCalledTimes(1);
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [
				n1,
			]);
		});

		it('无脏时 syncVisibility 零成本（不查 DOM、不重排）', () => {
			session.syncVisibility();

			expect(engine.findNodesByContentProducts).not.toHaveBeenCalled();
			expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();
		});

		it('隐藏态字体批次：只记脏不测量；可见后补做一次（字体 epoch 修复不被削弱）', () => {
			const n1 = node('n1');
			engine.resolveNodesByDoms.mockReturnValue([n1]);
			session.schedule(holder());
			vi.advanceTimersByTime(0);
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);

			visible = false;
			fontSet.fire();
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(1);

			visible = true;
			session.syncVisibility();
			vi.advanceTimersByTime(0);
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledTimes(2);
			expect(engine.refreshNodesCustomContent).toHaveBeenLastCalledWith(map, [
				n1,
			]);
		});

		it('症状自愈：引擎内部在隐藏态砸出的塌陷节点，可见时按尺寸反查后重测', () => {
			const collapsed = node('collapsed');
			const healthy = node('healthy');
			visible = false;
			session.syncVisibility(); // 采样：记脏
			engine.findNodesByContentProducts.mockReturnValue([collapsed, healthy]);
			engine.isNodeCollapsed.mockImplementation(
				(value: unknown): boolean => value === collapsed,
			);

			visible = true;
			session.syncVisibility();
			vi.advanceTimersByTime(0);

			expect(engine.findNodesByContentProducts).toHaveBeenCalledTimes(1);
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [
				collapsed,
			]);
		});

		it('自愈拍到期前又切到后台：不测量、脏标记保留，再次可见仍能自愈', () => {
			const collapsed = node('collapsed');
			visible = false;
			session.syncVisibility(); // 采样：记脏（隐藏）

			visible = true;
			session.syncVisibility(); // 排自愈拍
			visible = false; // 拍到期前又切走（快速切标签 / 正在关闭的叶子）
			session.syncVisibility();

			engine.findNodesByContentProducts.mockReturnValue([collapsed]);
			vi.advanceTimersByTime(1); // 自愈拍到期：此刻量测恒 0×0，不得动手
			expect(engine.findNodesByContentProducts).not.toHaveBeenCalled();
			expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();

			// 脏标记未被白清：再次可见仍能自愈（否则 0×0 写回后永久塌陷）
			visible = true;
			session.syncVisibility();
			vi.advanceTimersByTime(1);
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [
				collapsed,
			]);
		});

		it('隐藏态渲染窗口重试不白耗额度：不提前告警，可见后仍能重试成功', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const n1 = node('n1');
			engine.resolveNodesByDoms.mockReturnValue([null]);
			engine.findNodesByContentProducts.mockReturnValue([]);
			session.schedule(holder());
			vi.advanceTimersByTime(0); // 全落空 → 暂存（渲染窗口 K104）

			visible = false;
			session.retryDeferred();
			expect(warnSpy).not.toHaveBeenCalled();

			visible = true;
			engine.resolveNodesByDoms.mockReturnValue([n1]);
			session.syncVisibility();
			vi.advanceTimersByTime(0); // 自愈拍：重试暂存的渲染窗口批次
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [
				n1,
			]);
			expect(warnSpy).not.toHaveBeenCalled();
			warnSpy.mockRestore();
		});
		});

	describe('⑤ 未定稿修复（被放弃的字面数学段，2026-10-14 实机缺陷）', () => {
		let map: MindMap | null;
		let session: ContentRemeasureSession;
		let visible: boolean;
		let contentRoot: Node | null;
		let fontSet: ReturnType<typeof makeFontSet>;

		beforeEach(() => {
			vi.useFakeTimers();
			map = { stub: true } as unknown as MindMap;
			visible = true;
			contentRoot = { root: true } as unknown as Node;
			fontSet = makeFontSet();
			engine.resolveNodesByDoms.mockReset();
			engine.findNodesByContentProducts.mockReset();
			engine.findNodesByContentProducts.mockReturnValue([]);
			engine.refreshNodesCustomContent.mockReset();
			engine.isNodeCollapsed.mockReset();
			platform.repairUnsettledMath.mockReset();
			platform.clearUnsettledMath.mockReset();
			platform.pruneUnsettledMathOwnedBy.mockReset();
			session = new ContentRemeasureSession(
				{
					getMindMap: () => map,
					register: () => {},
					isVisible: () => visible,
					getContentRoot: () => contentRoot,
				},
				() => fontSet.fonts,
			);
		});

		afterEach(() => {
			session.dispose();
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it('渲染轮次结束：修复（带画布根）与 deferred 重试各一次（两条链路互不吞没）', () => {
			engine.resolveNodesByDoms.mockReturnValue([null]);
			engine.findNodesByContentProducts.mockReturnValue([]);
			session.schedule({} as HTMLElement);
			vi.advanceTimersByTime(0); // 全落空 → 暂存（渲染窗口 K104）

			platform.repairUnsettledMath.mockClear();
			const n1 = node('n1');
			engine.resolveNodesByDoms.mockReturnValue([n1]);
			session.retryDeferred();

			expect(platform.repairUnsettledMath).toHaveBeenCalledTimes(1);
			expect(platform.repairUnsettledMath).toHaveBeenCalledWith(contentRoot);
			expect(engine.refreshNodesCustomContent).toHaveBeenCalledWith(map, [n1]);
		});

		it('无 deferred 暂存时同样修复（修复与 deferred 状态无关，早退不得吞没）', () => {
			session.retryDeferred();

			expect(platform.repairUnsettledMath).toHaveBeenCalledTimes(1);
			expect(platform.repairUnsettledMath).toHaveBeenCalledWith(contentRoot);
		});

		it('字体批次就绪：修复一次（与已同步节点的再同步同批）', () => {
			const n1 = node('n1');
			engine.resolveNodesByDoms.mockReturnValue([n1]);
			session.schedule({} as HTMLElement);
			vi.advanceTimersByTime(0);
			platform.repairUnsettledMath.mockClear();

			expect(platform.repairUnsettledMath).not.toHaveBeenCalled();

			fontSet.fire();

			expect(platform.repairUnsettledMath).toHaveBeenCalledTimes(1);
			expect(platform.repairUnsettledMath).toHaveBeenCalledWith(contentRoot);
		});

		it('隐藏态同样触发（修复刻意不做可见性守卫——下游守卫负责量测纪律）', () => {
			visible = false;
			session.retryDeferred();
			expect(platform.repairUnsettledMath).toHaveBeenCalledTimes(1);
			expect(platform.repairUnsettledMath).toHaveBeenCalledWith(contentRoot);

			// 关键回归（verify:visual embed 探针二分抓出的形态）：repair 不得借
			// `wasHidden` 置脏——否则可见后会凭空触发一次症状重测（重建 → 重排）
			visible = true;
			session.syncVisibility();
			vi.advanceTimersByTime(1);
			expect(engine.findNodesByContentProducts).not.toHaveBeenCalled();
			expect(engine.refreshNodesCustomContent).not.toHaveBeenCalled();
		});

		it('画布根缺失（引擎未建）：静默跳过、不抛错、不误报', () => {
			contentRoot = null;
			expect(() => session.retryDeferred()).not.toThrow();

			expect(platform.repairUnsettledMath).not.toHaveBeenCalled();
		});

		it('resetNodes 不动登记面（首帧前误清高危）/ forgetEngine 按引擎身份清 / dispose 按画布根全清', () => {
			// 关键回归（2026-10-14 实机定案）：resetNodes 在「新引擎就绪、首帧
			// 渲染之前」被调用，此刻新引擎由预测量构建的 holder **本体从不挂载**
			// （vendor 补丁 5 A2）——任何按 DOM 连接状态的清理都会把它们误删，
			// 字面从此无人修（实机：500 节点图视口外 76 段永久字面）。登记面
			// 只属于「引擎已销毁」（forgetEngine）与「视图已卸载」（dispose）。
			const engineA = { engine: 'A' };
			session.resetNodes();
			expect(platform.pruneUnsettledMathOwnedBy).not.toHaveBeenCalled();
			expect(platform.clearUnsettledMath).not.toHaveBeenCalled();

			// 引擎销毁：按**实例身份**精确清（参数即该实例；多视图/嵌入并存
			// 时不得触碰其他引擎的条目）
			session.forgetEngine(engineA);
			expect(platform.pruneUnsettledMathOwnedBy).toHaveBeenCalledTimes(1);
			expect(platform.pruneUnsettledMathOwnedBy).toHaveBeenCalledWith(
				engineA,
			);

			// null（不应出现）静默跳过：不误清
			session.forgetEngine(null);
			expect(platform.pruneUnsettledMathOwnedBy).toHaveBeenCalledTimes(1);

			// 视图销毁清**画布根内**的段（root 外的残留由紧随的引擎销毁按归属清）
			session.dispose();
			expect(platform.clearUnsettledMath).toHaveBeenCalledTimes(1);
			expect(platform.clearUnsettledMath).toHaveBeenCalledWith(contentRoot);

			// 根缺失时幂等且无副作用（调用次数不再增加）
			contentRoot = null;
			expect(() => session.dispose()).not.toThrow();
			expect(platform.clearUnsettledMath).toHaveBeenCalledTimes(1);
		});
	});
});
