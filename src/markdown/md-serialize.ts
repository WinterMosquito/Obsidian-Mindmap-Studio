/**
 * Markdown 序列化：把导图树（.mindmap.md 模式）还原为 md 正文。
 *
 * 与 md-outline.ts 互为逆映射（规范化保真，非逐字节）：
 * - 虚拟文档根（text=文件名）不输出任何行；
 * - 行级「未编辑检测」：节点含 mdRaw 且 data.text === data.mdDerivedText（且图片
 *   未被换）→ 整行逐字回写 mdRaw（保留全部 [[]] / ![] 包裹与格式）；用户编辑过
 *   文本或换过图 → 走合成：文本 + 行尾单链接 token（hyperlink）／图片 token；
 * - **纯双链节点（整行只有一个双链）的编辑语义 = 改别名**：节点内显示的就是该
 *   链接的可见名（别名优先），故编辑后把新文本写成别名回写 `[[目标|新别名]]`，
 *   而不是「新文本 + 行尾链接」；判定与边界见 domain/wiki-display.ts 的
 *   editedWikilinkAlias（纯判定在 domain，回写与图标 tooltip 共用同一入口）。
 * - heading → `#×N 文本`；list → 缩进 + 标记 + 文本（ordered 重排编号 1..n）；
 *   plain → 原样多行文本；**新用户节点（无 mdType/mdRaw）按层级回写**——位于
 *   标题上下文且第 1~6 层 → `#×级别 文本`（与解析侧「#~###### ⇄ 第 1~6 层」
 *   严格对称，K98）；**根级的起始级别取本文件实测值**（`mdHeadingStart`，
 *   从二级开始的文件新建一级节点写 `##`）；列表/段落上下文或 6 级之下 → `-`
 *   输出（显式 mdMarker 的新节点尊重用户选择、同样走列表）；
 * - 列表项多行文本（续行）非首行补 2 空格缩进，保证可再解析为续行。
 */

import { App } from 'obsidian';
import type { MindMapTreeNode } from '../core/engine-types';
import {
	isIndentedCodeLine,
	isRenderableImageExtension,
	isRenderableImageTarget,
} from '../core/constants';
import { readNodeDataString } from '../core/node-data';
import {
	isColorDirectiveLine,
	splitTrailingColorDirective,
} from '../domain/color';
import { isNodeTextEdited } from '../domain/md-meta';
import { withTaskPrefix } from '../domain/md-task';
import { tokenizeInline } from './md-outline';
import { isValidIndentUnit } from './md-outline-lines';
import { readHeadingStart } from './md-heading-syntax';
import {
	anchorInsertPoint,
	inLinkSyntax,
	insertionForm,
} from './md-serialize-anchors';
import {
	hasImageMeta,
	imageSelfText,
	imageVaultPath,
	rawHasImageFeature,
	rawImageMatches,
	renderImage,
	stripAngleBrackets,
} from './md-serialize-inline';
import {
	formatEmbedWikilink,
	formatWikilink,
	linkDisplayText,
	wikilinkLinkpath,
} from '../domain/wikilink';
import { isSchemeUrl } from '../domain/url';
import { docWikiLinkDisplay, editedWikilinkAlias, effectiveDocWikiLink } from '../domain/wiki-display';
import type { MdNodeData } from '../core/node-data';

/** 链接目标是否需要尖括号包裹（含空格/括号/<>/\，否则会破坏 `(…)` 闭合） */
function needsDestBraces(dest: string): boolean {
	return /[\s()<>\\]/.test(dest);
}

/**
 * 链接「生效显示名」的判定（editedWikilinkAlias / effectiveDocWikiLink /
 * docWikiLinkDisplay）已下沉到 domain/wiki-display.ts：它同时被 mindmap.ts
 * （文档页图标 tooltip）消费，而 mindmap.ts 必须可脱离 obsidian 打包，
 * 不能 import 本模块。此处仅消费，勿在本地复制一份判定。
 */

/**
 * 节点承载链接的**文件写法**（wiki 双链 / 附件嵌入 / md 链接 / autolink）。
 *
 * 唯一来源：合成回写（`composeLine`）与视图侧「复制链接」动作共用——复制到剪贴板
 * 的必须是**粘回笔记即可用的那一串**（md 形态要连 `[显示名](…)` 一起，不能只给
 * 裸路径），语法判定不能各写一份。
 *
 * @returns 该节点没有可写链接时返回 null
 */
export function renderHyperlink(data: MdNodeData): string | null {
	// 双链附件（attachmentUrl 通道）：重建 wikilink。优先取原始 linkpath
	// （attachmentUrl 可能已被视图层重写为解析后的库内路径）；合成路径本就
	// 是「文本被编辑后」的规范化回写，别名细节由 rawOk 逐字回写保真。
	// mdEmbed：原文用的是嵌入语法 `![[附件]]`（非图片附件），补回 `!` 保持往返。
	const attachUrl = data.attachmentUrl;
	if (typeof attachUrl === 'string' && attachUrl) {
		const linkpath =
			typeof data.mdAttachmentLinkpath === 'string' && data.mdAttachmentLinkpath
				? data.mdAttachmentLinkpath
				: attachUrl;
		// 别名（`[[报告.pdf|说明]]`）：解析侧存于 attachmentName；与默认显示名
		// （末段文件名）不同才回写 `|别名`，无别名不凭空添加。
		// 嵌入语法（`![[…]]`）的管道是尺寸参数位，不加别名。
		const defaultName = linkpath.split('/').pop() ?? linkpath;
		const rawName = data.attachmentName;
		// 纯双链附件节点被编辑 → 别名取节点文本（见 editedWikilinkAlias）；
		// 新别名与默认名相同（或为空）时不写别名段
		const editedAlias = editedWikilinkAlias(data);
		let alias: string | undefined;
		if (editedAlias !== null) {
			alias = editedAlias && editedAlias !== defaultName ? editedAlias : undefined;
		} else if (
			!data.mdEmbed &&
			typeof rawName === 'string' &&
			rawName !== '' &&
			rawName !== defaultName
		) {
			alias = rawName;
		}
		// 嵌入语法的管道位原文（非图片附件：官方未定义语义）→ 原样写回，
		// 否则编辑节点后 `![[报告.pdf|300]]` 会退化成 `![[报告.pdf]]`（参数丢失）
		if (data.mdEmbed && typeof data.mdEmbedPipe === 'string' && data.mdEmbedPipe) {
			return formatEmbedWikilink(linkpath, data.mdEmbedPipe);
		}
		return `${data.mdEmbed ? '!' : ''}${formatWikilink(linkpath, alias)}`;
	}
	const hyperlink = data.hyperlink;
	if (typeof hyperlink !== 'string' || !hyperlink) {
		// 文档双链（mdWikiLinkpath 通道）：字段存的就是完整 wikilink，原样回写
		// （纯双链节点被编辑时别名改为节点文本，见 effectiveDocWikiLink）
		const wikiLink = data.mdWikiLinkpath;
		if (typeof wikiLink !== 'string' || !wikiLink) {
			return null;
		}
		// 文档**嵌入**（`![[笔记]]`）：与文档双链同通道，回写补回 `!` 保往返
		//（与上方附件嵌入的 mdEmbed 处理同口径）。
		const docLink = effectiveDocWikiLink(data, wikiLink);
		return data.mdEmbed ? `!${docLink}` : docLink;
	}
	// wiki 双链：原样保留
	if (hyperlink.startsWith('[[')) {
		return hyperlink;
	}
	const rawText = data.text;
	const text = typeof rawText === 'string' ? rawText : '';
	const rawLabel = data.mdLinkText;
	const label =
		typeof rawLabel === 'string' && rawLabel
			? rawLabel
			: text.split('\n')[0] || hyperlink;
	// URL / 协议链接 → 直接写为标准 autolink <url>（Obsidian 识别为可点链接，
	// 含空格/括号的 URL 也安全；无需 [label](<url>)）
	if (isSchemeUrl(hyperlink)) {
		// 源行本就是 `[显示文本](url)`（mdLinkText 存了自定义文本且不等于 URL）
		// → 保持 md 链接形态（官方 Internal links 语义：显示文本可自定义）；
		// 否则写 autolink（`<url>`/裸 URL 的 icon-only 形态）。
		const rawLinkLabel = data.mdLinkText;
		const linkLabel =
			typeof rawLinkLabel === 'string' && rawLinkLabel ? rawLinkLabel : '';
		if (linkLabel && linkLabel !== hyperlink) {
			const dest = needsDestBraces(hyperlink) ? `<${hyperlink}>` : hyperlink;
			return `[${linkLabel}](${dest})`;
		}
		return `<${hyperlink}>`;
	}
	if (data.mdLinkStyle === 'md') {
		// 非 URL 的 md 链接（如相对路径）：目标含空格/括号等时用尖括号包裹，
		// 避免破坏 `(…)` 闭合（Obsidian 亦识别 <dest>）
		const dest = needsDestBraces(hyperlink) ? `<${hyperlink}>` : hyperlink;
		return `[${label}](${dest})`;
	}
	// 其余（库内路径等非 URL）：裸目标 → 包一层 [[..]]（引擎语义一致）
	return formatWikilink(hyperlink);
}

// ---------------------------------------------------------------------------
// 链接族：引用特征匹配 / 内联 token 台账 / 显示名
// ---------------------------------------------------------------------------

/**
 * mdRaw 中是否已含该链接引用。
 * URL 类特征按原文出现判断（裸 URL / `<url>` / `[text](url)` 均合法）；
 * 库内双链/附件按 `[[…]]` 边界匹配——此前用裸子串，节点文本恰好含同名串时
 * 新插入的链接会被误判「未变」而丢弃。
 */
function rawHasLinkFeature(raw: string, feature: string): boolean {
	if (isSchemeUrl(feature)) {
		return raw.includes(feature);
	}
	return (
		raw.includes(`[[${feature}]]`) ||
		raw.includes(`[[${feature}|`) ||
		raw.includes(`[[${feature}#`) ||
		raw.includes(`[[${feature}^`) ||
		raw.includes(`](${feature})`) ||
		raw.includes(`](${feature} `)
	);
}

/** wiki 目标的锚点（`#区块` / `^块`）不属于目标特征（与 wikilinkLinkpath 同口径） */
function stripWikiAnchor(target: string): string {
	return target.replace(/[#^][\s\S]*$/, '');
}

/**
 * mdRaw 中是否已含该链接目标（rawOk 的链接判定）。
 *
 * 快路径为字符串形态（覆盖 `[[目标]]` / `[名](目标)` / 裸 URL 等常规写法）；
 * 更少见的合法形态经 tokenize 兜底：md 链接的 `<路径 带空格>` 尖括号包裹
 * （解析侧剥壳、回写保留，此前字符串判据对 `](<目标>)` 恒不命中 → 未编辑行
 * 每次保存都走合成）；wiki 目标的 `#区块` / `^块` 锚点按同口径剥离后比较。
 */
function rawLinkMatches(raw: string, feature: string): boolean {
	if (isSchemeUrl(feature)) {
		return raw.includes(feature);
	}
	if (rawHasLinkFeature(raw, feature)) {
		return true;
	}
	return tokenizeInline(raw).some((token) => {
		if (token.kind !== 'wiki' && token.kind !== 'mdLink') {
			return false;
		}
		const target = stripAngleBrackets(token.target);
		if (token.kind === 'mdLink') {
			return target === stripAngleBrackets(feature);
		}
		return stripWikiAnchor(target) === stripWikiAnchor(feature);
	});
}

/** 链接 token 的目标特征串（与 mdRaw 比对 / token 排序用） */
function linkFeatureOf(data: MdNodeData): string | null {
	const attachUrl = data.attachmentUrl;
	if (typeof attachUrl === 'string' && attachUrl) {
		const linkpath = data.mdAttachmentLinkpath;
		return typeof linkpath === 'string' && linkpath ? linkpath : attachUrl;
	}
	const hyperlink = data.hyperlink;
	if (typeof hyperlink === 'string' && hyperlink) {
		return hyperlinkFeature(hyperlink);
	}
	const wikiLink = data.mdWikiLinkpath;
	return typeof wikiLink === 'string' && wikiLink
		? hyperlinkFeature(wikiLink)
		: null;
}

/**
 * 合成路径的行内 token 列表（图片 / 链接 / 额外 token），顺序与 mdRaw 中一致。
 *
 * 此前合成只输出一枚 token（`renderHyperlink() ?? renderImage()`）——图文混合
 * 或「图 + 链接」节点只要编辑过文本，图片引用就被静默丢弃（保存后文件里永久
 * 消失）。两枚 token 都必须写出；顺序按 mdRaw 中出现位置决定，新建的 token 追加
 * 在已有 token 之后，保证再次保存时行结构稳定（不再改动）。
 *
 * 两枚之外的**额外 token**（多链接 / 多 URL / 多图；台账 `mdSegments` 里
 * `first: false` 的项）按记录顺序追加在最后——此前它们在编辑后丢失
 * （多 URL 连内容都丢，2026-09-13 修复）。
 */
function inlineTokens(data: MdNodeData, app: App | null): string[] {
	const out: string[] = [];
	const image = renderImage(data, app);
	const link = renderHyperlink(data);
	if (image && link) {
		const raw = typeof data.mdRaw === 'string' ? data.mdRaw : '';
		const imageFeature = imageVaultPath(data, app);
		const linkFeature = linkFeatureOf(data);
		const imageAt = imageFeature ? raw.indexOf(imageFeature) : -1;
		const linkAt = linkFeature ? raw.indexOf(linkFeature) : -1;
		const linkFirst = linkAt >= 0 && imageAt >= 0 && linkAt < imageAt;
		out.push(...(linkFirst ? [link, image] : [image, link]));
	} else if (image) {
		out.push(image);
	} else if (link) {
		out.push(link);
	}
	// 额外 token（含无显示名者）：台账里的原文切片，按出现顺序
	for (const segment of data.mdSegments ?? []) {
		if (!segment.first) {
			out.push(segment.raw);
		}
	}
	return out;
}

/** 由 hyperlink 提取"目标特征串"（用于判断 mdRaw 中是否已含该链接） */
function hyperlinkFeature(hyperlink: string): string | null {
	if (!hyperlink) {
		return null;
	}
	// [[target|alias]] → 目标部分（不含别名）；http / obsidian:// / 库内路径原样
	return wikilinkLinkpath(hyperlink) ?? hyperlink;
}

/**
 * 链接的「可见文本」（Obsidian 语义：别名 → 去 .md 的目标名 / URL 原样）。
 *
 * 与 renderHyperlink 必须**同口径**：两者都经 effectiveDocWikiLink 取「生效的
 * 双链」，否则纯双链节点被编辑后「纯 token 节点」判定失配，合成会写出
 * 「新文本 + 链接」重复一次。
 */
function nodeLinkDisplay(data: MdNodeData): string | null {
	const hyperlink = data.hyperlink;
	if (typeof hyperlink !== 'string' || !hyperlink) {
		// 文档双链（mdWikiLinkpath 通道）：与 hyperlink 同语义取可见文本
		const docDisplay = docWikiLinkDisplay(data);
		if (docDisplay !== null) {
			return docDisplay;
		}
		// 双链附件（wiki 通道）：可见名 = attachmentName（别名优先，与解析侧
		// tokenDisplay 同口径）；纯双链节点被编辑时别名已是节点文本，须同步
		if (data.mdLinkStyle === 'wiki' && data.mdEmbed !== true) {
			const editedAlias = editedWikilinkAlias(data);
			if (editedAlias !== null) {
				return editedAlias || null;
			}
			if (typeof data.attachmentName === 'string' && data.attachmentName) {
				return data.attachmentName;
			}
		}
		return null;
	}
	if (data.mdLinkStyle === 'md') {
		const rawLabel = data.mdLinkText;
		if (typeof rawLabel === 'string' && rawLabel) {
			return rawLabel;
		}
		return hyperlink;
	}
	return linkDisplayText(hyperlink);
}

/**
 * 行级「未编辑检测」：mdRaw 有效（文本未变、图未换、链接未新增/更新）
 * 时逐字回写。
 * - 文本判定：data.text === data.mdDerivedText（用户双击编辑会改写 text）；
 * - 图片判定：当前图片的目标特征（反查库内路径，否则 image 原文）必须已出现
 *   在 mdRaw 中——view 加载把库内路径转 app:// 是可逆标准步（视为未变），
 *   而经「插入/更换图片」新增的引用不在 mdRaw 里 → 合成回写，避免旧 mdRaw
 *   覆盖导致新图引用丢失（mdImageTarget 可能被同步更新，不能作为比对基准）；
 *   节点带自定义尺寸（拖拽调宽）时特征扩展为 `目标|宽度`（终界 `]`/`x`），
 *   尺寸参数缺失或不符即合成回写最新尺寸；
 * - 链接判定：hyperlink 的目标特征串必须出现在 mdRaw 中（通过「插入链接」
 *   新增/更新链接 → 合成回写，避免 mdRaw 原样覆盖导致链接丢失）。
 */
function rawOk(
	data: MdNodeData,
	app: App | null,
): data is MdNodeData & { mdRaw: string } {
	const raw = data.mdRaw;
	if (typeof raw !== 'string') {
		return false;
	}
	// 未编辑判据的唯一实现（快照缺失按未编辑处理，见 domain/md-meta）
	if (isNodeTextEdited(data.text, data.mdDerivedText)) {
		return false;
	}
	// 图片已被移除（右键「移除图片」/被引用文件被删除）：image 已清空，mdRaw 里的
	// 图片语法必须剥离，否则逐字回写会让移除的图在下次保存时复活。两种形态都判：
	// - md 字段残留（引擎清图等路径）：hasImageMeta 直接判定；
	// - md 字段全清（removeNodeImage：image 与全部 md 图片字段一并清空）：
	//   看 mdRaw **首行**是否仍有图片语法（`![[x.png]]` 按扩展名 / `![alt](url)`）。
	//   只查首行且排除缩进代码块（与解析侧同一判定——节点字段只治理首行图片，
	//   其余行含围栏/缩进代码里的图片语法属原文，必须逐字回写）。
	if (
		!data.image &&
		(hasImageMeta(data) ||
			(!isIndentedCodeLine(raw) && rawHasImageInFirstLine(raw)))
	) {
		return false;
	}
	if (data.image !== undefined && data.image !== null && data.image !== '') {
		// 当前图片须已被 mdRaw 引用、且（带自定义尺寸时）尺寸参数一致。
		// 等价形态与尺寸判定集中在 rawImageMatches（裸名引用 / md 图片尺寸在
		// alt 位 / 尖括号路径都按 token 判定），本处不再自行拼字符串。
		if (!rawImageMatches(data, raw, app)) {
			return false; // 图新增/更换/调整尺寸，需合成
		}
	}
	const hyperlink = typeof data.hyperlink === 'string' ? data.hyperlink : '';
	const attachUrl =
		typeof data.attachmentUrl === 'string' ? data.attachmentUrl : '';
	const wikiLink =
		typeof data.mdWikiLinkpath === 'string' ? data.mdWikiLinkpath : '';
	if (hyperlink) {
		const feature = hyperlinkFeature(hyperlink);
		if (feature && !rawLinkMatches(raw, feature)) {
			return false; // 链接新增/更新，需合成
		}
	} else if (attachUrl) {
		// 双链附件通道：attachmentUrl 可能被视图层重写为解析路径，
		// 特征优先用原始 linkpath（与 mdRaw 中的引用一致）
		const feature =
			typeof data.mdAttachmentLinkpath === 'string' && data.mdAttachmentLinkpath
				? data.mdAttachmentLinkpath
				: attachUrl;
		if (
			feature &&
			!rawLinkMatches(raw, feature) &&
			!rawHasImageFeature(raw, feature)
		) {
			return false; // 附件链接新增/更新，需合成
		}
	} else if (wikiLink) {
		// 文档双链通道：取目标特征串（去别名）与 mdRaw 比对，与 hyperlink 同口径
		const feature = hyperlinkFeature(wikiLink);
		if (feature && !rawLinkMatches(raw, feature)) {
			return false; // 文档链接新增/更新，需合成
		}
	} else if (data.mdType !== 'plain') {
		// 段落（plain）节点解析时本就不携带 hyperlink（多行文本无引擎单链），
		// 其 mdRaw 里的 [[..]]/[](url) 是原文的一部分——必须逐字回写；
		// 只有可携带链接的 heading/list 节点才可能是「用户清除了链接」。
		//
		// 嵌入语法按「是不是本节点的图片」区分：图片嵌入（`![[图.png]]`）不是链接，
		// 必须排除（否则图文混合行会被误判「链接已清除」而放弃逐字回写）；而
		// **文档/附件嵌入**（`![[笔记]]` / `![[报告.pdf|300]]`）与文档双链同属
		// 链接通道，清除链接后同样要剥离——此前用 `(?<!!)\[\[` 把嵌入一律排除，
		// 导致「清除链接」对嵌入无效：旧 mdRaw 原样回写、链接在下次保存时复活。
		// 链接字段只治理**首行**（节点文本的单链接/单图）：续行里的 `[[..]]` /
		// `[](url)` 是节点原文的一部分（引用块、callout 正文、项内围栏），不能因
		// 「字段为空」被当成用户清除了链接——否则整段续行会被合成路径按已剥壳的
		// `text` 重写，双链与 URL 一起消失（2026-11-11 实机）。
		const firstLine = raw.split('\n')[0] ?? '';
		const ownImage = [
			imageVaultPath(data, app),
			typeof data.image === 'string' ? data.image : null,
			typeof data.mdImageTarget === 'string' ? data.mdImageTarget : null,
		].filter((value): value is string => typeof value === 'string' && !!value);
		if (
			/(?<!!)\[\[|(?<!!)\[[^\]]*\]\(/.test(firstLine) ||
			rawHasForeignEmbed(firstLine, ownImage)
		) {
			// 链接已被清除（hyperlink/文档双链/附件字段全空）但 mdRaw 首行仍含
			// 链接语法：需合成剥离为纯文本，否则旧 mdRaw 原样回写会让"清除链接"失效
			return false;
		}
	}
	return true;
}

/**
 * mdRaw **首行**是否含图片语法（图片剥离判定用）：`![[x.png]]`（按扩展名）或
 * `![alt](url)`（md 图片——语法定性即图片，不查扩展名：外链地址常无图片后缀）。
 */
function rawHasImageInFirstLine(raw: string): boolean {
	const first = raw.split('\n')[0] ?? '';
	if (/!\[[^\]]*\]\(/.test(first)) {
		return true;
	}
	const embedRe = /!\[\[([^\]]*)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = embedRe.exec(first)) !== null) {
		const target = (match[1] ?? '').split('|')[0] ?? '';
		const name = target.split('/').pop() ?? '';
		const dot = name.lastIndexOf('.');
		if (dot > 0 && isRenderableImageExtension(name.slice(dot + 1))) {
			return true;
		}
	}
	return false;
}

/**
 * raw 中是否含**链接类（非图片）**的、不属于本节点图片的嵌入 token（`![[…]]`）。
 *
 * 文档/附件嵌入与图片嵌入同语法，但前者是**链接**：清除链接后必须走合成剥离。
 * 判据只能是「这枚 token 的目标串是不是本节点图片的引用（库内路径/资源地址/
 * 原始目标三者之一）」——靠 `mdEmbed` 之类的残留字段不可靠（清除链接不会清它）。
 *
 * **图片类嵌入不是链接**（按目标扩展名判定，与 K9 同口径）：同行多余的图片
 * （如 `![[a.png]] 与 ![[b.png]]` 的第二张）不触发「链接已清除」——此前未做
 * 该豁免，任何保存都会把非首图的嵌入语法降级为剥壳文本（2026-09-13 修复）。
 */
function rawHasForeignEmbed(raw: string, own: readonly string[]): boolean {
	const embedRe = /!\[\[([^\]]*)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = embedRe.exec(raw)) !== null) {
		const target = (match[1] ?? '').split('|')[0] ?? '';
		if (own.includes(target)) {
			continue;
		}
		if (isRenderableImageTarget(target)) {
			continue; // 图片类嵌入不是链接：不参与「链接已清除」检测
		}
		return true;
	}
	return false;
}

/**
 * 合成路径（**原位**优先）：按 `mdSegments`（显示文本 ↔ 原文对齐表）把 token
 * 写回它原来在句子里的位置，返回 null 表示没有可用对齐表（调用方走尾插）。
 *
 * 规则（解析侧登记两类 token，见 MdTokenSegment）：
 * 1. **有显示名**者：取新文本首行 T，按段序在 T 中定位其显示名（贪心、只向前找），
 *    命中的位置即该 token 的落点，显示名被替换为 token 的**实时渲染形态**
 *    （首链/首图取当前别名与尺寸，额外 token 用原文）；
 * 2. **无显示名**者（首图 / icon-only URL）：显示文本里没有它的痕迹，改按解析期
 *    记下的上下文锚点反查插入点（`anchorInsertPoint`），不改动文本只插入 token；
 * 3. 定位失败（用户改了显示名或锚点文字、该 token 已不在文中）→ 回落尾插，
 *    与既有行为一致——**内容与语法不丢**优先于位置；
 * 4. 每枚 token 只输出一次：输出清单按值「取用即摘除」，避免与原尾插路径重复。
 */
function composeFirstLineSegmented(
	data: MdNodeData,
	app: App | null,
): string | null {
	const segments = Array.isArray(data.mdSegments) ? data.mdSegments : null;
	if (!segments || segments.length === 0) {
		return null;
	}
	const text = readNodeDataString(data, 'text').split('\n')[0] ?? '';
	// 本节点当前应写出的全部 token 形态（与 inlineTokens 同源，便于「取用即摘除」）
	const pending: string[] = [];
	const link = renderHyperlink(data);
	if (link) {
		pending.push(link);
	}
	const image = renderImage(data, app);
	if (image) {
		pending.push(image);
	}
	// 额外 token（多链接 / 多 URL / 多图里字段装不下的那部分）：台账按出现顺序
	for (const segment of segments) {
		if (!segment.first) {
			pending.push(segment.raw);
		}
	}
	const takeToken = (form: string): boolean => {
		const index = pending.indexOf(form);
		if (index === -1) {
			return false;
		}
		pending.splice(index, 1);
		return true;
	};
	// slot 的 start === end 即**插入点**（不替换文本，只把 token 放进去）；
	// `fallback` 是该 token **未加分隔补白**的形态（重叠兜底尾插用，见下方收尾循环）
	const slots: {
		start: number;
		end: number;
		form: string;
		fallback: string;
	}[] = [];
	let anchor = 0;
	for (const segment of segments) {
		// 首链/首图取实时形态（别名/尺寸可能已被编辑）；额外 token 用原文
		const form = segment.first
			? segment.kind === 'image'
				? image
				: link
			: segment.raw;
		// 该 token 已不在当前字段里（清除链接 / 移除图片）或已被别的段取用 → 跳过
		if (!form || !takeToken(form)) {
			continue;
		}
		const name = typeof segment.text === 'string' ? segment.text : '';
		if (!name) {
			// 无显示名段（首图 / icon-only URL）：按上下文锚点插回原位
			const spot = anchorInsertPoint(text, segment, anchor, slots);
			if (!spot) {
				pending.push(form);
				continue;
			}
			slots.push({
				start: spot.start,
				end: spot.end,
				form: insertionForm(form, spot.padLead, spot.padTrail),
				fallback: form,
			});
			anchor = spot.end;
			continue;
		}
		const at = text.indexOf(name, anchor);
		if (at === -1 || inLinkSyntax(text, at, name.length)) {
			pending.push(form); // 对不上 / 命中落在链接语法内 → 尾插（旧行为）
			continue;
		}
		slots.push({ start: at, end: at + name.length, form, fallback: form });
		anchor = at + name.length;
	}
	let line = '';
	let cursor = 0;
	// 插入点可能与替换区间同起点（或落在替换区间之前的一段文本后），统一按
	// start 升序输出；同 start 时保持段序（排序稳定，段序即原文顺序）
	const ordered = [...slots].sort((a, b) => a.start - b.start);
	for (const slot of ordered) {
		if (slot.start < cursor) {
			// 区间重叠：当前不变式下不可达（anchor 单调 ⇒ 后一枚的起点不早于前一枚
			// 的终点），但**兜底必须存在**——`takeToken` 已把该 token 从 `pending`
			// 摘除，静默跳过会让它凭空消失（与「内容与语法不丢优先于位置」冲突）。
			// 退化为尾插：位置退化，token 不丢。
			pending.push(slot.fallback);
			continue;
		}
		line += text.slice(cursor, slot.start) + slot.form;
		cursor = slot.end;
	}
	line = (line + text.slice(cursor)).trimEnd();
	if (pending.length > 0) {
		const tail = pending.join(' ');
		line = line ? `${line} ${tail}` : tail;
	}
	// 一枚都没原位定位 → 分段路径的 pending 顺序（首链先、首图后）不如
	// `inlineTokens` 的「按 mdRaw 出现位置」权威，退回尾插路径对齐顺序
	// （纯图行插入链接即走这里：`![[a.png]] [[笔记]]` 而非反过来）。
	return slots.length === 0 ? null : line;
}

/** 合成路径：节点文本首行（原位 token，无对齐表时回落「剥壳文本 + 行尾 token」） */
function composeFirstLine(data: MdNodeData, app: App | null): string {
	const segmented = composeFirstLineSegmented(data, app);
	if (segmented !== null) {
		return segmented;
	}
	const text = readNodeDataString(data, 'text').split('\n')[0] ?? '';
	let line = text.trimEnd();
	const tokens = inlineTokens(data, app);
	if (tokens.length > 0) {
		const tail = tokens.join(' ');
		line = line ? `${line} ${tail}` : tail;
	}
	return line;
}

/**
 * 纯 token 节点判定：节点文本**恰为**其链接/图片自身的显示名（不含换行）。
 *
 * 语义：这类节点的「文本」不是描述文字，而是 token 的可见名——换图/换链后只写
 * 新 token（不重复输出旧名）；编辑它等于**改别名**（K6，回写见
 * domain/wiki-display.editedWikilinkAlias）。编辑弹窗据此选模式：别名模式 vs
 * 原文模式（见 view-node-actions.editNodeText）——**两个判定必须同源**，
 * 否则会出现「弹窗给的是别名、写回按原文」这类错位。
 */
export function isPureLinkNode(data: MdNodeData): boolean {
	const text = readNodeDataString(data, 'text');
	return (
		!text.includes('\n') &&
		text.trim() !== '' &&
		(nodeLinkDisplay(data) === text.trim() ||
			imageSelfText(data) === text.trim())
	);
}

/**
 * 节点**内容**（不含 list 标记 / `#` 前缀 / 续行缩进）：多行以 `\n` 连接。
 *
 * 三态与序列化输出完全一致（避免「编辑原文」弹窗预填与实际写盘漂移）：
 * 1. 未编辑（rawOk）→ **mdRaw 全文**（含全部 `[[ ]]` 语法与续行原文）；
 * 2. 编辑过首行、续行未动 → 首行合成 + **mdRaw 的续行原文**（续行是「未编辑
 *    行」，硬契约要求逐字回写：`text` 是剥壳显示文本，直接拿它会吞掉续行里的
 *    `[[双链]]` / `![[图]]` / 行尾指令，2026-11-12 审核定位）；
 * 3. 续行也被改过 → 首行合成 + 续行文本（用户输入优先）。
 * 序列化的 nodeLines 也走本函数（同一实现，勿在别处再抄一遍分派）。
 */
/**
 * 续行取哪一份：**未改动的续行用 mdRaw 原文**，改过的用 `text`。
 *
 * 判据只看第 2 行起（首行已由 `rawOk` 证明变过）：与解析期快照
 * `mdDerivedText` 逐行相同 ⇒ 用户没动续行 ⇒ 逐字回写 `mdRaw` 的续行
 * （行首缩进由序列化器按树深度补，mdRaw 里存的已是 `trimStart` 形态，
 * 两边同构）。行数不同或任一行不同 ⇒ 以 `text` 为准。
 *
 * 为什么必须分这两支：`text` 是**剥壳后的显示文本**（双链只留显示名、
 * 图片/指令被摘成字段），拿它回写续行等于把未编辑的行重排一遍。
 */
function composeContinuationLines(data: MdNodeData): string[] {
	const rows = readNodeDataString(data, 'text').split('\n');
	if (rows.length <= 1) {
		// 单行节点：没有续行可保（`mdRaw` 里可能残留历史续行，但那属「已删除」）
		return [];
	}
	const derivedRows = readNodeDataString(data, 'mdDerivedText').split('\n');
	const rawRows =
		typeof data.mdRaw === 'string' && data.mdRaw !== ''
			? data.mdRaw.split('\n')
			: [];
	const unchanged =
		rawRows.length === rows.length &&
		derivedRows.length === rows.length &&
		rows.every((line, index) => index === 0 || line === derivedRows[index]);
	return unchanged ? rawRows.slice(1) : rows.slice(1);
}

export function composeNodeContent(data: MdNodeData, app: App | null): string {
	if (rawOk(data, app)) {
		return data.mdRaw;
	}
	const rest = composeContinuationLines(data);
	const body = [composeNodeFirstLine(data, app), ...rest].join('\n');
	// 联系指令行（`domain/relation`）永远贴在节点末行：未编辑时已包含在 mdRaw 里，
	// 编辑后由这里补回 —— 指令不进 text（否则显示、搜索、引擎编辑框都会被污染，
	// 且只剥一半会让 rawOk 恒假，与任务 token 同一教训）。
	const tail =
		typeof data.mdDirectiveTail === 'string' ? data.mdDirectiveTail.trim() : '';
	if (!tail) {
		return body;
	}
	// 内容为空（空标题 / 空列表项）时留一个空内容行，指令因此落在独立的下一行
	return body === '' ? `\n${tail}` : `${body}\n${tail}`;
}

/**
 * 节点首行「内容」（不含 list 标记 / `#` 前缀，也不含续行）——
 * 序列化输出与 links-split 的拆分分析共用同一入口。
 *
 * 三态与序列化完全一致（避免拆分分析与实际写出口径漂移）：
 * 1. 未编辑（rawOk）→ 原文首行（含全部 `[[ ]]` 语法）；
 * 2. 纯 token 节点（文本恰为链接/图片自身显示名）→ 只输出 token；
 * 3. 其余（文本被编辑过）→ 文本 + token；token 位置优先按 `mdSegments` 对齐表
 *    写回**原位**，无可对齐信息（改了显示名 / 该 token 不在显示文本中）才尾插
 *    （composeFirstLine → composeFirstLineSegmented）。
 */
export function composeNodeFirstLine(
	data: MdNodeData,
	app: App | null,
): string {
	if (rawOk(data, app)) {
		return data.mdRaw.split('\n')[0]!;
	}
	let body: string;
	// 纯 token 节点（文本恰为链接/图片自身显示名）→ 只输出 token（避免旧名冗余）
	if (isPureLinkNode(data)) {
		// 两枚 token 都要写出（图文/图+链接节点此前只写一枚 → 图片丢失）
		const tokens = inlineTokens(data, app);
		body = tokens.length > 0 ? tokens.join(' ') : composeFirstLine(data, app);
	} else {
		body = composeFirstLine(data, app);
	}
	// 任务前缀只出现在合成路径（rawOk 分支返回的 mdRaw 已自带 token）。
	// 三条合成分支（纯 token / 分段 / 尾插）都要拼回，否则「改一次文本」或
	// 「拆分一次链接」就会把任务变成普通条目。
	const token = data.mdTaskToken;
	return typeof token === 'string' && token ? withTaskPrefix(token, body) : body;
}

/**
 * 序列化导图树为 md 正文（不含 frontmatter，调用方负责拼接）。
 * @param tree 虚拟文档根
 * @param app  可选：图片被编辑后反查库内路径时需要
 */
export function serializeMdBody(
	tree: MindMapTreeNode,
	app: App | null = null,
): string {
	return serializeTrees(
		tree.children ?? [],
		app,
		false,
		readIndentUnit(tree.data),
		// 标题起始级别**随本文件**（`mdHeadingStart`，解析期实测）：从二级开始的
		// 文件，新建根级节点必须写 `##`，否则重开时它会成为同级 `##` 的子节点
		readHeadingStart(tree.data),
	);
}

/** 列表缩进单位的**默认值**（新建文件 / 根 data 无 `mdIndentUnit` 时）：2 空格 */
const DEFAULT_INDENT_UNIT = '  ';

/**
 * 取本文档的列表缩进单位（`MdNodeMeta.mdIndentUnit` 的唯一读取面）。
 *
 * 合法性由 `isValidIndentUnit` 统一判定（与解析侧同一份判据）；手改数据 /
 * 旧版本写出的脏值一律回落 2 空格——缩进字符串会直接拼进每一行，放任任意值
 * 等于让一份脏数据毁掉整篇排版。
 */
function readIndentUnit(data: unknown): string {
	const value = (data as { mdIndentUnit?: unknown } | null)?.mdIndentUnit;
	return isValidIndentUnit(value) ? value : DEFAULT_INDENT_UNIT;
}

/**
 * 序列化若干**子树**为大纲正文（剪贴板复制入口）。
 *
 * 与 `serializeMdBody` 共用同一个 walker（`nodeLines` / 逐字回写 / 缩进规则
 * 全部同一份实现），差异只有**形态**（2026-10-13 用户裁决）：
 * 标题一律降级为无序列表项（`#` → `-`，不论几个 `#`），层级由缩进表达；
 * 有序项保留 `1.`；`*` / `+` 归一为 `-`。
 *
 * 为什么形态开关必须在 walker 内、不能在调用方「先清掉 mdType」：标题的 `#`
 * 前缀由本 walker 补，且「无标记节点在标题上下文回写为 `#`」（K98）会把
 * 剪贴板文本又变回标题——两处各判一次必然漂移。
 */
export function serializeSubtreesToOutline(
	trees: readonly MindMapTreeNode[],
	app: App | null = null,
): string {
	// 剪贴板是**新内容**，没有「原文风格」可继承：恒用默认 2 空格 + 一级起
	return serializeTrees(trees, app, true, DEFAULT_INDENT_UNIT, 1);
}

/**
 * 大纲序列化的共用实现。
 * @param headingsAsList 剪贴板形态：标题/段落一并走列表分支
 *   （见 serializeSubtreesToOutline）
 * @param indentUnit 每层缩进单位（文档形态取自根 data，见 readIndentUnit）：
 *   同一份实现按原文风格输出，Tab / 4 空格缩进的文件不会因一次编辑被整篇重排
 */
function serializeTrees(
	siblings: readonly MindMapTreeNode[],
	app: App | null,
	headingsAsList: boolean,
	indentUnit: string,
	headingStart: number,
): string {
	const out: string[] = [];

	/** 输出一个"块"，heading/plain 前插入空行分隔（首行除外） */
	const pushBlock = (lines: string[]): void => {
		// 块首空行不输出：空行只承担「块分隔」角色，由下方统一补一枚。否则围栏
		// 开始前保留的空行（classifyLines 的围栏相邻 flush 并入 plain 块 mdRaw，
		// 使其以 '\n' 开头）会与本函数补的分隔空行叠加，每趟往返多一枚、无不动
		// 点（「`# 标题` + 空行 + 围栏」场景实测累积，2026-09-25 修复）。
		// 只剥块首、不剥块尾：列表行不经本函数（直接 out.push，无分隔逻辑），
		// 块尾空行从不与分隔叠加、从不累积——旧行为对它是逐字保留且幂等的，
		// 剥除反而会丢掉用户在围栏与后续列表之间的有意空行。
		while (lines.length > 0 && lines[0] === '') {
			lines.shift();
		}
		if (lines.length === 0) {
			return;
		}
		if (out.length > 0 && out[out.length - 1] !== '') {
			out.push('');
		}
		out.push(...lines);
	};

	/**
	 * 标题节点的配色指令必须**独立成行**（K174）：行尾形态会被 Obsidian 的
	 * heading 缓存算进标题文本，`[[#标题]]` 与 `^block-id` 全废。
	 *
	 * 已独立成行的原样返回；行尾形态挪到该节点最后一行之后（标题的续行缩进为
	 * 空，故落盘即独立行）。这样「新建节点先上色、之后才写成标题」与旧文件里
	 * 行内写的指令都会被归一，不必依赖调用方是否知道节点类型。
	 */
	const hoistColorDirective = (lines: string[]): string[] => {
		const last = lines[lines.length - 1] ?? '';
		if (lines.length > 1 && isColorDirectiveLine(last)) {
			return lines;
		}
		const split = splitTrailingColorDirective(last);
		if (!split) {
			return lines;
		}
		return [...lines.slice(0, -1), split.content, split.directive];
	};

	/**
	 * 节点输出行（mdRaw 未变 → 原文；否则合成）。prefix=首行前缀，restIndent=续行缩进，
	 * `asHeading` = 本节点将写成 Markdown 标题（配色指令要挪出标题行）。
	 * `app` 直接取外层入参（此前另立同名形参遮蔽之，四处调用全部传同一个值）。
	 */
	const nodeLines = (
		child: MindMapTreeNode,
		prefix: string,
		restIndent: string,
		asHeading = false,
	): string[] => {
		const data: MdNodeData = child.data ?? {};
		// 内容三态（未编辑原文 / 纯 token / 文本+token）统一在 composeNodeContent，
		// 与「编辑原文」弹窗的预填同一实现——两处各写一份必然漂移
		const composed = composeNodeContent(data, app).split('\n');
		const lines = asHeading ? hoistColorDirective(composed) : composed;
		return [
			prefix + (lines[0] ?? ''),
			// 空行**不加** restIndent：缩进空行会写出尾随空格污染文件；空行在
			// 围栏内是代码内容、在围栏外是块分隔，均无需缩进（2026-09-28，
			// 列表项围栏的「空白续行并入前项 mdRaw」依赖此处保持空行为空行）
			...lines.slice(1).map((l) => (l === '' ? '' : restIndent + l)),
		];
	};

	interface SerializeFrame {
		children: readonly MindMapTreeNode[];
		index: number;
		listIndent: number;
		orderedCount: number;
		/**
		 * 标题上下文级别（K98）：`0` = 根（其子可为 1 级标题）、`1..6` = 当前所处
		 * 标题级别、`null` = 已不可标题化（祖先链上有 list/plain，或已到 6 级
		 * 标题之下）——未标注（新建）节点据此决定回写形态。
		 */
		headingLevel: number | null;
		/**
		 * 该层「存在列表型兄弟」的惰性缓存（`undefined` = 未计算）：同层 k 个未
		 * 标注节点此前各自扫一遍整层 ⇒ O(k²)；层内 children 在序列化期间不变，
		 * 按层算一次即可（2026-10-02）。**只在「本节点是该层第一个」时使用**，
		 * 其余位置看 {@link listBefore}（位置决定语法，见下）。
		 */
		followList?: boolean;
		/**
		 * **上一个已输出**的兄弟是列表型：紧随其后的未标注节点据此写列表项。
		 *
		 * 为什么不能只看「整层有列表」（`followList`）：混排组（`- 甲` + `# 乙`，
		 * 合法形态是列表在前、标题在后）里，排在**标题之后**的列表项会被解析成
		 * 该标题的**子节点**——「跟随列表」在那里会静默改结构（实测
		 * `- 甲` + `# 乙` + 新建节点写出 `- 新`，重开变成「乙 的子节点」）。
		 * 判据因此要看**紧邻的前一个兄弟**：它若不是列表，写列表项就会挂错父节点。
		 */
		lastWasList?: boolean;
	}

	/** 列表型兄弟（`mdType:'list'`，或未标注但显式选了列表标记——用户新建的列表项） */
	const isListSibling = (data: MdNodeData): boolean =>
		data.mdType === 'list' ||
		(data.mdType === undefined && data.mdMarker !== undefined);

	/**
	 * 该层是否存在**列表型兄弟**——新建节点据此「跟随兄弟风格」（K98 补充）：
	 * 是则写列表，使**纯列表文档**中新建节点不再冒出 `#` 标题；否则按层级写标题
	 * （标题树场景，K98 主规则）。仅用于「层首」位置：那里写标题会让后续列表项
	 * 变成它的子节点，故只要层内有列表就不能写标题。
	 */
	const siblingsFollowList = (
		children: readonly MindMapTreeNode[],
	): boolean => children.some((sib) => isListSibling(sib.data ?? {}));

	/** 层内「存在列表型兄弟」的惰性取值：结果挂 frame，同层只扫一次（O(k²)→O(k)） */
	const frameFollowList = (frame: SerializeFrame): boolean => {
		if (frame.followList === undefined) {
			frame.followList = siblingsFollowList(frame.children);
		}
		return frame.followList;
	};

	/**
	 * 显式栈替代递归：树深度由内容（缩进可任意深、可作者构造）决定，
	 * 递归实现在超深层级上会触发 RangeError 栈溢出导致保存崩溃。
	 * 语义与递归等价：先序输出，orderedCount/缩进按层独立。
	 */
	const walkChildren = (
		topSiblings: readonly MindMapTreeNode[],
		listIndent: number,
		headingLevel: number | null,
	): void => {
		const stack: SerializeFrame[] = [
			{
				children: topSiblings,
				index: 0,
				listIndent,
				orderedCount: 0,
				headingLevel,
			},
		];
		while (stack.length > 0) {
			const frame = stack[stack.length - 1]!;
			if (frame.index >= frame.children.length) {
				stack.pop();
				continue;
			}
			const child = frame.children[frame.index]!;
			frame.index++;
			const data: MdNodeData = child.data ?? {};
			const type = data.mdType;
			// 「**上一个**已输出的兄弟是列表」的快照 + 本层位置（`index === 1` 即层首）。
			// 快照必须在本节点计入之前取：自己的形态不能反过来决定自己的写法。
			const lastWasList = frame.lastWasList === true;
			const atGroupStart = frame.index === 1;
			frame.lastWasList = isListSibling(data);
			if (type === 'heading' && !headingsAsList) {
				frame.orderedCount = 0;
				const level = Math.min(6, Math.max(1, Number(data.mdLevel) || 1));
				pushBlock(nodeLines(child, '#'.repeat(level) + ' ', '', true));
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: 0,
					orderedCount: 0,
					// 6 级之下已无标题可降级 → 其下新建节点走列表分支
					headingLevel: level < 6 ? level : null,
				});
				continue;
			}
			if (type === 'plain' && !headingsAsList) {
				frame.orderedCount = 0;
				// 段落带子节点：段落行不带缩进，按原文输出会让子级掉一层
				//（K171④）。就地按**列表项**输出——内容与层级都保住，只是这一段
				// 变成了 `- 段`；比静默丢层或拦三条编辑入口更接近用户意图。
				if ((child.children?.length ?? 0) > 0) {
					const indent = indentUnit.repeat(frame.listIndent);
					pushBlock(
						nodeLines(child, `${indent}- `, `${indent}${indentUnit}`),
					);
					stack.push({
						children: child.children ?? [],
						index: 0,
						listIndent: frame.listIndent + 1,
						orderedCount: 0,
						headingLevel: null,
					});
					continue;
				}
				// 与 list/heading 同一出口：未编辑逐字回写；被编辑/插换图后首行写
				// 「文本 + token」——段落自本版起承载首行图片字段，插图中/移除图
				// 必须能写回/剥离（此前只写 text，插进段落的图片会被静默丢弃）。
				pushBlock(nodeLines(child, '', ''));
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: frame.listIndent,
					orderedCount: 0,
					// 段落之下不可标题化（标题写进段落中间会撕裂段落结构）
					headingLevel: null,
				});
				continue;
			}
			// 未标注（新建）节点：**按层级回写为 Markdown 标题**（K98）——第 1~6 层
			// → `#`×级别，与解析侧「#~###### → 第 1~6 层」严格对称；已到 6 级之下、
			// 或祖先链上有 list/plain（标题会撕裂列表/段落结构）→ 落入下方列表分支；
			// 显式选了列表标记（mdMarker）的新节点尊重用户选择；**列表风格跟随**——
			// 层首看整层（层内有列表就不能写标题，否则那些列表项成了它的子节点），
			// 其余位置只看**紧邻的前一个兄弟**（排在标题之后的列表项会被读成该标题
			// 的子节点，见 SerializeFrame.lastWasList）。
			const followList = atGroupStart ? frameFollowList(frame) : lastWasList;
			if (
				!headingsAsList &&
				!type &&
				data.mdMarker === undefined &&
				frame.headingLevel !== null &&
				!followList
			) {
				const level = frame.headingLevel + 1;
				frame.orderedCount = 0;
				pushBlock(nodeLines(child, '#'.repeat(level) + ' ', '', true));
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: 0,
					orderedCount: 0,
					headingLevel: level < 6 ? level : null,
				});
				continue;
			}
			// list 或未标注（新建，位于列表/段落上下文或 6 级之下）节点 → 列表行；
			// 剪贴板形态（headingsAsList）下 `*`/`+` 归一为 `-`（有序项保留编号）。
			// 有序项优先用解析时记下的原编号（`mdOrderedNumber`）：未编辑项不会
			// 被重排成 1、2、3…；新建项回落到前一项 + 1。
			// `0` 是合法起始编号（`0. 甲`），故判据是「非负」而不是「大于 0」——
			// 写成 `> 0` 会把 `0.` 静默改成 `1.`（解析侧同样只收非负安全整数）。
			const recorded = data.mdOrderedNumber;
			const orderedNumber =
				data.mdMarker === 'ordered'
					? typeof recorded === 'number' &&
						Number.isSafeInteger(recorded) &&
						recorded >= 0
						? recorded
						: frame.orderedCount + 1
					: 0;
			const marker =
				data.mdMarker === 'ordered'
					? `${orderedNumber}.`
					: headingsAsList
						? '-'
						: data.mdMarker || '-';
			frame.orderedCount = orderedNumber;
			// 每层一个**文档自己的**缩进单位；续行多给一个单位（与
			// `\t` / 2 空格 / 4 空格三种原文风格都对齐，见 MdNodeMeta.mdIndentUnit）
			const indent = indentUnit.repeat(frame.listIndent);
			out.push(
				...nodeLines(child, indent + marker + ' ', indent + indentUnit),
			);
			stack.push({
				children: child.children ?? [],
				index: 0,
				listIndent: frame.listIndent + 1,
				orderedCount: 0,
				headingLevel: null,
			});
		}
	};

	// 剪贴板形态：起始 headingLevel 传 null ⇒ 未标注节点一律走列表分支
	// （文档形态传「起始级别 - 1」⇒ 根级新建节点写 `#`×起始级别，见
	// SerializeFrame.headingLevel 与 MdNodeMeta.mdHeadingStart）
	walkChildren(siblings, 0, headingsAsList ? null : headingStart - 1);
	return out.join('\n');
}
