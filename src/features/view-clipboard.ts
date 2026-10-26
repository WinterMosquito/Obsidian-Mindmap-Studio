/**
 * 节点剪贴板：复制 / 剪切 / 粘贴的**唯一收口**（系统剪贴板，纯 Markdown 文本）。
 *
 * 四条裁决（1–3 为 2026-10-13 用户裁决，4 为 2026-10-26 追加）：
 * 1. `Ctrl+C` / `Ctrl+X` / `Ctrl+V` 一律走**系统剪贴板**——引擎自带的 JSON
 *    剪贴板通道由 `beforeShortcutRun` 短路（见 `engine/mindmap` 与
 *    `handleClipboardShortcut`）；
 * 2. 写出去/读进来的**只有 Markdown 文本**：标题不论几级一律降级为无序列表项
 *    （`#` → `-`）、有序项保留 `1.`、层级由缩进表达（序列化见
 *    `md-serialize.serializeSubtreesToOutline`，解析见
 *    `md-outline.parseMdOutlineFragment`——同一份往返实现，硬规则 5）；
 * 3. 插件内**不再有内存剪贴板**（视图级 WeakMap 已整体删除）：读/写失败只提示，
 *    不留副本——两份剪贴板必然行为漂移；
 * 4. **无选中时 `Ctrl+C` = 复制整张图的大纲**（2026-10-26 用户裁决）：中心主题
 *    作首行、与选中子树同一序列化口径（见 `engine/mindmap-clipboard.collectWholeTreeSubtrees`）；
 *    此前这里只弹「请先选择一个节点」、剪贴板保持原样。
 *
 * 为什么粘贴优先走 `paste` 事件而不是 `clipboard.readText()`：事件自带的
 * `clipboardData` 是**同步、零权限**通道；宿主拒绝 `readText` 时引擎自己的
 * 粘贴路径会静默失效（用户反馈的「粘不了」表现之一）。菜单入口没有事件可用，
 * 才回落 `readClipboardText()`。
 */
import { Notice } from 'obsidian';
import {
	collectSelectedSubtrees,
	collectWholeTreeSubtrees,
	cutSelectedSubtrees,
	getActiveNode,
	getRenderRoot,
	insertSubtreesAsChildren,
} from '../engine/mindmap';
import { readClipboardText, writeClipboardText } from '../platform/clipboard';
import { parseMdOutlineFragment } from '../markdown/md-outline';
import { serializeSubtreesToOutline } from '../markdown/md-serialize';
import { t, type Language, type TranslationKey } from '../core/i18n';
import { isTextEntryTarget, type PasteClipboardHost } from './view-common';
import { isAnyNodeEditing } from './node-inline-editor';
import type { MindMapNode } from '../core/engine-types';

/**
 * 复制到系统剪贴板（Markdown 大纲）。
 *
 * - **有选中节点**：复制这些节点及其整棵子树（`collectSelectedSubtrees`，根节点
 *   被过滤——避免把整篇文档嵌成自己的子节点）；
 * - **无选中节点**：复制**整张图**（2026-10-26 用户裁决）——中心主题作首行，
 *   与选中路径同一序列化口径（标题降级为 `-`、层级用缩进），可直接粘回导图。
 * - **只选中了根**：与「无选中」同路——根被过滤后集合为空，自然落到整图分支
 *   （「复制根」的语义就是复制整图，不再单独拦截）。
 *
 * 两条路径只在「取哪些子树」上不同，写剪贴板与提示完全共用（同一条
 * `writeOutline`）；**只有渲染树不可得**（首帧前 / 销毁中，两条路径都取不到
 * 根）才提示 `common.notLoaded`，不做静默 no-op。
 */
export function copySelectedNodes(view: PasteClipboardHost): void {
	const selected = collectSelectedSubtrees(view.mindMap);
	const subtrees =
		selected.length > 0 ? selected : collectWholeTreeSubtrees(view.mindMap);
	if (subtrees.length === 0) {
		new Notice(t(view.lang, 'common.notLoaded'));
		return;
	}
	writeOutline(
		view.lang,
		serializeSubtreesToOutline(subtrees, view.app),
		'common.nodeCopied',
	);
}

/**
 * 剪切当前选中节点：引擎 `CUT_NODE` 完成「复制数据 + 从父节点移除 + 重绘」，
 * 插件负责把数据写成 Markdown 放进系统剪贴板（2026-10-13 裁决：正常剪切、
 * 不提示——只选中根节点时静默且**不动剪贴板**，理由见 cutSelectedSubtrees）。
 */
export function cutSelectedNodes(view: PasteClipboardHost): void {
	const subtrees = cutSelectedSubtrees(view.mindMap);
	if (subtrees.length === 0) {
		return;
	}
	view.scheduleSave();
	writeOutline(view.lang, serializeSubtreesToOutline(subtrees, view.app), null);
}

/**
 * 菜单入口的粘贴（右键「粘贴为子节点」/ 空白处「粘贴节点」）：
 * 没有 paste 事件可用，只能异步读系统剪贴板。
 *
 * @param target 落点（`null` = 挂到渲染根下，与图片粘贴的未选中降级同构）
 */
export function pasteClipboardIntoNode(
	view: PasteClipboardHost,
	target: MindMapNode | null,
): void {
	// 读剪贴板是异步的：等待期间可能换文件/重建引擎，落点属于**旧树**，
	// 插入会静默落空（与 view-dnd / view-paste 同款「会话所属引擎」守卫）
	const engine = view.mindMap;
	void readClipboardText().then((text) => {
		// null = 读失败（权限/环境），'' = 剪贴板为空：两者都是「没东西可粘」，
		// 但原因不同，提示分开（避免「复制了却没粘上」无从判断）
		if (text === null) {
			new Notice(t(view.lang, 'common.clipboardError'));
			return;
		}
		if (text.trim() === '') {
			new Notice(t(view.lang, 'common.clipboardEmpty'));
			return;
		}
		if (view.mindMap !== engine) {
			return;
		}
		insertOutline(view, target, text);
	});
}

/**
 * 键盘/画布粘贴事件入口（`paste` 事件自带 `clipboardData`）。
 *
 * 让位（返回 `false`、不接管）的情形——接管会破坏既有语义：
 * - 事件目标是输入类元素（引擎节点文本编辑框是 contenteditable、内联编辑器、
 *   弹窗输入框）：那里的粘贴必须粘贴文本；
 * - 有节点正处于编辑态（同上，事件目标可能是编辑框内的子元素）；
 * - 剪贴板里没有文本（图片粘贴等）：提前返回，交给图片分支。
 *
 * @returns 是否已接管（true 时调用方不应再处理同一事件）
 */
export function pasteFromClipboardEvent(
	view: PasteClipboardHost,
	event: ClipboardEvent,
): boolean {
	if (isTextEntryTarget(event.target)) {
		return false;
	}
	// 判定顺序：先看「有没有文本可粘」再看编辑态——无文本时（图片粘贴等）
	// 连引擎编辑态都不必探查，尽早交回调用方
	const text = event.clipboardData?.getData('text/plain') ?? '';
	if (text.trim() === '') {
		return false; // 不是文本粘贴（图片走 setupPasteHandler 的图片分支）
	}
	if (isAnyNodeEditing(view.mindMap)) {
		return false;
	}
	event.preventDefault();
	insertOutline(view, getActiveNode(view.mindMap), text);
	return true;
}

/**
 * 引擎快捷键前置钩子（`beforeShortcutRun`，见 `CreateMindMapOptions`）。
 *
 * ⚠ 引擎对**每个**快捷键都会调用本函数，非剪贴板键必须返回 `false` 放行
 * （Tab / Enter / Ctrl+数字 等既有快捷键否则一起失效）。本函数被调用本身还依赖
 * 引擎的前置闸门——该闸门已由插件扩宽到「画布内任意目标」（见
 * engine/mindmap.shortcutGateAllows），故焦点落在自绘内容里的按钮/锚点时三键
 * 仍然生效。
 *
 * `Ctrl+V` 也返回 `true`：取消**引擎**的粘贴（它会按自己的规则把剪贴板内容
 * 拆成节点、并把 JSON 写回系统剪贴板），浏览器 `paste` 事件照常派发，由
 * `pasteFromClipboardEvent` 统一落点。
 */
export function handleClipboardShortcut(
	view: PasteClipboardHost,
	key: string,
): boolean {
	switch (key) {
		case 'Control+c':
			copySelectedNodes(view);
			return true;
		case 'Control+x':
			cutSelectedNodes(view);
			return true;
		case 'Control+v':
			return true;
		default:
			return false;
	}
}

/** 解析剪贴板文本为子树并插入落点（菜单与事件两条入口的共用实现） */
function insertOutline(
	view: PasteClipboardHost,
	target: MindMapNode | null,
	text: string,
): void {
	const subtrees = parseMdOutlineFragment(text);
	if (subtrees.length === 0) {
		new Notice(t(view.lang, 'common.clipboardEmpty'));
		return;
	}
	// 落点：选中节点 ?? 渲染根（未选中时的降级与图片粘贴同构）
	const parent = target ?? getRenderRoot(view.mindMap);
	if (!insertSubtreesAsChildren(view.mindMap, parent, subtrees)) {
		new Notice(t(view.lang, 'common.notLoaded'));
		return;
	}
	view.scheduleSave();
}

/**
 * 写剪贴板并按需提示：失败提示与读取失败同一文案（同一根因一种呈现）。
 *
 * @param noticeKey 写入成功后的提示文案；`null` = 静默（剪切：节点已从画面消失，
 *   提示反而是噪音——见 cutSelectedNodes）
 */
function writeOutline(
	lang: Language,
	outline: string,
	noticeKey: TranslationKey | null,
): void {
	void writeClipboardText(outline).then((ok) => {
		if (!ok) {
			new Notice(t(lang, 'common.clipboardError'));
			return;
		}
		if (noticeKey) {
			new Notice(t(lang, noticeKey));
		}
	});
}
