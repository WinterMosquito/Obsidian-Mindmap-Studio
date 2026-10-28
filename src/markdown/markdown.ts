/**
 * Markdown 渲染模式工具：新建文件名/默认正文/uid 修复。
 *
 * 解析（正文 → 导图树）与序列化（树 → md）见 md-outline.ts / md-serialize.ts；
 * 行内 wikilink 交互见 view-wikilink.ts。本文件不含任何专有格式逻辑。
 */
import { generateUid } from '../core/constants';
import { t, type Language } from '../core/i18n';
import { buildMindMapFrontmatter } from '../domain/mindmap-property';
import { walkTree } from '../domain/tree';
import type { MindMapTreeNode } from '../core/engine-types';

/**
 * 新建思维导图的默认正文：**属性声明块 + 标准 Markdown 大纲**。
 *
 * 属性块（标准键 `Mindmap` + 布局标准值，与界面语言无关）是文件「是导图、用哪种
 * 布局」的唯一凭据——触发判定不认文件名（见 domain/mindmap-property）；块后空行
 * 分隔正文，与 md-outline.splitFrontmatter 的边界口径一致（K46）。
 * 无标题时中心主题 = 文件名，列表项即第 1 级子主题。
 *
 * @param layoutValue 属性标准值（种子布局，PascalCase）。缺省 = 思维导图布局。
 */
export function createDefaultMarkdownContent(
	lang: Language = 'zh',
	layoutValue?: string,
): string {
	const body = [
		`- ${t(lang, 'default.shortcutHint')}`,
		`- ${t(lang, 'default.tabHint')}`,
		`- ${t(lang, 'default.enterHint')}`,
		'',
	].join('\n');
	return `${buildMindMapFrontmatter(layoutValue)}\n${body}`;
}

/**
 * 新建思维导图的默认文件名（不含扩展名）：
 * 「思维导图」+ 当前日期，如 思维导图2026-08-21。
 */
export function buildDefaultMindMapName(lang: Language = 'zh', now = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${t(lang, 'default.fileNamePrefix')}${year}-${month}-${day}`;
}

/**
 * 修复树中缺失或重复的节点 uid。
 * 导入的外部 md/JSON 可能包含重复/缺失 uid，会导致引擎按 uid 查找节点时
 * 误删/漏删。返回是否有修改。
 */
export function ensureUniqueUids(tree: MindMapTreeNode): boolean {
	const seen = new Set<string>();
	let changed = false;
	// walkTree 用显式栈遍历：树深度可由导入内容任意构造，递归会栈溢出
	walkTree(tree, (node) => {
		if (!node.data) {
			node.data = { text: '' };
		}
		const uid = node.data.uid;
		if (!uid || seen.has(uid)) {
			node.data.uid = generateUid();
			changed = true;
		} else {
			seen.add(uid);
		}
	});
	return changed;
}
