/**
 * 视图内快捷键处理器（scope 注册点仍在 view.ts 的 register 块）。
 *
 * 目前只承载 F2「编辑当前节点」——它需要判定（输入中让位 / 已在编辑忽略 /
 * 无激活节点仍吞键）。`Mod+F`（搜索）与 `Mod+Z`/`Mod+Shift+Z`/`Mod+Y`
 * （引擎撤销/重做）在 view.ts 内联注册：单条命令转发，无分支。
 */
import { getActiveNode, isEditingText, startNodeTextEdit } from '../mindmap';
import type { ViewEngineContext } from './view-context';

/** 文本输入类目标（搜索框/弹窗输入/引擎文本编辑框）：F2 让位，不劫持 */
function isTextEntryTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) {
		return false;
	}
	if (el.isContentEditable) {
		return true;
	}
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * F2：编辑当前激活节点的文本。
 *
 * 引擎自身也绑了 F2（TextEdit 插件的 `keyCommand.addShortcut('F2')`），但它的
 * `onKeydown` 前置判定要求事件目标为 `document.body`，且
 * `enableShortcutOnlyWhenMouseInSvg` 默认 true（指针须在画布内）——点击节点后
 * 往往不满足，故引擎的 F2 时灵时不灵。这里由视图 scope 接管：
 * - 已接管即阻断冒泡，避免引擎的 window 级监听再触发一次（它会先 hide 再
 *   show，编辑框闪烁并丢光标）；
 * - 返回 false 让 Obsidian 认为已消费，否则核心 F2「重命名文件」会接手；
 * - 正在编辑文本时忽略（吞键但不重开），避免打断输入；
 * - 输入框内让位（返回 true = 未接管），F2 交回输入框与核心。
 */
export function handleEditNodeHotkey(
	view: ViewEngineContext,
	evt: KeyboardEvent,
): boolean {
	if (isTextEntryTarget(evt.target)) {
		return true;
	}
	evt.preventDefault();
	evt.stopPropagation();
	const mindMap = view.mindMap;
	if (!mindMap || isEditingText(mindMap)) {
		return false;
	}
	const node = getActiveNode(mindMap);
	if (node) {
		startNodeTextEdit(mindMap, node);
	}
	return false;
}
