/**
 * 文件重命名后的导图树引用更新（**字段 + 渲染源**双层）。
 *
 * 为什么不是直接调 links-tree：`updateReferencesOnRename` 只改写链接通道字段
 * （mdWikiLinkpath / hyperlink / attachmentUrl），而自绘节点的渲染源是 `mdRaw`
 * （node-inline-content 按行内 token 重建锚点）——只改字段时 `replaceMindMapData`
 * 全量重渲染，屏上锚点仍指向旧目标，直到重开文件（2026-10-02 复查发现，F2）。
 *
 * 本模块在字段改写之后做第二遍遍历，对「**未编辑**（text === mdDerivedText，与
 * serialize 的 rawOk 文本判据同源）且 mdRaw 仍含旧目标」的节点：
 *
 * 1. 用解析侧同一扫描器（`tokenizeInline`）定位行内 token——代码 span / 数学 /
 *    转义里的同名串天然不会被误改（links-tree 曾因裸子串匹配误命中的同类教训）；
 * 2. wiki / 非图片嵌入 / md 链接 token 按 links-tree 同一改写规则重写切片
 *    （renamedWikilink / renamedMdLinkDest：保留 #区块、|别名 与路径前缀写法）；
 * 3. `buildInlineData(newRaw)` 重建**渲染源四字段**（text / mdRaw / mdDerivedText /
 *    mdSegments，外加同源于解析的 mdLinkText）——**通道字段一律保留第一遍的
 *    改写结果**：它们是悬停 / Ctrl+点击 / 序列化回退的权威，且解析态的
 *    attachmentUrl 是裸 linkpath（资源地址是加载期解析），照搬会打断回形针通道。
 *
 * 边界：
 * - 图片 token 不动：引擎按 image 字段渲染（字段改写即生效），旧图引用由保存侧
 *   合成路径修正（renderImage 按字段重建，含尺寸参数）；
 * - 已编辑节点跳过：其渲染源是 data.text（无锚点语义，字段改写 + 保存合成已覆盖）；
 * - 移入回收站：links-tree 退化为清除语义（K55，保留未解析引用），渲染源同步
 *   保持原状；
 * - 幂等：重建后 mdRaw 不再含旧目标，二次运行 no-op。
 */
import { App, TFile } from 'obsidian';
import { isRenderableImageTarget } from '../core/constants';
import { walkTree } from '../domain/tree';
import { parseWikilink } from '../domain/wikilink';
import {
	isTrashedPath,
	renameTargets,
	renamedMdLinkDest,
	renamedWikilink,
	updateReferencesOnRename,
	type ReferenceTargets,
} from '../links/links-tree';
import { buildInlineData, tokenizeInline } from './md-outline';
import type { MdNodeData } from '../core/node-data';
import type { InlineToken } from './md-outline';
import type { MindMapTreeNode } from '../../vendor/simple-mind-map.cjs';

/**
 * 重命名引用（字段 + 渲染源）。返回是否有变更（由调用方触发保存）。
 *
 * 入参与 `updateReferencesOnRename` 完全一致，调用方（engine-controller）只需
 * 换被调函数；`replaceMindMapData` 的时序不变——重建发生在替换树**之前**，
 * 一次全量重渲染即呈现新目标。
 */
export function renameReferencesInTree(
	tree: MindMapTreeNode,
	file: TFile,
	oldPath: string,
	app: App,
): boolean {
	const changed = updateReferencesOnRename(tree, file, oldPath, app);
	// 回收站：字段改写已退化为清除语义（K55），渲染源同步保持原状
	if (!changed || isTrashedPath(file.path)) {
		return changed;
	}
	const targets = renameTargets(oldPath, file);
	walkTree(tree, (node) => {
		rebuildRenamedRaw(node.data, file, oldPath, targets);
	});
	return true;
}

/**
 * 单节点渲染源重建：mdRaw 里的旧链接 token 重写为新形态，再按新行重建
 * text / mdRaw / mdDerivedText / mdSegments（/ mdLinkText）。无命中即 no-op。
 */
function rebuildRenamedRaw(
	data: MdNodeData | undefined,
	file: TFile,
	oldPath: string,
	targets: ReferenceTargets,
): void {
	if (!data) {
		return;
	}
	const raw = data.mdRaw;
	if (typeof raw !== 'string' || !raw) {
		return;
	}
	// 未编辑守卫（与 serialize.rawOk 的文本判据同源）：已编辑节点的渲染源是
	// data.text，其链接要么已随编辑改写、要么本就由保存侧合成承载
	if (data.text !== data.mdDerivedText) {
		return;
	}
	let spliced = '';
	let cursor = 0;
	let hit = false;
	for (const tok of tokenizeInline(raw)) {
		const renamed = renamedTokenSlice(tok, raw, file, oldPath, targets);
		if (renamed === null) {
			continue;
		}
		spliced += raw.slice(cursor, tok.start) + renamed;
		cursor = tok.end;
		hit = true;
	}
	if (!hit) {
		return;
	}
	spliced += raw.slice(cursor);
	const rebuilt = buildInlineData(spliced);
	data.text = rebuilt.text;
	data.mdRaw = rebuilt.mdRaw;
	data.mdDerivedText = rebuilt.mdDerivedText;
	if (rebuilt.mdSegments) {
		data.mdSegments = rebuilt.mdSegments;
	} else {
		delete data.mdSegments;
	}
	// 链接的可见名同步为新行解析值（`[[旧名]]` → `[[新名]]` 的 mdLinkText 应为
	// 「新名」，否则用户下次改别名时 editedWikilinkAlias 的「通道自带可见名」
	// 闸门对不上（mdLinkText !== mdDerivedText）而拒绝改写
	if (typeof rebuilt.mdLinkText === 'string') {
		data.mdLinkText = rebuilt.mdLinkText;
	} else {
		delete data.mdLinkText;
	}
}

/**
 * 单个行内 token 的重命名改写：命中旧目标返回**新 token 原文**，未命中返回 null。
 *
 * 只处理三类承载库内目标的 token（wiki / 非图片嵌入 / md 链接）；autolink 与
 * 裸 URL 是外部地址、mdImg 与图片嵌入走图片通道（引擎按字段渲染）——均不重命名。
 */
function renamedTokenSlice(
	tok: InlineToken,
	raw: string,
	file: TFile,
	oldPath: string,
	targets: ReferenceTargets,
): string | null {
	const slice = raw.slice(tok.start, tok.end);
	if (tok.kind === 'wiki' || tok.kind === 'wikiImg') {
		// 图片嵌入不重建（引擎按 image 字段渲染，字段改写即生效）
		if (tok.kind === 'wikiImg' && isRenderableImageTarget(tok.target)) {
			return null;
		}
		const parts = parseWikilink(
			tok.kind === 'wikiImg' ? slice.slice(1) : slice,
		);
		if (!parts || !targets.linkTargets.includes(parts.target)) {
			return null;
		}
		return (tok.kind === 'wikiImg' ? '!' : '') + renamedWikilink(parts, file, oldPath);
	}
	if (tok.kind === 'mdLink') {
		// 命中判定与扩展名补回走 links-tree 同一实现（tok.target 已剥尖括号）
		const renamed = renamedMdLinkDest(tok.target, file, oldPath);
		if (renamed === null) {
			return null;
		}
		const m = /^\[([\s\S]*)\]\(([\s\S]*)\)$/.exec(slice);
		const label = m?.[1] ?? tok.label;
		const destRaw = m?.[2] ?? '';
		const braced = destRaw.startsWith('<') && destRaw.endsWith('>');
		// 尖括号兜底与 md-serialize 的 needsDestBraces 同口径（含空格/括号等
		// 会破坏 `(…)` 闭合的目标必须包裹）；原文带尖括号则保持
		const needBraces = braced || /[\s()<>\\]/.test(renamed);
		return `[${label}](${needBraces ? `<${renamed}>` : renamed})`;
	}
	return null;
}
