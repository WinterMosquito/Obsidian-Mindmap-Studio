/**
 * 节点内联编辑（自绘/富节点的**原文**编辑器）。
 *
 * ## 存在理由与定位
 * 引擎编辑框（`render/TextEdit`）对自绘节点静默 no-op——`show()` 首行即
 * `if (node.isUseCustomNodeContent()) return`，且定位/取值依赖 `node._textData`
 * （自绘节点没有该结构）。此前自绘节点只能走弹窗（`ui/modal-text`）。
 * 2026-09-28 用户裁决方案 A：**不改 vendor（零补丁）**，插件侧覆盖层编辑器；
 * 交互对齐 Obsidian 官方 Canvas（help: Plugins/Canvas「Edit a card」）：
 * 双击进入编辑、点击卡片外停止、`Escape` 停止编辑——三入口（双击 / F2 /
 * 右键「编辑文本」）共用 `view-node-actions.editNodeText` 分流到本模块。
 * 「单击选中后直接键入」**不启用**（裁决：仅单击选中不可编辑）。
 *
 * ## 编辑对象 = 文件里那一行原文
 * 预填 `composeNodeContent`（下次写盘会写出的内容，含 `[[ ]]`/URL/续行——
 * 与序列化输出同源，勿另抄）；提交 `applyRawNodeContent`（重解析 → 行内字段
 * 整体重建 → 未编辑态 ⇒ 保存逐字写回）。**统一原文、无别名分流**（2026-09-28
 * 裁决）：纯链接节点也直接改 `[[路径|别名]]` 原文；别名模式与实时预览仍只在
 * 弹窗（备选入口：右键「在弹窗中编辑」，见 `editNodeTextInModal`）。
 *
 * ## 键盘语义（2026-09-28 裁决；与弹窗的差异在此登记）
 * - `Enter` / `Mod+Enter` / `Tab` = 提交；`Escape` = **停止并保留**（＝提交，
 *   对齐官方 Canvas 措辞；本项目弹窗的 Esc 是「取消」，两者**有意不同**）；
 * - `Shift+Enter` = 换行（多行节点：列表续行/段落）；`Alt+Enter` 让位；
 * - 点击编辑器外（document `mousedown`，capture）与画布滚轮（引擎 `mousewheel`，
 *   对齐引擎编辑框「滚轮平移即结束编辑」）= 提交；
 * - **无「取消还原」路径**（与官方 Canvas、引擎编辑框的提交语义一致）。
 * - IME：组合输入中（`isComposing` / `Process`）一律不解释按键，回车选词不误提交。
 *
 * ## 生命周期与会话守卫
 * - 会话按**引擎实例**登记（WeakMap）：多视图（多标签）可各自编辑且互不干扰；
 *   同一引擎重复打开前先提交既有会话（对齐引擎 `show()` 的「先结束当前编辑」）；
 * - 定位取自绘内容盒的屏幕矩形；字体和内边距取该盒的实际样式并按画布缩放。
 *   无内容盒时才回退节点 group。底色沿用节点（透明节点取画布），不固定白底。
 *   引擎 `scale` 与 `node_tree_render_end` 时重定位（节点已不在树 → 提交关闭）；
 * - 视图 `onClose` 与**引擎重建前**（view.ts）主动提交关闭——输入不丢（设置变更
 *   /换文件重建引擎会让节点对象失效，重建前必须落数据）；提交时校验「会话所属
 *   引擎 === 视图当前引擎」，引擎已重建的残留会话丢弃（重建路径已提前提交）。
 *
 * ## 为什么是 textarea（而非 contenteditable）
 * 编辑对象是**纯文本原文**：textarea 原生支持多行/IME/粘贴/撤销栈与滚动，无需
 * HTML 转义与光标 API。骨架/样式/尺寸/局部输入由 ui/node-editor 内聚管理，
 * 外观仍全内联；本模块只编排节点会话与引擎跟随，共享写回在 node-content-write。
 * 编辑会话的引擎监听在提交时解绑，不累积已关闭编辑器的闭包（K208）。
 */
import { t } from '../../core/i18n';
import { EventBinder } from '../../core/event-binder';
import { getNodeGroupEl, getDrawTransform, isEditingText, readNodeEditorAppearance, hideNodeForEditing } from '../../engine/mindmap';
import { composeNodeContent } from '../../markdown/md-serialize';
import type { MdNodeData } from '../../core/node-data';
import type { MindMap, MindMapNode } from '../../core/engine-types';
import type { ViewNodeEditContext } from '../view/view-context';
import { NODE_INLINE_CONTENT_CLASS } from '../../core/constants';
import { NodeEditor } from '../../ui/node-editor/node-editor';
import { applyRawNodeContent } from '../content/node-content-write';

// 兼容原调用入口；写回实现与按键判定均只有一份。
export { applyRawNodeContent } from '../content/node-content-write';
export { resolveInlineEditKey } from '../../domain/node-edit-key';

interface InlineEditorSession {
	mindMap: MindMap;
	node: MindMapNode;
	editor: NodeEditor;
	initialValue: string;
	active: boolean;
	hiddenGroup: Element | null;
	restoreGroup: (() => void) | null;
	events: EventBinder;
}

/** 每个视图引擎至多一个编辑会话；文档会话/保存管线仍由既有服务持有。 */
const sessions = new WeakMap<MindMap, InlineEditorSession>();

export function isInlineNodeEditing(mindMap: MindMap | null): boolean {
	return !!mindMap && sessions.has(mindMap);
}

export function isAnyNodeEditing(mindMap: MindMap | null): boolean {
	return isEditingText(mindMap) || isInlineNodeEditing(mindMap);
}

export function openNodeInlineEditor(view: ViewNodeEditContext, node: MindMapNode): void {
	const mindMap = view.mindMap;
	if (!mindMap) return;
	commitSession(view, sessions.get(mindMap) ?? null);
	const groupEl = getNodeGroupEl(node);
	const doc = groupEl?.ownerDocument;
	if (!doc) return;
	const initialValue = composeNodeContent(node.getData() as MdNodeData, view.app);
	const editor = new NodeEditor(doc, {
		value: initialValue,
		label: t(view.lang, 'modal.text.title'),
		onInput: () => placeEditor(session, view),
		onCommit: () => commitSession(view, session),
	});
	const session: InlineEditorSession = {
		mindMap, node, editor, initialValue, active: true,
		hiddenGroup: null, restoreGroup: null, events: new EventBinder(),
	};
	sessions.set(mindMap, session);
	// 引擎事件只属于本次编辑；结束编辑后不再持有旧节点或组件。
	for (const event of ['scale', 'node_tree_render_end']) {
		session.events.onEngine(mindMap, event, () => placeEditor(session, view));
	}
	session.events.onEngine(mindMap, 'mousewheel', () => commitSession(view, session));
	placeEditor(session, view);
	editor.focusAtEnd();
}

/** 防腐层读取引擎/节点，组件只接收用于呈现的屏幕几何与样式。 */
function placeEditor(session: InlineEditorSession, view: ViewNodeEditContext): void {
	if (!session.active) return;
	const target = getNodeGroupEl(session.node);
	if (!target) {
		commitSession(view, session);
		return;
	}
	const content = target.querySelector?.<HTMLElement>(`.${NODE_INLINE_CONTENT_CLASS}`);
	const rect = (content ?? target).getBoundingClientRect();
	const scale = getDrawTransform(session.mindMap).scaleX;
	const computed = content?.ownerDocument.defaultView?.getComputedStyle(content);
	const appearance = readNodeEditorAppearance(session.mindMap, session.node);
	session.editor.updateLayout({
		rect, scale, computed, fixedWidth: content?.style?.width ?? '',
		appearance: {
			background: appearance.background,
			color: computed?.color || appearance.color,
			borderRadius: `${appearance.borderRadius * scale}px`,
			boxShadow: appearance.focusShadow,
		},
	});
	if (session.hiddenGroup !== target && typeof target.setAttribute === 'function') {
		restoreNodeGroup(session);
		session.hiddenGroup = target;
		session.restoreGroup = hideNodeForEditing(target);
	}
}

function restoreNodeGroup(session: InlineEditorSession): void {
	session.restoreGroup?.();
	session.restoreGroup = null;
	session.hiddenGroup = null;
}

/** 视图关闭/换文件/引擎重建之前调用；必须早于提交闸关闭，保留最后一次输入。 */
export function closeInlineEditor(view: ViewNodeEditContext): void {
	if (view.mindMap) commitSession(view, sessions.get(view.mindMap) ?? null);
}

/** 先摘会话/解绑/恢复显示，再销毁 UI；引擎仍是原实例且值变了才写回。 */
function commitSession(view: ViewNodeEditContext, session: InlineEditorSession | null): void {
	if (!session || !session.active) return;
	const { mindMap, node, editor, initialValue } = session;
	session.active = false;
	sessions.delete(mindMap);
	session.events.destroy();
	restoreNodeGroup(session);
	const value = editor.value;
	editor.dispose();
	if (view.mindMap !== mindMap || value === initialValue) return;
	applyRawNodeContent(view, node, value);
}
