/**
 * 小地图纯几何与绘制模型（`core/minimap-geometry`）直测。
 *
 * 覆盖五类判定，均为「改一处就会静默走样」的契约：
 * - 面板尺寸：宽按比例收在 160–220、高随比例（下限 90，上限由调用方按画布高传入）；
 * - 启用判据：100% 下装不下（含 1px 容差）；
 * - 标记提取：DFS 顺序、父子下标、根标记、超上限抽样；
 * - 绘制：按原图输出（节点方块 + 主连线）、折线/曲线、无填充、配色清洗；
 * - 视口框投影（缩放/平移/越界夹边）与刷新节拍（首帧不等节拍）；
 * - 帧等价判定（切布局后「渲染落地但位置未回填」不许当成新图）。
 */
import { describe, expect, it } from 'vitest';
import {
	buildMiniMapLinks,
	buildMiniMapMarks,
	buildMiniMapSvg,
	computeMiniMapSize,
	connectorAnchors,
	connectorModeForLayout,
	contentExceedsCanvas,
	fishboneConnectors,
	measureMiniMapBounds,
	miniMapScale,
	MINIMAP_FALLBACK_COLORS,
	nextMiniMapDeadline,
	projectViewportBox,
	sameMiniMapFrame,
	type MiniMapCadence,
	type MiniMapGeometryNode,
	type MiniMapLinkMode,
	type MiniMapMark,
} from '../src/core/minimap-geometry';
import { MINIMAP_LINK_MAX_DEPTH, MINIMAP_MAX_MARKS } from '../src/core/constants';

describe('computeMiniMapSize：宽度随比例收窄、高度随比例', () => {
	it('2:1 的内容 → 220×110', () => {
		expect(computeMiniMapSize({ width: 800, height: 400 })).toEqual({
			width: 220,
			height: 110,
		});
	});

	it('极宽（2000×100）夹到最小高度 90', () => {
		expect(computeMiniMapSize({ width: 2000, height: 100 })).toEqual({
			width: 220,
			height: 90,
		});
	});

	it('极高（100×2000）：高度到顶 280，宽度收到下限 160（不再固定 220）', () => {
		expect(computeMiniMapSize({ width: 100, height: 2000 })).toEqual({
			width: 160,
			height: 280,
		});
	});

	it('高瘦内容（1449×2321）：面板收窄到绘图区宽度，左右不再留白', () => {
		expect(computeMiniMapSize({ width: 1449, height: 2321 })).toEqual({
			width: 175,
			height: 280,
		});
	});

	it('开放高度（maxHeight 由画布可用高度传入）：高瘦内容长高而不是被压扁', () => {
		// 1449×2321：默认上限 280 时是 175×280；上限放到 777 后按宽装满
		expect(computeMiniMapSize({ width: 1449, height: 2321 }, 777)).toEqual({
			width: 220,
			height: 352,
		});
	});

	it('极端比例（3040×107886，上限 777）：高度用满，宽度仍受下限 160 保护', () => {
		expect(computeMiniMapSize({ width: 3040, height: 107886 }, 777)).toEqual({
			width: 160,
			height: 777,
		});
	});

	it('上限传入退化值（矮画布）→ 夹到最小高度，不返回 0', () => {
		expect(computeMiniMapSize({ width: 100, height: 2000 }, 0)).toEqual({
			width: 160,
			height: 90,
		});
	});

	it('内容尺寸不可得 → null（调用方保持上一帧）', () => {
		expect(computeMiniMapSize({ width: 0, height: 100 })).toBeNull();
		expect(computeMiniMapSize({ width: 100, height: 0 })).toBeNull();
	});
});

describe('contentExceedsCanvas：100% 下的启用判据', () => {
	it('任一维超出即 true', () => {
		expect(
			contentExceedsCanvas({ width: 900, height: 400 }, { width: 800, height: 600 }),
		).toBe(true);
		expect(
			contentExceedsCanvas({ width: 700, height: 700 }, { width: 800, height: 600 }),
		).toBe(true);
	});

	it('装得下即 false', () => {
		expect(
			contentExceedsCanvas({ width: 800, height: 600 }, { width: 800, height: 600 }),
		).toBe(false);
	});

	it('1px 容差吸收亚像素误差（临界尺寸不翻转）', () => {
		expect(
			contentExceedsCanvas({ width: 801, height: 600 }, { width: 800, height: 600 }),
		).toBe(false);
		expect(
			contentExceedsCanvas({ width: 802, height: 600 }, { width: 800, height: 600 }),
		).toBe(true);
	});
});

describe('sameMiniMapFrame：切布局「渲染落地但位置未回填」的判据', () => {
	const frame = {
		content: { x: 452, y: -2855, width: 3934, height: 3289 },
		panel: { width: 220, height: 184 },
		signature: 4242,
	};

	it('同一布局的两帧等价', () => {
		expect(sameMiniMapFrame(frame, { ...frame })).toBe(true);
	});

	it('内容盒整体位移 1px 即判不等（换布局必然满足）', () => {
		expect(
			sameMiniMapFrame(frame, {
				content: { ...frame.content, x: frame.content.x + 1 },
				panel: frame.panel,
				signature: frame.signature,
			}),
		).toBe(false);
		expect(
			sameMiniMapFrame(frame, {
				content: { ...frame.content, height: frame.content.height - 1 },
				panel: frame.panel,
				signature: frame.signature,
			}),
		).toBe(false);
	});

	it('0.5px 以内视为同一帧（吸收亚像素抖动）', () => {
		expect(
			sameMiniMapFrame(frame, {
				content: {
					x: frame.content.x + 0.4,
					y: frame.content.y - 0.5,
					width: frame.content.width + 0.3,
					height: frame.content.height,
				},
				panel: frame.panel,
				signature: frame.signature,
			}),
		).toBe(true);
	});

	it('面板尺寸差 1px 即判不等（面板由内容盒确定性推出，差 1px 说明取样自别的几何）', () => {
		expect(
			sameMiniMapFrame(frame, {
				content: frame.content,
				panel: { width: 219, height: 184 },
				signature: frame.signature,
			}),
		).toBe(false);
	});

	it('外框与面板全同、内部排布不同 ⇒ 判不等（2026-10-24 四轮修：标记指纹）', () => {
		// 两套布局的包围盒恰好相同、节点排布不同：只比外框会跳过重画，
		// 小图停在上一套布局（drawWhenLanded 会把「等落地」标记消费掉）。
		expect(
			sameMiniMapFrame(frame, {
				content: frame.content,
				panel: frame.panel,
				signature: frame.signature + 1,
			}),
		).toBe(false);
	});
});

describe('buildMiniMapMarks：DFS 顺序 + 父子下标 + 根标记', () => {
	/** 根(0,0,100,40) → A(200,0,80,40) → A1/A2；B(200,100,80,40) */
	const tree: MiniMapGeometryNode = {
		left: 0,
		top: 0,
		width: 100,
		height: 40,
		children: [
			{
				left: 200,
				top: 0,
				width: 80,
				height: 40,
				children: [
					{ left: 400, top: 0, width: 60, height: 30 },
					{ left: 400, top: 80, width: 60, height: 30 },
				],
			},
			{ left: 200, top: 120, width: 80, height: 40 },
		],
	};

	it('深度优先、根在最前且打 root 标记，子节点带父下标', () => {
		const marks = buildMiniMapMarks(tree)?.marks;
		expect(marks?.map((m) => m.x)).toEqual([0, 200, 400, 400, 200]);
		expect(marks?.[0]?.root).toBe(true);
		expect(marks?.[0]?.parent).toBeUndefined();
		// A 的父是根；A1/A2 的父是 A；B 的父是根
		expect(marks?.[1]?.parent).toBe(0);
		expect(marks?.[2]?.parent).toBe(1);
		expect(marks?.[3]?.parent).toBe(1);
		expect(marks?.[4]?.parent).toBe(0);
		// 层级随 DFS 递增：根 0、A 1、A1/A2 2、B 1
		expect(marks?.map((m) => m.depth)).toEqual([0, 1, 2, 2, 1]);
	});

	it('同时给出标记包围盒（映射基准，避免与主图比例不一致）', () => {
		expect(buildMiniMapMarks(tree)?.bounds).toEqual({
			x: 0,
			y: 0,
			width: 460,
			height: 160,
		});
	});

	it('根不可得 → null；无子节点 → 只有根', () => {
		expect(buildMiniMapMarks(null)).toBeNull();
		const solo = buildMiniMapMarks({ left: 0, top: 0, width: 10, height: 10 });
		expect(solo?.marks).toHaveLength(1);
		expect(solo?.marks[0]?.root).toBe(true);
		expect(solo?.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
	});

	it('超过上限时按步长抽样，且根一定保留', () => {
		const many: MiniMapGeometryNode = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: Array.from({ length: MINIMAP_MAX_MARKS + 1000 }, (_, i) => ({
				left: 200,
				top: i * 50,
				width: 80,
				height: 40,
			})),
		};
		const marks = buildMiniMapMarks(many)?.marks ?? [];
		expect(marks.length).toBeLessThanOrEqual(MINIMAP_MAX_MARKS + 1);
		expect(marks[0]?.root).toBe(true);
		// 抽掉的父节点不会留下指向不存在的下标
		for (const mark of marks) {
			if (mark.parent !== undefined) {
				expect(mark.parent).toBeLessThan(marks.length);
			}
		}
	});

	it('硬上界：9506 节点的混合形态也不得突破上限（2026-10-25 纯步长口径）', () => {
		// 浅层 1506 + 深层 8000（总 9506）。旧实现（按全量算步长再把浅层整段叠加）
		// 实得 ≈3106 块 = 1.55× 上限；现在**同一套步长对全树生效**，且根恒留。
		const deepKids: MiniMapGeometryNode[] = Array.from(
			{ length: 8000 },
			(_, i) => ({ left: 900, top: i * 2, width: 40, height: 6 }),
		);
		const level3: MiniMapGeometryNode[] = Array.from(
			{ length: 1475 },
			(_, i) =>
				i === 0
					? { left: 600, top: 0, width: 60, height: 10, children: deepKids }
					: { left: 600, top: i * 12, width: 60, height: 10 },
		);
		const level2: MiniMapGeometryNode[] = Array.from(
			{ length: 25 },
			(_, i) => ({
				left: 400,
				top: i * 400,
				width: 80,
				height: 30,
				children: level3.slice(i * 59, (i + 1) * 59),
			}),
		);
		const level1: MiniMapGeometryNode[] = Array.from(
			{ length: 5 },
			(_, i) => ({
				left: 200,
				top: i * 2000,
				width: 90,
				height: 40,
				children: level2.slice(i * 5, (i + 1) * 5),
			}),
		);
		const deepWide: MiniMapGeometryNode = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: level1,
		};
		const marks = buildMiniMapMarks(deepWide)?.marks ?? [];
		// 步长 = ceil(9506 / 2000) = 5 ⇒ ≈1902 块，且根恒留（故留 +1 的余量）
		expect(marks.length).toBeLessThanOrEqual(MINIMAP_MAX_MARKS + 1);
		expect(marks[0]?.root).toBe(true);
		// 深层仍抽到了样本（不是只剩浅层）
		expect(marks.filter((mark) => (mark.depth ?? 99) > 3).length).toBeGreaterThan(
			0,
		);
	});

	it('标记指纹：同树两次一致，挪一个盒子即变（判「换没换图」的第三项）', () => {
		const base: MiniMapGeometryNode = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: [
				{ left: 200, top: 10, width: 80, height: 30 },
				{ left: 200, top: 60, width: 80, height: 30 },
			],
		};
		const first = buildMiniMapMarks(base)?.signature;
		expect(first).toBeTypeOf('number');
		expect(buildMiniMapMarks(base)?.signature).toBe(first);
		// 外框不变、只有一个子节点挪了 1px ⇒ 指纹必须变
		const moved: MiniMapGeometryNode = {
			...base,
			children: [
				{ left: 200, top: 10, width: 80, height: 30 },
				{ left: 201, top: 60, width: 80, height: 30 },
			],
		};
		expect(buildMiniMapMarks(moved)?.signature).not.toBe(first);
		// 孤立根（无子节点）同样有指纹
		expect(
			buildMiniMapMarks({ left: 0, top: 0, width: 10, height: 10 })?.signature,
		).toBeTypeOf('number');
	});

	it('抽样对全树同权：没有「浅层必留」例外（2026-10-25 简化）', () => {
		// 结构：根 → A → B → 20 个三级子节点 → 每个再挂 10 个四级（共 223 节点）。
		// 旧实现会把这 23 个浅层节点全留（连线只画三层），现在画不画连线看节点数，
		// 浅层不再有豁免 ⇒ 同一套步长对所有节点生效，浅层也会被抽掉一部分。
		const wide: MiniMapGeometryNode = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: [
				{
					left: 200,
					top: 0,
					width: 80,
					height: 40,
					children: [
						{
							left: 400,
							top: 0,
							width: 80,
							height: 40,
							children: Array.from({ length: 20 }, (_, i) => ({
								left: 600,
								top: i * 60,
								width: 60,
								height: 30,
								children: Array.from({ length: 10 }, (_, j) => ({
									left: 800,
									top: i * 60 + j * 3,
									width: 50,
									height: 24,
								})),
							})),
						},
					],
				},
			],
		};
		const marks = buildMiniMapMarks(wide, 30)?.marks ?? [];
		expect(marks.length).toBeLessThanOrEqual(31);
		const shallow = marks.filter((mark) => (mark.depth ?? 99) <= 3);
		// 23 个浅层节点不再全留，但深层仍抽到了样本
		expect(shallow.length).toBeLessThan(23);
		expect(marks.filter((mark) => (mark.depth ?? 99) > 3).length).toBeGreaterThan(
			0,
		);
	});

	it('抽样不改变映射基准：bounds 仍是**全量**包围盒（2026-10-24 二轮修）', () => {
		// 首尾两个极端节点若被抽掉，旧实现会让 bounds 缩小、整张图被放大出面板
		const wide: MiniMapGeometryNode = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: [
				{ left: -500, top: 0, width: 60, height: 30 },
				...Array.from({ length: 40 }, (_, i) => ({
					left: 200 + i,
					top: 0,
					width: 60,
					height: 30,
				})),
				{ left: 5000, top: 900, width: 60, height: 30 },
			],
		};
		const sampled = buildMiniMapMarks(wide, 3);
		expect(sampled?.marks.length).toBeLessThan(5);
		expect(sampled?.bounds).toEqual({
			x: -500,
			y: 0,
			width: 5560,
			height: 930,
		});
	});
});

describe('measureMiniMapBounds：全量包围盒与节点数（启用判据与映射的唯一来源）', () => {
	it('只统计有几何的节点进包围盒，节点数按全量计', () => {
		const tree: MiniMapGeometryNode = {
			left: 10,
			top: 20,
			width: 100,
			height: 40,
			children: [
				// 无效几何（宽 0）：计入总数，不参与包围盒
				{ left: 300, top: 0, width: 0, height: 40 },
				{ left: 200, top: 100, width: 80, height: 40 },
			],
		};
		expect(measureMiniMapBounds(tree)).toEqual({
			bounds: { x: 10, y: 20, width: 270, height: 120 },
			// 节点数按**全量**计（含几何无效的那个）：它是「连线画到哪一档」的判据输入
			total: 3,
		});
	});

	it('根不可得 / 全树无几何 → null', () => {
		expect(measureMiniMapBounds(null)).toBeNull();
		expect(
			measureMiniMapBounds({ left: 0, top: 0, width: 0, height: 0 }),
		).toBeNull();
	});
});

describe('buildMiniMapSvg：按原图输出（方块 + 连线）', () => {
	const content = { x: 0, y: 0, width: 1000, height: 500 };
	const panel = { width: 220, height: 110 };
	const marks: MiniMapMark[] = [
		{ x: 0, y: 0, width: 100, height: 40, root: true, depth: 0 },
		{ x: 200, y: 0, width: 80, height: 40, parent: 0, depth: 1 },
		{ x: 400, y: 200, width: 60, height: 30, parent: 1, depth: 2 },
	];

	it('每个标记一个矩形，根用根配色且独立分层', () => {
		const svg = buildMiniMapSvg(content, marks, panel, MINIMAP_FALLBACK_COLORS);
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect(svg).toContain('viewBox="0 0 220 110"');
		// 3 个节点 + 1 条背景
		expect((svg.match(/<rect /g) ?? []).length).toBe(4);
		expect(svg).toContain(`<g fill="${MINIMAP_FALLBACK_COLORS.root}"`);
		expect(svg).not.toContain('NaN');
		expect(svg).not.toContain('undefined');
	});

	it('shallow ⇒ 只画前 7 层的边（第 8 层剪掉），方块一个不少', () => {
		// 深度 0…8 的单链（9 个标记 / 8 条边）：正好跨过 7 层的分界
		const chain: MiniMapMark[] = [];
		for (let depth = 0; depth <= 8; depth++) {
			const mark: MiniMapMark = {
				x: depth * 60,
				y: depth * 20,
				width: 40,
				height: 30,
				depth,
			};
			if (depth === 0) {
				mark.root = true;
			} else {
				mark.parent = depth - 1;
			}
			chain.push(mark);
		}
		const build = (mode: MiniMapLinkMode): string =>
			buildMiniMapSvg(
				content,
				chain,
				panel,
				MINIMAP_FALLBACK_COLORS,
				'straight',
				'branchH',
				mode,
			);
		expect(MINIMAP_LINK_MAX_DEPTH).toBe(7);
		// all：8 条（深度 1…8 各一条）
		expect((build('all').match(/<path /g) ?? []).length).toBe(8);
		// shallow：只到深度 7 ⇒ 7 条，深度 8 那条剪掉
		expect((build('shallow').match(/<path /g) ?? []).length).toBe(7);
		// 方块不受档位影响：9 个节点 + 1 背景
		expect((build('all').match(/<rect /g) ?? []).length).toBe(10);
		expect((build('shallow').match(/<rect /g) ?? []).length).toBe(10);
	});

	it('shallow 对深度未超限的图零影响：时间轴兄弟横链、鱼骨骨脊都原样', () => {
		// 时间轴：根 + 3 个一级（同一条中心线）+ 1 个二级（深度都 ≤ 7）
		const chain: MiniMapMark[] = [
			{ x: 0, y: 0, width: 40, height: 20, root: true, depth: 0 },
			{ x: 100, y: 0, width: 40, height: 20, parent: 0, depth: 1 },
			{ x: 200, y: 0, width: 40, height: 20, parent: 0, depth: 1 },
			{ x: 300, y: 0, width: 40, height: 20, parent: 0, depth: 1 },
			{ x: 150, y: 100, width: 40, height: 20, parent: 1, depth: 2 },
		];
		const buildWith = (mode: MiniMapLinkMode, connector: 'chainRail' | 'fishbone', list: MiniMapMark[]): string =>
			buildMiniMapSvg(
				content,
				list,
				panel,
				MINIMAP_FALLBACK_COLORS,
				'straight',
				connector,
				mode,
			);
		// 一级兄弟横链（3 段）+ 二级竖轨与横档（各 1）都在
		expect(
			(buildWith('all', 'chainRail', chain).match(/<path /g) ?? []).length,
		).toBe(5);
		expect(buildWith('shallow', 'chainRail', chain)).toBe(
			buildWith('all', 'chainRail', chain),
		);

		// 鱼骨：水平骨干 1 + 斜骨 1 + 斜脊 1（都深度 ≤ 2），shallow 不改变任何字节
		const fish: MiniMapMark[] = [
			{ x: 0, y: 0, width: 40, height: 20, root: true, depth: 0 },
			{ x: 100, y: 0, width: 40, height: 20, parent: 0, depth: 1 },
			{ x: 160, y: 40, width: 40, height: 20, parent: 1, depth: 2 },
			{ x: 160, y: 80, width: 40, height: 20, parent: 1, depth: 2 },
		];
		expect(
			(buildWith('all', 'fishbone', fish).match(/<path /g) ?? []).length,
		).toBe(3);
		expect(buildWith('shallow', 'fishbone', fish)).toBe(
			buildWith('all', 'fishbone', fish),
		);
	});

	it('折线画正交拐折（L），曲线画 S 弯（C），两者都不填充', () => {
		const straight = buildMiniMapSvg(content, marks, panel, MINIMAP_FALLBACK_COLORS);
		const curve = buildMiniMapSvg(
			content,
			marks,
			panel,
			MINIMAP_FALLBACK_COLORS,
			'curve',
		);
		expect(straight).toContain('L');
		expect(straight).not.toContain('C');
		expect(curve).toContain('C');
		expect(curve).not.toContain('L');
		// 连线组必须显式无填充：`<path>` 默认黑色实心，折角会变成黑块
		expect(straight).toContain('fill="none"');
		expect(curve).toContain('fill="none"');
	});

	it('块按层级分档：一级最实（0.62 + 描边），二级 0.5，三级以下 0.36', () => {
		const tiers: MiniMapMark[] = [
			{ x: 0, y: 0, width: 100, height: 40, root: true, depth: 0 },
			{ x: 200, y: 0, width: 80, height: 40, parent: 0, depth: 1 },
			{ x: 400, y: 0, width: 60, height: 30, parent: 1, depth: 2 },
			{ x: 600, y: 0, width: 40, height: 30, parent: 2, depth: 3 },
		];
		const svg = buildMiniMapSvg(content, tiers, panel, MINIMAP_FALLBACK_COLORS);
		expect(svg).toContain('fill-opacity="0.62"');
		expect(svg).toContain('fill-opacity="0.5"');
		expect(svg).toContain('fill-opacity="0.36"');
	});

	it('节点块用描边色的淡墨（白底不糊），连线先画、节点后盖（与画布同序）', () => {
		const svg = buildMiniMapSvg(content, marks, panel, {
			background: '#ffffff',
			nodeBorder: '#cbd5e1',
			root: '#4a90d9',
			line: '#94a3b8',
		});
		expect(svg).toContain('fill="#cbd5e1"');
		expect(svg).toContain('fill-opacity="0.62"');
		expect(svg).toContain('stroke="#94a3b8"');
		expect(svg).toContain('fill="#4a90d9"');
		// 连线在节点之前：线只在节点之间的空档露出，与画布层次一致
		expect(svg.indexOf('stroke="#94a3b8"')).toBeLessThan(
			svg.indexOf('fill="#cbd5e1"'),
		);
	});

	it('颜色串被白名单清洗（异常值回落灰）', () => {
		const svg = buildMiniMapSvg(content, marks, panel, {
			background: '#111111',
			nodeBorder: '#333333',
			root: '#444444',
			line: '"><script>',
		});
		expect(svg).not.toContain('<script>');
		expect(svg).toContain('#888888');
	});
});

describe('connectorAnchors：连线端口与拐点（与画布同构）', () => {
	it('子节点在右侧：父右边缘中点 → 母线 → 子左边缘中点', () => {
		expect(
			connectorAnchors(
				{ x: 0, y: 0, width: 100, height: 40 },
				{ x: 300, y: 200, width: 100, height: 40 },
			),
		).toEqual({
			ax: 100,
			ay: 20,
			bx: 300,
			by: 220,
			mid: 220,
			horizontal: true,
		});
	});

	it('子节点在左侧：端口反转（父左边缘 → 子右边缘）', () => {
		expect(
			connectorAnchors(
				{ x: 400, y: 0, width: 100, height: 40 },
				{ x: 0, y: 200, width: 100, height: 40 },
			),
		).toEqual({
			ax: 400,
			ay: 20,
			bx: 100,
			by: 220,
			mid: 220,
			horizontal: true,
		});
	});

	it('纵向落差很大但仍在右侧：必须走横向母线（回归：曾误判成上下分支）', () => {
		expect(
			connectorAnchors(
				{ x: 0, y: 0, width: 100, height: 40 },
				{ x: 200, y: 600, width: 100, height: 40 },
			),
		).toEqual({
			ax: 100,
			ay: 20,
			bx: 200,
			by: 620,
			mid: 160,
			horizontal: true,
		});
	});

	it('纵向占优（组织结构图 / 鱼骨分支）：上下边缘相接', () => {
		expect(
			connectorAnchors(
				{ x: 0, y: 0, width: 100, height: 40 },
				{ x: 10, y: 300, width: 100, height: 40 },
			),
		).toEqual({
			ax: 50,
			ay: 40,
			bx: 60,
			by: 300,
			mid: 222,
			horizontal: false,
		});
	});
});

describe('miniMapScale：投影 / 拼图 / 拖拽共用的唯一比例', () => {
	it('取宽高两个方向里更小的那个（哪一个方向受限由内容比例决定）', () => {
		// 内容与面板同比例：两向都是 0.22
		expect(
			miniMapScale({ width: 1000, height: 500 }, { width: 220, height: 110 }),
		).toBe(0.22);
		// 高瘦内容：高度受限（110 / 1000 = 0.11）
		expect(
			miniMapScale({ width: 100, height: 1000 }, { width: 220, height: 110 }),
		).toBe(0.11);
	});

	it('内容或面板退化（宽高 ≤ 0）→ 0（调用方按「不可映射」跳过，不产生 NaN）', () => {
		expect(miniMapScale({ width: 0, height: 500 }, { width: 220, height: 110 })).toBe(0);
		expect(miniMapScale({ width: 100, height: 500 }, { width: 220, height: 0 })).toBe(0);
	});
});

describe('projectViewportBox：视口框本地投影', () => {
	const content = { x: 0, y: 0, width: 1000, height: 500 };
	const panel = { width: 220, height: 110 };
	const canvas = { width: 800, height: 400 };
	const identity = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };

	it('100% 且内容贴左上 → 框在左上角', () => {
		expect(projectViewportBox({ content, panel, canvas, transform: identity })).toEqual(
			{ x: 0, y: 0, width: 176, height: 88 },
		);
	});

	it('放大 2 倍 → 框减半', () => {
		const box = projectViewportBox({
			content,
			panel,
			canvas,
			transform: { scaleX: 2, scaleY: 2, translateX: 0, translateY: 0 },
		});
		expect(box).toEqual({ x: 0, y: 0, width: 88, height: 44 });
	});

	it('平移 → 框按比例右移', () => {
		const box = projectViewportBox({
			content,
			panel,
			canvas,
			transform: { scaleX: 1, scaleY: 1, translateX: -100, translateY: 0 },
		});
		// 内容左移 100 表示视口右移 100 布局像素 = 22 面板像素
		expect(box).toEqual({ x: 22, y: 0, width: 176, height: 88 });
	});

	it('视口完全在左上外侧 → 贴左上角，留出完整外框', () => {
		const box = projectViewportBox({
			content,
			panel,
			canvas,
			transform: { scaleX: 1, scaleY: 1, translateX: 10_000, translateY: 0 },
		});
		expect(box?.x).toBe(0);
		// 外框厚度 4（= 2px 边框 ×2）：border-box 下宽度不足时浏览器不缩边框
		expect(box?.width).toBe(4);
	});

	it('视口整个落在右下外侧 → 外框仍完整落在面板内（右/下不再被裁）', () => {
		const box = projectViewportBox({
			content,
			panel,
			canvas,
			transform: { scaleX: 1, scaleY: 1, translateX: -10_000, translateY: -10_000 },
		});
		// 起点退到 panel − 4：与左上外侧的 {0,0,4,4} 对称，四边都画得出来
		expect(box).toEqual({ x: 216, y: 106, width: 4, height: 4 });
	});

	it('贴边但剩余空间不足外框厚度 → 向内让位，不让右/下边框消失', () => {
		// translateX = −990.9 ⇒ 可视区左缘落在 218（面板右侧只剩 2px）
		const box = projectViewportBox({
			content,
			panel,
			canvas,
			transform: { scaleX: 1, scaleY: 1, translateX: -990.9, translateY: 0 },
		});
		expect(box?.x).toBe(216);
		expect(box?.width).toBe(4);
	});

	it('几何非法 → null（不画半截框）', () => {
		expect(
			projectViewportBox({
				content,
				panel,
				canvas,
				transform: { scaleX: 0, scaleY: 1, translateX: 0, translateY: 0 },
			}),
		).toBeNull();
		expect(
			projectViewportBox({
				content: { ...content, width: 0 },
				panel,
				canvas,
				transform: identity,
			}),
		).toBeNull();
	});
});

describe('nextMiniMapDeadline：30s 节拍与淡出', () => {
	const base: MiniMapCadence = {
		enabled: true,
		ready: false,
		visible: false,
		dirty: true,
		lastDrawAt: 0,
		lastActivityAt: 1000,
		hovering: false,
	};

	it('未启用 → 不排期', () => {
		expect(nextMiniMapDeadline({ ...base, enabled: false }, 0, 30_000, 30_000)).toBeNull();
	});

	it('未就绪（启用瞬间那次绘制没成）→ 不排期，重试交给渲染落地事件', () => {
		// 首帧在启用瞬间画（2026-10-24 修订），节拍不再承担首次绘制
		expect(nextMiniMapDeadline(base, 1000, 30_000, 30_000)).toBeNull();
		expect(nextMiniMapDeadline(base, 40_000, 30_000, 30_000)).toBeNull();
	});

	it('已显示且脏 → 取「换图」与「淡出」的更早者', () => {
		const ready: MiniMapCadence = {
			...base,
			ready: true,
			visible: true,
			lastDrawAt: 10_000,
			lastActivityAt: 20_000,
		};
		// 换图 40_000、淡出 50_000 → 40_000
		expect(nextMiniMapDeadline(ready, 20_000, 30_000, 30_000)).toBe(40_000);
	});

	it('已显示且干净 → 只等淡出', () => {
		const ready: MiniMapCadence = {
			...base,
			ready: true,
			visible: true,
			dirty: false,
			lastDrawAt: 10_000,
			lastActivityAt: 20_000,
		};
		expect(nextMiniMapDeadline(ready, 20_000, 30_000, 30_000)).toBe(50_000);
	});

	it('已淡出 → 不排期（隐藏期间零重绘、零定时器）', () => {
		const hidden: MiniMapCadence = { ...base, ready: true, visible: false };
		expect(nextMiniMapDeadline(hidden, 99_999, 30_000, 30_000)).toBeNull();
	});

	it('悬停 ⇒ 永不淡出（干净时干脆不排期；脏时只等换图）', () => {
		const hoveredClean: MiniMapCadence = {
			...base,
			ready: true,
			visible: true,
			dirty: false,
			hovering: true,
			lastDrawAt: 10_000,
			lastActivityAt: 20_000,
		};
		// 空闲窗口早已过期也不藏：没有待做的事 ⇒ null（不空转定时器）
		expect(nextMiniMapDeadline(hoveredClean, 99_999, 30_000, 30_000)).toBeNull();
		const hoveredDirty: MiniMapCadence = { ...hoveredClean, dirty: true };
		// 只保留「换图」截止时间（40_000），淡出被忽略
		expect(nextMiniMapDeadline(hoveredDirty, 20_000, 30_000, 30_000)).toBe(
			40_000,
		);
		expect(nextMiniMapDeadline(hoveredDirty, 99_999, 30_000, 30_000)).toBe(
			99_999,
		);
	});
});

describe('connectorModeForLayout：布局 → 连线形态（唯一映射）', () => {
	it('鱼骨族走斜脊（含引擎侧镜像变体，容错手工 data.json）', () => {
		for (const layout of [
			'fishbone',
			'fishbone2',
			'rightFishbone',
			'rightFishbone2',
		]) {
			expect(connectorModeForLayout(layout)).toBe('fishbone');
		}
	});

	it('五种形态按布局分派（2026-10-25 复刻画布）', () => {
		expect(connectorModeForLayout('logicalStructure')).toBe('branchH');
		expect(connectorModeForLayout('logicalStructureLeft')).toBe('branchH');
		expect(connectorModeForLayout('mindMap')).toBe('branchH');
		expect(connectorModeForLayout('organizationStructure')).toBe('busV');
		expect(connectorModeForLayout('catalogOrganization')).toBe('railLeft');
		for (const layout of ['timeline', 'timeline2']) {
			expect(connectorModeForLayout(layout)).toBe('chainRail');
		}
		// 纵向时间轴的深层连线就是左右分支（实测 0.6 竖档），一级是竖链 ⇒ branchH
		for (const layout of [
			'verticalTimeline',
			'verticalTimeline2',
			'verticalTimeline3',
		]) {
			expect(connectorModeForLayout(layout)).toBe('branchH');
		}
	});

	it('空值与未知布局退回左右分支（不崩、不猜）', () => {
		for (const layout of [null, undefined, '', 'somethingElse']) {
			expect(connectorModeForLayout(layout)).toBe('branchH');
		}
	});
});

describe('buildMiniMapLinks：三种新形态与画布逐段对齐', () => {
	/** 浮点容差比较（坐标来自 0.6/0.7 比例，末位不经保证） */
	const expectPoint = (
		point: { x: number; y: number } | undefined,
		x: number,
		y: number,
	): void => {
		expect(point?.x).toBeCloseTo(x, 4);
		expect(point?.y).toBeCloseTo(y, 4);
	};

	/** 实测样本：组织结构图 产品部(-801.6,628.2,74×26.8) → 产品组(-1077.1,709,71×25.6) */
	const org: MiniMapMark[] = [
		{ x: 611, y: 495, width: 144, height: 29.2, root: true, depth: 0 },
		{ x: -801.6, y: 628.2, width: 74, height: 26.8, parent: 0, depth: 1 },
		{ x: -1077.1, y: 709, width: 71, height: 25.6, parent: 1, depth: 2 },
		{ x: -598.1, y: 709, width: 71, height: 25.6, parent: 1, depth: 2 },
	];

	it('busV：父底中点竖直 0.7 → 共享母线 → 竖直落到各子顶中点', () => {
		const links = buildMiniMapLinks(org, 'busV');
		// 根：底 524.2 → 母线 524.2 + 0.7×(628.2−524.2) = 597
		expectPoint(links[0]?.from, 683, 524.2);
		expectPoint(links[0]?.to, 683, 597);
		expect(links[0]?.tier).toBe(1);
		// 一级母线 = 各一级中心（产品部 中心 -764.6）…单子节点时长度为 0
		expectPoint(links[1]?.from, -764.6, 597);
		expectPoint(links[1]?.to, -764.6, 597);
		expectPoint(links[2]?.from, -764.6, 597);
		expectPoint(links[2]?.to, -764.6, 628.2);
		// 产品部 → 两个子：母线在 655 + 0.7×54 = 692.8
		const bus = links.find(
			(link) =>
				link.elbow === undefined &&
				link.from.y === 692.8 &&
				link.to.y === 692.8,
		);
		expect(bus?.from.x).toBeCloseTo(-1041.6, 1);
		expect(bus?.to.x).toBeCloseTo(-562.6, 1);
	});

	it('railLeft：一级 0.7 母线 + 落到子左边界；深层左轨（child.left − 12）+ 横档', () => {
		const marks: MiniMapMark[] = [
			{ x: 611, y: 495, width: 112, height: 29.2, root: true, depth: 0 },
			{ x: 27.57, y: 628.2, width: 84, height: 25.6, parent: 0, depth: 1 },
			{ x: 366.57, y: 628.2, width: 84, height: 25.6, parent: 0, depth: 1 },
			{ x: 56.57, y: 678.99, width: 84, height: 25.6, parent: 1, depth: 2 },
			{ x: 56.57, y: 728.58, width: 84, height: 25.6, parent: 1, depth: 2 },
		];
		const links = buildMiniMapLinks(marks, 'railLeft');
		// 根竖落：524.2 → 524.2 + 0.7×104 = 597
		expectPoint(links[0]?.from, 667, 524.2);
		expectPoint(links[0]?.to, 667, 597);
		// 一级母线横跨**左边界** 27.57…366.57
		expectPoint(links[1]?.from, 27.57, 597);
		expectPoint(links[1]?.to, 366.57, 597);
		// 一级竖落落在子节点左边界、直到子节点顶部
		expectPoint(links[2]?.from, 27.57, 597);
		expectPoint(links[2]?.to, 27.57, 628.2);
		// 二级：竖轨 x = 56.57 − 12 = 44.57；从父底 653.8 到最后一个子中心
		const rail = links.find((link) => Math.abs(link.from.x - 44.57) < 0.001);
		expectPoint(rail?.from, 44.57, 653.8);
		expect(rail?.to.y).toBeCloseTo(728.58 + 12.8, 1);
		// 轨道描边跟第一子的层级（深层恒二级，浅色）——与时间轴深层同一 helper
		expect(rail?.tier).toBe(2);
		// 横档：轨 → 子左边界，y = 子中心
		const stub = links.find(
			(link) =>
				Math.abs(link.from.x - 44.57) < 0.001 &&
				Math.abs(link.to.x - 56.57) < 0.001,
		);
		expect(stub?.from.y).toBeCloseTo(691.79, 1);
	});

	it('chainRail：根→首个一级→兄弟横链，深层 0.6 竖轨 + 横档', () => {
		const marks: MiniMapMark[] = [
			{ x: 611, y: 495, width: 112, height: 29.2, root: true, depth: 0 },
			{ x: 827, y: 496.2, width: 86.7, height: 26.8, parent: 0, depth: 1 },
			{ x: 1152.4, y: 496.2, width: 86.7, height: 26.8, parent: 0, depth: 1 },
			{ x: 870.4, y: 547, width: 58, height: 25.6, parent: 1, depth: 2 },
			{ x: 870.4, y: 655.8, width: 84, height: 25.6, parent: 1, depth: 2 },
		];
		const links = buildMiniMapLinks(marks, 'chainRail');
		// 一级：根右缘 723 → 首个一级左缘 827（同一中心线 509.6）
		expectPoint(links[0]?.from, 723, 509.6);
		expectPoint(links[0]?.to, 827, 509.6);
		expect(links[0]?.tier).toBe(1);
		// 兄弟横链：前一个一级的右缘 913.7 → 下一个一级的左缘 1152.4（画布实测同一形态）
		expectPoint(links[1]?.from, 913.7, 509.6);
		expectPoint(links[1]?.to, 1152.4, 509.6);
		expect(links[1]?.tier).toBe(1);
		// 一段兄弟链只连到第二个一级为止，不额外多画「根 → 第二个一级」
		expect(
			links.filter((link) => link.tier === 1 && link.to.x === 1152.4),
		).toHaveLength(1);
		// 二级竖轨：827 + 0.6×(870.4 − 827) = 853.04，从父底 523 到最后一个子中心
		const rail = links.find(
			(link) => Math.abs(link.from.x - 853.04) < 0.01 && link.from.y === 523,
		);
		expect(rail?.to.y).toBeCloseTo(668.6, 1);
		// 轨道与横档共用「竖轨 + 横档」helper：轨道 tier 取第一子（深层 = 浅色）
		expect(rail?.tier).toBe(2);
		// 横档到子左边界
		const stub = links.find(
			(link) =>
				Math.abs(link.from.x - 853.04) < 0.01 && link.to.x === 870.4,
		);
		expect(stub?.from.y).toBeCloseTo(559.8, 1);
	});

	it('未知形态名退回左右分支（防御：模式由映射函数给出，不该出现）', () => {
		const marks: MiniMapMark[] = [
			{ x: 0, y: 0, width: 100, height: 40, root: true, depth: 0 },
			{ x: 300, y: 200, width: 100, height: 40, parent: 0, depth: 1 },
		];
		const links = buildMiniMapLinks(marks, 'branchH');
		expect(links).toHaveLength(1);
		expect(links[0]?.elbow).toEqual({ axis: 'h', at: 220 });
	});
});

describe('fishboneConnectors：水平骨干 + 45° 短骨 + 斜脊折线', () => {
	/** 实测形态（fixtures/_probe-acceptance.md）：一级兄弟落在同一条 45° 斜线上 */
	const root: MiniMapMark = {
		x: 452,
		y: 405,
		width: 179,
		height: 29,
		root: true,
		depth: 0,
	};
	const bone: MiniMapMark = {
		x: 764,
		y: 334,
		width: 88,
		height: 27,
		parent: 0,
		depth: 1,
	};
	const kidA: MiniMapMark = {
		x: 892,
		y: 232,
		width: 500,
		height: 74,
		parent: 1,
		depth: 2,
	};
	const kidB: MiniMapMark = {
		x: 1357,
		y: -233,
		width: 58,
		height: 26,
		parent: 1,
		depth: 2,
	};
	const kidC: MiniMapMark = {
		x: 3982,
		y: -2858,
		width: 84,
		height: 26,
		parent: 1,
		depth: 2,
	};

	it('骨干是水平线：根右缘 → 最右一级的斜骨落点（不是根到每骨的放射线）', () => {
		const lines = fishboneConnectors([root, bone]);
		expect(lines).toHaveLength(2);
		// 骨干：y 恒定（水平）；终点 = 子左缘 - 45° 偏移（子节点底边距骨干 58.5）
		expect(lines[0]).toEqual([
			{ x: 631, y: 419.5 },
			{ x: 705.5, y: 419.5 },
		]);
		// 斜骨：骨干上的落点 → 子节点朝骨干那一侧的角点（上侧骨落底左角）
		expect(lines[1]).toEqual([
			{ x: 705.5, y: 419.5 },
			{ x: 764, y: 361 },
		]);
	});

	it('斜脊：骨块外缘 left+0.3×宽 → 各子节点朝外角点（上侧取左上角）', () => {
		const lines = fishboneConnectors([root, bone, kidC, kidA, kidB]);
		expect(lines).toHaveLength(3);
		// 起点 = 骨块顶边（上侧骨的外缘）x = 764 + 88×0.3；折点 = 子块左上角
		expect(lines[2]).toEqual([
			{ x: 790.4, y: 334 },
			{ x: 892, y: 232 },
			{ x: 1357, y: -233 },
			{ x: 3982, y: -2858 },
		]);
	});

	it('没有根标记 → 不出线（不猜）', () => {
		expect(fishboneConnectors([bone, kidA])).toEqual([]);
	});
});

describe('buildMiniMapSvg：鱼骨形态与正交形态的差别', () => {
	const content = { x: 452, y: -2858, width: 3614, height: 3292 };
	const panel = { width: 220, height: 184 };
	const marks: MiniMapMark[] = [
		{ x: 452, y: 405, width: 179, height: 29, root: true, depth: 0 },
		{ x: 764, y: 334, width: 88, height: 27, parent: 0, depth: 1 },
		{ x: 892, y: 232, width: 500, height: 74, parent: 1, depth: 2 },
		{ x: 1357, y: -233, width: 58, height: 26, parent: 1, depth: 2 },
		{ x: 3982, y: -2858, width: 84, height: 26, parent: 1, depth: 2 },
	];

	const pathsOf = (svg: string): string[] =>
		[...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1] ?? '');

	it('正交形态：一级 1 条 + 二级 3 条（按 parent 逐条折角）', () => {
		const svg = buildMiniMapSvg(content, marks, panel, MINIMAP_FALLBACK_COLORS);
		expect(pathsOf(svg)).toHaveLength(4);
	});

	it('鱼骨形态：水平骨干 1 + 斜骨 1 + 脊 1，且脊上没有竖直母线（x 严格递增）', () => {
		const svg = buildMiniMapSvg(
			content,
			marks,
			panel,
			MINIMAP_FALLBACK_COLORS,
			'straight',
			'fishbone',
		);
		const paths = pathsOf(svg);
		expect(paths).toHaveLength(3);
		const pointsOf = (path: string): Array<{ x: number; y: number }> =>
			[...path.matchAll(/[ML]([-\d.]+)[ ,]([-\d.]+)/g)].map((match) => ({
				x: Number(match[1]),
				y: Number(match[2]),
			}));
		// 骨干：两点 y 必须相同（画布上是一条水平线）
		const spine = pointsOf(paths[0] ?? '');
		expect(spine[0]?.y).toBe(spine[1]?.y);
		// 斜骨：45° ⇒ 面板上（等比缩放）dx 与 dy 的绝对值相等（坐标保留一位小数，容差 0.2）
		const stub = pointsOf(paths[1] ?? '');
		const dx = Math.abs((stub[1]?.x ?? 0) - (stub[0]?.x ?? 0));
		const dy = Math.abs((stub[1]?.y ?? 0) - (stub[0]?.y ?? 0));
		expect(dx).toBeGreaterThan(2);
		expect(Math.abs(dx - dy)).toBeLessThanOrEqual(0.2);
		// 脊：一条没有竖直母线的折线（x 严格递增）
		const rib = pointsOf(paths[2] ?? '');
		expect(rib.length).toBeGreaterThan(2);
		for (let i = 1; i < rib.length; i++) {
			expect(rib[i]?.x).toBeGreaterThan(rib[i - 1]?.x ?? 0);
		}
	});

	it('鱼骨形态不补第三层（斜脊已是骨架；「补到第三层」只适用于正交布局）', () => {
		const deepFish: MiniMapMark[] = [
			...marks,
			{ x: 1000, y: -3300, width: 60, height: 26, parent: 2, depth: 3 },
		];
		const svg = buildMiniMapSvg(
			content,
			deepFish,
			panel,
			MINIMAP_FALLBACK_COLORS,
			'straight',
			'fishbone',
		);
		// 骨干 1 + 斜骨 1 + 脊 1；三级支线不上图
		expect(pathsOf(svg)).toHaveLength(3);
	});

	it('鱼骨形态忽略 lineStyle（固定布局恒折线，不出贝塞尔）', () => {
		const svg = buildMiniMapSvg(
			content,
			marks,
			panel,
			MINIMAP_FALLBACK_COLORS,
			'curve',
			'fishbone',
		);
		expect(svg).not.toContain('C');
		expect(svg).toContain('fill="none"');
	});
});
