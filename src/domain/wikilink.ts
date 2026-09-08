/**
 * Wikilink（Obsidian 双链）领域模型：解析与构造的唯一权威实现。
 *
 * 此前 view-wikilink / links-tree / md-serialize / view-node-actions / view
 * 各自手写 `[[target|alias]]` 的切片解析（5 组重复，且对 `#区块` 的处理
 * 互不一致）；统一收敛到本模块，语法对齐 Obsidian：
 *
 *   [[linkpath]]            目标（可含 #区块）
 *   [[linkpath|alias]]      带别名
 *   [[note#标题|别名]]      区块引用 + 别名
 *
 * linkpath = `|` 之前整段；target = linkpath 中 `#` 之前；
 * block = `#` 之后、`|` 之前；alias = 第一个 `|` 之后。
 */

/** 维基链接完整语法（整串匹配）：`[[inner]]`，inner 不含 `]]` */
const WIKILINK_RE = /^\[\[([^\]]+)\]\]$/;

/** 解析结果（各段均为原始文本，不做 URL 解码与同名消歧） */
export interface WikilinkParts {
	/** 目标路径（# 区块之前）：`[[note#标题|别名]]` → `note` */
	target: string;
	/** 区块引用（# 后、| 前，不含 #）：`[[note#标题]]` → `标题`；无则 `''` */
	block: string;
	/** 别名（首个 | 之后整段）：`[[note|别名]]` → `别名`；无则 `''` */
	alias: string;
	/** Obsidian linkpath（target + block，`|` 之前整段）：悬停预览/解析用 */
	linkpath: string;
	/** `[[` 与 `]]` 之间的原始内容：openLinkText 等需整段透传的场景用 */
	inner: string;
}

/** 是否为完整维基链接（`[[...]]` 整串；`[[x` 之类残缺形态不算） */
export function isWikilink(link: string): boolean {
	return WIKILINK_RE.test(link);
}

/** 解析维基链接；非 `[[...]]` 完整形态返回 null */
export function parseWikilink(link: string): WikilinkParts | null {
	const m = WIKILINK_RE.exec(link);
	const inner = m?.[1];
	if (!inner) {
		return null;
	}
	const pipe = inner.indexOf('|');
	const linkpath = pipe === -1 ? inner : inner.slice(0, pipe);
	const alias = pipe === -1 ? '' : inner.slice(pipe + 1);
	const hash = linkpath.indexOf('#');
	const target = hash === -1 ? linkpath : linkpath.slice(0, hash);
	const block = hash === -1 ? '' : linkpath.slice(hash + 1);
	return { target, block, alias, linkpath, inner };
}

/**
 * 维基链接的 Obsidian linkpath（目标+区块，去别名）。
 * 非维基链接、或目标为空（`[[|别名]]`）时返回 null。
 */
export function wikilinkLinkpath(link: string): string | null {
	const parts = parseWikilink(link);
	return parts ? parts.linkpath || null : null;
}

/** 构造维基链接文本（alias 为空时省略 `|` 段） */
export function formatWikilink(linkpath: string, alias?: string): string {
	return alias ? `[[${linkpath}|${alias}]]` : `[[${linkpath}]]`;
}

/**
 * wikilink 目标是否为「附件」（非 .md 笔记）。
 * Obsidian 语义：target 末段含扩展名且非 .md → 附件（pdf/png/音频等）；
 * 无扩展名或 .md → 文档。`#` 区块不影响判定（取 target 部分）。
 * 用途：双链指向附件的节点走引擎 attachmentUrl 字段（回形针图标），
 * 与指向文档的节点（链接图标）在视觉上区分。
 */
export function wikilinkTargetIsAttachment(linkpath: string): boolean {
	const target = parseWikilink(`[[${linkpath}]]`)?.target ?? linkpath;
	const name = target.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return false; // 无扩展名（或 .hidden 形态）→ 按 Obsidian 默认视为文档
	}
	return name.slice(dot + 1).toLowerCase() !== 'md';
}

/**
 * 链接的「可见文本」（Obsidian 双链语义）：
 * 别名优先；否则取 linkpath 末段并去 .md 扩展（笔记显示名）；
 * 非维基链接（URL / 库内路径）原样可见。
 */
export function linkDisplayText(link: string): string {
	const parts = parseWikilink(link);
	if (!parts) {
		return link;
	}
	if (parts.alias) {
		return parts.alias;
	}
	const name = parts.linkpath.split('/').pop() ?? '';
	return name.replace(/\.md$/, '');
}
