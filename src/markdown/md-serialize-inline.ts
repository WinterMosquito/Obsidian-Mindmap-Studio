/**
 * 图片族的合成回写实现：尺寸参数 / 嵌入标签 / 「图片是否已在 mdRaw」特征判定 /
 * `renderImage`。
 *
 * 从 `md-serialize.ts` 拆出（2026-10-22，纯搬移，零行为改动）。这一族在文件内
 * **相互引用**（`renderImage` ↔ `customImageSize` ↔ `rawImageMatches`），而与链接
 * 族只通过 `rawOk` 入口相遇，故整族独立成文件后两侧边界清晰（R12a 的排布就是
 * 为这一步做的准备）。
 *
 * `stripAngleBrackets` 随本族搬出：`rawImageMatches`（本文件）与 `rawLinkMatches`
 * （`md-serialize.ts`）共用它，由后者反向 import——依赖方向单向，无循环。
 */
import type { App } from 'obsidian';
import { readNodeDataString, type MdNodeData } from '../core/node-data';
import { resolvePathToFile } from '../links/links-resolve';
import { isExternalImageRef } from '../domain/url';
import { formatEmbedWikilink } from '../domain/wikilink';
import { tokenizeInline } from './md-outline';

/** 目标/地址的 `<>` 包裹剥壳（md 链接与图片目标都可能写作 `<路径 带空格>`） */
export function stripAngleBrackets(value: string): string {
	return value.startsWith('<') && value.endsWith('>')
		? value.slice(1, -1)
		: value;
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
export function hasImageMeta(data: MdNodeData): boolean {
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
export function rawHasImageFeature(raw: string, feature: string): boolean {
	return (
		raw.includes(`![[${feature}]]`) ||
		raw.includes(`![[${feature}|`) ||
		raw.includes(`](${feature})`) ||
		raw.includes(`](${feature} `)
	);
}

/**
 * 当前图片是否已被 mdRaw 引用（rawOk 的图片判定）。
 *
 * 引用等价形态（此前只认「字段字面量出现在 raw」，两类合法写法被误判
 * 「已变更」→ 未编辑行每次保存都被重写）：
 * ① 与节点字段（资源地址 / 库内路径 / 外链原文）字面一致（允许 `<>` 包裹差异）；
 * ② 库内不同写法（裸名 / 相对路径）：经统一解析入口指向当前图片**同一文件**；
 * 带自定义尺寸（customImageWidth）时还要求命中 token 的尺寸参数与之一致——
 * 两形态统一按 `token.sizeWidth` 判定（md 形态尺寸在 alt 位，「目标|宽度」
 * 字符串拼接不到目标之后，此前恒判「已变更」→ md 图片合成尾插 → 文本重复）。
 */
export function rawImageMatches(
	data: MdNodeData,
	raw: string,
	app: App | null,
): boolean {
	const rawImage = readNodeDataString(data, 'image');
	const vaultPath = imageVaultPath(data, app);
	const candidates: string[] = [];
	if (rawImage) {
		candidates.push(rawImage);
	}
	if (vaultPath && vaultPath !== rawImage) {
		candidates.push(vaultPath);
	}
	if (candidates.length === 0) {
		return true; // 字段异常（外层已拦截空 image）：不拦截
	}
	const width = customImageWidth(data);
	// 快路径：字段字面量已出现（覆盖绝大多数节点，避免逐行 tokenize）
	if (width === null && candidates.some((c) => rawHasImageFeature(raw, c))) {
		return true;
	}
	const isCurrent = (target: string): boolean => {
		const bare = stripAngleBrackets(target);
		if (candidates.some((c) => stripAngleBrackets(c) === bare)) {
			return true;
		}
		// 库内不同写法：解析到与当前图片同一文件即视为同一引用
		return (
			app !== null &&
			!!vaultPath &&
			resolvePathToFile(bare, app)?.path === vaultPath
		);
	};
	for (const token of tokenizeInline(raw)) {
		if (token.kind !== 'wikiImg' && token.kind !== 'mdImg') {
			continue;
		}
		if ((width === null || token.sizeWidth === width) && isCurrent(token.target)) {
			return true;
		}
	}
	return false;
}

/**
 * 图片尺寸参数的**仅尺寸**后缀（md 图片 `![alt|宽x高](url)` 用）。
 * 与 embedLabelSuffix 的差别：无尺寸时返回空串——md 形态的 alt 走 `![alt]` 位置，
 * 不能再套 `|alt`（否则写出 `![alt|alt](url)`）。
 */
function imageSizeSuffix(data: MdNodeData): string {
	const size = customImageSize(data);
	if (size === null) {
		return '';
	}
	return `|${size.width}${size.height !== null ? `x${size.height}` : ''}`;
}

/** 行内 token 渲染：图片（仅合成路径使用） */
export function renderImage(data: MdNodeData, app: App | null): string | null {
	const image = data.image;
	if (typeof image !== 'string' || !image) {
		return null;
	}
	// 官方嵌入尺寸参数：`|宽度`（仅宽、等比缩放）或 `|宽x高`（显式双参数，
	// 见官方帮助「Embed files」`![[图|640x480]]` / `![alt|100x145](url)`）。
	const sizeSuffix = embedLabelSuffix(data);
	// `formatEmbedWikilink` 的管道参数**不含**前导 `|`，而 `embedLabelSuffix`
	// 的返回值带（它同时供 `![alt|尺寸](url)` 直接后接）——故显式去前缀，
	// 否则会写出 `![[a.png||250]]`（2026-10-07 回归实测）。
	const pipe = sizeSuffix.startsWith('|') ? sizeSuffix.slice(1) : sizeSuffix;
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
		// 回写地址：优先当前 image（它就是引擎里的那张图）；只有 image 已是资源
		// 地址（app://）而原始引用才是外链时，才回落到 mdImageTarget（解析期快照
		// 可能已过期——「换图」后它仍指向旧图）。
		return `![${alt}${imageSizeSuffix(data)}](${isExternalImageRef(image) ? image : target})`;
	}
	// **库内图片的 md 形态**：官方「使用 \[\[Wikilinks\]\]」关闭时新建的图写
	// `![alt|尺寸](路径)`（该设置同时管 links 与 images，见 platform/vault-prefs）。
	// 形态由解析期记录 / 新建时按设置写入（md-meta.mdImageStyle），缺省按 wiki。
	if (data.mdImageStyle === 'md') {
		return `![${alt}${imageSizeSuffix(data)}](${target || image})`;
	}
	// **库内 wikilink 的目标串**：仍指向「当前这张图」时保留解析期原文
	// （`mdImageTarget`），只有它已指向别的文件 / 无法解析时才回落
	// `image` 的真实库内路径。
	//
	// 为什么优先原文（2026-10-20 实机实测）：拖拽调宽走合成回写，此前按
	// `resolvePathToFile(image).path` 写，`![[sample-icon.svg|190]]` 被扩写成
	// `![[fixtures/assets/sample-icon.svg|190]]`——用户只改了尺寸，引用写法却被
	// 无关改写（子文件夹裸名引用尤其刺眼）。
	//
	// 为什么不能无条件用原文：文件重命名后 `mdImageTarget` 可能是旧值（与上方
	// external 分支注释同一风险），写原文会留下悬空引用（回归用例「图片文件
	// 重命名后 → 合成写新路径」）。判据是**两份解析结果是否同一文件**。
	//
	// `image` 无法反查（图片已不在库中 / 未带 app）时保持旧口径（原样写 `image`）：
	// 上游 `links-split` 等处的「宁可不动，也不把 app:// 写进笔记」兜底依赖它。
	const imageFile = app ? resolvePathToFile(image, app) : null;
	if (app && imageFile) {
		const targetFile = target ? resolvePathToFile(target, app) : null;
		const targetIsStale =
			targetFile === null || targetFile.path !== imageFile.path;
		if (target && !targetIsStale) {
			return formatEmbedWikilink(target, pipe);
		}
		return formatEmbedWikilink(imageFile.path, pipe);
	}
	return formatEmbedWikilink(image, pipe);
}

/** 图片当前库内路径（view 把 image 解析为资源地址后反查）；无则原样 */
export function imageVaultPath(data: MdNodeData, app: App | null): string | null {
	const image = data.image;
	if (typeof image !== 'string' || !image) {
		return null;
	}
	if (app) {
		return resolvePathToFile(image, app)?.path ?? null;
	}
	return image;
}

/**
 * 图片的「文件名显示名」（历史兼容：旧版本解析曾把文件名回退为纯图节点
 * 文本，经「插入/更换图片」同步的遗留数据仍可能命中；现行解析不再产生）。
 */
export function imageSelfText(data: MdNodeData): string | null {
	const target = data.mdImageTarget;
	if (!target) {
		return null;
	}
	return target.split('/').pop() ?? null;
}
