/**
 * 联系（关系连线）指令的**唯一**语义实现（语法层在 `domain/directive`）。
 *
 * 写在指令块里的两种段（**独立指令行、一段一行**，见 `domain/directive`）：
 *
 * ```markdown
 * ## 支付
 * %%id:9c2e%%
 * %%rel:7f3a | 依赖 | geo=right,0,left,8,12,0,-30,-12 | color=#4a90d9%%
 * ```
 *
 * - `%%id:xxxxxx%%` 给「**被指向**的节点」发文件内持久身份（懒加：只有被指向才写）；
 * - `%%rel:xxxxxx | 标签%%` 在**源节点**上声明一条**有向**边（引擎画线恒在终点带箭头）；
 * - 标签之后可跟**属性段** `geo=…`（手绘几何）与 `color=#rrggbb`（线色）：各至多
 *   一段、顺序无关、可全省略；值非法时**丢弃该段、保留边**（几何/颜色是辅助数据，
 *   坏值不该让整条边退化成普通注释）。属性只能写在 `%%rel%%` 内部——注释不能嵌套。
 *
 * ## 为什么不是行内尾插（2026-10-30 实机实测）
 * 把指令写在标题行行尾会让 Obsidian 的 heading 缓存变成 `支付 %%id:9c2e%%`：
 * `[[#支付]]` 从此解析失败，行尾 `^block-id` 也会失效。独立指令行实测：heading
 * 缓存干净、`[[#标题]]` 正常、阅读视图里渲染为 **0 高度**的空段落（零视觉影响）。
 * 顺带把「围栏 / 表格行尾不能插入」那套落点规则整条删掉了——指令不再碰节点行尾。
 *
 * ## 与 text 的关系
 * 指令**不进入** `data.text` / `mdDerivedText`（只剥一半会让 `rawOk` 恒假，任务
 * token 的既有教训）：解析期剥进 `mdDirectiveTail`，合成时贴回节点末行。派生
 * 结果（id / 出边）由 {@link relationStateOf} **读时**就地算出，不落字段——引擎
 * 内联编辑会直接改写 `data.text`，缓存字段必然过期。
 */

import { normalizeHexColor } from './color';
import {
	type DirectiveSegment,
	splitDirectiveSegments,
} from './directive';
import { nodeInlineSource } from './md-meta';
import { walkTree } from './tree';

/** 端点方向（引擎 `getNodePoint(node, dir, range)` 的 dir） */
export type RelationAnchorDir = 'left' | 'right' | 'top' | 'bottom';

/** 节点盒（布局坐标）——手绘锚定与端点命中的几何输入 */
export interface RelationRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** 一个平面点 */
export interface RelationPoint2D {
	x: number;
	y: number;
}

/**
 * 一条边的**几何**（2026-10-30：拖动端点/控制点后要能持久化）。
 *
 * 只存**相对量**，节点移动/换布局后仍然成立：
 * - 端点 = 方向 + 沿该边的位移 `range`（引擎按 `getNodePoint` 用 dir+range 重算坐标，
 *   不依赖绝对坐标）；
 * - 控制点 = 相对端点的差值（引擎 `associativeLineTargetControlOffsets` 就是这个语义）。
 *
 * 写成指令的第三段：`%%rel:7f3a | 依赖 | geo=right,0,left,8,12,0,-30,-12%%`
 * （8 个数：起端 dir,range → 末端 dir,range → 控制点1 dx,dy → 控制点2 dx,dy）。
 */
export interface RelationGeometry {
	fromDir: RelationAnchorDir;
	fromRange: number;
	toDir: RelationAnchorDir;
	toRange: number;
	ctl1: { x: number; y: number };
	ctl2: { x: number; y: number };
}

/** 一条出边：目标 id + 可选标签（`''` = 无标签）+ 可选几何 + 可选线色 */
export interface RelationRef {
	target: string;
	label: string;
	/** 未拖过 = undefined（引擎按两节点几何自动算路径） */
	geo?: RelationGeometry;
	/**
	 * 这条线的自定义颜色（`#rrggbb`；未写 = 跟随主题的 `associativeLineColor`）。
	 *
	 * 写侧第四段 `color=#rrggbb`。**只表达线本身**（含箭头），不动标签文字色与
	 * 选中态：前者由主题的 `associativeLineTextColor` 定（带描边光晕，压在任意
	 * 底色上都可读），后者是引擎的激活色——选中反馈不随线色漂移。
	 */
	color?: string;
}

/** 一个节点的关系状态（自身 id + 全部出边） */
export interface RelationState {
	id: string | null;
	/** 只读：空状态是全局复用的，写侧一律先复制再改（`[...refs]` / `filter`） */
	refs: readonly RelationRef[];
}

/** 关系 id：6 位小写十六进制（与配色 hex 同字符集，但被 `id:` 前缀分流） */
const ID_PATTERN = /^[0-9a-f]{6}$/;

/** id 归一：trim + 小写；不合法返回 null（fail-closed） */
export function normalizeRelationId(value: string): string | null {
	const id = value.trim().toLowerCase();
	return ID_PATTERN.test(id) ? id : null;
}

/**
 * 标签是否可写进注释体（**输入侧与解析侧同一判据**，勿各写一份）。
 *
 * 禁止 `[[` / `]]`：注释体不是行内 token 的保护区，`tokenizeInline` 会把里面的
 * 双链先切走，导致「标签里写了双链」这种输入在解析/回写两侧口径不一致；禁止
 * `%%` 是因为注释不能嵌套；`\n` 会破坏「一行一条指令」的行形态。
 */
export function isWritableRelationLabel(label: string): boolean {
	return (
		!label.includes('%%') &&
		!label.includes('\n') &&
		!label.includes('[[') &&
		!label.includes(']]')
	);
}

/** 一段**已解释**的关系指令（`raw` 是它在原文里的逐字切片，改写时原样带回） */
type ParsedRelationSegment =
	| { kind: 'id'; id: string; raw: string }
	| { kind: 'rel'; ref: RelationRef; raw: string };

/** 几何段的 8 个字段：`fromDir,fromRange,toDir,toRange,c1x,c1y,c2x,c2y` */
const GEOMETRY_PREFIX = 'geo=';
/** 线色段：`color=#rrggbb` */
const COLOR_PREFIX = 'color=';
/** 标签之后可跟的属性段（顺序无关，各至多一段） */
const ATTRIBUTE_KEYS = ['geo', 'color'] as const;
type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
/** 端点方向的合法集合（解析与引擎 data 读回共用这一份判定） */
const ANCHOR_DIRS: readonly string[] = ['left', 'right', 'top', 'bottom'];

/** 值是否是合法的端点方向（`geo=` 解析与引擎 data 读回的唯一判据） */
export function isRelationAnchorDir(value: unknown): value is RelationAnchorDir {
	return typeof value === 'string' && ANCHOR_DIRS.includes(value);
}

/** 数值归一：有限数四舍五入到整数（几何不需要亚像素精度；越界视为非法） */
function normalizeGeoNumber(value: string | undefined): number | null {
	const num = Number(value);
	if (!Number.isFinite(num) || Math.abs(num) > 99999) {
		return null;
	}
	return Math.round(num);
}

function normalizeAnchorDir(value: string | undefined): RelationAnchorDir | null {
	const dir = (value ?? '').trim().toLowerCase();
	return isRelationAnchorDir(dir) ? dir : null;
}

/**
 * 解析 `geo=…` 段的**值部**（8 个逗号分隔字段，不含 `geo=` 前缀——前缀已由
 * {@link splitTrailingAttribute} 按 key 分流）；任何一处不合法返回 null
 * （**丢弃几何、保留边**——几何是辅助数据，坏值不该让整条边退化成普通注释）。
 */
function parseRelationGeometry(value: string): RelationGeometry | null {
	const parts = value.trim().split(',');
	if (parts.length !== 8) {
		return null;
	}
	const fromDir = normalizeAnchorDir(parts[0]);
	const fromRange = normalizeGeoNumber(parts[1]);
	const toDir = normalizeAnchorDir(parts[2]);
	const toRange = normalizeGeoNumber(parts[3]);
	const c1x = normalizeGeoNumber(parts[4]);
	const c1y = normalizeGeoNumber(parts[5]);
	const c2x = normalizeGeoNumber(parts[6]);
	const c2y = normalizeGeoNumber(parts[7]);
	if (
		!fromDir ||
		!toDir ||
		fromRange === null ||
		toRange === null ||
		c1x === null ||
		c1y === null ||
		c2x === null ||
		c2y === null
	) {
		return null;
	}
	return {
		fromDir,
		fromRange,
		toDir,
		toRange,
		ctl1: { x: c1x, y: c1y },
		ctl2: { x: c2x, y: c2y },
	};
}

/**
 * 几何 → 指令段文本（`geo=right,0,left,8,12,0,-30,-12`）。
 *
 * 八项一律取整：亚像素没有意义，且取整后「读 → 写」幂等（`sameRelationGeometry`
 * 也拿这个字符串比较）。
 */
function renderRelationGeometry(geo: RelationGeometry): string {
	return (
		GEOMETRY_PREFIX +
		[
			geo.fromDir,
			Math.round(geo.fromRange),
			geo.toDir,
			Math.round(geo.toRange),
			Math.round(geo.ctl1.x),
			Math.round(geo.ctl1.y),
			Math.round(geo.ctl2.x),
			Math.round(geo.ctl2.y),
		].join(',')
	);
}

/**
 * 从「标签 + 属性段」的尾部切下一段属性（`geo=…` / `color=…`）。
 *
 * 只认**末段**且必须形如 `key=value`（key ∈ `geo` / `color`）：标签里允许自由
 * 使用 `|`，只有这种形态才会被当成属性——否则整段仍是标签。
 *
 * @returns `head` = 去掉该段后的剩余文本（通常就是标签），`key` / `value` 已 trim
 */
function splitTrailingAttribute(
	rest: string,
): { head: string; key: AttributeKey; value: string } | null {
	const lastPipe = rest.lastIndexOf('|');
	const tail = (lastPipe === -1 ? rest : rest.slice(lastPipe + 1)).trim();
	const eq = tail.indexOf('=');
	if (eq <= 0) {
		return null;
	}
	const key = tail.slice(0, eq).trim().toLowerCase();
	if (!(ATTRIBUTE_KEYS as readonly string[]).includes(key)) {
		return null;
	}
	return {
		head: lastPipe === -1 ? '' : rest.slice(0, lastPipe).trim(),
		key: key as AttributeKey,
		value: tail.slice(eq + 1).trim(),
	};
}

/** 两份几何是否等价（写入侧据此避免无意义的落盘） */
export function sameRelationGeometry(
	a: RelationGeometry | undefined,
	b: RelationGeometry | undefined,
): boolean {
	if (!a || !b) {
		return a === b;
	}
	return renderRelationGeometry(a) === renderRelationGeometry(b);
}

/**
 * 解释**关系侧**的一段（`id` / `rel`）；其它 key（`sum`）与非法 value 返回 null。
 *
 * `sum` 段由 `domain/summary` 解释：同一行里两种段各管各的，互不吞并
 * （这正是把行语法收进 `domain/directive` 的目的）。
 */
function parseRelationSegment(
	segment: DirectiveSegment,
): ParsedRelationSegment | null {
	if (segment.key === 'id') {
		const id = normalizeRelationId(segment.value);
		return id ? { kind: 'id', id, raw: segment.raw } : null;
	}
	if (segment.key !== 'rel') {
		return null;
	}
	// rel：首个 `|` 之前是 id，之后是「标签」+ 若干属性段（`geo=` / `color=`）
	const value = segment.value;
	const pipe = value.indexOf('|');
	const id = normalizeRelationId(pipe === -1 ? value : value.slice(0, pipe));
	if (!id) {
		return null;
	}
	let rest = pipe === -1 ? '' : value.slice(pipe + 1).trim();
	// 属性段从**尾部**逐段消费：每个 key 至多一次、顺序无关；重复或形状不符
	// （`foo=…`）即停——那些段仍属标签，绝不吞掉用户文字
	let geo: RelationGeometry | undefined;
	let color: string | undefined;
	const consumed = new Set<AttributeKey>();
	for (;;) {
		const attribute = splitTrailingAttribute(rest);
		if (!attribute || consumed.has(attribute.key)) {
			break;
		}
		consumed.add(attribute.key);
		if (attribute.key === 'geo') {
			// 值非法只丢几何、保留边（见文件头）
			geo = parseRelationGeometry(attribute.value) ?? undefined;
		} else {
			color = normalizeHexColor(attribute.value) ?? undefined;
		}
		rest = attribute.head;
	}
	if (!isWritableRelationLabel(rest)) {
		return null;
	}
	return {
		kind: 'rel',
		ref: {
			target: id,
			label: rest,
			...(geo ? { geo } : {}),
			...(color ? { color } : {}),
		},
		raw: segment.raw,
	};
}

/** 空状态（冻结后全局复用：每次渲染的每个节点都会问一次，避免无谓分配） */
const EMPTY_STATE: RelationState = Object.freeze({ id: null, refs: [] });

/**
 * 从一段「节点原文」读出关系状态。
 *
 * 覆盖两种真实形态（拆块由 `domain/directive` 唯一实现）：
 * - **标准形态**：末尾若干**指令行**（本插件写出）；
 * - **行内形态**：最后一个内容行的行尾指令段（用户手写 / 旧文件 / 粘贴片段）。
 *
 * 只认**末尾**：行中间的 `%%rel:…%%` 属普通注释（显示层隐藏，不产生关系），
 * 避免把"写在正文里的语法说明"误当成关系。
 */
export function relationStateOfSource(source: string): RelationState {
	// 快路径：绝大多数节点没有任何注释（每次渲染每节点都会走到这里）
	if (!source.includes('%%')) {
		return EMPTY_STATE;
	}
	const { segments } = splitDirectiveSegments(source);
	let id: string | null = null;
	const refs: RelationRef[] = [];
	for (const segment of segments) {
		const parsed = parseRelationSegment(segment);
		if (!parsed) {
			// `sum` 段与坏 value 都走这里：既不是 id 也不是一条边
			continue;
		}
		if (parsed.kind === 'id') {
			// 首个合法 id 权威（重复 id 指令只保留第一处的语义）
			id ??= parsed.id;
			continue;
		}
		// 同源同目标去重，保持首次出现的顺序
		if (refs.some((ref) => ref.target === parsed.ref.target)) {
			continue;
		}
		refs.push(parsed.ref);
	}
	return id === null && refs.length === 0 ? EMPTY_STATE : { id, refs };
}

/** 节点数据 → 关系状态（读的是 `nodeInlineSource`，与配色同一份原文） */
export function relationStateOf(
	data: Record<string, unknown> | null | undefined,
): RelationState {
	return data ? relationStateOfSource(nodeInlineSource(data)) : EMPTY_STATE;
}

/**
 * 状态 → **关系侧**的指令段（`id` 在前，`rel` 按原序；不包含 `sum` 段）。
 *
 * 写侧的唯一原料：调用方把本函数的段与原文里**其它 key 的段**（概要）合到一起，
 * 交给 `domain/directive.applyDirectiveBlock` 统一排序/拼接——这样改联系不会
 * 抹掉概要，改概要也不会抹掉联系。
 */
export function relationSegmentsOf(state: RelationState): DirectiveSegment[] {
	const segments: DirectiveSegment[] = [];
	if (state.id) {
		segments.push({
			key: 'id',
			value: state.id,
			raw: `%%id:${state.id}%%`,
		});
	}
	for (const ref of state.refs) {
		// 属性段固定顺序 geo → color（解析侧顺序无关，写侧保持稳定以便幂等）
		const geo = ref.geo ? ` | ${renderRelationGeometry(ref.geo)}` : '';
		const color = ref.color ? ` | ${COLOR_PREFIX}${ref.color}` : '';
		const value = ref.label
			? `${ref.target} | ${ref.label}${geo}${color}`
			: `${ref.target}${geo}${color}`;
		segments.push({ key: 'rel', value, raw: `%%rel:${value}%%` });
	}
	return segments;
}

/** 已解析的边（两端均为真实节点） */
interface RelationEdge<N> {
	from: N;
	to: N;
	ref: RelationRef;
}

/**
 * 一张图的关系图（唯一解析结果）。
 *
 * **只产出被消费的两样东西**：`ids`（给悬空判定与 id 复用）与 `edges`（画线、
 * 写 data 的唯一依据）。悬空边 / 重复 id 只是"没有边"的副产品，不作为集合
 * 暴露——没有消费者，就没有第二份口径要维护（2026-10-30 删除三者，见 AGENTS.md）。
 */
export interface RelationGraph<N> {
	/** 权威 id → 节点（文档序首个） */
	ids: Map<string, N>;
	/** 可绘制的边（按文档序，可能被 `maxEdges` 截断） */
	edges: RelationEdge<N>[];
}

/**
 * 解析整棵树的关系图（唯一实现）。
 *
 * 三种"不画线"按同一出口处理——**跳过，不改文件**：
 * - 悬空（目标 id 不存在）；
 * - 自环（id 指向自己，引擎会画出一条零长度线）；
 * - 重复 id 的**非首个**节点（它不获得身份，但仍可作为源发边）。
 *
 * @param root     虚拟文档根（其本身没有正文行，不参与）
 * @param maxEdges 可绘制边的上限（性能保护）
 */
export function resolveRelationGraph<
	N extends { children?: readonly N[] | null; data?: unknown },
>(
	root: N,
	maxEdges = Number.POSITIVE_INFINITY,
): RelationGraph<N> {
	const ids = new Map<string, N>();
	const sources: { node: N; state: RelationState }[] = [];

	walkTree(root, (node) => {
		const state = relationStateOf(node.data as Record<string, unknown>);
		// 重复 id：文档序首个权威（`ids` 已有则不再覆盖后面的节点）
		if (state.id && !ids.has(state.id)) {
			ids.set(state.id, node);
		}
		if (state.refs.length > 0) {
			sources.push({ node, state });
		}
	});

	const all: RelationEdge<N>[] = [];
	for (const { node, state } of sources) {
		for (const ref of state.refs) {
			const to = ids.get(ref.target);
			if (!to || to === node) {
				continue;
			}
			all.push({ from: node, to, ref });
		}
	}

	const edges =
		Number.isFinite(maxEdges) && maxEdges >= 0 ? all.slice(0, maxEdges) : all;
	return { ids, edges };
}
