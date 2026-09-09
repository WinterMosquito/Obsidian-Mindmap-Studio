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
import {
	ENGINE_COMMANDS,
	getActiveNode,
	isEditingText,
	startNodeTextEdit,
} from '../mindmap';
import type { App } from 'obsidian';
import type { ViewEngineContext } from './view-context';

/**
 * 快捷键注册所需的最小视图面：引擎 + 搜索栏入口 + 视图作用域宿主。
 *
 * `View.scope` 自 Obsidian 1.5.7 起**默认为 null**，官方要求视图自行赋值
 * （`this.scope = new Scope(this.app.scope)`）——不赋值时 `scope?.register(...)`
 * 静默失效，视图内所有快捷键（F2 / Mod+F / Mod+Z…）全部无效。
 */
export interface ViewHotkeyHost extends ViewEngineContext {
	/** 打开搜索栏（Mod+F） */
	openSearchBar(): void;
	/** 视图作用域（可能为 null，见上方说明） */
	scope: Scope | null;
	readonly app: App;
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
