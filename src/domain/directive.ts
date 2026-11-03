/**
 * 指令块（`%%key: value%%`）的**唯一语法实现**。
 *
 * 本插件用「注释形态的独立指令行」承载那些**不能写进节点正文**的结构数据：
 *
 * ```markdown
 * ## 支付
 * %%id:9c2e%%
 * %%rel:7f3a | 依赖 | geo=right,0,left,8,12,0,-30,-12%%
 * %%sum:2 | 核心结论%%
 * ```
 *
 * - 指令块 = 紧跟节点最后一个物理行的若干**独立指令行**（**一段一行**）；
 *   每行只由指令段组成，缩进由序列化器按节点类型补（heading/plain 为 0，
 *   list 为该节点的续行缩进）；
 * - 段 = `%%key: value%%`，`key` 必须是已登记的指令关键字（本文件的
 *   {@link DIRECTIVE_KEYS}）；**未知 key 不算指令行**——普通注释（`%%备注%%`、
 *   `%%TODO: …%%`）仍按注释显示/隐藏，不会凭空改变大纲结构；
 * - 行内尾插（`标题 %%rel:x%%`）只是**读取侧**的兼容形态，写出一律独立成行。
 *
 * ## 为什么先抽这一层（2026-11-02，新增「概要」时）
 * 指令行语法此前只存在于 `domain/relation`，而它同时承担了 `rel` 的语义。加
 * `sum` 时若再抄一份「整行由段组成」的扫描，两条判据迟早分叉（一行被关系侧
 * 认作正文、又被概要侧认作指令）。故语法（段形状 / 行判定 / 尾块拆贴 / 规范
 * 顺序）**只此一处**，`relation` 与 `summary` 各自只解释**自己的 key 的 value**。
 *
 * ## 值与 key 的关系
 * 本模块**不判断 value 的语义**（id 是否 6 位、count 是否数字、标签是否合法）：
 * 那是各 key 的所有者的事。解析侧拿不到合法 value 时**丢弃该段**即可（fail-closed），
 * 整行仍是合法指令行——与「属性值坏了不该让整条边退化成普通注释」同一取舍。
 */

/** 一个指令段：`key` + 冒号后的原文 + 逐字切片 */
export interface DirectiveSegment {
	/** 小写关键字（本插件登记的三种：`id` / `rel` / `sum`） */
	key: string;
	/** 冒号后的原文（已 trim，**未做语义解析**） */
	value: string;
	/** 该段在原文里的逐字切片（含两侧 `%%`）——改写时原样带回 */
	raw: string;
}

/**
 * 已登记的指令关键字（**写侧规范顺序**即此数组顺序）。
 *
 * 新增一种指令：在这里登记 + 在自己的 domain 模块里解释 value；语法层不需要
 * 任何改动（不登记 = 该行按普通注释处理）。
 */
const DIRECTIVE_KEYS = ['id', 'rel', 'sum'] as const;

/** `key: value` 的段内形态（key 只收字母，避免把 `%%#hex%%` 这类注释当指令） */
const SEGMENT_PATTERN = /^\s*([a-z]+)\s*:\s*([\s\S]*)$/i;

/** 指令段：`%%…%%`（单行、body 内不含 `%%`） */
function isSegmentShape(segment: string): boolean {
	return (
		segment.length >= 4 &&
		segment.startsWith('%%') &&
		segment.endsWith('%%') &&
		!segment.slice(2, -2).includes('%%') &&
		!segment.includes('\n')
	);
}

/** 段 → `{key, value, raw}`；形状不符或 key 未登记返回 null（= 普通注释） */
function parseSegment(segment: string): DirectiveSegment | null {
	if (!isSegmentShape(segment)) {
		return null;
	}
	const match = SEGMENT_PATTERN.exec(segment.slice(2, -2));
	if (!match) {
		return null;
	}
	const key = (match[1] ?? '').toLowerCase();
	if (!(DIRECTIVE_KEYS as readonly string[]).includes(key)) {
		return null;
	}
	return { key, value: (match[2] ?? '').trim(), raw: segment };
}

/**
 * 把一行拆成**已解析**的指令段（本文件唯一的逐段解析入口）。
 *
 * 判定（{@link isDirectiveLine}）、状态读取（各 domain 模块）与写侧拆块共用
 * 同一份结果：同一条指令行在一次渲染里被解析多次是常态，判据必须只有一份。
 */
function parseDirectiveLine(
	line: string,
): DirectiveSegment[] | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('%%')) {
		return null;
	}
	const parsed: DirectiveSegment[] = [];
	let rest = trimmed;
	while (rest.length > 0) {
		if (!rest.startsWith('%%')) {
			return null;
		}
		const end = rest.indexOf('%%', 2);
		if (end === -1) {
			return null;
		}
		const segment = parseSegment(rest.slice(0, end + 2));
		if (!segment) {
			return null;
		}
		parsed.push(segment);
		// 段间分隔空白：`%%a%% %%b%%`
		rest = rest.slice(end + 2).replace(/^[ \t]+/, '');
	}
	return parsed;
}

/**
 * 该行是否**整行只由合法指令段组成**（解析层据此把行归属上一节点而不是新建节点）。
 *
 * 只认形状与已登记 key：value 写错（`%%rel:xyz%%`）仍是指令行（隐藏、不产生语义），
 * 免得用户的笔误在画布上冒出一个空节点。
 */
export function isDirectiveLine(line: string): boolean {
	return parseDirectiveLine(line) !== null;
}

/**
 * 行尾连续的指令段（行内兼容形态：`标题 %%rel:x%%`）——剥掉后的文本 + **已解析**的段。
 *
 * 只认行尾：行中间的 `%%rel:…%%` 属普通注释（显示层隐藏、不产生关系）。
 */
function splitTrailingSegments(line: string): {
	text: string;
	segments: DirectiveSegment[];
} {
	const segments: DirectiveSegment[] = [];
	let end = line.length;
	for (;;) {
		let cursor = end;
		while (cursor > 0 && (line[cursor - 1] === ' ' || line[cursor - 1] === '\t')) {
			cursor--;
		}
		if (cursor < 2 || line.slice(cursor - 2, cursor) !== '%%') {
			break;
		}
		const start = line.lastIndexOf('%%', cursor - 3);
		if (start === -1) {
			break;
		}
		const segment = parseSegment(line.slice(start, cursor));
		if (!segment) {
			break;
		}
		segments.unshift(segment);
		end = start;
	}
	// 段前的分隔空白一并吞掉：`标题 %%rel:x%%` → `标题`（不留行尾空格）
	return { text: line.slice(0, end).trimEnd(), segments };
}

/** 行内兼容形态的**原文**段序列（写回 / 测试用的对外形态） */
export function stripTrailingSegments(line: string): {
	text: string;
	segments: string[];
} {
	const { text, segments } = splitTrailingSegments(line);
	return { text, segments: segments.map((segment) => segment.raw) };
}

/**
 * 把原文拆成「内容 + 末尾指令段」（`segments` 为空 = 没有指令）。
 *
 * 只动末尾：行中间的指令段属于普通注释，不在这里处理（删了就是改用户正文）。
 * 段序与原文一致（行内段在前、指令行在后），调用方原样重贴即可逐字还原。
 */
export function splitDirectiveSegments(source: string): {
	content: string;
	segments: DirectiveSegment[];
} {
	const lines = source.split('\n');
	let end = lines.length - 1;
	// 至少保留首行内容：整行都是指令的孤立节点不该被清成空串（故 `kept` 恒非空）
	while (end >= 1 && isDirectiveLine(lines[end]!)) {
		end -= 1;
	}
	const kept = lines.slice(0, end + 1);
	const last = kept.length - 1;
	// 整行就是指令的**孤立节点**（没有内容行，例如文件首部的孤立指令行）：按字面
	// 文本处理，不再剥成「空节点 + 一条指令」——与 `markdown/md-outline` 的归属
	// 规则自相矛盾（它只把「上一节点存在」的指令行归属上一节点）
	const inline = parseDirectiveLine(kept[last]!)
		? { text: kept[last]!, segments: [] as DirectiveSegment[] }
		: splitTrailingSegments(kept[last]!);
	// 只有**真的剥掉了段**才改写该行：没段时逐字保留（行尾两空格是 Markdown
	// 硬换行，不是可以顺手清掉的空白）
	if (inline.segments.length > 0) {
		kept[last] = inline.text.trimEnd();
	}
	const fromLines: DirectiveSegment[] = [];
	for (const line of lines.slice(end + 1)) {
		// 尾部行必是紧邻内容的连续指令行，但保险起见仍逐行解析（解析不出就跳过）
		fromLines.push(...(parseDirectiveLine(line) ?? []));
	}
	return { content: kept.join('\n'), segments: [...inline.segments, ...fromLines] };
}

/**
 * 把原文拆成「内容 + 末尾指令块原文」（`tail` 为 `''` = 没有指令）。
 *
 * 保序、**不重排**：只更新内容行、要原样贴回尾部的调用方（改节点配色）用它。
 */
export function splitDirectiveTail(source: string): {
	content: string;
	tail: string;
} {
	const { content, segments } = splitDirectiveSegments(source);
	return { content, tail: segments.map((segment) => segment.raw).join('\n') };
}

/** 去掉原文末尾的全部指令（指令行 + 末行行尾段），返回剩下的内容 */
export function stripDirectiveTail(source: string): string {
	return splitDirectiveSegments(source).content;
}

/**
 * 段序规范化：`id` → `rel` → `sum`，同类保持原相对序，未登记的 key 排最后。
 *
 * 写侧唯一顺序来源：同内容重放必须产出同一份文本（幂等），否则「打开 → 保存」
 * 就凭空产生 diff。`Array.prototype.sort` 在 V8 上稳定，但这里仍用显式下标
 * 比较，避免依赖实现细节。
 */
function sortDirectiveSegments(
	segments: readonly DirectiveSegment[],
): DirectiveSegment[] {
	const rank = (key: string): number => {
		const index = (DIRECTIVE_KEYS as readonly string[]).indexOf(key);
		return index === -1 ? DIRECTIVE_KEYS.length : index;
	};
	return segments
		.map((segment, index) => ({ segment, index, rank: rank(segment.key) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.segment);
}

/** 段集合 → 指令块文本（一段一行、已规范化顺序；空集合 = 空串） */
export function renderDirectiveBlock(
	segments: readonly DirectiveSegment[],
): string {
	return sortDirectiveSegments(segments)
		.map((segment) => segment.raw)
		.join('\n');
}

/**
 * 用给定段集合**整体替换**原文末尾的指令块（集合为空 = 只做剥离）。
 *
 * 内容侧走 {@link stripDirectiveTail}（行内段一并剥掉）；块内的段由调用方给出
 * ——那是各 key 的所有者的事（关系写 `id`/`rel`，概要写 `sum`，互不覆盖）。
 *
 * 内容为空（空标题 / 空列表项）时**仍保留一个空内容行**：指令必须自占末行，
 * 否则它会被当成节点内容显示出来。与 `markdown/md-serialize.composeNodeContent`
 * 同口径。
 */
export function applyDirectiveBlock(
	source: string,
	segments: readonly DirectiveSegment[],
): string {
	const content = stripDirectiveTail(source);
	const block = renderDirectiveBlock(segments);
	return block ? `${content}\n${block}` : content;
}

