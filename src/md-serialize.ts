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
 *   plain → 原样多行文本；新用户节点（无 mdType/mdRaw）按 '-' 输出；
 * - 列表项多行文本（续行）非首行补 2 空格缩进，保证可再解析为续行。
 */

import { App } from 'obsidian';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import { isIndentedCodeLine, isRenderableImageExtension } from './constants';
import { resolvePathToFile } from './links-resolve';
import {
	formatEmbedWikilink,
	formatWikilink,
	linkDisplayText,
	wikilinkLinkpath,
} from './domain/wikilink';
import { isExternalImageRef, isSchemeUrl } from './domain/url';
import { docWikiLinkDisplay, editedWikilinkAlias, effectiveDocWikiLink } from './domain/wiki-display';
import type { MdNodeData } from './node-data';

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

/** 行内 token 渲染：链接（仅合成路径使用） */
function renderHyperlink(data: MdNodeData): string | null {
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

/**
 * 图片自定义尺寸的回写参数（官方嵌入语法 `|宽度` / `|宽x高`；无自定义返回 null）。
 * 高度只在源行本就写了显式高度（`mdImageHeight`）时回写：拖拽调宽只写
 * `|宽度`、等比缩放（保持既有行为），而 `|300x150` 这类显式双参数在编辑
 * 节点后仍按当前尺寸写回 `|宽x高`，避免高度信息丢失。
 *
 * **加载期自动校正的尺寸不回写**（`mdImageAutoSize`）：它是显示用尺寸、非用户
 * 意图，回写会让用户从未动过的行凭空多出 `|宽度`。本函数是尺寸后缀的唯一出口
 * （wiki 嵌入 / md 图片 / rawOk 尺寸特征三处共用），故标记在此一处生效。
 */
function customImageSize(
	data: MdNodeData,
): { width: number; height: number | null } | null {
	if (data.mdImageAutoSize === true) {
		return null;
	}
	const size = data.imageSize;
	if (
		!size?.custom ||
		typeof size.width !== 'number' ||
		!Number.isFinite(size.width) ||
		size.width <= 0
	) {
		return null;
	}
	const explicitHeight =
		typeof data.mdImageHeight === 'number' && data.mdImageHeight > 0;
	const height =
		explicitHeight &&
		typeof size.height === 'number' &&
		Number.isFinite(size.height) &&
		size.height > 0
			? Math.round(size.height)
			: null;
	return { width: Math.round(size.width), height };
}

/** 图片自定义尺寸的回写宽度（`|宽度`；无自定义返回 null） */
function customImageWidth(data: MdNodeData): number | null {
	return customImageSize(data)?.width ?? null;
}

/**
 * 嵌入标签后缀（wiki 语法）：尺寸优先，其次 alt。
 * 官方语法不支持 alt 与尺寸共存（`![[图|说明|300]]` 无效），故二者择一。
 */
function embedLabelSuffix(data: MdNodeData): string {
	const size = customImageSize(data);
	if (size !== null) {
		return `|${size.width}${size.height !== null ? `x${size.height}` : ''}`;
	}
	const rawAlt = data.mdImageAlt;
	return typeof rawAlt === 'string' && rawAlt ? `|${rawAlt}` : '';
}

/** 节点是否残留图片元数据（image 已清空但 md 字段仍在 → 图片被移除） */
function hasImageMeta(data: MdNodeData): boolean {
	for (const key of [
		'mdImageTarget',
		'mdImageWidth',
		'mdImageHeight',
		'mdImageAlt',
	] as const) {
		const value = data[key];
		if (value !== undefined && value !== null && value !== '') {
			return true;
		}
	}
	return false;
}

/** mdRaw 中是否已含该图片引用（按嵌入语法边界匹配，避免文本同名串误命中） */
function rawHasImageFeature(raw: string, feature: string): boolean {
	return (
		raw.includes(`![[${feature}]]`) ||
		raw.includes(`![[${feature}|`) ||
		raw.includes(`](${feature})`) ||
		raw.includes(`](${feature} `)
	);
}

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
 * 合成路径的行内 token 列表（图片 / 链接），顺序与 mdRaw 中一致。
 *
 * 此前合成只输出一枚 token（`renderHyperlink() ?? renderImage()`）——图文混合
 * 或「图 + 链接」节点只要编辑过文本，图片引用就被静默丢弃（保存后文件里永久
 * 消失）。两枚 token 都必须写出；顺序按 mdRaw 中出现位置决定，新建的 token 追加
 * 在已有 token 之后，保证再次保存时行结构稳定（不再改动）。
 */
function inlineTokens(data: MdNodeData, app: App | null): string[] {
	const image = renderImage(data, app);
	const link = renderHyperlink(data);
	if (!image) {
		return link ? [link] : [];
	}
	if (!link) {
		return [image];
	}
	const raw = typeof data.mdRaw === 'string' ? data.mdRaw : '';
	const imageFeature = imageVaultPath(data, app);
	const linkFeature = linkFeatureOf(data);
	const imageAt = imageFeature ? raw.indexOf(imageFeature) : -1;
	const linkAt = linkFeature ? raw.indexOf(linkFeature) : -1;
	const linkFirst = linkAt >= 0 && imageAt >= 0 && linkAt < imageAt;
	return linkFirst ? [link, image] : [image, link];
}

/** 行内 token 渲染：图片（仅合成路径使用） */
function renderImage(data: MdNodeData, app: App | null): string | null {
	const image = data.image;
	if (typeof image !== 'string' || !image) {
		return null;
	}
	// 官方嵌入尺寸参数：`|宽度`（仅宽、等比缩放）或 `|宽x高`（显式双参数，
	// 见官方帮助「Embed files」`![[图|640x480]]` / `![alt|100x145](url)`）。
	const sizeSuffix = embedLabelSuffix(data);
	// 外链 md 图片的 alt：官方语法 `![alt|宽x高](url)`，alt 与尺寸共存
	const rawAlt = data.mdImageAlt;
	const alt = typeof rawAlt === 'string' ? rawAlt : '';
	const target =
		typeof data.mdImageTarget === 'string' ? data.mdImageTarget : '';
	// 外链/协议地址（http/data/blob/file）不是库内文件：官方只有 `![alt|尺寸](url)`
	// 一种形态；写成 `![[url]]` 会被 Obsidian 当成不存在的库内文件（图失效、alt 丢）。
	// **该判定必须排在「image === target」之前**——外链图片的 target 与 image 相等，
	// 否则拖拽调宽（尺寸落成 custom:true）后外链会被回写成 wikilink。
	if (isExternalImageRef(image) || isExternalImageRef(target)) {
		// alt 与尺寸可共存（`![alt|300](url)`），故用「仅尺寸」后缀，不能再套
		// embedLabelSuffix（无尺寸时它返回 `|alt`，会写出 `![alt|alt](url)`）。
		const size = customImageSize(data);
		const sizeOnly =
			size === null
				? ''
				: `|${size.width}${size.height !== null ? `x${size.height}` : ''}`;
		// 回写地址：优先当前 image（它就是引擎里的那张图）；只有 image 已是资源
		// 地址（app://）而原始引用才是外链时，才回落到 mdImageTarget（解析期快照
		// 可能已过期——「换图」后它仍指向旧图）。
		return `![${alt}${sizeOnly}](${isExternalImageRef(image) ? image : target})`;
	}
	if (target && image === target) {
		return `![[${target}${sizeSuffix}]]`;
	}
	if (app) {
		const file = resolvePathToFile(image, app);
		if (file) {
			return `![[${file.path}${sizeSuffix}]]`;
		}
	}
	return `![[${image}${sizeSuffix}]]`;
}

/** 图片当前库内路径（view 把 image 解析为资源地址后反查）；无则原样 */
function imageVaultPath(data: MdNodeData, app: App | null): string | null {
	const image = data.image;
	if (typeof image !== 'string' || !image) {
		return null;
	}
	if (app) {
		return resolvePathToFile(image, app)?.path ?? null;
	}
	return image;
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
 * 图片的「文件名显示名」（历史兼容：旧版本解析曾把文件名回退为纯图节点
 * 文本，经「插入/更换图片」同步的遗留数据仍可能命中；现行解析不再产生）。
 */
function imageSelfText(data: MdNodeData): string | null {
	const target = data.mdImageTarget;
	if (!target) {
		return null;
	}
	return target.split('/').pop() ?? null;
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
	if (data.text !== data.mdDerivedText) {
		return false;
	}
	// 图片已被移除（右键「移除图片」/被引用文件被删除）：image 已清空但 md 图片
	// 字段仍在 → mdRaw 里的嵌入必须被剥离。此前该情形跳过整段图片检查，而下方
	// 「链接已清除」检测又以 `(?<!!)\[\[` 排除嵌入语法，于是被判定「未编辑」→
	// 逐字回写 → 移除的图片在下次保存时复活。
	if (!data.image && hasImageMeta(data)) {
		return false;
	}
	if (data.image !== undefined && data.image !== null && data.image !== '') {
		// 当前图片特征（库内路径或外链原文）须已存在于 mdRaw。
		// 带自定义尺寸时特征含官方尺寸参数（`|宽度`）——尺寸被拖拽调整过
		// （或 mdRaw 尚无尺寸参数）即判定已变更，走合成回写新尺寸。
		// 终界检查（后随 `]` 或 `x`）：避免 `|30` 误匹配 `|300x150` 的前缀。
		const rawImage = typeof data.image === 'string' ? data.image : null;
		const feature = imageVaultPath(data, app) ?? rawImage;
		const width = customImageWidth(data);
		if (feature && width !== null) {
			const sized = `${feature}|${width}`;
			if (!raw.includes(`${sized}]`) && !raw.includes(`${sized}x`)) {
				return false; // 图新增/更换/调整尺寸，需合成
			}
		} else if (feature && !rawHasImageFeature(raw, feature)) {
			return false; // 图新增/更换，需合成
		}
	}
	const hyperlink = typeof data.hyperlink === 'string' ? data.hyperlink : '';
	const attachUrl =
		typeof data.attachmentUrl === 'string' ? data.attachmentUrl : '';
	const wikiLink =
		typeof data.mdWikiLinkpath === 'string' ? data.mdWikiLinkpath : '';
	if (hyperlink) {
		const feature = hyperlinkFeature(hyperlink);
		if (feature && !rawHasLinkFeature(raw, feature)) {
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
			!rawHasLinkFeature(raw, feature) &&
			!rawHasImageFeature(raw, feature)
		) {
			return false; // 附件链接新增/更新，需合成
		}
	} else if (wikiLink) {
		// 文档双链通道：取目标特征串（去别名）与 mdRaw 比对，与 hyperlink 同口径
		const feature = hyperlinkFeature(wikiLink);
		if (feature && !rawHasLinkFeature(raw, feature)) {
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
		const ownImage = [
			imageVaultPath(data, app),
			typeof data.image === 'string' ? data.image : null,
			typeof data.mdImageTarget === 'string' ? data.mdImageTarget : null,
		].filter((value): value is string => typeof value === 'string' && !!value);
		if (
			/(?<!!)\[\[|(?<!!)\[[^\]]*\]\(/.test(raw) ||
			rawHasForeignEmbed(raw, ownImage)
		) {
			// 链接已被清除（hyperlink/文档双链/附件字段全空）但 mdRaw 仍含链接语法：
			// 需合成剥离为纯文本，否则旧 mdRaw 原样回写会让"清除链接"失效
			return false;
		}
	} else if (
		!data.image &&
		!isIndentedCodeLine(raw) &&
		rawHasImageEmbedInFirstLine(raw)
	) {
		// 段落（plain）：图片字段已清空（用户「移除图片」，md 元数据同步清空），
		// 但首行仍有图片嵌入 → 需合成剥离，否则旧 mdRaw 原样回写会让图片复活。
		// 只查**首行**且排除缩进代码块（与解析侧同一判定）：段落字段只治理首行
		// 图片，其余行（含围栏/缩进代码里的 `![[..]]`）属原文，必须逐字回写；
		// 段落的链接语法同样属原文，不在此剥离。
		return false;
	}
	return true;
}

/** mdRaw **首行**是否含图片嵌入（`![[x.png]]`，按扩展名判定；段落图片剥离用） */
function rawHasImageEmbedInFirstLine(raw: string): boolean {
	const first = raw.split('\n')[0] ?? '';
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
 * raw 中是否含**不属于本节点图片**的嵌入 token（`![[…]]`）。
 *
 * 文档/附件嵌入与图片嵌入同语法，但前者是**链接**：清除链接后必须走合成剥离。
 * 判据只能是「这枚 token 的目标串是不是本节点图片的引用（库内路径/资源地址/
 * 原始目标三者之一）」——靠 `mdEmbed` 之类的残留字段不可靠（清除链接不会清它）。
 */
function rawHasForeignEmbed(raw: string, own: readonly string[]): boolean {
	const embedRe = /!\[\[([^\]]*)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = embedRe.exec(raw)) !== null) {
		const target = (match[1] ?? '').split('|')[0] ?? '';
		if (!own.includes(target)) {
			return true;
		}
	}
	return false;
}

/** 合成路径：节点文本首行（剥壳文本 + 行尾链接/图片 token） */
function composeFirstLine(data: MdNodeData, app: App | null): string {
	const text = typeof data.text === 'string' ? data.text.split('\n')[0] ?? '' : '';
	let line = text.trimEnd();
	const tokens = inlineTokens(data, app);
	if (tokens.length > 0) {
		const tail = tokens.join(' ');
		line = line ? `${line} ${tail}` : tail;
	}
	return line;
}

/**
 * 节点首行「内容」（不含 list 标记 / `#` 前缀，也不含续行）——
 * 序列化输出与 links-split 的拆分分析共用同一入口。
 *
 * 三态与序列化完全一致（避免拆分分析与实际写出口径漂移）：
 * 1. 未编辑（rawOk）→ 原文首行（含全部 `[[ ]]` 语法）；
 * 2. 纯 token 节点（文本恰为链接/图片自身显示名）→ 只输出 token；
 * 3. 其余（文本被编辑过）→ 文本 + 行尾 token（composeFirstLine）。
 */
export function composeNodeFirstLine(
	data: MdNodeData,
	app: App | null,
): string {
	if (rawOk(data, app)) {
		return data.mdRaw.split('\n')[0]!;
	}
	const text = typeof data.text === 'string' ? data.text : '';
	// 纯 token 节点（文本恰为链接/图片自身显示名，来自解析的单链/单图行，
	// 或「插入链接」已同步文本）→ 换图/换链后只输出新 token，避免旧名冗余。
	if (
		!text.includes('\n') &&
		text.trim() !== '' &&
		(nodeLinkDisplay(data) === text.trim() ||
			imageSelfText(data) === text.trim())
	) {
		// 两枚 token 都要写出（图文/图+链接节点此前只写一枚 → 图片丢失）
		const tokens = inlineTokens(data, app);
		if (tokens.length > 0) {
			return tokens.join(' ');
		}
	}
	return composeFirstLine(data, app);
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
	const out: string[] = [];

	/** 输出一个"块"，heading/plain 前插入空行分隔（首行除外） */
	const pushBlock = (lines: string[]): void => {
		if (lines.length === 0) {
			return;
		}
		if (out.length > 0 && out[out.length - 1] !== '') {
			out.push('');
		}
		out.push(...lines);
	};

	/** 节点输出行（mdRaw 未变 → 原文；否则合成）。prefix=首行前缀，restIndent=续行缩进 */
	const nodeLines = (
		child: MindMapTreeNode,
		prefix: string,
		restIndent: string,
		app: App | null,
	): string[] => {
		const data: MdNodeData = child.data ?? {};
		if (rawOk(data, app)) {
			const rawLines = data.mdRaw.split('\n');
			return [
				prefix + rawLines[0]!,
				...rawLines.slice(1).map((l) => restIndent + l),
			];
		}
		const text = typeof data.text === 'string' ? data.text : '';
		// 首行口径统一在 composeNodeFirstLine（拆分分析共用同一实现）
		return [
			prefix + composeNodeFirstLine(data, app),
			...text.split('\n').slice(1).map((l) => restIndent + l),
		];
	};

	interface SerializeFrame {
		children: MindMapTreeNode[];
		index: number;
		listIndent: number;
		orderedCount: number;
	}

	/**
	 * 显式栈替代递归：树深度由内容（缩进可任意深、可作者构造）决定，
	 * 递归实现在超深层级上会触发 RangeError 栈溢出导致保存崩溃。
	 * 语义与递归等价：先序输出，orderedCount/缩进按层独立。
	 */
	const walkChildren = (parent: MindMapTreeNode, listIndent: number): void => {
		const stack: SerializeFrame[] = [
			{
				children: parent.children ?? [],
				index: 0,
				listIndent,
				orderedCount: 0,
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
			if (type === 'heading') {
				frame.orderedCount = 0;
				const level = Math.min(6, Math.max(1, Number(data.mdLevel) || 1));
				pushBlock(nodeLines(child, '#'.repeat(level) + ' ', '', app));
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: 0,
					orderedCount: 0,
				});
				continue;
			}
			if (type === 'plain') {
				frame.orderedCount = 0;
				// 与 list/heading 同一出口：未编辑逐字回写；被编辑/插换图后首行写
				// 「文本 + token」——段落自本版起承载首行图片字段，插图中/移除图
				// 必须能写回/剥离（此前只写 text，插进段落的图片会被静默丢弃）
				pushBlock(nodeLines(child, '', '', app));
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: frame.listIndent,
					orderedCount: 0,
				});
				continue;
			}
			// list 或未标注（新建）节点 → 列表行
			const marker =
				data.mdMarker === 'ordered'
					? `${frame.orderedCount + 1}.`
					: data.mdMarker || '-';
			frame.orderedCount =
				data.mdMarker === 'ordered' ? frame.orderedCount + 1 : 0;
			const indent = '  '.repeat(frame.listIndent);
			out.push(...nodeLines(child, indent + marker + ' ', indent + '  ', app));
			stack.push({
				children: child.children ?? [],
				index: 0,
				listIndent: frame.listIndent + 1,
				orderedCount: 0,
			});
		}
	};

	walkChildren(tree, 0);
	return out.join('\n');
}
