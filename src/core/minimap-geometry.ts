/**
 * 小地图的纯几何与绘制模型（**无 DOM、无引擎依赖**）。
 *
 * 收口缘由：面板尺寸、缩略图 SVG、视口框投影、开关节拍全是同一套「内容盒 →
 * 面板坐标」换算。分开写在视图层/引擎层会让同一个变换出现多份（框用一份、
 * 图用一份，改一处必漂移），故集中在此，调用方只负责取数据与装配 DOM。
 *
 * 产品口径（2026-10-24 三轮定稿，2026-10-25 补连线两条）：
 * - 宽度收在 160–220、**高度随内容比例**变（底边钉住，只向上长）；
 * - 缩略图**按原图输出**：节点是带描边的小方块、连线沿用画布的折线/曲线样式
 *   （曾试过「密度块」抽象，用户判定太丑，已回退）；
 * - 连线**按布局五态**复刻画布（`connectorModeForLayout` → `buildMiniMapLinks`），
 *   画不画由节点数门槛决定（`MINIMAP_LINK_NODE_LIMIT`），与抽样是两条独立预算；
 * - 节点过多时才按步长抽样（超过 `MINIMAP_MAX_MARKS`），保证 SVG 体积可控；
 * - 视口框由当前变换**本地投影**得出（不依赖引擎重算缩略图）。
 */
import {
	MINIMAP_LINK_MAX_DEPTH,
	MINIMAP_MAX_HEIGHT_PX,
	MINIMAP_MAX_MARKS,
	MINIMAP_MIN_HEIGHT_PX,
	MINIMAP_MIN_WIDTH_PX,
	MINIMAP_WIDTH_PX,
} from './constants';

/** 轴对齐盒（内容布局坐标或面板像素，由上下文决定） */
export interface MiniMapBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MiniMapSize {
	width: number;
	height: number;
}

/**
 * 面板尺寸：按内容比例「等比装入」宽 220 的框，再把宽高压回各自区间。
 *
 * 2026-10-24 二轮修正：原先宽度**恒为 220**，高瘦内容会被压到中间、左右各留
 * 23px 空白（有效像素浪费 21%）。现在宽度跟着绘图区走（160–220），面板几乎
 * 等于绘图区本身；只有在触到宽度下限（极瘦内容）时才仍会留白。
 *
 * 2026-10-24 三轮裁决（用户）：「极端比例**开放高度**更合适」——高度上限不再
 * 是固定 280，而由调用方按**画布可用高度**传入（见 `maxHeight`）。于是高瘦内容
 * 是「把面板长到能用的高度」，而不是「把宽度压到 160 以下」。宽度下限仍保留：
 * 再窄就放不下「根 + 两级」的横向层级（极端比例仍会留白，属已知边界）。
 *
 * `maxHeight` 的缺省 `MINIMAP_MAX_HEIGHT_PX`（280）只服务裸调用（测试 / 兜底）；
 * 生产路径恒传「画布高 × `MINIMAP_MAX_HEIGHT_RATIO`」。
 *
 * 内容几何不可得（零/负数）返回 null——调用方保持上一帧，不画半张图。
 */
export function computeMiniMapSize(
	content: MiniMapSize,
	maxHeight: number = MINIMAP_MAX_HEIGHT_PX,
): MiniMapSize | null {
	if (!(content.width > 0) || !(content.height > 0)) {
		return null;
	}
	// 上限先夹到最小高度，避免调用方传入退化值（画布极矮）时算出 0
	const heightCap = Math.max(MINIMAP_MIN_HEIGHT_PX, maxHeight);
	const scale = Math.min(MINIMAP_WIDTH_PX / content.width, heightCap / content.height);
	const height = Math.max(
		MINIMAP_MIN_HEIGHT_PX,
		Math.round(content.height * scale),
	);
	const width = Math.min(
		MINIMAP_WIDTH_PX,
		Math.max(MINIMAP_MIN_WIDTH_PX, Math.round(content.width * scale)),
	);
	return { width, height };
}

/**
 * 内容盒 → 面板的等比缩放（面板内留白由调用方各自居中）。
 *
 * 投影视口框、拼缩略图 SVG、拖拽换算**三处共用这一份**：它们必须是同一个
 * 比例，否则框会偏离图上的节点（此前三处各写一遍 `Math.min(...)`，改一处必漂移）。
 * 内容或面板退化（宽高 ≤ 0）返回 0，调用方按「不可映射」处理。
 */
export function miniMapScale(content: MiniMapSize, panel: MiniMapSize): number {
	if (
		!(content.width > 0) ||
		!(content.height > 0) ||
		!(panel.width > 0) ||
		!(panel.height > 0)
	) {
		return 0;
	}
	return Math.min(
		panel.width / content.width,
		panel.height / content.height,
	);
}

/**
 * 小地图启用判据：**100% 缩放下**内容是否装不进画布。
 *
 * 与当前缩放无关——用户缩到 50% 看全图时小地图不该消失（否则会随缩放闪烁）。
 * 容差 1px 用于吸收渲染树节点盒（布局阶段写入的浮点坐标）的亚像素误差，
 * 避免临界尺寸反复翻转。
 */
export function contentExceedsCanvas(
	content: MiniMapSize,
	canvas: MiniMapSize,
	tolerance = 1,
): boolean {
	return (
		content.width > canvas.width + tolerance ||
		content.height > canvas.height + tolerance
	);
}

/** 视口框投影的输入（全部为**布局坐标**，不含 DOM） */
export interface MiniMapProjectionInput {
	/** 内容盒（布局坐标） */
	content: MiniMapBox;
	/** 面板尺寸（像素） */
	panel: MiniMapSize;
	/** 画布尺寸（像素） */
	canvas: MiniMapSize;
	/** 当前画布变换（内容 → 画布） */
	transform: {
		scaleX: number;
		scaleY: number;
		translateX: number;
		translateY: number;
	};
}

/**
 * 视口框的**外框厚度**（像素）= 左右（上下）各 2px 边框之和。
 *
 * 为什么要进几何层：`box-sizing: border-box` 下，指定的 `width/height` 小于边框
 * 总和时浏览器**不缩边框**，实际外框恒为 4px；而 `left/top` 是唯一锚点，多出的
 * 厚度只会朝**右/下**伸出。面板是 `overflow: hidden`（圆角裁图），于是右/下两条
 * 边被裁掉、左/上因为朝面板内侧反而完整——实机症状「视口移出小地图时右下边框
 * 消失、左上还在」（2026-10-25 实机取证：右下外侧 rect 4×4 落在面板外、左上外侧
 * 同样 4×4 落在面板内）。
 *
 * ⚠ 与 `styles.css` 的 `.mindmap-minimap-view { border: 2px }` 同值：改边框宽度
 * 必须同步这里，否则贴边一侧会重新溢出。
 */
const FRAME_PX = 4;

/**
 * 当前视口在小地图上的矩形（像素坐标，**已夹到面板内**）。
 *
 * 换算：画布可视区 [0, W]×[0, H] 反变换到布局坐标 = [(0-tx)/sx, (W-tx)/sx]，
 * 再按缩略比例投到面板。越界一侧压到贴边，且**外框整体落在面板内**（见 `fitSpan`）。
 */
export function projectViewportBox(
	input: MiniMapProjectionInput,
): MiniMapBox | null {
	const { content, panel, canvas, transform } = input;
	if (
		!(content.width > 0) ||
		!(content.height > 0) ||
		!(panel.width > 0) ||
		!(panel.height > 0) ||
		!(canvas.width > 0) ||
		!(canvas.height > 0) ||
		!(transform.scaleX > 0) ||
		!(transform.scaleY > 0)
	) {
		return null;
	}
	const miniScale = miniMapScale(content, panel);
	if (!(miniScale > 0)) {
		return null;
	}
	const offsetX = (panel.width - content.width * miniScale) / 2;
	const offsetY = (panel.height - content.height * miniScale) / 2;
	const viewX = -transform.translateX / transform.scaleX;
	const viewY = -transform.translateY / transform.scaleY;
	const viewW = canvas.width / transform.scaleX;
	const viewH = canvas.height / transform.scaleY;

	const horizontal = fitSpan(
		offsetX + (viewX - content.x) * miniScale,
		offsetX + (viewX + viewW - content.x) * miniScale,
		panel.width,
	);
	const vertical = fitSpan(
		offsetY + (viewY - content.y) * miniScale,
		offsetY + (viewY + viewH - content.y) * miniScale,
		panel.height,
	);
	return {
		x: horizontal.start,
		y: vertical.start,
		width: horizontal.size,
		height: vertical.size,
	};
}

/**
 * 一维落位：可视区先夹进面板（越界即贴边），再保证**外框**完整落在面板内。
 *
 * 第二步不可省。视口整个落在右侧外时 `start` 被夹到面板右缘、`size` 归零，
 * 但 CSS 仍按 `FRAME_PX` 画（边框不缩），这 4px 会**全部**落在面板外被
 * `overflow: hidden` 裁掉；同样的情形发生在左缘时，4px 是朝面板内侧长的，看起来
 * 正常——「右下不见、左上还在」的全部来源。
 *
 * 退化带（剩余空间 < 外框厚度）里框会向内让位，左边缘最多偏移 `FRAME_PX - 剩余`：
 * 宁可少几像素精度，也不让整条边框消失（产品口径：越界时四边都要看得见）。
 */
function fitSpan(
	rawStart: number,
	rawEnd: number,
	total: number,
): { start: number; size: number } {
	const start = clamp(rawStart, 0, total);
	// 先与面板求交再算尺寸：视口整个在图外时两端会夹到同一侧，尺寸必须归零
	const size = Math.max(0, clamp(rawEnd, 0, total) - start);
	if (size >= FRAME_PX) {
		return { start, size };
	}
	const frame = Math.min(FRAME_PX, total);
	return { start: clamp(start, 0, Math.max(0, total - frame)), size: frame };
}

// ---------------------------------------------------------------------------
// 缩略图模型（按原图：节点方块 + 连线）
// ---------------------------------------------------------------------------

/** 一帧缩略图的**映射几何**（内容盒 + 面板尺寸 + 标记指纹；判定「换没换图」只看这三项） */
export interface MiniMapFrameGeometry {
	content: MiniMapBox;
	panel: MiniMapSize;
	/** 标记指纹（`buildMiniMapMarks` 的 `signature`） */
	signature: number;
}

/**
 * 两帧缩略图是否等价（= 同一个布局、同一张图）。
 *
 * 用途唯一：切布局后要等引擎重排落地才补画，而重排是**分片**的——落地事件
 * 可能仍早于位置回填，此时取样会得到与上一帧**完全相同**的几何。若不判等，
 * 就会把旧图重画一遍、还白消耗 30s 刷新窗口（实机症状：切了布局小图不动）。
 *
 * 容差 0.5px 只吸收亚像素抖动；布局一变，内容盒必然整体位移，绝无假阳性。
 * 面板尺寸用严格相等：它由 `computeMiniMapSize` 对同一内容盒确定性算出，
 * 差 1px 就说明取样自不同几何。
 *
 * **再加标记指纹**（2026-10-24 四轮修）：只比外框时，「内容盒恰好相同、
 * 内部排布不同」的两套布局会被误判成同帧，于是跳过重画、小图停在上一套布局
 * （`drawWhenLanded` 会把标记当作已消费）。指纹取整像素，亚像素抖动不影响。
 */
export function sameMiniMapFrame(
	a: MiniMapFrameGeometry,
	b: MiniMapFrameGeometry,
): boolean {
	const sameBox = (p: MiniMapBox, q: MiniMapBox): boolean =>
		Math.abs(p.x - q.x) <= 0.5 &&
		Math.abs(p.y - q.y) <= 0.5 &&
		Math.abs(p.width - q.width) <= 0.5 &&
		Math.abs(p.height - q.height) <= 0.5;
	return (
		sameBox(a.content, b.content) &&
		a.panel.width === b.panel.width &&
		a.panel.height === b.panel.height &&
		a.signature === b.signature
	);
}

/**
 * 渲染树节点的几何面（引擎侧只需原样传入 `renderer.root`）。
 *
 * 只声明用到的四个字段：`left/top/width/height` 由布局阶段写入，性能模式下
 * 视口外节点只是被摘下 group，几何仍在——所以不必物化 DOM 就能画缩略图。
 *
 * 字段语义（vendor 实读）：`get left() { return this.customLeft || this._left }`
 * ——拖拽调整过位置的节点用 `customLeft/customTop`，渲染与裁剪判定同样读它，
 * 故这里读到的是**屏上位置**，与画布一致。
 */
export interface MiniMapGeometryNode {
	readonly left?: number;
	readonly top?: number;
	readonly width?: number;
	readonly height?: number;
	readonly children?: readonly MiniMapGeometryNode[];
	/**
	 * 引擎节点数据（可选，只读 `data.borderColor` / `data.fillColor`）。
	 *
	 * 节点级配色指令把颜色写进节点 data（`engine/mindmap-colors`），缩略图据此
	 * **逐块**上色；没有这两个键的节点照旧用主题墨色（`MiniMapColors.nodeBorder`）。
	 * 声明成结构类型而不是引入引擎类型：本模块保持零引擎依赖（可直接测）。
	 */
	readonly nodeData?: { readonly data?: Record<string, unknown> };
}

/**
 * 缩略图上的一个节点标记。
 *
 * `parent` 为父标记下标。抽样（> `MINIMAP_MAX_MARKS`）可能把父抽掉而留下子——
 * 此时那条边画不出：`childrenIndex` 与 `branchLinks` 按「无父」跳过。这是**可达**
 * 路径（>2000 节点必 > `MINIMAP_LINK_NODE_LIMIT`，走 `shallow` 档但仍在画线），
 * 不是纯防御。
 */
export interface MiniMapMark extends MiniMapBox {
	parent?: number;
	/**
	 * 根标记（＝DFS 首访节点，`depth === 0` 的派生标记）。
	 *
	 * 两处消费：SVG 用它单独上色（缩略图的第一眼锚点）；连线函数经 `findRoot`
	 * 定位根，再按「父 === 根」区分一级与更深层。
	 */
	root?: boolean;
	/**
	 * 层级（根 = 0）。三处消费：块的浓淡分档、连线 `tier`（一级深 / 二级及更深浅）、
	 * `shallow` 档的深度过滤（`marksWithinDepth`）。**画不画连线本身**由节点数决定，
	 * 与层级无关。
	 */
	depth?: number;
	/**
	 * 该节点的自定义颜色（`%%#hex%%` 指令写入 data 的描边/填充色）。
	 *
	 * 有值时 SVG 给这一块单独写 `fill`（覆盖所在层级的主题墨色）——「小地图按
	 * 节点配色」的唯一落点；无值时仍按层级分档的主题墨色画。
	 */
	color?: string;
}

/** 全树几何的一次测量结果（`measureMiniMapBounds` 的产物，可跨调用复用） */
export interface MiniMapMeasure {
	bounds: MiniMapBox;
	total: number;
}

/** 缩略图取样结果：标记 + 它们的包围盒（映射基准） */
export interface MiniMapMarksResult {
	marks: MiniMapMark[];
	/**
	 * **全量节点**的包围盒（布局坐标，`measureMiniMapBounds` 的结果）。
	 *
	 * 三条口径约束合起来才成立（2026-10-24 二轮修）：
	 * 1. 它是**全量**的，不受抽样影响——抽样只决定「画多少块」，不决定比例尺；
	 * 2. 它只含节点盒，不含连线/rbox 外扩：rbox 在性能模式下只覆盖已装配子集，
	 *    在常规模式下含连线，同一张图会给出两个尺寸；
	 * 3. 小地图的**启用判据**也用这份口径（`engine/contentExceedsCanvasAtFullScale`），
	 *    判据与映射从此同源——否则临界尺寸下会出现「判据说装不下、图里却大片留白」。
	 */
	bounds: MiniMapBox;
	/**
	 * **全量**节点数（不受抽样影响）：调用方据此决定连线的档位
	 * （`MINIMAP_LINK_NODE_LIMIT`：≤ 阈值全画，> 阈值只画前
	 * `MINIMAP_LINK_MAX_DEPTH` 层，2026-10-25 裁决）。
	 */
	total: number;
	/**
	 * 标记指纹（32 位 FNV-1a，坐标按整像素取整）。
	 *
	 * 用途唯一：`sameMiniMapFrame` 判「换没换图」。只比包围盒+面板时，
	 * **内容排布变了但外框恰好相同**的两帧会被误判为同帧、跳过重画（切布局后
	 * 小图停在上一套布局）；同一布局重绘则指纹恒等，不会误判。
	 *
	 * 取整口径与 `sameMiniMapFrame` 的 0.5px 容差一致：亚像素抖动不影响指纹。
	 */
	signature: number;
}

/**
 * 渲染树的**全量**几何包围盒 + 节点数（布局坐标；纯函数、零 DOM）。
 *
 * 这是「内容有多大」的**唯一回答**，三个消费方共用：
 * - 小地图映射基准（经 `buildMiniMapMarks` 的 `bounds`）；
 * - 小地图启用判据（`engine/contentExceedsCanvasAtFullScale`）；
 * - 「画不画连线」的节点数判据（`engine/captureMiniMap` 按 `total` 与
 *   `MINIMAP_LINK_NODE_LIMIT` 比较，2026-10-25 用户裁决）。
 *
 * 为什么不用 rbox 口径（`engine/mindmap-viewport.measureContentBox`）：常规模式的
 * rbox **含连线与外扩边距**，性能模式只覆盖已装配（DOM）的子集——同一张图会给
 * 出两种尺寸，且都与缩略图实际画的节点块不是一回事。判据与映射用不同盒子时，
 * 临界尺寸会出现「判据说装不下、缩略图却大片留白」（2026-10-24 实机复盘的结论）。
 * （`mindmap-viewport.measureContentBoxFromData` 现也委托本函数：全树节点盒并集
 * 只保留这一份实现。）
 *
 * 无任何可用几何时返回 null（调用方按「不显示」处理）。
 */
export function measureMiniMapBounds(
	root: MiniMapGeometryNode | null,
): MiniMapMeasure | null {
	if (!root) {
		return null;
	}
	let total = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const walk = (node: MiniMapGeometryNode): void => {
		total++;
		const box = toBox(node);
		if (box) {
			minX = Math.min(minX, box.x);
			minY = Math.min(minY, box.y);
			maxX = Math.max(maxX, box.x + box.width);
			maxY = Math.max(maxY, box.y + box.height);
		}
		for (const child of readChildren(node)) {
			walk(child);
		}
	};
	walk(root);
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		return null;
	}
	return {
		bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
		total,
	};
}

/**
 * 从渲染树取出缩略图标记（深度优先；超过 `maxMarks` 时按步长抽样）。
 *
 * 抽样口径（2026-10-25 简化）：**纯 DFS 步长**「每第 k 个留一个」，`k` 由
 * `ceil(total / maxMarks)` 得出 ⇒ 标记数 ≤ `maxMarks + 1`（根恒留）。
 *
 * 为什么不再「浅层必留」：那条规则存在的唯一理由是「连线只画到第 3 层，抽掉父
 * 节点会让连线跨级」。现在画不画连线由**节点数**决定（`MINIMAP_LINK_NODE_LIMIT`，
 * ≤ 500 才画，而 500 < `maxMarks` 2000 ⇒ 画线时根本不抽样），父下标不再承担
 * 连线正确性，规则随之退役——顺带消掉「浅层预算 + 深层步长」两层叠加的复杂度。
 *
 * 根节点始终保留（缩略图的第一眼锚点）。`bounds` 取自 `measureMiniMapBounds`
 * （**全量**、与启用判据同源），不是抽样结果的包围盒——否则抽掉的边界节点会让
 * 比例尺偏小、图被放大到面板外。
 *
 * @param measured 已算好的全树测量（`measureMiniMapBounds`）：判据与取图共用
 *   一份时省一遍全树遍历；不传则本函数自己测。
 */
export function buildMiniMapMarks(
	root: MiniMapGeometryNode | null,
	maxMarks = MINIMAP_MAX_MARKS,
	measured?: MiniMapMeasure | null,
): MiniMapMarksResult | null {
	if (!root) {
		return null;
	}
	const stats = measured ?? measureMiniMapBounds(root);
	if (!stats) {
		return null;
	}
	const stride = Math.max(1, Math.ceil(stats.total / Math.max(1, maxMarks)));
	const marks: MiniMapMark[] = [];
	let seen = 0;
	const walk = (
		node: MiniMapGeometryNode,
		parentIndex: number | undefined,
		depth: number,
	): void => {
		const box = toBox(node);
		let currentParent = parentIndex;
		// 根恒留（缩略图的第一眼锚点）：它是 DFS 首个节点（seen = 0），
		// 0 % stride 恒为 0，无须按 depth 特判
		const sampledIn = seen % stride === 0;
		seen++;
		if (box && sampledIn) {
			const mark: MiniMapMark = { ...box, depth };
			const color = readNodeColor(node);
			if (color) {
				mark.color = color;
			}
			if (parentIndex !== undefined) {
				mark.parent = parentIndex;
			}
			if (depth === 0) {
				mark.root = true;
			}
			marks.push(mark);
			currentParent = marks.length - 1;
		}
		for (const child of readChildren(node)) {
			walk(child, currentParent, depth + 1);
		}
	};
	walk(root, undefined, 0);
	if (marks.length === 0) {
		return null;
	}
	return {
		marks,
		bounds: stats.bounds,
		total: stats.total,
		signature: marksSignature(marks),
	};
}

/**
 * 标记指纹（32 位 FNV-1a）。
 *
 * 坐标按整像素取整：与 `sameMiniMapFrame` 的 0.5px 容差同口径，亚像素抖动
 * 不该让指纹翻脸；而「内部排布变了」必然改变至少一个盒子的整像素坐标。
 * 高瘦/大图下整像素仍能区分（布局位移远大于 1px）。
 */
function marksSignature(marks: readonly MiniMapMark[]): number {
	let hash = 2166136261 >>> 0;
	const mix = (value: number): void => {
		hash ^= value & 0xffffffff;
		hash = Math.imul(hash, 16777619) >>> 0;
	};
	for (const mark of marks) {
		mix(Math.round(mark.x));
		mix(Math.round(mark.y));
		mix(Math.round(mark.width));
		mix(Math.round(mark.height));
		mix((mark.depth ?? 0) + (mark.root === true ? 0x100 : 0));
		// 节点自定义颜色也进指纹：只改颜色不改几何时，帧比较不能把它判成「同一帧」
		if (mark.color) {
			for (let index = 0; index < mark.color.length; index++) {
				mix(mark.color.charCodeAt(index));
			}
		}
	}
	mix(marks.length);
	return hash >>> 0;
}

function readChildren(
	node: MiniMapGeometryNode,
): readonly MiniMapGeometryNode[] {
	const children = node.children;
	return children && children.length > 0 ? children : [];
}

/**
 * 节点块的墨色：**描边 → 填充**（与主题墨色同一条回落链，见 `pickVisibleColor`）。
 * 两者都没有（未上色的节点）返回 null，调用方回落到主题墨色。
 */
function readNodeColor(node: MiniMapGeometryNode): string | null {
	const data = node.nodeData?.data;
	if (!data) {
		return null;
	}
	return pickVisibleColor(data['borderColor'], data['fillColor']);
}

/**
 * 依次取第一个**画得出来**的颜色（`transparent` / alpha 0 视为画不出来）。
 *
 * 两份消费：缩略图的主题墨色（`engine/mindmap-minimap.readInk` 的回落链）与
 * 节点自定义颜色（`readNodeColor`）。放在这里是因为「什么是看得见的颜色」
 * 只有这一处判定，两边各写一份必然在「无边框主题把描边写成透明」这类边界上漂移。
 */
export function pickVisibleColor(...candidates: readonly unknown[]): string | null {
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') {
			continue;
		}
		const value = candidate.trim();
		if (value.length > 0 && !isTransparentColor(value)) {
			return value;
		}
	}
	return null;
}

/** `transparent` 与 alpha 为 0 的 rgb(a) 都等于「不绘制」（自 engine/mindmap-minimap 迁入） */
function isTransparentColor(value: string): boolean {
	const lower = value.toLowerCase();
	if (lower === 'transparent') {
		return true;
	}
	const match = /^rgba?\(([^)]+)\)$/.exec(lower);
	if (!match) {
		return false;
	}
	const parts = (match[1] ?? '').split(',').map((part) => part.trim());
	if (parts.length < 4) {
		return false;
	}
	const alpha = Number(parts[3]);
	return Number.isFinite(alpha) && alpha === 0;
}

function toBox(node: MiniMapGeometryNode | null): MiniMapBox | null {
	if (!node) {
		return null;
	}
	const x = Number(node.left);
	const y = Number(node.top);
	const width = Number(node.width);
	const height = Number(node.height);
	if (
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		!(width > 0) ||
		!(height > 0)
	) {
		return null;
	}
	return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// 连线几何
// ---------------------------------------------------------------------------

/** 连线样式（与引擎 `themeConfig.lineStyle` 同词）：折线＝正交拐折，曲线＝平滑 */
export type MiniMapLineStyle = 'straight' | 'curve';

/** 父子连线的锚点（内容坐标） */
export interface MiniMapConnector {
	/** 父端：朝向子节点那条边的中点 */
	ax: number;
	ay: number;
	/** 子端：朝向父节点那条边的中点 */
	bx: number;
	by: number;
	/** 正交折线的拐点：横向分支为拐点的 x，纵向分支为拐点的 y */
	mid: number;
	/** true＝横向分支（左右相接），false＝纵向分支（上下相接） */
	horizontal: boolean;
}

/**
 * 算一条父子连线的锚点（纯几何；`branchH` 与鱼骨共用）。
 *
 * **两端落在朝向对方的边中点**，与画布同构：左→右的树从父节点右边中点出发、
 * 在兄弟共用的竖直「母线」处折向、再从子节点左边中点进入。
 *
 * **本函数不决定连线形态**——五态由布局写死（`connectorModeForLayout`）。它只在
 * `branchH` 这一态内部选分支方向：有水平间距就左右相接；没有则退化为上下相接
 * （纵向时间轴的一级竖链正是这种退化）。判据取**两盒的相对位置**而非两端中心
 * 距离：布局决定了「子节点在父节点的右侧（或上下）」，纵向落差再大（长文本、
 * 深链）也仍走横向母线。此前按 |dx| 与 |dy| 比大小，纵向一长就误判成上下分支，
 * 线从父节点底边垂直穿出、与小图其余部分完全错位（实机反馈「一级与二级之间
 * 连线错误」）。两盒互相叠压时（极端缩放 / 自由拖拽）退回按中心位移取主轴。
 */
export function connectorAnchors(
	parent: MiniMapBox,
	child: MiniMapBox,
): MiniMapConnector {
	// 有水平间距 ⇒ 横向分支（左右哪一侧由间距方向决定）
	if (child.x >= boxRight(parent) || boxRight(child) <= parent.x) {
		return horizontalAnchors(parent, child, child.x >= boxRight(parent));
	}
	// 否则看纵向间距（组织结构图 / 鱼骨上下分支 / 目录布局）
	if (child.y >= boxBottom(parent) || boxBottom(child) <= parent.y) {
		return verticalAnchors(parent, child, child.y >= boxBottom(parent));
	}
	// 两个盒子互相叠压（极端缩放或自由拖拽造成）：退回按中心位移取主轴
	const dx = boxCenterX(child) - boxCenterX(parent);
	const dy = boxCenterY(child) - boxCenterY(parent);
	return Math.abs(dx) >= Math.abs(dy)
		? horizontalAnchors(parent, child, dx >= 0)
		: verticalAnchors(parent, child, dy >= 0);
}

/**
 * 横向分支的锚点（父右缘 → 0.6 处的竖直母线 → 子左缘，反向同理）。
 *
 * @param toRight 子节点在父节点**右侧**（否则在左侧）
 */
function horizontalAnchors(
	parent: MiniMapBox,
	child: MiniMapBox,
	toRight: boolean,
): MiniMapConnector {
	const ax = toRight ? boxRight(parent) : parent.x;
	const bx = toRight ? child.x : boxRight(child);
	return {
		ax,
		ay: boxCenterY(parent),
		bx,
		by: boxCenterY(child),
		// 折点不在正中：引擎实测水平母线在 60% 处（589→693 折在 651.4）
		mid: ax + HORIZONTAL_ELBOW_RATIO * (bx - ax),
		horizontal: true,
	};
}

/**
 * 纵向分支的锚点（父底中点 → 0.7 处的水平母线 → 子顶中点，反向同理）。
 *
 * @param toBottom 子节点在父节点**下方**（否则在上方）
 */
function verticalAnchors(
	parent: MiniMapBox,
	child: MiniMapBox,
	toBottom: boolean,
): MiniMapConnector {
	const ay = toBottom ? boxBottom(parent) : parent.y;
	const by = toBottom ? child.y : boxBottom(child);
	return {
		ax: boxCenterX(parent),
		ay,
		bx: boxCenterX(child),
		by,
		// 竖直母线同理：实测 70%（524.2→628.2 母线在 597）
		mid: ay + VERTICAL_ELBOW_RATIO * (by - ay),
		horizontal: false,
	};
}

// ---------------------------------------------------------------------------
// 布局固有脊线（鱼骨图）
// ---------------------------------------------------------------------------

/** 布局坐标下的一个点（折线端点） */
export interface MiniMapPoint {
	x: number;
	y: number;
}

/**
 * 连线形态：**按布局分五种**（与引擎各布局的真实画法一一对应，2026-10-25 复刻）。
 *
 * 为什么不能只有一套通用模型：引擎的连线几何是**按布局写死**的，四条独立规则
 * （2026-10-25 实机从 `g.smm-line-container` 的 `<path d>` 逐段量得）：
 * 1. **主轴由布局决定**（组织结构图恒竖直、逻辑结构图恒水平），不是看两盒相对
 *    位置——组织结构图的子节点铺得很宽，很多整体落在父节点左侧，按位置猜会判成
 *    横向分支，线从父左缘横着出去，与画布的「父底中点向下」完全不同；
 * 2. **锚点不同**：左右分支取左右边中点，上下分支取上下边中点，目录/时间轴取
 *    **子节点左边界**（目录的一级还落在左上角）；
 * 3. **折点比例不同**：水平 0.6、竖直 0.7（实测 `589→693` 折在 `651.4`＝0.6；
 *    `524.2→628.2` 母线在 `597`＝0.7）；
 * 4. **拓扑不同**：时间轴一级之间是**兄弟横链**，目录/时间轴深层是**左侧竖轨 +
 *    横档**，都不属于「父子折线」这个形状。
 */
export type MiniMapConnectorMode =
	| 'branchH'
	| 'busV'
	| 'railLeft'
	| 'chainRail'
	| 'fishbone';

/**
 * 缩略图连线的**档位**（2026-10-25 用户裁决，按性能模式阈值分档）：
 * - `all`：全部父子连线（节点数 ≤ `MINIMAP_LINK_NODE_LIMIT`）；
 * - `shallow`：只画**前 `MINIMAP_LINK_MAX_DEPTH` 层**的父子边，更深的一条不画。
 *
 * 不配额、不抽样、不设星形闸：深图只剩浅层骨架，浅宽图（深度不到上限）等于全画
 * ——这是 2026-10-25 明确取舍。方块不受档位影响，永远全画。
 */
export type MiniMapLinkMode = 'all' | 'shallow';

/** 水平母线的折点比例（引擎实测 0.6：父右缘 589 → 子左缘 693，折在 651.4） */
const HORIZONTAL_ELBOW_RATIO = 0.6;
/** 竖直母线的折点比例（引擎实测 0.7：父底 524.2 → 子顶 628.2，母线在 597） */
const VERTICAL_ELBOW_RATIO = 0.7;
/** 目录组织图的左侧竖轨与子节点左边界的固定间距（引擎实测 12px） */
const RAIL_OFFSET_X = 12;

/**
 * 鱼骨斜脊的起点缩进（相对骨块宽度）：引擎 `layouts/Fishbone` 的 `this.indent = 0.3`。
 *
 * 与 45°（`fishboneDeg`）同性质——都是引擎常量、插件不暴露；改引擎默认值时必须同步
 * 这里（K141），否则脊的起点会沿骨块横向漂移。
 */
const FISHBONE_INDENT = 0.3;

/**
 * 布局 → 连线形态（**唯一映射**）。
 *
 * 含 `fishbone2` / `rightFishbone*` / `timeline2` / `verticalTimeline*` 是为了
 * 容错——插件只提供少数几个，但 `data.json` 可能被手工改成引擎支持的同族 id，
 * 届时不该静默退回另一种形态。
 */
export function connectorModeForLayout(
	layout: string | null | undefined,
): MiniMapConnectorMode {
	if (typeof layout !== 'string') {
		return 'branchH';
	}
	if (FISHBONE_LAYOUTS.has(layout)) {
		return 'fishbone';
	}
	if (layout === 'organizationStructure') {
		return 'busV';
	}
	if (layout === 'catalogOrganization') {
		return 'railLeft';
	}
	if (TIMELINE_LAYOUTS.has(layout)) {
		return 'chainRail';
	}
	// 纵向时间轴（`verticalTimeline*`）走左右分支：实测它的深层连线就是「父右缘 →
	// 0.6 处的竖档 → 子左缘」（`M 719.7,602.8 L 752.1,602.8`，`752.1 = 719.7 + 0.6×54`），
	// 一级之间是同一中心线的竖链——正是 `branchH` 的横向分支与竖直退化。
	return 'branchH';
}

const FISHBONE_LAYOUTS = new Set([
	'fishbone',
	'fishbone2',
	'rightFishbone',
	'rightFishbone2',
]);

/** 横向时间轴（一级在同一水平线上串成链）。纵向变体见 `connectorModeForLayout` 的注释 */
const TIMELINE_LAYOUTS = new Set(['timeline', 'timeline2']);

/** 一条连线（布局坐标，纯数据；SVG 装配与测试共用） */
export interface MiniMapLink {
	from: MiniMapPoint;
	to: MiniMapPoint;
	/** 折线拐点：横向母线（`at` 为拐点 x）或纵向母线（`at` 为拐点 y） */
	elbow?: { axis: 'h' | 'v'; at: number };
	/**
	 * 多段折线（已含全部顶点；鱼骨骨干/短骨/斜脊用）——与 `elbow` 二选一。
	 *
	 * 有值时 `from`/`to` 只是**首/末顶点的镜像**（`linkPath` 只读本字段）：保留
	 * 它们是为了让「一条线有起止」的口径对两种形态一致，**不要再往里写别的点**。
	 */
	polyline?: MiniMapPoint[];
	/** 视觉分层：1 = 根与一级（描边较深），2 = 二级及更深（较浅） */
	tier: 1 | 2;
}

/**
 * 未知深度的哨兵（标记未带 `depth` 时用）：比任何真实深度都深——`shallow` 档会把它
 * 剪掉，方块归入最淡一档。三处判定（过滤 / 分档 / tier）共用，勿各写一个字面量。
 */
const UNKNOWN_DEPTH = 99;

const boxRight = (box: MiniMapBox): number => box.x + box.width;
const boxBottom = (box: MiniMapBox): number => box.y + box.height;
const boxCenterX = (box: MiniMapBox): number => box.x + box.width / 2;
const boxCenterY = (box: MiniMapBox): number => box.y + box.height / 2;
const tierOf = (child: MiniMapMark): 1 | 2 =>
	(child.depth ?? UNKNOWN_DEPTH) <= 1 ? 1 : 2;

/**
 * 子节点按**父标记本身**分组（组内保持 marks 顺序，即 DFS 顺序）。
 *
 * 键用标记引用而不是下标：四个连线形态都要「父 + 子列表」两件东西，存下标会让
 * 每个调用点再各写一遍 `kids.map(i => marks[i]).filter(…)`，并多出「下标查不到
 * 标记」这类实际不可能发生的分支。
 *
 * 父不在抽样结果里（或 `parent` 越界）的标记直接跳过——那条边画不出来。
 */
function childrenIndex(
	marks: readonly MiniMapMark[],
): Map<MiniMapMark, MiniMapMark[]> {
	const map = new Map<MiniMapMark, MiniMapMark[]>();
	for (const mark of marks) {
		const parent = mark.parent === undefined ? undefined : marks[mark.parent];
		if (!parent) {
			continue;
		}
		const bucket = map.get(parent);
		if (bucket) {
			bucket.push(mark);
		} else {
			map.set(parent, [mark]);
		}
	}
	return map;
}

/** 根标记（没有根就不画线） */
function findRoot(marks: readonly MiniMapMark[]): MiniMapMark | undefined {
	return marks.find((mark) => mark.root === true);
}

/**
 * 一组同父兄弟在某一维上的极值（传 `boxCenterY` 之类的取值函数）。
 *
 * 逐个比较而不是 `Math.min(...kids.map(…))`：单个父节点下的子节点可达数千
 * （星形布局），展开成实参表既慢也有参数上限风险（与 `fishboneConnectors`
 * 的「逐个比较」同口径）。
 */
function extentOf(
	kids: readonly MiniMapMark[],
	pick: (mark: MiniMapMark) => number,
): { min: number; max: number } {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const kid of kids) {
		const value = pick(kid);
		if (value < min) {
			min = value;
		}
		if (value > max) {
			max = value;
		}
	}
	return { min, max };
}

/**
 * 「竖轨 + 横档」两段式连线（目录组织图的深层 / 时间轴的深层共用）。
 *
 * 两处只有轨道 x 的算法不同（目录＝子左边界 − `RAIL_OFFSET_X`；时间轴＝父左缘 +
 * 0.6×间距），其余逐字相同：轨道从父底竖到**最深子节点中心**，每个子节点再从
 * 轨道横档到自己的左边界。tier 取第一子——同一父的子节点深度相同。
 */
function pushVerticalRail(
	links: MiniMapLink[],
	railX: number,
	fromY: number,
	kids: readonly MiniMapMark[],
): void {
	const first = kids[0];
	if (!first) {
		return;
	}
	links.push({
		from: { x: railX, y: fromY },
		to: { x: railX, y: extentOf(kids, boxCenterY).max },
		tier: tierOf(first),
	});
	for (const kid of kids) {
		links.push({
			from: { x: railX, y: boxCenterY(kid) },
			to: { x: kid.x, y: boxCenterY(kid) },
			tier: tierOf(kid),
		});
	}
}

/**
 * 浅层档的标记集：根 + 深度 ≤ `maxDepth` 的节点（其余一律不进，连线自然消失）。
 *
 * 各布局的连线函数都按 `mark.parent`（**该数组内的下标**）建边，过滤后下标会整体
 * 前移，故必须重建索引；DFS 顺序保证父一定先于子出现，一次遍历即可完成映射。
 * 父被过滤掉的标记退化为「无父」（这条边画不出来，与抽样时父缺失的处理一致）。
 *
 * 三种形态因此天然正确：`chainRail` 的一级兄弟横链随一级保留；`fishbone` 的
 * 骨（深 1）+ 斜脊（深 2）永远在上限内；`busV` / `railLeft` 的「父竖落 + 母线 +
 * 子竖落」按子节点深度整组进出，不会留下半截母线。
 *
 * 只作用于**连线**——`buildMiniMapSvg` 画方块时仍用全量 `marks`。
 */
function marksWithinDepth(
	marks: readonly MiniMapMark[],
	maxDepth: number,
): MiniMapMark[] {
	const kept: MiniMapMark[] = [];
	const indexMap = new Map<number, number>();
	for (const [index, mark] of marks.entries()) {
		if (
			mark.root !== true &&
			(mark.depth ?? UNKNOWN_DEPTH) > maxDepth
		) {
			continue;
		}
		const parent =
			mark.parent === undefined ? undefined : indexMap.get(mark.parent);
		indexMap.set(index, kept.length);
		const next: MiniMapMark = { ...mark };
		if (parent === undefined) {
			delete next.parent;
		} else {
			next.parent = parent;
		}
		kept.push(next);
	}
	return kept;
}

/**
 * 全部连线（**按布局分派**；纯几何、零 DOM）。
 *
 * 五种形态的几何都与画布一一对应，规则与实测值见 `MiniMapConnectorMode`。
 */
export function buildMiniMapLinks(
	marks: readonly MiniMapMark[],
	mode: MiniMapConnectorMode,
): MiniMapLink[] {
	if (mode === 'fishbone') {
		return fishboneLinks(marks);
	}
	if (mode === 'busV') {
		return busVerticalLinks(marks);
	}
	if (mode === 'railLeft') {
		return railLeftLinks(marks);
	}
	if (mode === 'chainRail') {
		return chainRailLinks(marks);
	}
	return branchLinks(marks);
}

/** 通用左右分支（逻辑结构图 / 思维导图）：父边中点 → 母线（0.6）→ 子边中点 */
function branchLinks(marks: readonly MiniMapMark[]): MiniMapLink[] {
	const links: MiniMapLink[] = [];
	for (const mark of marks) {
		const parentIndex = mark.parent;
		if (parentIndex === undefined) {
			continue;
		}
		const parent = marks[parentIndex];
		if (!parent) {
			continue;
		}
		const anchors = connectorAnchors(parent, mark);
		links.push({
			from: { x: anchors.ax, y: anchors.ay },
			to: { x: anchors.bx, y: anchors.by },
			elbow: {
				axis: anchors.horizontal ? 'h' : 'v',
				at: anchors.mid,
			},
			tier: tierOf(mark),
		});
	}
	return links;
}

/**
 * 组织结构图：父底中点 → 竖直 0.7 → **共享水平母线** → 竖直落到各子节点顶中点。
 *
 * 母线高度按「最靠上的子节点」算（实测同一父的子节点 top 相同）；拆成三种线
 * （父竖落 / 母线 / 子竖落）与画布的分段一致。
 */
function busVerticalLinks(marks: readonly MiniMapMark[]): MiniMapLink[] {
	const links: MiniMapLink[] = [];
	for (const [parent, kids] of childrenIndex(marks)) {
		const first = kids[0];
		if (!first) {
			continue;
		}
		const parentBottom = boxBottom(parent);
		const busY =
			parentBottom +
			VERTICAL_ELBOW_RATIO * (extentOf(kids, (mark) => mark.y).min - parentBottom);
		const tier = tierOf(first);
		const centers = extentOf(kids, boxCenterX);
		links.push({
			from: { x: boxCenterX(parent), y: parentBottom },
			to: { x: boxCenterX(parent), y: busY },
			tier,
		});
		links.push({
			from: { x: centers.min, y: busY },
			to: { x: centers.max, y: busY },
			tier,
		});
		for (const kid of kids) {
			links.push({
				from: { x: boxCenterX(kid), y: busY },
				to: { x: boxCenterX(kid), y: kid.y },
				tier: tierOf(kid),
			});
		}
	}
	return links;
}

/**
 * 目录组织图：一级用「0.7 母线 + 落到子左边界」；更深层用**左侧竖轨 + 横档**。
 *
 * 实测：一级母线 `27.6→1271.4`（横跨各一级节点**左边界**），每级在自己左边界处
 * 竖落到节点顶；二级竖轨 `x = 子节点.left − 12`，横档从轨到子左边界、y 取子中心。
 */
function railLeftLinks(marks: readonly MiniMapMark[]): MiniMapLink[] {
	const links: MiniMapLink[] = [];
	const root = findRoot(marks);
	for (const [parent, kids] of childrenIndex(marks)) {
		const first = kids[0];
		if (!first) {
			continue;
		}
		const parentBottom = boxBottom(parent);
		if (parent === root) {
			const busY =
				parentBottom +
				VERTICAL_ELBOW_RATIO *
					(extentOf(kids, (mark) => mark.y).min - parentBottom);
			const lefts = extentOf(kids, (mark) => mark.x);
			links.push({
				from: { x: boxCenterX(parent), y: parentBottom },
				to: { x: boxCenterX(parent), y: busY },
				tier: 1,
			});
			links.push({
				from: { x: lefts.min, y: busY },
				to: { x: lefts.max, y: busY },
				tier: 1,
			});
			for (const kid of kids) {
				links.push({
					from: { x: kid.x, y: busY },
					to: { x: kid.x, y: kid.y },
					tier: 1,
				});
			}
			continue;
		}
		const railX = extentOf(kids, (mark) => mark.x).min - RAIL_OFFSET_X;
		pushVerticalRail(links, railX, parentBottom, kids);
	}
	return links;
}

/**
 * 时间轴：根 → 第一个一级 → 兄弟横链；更深层用「0.6 竖轨 + 横档」。
 *
 * 实测：根右缘 → 首个一级左缘 `M 723,509.6 L 827,509.6`，一级之间
 * `M 913.7,509.6 L 1152.4,509.6`（右缘 → 下一个左缘，同一中心线）；二级竖轨
 * `x = 父.left + 0.6×(子.left − 父.left)`（`827 + 0.6×43.36 = 853.0`），
 * 轨从父底到最后一个子节点中心，横档到子左边界。
 */
function chainRailLinks(marks: readonly MiniMapMark[]): MiniMapLink[] {
	const links: MiniMapLink[] = [];
	const root = findRoot(marks);
	for (const [parent, kids] of childrenIndex(marks)) {
		const first = kids[0];
		if (!first) {
			continue;
		}
		if (parent === root) {
			// 一级是**兄弟横链**而不是「根 → 每个一级」：画布实测 `M 913.7,509.6
			// L 1152.4,509.6`（前一个一级的右缘 → 后一个的左缘，同一中心线）。
			// 根只连第一个一级——都连会在错位时露出斜射线。
			const ordered = [...kids].sort((a, b) => a.x - b.x);
			let from = { x: boxRight(parent), y: boxCenterY(parent) };
			for (const kid of ordered) {
				links.push({
					from,
					to: { x: kid.x, y: boxCenterY(kid) },
					tier: 1,
				});
				from = { x: boxRight(kid), y: boxCenterY(kid) };
			}
			continue;
		}
		const minLeft = extentOf(kids, (mark) => mark.x).min;
		const railX =
			parent.x + HORIZONTAL_ELBOW_RATIO * (minLeft - parent.x);
		pushVerticalRail(links, railX, boxBottom(parent), kids);
	}
	return links;
}

/** 鱼骨：水平骨干 + 每骨一截斜骨 + 斜脊折线（沿用 `fishboneConnectors` 的坐标序列，全部一级深描边） */
function fishboneLinks(marks: readonly MiniMapMark[]): MiniMapLink[] {
	return fishboneConnectors(marks).map((points) => {
		const first = points[0] as MiniMapPoint;
		const last = points[points.length - 1] as MiniMapPoint;
		return {
			from: first,
			to: last,
			polyline: points,
			tier: 1,
		};
	});
}

/**
 * 鱼骨图的连线折线（布局坐标，**纯几何**），照 `layouts/Fishbone.renderLine` 复刻：
 * 1. **骨干**：一条**水平线**——从根右缘沿根中心线向右，到最右一级的斜骨落点
 *    （画布 `maxx - offset/tan(deg)`，`maxx` 取一级左缘最大值）；
 * 2. **斜骨**：每个一级一截短线，起点在骨干上 `子左缘 - offsetX`、终点在子节点
 *    朝骨干那一侧的**角点**（上侧骨落底左角、下侧骨落顶左角）；
 * 3. **斜脊**：从骨块**外缘**（上侧骨顶边 / 下侧骨底边）的 `left + 0.3×宽` 出发，
 *    按 x 升序穿过各子节点**朝外角点**（上侧取左上角 / 下侧取左下角）。
 *
 * 历史上第 1 条被写成「根 → 每个一级一条直段」——画布上那其实是一条**水平骨干加
 * 短骨**，于是缩略图成了从鱼头放射的扇形、且骨干整体缺失（2026-10-26 实机确认：
 * 画布 9 段 = 1 骨干 + 4 短骨 + 4 脊，旧小图 8 条 = 4 放射线 + 4 脊、零水平段）。
 *
 * 角度：斜骨与骨干成引擎 `fishboneDeg`（**默认 45°**，插件不暴露该选项），故
 * `offsetX` 恰等于「骨干到子节点近边的垂直距离」。若日后允许改角度，须从引擎读
 * `opt.fishboneDeg` 并把这里的 1:1 关系换成 `offset / tan(deg)`。
 *
 * 只画到**第二层**（脊本身）：画布上第三层就是斜脊上的小支线，缩略尺度下纯噪声，
 * 不补（2026-10-24 裁决）。这与其余四态「按节点数分档」是两条独立预算——鱼骨的
 * 骨深 1、脊深 2 永远在 `MINIMAP_LINK_MAX_DEPTH`（7）以内，等于不受该档位影响。
 */
export function fishboneConnectors(
	marks: readonly MiniMapMark[],
): MiniMapPoint[][] {
	const root = findRoot(marks);
	const lines: MiniMapPoint[][] = [];
	if (!root) {
		return lines;
	}
	const childrenOf = childrenIndex(marks);
	const bones = childrenOf.get(root) ?? [];
	if (bones.length === 0) {
		return lines;
	}
	const spineY = root.y + root.height / 2;
	/** 子节点朝骨干那一侧的边（上侧骨取底边、下侧骨取顶边）——斜骨落点用 */
	const innerEdgeYOf = (bone: MiniMapMark): number =>
		bone.y + bone.height / 2 < spineY ? bone.y + bone.height : bone.y;
	/** 45° 斜骨的水平偏移 = 垂直距离（见函数头「角度」） */
	const offsetOf = (bone: MiniMapMark): number =>
		Math.max(0, Math.abs(innerEdgeYOf(bone) - spineY));
	// 同一层各骨的垂直偏移本应相等；取最大只为退化输入（自由拖拽 / 异常高度）不出现负长度。
	// 逐个比较而非 `Math.max(...arr)`：一级节点可达数千，避免展开成超长实参表。
	let offsetX = 0;
	let rightmostBoneX = Number.NEGATIVE_INFINITY;
	for (const bone of bones) {
		offsetX = Math.max(offsetX, offsetOf(bone));
		rightmostBoneX = Math.max(rightmostBoneX, bone.x);
	}
	lines.push([
		{ x: root.x + root.width, y: spineY },
		{ x: rightmostBoneX - offsetX, y: spineY },
	]);
	for (const bone of bones) {
		const isTop = bone.y + bone.height / 2 < spineY;
		lines.push([
			{ x: bone.x - offsetOf(bone), y: spineY },
			{ x: bone.x, y: innerEdgeYOf(bone) },
		]);
		const kids = [...(childrenOf.get(bone) ?? [])].sort((a, b) => a.x - b.x);
		if (kids.length === 0) {
			continue;
		}
		// 斜脊：从骨块**外缘**（上侧骨顶边 / 下侧骨底边）的 `left + 0.3×宽` 出发，
		// 穿过各子节点**朝外角点**（上侧取左上角 / 下侧取左下角）——画布上它是一条
		// 直线，子节点共线时本折线与之逐点相同。**勿**复用 `connectorAnchors` 的
		// 「朝向对方边中点」：那会让脊在骨块处先陡后平（可见折角），整条线向骨干内收。
		const rib: MiniMapPoint[] = [
			{
				x: bone.x + bone.width * FISHBONE_INDENT,
				y: isTop ? bone.y : bone.y + bone.height,
			},
		];
		for (const kid of kids) {
			rib.push({ x: kid.x, y: isTop ? kid.y : kid.y + kid.height });
		}
		lines.push(rib);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/**
 * 缩略图配色：**照抄画布**——节点填充 + 节点描边 + 连线色 + 根填充。
 *
 * 节点填充常常接近背景（白底 + `#f8fafc`），所以描边色不是装饰而是必需：
 * 没有它，缩略图上的节点就是一片看不出形状的白块。
 */
export interface MiniMapColors {
	background: string;
	/** 节点块的淡墨（节点描边色）：节点填充色常常≈背景，照抄会糊成白块 */
	nodeBorder: string;
	root: string;
	line: string;
}

/** 默认配色（主题不可得时的兜底：中性灰，明暗都不刺眼） */
export const MINIMAP_FALLBACK_COLORS: MiniMapColors = {
	background: '#888888',
	nodeBorder: '#666666',
	root: '#666666',
	line: '#999999',
};

/**
 * 生成缩略图 SVG 字符串（纯拼接，**零 DOM**）。
 *
 * 分层顺序：连线（一级深 / 二级浅）→ 深层块 → 二级块 → 一级块 → 根节点。
 *
 * 两条 2026-10-24 二轮裁决：
 * - 连线**跟随画布的折线 / 曲线**：形状只由 `lineStyle` 决定（折线两段直角、
 *   曲线以两个拐点为控制点的三次贝塞尔），几何由布局五态决定（见下）；
 * - 块按层级分档透明度（一级 0.62 / 二级 0.50 / 更深 0.36）：缩略图里缩进
 *   被压没了，只靠位置读不出层级，得用浓淡补。
 *
 * 连线走**五种按布局分派的形态**（`connectors`，由 `connectorModeForLayout`
 * 决定，几何见 `buildMiniMapLinks`）：左右分支 / 组织母线 / 目录左轨 / 时间轴
 * 竖轨 / 鱼骨斜脊。每种都与画布的实测坐标一一对应（0.6/0.7 折点、左边界锚点、
 * 12px 轨距）。
 *
 * **画到哪一档由调用方按节点数决定**（`linkMode`，2026-10-25 用户裁决：按性能模式
 * 阈值分档——≤500 全画、>500 只画前 `MINIMAP_LINK_MAX_DEPTH` 层）。阈值判定在引擎侧
 * （`MINIMAP_LINK_NODE_LIMIT`），本函数只负责「照单执行」。
 *
 * 输出只含 `<rect>`/`<path>` 与数值，无类名——不会污染页面上 `.smm-*` 的
 * 选择器（探针与既有测试都按类名计数）。
 */
export function buildMiniMapSvg(
	content: MiniMapBox,
	marks: readonly MiniMapMark[],
	panel: MiniMapSize,
	colors: MiniMapColors,
	lineStyle: MiniMapLineStyle = 'straight',
	connectors: MiniMapConnectorMode = 'branchH',
	linkMode: MiniMapLinkMode = 'all',
): string {
	const miniScale = miniMapScale(content, panel);
	const offsetX = (panel.width - content.width * miniScale) / 2;
	const offsetY = (panel.height - content.height * miniScale) / 2;
	const mapX = (x: number): number => offsetX + (x - content.x) * miniScale;
	const mapY = (y: number): number => offsetY + (y - content.y) * miniScale;

	/**
	 * 一条连线 → path 的 d。
	 *
	 * - `polyline`：顶点序列直连（鱼骨斜脊）；
	 * - `elbow`：父端 → 母线拐点 → 子端。折线走两段直角；曲线走以两个拐点为
	 *   控制点的三次贝塞尔（与画布 `curve` 同构：先冲出去、再沿母线弯下去）；
	 * - 其余：直线段（竖轨、横档、母线、时间轴一级横连）。
	 */
	const linkPath = (link: MiniMapLink): string => {
		if (link.polyline) {
			return link.polyline
				.map(
					(point, index) =>
						`${index === 0 ? 'M' : 'L'}${round(mapX(point.x))} ${round(mapY(point.y))}`,
				)
				.join('');
		}
		const ax = round(mapX(link.from.x));
		const ay = round(mapY(link.from.y));
		const bx = round(mapX(link.to.x));
		const by = round(mapY(link.to.y));
		if (!link.elbow) {
			return `M${ax} ${ay}L${bx} ${by}`;
		}
		if (link.elbow.axis === 'h') {
			const mid = round(mapX(link.elbow.at));
			return lineStyle === 'curve'
				? `M${ax} ${ay}C${mid} ${ay} ${mid} ${by} ${bx} ${by}`
				: `M${ax} ${ay}L${mid} ${ay}L${mid} ${by}L${bx} ${by}`;
		}
		const mid = round(mapY(link.elbow.at));
		return lineStyle === 'curve'
			? `M${ax} ${ay}C${ax} ${mid} ${bx} ${mid} ${bx} ${by}`
			: `M${ax} ${ay}L${ax} ${mid}L${bx} ${mid}L${bx} ${by}`;
	};

	const link1: string[] = [];
	const link2: string[] = [];
	const tier1: string[] = [];
	const tier2: string[] = [];
	const deep: string[] = [];
	let rootRect = '';

	// 连线：按布局分派的五种形态（branchH / busV / railLeft / chainRail / fishbone）。
	// 一级用较深的描边、更深的用较浅的，保住「主枝更实」的观感。
	// `shallow` 档先按深度收窄标记集（只影响连线，下面的方块仍用全量 marks）。
	const linkedMarks =
		linkMode === 'shallow'
			? marksWithinDepth(marks, MINIMAP_LINK_MAX_DEPTH)
			: marks;
	for (const link of buildMiniMapLinks(linkedMarks, connectors)) {
		const path = `<path d="${linkPath(link)}" />`;
		if (link.tier === 1) {
			link1.push(path);
		} else {
			link2.push(path);
		}
	}

	for (let i = 0; i < marks.length; i++) {
		const mark = marks[i];
		if (!mark) {
			continue;
		}
		const depth = mark.depth ?? UNKNOWN_DEPTH;
		const width = mark.width * miniScale;
		const height = mark.height * miniScale;
		// 节点自定义颜色：单块覆盖所在层级的主题墨色（「小地图按节点配色」）
		const ownFill = mark.color ? ` fill="${safeColor(mark.color)}"` : '';
		if (mark.root === true) {
			// 根给个最小尺寸：小图上它可能只有 1px，认不出来
			rootRect =
				`<rect x="${round(mapX(mark.x))}" y="${round(mapY(mark.y))}" ` +
				`width="${round(Math.max(3, width))}" ` +
				`height="${round(Math.max(3, height))}" rx="1"${ownFill} />`;
			continue;
		}
		// 内缩：主题 `marginY = 0` 时相邻节点会贴死成一条带；块很矮时缩得更多
		// （否则缝被抗锯齿吞掉，看着还是一整块）
		const inset = height < 3 ? 0.3 : 0.5;
		const rect =
			`<rect x="${round(mapX(mark.x) + inset)}" y="${round(mapY(mark.y) + inset)}" ` +
			`width="${round(Math.max(1, width - inset * 2))}" ` +
			`height="${round(Math.max(1, height - inset * 2))}" rx="0.6"${ownFill} />`;
		if (depth === 1) {
			tier1.push(rect);
		} else if (depth === 2) {
			tier2.push(rect);
		} else {
			deep.push(rect);
		}
	}

	const ink = safeColor(colors.nodeBorder);
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${round(panel.width)}" ` +
		`height="${round(panel.height)}" viewBox="0 0 ${round(panel.width)} ${round(panel.height)}">` +
		`<rect width="100%" height="100%" fill="${safeColor(colors.background)}" />` +
		// 连线先画、节点后盖——与画布同序；`fill="none"` 必不可少：`<path>`
		// 默认黑色实心填充，折角一围就是黑块
		`<g stroke="${safeColor(colors.line)}" stroke-width="0.8" fill="none" ` +
		`stroke-linecap="round" stroke-linejoin="round" opacity="0.85">${link1.join('')}</g>` +
		`<g stroke="${safeColor(colors.line)}" stroke-width="0.6" fill="none" ` +
		`stroke-linecap="round" stroke-linejoin="round" opacity="0.6">${link2.join('')}</g>` +
		// 块按层级分档：越深越淡（一级最实，并带一圈同色描边）
		`<g fill="${ink}" fill-opacity="0.36">${deep.join('')}</g>` +
		`<g fill="${ink}" fill-opacity="0.5">${tier2.join('')}</g>` +
		`<g fill="${ink}" fill-opacity="0.62" stroke="${ink}" stroke-width="0.6" ` +
		`stroke-opacity="0.9">${tier1.join('')}</g>` +
		// 根节点最后画：画布上它是唯一的强调色，缩略图上也要一眼看到
		`<g fill="${safeColor(colors.root)}">${rootRect}</g>` +
		`</svg>`
	);
}

// ---------------------------------------------------------------------------
// 开关与刷新节拍
// ---------------------------------------------------------------------------

/**
 * 刷新节拍状态（供 `nextMiniMapDeadline` 消费；全为纯数据，便于直测）。
 *
 * 各字段含义见其注释；视图层只负责按事件改这些值，**判定**一律在这里做——
 * 否则「要不要排定时器」会在两处各写一遍。
 */
export interface MiniMapCadence {
	/** 是否满足启用判据（决定要不要排节拍） */
	enabled: boolean;
	/** 缩略图已画过至少一帧（启用瞬间那次因几何未就绪失败时为 false） */
	ready: boolean;
	/** 面板当前可见（淡出后为 false：既不重绘、也不空转定时器） */
	visible: boolean;
	/** 图比当前显示的旧（编辑 / 外观偏好后置位，绘制成功即清） */
	dirty: boolean;
	/** 最近一次绘制（**尝试**时刻：失败也推进，见 `view-minimap.draw`） */
	lastDrawAt: number;
	/** 最近一次「动图」（淡出倒计时起点） */
	lastActivityAt: number;
	/** 指针是否压在面板上（悬停不淡出：正拖视口框 / 读图时被藏，比占屏更烦） */
	hovering: boolean;
}

/**
 * 下一次需要动作的**绝对时间戳**；`null` = 不必再排定时器。
 *
 * 两种截止时间取最早（首次绘制不在此列：启用瞬间就画，见 `ready`）：
 * - 脏图重绘：上次绘制 + 刷新间隔；
 * - 空闲淡出：最近动图 + 空闲阈值。
 *
 * `null` 的三种情形：面板关闭；**已隐藏**——不可见时既不重绘也不空转定时器，
 * 等用户动图再唤醒（否则等于每 30s 白算一次，正是本设计要消除的开销）；
 * **悬停且无脏图**——既不藏也不用重画，等指针离开再排（`mouseleave` 会重新
 * 起算空闲）。悬停时若有脏图，仍按刷新间隔换图（图不因指针停留而停在旧数据）。
 * `!ready`（启用瞬间那次绘制因几何未就绪而失败）同样返回 null：重试由下一次
 * 事件驱动（渲染落地，或用户动图唤醒），不靠节拍轮询。
 */
export function nextMiniMapDeadline(
	cadence: MiniMapCadence,
	now: number,
	refreshMs: number,
	idleMs: number,
): number | null {
	if (!cadence.enabled || !cadence.ready) {
		return null;
	}
	if (!cadence.visible) {
		return null;
	}
	// 悬停 ⇒ 永不淡出（`Infinity` 是「不藏」的纯数据表达，调用方只做 Math.min）
	const hideAt = cadence.hovering
		? Number.POSITIVE_INFINITY
		: cadence.lastActivityAt + idleMs;
	if (!cadence.dirty) {
		return Number.isFinite(hideAt) ? Math.max(now, hideAt) : null;
	}
	return Math.max(now, Math.min(hideAt, cadence.lastDrawAt + refreshMs));
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** 保留一位小数：缩略图不需要亚像素精度，字符串越短解码越快 */
function round(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * 颜色进 SVG 属性前的白名单清洗（主题值理论上可信，但不做假设）。
 *
 * 回退色与 `MINIMAP_FALLBACK_COLORS` 同源：另写一份字面量会在调兜底色时只改到一处。
 */
function safeColor(value: string): string {
	return /^[#\w(),.%\s-]+$/.test(value)
		? value
		: MINIMAP_FALLBACK_COLORS.background;
}
