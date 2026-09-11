/**
 * 混排双链拆分：把节点行内「与描述文字混排」的双链抽离为该节点的子节点，
 * 父节点保留描述文字（双链处替换为其可见名）。
 *
 * 规则（产品决策，勿擅自放宽）：
 * - **适用节点**：`list` / `heading`（`plain` 段落无法承载子节点——解析器不把
 *   列表挂到 plain 之下，回写会造成层级静默丢失，故跳过）；
 * - **待抽链接**：`[[X]]` / `![[X]]` 且 X 末段扩展名按 `isRenderableImageExtension`
 *   判为**非图片**（文档类 .md/.canvas/.base 与其余非图片附件一律抽离）；
 *   图片、外链（`[t](url)` / `<url>` / 裸 URL）不动；
 * - **父节点**：抽出链接替换为**可见名**（别名优先；附件保留扩展名），并**删除
 *   紧邻链接的空白**（`关于 [[冬天]] 和 [[秋天]] 的相关问题` → `关于冬天和秋天的相关问题`）；
 *   该空白紧邻**未抽出的 token**（图片 / 外链 / 未被抽的链接）时保留一个空格，
 *   避免抽离后与之粘连（`![[图.png]] [[节点A]]和[[节点B]]` → `![[图.png]] 节点A和节点B`）；
 *   未被抽出的 token **保持原文语法**（如 `[[秋天.JPEG]]` 仍是链接），整行按
 *   「未编辑原文」回写（mdRaw），保证格式与链接不丢；
 * - **子节点**：保留完整双链（含别名、含 `!` 嵌入语法），显示可见名；
 * - **幂等**：拆分后父节点不再含可抽链接、子节点是纯链接节点 → 再跑一遍 no-op。
 *
 * 「当前的这一行」与序列化**同一入口**（md-serialize 的 composeNodeFirstLine），
 * 且**必须带上 `app`**：未编辑 → mdRaw（含全部 `[[ ]]`）；已编辑 → 合成行
 * （文本 + 行尾 token）。少了 app，图片会被序列化成运行期资源地址
 * （`![[app://…#图.png?1789]]`）——`rawOk` 借 app 把资源地址反查回库内路径，
 * 缺了它连**未编辑**判定都会失效，该地址随后会被当作「非图片附件」抽成子节点、
 * 拼进父节点文本，把机器地址写进用户笔记（2026-09-11 修复）。
 * 兜底：组成行内一旦出现资源地址（app://）即整体放弃拆分——宁可不动，
 * 也不把运行期地址写进用户文件。
 */
import { App } from 'obsidian';
import { isRenderableImageExtension } from './constants';
import { buildInlineData, tokenizeInline, type InlineToken } from './md-outline';
import { composeNodeFirstLine } from './md-serialize';
import { walkTree } from './domain/tree';
import { isAppResourceUrl } from './domain/url';
import {
	formatWikilink,
	parseWikilink,
	wikilinkTargetIsAttachment,
} from './domain/wikilink';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import type { MdNodeData } from './node-data';

/** 可承载子节点的行类型（plain 段落跳过，见文件头） */
const SPLITTABLE_LINE_TYPES: ReadonlySet<string> = new Set([
	'list',
	'heading',
]);

/**
 * 父节点上承载链接的字段（与解析侧三条通道一一对应）。
 * 「被抽走的首链接」占用其中一组：清空后按新行的解析结果回填。
 */
export const PARENT_LINK_FIELDS = [
	'hyperlink',
	'hyperlinkTitle',
	'mdLinkStyle',
	'mdLinkText',
	'mdWikiLinkpath',
	'attachmentUrl',
	'attachmentName',
	'mdAttachmentLinkpath',
	'mdEmbed',
	'mdEmbedPipe',
] as const;

/**
 * 目标是否按扩展名判为图片（与解析侧 isImageEmbedTarget 同口径：无扩展名/未知不算）。
 *
 * 查询串/锚点不参与扩展名判定：资源地址带 `?时间戳` 缓存串（官方 `getResourcePath`
 * 输出形态），不去掉会把 `图片.png?1789` 的扩展名读成 `png?1789` → 图片被误判为
 * 「非图片附件」而遭抽离、回写成 `![[app://…]]`（2026-09-11 修复）。
 */
function isImageTarget(target: string): boolean {
	const path = target.split(/[?#]/)[0] ?? '';
	const name = path.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return false;
	}
	return isRenderableImageExtension(name.slice(dot + 1));
}

/** 待抽离 token：`[[X]]` / `![[X]]` 且目标不是图片（外链、图片一律不动） */
function isExtractableToken(tok: InlineToken): boolean {
	if (tok.kind !== 'wiki' && tok.kind !== 'wikiImg') {
		return false;
	}
	return !isImageTarget(tok.target);
}

/**
 * 会占用节点链接字段的 token（与解析侧 firstLink 同一批）：
 * `wiki` / 非图片 `wikiImg` / `mdLink` / `autolink` / `bareUrl`。
 * 其中**首个**决定 mdWikiLinkpath / attachmentUrl / hyperlink 落点。
 */
function isLinkFieldToken(tok: InlineToken): boolean {
	if (tok.kind === 'wiki') {
		return true;
	}
	if (tok.kind === 'wikiImg') {
		return !isImageTarget(tok.target);
	}
	if (tok.kind === 'mdImg') {
		return false;
	}
	return true;
}

/**
 * 链接可见名（与解析侧显示口径一致）：别名优先；
 * 文档（含文档嵌入）去 `.md`；附件（含附件嵌入）保留扩展名——
 * 附件嵌入的管道位是尺寸参数（官方未定义语义），不作显示名。
 */
function visibleNameOf(tok: InlineToken, rawLink: string): string {
	if (tok.kind === 'wiki') {
		if (tok.label) {
			return tok.label;
		}
		const name = tok.target.split('/').pop() ?? tok.target;
		return name.replace(/\.md$/, '');
	}
	const inner = rawLink.startsWith('!') ? rawLink.slice(1) : rawLink;
	const parts = parseWikilink(inner);
	if (!parts) {
		return tok.target.split('/').pop() ?? tok.target;
	}
	const name = parts.linkpath.split('/').pop() ?? parts.linkpath;
	if (wikilinkTargetIsAttachment(parts.linkpath)) {
		return name;
	}
	return parts.alias || name.replace(/\.md$/, '');
}

/** 待追加的子节点（拆分产物） */
export interface SplitLinkChild {
	/** 可见名（子节点文本；附件嵌入为空——与解析侧「嵌入不占文本」同口径） */
	text: string;
	/** 子节点初始数据（完整双链 / 附件通道字段） */
	data: Record<string, unknown>;
}

/** 拆分方案（纯数据，由视图侧施加到引擎） */
export interface SplitLinkPlan {
	/** 父节点新「原始行」：抽出链接换成可见名、未抽 token 保持原文语法 */
	parentRaw: string;
	/** 父节点新文本（解析侧 buildInlineData 口径，与 parentRaw 同源） */
	parentText: string;
	/**
	 * 是否需要清空父节点原有链接字段（被抽走的链接占用了它们）。为真时
	 * 按 parentLinkFields 回填「新行里首个链接」的字段。
	 */
	clearParentLink: boolean;
	/** 新行的链接字段（仅清空后回填；无剩余链接时为空对象） */
	parentLinkFields: Record<string, unknown>;
	/** 待追加的子节点（按原文出现顺序，已按目标去重） */
	children: SplitLinkChild[];
}

/** 批量拆分结果 */
export interface SplitAllResult {
	/** 发生拆分的节点数 */
	nodes: number;
	/** 抽出的链接数（= 新增子节点数） */
	links: number;
}

/**
 * 把方案的**父节点部分**写入节点数据：链接字段清理/回填 + 文本 + 逐字回写依据。
 *
 * 单节点路径（引擎命令逐条插入子节点）与批量路径（数据树一次性 setData）
 * 共用本入口——字段清单与三个文本字段的写入口径只此一处，避免两处漂移。
 */
export function writeSplitPlanToData(
	data: MdNodeData,
	plan: SplitLinkPlan,
): void {
	if (plan.clearParentLink) {
		// 被抽走的链接占用了字段：先清空，再按新行解析结果回填
		//（新行里若仍有未抽出的链接，它需要字段承载图标与点击）
		for (const key of PARENT_LINK_FIELDS) {
			delete data[key];
		}
		Object.assign(data, plan.parentLinkFields);
	}
	data.text = plan.parentText;
	data.mdRaw = plan.parentRaw;
	data.mdDerivedText = plan.parentText;
}

/**
 * 就地施加方案到**数据树**节点（批量路径用；uid 由调用方经 ensureUniqueUids 补）。
 * 与单节点路径（引擎命令逐条插入）语义一致，差别只在落地方式。
 */
export function applySplitLinkPlan(
	node: MindMapTreeNode,
	plan: SplitLinkPlan,
): void {
	writeSplitPlanToData(node.data, plan);
	for (const child of plan.children) {
		node.children.push({
			data: { ...child.data },
			children: [],
		});
	}
}

/**
 * 就地批量拆分整棵数据树（含**未编辑**的存量节点）。返回拆分统计。
 *
 * - 只改传入的树，不涉及引擎；`uid` 由调用方在 setData 前补
 *   （`ensureUniqueUids`：缺失/重复会让引擎按 uid 查找时误删/漏删）；
 * - 扫描源必须是**数据树**：性能模式（`removeNodeWhenOutCanvas`）会把视口外
 *   节点移出渲染树，用渲染树扫描会静默漏掉它们；
 * - 先收集候选、再逐个施加：拆分会在遍历中插入子节点，边遍历边改会让结果不确定。
 */
export function splitAllLinksInTree(
	tree: MindMapTreeNode,
	app: App | null,
): SplitAllResult {
	const candidates: MindMapTreeNode[] = [];
	walkTree(tree, (node) => {
		candidates.push(node);
	});
	let nodes = 0;
	let links = 0;
	for (const node of candidates) {
		// 去重依据必须取子节点的 `data`（不是树节点本身）
		const plan = planSplitLinks(
			node.data,
			(node.children ?? []).map((child) => child.data),
			app,
		);
		if (!plan) {
			continue;
		}
		applySplitLinkPlan(node, plan);
		nodes++;
		links += plan.children.length;
	}
	return { nodes, links };
}

/** 从解析结果里挑出链接字段（排除 text / mdRaw / mdDerivedText 与图片字段） */
function pickLinkFields(parsed: MdNodeData): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of PARENT_LINK_FIELDS) {
		const value = parsed[key];
		if (value !== undefined && value !== null && value !== '') {
			out[key] = value;
		}
	}
	return out;
}

/** 已有子节点承载的链接目标（去重键；无链接返回 null） */
function existingLinkTarget(data: MdNodeData): string | null {
	const wiki = data.mdWikiLinkpath;
	if (typeof wiki === 'string' && wiki) {
		return parseWikilink(wiki)?.linkpath ?? wiki;
	}
	const attach = data.mdAttachmentLinkpath;
	if (typeof attach === 'string' && attach) {
		return attach;
	}
	const url = data.attachmentUrl;
	if (typeof url === 'string' && url) {
		return url;
	}
	return null;
}

/** 构造待追加的子节点（按目标去重，已有子节点与本次重复项都跳过） */
function buildChildren(
	extracted: readonly InlineToken[],
	content: string,
	existingChildren: readonly MdNodeData[],
): SplitLinkChild[] {
	const seen = new Set<string>();
	for (const child of existingChildren) {
		const target = existingLinkTarget(child);
		if (target) {
			seen.add(target);
		}
	}
	const out: SplitLinkChild[] = [];
	for (const tok of extracted) {
		const rawLink = content.slice(tok.start, tok.end);
		const inner = rawLink.startsWith('!') ? rawLink.slice(1) : rawLink;
		const parts = parseWikilink(inner);
		if (!parts || !parts.linkpath) {
			continue;
		}
		if (seen.has(parts.linkpath)) {
			continue;
		}
		seen.add(parts.linkpath);
		const name = visibleNameOf(tok, rawLink);
		const embed = rawLink.startsWith('!');
		const data: Record<string, unknown> = {};
		if (wikilinkTargetIsAttachment(parts.linkpath)) {
			// 附件通道（回形针图标）——与解析侧同字段；嵌入不占文本
			data.text = embed ? '' : name;
			data.attachmentUrl = tok.target;
			data.attachmentName = name;
			data.mdAttachmentLinkpath = tok.target;
			data.mdLinkStyle = 'wiki';
			if (embed) {
				data.mdEmbed = true;
				if (parts.alias) {
					// 管道位原文（官方未定义语义）→ 原样保留，编辑后回写不丢
					data.mdEmbedPipe = parts.alias;
				}
			}
		} else {
			// 文档通道（自绘文档页图标）：完整双链（含别名与 # 区块）
			data.text = name;
			data.mdWikiLinkpath = formatWikilink(
				parts.linkpath,
				parts.alias || undefined,
			);
			data.mdLinkStyle = 'wiki';
			data.mdLinkText = name;
			if (embed) {
				data.mdEmbed = true;
			}
		}
		// 与**解析出的**纯双链节点同构：`mdDerivedText` 是「文本未被编辑」的基准。
		// 缺了它，用户改子节点文本会退化成「新文本 + 行尾链接」（`新年 [[冬天]]`），
		// 而不是「纯双链节点编辑 = 改别名」（`[[冬天|新年]]`，见 domain/wiki-display）。
		data.mdDerivedText = typeof data.text === 'string' ? data.text : '';
		out.push({ text: name, data });
	}
	return out;
}

/** 空隙的相邻元素（行首 / 行尾为 `none`） */
type Neighbor = 'none' | 'kept' | 'extracted';

/**
 * 空隙（相邻 token 之间的文本）的空白归一——决策 R2 的完整口径：
 * - **纯空白空隙**：任一侧是**未抽出的 token**（图片 / 外链 / 未被抽的链接）时
 *   留一个空格（抽离后不与之粘连），否则整段删除；
 * - **含文本的空隙**：紧邻**被抽链接**的空白删除（两侧各自判定），
 *   相邻未抽出 token 的一侧原样保留（`![[图]] 见 [[笔记]]` → `![[图]] 见笔记`）。
 */
function normalizeGap(gap: string, left: Neighbor, right: Neighbor): string {
	if (gap === '') {
		return '';
	}
	if (gap.trim() === '') {
		return left === 'kept' || right === 'kept' ? ' ' : '';
	}
	let out = gap;
	if (left === 'extracted') {
		out = out.replace(/^[ \t]+/, '');
	}
	if (right === 'extracted') {
		out = out.replace(/[ \t]+$/, '');
	}
	return out;
}

/**
 * 计算拆分方案；不适用时返回 null（纯函数，不改动入参）。
 *
 * 不适用：非 list/heading、多行节点、无可抽链接、抽掉链接后已无其它描述文字、
 * 待抽链接均已存在于子节点（全部被去重）、行内含运行期资源地址（见文件头兜底）。
 *
 * @param data 节点数据
 * @param existingChildren 已有子节点数据（去重依据）
 * @param app 与序列化同源的宿主（缺省即放弃拆分：无它无法把资源地址反查回库内路径）
 */
export function planSplitLinks(
	data: MdNodeData,
	existingChildren: readonly MdNodeData[],
	app: App | null,
): SplitLinkPlan | null {
	const type = data.mdType;
	if (typeof type !== 'string' || !SPLITTABLE_LINE_TYPES.has(type)) {
		return null;
	}
	// 多行（列表续行合并）节点不拆：续行语义与「一行内混排」不同，避免误伤
	if (typeof data.text === 'string' && data.text.includes('\n')) {
		return null;
	}
	// 必须与序列化同口径（带 app）：缺了它，图片会以 app:// 资源地址形态进入
	// 「这一行」，未编辑判定与图片归类双双失准（见文件头）
	const content = composeNodeFirstLine(data, app);
	if (!content) {
		return null;
	}
	const tokens = tokenizeInline(content);
	// 兜底：行内出现资源地址（app://）说明这一行不是可直接写回的形态
	// （调用方未带 app，或图片已不在库中）——整体放弃，绝不把机器地址写进笔记
	if (
		tokens.some(
			(tok) =>
				(tok.kind === 'wiki' || tok.kind === 'wikiImg') &&
				isAppResourceUrl(tok.target),
		)
	) {
		return null;
	}
	const extracted = tokens.filter(isExtractableToken);
	if (extracted.length === 0) {
		return null;
	}
	const extractedSet = new Set(extracted);
	// 单趟重建两份源串（空隙按 normalizeGap 归一：两侧邻接关系都参与判定）：
	// - parentSource：抽出链接换成可见名，其余 token 保持原文（父节点新行）
	// - residualSource：抽出链接整段删除（判「是否还有其它描述文字」）
	let parentSource = '';
	let residualSource = '';
	let cursor = 0;
	let firstFieldToken: InlineToken | null = null;
	/** 已生成内容的右侧邻接元素（供下一个空隙判定） */
	let left: Neighbor = 'none';
	for (const tok of tokens) {
		const gap = content.slice(cursor, tok.start);
		cursor = tok.end;
		if (!firstFieldToken && isLinkFieldToken(tok)) {
			firstFieldToken = tok;
		}
		const raw = content.slice(tok.start, tok.end);
		const isExtracted = extractedSet.has(tok);
		// 未抽出的 token 保持原文语法（如 `[[秋天.JPEG]]` 仍是链接）
		const keptGap = normalizeGap(
			gap,
			left,
			isExtracted ? 'extracted' : 'kept',
		);
		if (isExtracted) {
			parentSource += keptGap + visibleNameOf(tok, raw);
			residualSource += keptGap;
		} else {
			parentSource += keptGap + raw;
			residualSource += keptGap + raw;
		}
		left = isExtracted ? 'extracted' : 'kept';
	}
	// 行尾：紧邻被抽链接的空白删除（决策 R2「删除紧邻空白」），行尾空白一律去掉
	const tail = content.slice(cursor).replace(/[ \t]+$/, '');
	const tailText = left === 'extracted' ? tail.replace(/^[ \t]+/, '') : tail;
	parentSource += tailText;
	residualSource += tailText;
	// 「还同时有其余描述文字」：把待抽链接整段删掉后仍有非空白内容
	//（纯 `[[a]] [[b]]` 行、纯链接节点都会在这里被判否——也是幂等的保证）
	if (buildInlineData(residualSource).text.trim() === '') {
		return null;
	}
	// 父节点新行按解析侧口径重算：文本 + 链接字段（未抽链接保持原文语法，
	// 因此 `[[秋天.JPEG]]` 这类图片链接仍是链接，图标与点击都不丢）
	const reparsed = buildInlineData(parentSource);
	const parentText = reparsed.text;
	if (parentText.trim() === '') {
		return null;
	}
	const children = buildChildren(extracted, content, existingChildren);
	if (children.length === 0) {
		return null;
	}
	return {
		parentRaw: parentSource,
		parentText,
		clearParentLink:
			firstFieldToken !== null && extractedSet.has(firstFieldToken),
		parentLinkFields: pickLinkFields(reparsed),
		children,
	};
}
