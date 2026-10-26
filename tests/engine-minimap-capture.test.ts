/**
 * `captureMiniMap` / `measureMiniMapContent`（小地图的引擎读取面）回归。
 *
 * 为什么必须有这一层直测：`features/view-minimap` 的会话测试把这两个函数整体
 * mock 掉了（它断言的是「何时画、何时藏」），于是「主题色从哪读、缺失回落什么、
 * lineStyle 未知怎么办、鱼骨族怎么分派、面板高度上限怎么传、异常怎么收场」
 * 六件事**没有任何用例覆盖**——而它们全是 `unknown` 收窄与回落判定，最容易在
 * 换引擎版本时静默漂移（色值读错只会让缩略图变灰，不会报错）。
 *
 * vendor cjs 以 vi.mock 桩替代（与 engine-node-move 同款）：本文件只验纯映射，
 * 不需要真实引擎（也避免 Node 下引擎顶层求值触碰 document）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MINIMAP_LINK_MAX_DEPTH,
	MINIMAP_LINK_NODE_LIMIT,
} from '../src/core/constants';
import { captureMiniMap, measureMiniMapContent } from '../src/engine/mindmap';
import type { MindMap } from '../vendor/simple-mind-map.cjs';

vi.mock('../vendor/simple-mind-map.cjs', () => ({
	MindMap: class {},
	MindMapNode: class {},
	DoExport: class {},
	Select: class {},
	TouchEvent: class {},
	AssociativeLine: class {},
	KeyboardNavigation: class {},
	Search: class {},
	Drag: class {},
}));

/** 渲染树节点（只带几何面的最小形态） */
interface GeoNode {
	left: number;
	top: number;
	width: number;
	height: number;
	children?: GeoNode[];
}

interface StubOptions {
	root?: GeoNode | null;
	canvas?: { width: number; height: number } | null;
	layout?: unknown;
	theme?: unknown;
}

/** 引擎桩：只实现本文件会用到的读取面（el 矩形 / width / opt.layout / themeConfig / renderer.root） */
function makeEngine(options: StubOptions = {}): MindMap {
	const {
		root = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: [
				{ left: 200, top: 0, width: 80, height: 30 },
				{ left: 200, top: 100, width: 80, height: 30 },
			],
		},
		canvas = { width: 800, height: 600 },
		layout = 'logicalStructure',
		theme = {
			backgroundColor: '#ffffff',
			lineColor: '#334155',
			lineStyle: 'straight',
			node: { fillColor: '#f8fafc', borderColor: '#94a3b8' },
			root: { fillColor: '#1e293b' },
		},
	} = options;
	return {
		width: canvas?.width ?? 0,
		height: canvas?.height ?? 0,
		el: canvas
			? {
					getBoundingClientRect: () => ({
						left: 0,
						top: 0,
						width: canvas.width,
						height: canvas.height,
					}),
				}
			: null,
		opt: { layout },
		themeConfig: theme,
		renderer: { root },
	} as unknown as MindMap;
}

/** data URL → SVG 字符串（断言用；与 `toDataUrl` 的编码口径对称） */
function svgOf(image: string): string {
	const comma = image.indexOf(',');
	return comma >= 0 ? decodeURIComponent(image.slice(comma + 1)) : '';
}

function countOf(svg: string, pattern: RegExp): number {
	return svg.match(pattern)?.length ?? 0;
}

describe('captureMiniMap：一帧缩略图的读取面', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('正常取一帧：映射基准是全量节点盒、面板按比例、图是 SVG data URL、带指纹', () => {
		const frame = captureMiniMap(makeEngine());
		expect(frame).not.toBeNull();
		if (!frame) {
			return;
		}
		// 全量包围盒（200+80 宽、100+30 高），不是抽样结果
		expect(frame.content).toEqual({ x: 0, y: 0, width: 280, height: 130 });
		expect(frame.canvas).toEqual({ width: 800, height: 600 });
		// 内容 280×130 等比装入 220 宽：220×102（宽到上限、高度按比例）
		expect(frame.panel).toEqual({ width: 220, height: 102 });
		expect(frame.image.startsWith('data:image/svg+xml')).toBe(true);
		expect(frame.signature).toBeTypeOf('number');
		// 2 个子节点 + 根 = 3 块（+1 背景）
		expect(countOf(svgOf(frame.image), /<rect/g)).toBe(4);
	});

	it('面板高度上限 = 画布高 × 0.6（竖长内容长到上限、宽度收下限）', () => {
		const frame = captureMiniMap(
			makeEngine({
				root: { left: 0, top: 0, width: 100, height: 2000 },
			}),
		);
		expect(frame?.panel).toEqual({ width: 160, height: 360 });
	});

	it('主题缺失 / 字段不是字符串 → 回落中性灰（不再读未定义值进 SVG）', () => {
		// 注意：解构默认值对 `undefined` 生效，故「主题缺失」用 null 表达
		const missing = captureMiniMap(makeEngine({ theme: null }));
		expect(missing).not.toBeNull();
		const missingSvg = svgOf(missing?.image ?? '');
		expect(missingSvg).toContain('#888888');
		expect(missingSvg).not.toContain('undefined');

		// 字段在但类型不对（数字 / 空串）：同样回落中性灰
		const wrong = captureMiniMap(
			makeEngine({
				theme: {
					backgroundColor: 42,
					lineColor: '   ',
					node: { borderColor: null },
					root: { fillColor: {} },
				},
			}),
		);
		const wrongSvg = svgOf(wrong?.image ?? '');
		expect(wrongSvg).toContain('#888888');
		expect(wrongSvg).not.toContain('undefined');
	});

	it('描边色透明 → 墨色回落填充色 / 连线色（无边框主题不能让节点块消失）', () => {
		// 主题侧 2026-10-25 已改为「只归零 borderWidth、保留 borderColor」；
		// 这条守的是主题数据再写出透明色时的兜底（透明＝画不出来，不能照抄）
		const byFill = captureMiniMap(
			makeEngine({
				theme: {
					backgroundColor: '#ffffff',
					lineColor: '#94a3b8',
					node: { fillColor: '#f8fafc', borderColor: 'transparent' },
					root: { fillColor: '#4a90d9' },
				},
			}),
		);
		const fillSvg = svgOf(byFill?.image ?? '');
		expect(fillSvg).toContain('fill="#f8fafc"');
		expect(fillSvg).not.toContain('fill="transparent"');

		// 填充也透明（alpha 0 的 rgba 同样算「画不出来」）→ 退到连线色
		const byLine = captureMiniMap(
			makeEngine({
				theme: {
					backgroundColor: '#ffffff',
					lineColor: '#94a3b8',
					node: { fillColor: 'rgba(0, 0, 0, 0)', borderColor: 'TRANSPARENT' },
					root: { fillColor: '#4a90d9' },
				},
			}),
		);
		const lineSvg = svgOf(byLine?.image ?? '');
		expect(lineSvg).toContain('fill="#94a3b8"');
		expect(lineSvg).not.toContain('fill="transparent"');
	});

	it('lineStyle：curve 出贝塞尔、straight 与未知值一律折线', () => {
		const curve = captureMiniMap(
			makeEngine({
				theme: { lineStyle: 'curve', lineColor: '#334155' },
			}),
		);
		expect(countOf(svgOf(curve?.image ?? ''), /C[-\d.]/g)).toBeGreaterThan(0);
		for (const lineStyle of ['straight', 'auto', 42]) {
			const frame = captureMiniMap(
				makeEngine({ theme: { lineStyle, lineColor: '#334155' } }),
			);
			const svg = svgOf(frame?.image ?? '');
			expect(svg).not.toMatch(/C[-\d.]/);
			expect(svg).toMatch(/L[-\d.]/);
		}
	});

	it('布局分派：鱼骨族走「水平骨干 + 每骨斜骨 + 斜脊」，其余按 parent 逐条折角', () => {
		const tree: GeoNode = {
			left: 0,
			top: 0,
			width: 100,
			height: 40,
			children: [
				{
					left: 200,
					top: 0,
					width: 80,
					height: 30,
					children: [
						{ left: 400, top: -20, width: 60, height: 20 },
						{ left: 400, top: 40, width: 60, height: 20 },
					],
				},
				{
					left: 200,
					top: 120,
					width: 80,
					height: 30,
					children: [
						{ left: 400, top: 100, width: 60, height: 20 },
						{ left: 400, top: 160, width: 60, height: 20 },
					],
				},
			],
		};
		// 正交：1 级 2 条 + 2 级 4 条 = 6
		const orthogonal = captureMiniMap(makeEngine({ root: tree }));
		expect(countOf(svgOf(orthogonal?.image ?? ''), /<path/g)).toBe(6);
		// 鱼骨：水平骨干 1 + 斜骨 2（每骨一截）+ 斜脊 2 = 5（不再逐条折角、也不是放射线）
		const fishbone = captureMiniMap(
			makeEngine({ root: tree, layout: 'fishbone2' }),
		);
		expect(countOf(svgOf(fishbone?.image ?? ''), /<path/g)).toBe(5);
	});

	it('> 阈值且深度超限 ⇒ 只画前 7 层（第 8 层及更深全剪）', () => {
		// 单链深 8，再加第 9 层的 500 个末梢：总数 509 > 500 ⇒ shallow；
		// 深度 1…7 各 1 条（共 7），深度 8、9 的 501 条全剪
		const root: GeoNode = { left: 0, top: 0, width: 100, height: 40 };
		let cursor = root;
		for (let depth = 1; depth <= 8; depth++) {
			const child: GeoNode = {
				left: depth * 200,
				top: 0,
				width: 80,
				height: 20,
			};
			cursor.children = [child];
			cursor = child;
		}
		cursor.children = Array.from({ length: 500 }, (_, i) => ({
			left: 1800,
			top: i * 10,
			width: 60,
			height: 8,
		}));

		const svg = svgOf(captureMiniMap(makeEngine({ root }))?.image ?? '');
		expect(MINIMAP_LINK_MAX_DEPTH).toBe(7);
		expect(countOf(svg, /<path/g)).toBe(7);
		// 方块一个不少：509 个节点 + 1 背景
		expect(countOf(svg, /<rect/g)).toBe(510);
	});

	it('> 阈值但只有 1 层 ⇒ 等于全画（浅宽/星形不受约束，既定取舍）', () => {
		// 511 个节点（越过 500 门槛），深度只有 1 ⇒ 规则对深度不生效
		const kids = Array.from(
			{ length: MINIMAP_LINK_NODE_LIMIT + 10 },
			(_, i) => ({ left: 200, top: i * 4, width: 80, height: 3 }),
		);
		const svg = svgOf(
			captureMiniMap(
				makeEngine({
					root: { left: 0, top: 0, width: 100, height: 40, children: kids },
				}),
			)?.image ?? '',
		);
		expect(countOf(svg, /<path/g)).toBe(MINIMAP_LINK_NODE_LIMIT + 10);
		expect(countOf(svg, /<rect/g)).toBe(MINIMAP_LINK_NODE_LIMIT + 12);
	});

	it('传入已测好的全树几何时按它取图（判据与取图共用一份，不再重测）', () => {
		const measured = {
			bounds: { x: 10, y: 20, width: 500, height: 400 },
			total: 2,
		};
		const frame = captureMiniMap(makeEngine(), measured);
		expect(frame?.content).toEqual(measured.bounds);
	});

	it('传入画布尺寸时不再读实时矩形（门禁/判据/取图共用同一次读数）', () => {
		const engine = makeEngine();
		const el = (
			engine as unknown as { el: { getBoundingClientRect: () => unknown } }
		).el;
		const rect = vi.spyOn(el, 'getBoundingClientRect');

		const frame = captureMiniMap(engine, null, { width: 1000, height: 800 });
		expect(rect).not.toHaveBeenCalled();
		// 尺寸原样回吐，面板高度上限跟着它算（1000×800 下 220 宽不受上限约束）
		expect(frame?.canvas).toEqual({ width: 1000, height: 800 });
		expect(frame?.panel).toEqual({ width: 220, height: 102 });
	});

	it('显式传 null 视为「画布不可得」，不回落自测（与 undefined 区分）', () => {
		expect(captureMiniMap(makeEngine(), null, null)).toBeNull();
	});

	it('几何不可得 → null（各一条：无引擎 / 画布零尺寸 / 渲染树未回填）', () => {
		expect(captureMiniMap(null)).toBeNull();
		expect(captureMiniMap(makeEngine({ canvas: null }))).toBeNull();
		expect(captureMiniMap(makeEngine({ root: null }))).toBeNull();
	});

	it('取图内部抛错 → 返回 null，且同一根因只留痕一次（节拍每 30s 都会到）', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const engine = makeEngine();
		Object.defineProperty(engine, 'themeConfig', {
			get() {
				throw new Error('boom');
			},
		});

		expect(captureMiniMap(engine)).toBeNull();
		expect(captureMiniMap(engine)).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe('measureMiniMapContent：判据与取图共用的那次测量', () => {
	it('给出全量包围盒 + 全量节点数（连线判据用）', () => {
		const measured = measureMiniMapContent(
			makeEngine({
				root: {
					left: 0,
					top: 0,
					width: 100,
					height: 40,
					children: [
						{
							left: 200,
							top: 0,
							width: 80,
							height: 30,
							children: [{ left: 400, top: 0, width: 60, height: 20 }],
						},
					],
				},
			}),
		);
		expect(measured).toEqual({
			bounds: { x: 0, y: 0, width: 460, height: 40 },
			total: 3,
		});
	});

	it('无引擎 / 渲染树未回填 → null', () => {
		expect(measureMiniMapContent(null)).toBeNull();
		expect(measureMiniMapContent(makeEngine({ root: null }))).toBeNull();
	});
});
