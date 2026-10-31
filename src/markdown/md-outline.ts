/**
 * Markdown 大纲解析：把 .mindmap.md 的正文解析为思维导图树。
 *
 * 渲染定位：本插件是 Markdown 的「渲染层」（纯 md 数据源，无专有中间格式）。
 * 本模块与 md-serialize.ts 互为逆映射（规范化保真）：
 *
 * 1) 结构：YAML frontmatter（原样保留）＋ ATX 标题（#~######）＋ 列表（缩进嵌套）
 *    ＋ 段落（合并为多行文本节点）。中心主题 = 虚拟文档根（文件名，第 0 层）；
 *    #~###### 严格对应第 1~6 级子主题；6 级标题之下用列表缩进表达第 7 级起
 *    （列表缩进降级法）；跳级标题按祖先链深度建层（mdLevel 保留原始 # 数）。
 * 2) 行内 wikilink（方案 A）：
 *    - 扫描行内全部 token：[[链接]] / [[链接|别名]] / [文本](url) / ![[图片]] / ![alt](url)；
 *    - data.text 为「剥壳显示文本」（无 [[]] 字面量残留）：链接 token 换成内部
 *      显示文本（别名优先，其次目标名），图片 token 不占文本（节点图即内容，
 *      多余图片剥壳为文本占位）；
 *    - 首个链接 token → hyperlink 字段（引擎单链：可点跳转），首个图片 → image；
 *    - 原文存 data.mdRaw、剥壳结果存 data.mdDerivedText：serialize 时若用户未
 *      编辑文本（text === mdDerivedText）整行逐字回写（mdRaw），编辑后走合成；
 *      合成按 data.mdSegments（显示文本 ↔ 原文对齐表）把有显示名的 token 写回
 *      **原位**，对不上/无对齐信息者才尾插（见 domain/md-meta.MdTokenSegment）。
 * 3) 行内轻标记（** * ` ~~ HTML）不剥离，原样保留（无损往返）。
 */

import type { MindMapTreeNode } from '../core/engine-types';
import {
	formatWikilink,
	linkDisplayText,
	parseWikilink,
	wikilinkTargetIsAttachment,
} from '../domain/wikilink';
import { isUrlLikeText } from '../domain/url';
import { parseTaskPrefix, stripTaskPrefix } from '../domain/md-task';
import { isIndentedCodeLine } from '../core/constants';
import { isDirectiveLine, stripTrailingSegments } from '../domain/relation';
import type { MdTokenSegment } from '../domain/md-meta';
import type { MdNodeData } from '../core/node-data';
import { classifyLines, leadingSpaces } from './md-outline-lines';
import {
	isImageEmbedTarget,
	tokenAnchors,
	tokenDisplay,
	tokenizeInline,
} from './md-outline-inline';

/**
 * 行内 token 族已拆到 `md-outline-inline`，此处**转出**同一符号：既有引用方
 * （`md-serialize` / `md-serialize-inline` / `tests/md-inline`）无需改 import 路径，
 * 模块对外接口保持不变。
 */
export { tokenDisplay, tokenizeInline };
export type { InlineToken } from './md-outline-inline';

export interface MdParseResult {
	tree: MindMapTreeNode;
	/** 原样保留的 frontmatter 块（含首尾 ---），无则为 null */
	frontmatter: string | null;
}

/** UTF-8 BOM：Windows 编辑器/同步工具可能写在文件开头（Obsidian 自己不加） */
export const UTF8_BOM = '\uFEFF';

/** frontmatter 围栏行：`---` 独占一行（允许行尾空白） */
const FM_FENCE_RE = /^---[ \t]*$/;
/** 块标量起始行（`键: |` / `键: >-` / `键: |2`）：其后的 `---` 行属属性内容 */
const FM_BLOCK_SCALAR_RE = /^([ \t]*)[^#\s][^:]*:[ \t]*[|>][-+]?[0-9]*[ \t]*$/;

/**
 * 解析可写的**链接通道**字段（三通道 + 嵌入标记）。
 *
 * 用途：需要「整体重建节点行内字段」时按它清空旧值再按新解析回填——解析侧是
 * 这些字段的**唯一作者**，清单也只在这里定义一次（links-split 的
 * `PARENT_LINK_FIELDS`、md-line-write 的原文编辑清除清单都引用本常量，勿再抄一份）。
 * 图片字段另见 `PLAIN_IMAGE_FIELDS`（拆分不清图片，原文编辑两者都清）。
 */
export const INLINE_LINK_FIELDS = [
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
 * 段落（plain）首行采纳的**图片**字段（不含链接字段）。
 *
 * 段落此前完全不承载图片字段 → 行内 `![[图.png]]` 在地图上永远不渲染，
 * 往段落插图后保存会被静默丢弃（回写分支只写文本）。现改为与 list/heading
 * 同构地承载首行图片。**链接字段仍不采纳**：段落里的链接语法属原文，
 * 未编辑时随 mdRaw 逐字回写（见 docs/markdown-mindmap-standard.md §3.1）。
 */
export const PLAIN_IMAGE_FIELDS = [
	'image',
	'mdImageTarget',
	'mdImageWidth',
	'mdImageHeight',
	'mdImageAlt',
	// 语法形态（wiki `![[图]]` / md `![alt](图)`）：解析期记录，编辑后合成回写
	// 须保持用户原本的写法，故必须随图片字段一起被采纳/重建
	'mdImageStyle',
] as const;

/**
 * 剥离**行内兼容形态**的联系指令（`标题 %%rel:xxxxxx%%`）：显示文本去掉该段，
 * 原文进 `mdDirectiveTail`，回写时归一为独立指令行。
 *
 * **整行就是指令行**时按字面文本处理（`parseMdOutline` 只把「上一节点存在」的
 * 指令行归属于上一节点；文件首部的孤立指令行仍是一个显示 `%%id:…%%` 的段落，
 * 这里剥掉会把它变成"空节点 + 一条关系"，与归属规则自相矛盾）。
 */
function splitInlineDirectiveTail(
	raw: string,
	text: string,
): { text: string; segments: string[] } {
	if (!raw.includes('%%') || isDirectiveLine(raw)) {
		return { text, segments: [] };
	}
	return stripTrailingSegments(text);
}

/** 从行内解析结果里挑出图片字段（无图片时返回空对象） */
function pickImageMeta(inline: MdNodeData): MdNodeData {
	const out: Record<string, unknown> = {};
	for (const key of PLAIN_IMAGE_FIELDS) {
		const value = inline[key];
		if (value !== undefined) {
			out[key] = value;
		}
	}
	return out;
}

/** buildInlineData 的稳定字段（text/mdRaw/mdDerivedText 恒为 string） */
export interface InlineData extends MdNodeData {
	text: string;
	mdRaw: string;
	mdDerivedText: string;
}

/**
 * 单行行内处理（方案 A）：
 * @returns data 含 text（剥壳显示文本）、mdRaw（原文）、mdDerivedText（=text，
 *   供 serialize 判断文本是否被用户编辑），以及首链接/首图字段。
 *
 * export 供 links-split 复用：拆分后的父文本重建必须与解析侧**同一口径**
 * （`[[ ]]` 剥壳为显示名、非首个链接降级为文本、URL icon-only 等），
 * 在别处重写一遍必然漂移。
 */
export function buildInlineData(raw: string): InlineData {
	const toks = tokenizeInline(raw);
	// 无 token 快路径（纯文本行）：整行即显示文本，省去 pieces 数组 + 切片 +
	// join 的分配；归一化（连续空格折叠 + trim）与下方通用路径同口径。
	// 「链接引用定义行」的守卫在 buildLineInlineData 层，不经过本条分支。
	if (toks.length === 0) {
		const joined = raw.replace(/[ \t]{2,}/g, ' ').trim();
		const tailSplit = splitInlineDirectiveTail(raw, joined);
		const display = tailSplit.text.trimEnd();
		const data: InlineData = { text: display, mdRaw: raw, mdDerivedText: display };
		// 行内兼容形态的**指令段**（`标题 %%rel:x%%`）：剥进 mdDirectiveTail，
		// 显示 / 搜索 / 引擎编辑框都不该看到它们（标准形态是独立指令行）
		if (tailSplit.segments.length > 0) {
			data.mdDirectiveTail = tailSplit.segments.join(' ');
		}
		return data;
	}
	const data: InlineData = {
		text: '',
		mdRaw: raw,
		mdDerivedText: '',
	};
	let firstLink = false;
	let firstImg = false;
	const pieces: string[] = [];
	/**
	 * 行内 token 台账（显示文本 ↔ 原文对齐表，见 domain/md-meta.MdTokenSegment）：
	 * 首 token 记实时形态（`first: true`），额外 token 记**原文切片**（`first: false`
	 * ——多链接 / 多 URL / 多图的保真回写数据，此前单存 mdExtraTokens，已并入本表）。
	 */
	const segments: MdTokenSegment[] = [];
	let cursor = 0;
	for (const [tokIndex, tok] of toks.entries()) {
		/** 本 token 是否被「首链 / 首图」字段承载（合成时取实时形态还是原文） */
		let firstForThisToken = false;
		pieces.push(raw.slice(cursor, tok.start));
		// 上一个 token 的结尾：锚点只取「紧邻」文字，不能跨越已消费的 token
		const prevTokenEnd = cursor;
		cursor = tok.end;
		const nextTokenStart = toks[tokIndex + 1]?.start ?? raw.length;
		if (tok.kind === 'wikiImg' || tok.kind === 'mdImg') {
			// 非图片的嵌入 `![[X]]`，按**目标类型**分两路（Obsidian 语义：末段为
			// `.md` 或无扩展名 = 文档；其余扩展名 = 附件，判据
			// `domain/wikilink.wikilinkTargetIsAttachment`）：
			//
			// ① 文档嵌入 `![[笔记]]` / `![[笔记.md]]` / `![[笔记#标题|别名]]`
			//    → 与文档双链**同通道**（`mdWikiLinkpath`，自绘文档页图标），
			//    节点文本 = 别名‖去 `.md` 的目标名（与 `[[笔记]]` 同口径）。
			//    **管道位是别名，不是尺寸**——故不能沿用 tokenizeInline 已按图片
			//    尺寸剥过的 `tok.label`，必须从原始切片重解：
			//    `![[笔记|300]]` 的 "300" 是别名，不是宽 300。
			// ② 附件嵌入 `![[报告.pdf]]` / `![[录音.mp3]]`
			//    → 非图片富媒体无法作为节点图渲染（会空白），走附件通道
			//    （回形针 + 点击打开）；该形态管道位才是尺寸参数。
			//
			// 两路都记 `mdEmbed`，回写时补回 `!` 以保往返。
			if (tok.kind === 'wikiImg' && !isImageEmbedTarget(tok.target)) {
				const rawSlice = raw.slice(tok.start, tok.end);
				const wiki = parseWikilink(
					rawSlice.startsWith('!') ? rawSlice.slice(1) : rawSlice,
				);
				const linkpath = wiki?.linkpath ?? tok.target;
				if (wikilinkTargetIsAttachment(linkpath)) {
					data.attachmentUrl = tok.target;
					data.attachmentName = tokenDisplay(tok);
					data.mdAttachmentLinkpath = tok.target;
					data.mdLinkStyle = 'wiki';
					data.mdEmbed = true;
					// 管道位原文（`![[报告.pdf|300]]` 的 300）：官方未定义其语义，
					// 原样保留以便编辑节点后回写不丢（见 md-meta.mdEmbedPipe）
					if (wiki?.alias) {
						data.mdEmbedPipe = wiki.alias;
					}
					continue;
				}
				const link = formatWikilink(linkpath, wiki?.alias || undefined);
				const embedSlice = raw.slice(tok.start, tok.end);
				if (!firstLink) {
					firstLink = true;
					firstForThisToken = true;
					data.mdWikiLinkpath = link;
					data.mdLinkStyle = 'wiki';
					data.mdEmbed = true;
					data.mdLinkText = linkDisplayText(link);
					// 与文档双链同口径：剥壳显示名进节点文本（去 `.md`）
					pieces.push(data.mdLinkText);
					segments.push({
						kind: 'link',
						text: data.mdLinkText,
						raw: embedSlice,
						first: true,
					});
				} else {
					const display = linkDisplayText(link);
					pieces.push(display);
					// 非首个文档/附件嵌入：剥壳为文本（上行）+ 原文进台账
					segments.push({ kind: 'link', text: display, raw: embedSlice, first: false });
				}
				continue;
			}
			if (!firstImg) {
				firstImg = true;
				data.image = tok.target;
				data.mdImageTarget = tok.target;
				// 语法形态：原文是 `![alt](图.png)` 记 md、`![[图.png]]` 记 wiki
				// ——编辑节点后合成回写要沿用同一形态（见 domain/md-meta.MdImageStyle）
				data.mdImageStyle = tok.kind === 'mdImg' ? 'md' : 'wiki';
				// 嵌入标签里的非尺寸文本（alt）：`![说明|300](url)` 与
				// `![[图.png|说明]]` 都可能是用户写的说明，节点编辑后合成回写
				// 需原样保留（此前只对 mdImg 存 alt，wiki 嵌入的说明会丢失）
				if (tok.label) {
					data.mdImageAlt = tok.label;
				}
				// 官方嵌入尺寸参数（![[图|300]] / ![alt|300](url)）：仅首图生效，
				// 高度缺省时由加载校正按原始宽高比补齐
				if (tok.sizeWidth !== undefined) {
					data.mdImageWidth = tok.sizeWidth;
					if (tok.sizeHeight !== undefined) {
						data.mdImageHeight = tok.sizeHeight;
					}
				}
				// 首图以节点图呈现，不占文本 → **必须**登记台账段（text 为空串 +
				// 上下文锚点）：否则合成回写找不到原位，只能尾插 → 图片被搬到行尾、
				// 且行尾凭空多出空格（拖拽调宽即会踩到，见 tokenAnchors）。
				segments.push({
					kind: 'image',
					text: '',
					raw: raw.slice(tok.start, tok.end),
					first: true,
					...tokenAnchors(raw, tok.start, tok.end, prevTokenEnd, nextTokenStart),
				});
			} else {
				const display = tokenDisplay(tok);
				pieces.push(display);
				// 非首图（同行多余图片）：剥壳为文本（上行）+ 原文进台账
				segments.push({
					kind: 'image',
					text: display,
					raw: raw.slice(tok.start, tok.end),
					first: false,
				});
			}
			continue;
		}
		if (tok.kind === 'wiki') {
			if (!firstLink) {
				firstLink = true;
				firstForThisToken = true;
				if (wikilinkTargetIsAttachment(tok.target)) {
					// 双链指向附件：走引擎 attachmentUrl（回形针图标，点击经
					// node_attachmentClick 事件接管），不写 hyperlink 以免
					// 链接图标双显；原始 linkpath 存回写字段（合成时重建 wikilink）
					data.attachmentUrl = tok.target;
					data.attachmentName = tokenDisplay(tok);
					data.mdAttachmentLinkpath = tok.target;
					data.mdLinkStyle = 'wiki';
				} else {
					// 双链指向文档：不写 hyperlink——引擎会为任何 hyperlink 渲染
					// 原生链接图标，与自绘文档页图标（mindmap.ts 前缀内容）双显
					//（图标仅未接管节点可见；自绘节点链接为主题链接色文本、无图标）。
					// 链接本体存 mdWikiLinkpath，由文档图标承接点击
					data.mdWikiLinkpath = formatWikilink(
						tok.target,
						tok.label || undefined,
					);
					data.mdLinkStyle = 'wiki';
					// 图标/悬停提示的目标显示名
					data.mdLinkText = tokenDisplay(tok);
				}
			}
			// 非首个双链：剥壳为文本 + 原文入台账，均由下方统一处理（不另 push）
		} else if (tok.kind === 'autolink' || tok.kind === 'bareUrl') {
			// 自动链接（<url> 尖括号 / 裸 URL）→ 同语义：URL 本体不渲染进
			// 节点文本（icon-only，节点仅显示超链接图标）；回写为 <url>
			if (!firstLink) {
				firstLink = true;
				firstForThisToken = true;
				data.hyperlink = tok.target;
				data.mdLinkStyle = 'md';
				data.mdLinkText = tok.target;
				data.hyperlinkTitle = tok.target;
			}
			// 非首个 URL：不渲染进文本（icon-only 一贯性）→ 只由下方「无显示名
			// 额外 token」分支登记原文（不入文本，故不参与原位定位）
		} else if (!firstLink) {
			firstLink = true;
			firstForThisToken = true;
			data.hyperlink = tok.target;
			data.mdLinkStyle = 'md';
			data.mdLinkText = tok.label || tok.target;
			data.hyperlinkTitle = tokenDisplay(tok);
		}
		// 非首个 md 链接：剥壳文本与原文切片均由下方统一处理（有显示名 → 入文本 +
		// 台账；label 本身是 URL → 只入台账的「无显示名」分支）
		// URL token（autolink/bareUrl）与「label 本身是 URL」的 md 链接
		// （[https://…](https://…)，复制粘贴常见形态）一律 icon-only：
		// URL 本体不渲染进节点文本（避免长 URL 撑宽节点），节点仅显示图标
		if (
			tok.kind !== 'autolink' &&
			tok.kind !== 'bareUrl' &&
			!(tok.kind === 'mdLink' && isUrlLikeText(tok.label))
		) {
			const display = tokenDisplay(tok);
			pieces.push(display);
			// 有显示名的 token：编辑后按显示名在新文本里原位恢复（K52）
			segments.push({
				kind: 'link',
				text: display,
				raw: raw.slice(tok.start, tok.end),
				first: firstForThisToken,
			});
		} else {
			// **无显示名** token（icon-only URL：autolink / 裸 URL / label 为 URL 的
			// md 链接；以及首枚这类 token）：本体不进节点文本，只显图标 → 台账记
			// 原文 + **上下文锚点**，合成时按锚点原位插回（见 tokenAnchors）。
			// 首 token 此前不入表（只保首链由 hyperlink 字段实时渲染），但那样
			// 一旦文本被编辑就只剩尾插 → URL 被搬到行尾，故一并登记。
			segments.push({
				kind: 'link',
				text: '',
				raw: raw.slice(tok.start, tok.end),
				first: firstForThisToken,
				...tokenAnchors(raw, tok.start, tok.end, prevTokenEnd, nextTokenStart),
			});
		}
	}
	if (segments.length > 0) {
		data.mdSegments = segments;
	}
	pieces.push(raw.slice(cursor));
	// 纯图行 → 图片独占节点（text 为空）：图片是节点的全部内容，
	// 不再回退文件名占位文本（旧行为会把文件名当作节点文本，
	// 使「删文字后图片独占节点」无法在往返中保持）。
	// 代价：纯图节点不参与文本搜索（图片文件名仍可经引擎 hover 查看）。
	// URL token（icon-only）剥离后相邻文本可能留下连续空格，折叠为单空格
	//（HTML 渲染语义本就折叠空白；原文由 mdRaw 保真，不受影响）。
	const joined = pieces
		.join('')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
	// 行内兼容形态的指令段同样剥进 mdDirectiveTail（见上方快路径的同款处理）
	const tailSplit = splitInlineDirectiveTail(raw, joined);
	const display = tailSplit.text.trimEnd();
	if (tailSplit.segments.length > 0) {
		data.mdDirectiveTail = tailSplit.segments.join(' ');
	}
	data.text = display;
	data.mdDerivedText = display;
	return data;
}

/**
 * 链接引用定义行（参考式链接 `[label]: destination` / OFM 脚注 `[^id]: 内容`）。
 *
 * 这类行是**语法基础设施、不是链接**：本插件不渲染参考式链接的链接行为，
 * 但行内 destination 若是裸 URL，会被 buildInlineData 误走「URL icon-only」
 * 通道摘出文本——编辑节点时 URL 被挪到行尾（合成路径），`[label]` 引用全部
 * 失效（2026-09-13 规划实测）。故命中本判定的行**整体按纯文本处理**：
 * 不提取任何链接字段（URL 留在文本里，保真优先；节点会显示完整定义文本）。
 *
 * 判定口径：
 * - 脚注 `[^id]:` 后内容任意（Basic formatting syntax 的脚注定义形态）；
 * - 参考式 `[label]:` 后必须是合法 destination（`<…>` 或非空白串，与
 *   CommonMark link reference definition 一致），可选尾部 title（"…"/'…'/(…)）。
 *   `[X]:` 后无 destination 的普通叙述不算（不豁免）。
 * 生产消费方：links-split 的参考式识别（同一入口，勿在调用方另写一份判定）。
 */
const LINK_REF_DEF_RE = /^\[([^\]\n]+)\]:[ \t]*(.*)$/;

export function isLinkReferenceDefinition(content: string): boolean {
	const m = LINK_REF_DEF_RE.exec(content.trim());
	if (!m) {
		return false;
	}
	const label = m[1] ?? '';
	if (label.startsWith('^')) {
		return true; // 脚注定义：内容任意
	}
	const rest = (m[2] ?? '').trim();
	if (!rest) {
		return false;
	}
	// destination（`<…>` 或非空白串）+ 可选 title（三形态，尾随）
	return /^(?:<[^>\n]+>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?$/.test(
		rest,
	);
}

/**
 * 行级行内数据入口：`buildInlineData` + 「链接引用定义行整体按纯文本」守卫。
 *
 * 逐字回写（rawOk）不受影响；差异只发生在**编辑后合成**：
 * 定义行的 URL 留在文本里（而非被摘成 icon-only token 挪到行尾）。
 */
function buildLineInlineData(raw: string): InlineData {
	if (isLinkReferenceDefinition(raw)) {
		const text = raw.trim();
		return { text, mdRaw: raw, mdDerivedText: text };
	}
	return buildInlineData(raw);
}

// ---------------------------------------------------------------------------
// 正文解析
// ---------------------------------------------------------------------------

/**
 * 拆分 YAML frontmatter（含首尾 ---）与正文。
 *
 * 三条口径（前两条为 2026-09-12 修复，均向 Obsidian 自身的属性解析对齐）：
 * - **空属性块**（`---\n---`，属性被删光/模板产物）也是合法 frontmatter——
 *   此前要求至少一行内容，于是它被并进正文、保存后整块消失；
 * - 结束围栏取**第一个 `---` 行，但跳过 YAML 块标量（`|` / `>`）内部的 `---`**：
 *   实测 Obsidian 在 `desc: |` 里写一行 `---` 时属性面板仍显示为含该行的多行值；
 *   按"第一个 `---`"硬切会把属性截断、残余落进正文写回文件；
 * - **开头 BOM** 计入 frontmatter（写入时原样带回），不留在正文里——否则首个
 *   `# 标题` 匹配不到标题正则（降级为段落）、首个 `- 项` 会被算出一个假缩进。
 *
 * 逐字保留原始换行形态（CRLF 不归一：frontmatter 要原样回写）。
 * 遇到 body 开头又有 ---（用户误加第二次 frontmatter）时只取第一个并 console.warn。
 * 生产消费方：parseMdOutline（下方）与 document-service 的外部改动检测（同一入口）。
 */
export function splitFrontmatter(content: string): {
	body: string;
	frontmatter: string | null;
} {
	const bom = content.startsWith(UTF8_BOM) ? UTF8_BOM : '';
	const rest = bom ? content.slice(bom.length) : content;
	/** 结束围栏之后（含换行）在 rest 中的索引；-1 = 不是 frontmatter */
	let frontmatterEnd = -1;
	/** 当前块标量的起始缩进；null = 不在块标量内 */
	let blockIndent: number | null = null;
	let started = false;
	let lineStart = 0;
	while (lineStart <= rest.length) {
		const nl = rest.indexOf('\n', lineStart);
		const lineEnd = nl === -1 ? rest.length : nl;
		const rawLine = rest.slice(lineStart, lineEnd);
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const nextStart = nl === -1 ? rest.length + 1 : nl + 1;

		if (!started) {
			if (!FM_FENCE_RE.test(line)) {
				break; // 首行不是 `---`：没有 frontmatter
			}
			started = true;
			lineStart = nextStart;
			continue;
		}
		if (blockIndent !== null) {
			// 块标量内容：空行与更深缩进的行都算内容（含 `---` 行），
			// 直到出现缩进 ≤ 起始缩进的非空行
			if (line.trim() === '' || leadingSpaces(line) > blockIndent) {
				lineStart = nextStart;
				continue;
			}
			blockIndent = null;
		}
		const scalar = FM_BLOCK_SCALAR_RE.exec(line);
		if (scalar) {
			blockIndent = scalar[1]!.length;
		} else if (FM_FENCE_RE.test(line)) {
			frontmatterEnd = nextStart > rest.length ? rest.length : nextStart;
			break;
		}
		lineStart = nextStart;
	}

	if (frontmatterEnd === -1) {
		return { body: rest, frontmatter: bom || null };
	}
	const frontmatter = bom + rest.slice(0, frontmatterEnd);
	const body = rest.slice(frontmatterEnd);
	// 误加第二次 frontmatter：body 开头又是 ---
	if (FM_FENCE_RE.test(body.split(/\r?\n/, 1)[0] ?? '')) {
		console.warn(
			'[Mindmap-Studio] 检测到重复 YAML frontmatter，仅第一个生效。',
		);
	}
	return { frontmatter, body };
}

/**
 * 解析 md 正文为导图树。
 * @param content 完整文件内容（可含 frontmatter）
 * @param rootName 根（虚拟文档节点）名称，通常传文件 basename
 */
export function parseMdOutline(
	content: string,
	rootName: string,
): MdParseResult {
	const { body, frontmatter } = splitFrontmatter(content);
	const lines = classifyLines(body);

	// 虚拟文档根：text=文件名；回写时不输出该行
	const root: MindMapTreeNode = { data: { text: rootName }, children: [] };
	if (lines.length === 0) {
		return { frontmatter, tree: root };
	}

	/** heading 栈：[节点, # 数量]；虚拟根视作 level 0 恒在栈底 */
	const headingStack: { node: MindMapTreeNode; level: number }[] = [
		{ node: root, level: 0 },
	];
	/** 当前内容挂载点（= 栈顶 heading 节点） */
	let contentParent: MindMapTreeNode = root;
	/** list 缩进栈：仅跟踪同一内容区内的列表嵌套 */
	let listStack: { node: MindMapTreeNode; indent: number }[] = [];
	/**
	 * 等待合并的相邻 plain 文本行：`raw` 是未 trim 的原文（写进 mdRaw，保逐字回写），
	 * `text` 是 trim 后的显示文本（进节点文本、参与行内 token 解析）。
	 * `directive` = 该行是**指令行**（整行只有联系指令）：只进 mdRaw，不进 text。
	 */
	let plainBuffer: { raw: string; text: string; directive?: boolean }[] = [];
	/**
	 * 文档序上最近产出的节点（heading / list / plain）。
	 *
	 * 唯一的消费方是**指令行归属**（2026-10-30）：`%%id:xxxxxx%%` 这类整行只有指令的
	 * 行不产出节点，而是挂到上一个节点的 mdRaw 末行。标题节点尤其需要——行内尾插会
	 * 让 Obsidian 的 heading 文本变成 `支付 %%id:…%%`，`[[#标题]]` 与 `^block-id` 全废。
	 */
	let lastNode: MindMapTreeNode | null = null;

	/** 把一行指令挂到上一个节点（只动 mdRaw / mdDirectiveTail，不产出节点） */
	const attachDirectiveLine = (rawLine: string): boolean => {
		if (!lastNode) {
			return false;
		}
		const line = rawLine.trim();
		const data = lastNode.data as MdNodeData;
		const prevRaw = typeof data.mdRaw === 'string' ? data.mdRaw : '';
		// 内容为空（空标题 / 空列表项）时**保留一个空内容行**：指令占的是下一行，
		// 写成 `%%id%%` 单行会让序列化把它当成内容贴到标记后面（`- %%id:…%%`）
		data.mdRaw = prevRaw === '' ? `\n${line}` : `${prevRaw}\n${line}`;
		const prevTail =
			typeof data.mdDirectiveTail === 'string' ? data.mdDirectiveTail.trim() : '';
		data.mdDirectiveTail = prevTail ? `${prevTail}\n${line}` : line;
		return true;
	};

	const flushPlain = (): void => {
		if (plainBuffer.length === 0) {
			return;
		}
		// mdRaw 用**未 trim 的原文**整块保留（缩进/行尾空格是 Markdown 语义）；
		// 显示文本仍走 trim 后的 text，行首缩进不进节点文本
		const raw = plainBuffer.map((line) => line.raw).join('\n');
		// 段落按行 token 化（保留行独立性）：**每行只解析一次**，首行的完整结果
		// 复用给下面的图片字段提取（此前首行会再解析一遍）
		const derived: string[] = [];
		/** 本段的联系指令（指令行 + 行内兼容形态），按出现顺序 */
		const tails: string[] = [];
		let firstLineData: ReturnType<typeof buildLineInlineData> | null = null;
		for (const line of plainBuffer) {
			if (line.directive) {
				tails.push(line.raw.trim());
				continue;
			}
			const d = buildLineInlineData(line.text);
			firstLineData ??= d;
			derived.push(d.text);
			if (d.mdDirectiveTail) {
				tails.push(d.mdDirectiveTail);
			}
		}
		// 首行图片进节点字段（缩进代码块的首行属代码内容，不采纳）；
		// 其余行与链接语法仍靠 mdRaw 逐字保真。
		// 指令行只会在缓冲**已有内容**时入列（见调用点），故首行恒是内容行。
		const first = plainBuffer[0]!;
		const imageMeta =
			isIndentedCodeLine(first.raw) || !firstLineData
				? {}
				: pickImageMeta(firstLineData);
		// `text` 与 `mdDerivedText` 在**解析期恒等**（两者都取自 derived），
		// 差异只出现在用户编辑之后：`text` 变、`mdDerivedText` 保留为解析快照
		// （`editedWikilinkAlias` 等闸门正是靠这个不等判定「被编辑过」，
		// 见 domain/md-meta.ts 契约）。故这里 join 一次复用同一字符串，
		// 避免同一份内容拼两遍（大文档的段落节点是逐个 flushPlain，此处省的是
		// 每段的第二次 O(n) 拼接）。
		const derivedText = derived.join('\n');
		const data: MdNodeData = {
			text: derivedText,
			mdRaw: raw,
			mdDerivedText: derivedText,
			mdType: 'plain',
			...imageMeta,
		};
		if (tails.length > 0) {
			data.mdDirectiveTail = tails.join('\n');
		}
		const node: MindMapTreeNode = { data, children: [] };
		contentParent.children.push(node);
		lastNode = node;
		plainBuffer = [];
	};

	const attachList = (rawText: string, marker: string, indent: number): void => {
		flushPlain();
		// 弹出缩进不小于当前的所有栈顶
		while (
			listStack.length > 0 &&
			listStack[listStack.length - 1]!.indent >= indent
		) {
			listStack.pop();
		}
		const parent =
			listStack.length > 0
				? listStack[listStack.length - 1]!.node
				: contentParent;
		// 任务列表项（GFM task）：token 留在 mdRaw（逐字回写依据），显示文本
		// 与派生文本一起剥——只剥一个会让 rawOk 恒假、整篇任务节点被合成回写
		const inline = buildLineInlineData(rawText);
		const task = parseTaskPrefix(rawText);
		if (task) {
			inline.text = stripTaskPrefix(inline.text);
			inline.mdDerivedText = inline.text;
			inline.mdTask = task.state;
			inline.mdTaskToken = task.token;
		}
		const node: MindMapTreeNode = {
			data: {
				...inline,
				mdType: 'list',
				mdMarker: marker,
			},
			children: [],
		};
		parent.children.push(node);
		listStack.push({ node, indent });
		lastNode = node;
	};

	for (const line of lines) {
		if (line.kind === 'heading') {
			flushPlain();
			listStack = [];
			const level = line.level ?? 1;
			while (
				headingStack.length > 1 &&
				headingStack[headingStack.length - 1]!.level >= level
			) {
				headingStack.pop();
			}
			const parent = headingStack[headingStack.length - 1]!.node;
			const node: MindMapTreeNode = {
				data: {
					...buildLineInlineData(line.text),
					mdType: 'heading',
					mdLevel: level,
				},
				children: [],
			};
			parent.children.push(node);
			headingStack.push({ node, level });
			contentParent = node;
			lastNode = node;
			continue;
		}
		if (line.kind === 'plain') {
			// **指令行**（整行只有联系指令，`domain/relation.isDirectiveLine`）不产出
			// 节点，归属上一个节点（2026-10-30）。必须在「列表续行合并」之前拦截：
			// 列表项的指令行按 restIndent 缩进，否则会被当成续行并进 text。
			// 段落缓冲非空时交给 flushPlain（指令行在段落内部不算节点内容）。
			if (isDirectiveLine(line.text)) {
				if (plainBuffer.length > 0) {
					plainBuffer.push({
						raw: line.raw ?? line.text,
						text: line.text,
						directive: true,
					});
					continue;
				}
				if (attachDirectiveLine(line.raw ?? line.text)) {
					continue;
				}
				// 文件首部的孤立指令行：没有上一个节点，按普通段落处理（fail-closed）
			}
			// list 项的续行（缩进大于栈顶 list 且当前处于 list 区）→ 并入文本。
			// **空白续行**（围栏闭合后的分隔空行，classifyLines 仅在围栏相邻时保留）
			// 同样并入前项 mdRaw——否则会产出一个空文本节点（2026-09-28 修）；
			// 并入后**结束列表区**（空行结束 list 的既有语义不变，后续同级项不嵌套）。
			const isBlankLine =
				line.text.trim() === '' && (line.raw ?? '').trim() === '';
			if (
				listStack.length > 0 &&
				(isBlankLine ||
					line.indent > listStack[listStack.length - 1]!.indent)
			) {
				const top = listStack[listStack.length - 1]!.node;
				const inline = buildInlineData(line.text);
				// 解析产物携带 md* 元数据，按渲染层合并视图收窄（引擎类型未声明）
				const topData = top.data as MdNodeData;
				const prevText = topData.text ?? '';
				const prevDerived = topData.mdDerivedText ?? '';
				const prevRaw = topData.mdRaw ?? '';
				topData.text = `${prevText}\n${inline.text}`;
				topData.mdDerivedText = `${prevDerived}\n${inline.text}`;
				// 续行里的行内兼容指令（`续行 %%rel:x%%` 极罕见但可能）随主行一起归并
				if (inline.mdDirectiveTail) {
					const prevTail =
						typeof topData.mdDirectiveTail === 'string'
							? topData.mdDirectiveTail
							: '';
					topData.mdDirectiveTail = prevTail
						? `${prevTail}\n${inline.mdDirectiveTail}`
						: inline.mdDirectiveTail;
				}
				// 续行只保留**行尾**原文（行首缩进由序列化器按树深度补 restIndent，
				// 两者都留会写出双份缩进）；text 仍用 trim 后的显示文本
				topData.mdRaw = `${prevRaw}\n${(line.raw ?? line.text).trimStart()}`;
				if (isBlankLine) {
					listStack = [];
				}
				continue;
			}
			listStack = [];
			plainBuffer.push({ raw: line.raw ?? line.text, text: line.text });
			continue;
		}
		// list 行
		attachList(line.text, line.marker ?? '-', line.indent);
	}
	flushPlain();
	return { frontmatter, tree: root };
}

/**
 * 解析**剪贴板片段**为若干同级子树（粘贴入口专用）。
 *
 * 与整篇解析（`parseMdOutline`）的差异只有**形态归一**——粘进来的是「新
 * 节点」，不该带源文档的记号语义（2026-10-13 用户裁决）：
 * - 标题 `#`~`######`（不论几个 `#`）→ **无序节点**，层级改由**缩进**表达
 *   （`mdType`/`mdLevel` 一并剥掉：留着会让下一次回写又冒出 `#`）；
 * - 无序标记 `*` / `+`、以及标题/段落（无标记）→ 归一为 `-`；
 * - **有序项 `1.` 保留**——编号由序列化侧按层重排（与文档回写同一规则）。
 *
 * 解析本身（frontmatter 剥除、行内 token、`mdRaw` 逐字原文）完全复用
 * `parseMdOutline`：层级规则写第二份必然与文档往返漂移（硬规则 5）。
 *
 * @returns 片段顶层节点（可直接作为 `INSERT_MULTI_CHILD_NODE` 的 childList）
 */
export function parseMdOutlineFragment(text: string): MindMapTreeNode[] {
	const nodes = parseMdOutline(text, '').tree.children;
	// 显式栈而非递归：剪贴板文本的缩进深度由外部内容决定，
	// 递归实现在超深层级上会栈溢出（与 md-serialize 的 walker 同口径）
	const stack = [...nodes];
	while (stack.length > 0) {
		const node = stack.pop()!;
		const data = node.data as MdNodeData;
		if (data.mdType === 'heading' || data.mdType === 'plain') {
			delete data.mdType;
			delete data.mdLevel;
		}
		if (data.mdMarker !== 'ordered') {
			data.mdMarker = '-';
		}
		if (node.children) {
			stack.push(...node.children);
		}
	}
	return nodes;
}
