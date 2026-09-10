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
 *      编辑文本（text === mdDerivedText）整行逐字回写（mdRaw），编辑后走合成。
 * 3) 行内轻标记（** * ` ~~ HTML）不剥离，原样保留（无损往返）。
 */

import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import {
	formatWikilink,
	linkDisplayText,
	parseWikilink,
	wikilinkTargetIsAttachment,
} from './domain/wikilink';
import { isUrlLikeText } from './domain/url';
import { isRenderableImageExtension } from './constants';
import type { MdNodeData } from './node-data';

export interface MdParseResult {
	tree: MindMapTreeNode;
	/** 原样保留的 frontmatter 块（含首尾 ---），无则为 null */
	frontmatter: string | null;
}

const FM_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** 标题行：#~######（宽容：#标题 无空格亦可） */
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
/** 列表项：缩进 + 标记（- * + 或 数字.） + 内容 */
const LIST_RE = /^(\s*)([-*+]|\d+\.)[ \t]+(.*)$/;

interface ParsedLine {
	kind: 'heading' | 'list' | 'plain';
	indent: number;
	text: string;
	/**
	 * 原始行（未 trim）——**仅 plain 行需要**。缩进代码块的前导缩进、行尾两个
	 * 空格的硬换行都是 Markdown 语义，`mdRaw` 必须逐字保存原文才能逐字回写；
	 * `text` 仍是 trim 后的显示文本（行首缩进不该出现在节点文本里）。
	 */
	raw?: string;
	level?: number;
	marker?: string;
}

// ---------------------------------------------------------------------------
// 行内 token（wikilink / markdown 链接 / 图片）
// ---------------------------------------------------------------------------

type InlineTokenKind =
	| 'wikiImg'
	| 'wiki'
	| 'mdImg'
	| 'mdLink'
	| 'autolink'
	| 'bareUrl';

interface InlineToken {
	start: number;
	end: number;
	kind: InlineTokenKind;
	/** 链接目标 / 图片地址（不含 [[ ]] 与 []() 包裹） */
	target: string;
	/** 别名 / alt / 链接文本（可空；图片 token 已剥离尺寸参数） */
	label: string;
	/** 嵌入图片的官方尺寸参数宽度（![[图|300]] / ![alt|300](url)） */
	sizeWidth?: number;
	/** 嵌入图片的官方尺寸参数高度（![[图|300x150]]；仅宽时不携带） */
	sizeHeight?: number;
}

/** 官方尺寸参数：`宽度` 或 `宽度x高度`（数字字面量） */
const IMG_SIZE_RE = /^(\d+)(?:x(\d+))?$/;

/**
 * 从嵌入图片的标签中剥离官方尺寸参数（Obsidian 帮助「Embed files /
 * Basic formatting syntax」）：
 * - wikilink：`![[图.png|300]]` / `![[图.png|300x150]]` —— wiki 正则吃掉
 *   第一个 `|`，标签即尺寸本体；
 * - md 图片：`![alt|300](url)` / `![Engelbart|100x145](url)` / `![250](url)`
 *   —— 尺寸在标签尾部 `|` 之后（或整段标签即尺寸）。
 * 非数字标签不是尺寸（嵌入不支持别名文本），原样保留。
 */
function parseImageLabel(label: string): {	alt: string;
	sizeWidth?: number;
	sizeHeight?: number;
} {
	let alt = label;
	let width: number | undefined;
	let height: number | undefined;
	const withPipe = label.match(/^(.*)\|(\d+)(?:x(\d+))?$/);
	if (withPipe) {
		alt = (withPipe[1] ?? '').trim();
		width = Number(withPipe[2]);
		height = withPipe[3] !== undefined ? Number(withPipe[3]) : undefined;
	} else if (IMG_SIZE_RE.test(label)) {
		alt = '';
		const m = label.match(IMG_SIZE_RE)!;
		width = Number(m[1]);
		height = m[2] !== undefined ? Number(m[2]) : undefined;
	}
	const sizeWidth = width !== undefined && width > 0 ? width : undefined;
	const sizeHeight = height !== undefined && height > 0 ? height : undefined;
	return { alt, sizeWidth, sizeHeight };
}

const INLINE_RE =
	/(!?)\[\[([^\]|\n]+)(?:\|([^\]]*))?\]\]|(!?)\[([^\]]*)\]\((<[^>\n]*>|[^)\s\n]+)\)|(<((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^>\s]+)>)|((?:https?:\/\/|ftp:\/\/|obsidian:\/\/)[^\s<>()[\]{}"'`，、；：！？。「」（）【】]+)/g;
/** 裸 URL 尾部不应携带的标点（句尾标点不属于 URL 的一部分） */
const BARE_URL_TRAILING_RE = /[.,;:!?)\]}>'"]+$/;

/** 裸 URL 分支的捕获组下标（INLINE_RE 第 9 组） */
const BARE_URL_GROUP = 9;

export function tokenizeInline(raw: string): InlineToken[] {
	const out: InlineToken[] = [];
	INLINE_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = INLINE_RE.exec(raw))) {
		if (m[1] !== undefined) {
			// [[..]] 或 ![[..]]
			const target = m[2] ?? '';
			const label = (m[3] ?? '').trim();
			if (m[1] === '!') {
				// 嵌入图片：标签即官方尺寸参数（![[图|300]] / ![[图|300x150]]）
				const { alt, sizeWidth, sizeHeight } = parseImageLabel(label);
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					kind: 'wikiImg',
					target,
					label: alt,
					sizeWidth,
					sizeHeight,
				});
			} else {
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					kind: 'wiki',
					target,
					label,
				});
			}
		} else if (m[7] !== undefined) {
			// autolink <url>（如 <https://…>）
			out.push({
				start: m.index,
				end: m.index + m[0].length,
				kind: 'autolink',
				target: m[8] ?? '',
				label: '',
			});
		} else if (m[BARE_URL_GROUP] !== undefined) {
			// 裸 URL（行内直接书写的 https:// 等）：与 autolink 同语义，
			// URL 本体不渲染进节点文本（icon-only，见 buildInlineData）；
			// 尾部句读标点不属于 URL（「详见 https://x.com/a。」→ 目标止于 a）
			const matched = m[BARE_URL_GROUP] ?? '';
			const trimmed = matched.replace(BARE_URL_TRAILING_RE, '');
			out.push({
				start: m.index,
				end: m.index + m[0].length - (matched.length - trimmed.length),
				kind: 'bareUrl',
				target: trimmed,
				label: '',
			});
		} else {
			// [t](url) 或 ![alt](url)
			const label = (m[5] ?? '').trim();
			let target = m[6] ?? '';
			// 尖括号包裹的目标（CommonMark <url>，如 [t](<https://…>)）：
			// 剥壳存入，避免回写时对已含 <> 的目标二次包裹成 <<url>>。
			// 仅对 md 链接处理；图片目标保持原样（见 renderImage）。
			if (m[4] !== '!' && target.startsWith('<') && target.endsWith('>')) {
				target = target.slice(1, -1);
			}
			if (m[4] === '!') {
				// 外链图片：尺寸在标签尾部（![alt|300](url) / ![250](url)）
				const { alt, sizeWidth, sizeHeight } = parseImageLabel(label);
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					kind: 'mdImg',
					target,
					label: alt,
					sizeWidth,
					sizeHeight,
				});
			} else {
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					kind: 'mdLink',
					target,
					label,
				});
			}
		}
	}
	return out;
}

/** token 的剥壳显示文本（节点文本中替换 [[]] 包裹后的样子） */
function tokenDisplay(tok: InlineToken): string {
	if (tok.kind === 'wikiImg' || tok.kind === 'mdImg') {
		// 图片显示名恒为目标文件名（含扩展）：标签可能是尺寸参数（已剥离）
		// 或空，不作为显示文本
		return tok.target.split('/').pop() ?? tok.target;
	}
	if (tok.label) {
		return tok.label;
	}
	if (tok.kind === 'autolink') {
		return tok.target;
	}
	const name = tok.target.split('/').pop() ?? tok.target;
	// wiki 链接目标：仅去 .md（笔记显示名，Obsidian 语义）；附件/其它保留扩展
	return tok.kind === 'wiki' ? name.replace(/\.md$/, '') : name;
}

/**
 * 嵌入目标是否为图片（按扩展名判定；无扩展名/未知扩展名视为非图片）。
 * 用 Obsidian 可渲染图片清单（含 avif/apng/jxl/tif/tiff）——与 Obsidian 的嵌入
 * 行为对齐；非图片嵌入（PDF/音视频等）不能作为节点图渲染，需改走附件通道。
 */
function isImageEmbedTarget(target: string): boolean {
	const name = target.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return false;
	}
	return isRenderableImageExtension(name.slice(dot + 1));
}

/** buildInlineData 的稳定字段（text/mdRaw/mdDerivedText 恒为 string） */
interface InlineData extends MdNodeData {
	text: string;
	mdRaw: string;
	mdDerivedText: string;
}

/**
 * 单行行内处理（方案 A）：
 * @returns data 含 text（剥壳显示文本）、mdRaw（原文）、mdDerivedText（=text，
 *   供 serialize 判断文本是否被用户编辑），以及首链接/首图字段。
 */
function buildInlineData(raw: string): InlineData {
	const data: InlineData = {
		text: '',
		mdRaw: raw,
		mdDerivedText: '',
	};
	const toks = tokenizeInline(raw);
	let firstLink = false;
	let firstImg = false;
	const pieces: string[] = [];
	let cursor = 0;
	for (const tok of toks) {
		pieces.push(raw.slice(cursor, tok.start));
		cursor = tok.end;
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
				if (!firstLink) {
					firstLink = true;
					data.mdWikiLinkpath = link;
					data.mdLinkStyle = 'wiki';
					data.mdEmbed = true;
					data.mdLinkText = linkDisplayText(link);
					// 与文档双链同口径：剥壳显示名进节点文本（去 `.md`）
					pieces.push(data.mdLinkText);
				} else {
					pieces.push(linkDisplayText(link));
				}
				continue;
			}
			if (!firstImg) {
				firstImg = true;
				data.image = tok.target;
				data.mdImageTarget = tok.target;
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
				// 首图以节点图呈现，不占文本
			} else {
				pieces.push(tokenDisplay(tok));
			}
			continue;
		}
		if (tok.kind === 'wiki') {
			if (!firstLink) {
				firstLink = true;
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
					// 原生链接图标，与自绘文档页图标（mindmap.ts 前缀内容）双显。
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
		} else if (tok.kind === 'autolink' || tok.kind === 'bareUrl') {
			// 自动链接（<url> 尖括号 / 裸 URL）→ 同语义：URL 本体不渲染进
			// 节点文本（icon-only，节点仅显示超链接图标）；回写为 <url>
			if (!firstLink) {
				firstLink = true;
				data.hyperlink = tok.target;
				data.mdLinkStyle = 'md';
				data.mdLinkText = tok.target;
				data.hyperlinkTitle = tok.target;
			}
		} else if (!firstLink) {
			firstLink = true;
			data.hyperlink = tok.target;
			data.mdLinkStyle = 'md';
			data.mdLinkText = tok.label || tok.target;
			data.hyperlinkTitle = tokenDisplay(tok);
		}
		// URL token（autolink/bareUrl）与「label 本身是 URL」的 md 链接
		// （[https://…](https://…)，复制粘贴常见形态）一律 icon-only：
		// URL 本体不渲染进节点文本（避免长 URL 撑宽节点），节点仅显示图标
		if (
			tok.kind !== 'autolink' &&
			tok.kind !== 'bareUrl' &&
			!(tok.kind === 'mdLink' && isUrlLikeText(tok.label))
		) {
			pieces.push(tokenDisplay(tok));
		}
	}
	pieces.push(raw.slice(cursor));
	// 纯图行 → 图片独占节点（text 为空）：图片是节点的全部内容，
	// 不再回退文件名占位文本（旧行为会把文件名当作节点文本，
	// 使「删文字后图片独占节点」无法在往返中保持）。
	// 代价：纯图节点不参与文本搜索（图片文件名仍可经引擎 hover 查看）。
	// URL token（icon-only）剥离后相邻文本可能留下连续空格，折叠为单空格
	//（HTML 渲染语义本就折叠空白；原文由 mdRaw 保真，不受影响）。
	const text = pieces
		.join('')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
	data.text = text;
	data.mdDerivedText = text;
	return data;
}

// ---------------------------------------------------------------------------
// 正文解析
// ---------------------------------------------------------------------------

/**
 * 拆分 YAML frontmatter（含首尾 ---）与正文。
 * 遇到 body 开头又有 ---（用户误加第二次 frontmatter）时只取第一个并 console.warn。
 * export 为测试白盒钩子。
 */
export function splitFrontmatter(content: string): {
	body: string;
	frontmatter: string | null;
} {
	const m = content.match(FM_RE);
	if (!m) {
		return { body: content, frontmatter: null };
	}
	const body = content.slice(m[0].length);
	// 误加第二次 frontmatter：body 开头又是 ---
	if (/^---[ \t]*(?:\r?\n|$)/.test(body)) {
		console.warn(
			'[Mindmap-Studio] 检测到重复 YAML frontmatter，仅第一个生效。',
		);
	}
	return { frontmatter: m[0], body };
}

/** 逐行分类（围栏整体原样保留；围栏外空行与分隔线忽略） */
function classifyLines(body: string): ParsedLine[] {
	const out: ParsedLine[] = [];
	const rawLines = body.split(/\r?\n/);
	/** 当前围栏（分隔符字符与长度）；null = 不在围栏内 */
	let fence: { char: string; length: number } | null = null;
	/** 上一条输出行是否属于围栏块（决定后续空行是否保留为分隔） */
	let lastLineIsFence = false;
	/** 围栏外暂存的连续空行：仅当与围栏相邻时才写入（保证围栏仍可识别） */
	let pendingBlank = 0;

	/**
	 * 围栏分隔行：≤3 空格缩进 + 3+ 个 ` 或 ~（后可接语言信息）。
	 * 返回分隔符；不匹配返回 null。
	 */
	const fenceMarker = (raw: string): { char: string; length: number } | null => {
		const m = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
		if (!m) {
			return null;
		}
		return { char: m[1]![0]!, length: m[1]!.length };
	};

	const pushRaw = (raw: string): void => {
		out.push({ kind: 'plain', indent: leadingSpaces(raw), text: raw, raw });
	};

	for (let i = 0; i < rawLines.length; i++) {
		const rawLine = rawLines[i]!;

		// —— 围栏内：内容逐行原样保留（空行/缩进/类标题列表行都是代码内容）——
		if (fence) {
			pushRaw(rawLine);
			lastLineIsFence = true;
			// 闭合：同字符、长度 ≥ 起始，行尾无其他内容
			const close = fenceMarker(rawLine);
			if (
				close &&
				close.char === fence.char &&
				close.length >= fence.length &&
				/^[ \t]*$/.test(rawLine.slice(rawLine.indexOf(close.char) + close.length))
			) {
				fence = null;
			}
			continue;
		}

		if (!rawLine.trim()) {
			// 空行暂存：是围栏相邻分隔时才保留，段落间仍忽略（维持既有规范化）
			pendingBlank++;
			continue;
		}

		// —— 围栏开始（``` / ~~~ 行；含语言信息的 ```js 亦为开始）——
		const open = fenceMarker(rawLine);
		if (open) {
			// 围栏前空行属于围栏块：写入后围栏仍可被识别
			while (pendingBlank > 0) {
				pushRaw('');
				pendingBlank--;
			}
			fence = open;
			pushRaw(rawLine);
			lastLineIsFence = true;
			continue;
		}

		const line = rawLine.trimEnd();
		// 围栏闭合后的空行保留（避免围栏块与下文粘连成同一多行文本）
		if (lastLineIsFence && pendingBlank > 0) {
			while (pendingBlank > 0) {
				pushRaw('');
				pendingBlank--;
			}
		}
		lastLineIsFence = false;
		// 段落/标题/列表前的空行一律丢弃（维持既有规范化）——
		// 不能留到后续围栏处再 flush，否则空行会累积、每次往返多一行
		pendingBlank = 0;
		if (/^\s*---+\s*$/.test(line)) {
			continue;
		}
		const h = line.match(HEADING_RE);
		if (h) {
			const text = (h[2] ?? '').trim();
			if (text) {
				out.push({ kind: 'heading', indent: 0, text, level: h[1]!.length });
			}
			continue;
		}
		const l = line.match(LIST_RE);
		if (l) {
			const text = l[3]!.trim();
			if (text) {
				out.push({
					kind: 'list',
					indent: l[1]!.length,
					text,
					marker: /^\d+\.$/.test(l[2]!) ? 'ordered' : l[2],
				});
			}
			continue;
		}
		out.push({
			kind: 'plain',
			indent: leadingSpaces(line),
			text: line.trim(),
			// 原文（含前导缩进与行尾空格）供 mdRaw 逐字回写：缩进代码块的前导缩进、
			// 「行尾两空格 = 硬换行」都是 Markdown 语义，trim 掉就等于改动文件
			raw: rawLine,
		});
	}
	return out;
}

function leadingSpaces(line: string): number {
	let n = 0;
	while (n < line.length && line[n] === ' ') {
		n++;
	}
	return n;
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
	 */
	let plainBuffer: { raw: string; text: string }[] = [];

	const flushPlain = (): void => {
		if (plainBuffer.length === 0) {
			return;
		}
		// mdRaw 用**未 trim 的原文**整块保留（缩进/行尾空格是 Markdown 语义）；
		// 显示文本仍走 trim 后的 text，行首缩进不进节点文本
		const raw = plainBuffer.map((line) => line.raw).join('\n');
		// 段落按行 token 化（保留行独立性）
		const derived: string[] = [];
		for (const line of plainBuffer) {
			const d = buildInlineData(line.text);
			derived.push(d.text);
		}
		const node: MindMapTreeNode = {
			data: {
				text: derived.join('\n'),
				mdRaw: raw,
				mdDerivedText: derived.join('\n'),
				mdType: 'plain',
			},
			children: [],
		};
		contentParent.children.push(node);
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
		const node: MindMapTreeNode = {
			data: {
				...buildInlineData(rawText),
				mdType: 'list',
				mdMarker: marker,
			},
			children: [],
		};
		parent.children.push(node);
		listStack.push({ node, indent });
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
					...buildInlineData(line.text),
					mdType: 'heading',
					mdLevel: level,
				},
				children: [],
			};
			parent.children.push(node);
			headingStack.push({ node, level });
			contentParent = node;
			continue;
		}
		if (line.kind === 'plain') {
			// list 项的续行（缩进大于栈顶 list 且当前处于 list 区）→ 并入文本
			if (
				listStack.length > 0 &&
				line.indent > listStack[listStack.length - 1]!.indent
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
				// 续行只保留**行尾**原文（行首缩进由序列化器按树深度补 restIndent，
				// 两者都留会写出双份缩进）；text 仍用 trim 后的显示文本
				topData.mdRaw = `${prevRaw}\n${(line.raw ?? line.text).trimStart()}`;
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
