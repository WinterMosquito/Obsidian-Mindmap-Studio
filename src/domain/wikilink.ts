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
 *
 * 链接文本的拼接一律走本模块的 `formatWikilink` / `formatEmbedWikilink`，
 * 勿在调用方手写 `[[…|…]]` 模板串。
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
 * 构造**嵌入**语法的 wikilink（可带管道参数）：`![[目标]]` / `![[目标|参数]]`。
 *
 * 管道参数只用于非图片附件的嵌入（`![[报告.pdf|300]]`）。官方**未定义**该位语义
 * （PDF 官方用 `#height=`/`#page=`，只有图片的 `|宽`/`|宽x高` 有明文），故此处
 * 不做解释、原样保留原文——编辑节点后不丢用户写下的参数（见 mdEmbedPipe）。
 */
export function formatEmbedWikilink(linkpath: string, pipe?: string): string {
	return pipe ? `![[${linkpath}|${pipe}]]` : `![[${linkpath}]]`;
}

/**
 * 官方「文档类」库内文件扩展名：`.md`（笔记）、`.canvas`（Canvas）、`.base`（Bases）。
 *
 * 依据官方帮助：Canvas / Bases 是可在标签页打开的一等文件，其嵌入
 * （`![[My canvas.canvas]]`、`![[File.base#View]]`）属**文档嵌入**而非附件
 * （`en/Plugins/Canvas.md`、`en/Bases/Views.md`）；且链接到非 Markdown 文件
 * **必须带扩展名**（`en/Linking notes and files/Internal links.md`）。
 *
 * 清单就地定义而非从 `constants.ts` 引入：domain 层禁止反向依赖上层（eslint
 * `no-restricted-imports`）。`constants.ts` 的 `OBSIDIAN_RENDER_EXTENSIONS` 是
 * 「Obsidian 能否在标签页渲染」的**渲染能力**清单（含 pdf/图片/纯文本），与本处
 * 「双链目标算文档还是附件」的**语法判定**是两个关注点，勿合并成一份。
 */
const DOCUMENT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
	'md',
	'canvas',
	'base',
]);

/** 扩展名是否为文档类（md / canvas / base；大小写不敏感） */
export function isDocumentExtension(extension: string): boolean {
	return DOCUMENT_FILE_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * 取 linkpath 的 target 段（`|` 之前、`#` 之前）。
 *
 * 与 `parseWikilink` **同判**：含 `]` 的畸形串不拆分、整串当 target——
 * 那正是整串正则 `[^\]]+` 失配后的回退分支。故此处无需先拼 `[[…]]` 再解析，
 * 省掉每节点一次字符串拼接 + 一次正则执行。
 */
function targetOfLinkpath(linkpath: string): string {
	if (linkpath.includes(']')) {
		return linkpath;
	}
	const pipe = linkpath.indexOf('|');
	const path = pipe === -1 ? linkpath : linkpath.slice(0, pipe);
	const hash = path.indexOf('#');
	return hash === -1 ? path : path.slice(0, hash);
}

/**
 * wikilink 目标是否为「附件」（非文档类文件）。
 * Obsidian 语义：target 末段含扩展名且非文档类（md/canvas/base）→ 附件
 * （pdf/图片/音视频/压缩包等）；无扩展名或文档类扩展名 → 文档。
 * `#` 区块与 `|` 管道不影响判定（取 target 部分）。
 * 用途：双链指向附件的节点走引擎 attachmentUrl 字段（回形针图标），
 * 与指向文档的节点（自绘文档页图标）在视觉上区分。
 */
export function wikilinkTargetIsAttachment(linkpath: string): boolean {
	const target = targetOfLinkpath(linkpath);
	const name = target.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return false; // 无扩展名（或 .hidden 形态）→ 按 Obsidian 默认视为文档
	}
	return !isDocumentExtension(name.slice(dot + 1));
}

/**
 * 新建链接的**路径形态**（官方 `设置 → 文件与链接 → New link format`）。
 * 取值与官方一致：最短路径（默认）/ 相对路径 / 绝对路径。
 */
export type LinkPathFormat = 'shortest' | 'relative' | 'absolute';

/**
 * 按官方「New link format」把目标文件的库内路径写成链接路径。
 *
 * - `shortest`：库内唯一 → 只写文件名（官方「Uses the shortest unique path」）；
 *   有同名文件分布在不同目录时写**完整路径**（否则会指向错误的文件）；
 * - `relative`：相对当前文件的路径（同目录 → 文件名；上级目录 → `../…`）；
 * - `absolute`：从库根起的完整路径。
 *
 * **只用于新建**：已有链接的改写沿用用户原始前缀（见 links-tree 的引用更新）,
 * 本函数不参与。
 *
 * @param targetPath 目标文件在库内的完整路径（含扩展名）
 * @param sourcePath 当前文件（导图所在 .md）的路径，相对路径的基准；空值按库根
 * @param format     官方偏好
 * @param ambiguous  库内是否存在**同名**文件（`shortest` 是否退化为完整路径；
 *                   由调用方判定——本模块不接触 vault）
 */
export function formatLinkPath(
	targetPath: string,
	sourcePath: string,
	format: LinkPathFormat,
	ambiguous: boolean,
): string {
	if (format === 'absolute') {
		return targetPath;
	}
	if (format === 'relative') {
		const fromDir = sourcePath.split('/').slice(0, -1);
		const toParts = targetPath.split('/');
		const toDir = toParts.slice(0, -1);
		let shared = 0;
		while (
			shared < fromDir.length &&
			shared < toDir.length &&
			fromDir[shared] === toDir[shared]
		) {
			shared++;
		}
		const ups = Array.from({ length: fromDir.length - shared }, () => '..');
		return [...ups, ...toDir.slice(shared), toParts[toParts.length - 1]].join(
			'/',
		);
	}
	// shortest：同名冲突时官方也退化为（能唯一定位的）更长路径
	if (ambiguous) {
		return targetPath;
	}
	return targetPath.split('/').pop() ?? targetPath;
}

/**
 * linkpath 的**默认显示名**：末段去 `.md`（别名与链接语法都不参与）。
 *
 * 两个消费方共用：`linkDisplayText`（已解析出 parts）与
 * `wiki-display.effectiveDocWikiLink`（判断「新别名 == 默认显示名」时省略别名段）。
 * 后者若再走一遍 `withWikilinkAlias` + `linkDisplayText`，保存路径上每节点要
 * 多两次整串正则——故下沉到此处，口径仍只有一份。
 *
 * 不用 `split('/')` 与正则：本函数在 md-outline / md-serialize 的**逐链接**
 * 路径上，数组分配与 RegExp 执行都是纯开销。
 */
export function linkpathDisplayName(linkpath: string): string {
	const slash = linkpath.lastIndexOf('/');
	const name = slash === -1 ? linkpath : linkpath.slice(slash + 1);
	return name.endsWith('.md') ? name.slice(0, -3) : name;
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
	return linkpathDisplayName(parts.linkpath);
}
