/**
 * 联系几何的**数据落地**回归（`engine/mindmap-relations.applyRelationPlan`）。
 *
 * 三条契约（2026-10-30：系统自动选路已删除，几何只剩「文件里的 `geo=`」一个来源）：
 * 1. Markdown 的 `geo=` 是唯一真相：计划里带几何时一律照它写（端点 + 控制点偏移）；
 * 2. 文件里没有 `geo=`（`offsets` 为 null）时**保留 data 现有几何**——那可能是用户
 *    刚拖完、正文还没回写的那一轮，也可能是引擎按节点几何现算的默认端点。清掉会
 *    让曲线在下一帧跳回。旧值按**目标 uid** 认领：两个数组是按 targets 下标对齐的，
 *    目标集合一变下标就不再指向同一目标；
 * 3. 数据没变时返回 false（调用方据此避免无意义重画）——「文件里没有 geo」这一档
 *    尤其不能恒判为变过，否则每次渲染都整批重画线条。
 */
import { describe, expect, it, vi } from 'vitest';
import {
	applyRelationPlan,
	collectRelationTargets,
	type RelationPlan,
} from '../src/engine/mindmap-relations';

/** 渲染根（`getRenderRoot` 是唯一入口：本文件只验证读取面，不碰真实引擎） */
const roots = vi.hoisted((): { current: unknown } => ({ current: null }));
vi.mock('../src/engine/mindmap-nodes', () => ({
	getRenderRoot: () => roots.current,
}));

const TARGETS = 'associativeLineTargets';
const POINT = 'associativeLinePoint';
const OFFSET = 'associativeLineTargetControlOffsets';

/**
 * 一份计划：`offset = null` 表示文件里没有 `geo=`——此时端点也是 `null`
 * （与 `buildPlans` 同形态：没有 geo 就什么都不写，交给引擎现算）。
 */
function planWith(
	offset: { x: number; y: number }[] | null,
	color: string | null = null,
): RelationPlan {
	return {
		targets: ['u1'],
		texts: {},
		points: [
			offset
				? {
						startPoint: { dir: 'right', range: 0 },
						endPoint: { dir: 'right', range: 0 },
					}
				: null,
		],
		offsets: [offset],
		colors: [color],
	};
}

/** 用户拖过的 data：锚点朝左 + 一组控制点偏移 */
function draggedData(): Record<string, unknown> {
	return {
		[TARGETS]: ['u1'],
		[POINT]: [
			{
				startPoint: { dir: 'left', range: 0 },
				endPoint: { dir: 'left', range: 0 },
			},
		],
		[OFFSET]: [[{ x: 10, y: 0 }, { x: -10, y: 0 }]],
	};
}

/** 引擎节点桩：`getData()` 返回活引用，`children` 即子树 */
function engineNode(
	data: Record<string, unknown>,
	children: unknown[] = [],
): unknown {
	return { getData: () => data, children };
}

describe('collectRelationTargets：孤儿 id 的唯一判定面', () => {
	it('收集全树 `%%rel%%` 的目标（含深层子树）', () => {
		roots.current = engineNode({ text: '根' }, [
			engineNode({ text: '甲', mdRaw: '## 甲\n%%rel:aaaaaa | 依赖%%' }),
			engineNode({ text: '乙' }, [
				engineNode({ text: '丙', mdRaw: '## 丙\n%%rel:bbbbbb%%' }),
			]),
		]);

		// 集合语义：顺序不作契约（栈式遍历的子节点序与 children 序相反）
		expect([...collectRelationTargets({} as never)].sort()).toEqual([
			'aaaaaa',
			'bbbbbb',
		]);
	});

	it('except：调用方即将改写的源节点先排除（它那条边此刻还在 data 里）', () => {
		const from = engineNode({ text: '甲', mdRaw: '## 甲\n%%rel:aaaaaa | 依赖%%' });
		roots.current = engineNode({ text: '根' }, [
			from,
			engineNode({ text: '乙', mdRaw: '## 乙\n%%rel:aaaaaa%%' }),
		]);

		expect([...collectRelationTargets({} as never, from as never)]).toEqual([
			'aaaaaa',
		]);
		// 反向确认：另一条边也是同一目标时不能误判成「没人引用」
		roots.current = engineNode({ text: '根' }, [
			from,
			engineNode({ text: '丙', mdRaw: '## 丙\n%%rel:cccccc%%' }),
		]);
		expect([...collectRelationTargets({} as never, from as never)]).toEqual([
			'cccccc',
		]);
	});

	it('没有引擎 / 没有渲染根：空集（不抛错）', () => {
		roots.current = null;
		expect(collectRelationTargets(null).size).toBe(0);
		expect(collectRelationTargets({} as never).size).toBe(0);
	});
});

describe('applyRelationPlan：几何优先级', () => {
	it('文件里有 geo：端点与控制点一律照文件写，data 旧值被覆盖', () => {
		const data = draggedData();
		const geoOffset = [{ x: 99, y: 0 }, { x: -99, y: 0 }];
		const plan = planWith(geoOffset);

		expect(applyRelationPlan(data, plan)).toBe(true);
		expect(data[OFFSET]).toEqual([geoOffset]);
		expect(data[POINT]).toEqual(plan.points);
	});

	it('文件里没有 geo：保留 data 现有几何（不抹掉刚拖完/引擎现算的结果）', () => {
		const data = draggedData();
		const before = structuredClone(data);

		expect(applyRelationPlan(data, planWith(null))).toBe(false);
		expect(data).toEqual(before);
	});

	it('目标集合变了：旧几何按**目标 uid** 认领，不会按下标错配到另一条边', () => {
		// 两条边都拖过：u1 朝左、u2 朝上
		const left = {
			startPoint: { dir: 'left', range: 0 },
			endPoint: { dir: 'left', range: 0 },
		};
		const top = {
			startPoint: { dir: 'top', range: 0 },
			endPoint: { dir: 'top', range: 0 },
		};
		const data: Record<string, unknown> = {
			[TARGETS]: ['u1', 'u2'],
			[POINT]: [left, top],
			[OFFSET]: [
				[{ x: 1, y: 0 }, { x: -1, y: 0 }],
				[{ x: 2, y: 0 }, { x: -2, y: 0 }],
			],
		};
		// 正文里删掉了 u1 那条边（只剩 u2）且没写 `geo=`：u2 必须拿回自己那份几何
		const plan: RelationPlan = {
			targets: ['u2'],
			texts: {},
			points: [null],
			offsets: [null],
			colors: [null],
		};

		expect(applyRelationPlan(data, plan)).toBe(true);
		expect(data[POINT]).toEqual([top]);
		expect(data[OFFSET]).toEqual([[{ x: 2, y: 0 }, { x: -2, y: 0 }]]);
	});

	it('从来没有 geo：反复同步都判「没变」（否则每次渲染都全量重画线条）', () => {
		const data: Record<string, unknown> = {};

		expect(applyRelationPlan(data, planWith(null))).toBe(true); // 首次：写 targets
		expect(applyRelationPlan(data, planWith(null))).toBe(false);
		// 全为 null 的几何不落键（避免与下标对齐关系产生"看着有、其实没有"）
		expect(POINT in data).toBe(false);
		expect(OFFSET in data).toBe(false);
	});

	it('联系全部删除：三个键一起清掉', () => {
		const data = draggedData();

		expect(applyRelationPlan(data, null)).toBe(true);
		expect(Object.keys(data)).toEqual([]);
	});
});

describe('applyRelationPlan：线色（`%%rel%%` 的 color 段）', () => {
	const STYLE = 'associativeLineStyle';

	it('有 color：按目标 uid 写 associativeLineColor（引擎 getStyleConfig 读它）', () => {
		const data: Record<string, unknown> = {};

		expect(applyRelationPlan(data, planWith(null, '#4a90d9'))).toBe(true);
		expect(data[STYLE]).toEqual({
			u1: { associativeLineColor: '#4a90d9' },
		});
	});

	it('没有 color：不占键（回落主题），已有覆盖被整张删掉', () => {
		const data: Record<string, unknown> = {
			[STYLE]: { u1: { associativeLineColor: '#ff0000' } },
		};

		expect(applyRelationPlan(data, planWith(null))).toBe(true);
		expect(STYLE in data).toBe(false);
	});

	it('同色重放：不重写映射（判为无变化，避免无意义的重画）', () => {
		const styles = { u1: { associativeLineColor: '#4a90d9' } };
		const data: Record<string, unknown> = { [STYLE]: styles };

		applyRelationPlan(data, planWith(null, '#4a90d9'));

		// 同一个对象 ⇒ 没走「整张重建」分支（其余键的 changed 与本断言无关）
		expect(data[STYLE]).toBe(styles);
	});

	it('多目标：只有着色的边进映射，未着色的不占键', () => {
		const data: Record<string, unknown> = {};
		const plan: RelationPlan = {
			targets: ['u1', 'u2'],
			texts: {},
			points: [null, null],
			offsets: [null, null],
			colors: ['#ff0000', null],
		};

		expect(applyRelationPlan(data, plan)).toBe(true);
		expect(data[STYLE]).toEqual({ u1: { associativeLineColor: '#ff0000' } });
	});
});
