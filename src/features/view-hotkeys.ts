/**
 * 视图内快捷键注册与处理（scope 注册点在 view.ts 的 onOpen）。
 *
 * 承载两类快捷键：
 * - `Mod+F`（搜索）、`Mod+Z`/`Mod+Shift+Z`/`Mod+Y`（引擎撤销/重做）——单条命令
 *   转发，无判定分支；
 * - `F2`（编辑当前节点）——需要判定（输入中让位 / 已在编辑忽略 / 无激活节点
 *   仍吞键），见 handleEditNodeHotkey。
 */
import { Platform, Scope } from 'obsidian';
import { ENGINE_COMMANDS, getActiveNode, isEditingText } from '../engine/mindmap';
import { deleteActiveNode, editNodeText } from './view-node-actions';
import { fitToScreen, zoomToSelection } from './view-viewport';
import type { ViewNodeEditContext } from './view-context';

/**
 * 快捷键注册所需的最小视图面：引擎 + 编辑入口（app/lang/save）+ 搜索栏入口 +
 * 视图作用域宿主。
 *
 * `View.scope` 自 Obsidian 1.5.7 起**默认为 null**，官方要求视图自行赋值
 * （`this.scope = new Scope(this.app.scope)`）——不赋值时 `scope?.register(...)`
 * 静默失效，视图内所有快捷键（F2 / Mod+F / Mod+Z…）全部无效。
 */
export interface ViewHotkeyHost extends ViewNodeEditContext {
	/** 打开搜索栏（Mod+F） */
	openSearchBar(): void;
	/** 视图作用域（可能为 null，见上方说明） */
	scope: Scope | null;
	/** 引擎画布容器（缩放手势取画布尺寸用；`Shift+1/2`） */
	readonly canvasEl: HTMLElement | null;
}

/**
 * 确保视图拥有作用域（幂等）：为空时按官方示例创建，父作用域取 `app.scope`。
 * 注册快捷键前必须先过这一关，否则按键永远匹配不到。
 */
export function ensureViewScope(view: ViewHotkeyHost): Scope {
	if (!view.scope) {
		view.scope = new Scope(view.app.scope);
	}
	return view.scope;
}

/**
 * 注册视图内快捷键（视图 onOpen 时调用一次）。
 * 生命周期由视图作用域承担：核心经 workspace 作用域链在「本视图为活动叶」时
 * 转发按键（`workspace.scope` 链到 `activeLeaf.view.scope`）。
 */
export function registerViewHotkeys(view: ViewHotkeyHost): void {
	const scope = ensureViewScope(view);
	scope.register(['Mod'], 'f', () => {
		view.openSearchBar();
		return false;
	});
	// 对齐 Obsidian 官方编辑约定（help: Editing shortcuts）：
	// Undo = Mod+Z；Redo = Mod+Shift+Z（macOS 官方仅此一种）或 Mod+Y
	// （Windows/Linux）。属系统级编辑快捷键（非命令默认热键，不违反社区
	// 规范的 no-default-hotkeys），引擎自身未绑定，此处接管并阻止冒泡。
	scope.register(['Mod'], 'z', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.BACK);
		return false;
	});
	scope.register(['Mod', 'Shift'], 'z', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD);
		return false;
	});
	if (!Platform.isMacOS) {
		// macOS 官方未提供 Mod+Y 重做（Cmd+Y 是其他语义），不注册以免冲突
		scope.register(['Mod'], 'y', () => {
			view.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD);
			return false;
		});
	}
	// F2 = 编辑当前激活节点（引擎自带 F2 判定苛刻，见 handleEditNodeHotkey）
	scope.register([], 'F2', (evt) => handleEditNodeHotkey(view, evt));
	// 删除选中节点：`Delete` / `Backspace`（官方 Canvas 同款：Backspace 或
	// Delete 删除选中卡片，见 en/Plugins/Canvas.md）。引擎未绑定这两个键，
	// 此前只能走右键菜单/工具栏。
	scope.register([], 'Delete', (evt) => handleDeleteNodeHotkey(view, evt));
	scope.register([], 'Backspace', (evt) => handleDeleteNodeHotkey(view, evt));
	// 画布缩放：官方 Canvas 的 `Shift+1`（缩放至全览）与 `Shift+2`（缩放至选区）。
	// 输入类目标让位（返回 true）：`Shift+1` / `Shift+2` 在输入框里是打 `!` / `@`，
	// 不能拿来缩放画布。
	scope.register(['Shift'], '1', (evt) => {
		if (isTextEntryTarget(evt.target)) {
			return true;
		}
		fitToScreen(view);
		return false;
	});
	scope.register(['Shift'], '2', (evt) => {
		if (isTextEntryTarget(evt.target)) {
			return true;
		}
		// 空选区时 `Shift+2` 无意义 → 回落到全览（与官方「没有选中就没有选区」一致）
		if (!zoomToSelection(view)) {
			fitToScreen(view);
		}
		return false;
	});
}

/**
 * `Delete` / `Backspace`：删除当前激活节点（对齐官方 Canvas）。
 *
 * 让位（返回 true、不吞键）的三种情形——吞掉会破坏既有语义：
 * - 焦点在输入框/文本编辑中（`Backspace` 是退格）；
 * - 无激活节点（交回核心，避免把「什么都没选时的 Delete」变成静默 no-op）。
 */
function handleDeleteNodeHotkey(
	view: ViewHotkeyHost,
	evt: KeyboardEvent,
): boolean {
	if (isTextEntryTarget(evt.target)) {
		return true;
	}
	const mindMap = view.mindMap;
	if (!mindMap) {
		return true;
	}
	if (isEditingText(mindMap)) {
		return true;
	}
	if (!getActiveNode(mindMap)) {
		return true;
	}
	evt.preventDefault();
	evt.stopPropagation();
	deleteActiveNode(view);
	return false;
}

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
 * F2：**未选中节点时＝重命名文件（Obsidian 官方语义），选中节点时＝编辑该节点**。
 *
 * 引擎自身也绑了 F2（TextEdit 插件的 `keyCommand.addShortcut('F2')`），但它的
 * `onKeydown` 前置判定要求事件目标为 `document.body`，且
 * `enableShortcutOnlyWhenMouseInSvg` 默认 true（指针须在画布内）——点击节点后
 * 往往不满足，故引擎的 F2 时灵时不灵。这里由视图 scope 接管：
 * - 有激活节点 → 编辑它，并阻断冒泡（否则引擎 window 级 F2 再 hide+show 一次，
 *   编辑框闪烁并丢光标）；中心节点被选中时同样如此——而中心节点的文本就是文件名，
 *   与 Obsidian「F2 = 重命名文件」的结果一致（见 `view-title-renamer`）；
 * - **无激活节点 → 让位**（返回 true、不阻断）：F2 归 Obsidian 核心＝重命名当前文件。
 *   2026-09-15 对齐官方语义——此前会无条件吞键，等于在导图视图里**用不了官方 F2**；
 * - 正在编辑文本时忽略（吞键但不重开），避免打断输入；
 * - 输入框内让位（返回 true = 未接管），F2 交回输入框与核心。
 */
export function handleEditNodeHotkey(
	view: ViewNodeEditContext,
	evt: KeyboardEvent,
): boolean {
	if (isTextEntryTarget(evt.target)) {
		return true;
	}
	const mindMap = view.mindMap;
	// 引擎未就绪：吞键（无处可编辑，也不该让核心在渲染未完成时改名）
	if (!mindMap) {
		evt.preventDefault();
		evt.stopPropagation();
		return false;
	}
	if (isEditingText(mindMap)) {
		evt.preventDefault();
		evt.stopPropagation();
		return false;
	}
	const node = getActiveNode(mindMap);
	if (!node) {
		// 未选中节点：交回 Obsidian（官方 F2 = 重命名文件）
		return true;
	}
	evt.preventDefault();
	evt.stopPropagation();
	editNodeText(view, node);
	return false;
}
