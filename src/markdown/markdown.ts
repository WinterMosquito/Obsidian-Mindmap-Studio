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
 * 新建思维导图的默认内容：**属性声明块 + 空正文**，只显示文件名对应的中心节点。
 *
 * 属性块（启用信号 `Mindmap: Mindmap` + 布局键 kebab 值，与界面语言无关）是文件
 * 「是导图、用哪种布局」的唯一凭据——触发判定不认文件名（见
 * domain/mindmap-property）；块后空行分隔正文，与 md-outline.splitFrontmatter 的
 * 边界口径一致（K46）。不预置示例、快捷键提示或空白子节点。
 *
 * 首个节点的层级语法由视图加载空文档时的 `seedHeadingStart` 初始化（见 K201）；
 * 有内容后仍按正文自身写法回写，不把设置或提示节点写进文件。
 *
 * @param layoutId 种子布局（引擎 layout id，如 `logicalStructure`）。缺省 = 思维导图布局。
 */
export function createDefaultMarkdownContent(layoutId?: string): string {
	return `${buildMindMapFrontmatter(layoutId)}\n`;
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
