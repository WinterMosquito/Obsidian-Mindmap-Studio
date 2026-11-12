/**
 * 脚注（footnote）：定义行语法的**唯一判定** + 文档级索引 + 渲染期剥离。
 *
 * 口径来自官方帮助 `Editing and formatting/Basic formatting syntax` 的 Footnotes
 * 段：`[^id]: 内容` 为定义、`文本[^id]` 为引用、续行**缩进**（帮助里的写法是 2
 * 空格；判定用「相对内容起始列 ≥ 1」，见 `forEachFootnoteLine`）、命名脚注
 * （`[^note]`）在阅读视图里同样显示为编号。
 *
 * ## 三个消费方，一套行分类
 * 定义行在本插件里**本来就是节点**（`md-outline` 把 `[^…]:` 当链接引用定义整行
 * 豁免、按段落收进 `mdRaw`），回写走逐字保真。本模块只做三件事：
 * - `isFootnoteDefinition`：这一行是不是定义（解析层豁免的唯一依据）；
 * - `splitFootnoteDefinitions`：节点渲染源 → 「可见正文 + 定义 id」（**只影响
 *   显示**：`text` / `mdRaw` 一字不动，序列化与编辑完全不受影响）；
 * - `collectFootnoteDefinitions`：全文定义索引（悬停正文 / 点击目标的来源）。
 * 三者的行分类都由 `forEachFootnoteLine` 实现——围栏、缩进代码、续行的口径只写
 * 一次，避免「显示剥了而索引没剥」的漂移。本模块不参与解析/序列化，也不往节点
 * data 上写任何字段（硬规则 4：渲染只读）；索引读的是**引擎渲染树**
 * （`engine/mindmap.collectRenderNodeData`）：跳转要 uid，而 uid 只在引擎侧存在
 * （会话权威树没有）。
 *
 * ## 判定的单一来源
 * `md-outline.isLinkReferenceDefinition` 的 `^` 分支直接调本模块的
 * `isFootnoteDefinition`（同一份正则），勿在调用方另写一条「以 `[^` 开头」。
 *
 * ## 保守跳过的边界（不产生错误目标）
 * 围栏代码块内的同形行、缩进代码行（≥4 空格 / Tab）、列表续行里的缩进写法都不是
 * 定义；同一 id 出现多次时取**文档序第一个**（GFM 的「首个定义生效」）。
 */
import { isIndentedCodeLine } from '../core/constants';
import { nodeContinuationIndents, nodeInlineSource } from '../domain/md-meta';
import {
	fenceMarker,
	isFenceCloseLine,
	isSelfClosedFenceLine,
	type FenceBoundary,
} from './md-outline-lines';

/**
 * 脚注 id 的字符类（**唯一定义**：定义行与行内引用两处正则都从这里拼）。
 *
 * `id` = `^` 之后到 `]` 之前的任意非 `]`、非换行字符——与 markdown-it-footnote
 * 一致（**允许**逗号 / 空格 / 冒号等）。消费方 `features/node-inline-tokenize`
 * 的 `MARKUP_RE` 用同一份源码拼接，避免「定义认、引用不认」的分叉。
 */
export const FOOTNOTE_ID_SOURCE = '[^\\]\\n]+';

/**
 * 定义行：`[^id]: 内容`（`id` 至少一个非 `]` 字符；内容任意、可为空）。
 *
 * 与 `md-outline.isLinkReferenceDefinition` 的通用形态同源：那边先匹配
 * `[label]: …` 再按 `label` 首字符分流，本正则只是把脚注那一支显式写出来。
 */
const FOOTNOTE_DEF_RE = new RegExp(
	'^\\[\\^(' + FOOTNOTE_ID_SOURCE + ')\\]:[ \\t]*(.*)$',
);

/** 一条脚注定义（渲染/交互消费的只读快照） */
export interface FootnoteDefinition {
	/** 脚注 id（`[^id]` 里 `^` 之后的部分，不含方括号） */
	readonly id: string;
	/** 定义正文：首行去掉标记后的内容 + 续行（已剥续行缩进），行间 `\n` */
	readonly body: string;
	/** 定义所在节点的 uid（点击徽标时的跳转目标；缺失时为空串，调用方按不可跳处理） */
	readonly uid: string;
}

/**
 * 解析**单行**定义；不是定义行返回 null。
 *
 * 入参按「一行原文」处理：先 trim（对齐 `md-outline` 的既有口径——列表项内容
 * 与段落行都传 trim 后的文本），故行首 ≤3 空格缩进不影响判定。**缩进代码块**
 * （≥4 空格）须由调用方先挡掉（本函数看不到原始缩进宽度，也无从区分）。
 */
export function parseFootnoteDefinition(
	content: string,
): { id: string; body: string } | null {
	const match = FOOTNOTE_DEF_RE.exec(content.trim());
	if (!match) {
		return null;
	}
	const id = match[1] ?? '';
	if (!id) {
		return null;
	}
	return { id, body: match[2] ?? '' };
}

/** 这一行是否是脚注定义行（`md-outline` 的豁免判定入口） */
export function isFootnoteDefinition(content: string): boolean {
	return parseFootnoteDefinition(content) !== null;
}

/** 逐行分类的结果（`forEachFootnoteLine` 的产物） */
type FootnoteLine =
	| { kind: 'definition'; id: string; body: string }
	| { kind: 'continuation'; text: string }
	| { kind: 'other'; line: string };

/**
 * 逐行分类节点的渲染源：定义行 / 定义续行 / 其它（含围栏内、缩进代码、空行）。
 *
 * `splitFootnoteDefinitions`（渲染期剥离）与 `collectFootnoteDefinitions`（定义
 * 索引）的**唯一**行分类实现——围栏、缩进代码、续行的口径只写一次，避免「显示
 * 剥了、索引没剥」这类漂移（这两处判定必须永远一致，否则徽标指向的定义与显示
 * 的内容各认一套）。
 *
 * ## 续行判据是**相对缩进**（2026-11-12 实机）
 * Markdown 里「这一行还是不是上一段」由**相对内容起始列**的缩进决定：同一条
 * `后续正文`，在列表项里与内容同列（相对 0）就是**另一段**，缩进 4 列才是定义
 * 正文（阅读视图逐字对照）。此前按「定义后的非空行一律算续行」判定，`- 正文 /
 * [^1]: 定义 / 接着的正文` 的第三行会被当成续行一起隐藏（节点上少一段，文件还在）。
 *
 * 缩进来源按优先级：
 * - `indents`（解析层记的 `MdNodeMeta.mdContinuationIndents`，`mdRaw` 逐行相对值）
 *   与源码行数一致时用它——列表项续行被 `trimStart` 后只剩这一份缩进；
 * - 否则用**行首空白**现算（plain 多行节点在 `mdRaw` 里保留原文缩进）；
 * - `text` 已编辑的节点两者都可能缺，此时缩进按 0 处理 ⇒ 后续行显示为正文
 *   （可见地多一行，而不是静默少一行）。
 */
function forEachFootnoteLine(
	source: string,
	visit: (line: FootnoteLine) => void,
	indents?: readonly number[],
): void {
	let fence: FenceBoundary | null = null;
	/** 当前是否在一条定义内（决定「缩进的非空行」是不是续行） */
	let inDefinition = false;
	const rows = source.split('\n');
	/** 该行相对内容起始列的缩进（口径见函数头；越界 / 缺表时回落到行首空白） */
	const indentOf = (index: number, line: string): number => {
		if (indents && indents.length === rows.length) {
			const value = indents[index];
			if (typeof value === 'number' && Number.isFinite(value)) {
				return Math.max(0, Math.trunc(value));
			}
		}
		return line.length - line.trimStart().length;
	};
	for (const [index, line] of rows.entries()) {
		const marker = fenceMarker(line);
		if (fence) {
			// 闭合判定与解析层**同一实现**（含相对列 / 行尾空白 / 长度 ≥ 开串）：
			// 这里另写一份会让「显示剥掉的定义」与「索引认的定义」在缩进围栏上分叉
			if (isFenceCloseLine(line, fence)) {
				fence = null;
			}
			inDefinition = false;
			visit({ kind: 'other', line });
			continue;
		}
		if (marker) {
			// 行首定界符即开围栏。**同行自闭合**（```` ```code``` ````）不进入围栏
			// 状态——否则其后每一行都被判成「围栏内」，真实定义既不剥离也不进索引
			// （与 `classifyLines` 共用 `isSelfClosedFenceLine`，2026-11-12 收口）。
			const markerStart = line.indexOf(marker.char);
			const rest = line.slice(markerStart + marker.length);
			if (!isSelfClosedFenceLine(rest, marker.char, marker.length)) {
				fence = {
					char: marker.char,
					length: marker.length,
					column: Math.max(0, markerStart),
				};
			}
			inDefinition = false;
			visit({ kind: 'other', line });
			continue;
		}
		if (isIndentedCodeLine(line)) {
			inDefinition = false;
			visit({ kind: 'other', line });
			continue;
		}
		const def = parseFootnoteDefinition(line);
		if (def) {
			inDefinition = true;
			visit({ kind: 'definition', id: def.id, body: def.body });
			continue;
		}
		// 续行：**有缩进**的非空行才属于上一段定义（相对内容起始列，见函数头）。
		// 同列的非空行是另一段正文——隐藏它等于让节点少一段内容（2026-11-12 实机）。
		if (inDefinition && line.trim() !== '' && indentOf(index, line) > 0) {
			// 续行里的 `[^2]` 不能再被渲染成引用（否则编号整体前移，2026-11-12 实机）
			visit({ kind: 'continuation', text: line.trimStart() });
			continue;
		}
		inDefinition = false;
		visit({ kind: 'other', line });
	}
}

/**
 * 把一个节点的渲染源拆成「可见正文 + 定义 id 列表」（**渲染期只读**）。
 *
 * 用途：定义行不再作为可见内容铺在节点里（2026-11-11 用户裁决）——节点上只留
 * 正文，定义改由引用徽标 / 汇总 chip 访问。**不写回任何 data**：`text` / `mdRaw`
 * 原样保留，序列化与保真完全不受影响（编辑弹窗与内联编辑器仍看得到原文）。
 *
 * 判定与索引**同源**（`parseFootnoteDefinition` + `fenceMarker` +
 * `isSelfClosedFenceLine` + `isIndentedCodeLine` + `indentOf`），边界因此天然一致：
 * - 围栏代码块里的同形行不是定义（整块保留为代码）；
 * - 缩进代码行（≥4 空格 / Tab）不是定义；
 * - 定义行之后**有缩进的**连续非空行一并剔除（相对缩进口径见
 *   `forEachFootnoteLine`）；同列的非空行是另一段正文，**必须保留**。
 *
 * @param indents 该节点 `mdRaw` 的逐行相对缩进（`MdNodeMeta.mdContinuationIndents`，
 *                经 `nodeContinuationIndents` 读）。缺省时按行首空白现算。
 *
 * 空行会结束当前定义、本身保留（`body` 里因此可能留下空行——由段切分按块处理）。
 */
export function splitFootnoteDefinitions(
	source: string,
	indents?: readonly number[],
): {
	/** 剔除定义行与续行后的正文（行间 `\n`；未改动其它行） */
	body: string;
	/** 本节点里的定义 id（文档序；重复 id 原样保留，调用方自行去重） */
	ids: string[];
} {
	// 快速短路：没有 `[^` 就不可能有定义行（绝大多数节点走这里，省整趟行分类）
	if (!source.includes('[^')) {
		return { body: source, ids: [] };
	}
	const kept: string[] = [];
	const ids: string[] = [];
	forEachFootnoteLine(
		source,
		(line) => {
			if (line.kind === 'definition') {
				ids.push(line.id);
				return;
			}
			if (line.kind === 'continuation') {
				return; // 定义续行：随定义一起隐藏
			}
			kept.push(line.line);
		},
		indents,
	);
	return { body: kept.join('\n'), ids };
}

/**
 * 收集全文定义（**文档序**：先序 DFS，与 `walkTree` 一致）。
 *
 * 逐行扫节点的**渲染同源原文**（`domain/md-meta.nodeInlineSource`：未编辑取
 * `mdRaw`、已编辑取 `text`），因此编辑节点后索引自动跟着变——不另存快照，
 * 也就没有第二份真相。
 *
 * 同一个节点可承载多条定义（相邻定义行在解析层被合并成一个段落节点），故
 * 需要「当前定义」状态机而不是「一行一条」：
 * - 命中定义行 → 开新条（未命中过同 id 才收，见文件头的「首个生效」）；
 * - 空行 → 结束当前条（CommonMark 里空行结束段落）；
 * - **有缩进的**非空行 → 当前条的续行（相对缩进口径与 `splitFootnoteDefinitions`
 *   同源，见 `forEachFootnoteLine`；同列的非空行是另一段正文，结束当前条）；
 * - 围栏 / 缩进代码行 → 结束当前条。
 *
 * ## 数据源必须是**引擎渲染树**，不是会话权威树
 * 跳转目标要 uid，而 uid 由 `ensureUniqueUids` 在**建引擎前**补在传给引擎的那份
 * 克隆上（`engine-controller.initMindMap`）；会话权威树与解析树都没有 uid。生产
 * 消费方传 `engine/mindmap.collectRenderNodeData(mindMap)`（先序 DFS ⇒ 文档序），
 * 测试/离线场景传同样按先序展平的 data 数组。
 *
 * @param nodes 文档序的节点 data（只读；空可迭代对象返回空表）
 */
export function collectFootnoteDefinitions(
	nodes: Iterable<Record<string, unknown>>,
): Map<string, FootnoteDefinition> {
	const out = new Map<string, FootnoteDefinition>();
	for (const data of nodes) {
		const source = nodeInlineSource(data);
		// 快速短路：没有 `[^` 的节点不可能承载定义（含引用但无定义也走这条）
		if (!source || !source.includes('[^')) {
			continue;
		}
		const uid = typeof data.uid === 'string' ? data.uid : '';
		/**
		 * 当前定义（追加续行用）：`body` 以行数组累积，结束/替换时再 join——
		 * 逐行字符串拼接在大段落上是二次复杂度，而这里每次编辑都要重建索引。
		 */
		let current: { id: string; uid: string; lines: string[] } | null = null;
		const flush = (): void => {
			if (!current) {
				return;
			}
			if (!out.has(current.id)) {
				out.set(current.id, {
					id: current.id,
					body: current.lines.join('\n'),
					uid: current.uid,
				});
			}
			current = null;
		};
		forEachFootnoteLine(
			source,
			(line) => {
				if (line.kind === 'definition') {
					flush();
					current = { id: line.id, uid, lines: [line.body] };
					return;
				}
				if (line.kind === 'continuation') {
					// 续行只可能紧跟定义行 ⇒ `current` 在此非空（空行已在分类器里断开定义）
					current?.lines.push(line.text);
					return;
				}
				// 其余行（含空行、围栏、缩进代码）都结束当前定义
				flush();
			},
			nodeContinuationIndents(data),
		);
		flush();
	}
	return out;
}
