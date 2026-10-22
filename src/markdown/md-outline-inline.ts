/**
 * 行内 token 的**切分与显示**：`[[wikilink]]` / `[文本](url)` / `![[图]]` /
 * `![alt](url)` / 裸 URL 的识别、剥壳显示名与上下文锚点。
 *
 * 从 `md-outline.ts` 拆出（2026-10-22，纯搬移，零行为改动）。这一族只做
 * 「一行字符串 → token 列表」的纯文本工作，不碰树、不碰 frontmatter；树形装配
 * 与字段回填仍在 `md-outline.ts`（`buildInlineData` 一族）。
 *
 * 消费方：`md-outline.ts`（解析期）与 `md-serialize.ts`（`rawOk` 的引用判定、
 * 合成期的原位定位）——两者都只用 token 的 `kind` / `target` / `label` /
 * `sizeWidth` / 位置区间，故本文件不导出写回逻辑。
 */
import { isRenderableImageExtension } from '../core/constants';
import type { MdTokenSegment } from '../domain/md-meta';
type InlineTokenKind =
	| 'wikiImg'
	| 'wiki'
	| 'mdImg'
	| 'mdLink'
	| 'autolink'
	| 'bareUrl';

export interface InlineToken {
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

/** 裸 URL 协议前缀（入口短路用；与 INLINE_RE 第 9 组的协议面一致） */
const BARE_URL_PREFIX_RE = /(?:https?:\/\/|ftp:\/\/|obsidian:\/\/)/;

export function tokenizeInline(raw: string): InlineToken[] {
	// **入口短路**：五个分支各自的必要子串全缺 → 不可能有任何 token，直接空返。
	//
	// 为什么必须短路（2026-10-02）：INLINE_RE 第二备选 `\[([^\]]*)\]\(…` 的
	// `[^\]]*` 在「大量 `[` 起点但无 `](` 闭合」的长行上会逐起点全量回退 ⇒
	// 单行最坏 O(n²)；而本函数被解析 / 序列化 / 改名 / 拆分共用，且都在打开与
	// 保存路径**同步**执行——5 万字符的病态行可达秒级阻塞。短路后绝大多数
	// 普通正文行（含孤立 `[`）不再进入正则。
	//
	// 完备性：wiki/wikiImg 需 `]]`；mdLink/mdImg 需 `](`；autolink 需 `<`；
	// 裸 URL 需协议前缀——四者皆无即无 token（`[` 本身不成 token）。
	if (
		!raw.includes(']]') &&
		!raw.includes('](') &&
		!raw.includes('<') &&
		!BARE_URL_PREFIX_RE.test(raw)
	) {
		return [];
	}
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

/**
 * token 的剥壳显示文本（节点文本中替换 [[]] 包裹后的样子）。
 * export 供节点内联内容渲染（`features/node-inline-content.ts`，方案 B 原型）复用
 * ——「链接该显示成什么」必须与解析侧同一口径，在别处重写一遍必然漂移。
 */
export function tokenDisplay(tok: InlineToken): string {
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
 * 无显示名 token 的**上下文锚点**（写入 `MdTokenSegment` 的 before/after/sep* 族）。
 *
 * 取原文里 token 左右两侧**紧邻的非空白文字 run**：合成侧在编辑后的新文本里反查
 * 该文字即可把 token 插回原位，避免「无显示名 → 只能尾插 → 图片被搬到行尾」。
 * 语义与长度上限见 `domain/md-meta` 「无显示名段的锚点」。
 *
 * 两侧都按**相邻 token 的边界**裁剪（`from` / `to`），而不是一路取到行首行尾——
 * 否则 `前 ![[a]] 与 ![[b]] 后` 里 `a` 的右邻会连 `![[b]]` 一起吞进锚点，
 * 反查时这段文字根本不在新文本里（`b` 的显示名才是），必然失配。
 *
 * run 截断到 `ANCHOR_MAX_CHARS`（前文取尾部、后文取头部）：锚点只用于**反查**，
 * 太长既降低命中率也让 mdSegments 膨胀。两侧都空（纯 token 行）时全部留空，
 * 合成侧反查失败走尾插——此时节点文本本就是空串，尾插结果与原文一致。
 */
const ANCHOR_MAX_CHARS = 32;

export function tokenAnchors(
	raw: string,
	start: number,
	end: number,
	from: number,
	to: number,
): Pick<MdTokenSegment, 'before' | 'after' | 'sepBefore' | 'sepAfter'> {
	const left = raw.slice(from, start);
	const right = raw.slice(end, to);
	// 左邻 run：token 前最后一段连续非空白（不跨行）。
	// ⚠ `$` 会让 `[^\n]*` 把**行末空白也吞进来**（`AAA ` 匹配到 `AAA `），
	// 故先 trimEnd 再截断——否则截断窗口里混着空白、锚点凭空短一截。
	const beforeRun = (/\S[^\n]*$/.exec(left)?.[0] ?? '').trimEnd();
	// 右邻 run：token 后第一段连续非空白（不跨行）
	const afterRun = (/^[^\n]*\S/.exec(right)?.[0] ?? '').trimStart();
	return {
		before: beforeRun.slice(-ANCHOR_MAX_CHARS),
		after: afterRun.slice(0, ANCHOR_MAX_CHARS),
		sepBefore: /\s$/.test(left),
		sepAfter: /^\s/.test(right),
	};
}

/**
 * 嵌入目标是否为图片（按扩展名判定；无扩展名/未知扩展名视为非图片）。
 * 用 Obsidian 可渲染图片清单（含 avif/apng/jxl/tif/tiff）——与 Obsidian 的嵌入
 * 行为对齐；非图片嵌入（PDF/音视频等）不能作为节点图渲染，需改走附件通道。
 */
export function isImageEmbedTarget(target: string): boolean {
	const name = target.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return false;
	}
	return isRenderableImageExtension(name.slice(dot + 1));
}
