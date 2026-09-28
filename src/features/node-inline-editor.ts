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
 * - 定位取节点 group 的 `getBoundingClientRect()`（屏幕坐标，含缩放/平移）；
 *   引擎 `scale` 与 `node_tree_render_end` 时重定位（节点已不在树 → 提交关闭）；
 * - 视图 `onClose` 与**引擎重建前**（view.ts）主动提交关闭——输入不丢（设置变更
 *   /换文件重建引擎会让节点对象失效，重建前必须落数据）；提交时校验「会话所属
 *   引擎 === 视图当前引擎」，引擎已重建的残留会话丢弃（重建路径已提前提交）。
 *
 * ## 为什么是 textarea（而非 contenteditable）
 * 编辑对象是**纯文本原文**：textarea 原生支持多行/IME/粘贴/撤销栈与滚动，无需
 * HTML 转义与光标 API；外观 100% 内联（零 styles.css 依赖，同 K91 口径），
 * 写法用 `Object.assign(el.style, 表)`（obsidianmd/no-static-styles-assignment
 * 只拦字面量直赋，见 K91 ⑩）。
 */
import { t } from '../core/i18n';
import {
	getNodeGroupEl,
	isEditingText,
	markNodeNeedLayout,
} from '../engine/mindmap';
import {
	ensureDefaultImageSizes,
	resolveImagePath,
	walkImageSizeCorrections,
} from '../media/images-path';
import { applyRawToNode } from '../markdown/md-line-write';
import { composeNodeContent } from '../markdown/md-serialize';
import type { MdNodeData } from '../core/node-data';
import type { MindMap, MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { ViewNodeEditContext } from './view-context';

/** 编辑器最小/最大高度（像素）：节点矮也不小于 40；内容多不超 240（内部滚动） */
const MIN_EDITOR_HEIGHT = 40;
const MAX_EDITOR_HEIGHT = 240;
/** 编辑器最小宽度（像素）：短文本节点也保证可输入 */
const MIN_EDITOR_WIDTH = 160;

/** 编辑器类名（探针断言与用户自定义 CSS 的钩子；外观本身全内联） */
const EDITOR_CLASS = 'mindmap-node-inline-editor';

/**
 * 编辑器基态样式（**全内联**，零 styles.css 依赖）。
 * 用 `Object.assign(el.style, 表)` 整体写入——逐条 `el.style.X = '字面量'` 会触发
 * `obsidianmd/no-static-styles-assignment`（合规写法与理由见 K91 ⑩）。
 * z-index 与引擎编辑框同口径（`nodeTextEditZIndex` 默认 3000）。
 */
const EDITOR_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'fixed',
	zIndex: '3000',
	boxSizing: 'border-box',
	margin: '0',
	padding: '4px 6px',
	border: '1px solid var(--interactive-accent)',
	borderRadius: '6px',
	background: 'var(--background-primary)',
	color: 'var(--text-normal)',
	fontFamily: 'inherit',
	fontSize: '14px',
	lineHeight: '1.4',
	resize: 'none',
	overflowY: 'auto',
	outline: 'none',
	boxShadow: 'var(--shadow-s)',
	whiteSpace: 'pre-wrap',
	wordBreak: 'break-word',
};

/** 键盘动作（纯函数判定，见下方裁决表） */
export type InlineEditKeyAction = 'commit' | 'newline' | 'none';

/**
 * 按键 → 动作（纯函数，供单测直测；IME 组合态由调用方先行短路）。
 *
 * 表（2026-09-28 裁决）：`Enter`/`Mod+Enter`/`Tab`/`Escape` = 提交
 * （Esc 为「停止并保留」）；`Shift+Enter` = 换行；`Alt+Enter` 与其他键 = 让位。
 */
export function resolveInlineEditKey(event: {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}): InlineEditKeyAction {
	if (event.key === 'Enter') {
		if (event.altKey) {
			return 'none';
		}
		if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
			return 'newline';
		}
		return 'commit';
	}
	if (event.key === 'Escape' || event.key === 'Tab') {
		return 'commit';
	}
	return 'none';
}

/** 单次内联编辑会话 */
interface InlineEditorSession {
	mindMap: MindMap;
	node: MindMapNode;
	el: HTMLTextAreaElement;
	/** 预填值（未改动则提交时跳过写盘，对齐弹窗原文模式） */
	initialValue: string;
	/** 会话是否活跃（引擎事件监听会话级失效标记；引擎销毁时 EventBinder 统一清理） */
	active: boolean;
	/** 会话级解绑（document 监听；引擎监听随引擎 EventBinder 生命周期统一清理） */
	detach: () => void;
}

/** 每个引擎实例至多一个活跃会话（多视图各自独立） */
const sessions = new WeakMap<MindMap, InlineEditorSession>();

/** 该引擎当前是否有插件内联编辑会话（编辑态收口，见 isAnyNodeEditing） */
export function isInlineNodeEditing(mindMap: MindMap | null): boolean {
	return !!mindMap && sessions.has(mindMap);
}

/**
 * **任一编辑通道进行中**：引擎编辑框 ∨ 插件内联编辑器。
 *
 * 快捷键让位（F2/Delete）、自动拆分检查、标题重命名的「编辑中稍后」判据
 * 统一走本函数（各调用点勿自行拼接两个判据）。
 */
export function isAnyNodeEditing(mindMap: MindMap | null): boolean {
	return isEditingText(mindMap) || isInlineNodeEditing(mindMap);
}

/**
 * 打开内联编辑器（自绘节点；调用方已确认 `isCustomNodeContent(node)`）。
 * 幂等：该引擎已有会话先提交（对齐引擎 `show()` 的「先结束当前编辑」）。
 */
export function openNodeInlineEditor(
	view: ViewNodeEditContext,
	node: MindMapNode,
): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	commitSession(view, sessions.get(mindMap) ?? null);
	const groupEl = getNodeGroupEl(node);
	const doc = groupEl?.ownerDocument;
	if (!doc) {
		// 节点尚未渲染（无 group DOM）：无定位依据，不打开
		return;
	}
	const data = node.getData() as MdNodeData;
	const initialValue = composeNodeContent(data, view.app);

	// 官方 Elements API 创建（规则 obsidianmd/prefer-create-el）：
	// `doc.body.createEl` 立即挂载，样式/取值在同一同步块内完成，无闪烁
	const el = doc.body.createEl('textarea', {
		cls: EDITOR_CLASS,
		attr: {
			spellcheck: 'false',
			'aria-label': t(view.lang, 'modal.text.title'),
		},
	});
	Object.assign(el.style, EDITOR_STYLES);
	el.value = initialValue;

	/** 点击编辑器外（含拖拽/右键开始）：提交（capture 先于其他处理，
	 * 对齐官方「Select anywhere outside the card to stop editing」） */
	const onDocMouseDown = (event: MouseEvent): void => {
		const target = event.target as Node | null;
		if (target && el.contains(target)) {
			return;
		}
		commitSession(view, session);
	};

	const session: InlineEditorSession = {
		mindMap,
		node,
		el,
		initialValue,
		active: true,
		detach: () => {
			doc.removeEventListener('mousedown', onDocMouseDown, true);
		},
	};
	sessions.set(mindMap, session);

	/** 重定位（节点 group 已随引擎重建/删除时提交关闭） */
	const applyRect = (): void => {
		if (!session.active) {
			return;
		}
		const target = getNodeGroupEl(session.node);
		if (!target) {
			commitSession(view, session);
			return;
		}
		const rect = target.getBoundingClientRect();
		el.style.left = `${Math.floor(rect.left)}px`;
		el.style.top = `${Math.floor(rect.top)}px`;
		el.style.width = `${Math.max(Math.floor(rect.width), MIN_EDITOR_WIDTH)}px`;
		el.style.minHeight = `${MIN_EDITOR_HEIGHT}px`;
		el.style.maxHeight = `${MAX_EDITOR_HEIGHT}px`;
		const height = Math.min(
			Math.max(Math.floor(rect.height), MIN_EDITOR_HEIGHT),
			MAX_EDITOR_HEIGHT,
		);
		el.style.height = `${height}px`;
	};

	// 键盘：IME 组合态短路；语义见 resolveInlineEditKey；事件不外泄
	// （引擎快捷键与 Obsidian scope 快捷键都不应在编辑器内生效）
	el.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (event.isComposing || event.key === 'Process') {
			return;
		}
		const action = resolveInlineEditKey(event);
		if (action === 'none' || action === 'newline') {
			return;
		}
		event.preventDefault();
		commitSession(view, session);
	});
	el.addEventListener('keyup', (event) => {
		event.stopPropagation();
	});
	// 编辑器内点击不冒泡（引擎 body_click / svg_mousedown 语义不受影响）
	el.addEventListener('mousedown', (event) => {
		event.stopPropagation();
	});
	el.addEventListener('click', (event) => {
		event.stopPropagation();
	});
	// 多行自适应（上限内滚动）
	el.addEventListener('input', () => {
		Object.assign(el.style, { height: 'auto' });
		el.style.height = `${Math.min(
			Math.max(el.scrollHeight, MIN_EDITOR_HEIGHT),
			MAX_EDITOR_HEIGHT,
		)}px`;
	});

	doc.addEventListener('mousedown', onDocMouseDown, true);

	// 引擎侧跟随：缩放重定位；整树重建后节点仍在则重定位、已不在则提交关闭；
	// 滚轮（平移/缩放）提交关闭（对齐引擎编辑框「mousewheel → hideEditTextBox」）
	view.engineEvents.onEngine(mindMap, 'scale', () => {
		applyRect();
	});
	view.engineEvents.onEngine(mindMap, 'node_tree_render_end', () => {
		applyRect();
	});
	view.engineEvents.onEngine(mindMap, 'mousewheel', () => {
		commitSession(view, session);
	});

	applyRect();
	el.focus();
	// 光标置末尾（对齐弹窗原文模式的「追加式编辑最常见，避免误输入覆盖整段」）
	el.setSelectionRange(initialValue.length, initialValue.length);
}

/**
 * 提交并关闭该视图引擎上的内联编辑会话（幂等；无会话时 no-op）。
 * 视图 `onClose` 与**引擎重建前**调用（输入必须落数据，见文件头生命周期）。
 */
export function closeInlineEditor(view: ViewNodeEditContext): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	commitSession(view, sessions.get(mindMap) ?? null);
}

/**
 * 会话提交（唯一收口）：摘除会话 → 读值 → 移除元素 → 焦点归还 body →
 * 引擎未变且内容有改动时写回。`value === initialValue` 不写盘（对齐弹窗）。
 */
function commitSession(
	view: ViewNodeEditContext,
	session: InlineEditorSession | null,
): void {
	if (!session || !session.active) {
		return;
	}
	const { mindMap, node, el, initialValue } = session;
	session.active = false;
	sessions.delete(mindMap);
	session.detach();
	const value = el.value;
	el.remove();
	// 焦点归还 body：引擎快捷键（Delete/Tab/F2 等）要求事件目标为 document.body
	el.ownerDocument?.body.focus();
	if (view.mindMap !== mindMap) {
		// 引擎已重建：重建路径已提前提交过，残留会话不再写（防重复/错树）
		return;
	}
	if (value === initialValue) {
		return;
	}
	applyRawNodeContent(view, node, value);
}

/**
 * 原文模式提交：重解析写入 + 图片地址/尺寸校正 + 重渲染 + 保存。
 *
 * 内联编辑器与弹窗原文模式**共用本入口**（搬迁自 view-node-actions，
 * 弹窗分支 import 本函数——避免两个模块互相 import 成环）。
 *
 * 图片：原文里可能新增/更换了引用 —— 库内路径须换成资源地址（与加载期同一入口
 * `resolveImagePath`）；尺寸先填默认值（K97：未设置尺寸一律默认大小），带官方
 * 尺寸参数时异步应用参数尺寸（完成后补一次渲染）。无图片时（绝大多数）不做
 * 任何额外工作。
 */
export function applyRawNodeContent(
	view: ViewNodeEditContext,
	node: MindMapNode,
	raw: string,
): void {
	const data = node.getData() as MdNodeData;
	applyRawToNode(data, raw);
	if (typeof data.image === 'string' && data.image) {
		data.image = resolveImagePath(data.image, view.app);
		// 引擎硬要求 image 节点必有 imageSize（缺失即解构抛错、渲染链中断）：
		// 原本无图的节点被编辑成图片时没有旧值可沿用，先填默认值再渲染
		//（K97：未设置尺寸一律默认大小，故默认值即最终尺寸）；带官方尺寸
		// 参数（![[图|300]]）时异步应用参数尺寸（ensureDefaultImageSizes 注释
		// 有 vendor 证据）
		ensureDefaultImageSizes({ data, children: [] });
		void walkImageSizeCorrections({ data, children: [] }).then(() => {
			markNodeNeedLayout(node);
			view.mindMap?.render();
		});
	}
	markNodeNeedLayout(node);
	view.mindMap?.render();
	view.scheduleSave();
}
