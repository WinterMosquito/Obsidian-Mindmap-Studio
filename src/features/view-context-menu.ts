/**
 * 右键菜单：节点右键完整菜单与画布空白处通用菜单。从 view.ts 拆出。
 * 菜单动作（链接/图片/删除等）委托给 view-node-actions.ts；
 * 剪贴板三项（复制节点 / 粘贴为子节点 / 粘贴节点）走 view-clipboard——
 * 那里是系统剪贴板（Markdown 文本）的**唯一**收口，勿在本文件另开一条。
 *
 * 另承载**外观两项的二级菜单**（布局 / 配色，`addCascadingMenu`）：两者的父项与
 * 图标一致，但「配色」按右键落点分两义——落在**节点**上改该节点/子树的颜色
 * （写正文的 `%%#hex%%`，见 view-node-color），落在**空白**处改整篇方案
 * （`data.json`），中心主题按空白处理（它没有正文行）。
 * 边框 / 连线不在这里（它们在右缘竖栏的开关按钮上）。
 *
 * 另承载**右键拖拽＝框选**的收尾（2026-11-03）：引擎 `select` 插件在右键拖动时画框
 * 并落地选中，而 `contextmenu` 在 `mouseup` 之后才来——按「按下点 → 菜单点」的位移
 * 区分手势：拖拽（>5px）不弹空白菜单，改弹**选区菜单**（概要 / 复制）；单击照旧。
 */
import { Menu, Notice } from 'obsidian';
import {
	ENGINE_COMMANDS,
	findNodeByDom,
	getActiveNodes,
	getNodeDataString,
	getRenderRoot,
	isSummaryNode,
	resetZoom,
	setActiveNodes,
	siblingMoveBlocker,
} from '../engine/mindmap';
import {
	isCustomPaletteValue,
	LAYOUT_OPTIONS,
	PALETTE_OPTIONS,
} from '../core/constants';
import { COLOR_DIRECTIVE_NONE } from '../domain/color';
import {
	addCascadingMenu,
	addCustomColorItem,
	closeOpenMenu,
	showExclusiveMenu,
} from '../ui/menu-submenu';
import {
	applyBranchColors,
	applyNodeColor,
	effectiveNodeColorOf,
	hasBranchLayer,
	nodeColorOptions,
} from './view-node-color';
import { fitToScreen } from './view-viewport';
import {
	addImageToActiveNode,
	addLinkToActiveNode,
	clearNodeHyperlink,
	createChildNodeBelow,
	deleteActiveNode,
	editNodeText,
	editNodeTextInModal,
	moveNodeDown,
	moveNodeUp,
	removeNodeImage,
	removeNodeText,
} from './view-node-actions';
import {
	copySelectedNodes,
	pasteClipboardIntoNode,
} from './view-clipboard';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { startRelationPicking } from './view-node-relation';
import { addSummaryItem, showSummaryMenu } from './view-node-summary';
import { nodeLink } from './view-wikilink';
import { arrangeMindMap } from './view-toolbar';
import { t, tf, type TranslationKey } from '../core/i18n';
import { writeClipboardText } from '../platform/clipboard';
import { renderHyperlink } from '../markdown/md-serialize';
import type { MdNodeData } from '../core/node-data';
import type { MindMapNode } from '../core/engine-types';
import type { MindMapViewContext } from './view-context';

/** 「勾选当前值」的单值级联菜单（布局用；配色两态见下方两个专用构建） */
function addChoiceMenu(
	menu: Menu,
	view: MindMapViewContext,
	spec: {
		title: TranslationKey;
		icon: string;
		current: string;
		options: readonly { value: string; label: TranslationKey }[];
		onPick: (value: string) => void;
	},
): void {
	addCascadingMenu(menu, view.lang, {
		title: spec.title,
		icon: spec.icon,
		build: (submenu) => {
			for (const option of spec.options) {
				submenu.addItem((item) =>
					item
						.setTitle(t(view.lang, option.label))
						.setChecked(option.value === spec.current)
						.onClick(() => spec.onPick(option.value)),
				);
			}
		},
	});
}

/**
 * 布局（空白右键与节点右键共用）。
 *
 * 切换会**写文件属性**（异步且可能失败）：写盘失败由 `applyLayout` 自己提示，
 * 这里只需不等待——菜单收起后画面会随写盘结果更新。**但要兜住拒绝**：应用引擎
 * 那一步（`setLayout` / 竖栏重建）不归它的 try 管，且此刻 leaf 可能已被关闭，
 * `void` 掉的 Promise 会变成未处理拒绝。
 */
function addLayoutMenu(menu: Menu, view: MindMapViewContext): void {
	addChoiceMenu(menu, view, {
		title: 'toolbar.layout',
		icon: 'layout-dashboard',
		current: view.resolveLayout(),
		options: LAYOUT_OPTIONS,
		onPick: (value) => {
			void view.applyLayout(value).catch((error: unknown) => {
				console.error('切换布局失败:', error);
			});
		},
	});
}

/**
 * 空白画布的「配色」：改**整篇**方案（写 `data.json` 的 `viewState[路径].palette`）。
 *
 * 预设项（`PALETTE_OPTIONS`，现为 10 项）之后多一项「自定义」：值是一个十六进制，
 * 同样按文件记；读取侧 `normalizePalettePreference` 保留它，渲染侧由
 * `mindmap-palette` 派生五档色板。
 */
function addPaletteMenu(menu: Menu, view: MindMapViewContext): void {
	const current = view.resolvePreference('palette');
	const custom = isCustomPaletteValue(current);
	addCascadingMenu(menu, view.lang, {
		title: 'toolbar.palette',
		icon: 'palette',
		build: (submenu) => {
			for (const option of PALETTE_OPTIONS) {
				submenu.addItem((item) =>
					item
						.setTitle(t(view.lang, option.label))
						.setChecked(option.value === current)
						.onClick(() => view.applyPalette(option.value)),
				);
			}
			addCustomColorItem(submenu, view.app, view.lang, {
				checked: custom,
				// 预设 id 不是颜色值：带着它预填只会让输入框一打开就报非法
				initial: custom ? current : null,
				onPick: (color) => view.applyPalette(color),
			});
			// 分支配色（2026-11-05）：给「分支层」的每个节点依次写一个主色。
			// 只在确实有多个分支时出现——单链文档没有可分配的对象。
			if (hasBranchLayer(view)) {
				submenu.addSeparator();
				submenu.addItem((item) =>
					item
						.setTitle(t(view.lang, 'palette.branchColors'))
						.setIcon('git-branch')
						.onClick(() => applyBranchColors(view)),
				);
			}
		},
	});
}

/**
 * 节点右键的「配色」：给**这些节点及其子树**上色（写进 Markdown 的 `%%#hex%%`）。
 *
 * 与空白右键的差别是「作用对象」：这里只改正文（节点指令），不动 `data.json`。
 * 首项「默认」＝**回到整篇配色**（必要时由 `applyNodeColor` 落哨兵挡继承，用户
 * 无需知道）；末项「自定义」收十六进制 / RGB。
 *
 * **分组与空白右键的整篇配色完全一致**：默认 + 九个颜色同组（`nodeColorOptions`
 * 只排除「默认」那一套），只在「自定义」前画一条分隔线，两处标题序列逐项相同
 *（节点侧曾多画一条线，2026-10-27 实机指出）。
 *
 * `targets` 是右键时**还没被引擎折叠**的选中集合（见 `rightClickSelection`）。
 *
 * 勾选态取**生效色**（`effectiveNodeColorOf`：自身 → 最近祖先）：只看自身指令会让
 * 「继承父色的节点」勾着「默认」而屏上是彩色。哨兵与「没写指令」共用「默认」这一勾。
 */
function addNodeColorMenu(
	menu: Menu,
	view: MindMapViewContext,
	node: MindMapNode,
	targets: readonly MindMapNode[],
): void {
	const current = effectiveNodeColorOf(node);
	const options = nodeColorOptions();
	// 哨兵是「默认」的落地形态之一 ⇒ 与「没写指令」共享同一个勾选态
	const isDefault = current === null || current === COLOR_DIRECTIVE_NONE;
	const isCustom =
		!isDefault && !options.some((option) => option.color === current);
	addCascadingMenu(menu, view.lang, {
		title: 'toolbar.palette',
		icon: 'palette',
		build: (submenu) => {
			submenu.addItem((item) =>
				item
					.setTitle(t(view.lang, 'menu.color.follow'))
					.setChecked(isDefault)
					.onClick(() => applyNodeColor(view, targets, null)),
			);
			for (const option of options) {
				submenu.addItem((item) =>
					item
						.setTitle(t(view.lang, option.label))
						.setChecked(option.color === current)
						.onClick(() => applyNodeColor(view, targets, option.color)),
				);
			}
			addCustomColorItem(submenu, view.app, view.lang, {
				checked: isCustom,
				// 当前色直接预填：自定义色可微调，预设色也能「从它起手」；
				// 哨兵不是颜色，不预填（输入框留空，等用户给一个 hex / RGB）
				initial: current === COLOR_DIRECTIVE_NONE ? null : current,
				onPick: (color) => applyNodeColor(view, targets, color),
			});
		},
	});
}

/**
 * 节点「联系」（关系连线）：**单击即进入点选模式**，不套二级菜单。
 *
 * 为什么不再用二级菜单（2026-10-30 用户裁决）：它唯一的额外内容是「出边列表」，
 * 而删边/改标签已经有更好的入口——**从线出发**（点线后 `Delete`、右键线「删除
 * 联系」/「编辑联系标签」，见 view-node-relation）。从节点猜「哪条边对应哪个目标」
 * 既要读 id 又要分辨同名，反而绕。同一裁决要求它**不与布局 / 配色同组**：那两项是
 * 视图级外观，联系是结构编辑，观感上不该混在一起。
 *
 * 中心主题（虚拟文档根）没有正文行，指令无处落笔 ⇒ 置灰（与配色同一裁决）。
 */
function addRelationItem(
	menu: Menu,
	view: MindMapViewContext,
	node: MindMapNode,
): void {
	menu.addItem((item) => {
		const entry = item
			.setTitle(t(view.lang, 'nodeRelation.add'))
			.setIcon('git-branch');
		return node.isRoot
			? entry.setDisabled(true)
			: entry.onClick(() => startRelationPicking(view, node));
	});
}

/**
 * 右键按下瞬间的选中集合（按视图持有）。
 *
 * 为什么不在菜单打开时读：引擎的 contextmenu 处理器**先折叠多选**
 * （`clearActiveNodeList` + `active()`，见上游 `MindMapNode.bindEvent`），
 * `node_contextmenu` 发出时 `activeNodeList` 往往只剩被点的那一个。多选后
 * 「配一次色染一支」需要原始集合，故在 `node_mousedown`（右键按下）时留存；
 * 菜单打开即取走并清空，避免下一次右键读到陈旧集合。
 */
const rightClickSelection = new WeakMap<
	object,
	{ node: MindMapNode; nodes: MindMapNode[] }
>();

/**
 * 右键拖拽的起点（画布 capture 记录）：用来区分「右键单击＝菜单」与
 * 「右键拖拽＝框选」（引擎 `select` 插件在右键拖动时画选框并落地选中，2026-11-03 实机复核）。
 *
 * 为什么不能直接问引擎：插件在 `mouseup` 就把 `isSelecting` 复位、选框也移除了，
 * 而 Windows 的 `contextmenu` 在 **mouseup 之后**才派发——那一刻已经问不出
 * 「刚才是不是在拉框」。
 */
const rightDragOrigin = new WeakMap<object, { x: number; y: number }>();

/** 位移超过它才算拖拽（滤掉右键手抖，又不至于让小幅框选失效） */
const RIGHT_DRAG_THRESHOLD_PX = 5;

/**
 * 右键按下**之前**的选中集合（画布 capture 记录）。
 *
 * 引擎在右键按下时就把选中清了（`draw_click`），等到 `contextmenu` 再读只剩空——
 * 用户观感是「我选了 3 个，右键一下全没了」。捕获阶段先留一份，空白右键时用它
 * 复原选中并出选区菜单（2026-11-03）。
 */
const rightPressSelection = new WeakMap<object, MindMapNode[]>();

/** 取走按下前的选中（一次右键只判一次） */
function takeRightPressSelection(view: object): MindMapNode[] {
	const pressed = rightPressSelection.get(view) ?? [];
	rightPressSelection.delete(view);
	return pressed;
}

/**
 * 框选松手后「等选中落地」的暂存：引擎的选中经**防抖的 mousemove** 落地
 * （实测松手后约 150ms 才进 `activeNodeList`，见 K163），`contextmenu` 到达时
 * 常常还读不到任何选中 —— 这一刻不能直接判定「没框到」。
 */
const pendingSelectionMenu = new WeakMap<
	object,
	{ x: number; y: number; timer: number }
>();

/** 等选中落地的上限（实测 150ms 左右落地；超时即放弃，不弹菜单） */
const SELECTION_MENU_WAIT_MS = 250;

/** 取消等待（新的按下 / 已经弹过 / 超时） */
function clearPendingSelectionMenu(view: object): void {
	const pending = pendingSelectionMenu.get(view);
	if (!pending) {
		return;
	}
	pendingSelectionMenu.delete(view);
	window.clearTimeout(pending.timer);
}

/**
 * 记下松手位置，等引擎把选中落地后再弹菜单。
 *
 * 兜底定时器到点也走一次 flush：框出来的刚好就是**原来的选中**时引擎不发
 * `node_active`（选中集没变化），那时仍应把菜单弹出来。
 */
function armSelectionMenu(view: MindMapViewContext, event: MouseEvent): void {
	clearPendingSelectionMenu(view);
	const timer = window.setTimeout(
		() => flushSelectionMenu(view),
		SELECTION_MENU_WAIT_MS,
	);
	pendingSelectionMenu.set(view, { x: event.clientX, y: event.clientY, timer });
}

/**
 * 选中已落地：把挂起的选区菜单弹出来（`node_active` 到达时调用）。
 *
 * 没有挂起、或最终一个可用节点都没选中 ⇒ 什么都不做（框了个空就不该弹菜单）。
 */
function flushSelectionMenu(view: MindMapViewContext): void {
	if (!pendingSelectionMenu.has(view)) {
		return;
	}
	const pending = pendingSelectionMenu.get(view)!;
	clearPendingSelectionMenu(view);
	const selection = getActiveNodes(view.mindMap).filter((item) => !item.isRoot);
	if (selection.length > 0) {
		showSelectionMenu(view, { x: pending.x, y: pending.y }, selection);
	}
}

/**
 * 本次右键从按下到弹出菜单之间是否发生了拖拽（**取用即清**：一次右键只判一次）。
 *
 * 没有起点记录时返回 false（键盘菜单键 / 拖拽结束后才到达的迟到事件）。
 */
function takeRightDrag(view: object, event: MouseEvent): boolean {
	const origin = rightDragOrigin.get(view);
	rightDragOrigin.delete(view);
	if (!origin) {
		return false;
	}
	return (
		Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
		RIGHT_DRAG_THRESHOLD_PX
	);
}

/**
 * 框选松手后的**选区菜单**（右键拖拽 > 5px 时替代空白菜单，2026-11-03）。
 *
 * 只放**作用于整个选中集合**的条目：
 * - 「概要」：`addSummaryItem` 自己按集合算覆盖面（相邻同级 → `概要（覆盖 N 个）`
 *   直接建；跳跃选中 / 跨分支 → `概要…` 进两次点选），标题本身就把数量说清楚了；
 * - 「复制」：`copySelectedNodes` 本就按激活集合工作。
 *
 * **不放删除**：`deleteActiveNode` 只删一个节点，多选下与「删除 3 个」的直觉不符
 * （实机复核 2026-11-03）——真要批量删得先做批量通道，不在本次范围。
 */
function showSelectionMenu(
	view: MindMapViewContext,
	at: { x: number; y: number },
	selection: readonly MindMapNode[],
	withBlankItems = false,
): void {
	const anchor = selection[0];
	if (!anchor) {
		return;
	}
	const menu = new Menu();
	addSummaryItem(menu, view, anchor, selection);
	menu.addItem((item) =>
		item
			// 多选时报数量（与「概要（覆盖 N 个）」同口径）：只写「复制节点」会让
			// 用户不确定复制的是一整个选区还是一个节点
			.setTitle(
				selection.length > 1
					? tf(view.lang, 'menu.copyNodeCount', { count: selection.length })
					: t(view.lang, 'menu.copyNode'),
			)
			.setIcon('copy')
			.onClick(() => copySelectedNodes(view)),
	);
	// 空白处右键（选中还在）时把空白菜单的能力一并给出：用户不该为了「新建节点」
	// 先取消选中。两段之间加分隔线，读起来是「对选区做什么 / 对画布做什么」。
	if (withBlankItems) {
		menu.addSeparator();
		addBlankMenuItems(menu, view);
	}
	showExclusiveMenu(view, menu, at);
}

/** 注册右键菜单监听（引擎重建时随 initMindMap 调用） */
export function setupContextMenu(view: MindMapViewContext): void {
	if (!view.canvasEl || !view.mindMap) {
		return;
	}
	// 右键按下：留存选中集合（此时引擎尚未折叠多选，见 rightClickSelection）
	view.engineEvents.onEngine(
		view.mindMap,
		'node_mousedown',
		(...args: unknown[]) => {
			const node = args[0] as MindMapNode | undefined;
			const event = args[1] as MouseEvent | undefined;
			// 只关心右键：左键的选中态由引擎自己维护，这里不留存
			if (!node || event?.button !== 2) {
				return;
			}
			// 引擎此刻可能已按点击重排选中态，故按「集合是否含目标节点」两路取：
			// 含 → 多选（右键点在选择内）；不含 → 单选（点了新节点，尚未入选择）
			const active = getActiveNodes(view.mindMap);
			rightClickSelection.set(view, {
				node,
				nodes: active.includes(node) ? active : [node],
			});
		},
	);
	// 画布上任意按下（含左键选中 / 拖节点）都收起我们弹出的菜单：引擎在节点上把
	// `mousedown` 吞了，宿主那套「点别处即关闭」收不到事件 ⇒ 不主动关就会一直挂在
	// 屏幕上（K155）。capture 保证在引擎处理之前执行；菜单自身在 body 上，不受影响。
	view.engineEvents.onDom(
		view.canvasEl,
		'pointerdown',
		(event) => {
			closeOpenMenu(view);
			// 新的按下作废上一次挂起的选区菜单（用户已经走开了）
			clearPendingSelectionMenu(view);
			// 右键按下即记起点：拖多远决定「弹菜单」还是「框选」；
			// 同时留一份**按下前**的选中（引擎马上就会清掉它）
			const press = event as MouseEvent;
			if (press.button === 2) {
				rightDragOrigin.set(view, { x: press.clientX, y: press.clientY });
				rightPressSelection.set(view, getActiveNodes(view.mindMap));
			}
		},
		true,
	);
	// 节点右键：引擎对节点 contextmenu 做了 stopPropagation，
	// 事件不会冒泡到画布，必须改用引擎的 node_contextmenu 事件。
	view.engineEvents.onEngine(view.mindMap, 'node_contextmenu', (...args: unknown[]) => {
		const event = args[0] as MouseEvent;
		const node = args[1] as MindMapNode | undefined;
		if (!node) {
			return;
		}
		// 拖拽已在画布 **capture** 阶段被吃掉（见 setupContextMenu 末尾），能走到
		// 这里的一定是「右键单击」，直接开节点菜单。
		showNodeContextMenu(view, event, node);
	});
	// 框选的选中是**防抖落地**的：等到了就把挂起的选区菜单弹出来
	//（`node_active` 由引擎在选中集变化后经 `setTimeout(0)` 派发）
	view.engineEvents.onEngine(view.mindMap, 'node_active', () => {
		flushSelectionMenu(view);
	});
	// 框选松手时鼠标常**正好压在节点上**（画布密集）：节点自己的 contextmenu
	// 处理器会把事件吞掉——既不 emit `node_contextmenu`、也不冒泡到画布（实机
	// 2026-11-03 抓包：只看到 `node_active`，`node_contextmenu` 一次都没来）。
	// 故拖拽必须在**capture 阶段**先吃掉：吞掉事件、改挂选区菜单。
	view.engineEvents.onDom(
		view.canvasEl,
		'contextmenu',
		(event) => {
			const press = event as MouseEvent;
			if (!takeRightDrag(view, press)) {
				return; // 不是拖拽：交给冒泡阶段的节点 / 空白分支
			}
			press.preventDefault();
			press.stopPropagation();
			armSelectionMenu(view, press);
		},
		true,
	);
	// 空白处右键：画布委托。**留住**「命中节点则走节点菜单」这一支——节点自己的
	// contextmenu 处理器**并非无条件** stopPropagation：`readonly` 或 `e.ctrlKey`
	// 时它直接 return（上游 `render/node/MindMapNode.js`），事件会冒泡到画布。
	// macOS 的 Ctrl+左键即走这条路径；删掉该支会让它落到空白菜单（2026-10-15
	// 复核：审计曾判其为死分支，实测依据不足）。
	view.engineEvents.onDom(view.canvasEl, 'contextmenu', (event) => {
		event.preventDefault();
		// 拖拽（框选）已在上面 capture 里判完并 `stopPropagation`：能走到这里的一定
		// 是「单击」，故这里只按落点分派，**不要再判一次手势**——`takeRightDrag`
		// 取用即清，capture 已经消费掉起点，这里恒为 false（写了也只是死分支）。
		const target = event.target as HTMLElement;
		const nodeEl = target.closest<HTMLElement>('.smm-node');
		const node = nodeEl ? findNodeByDom(view.mindMap, nodeEl) : null;
		if (node) {
			showNodeContextMenu(view, event, node);
			return;
		}
		// 空白右键：按下前有多选 ⇒ 弹「选区 + 空白」合并菜单。
		// 引擎在右键按下时清了选中（`draw_click`），用户看到的是「选中没了、菜单里
		// 也没有概要」；这里先把选中复原，再在菜单顶部给出选区操作（2026-11-03）。
		const pressed = takeRightPressSelection(view);
		if (pressed.length > 1) {
			setActiveNodes(view.mindMap, pressed);
			showSelectionMenu(view, { x: event.clientX, y: event.clientY }, pressed, true);
			return;
		}
		showBlankMenu(view, event);
	});
}

/** 空白画布的菜单（新建 / 粘贴 / 视图 / 外观 / 撤销重做） */
function showBlankMenu(view: MindMapViewContext, event: MouseEvent): void {
	const menu = new Menu();
	addBlankMenuItems(menu, view);
	showExclusiveMenu(view, menu, { x: event.clientX, y: event.clientY });
}

/** 空白菜单的条目（合并菜单复用它，避免两份口径漂移） */
function addBlankMenuItems(menu: Menu, view: MindMapViewContext): void {
	// 新建节点（官方 Canvas 空白双击/右键语义）：挂根节点下，占位名可改
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.newNode'))
			.setIcon('plus')
			.onClick(() => {
				const root = getRenderRoot(view.mindMap);
				if (root) {
					createChildNodeBelow(view, root);
				}
			}),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.pasteNode'))
			.setIcon('clipboard')
			.onClick(() => pasteClipboardIntoNode(view, null)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.resetZoom'))
			.setIcon('rotate-ccw')
			.onClick(() => resetZoom(view.mindMap)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'command.fitCanvas'))
			.setIcon('maximize')
			.onClick(() => fitToScreen(view)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'toolbar.arrange'))
			.setIcon('sparkles')
			.onClick(() => arrangeMindMap(view)),
	);
	// 外观四项拆两处入口：**布局 / 配色**在此处，**边框 / 连线**在右缘竖栏的
	// 开关按钮（屏上不重复提供）。空白右键的「配色」= 整篇方案（data.json）。
	// 勾选态＝当前生效值（`resolve*` 现算，不存第二份状态）。
	menu.addSeparator();
	addLayoutMenu(menu, view);
	addPaletteMenu(menu, view);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'toolbar.undo'))
			.setIcon('undo')
			.onClick(() => view.mindMap?.execCommand(ENGINE_COMMANDS.BACK)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'toolbar.redo'))
			.setIcon('redo')
			.onClick(() => view.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD)),
	);
}

/** 节点右键菜单（含单独移除图片/附件） */
function showNodeContextMenu(
	view: MindMapViewContext,
	event: MouseEvent,
	node: MindMapNode,
): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	// 按下时的选中已由节点菜单消费（它的条目是单节点语义）：清掉。留着的话，
	// 下一次**没有右键按下**的 contextmenu（macOS `Ctrl+左键`、键盘菜单键）会在
	// 空白分支把这份陈旧选中复原到画布上，弹出一个与当下无关的选区菜单。
	rightPressSelection.delete(view);
	// 引擎无 ACTIVE_NODE 命令；节点实例的 active() 是官方激活方式
	node.active();
	// 概要节点是**派生实例**（不在 data 树的 children 里）：正文节点那一整套
	// 编辑项对它全是错的（改的是派生 data，下一轮同步就被正文覆盖）⇒ 独立菜单
	if (isSummaryNode(node)) {
		showSummaryMenu(view, event, node);
		return;
	}
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.editText'))
			.setIcon('pencil')
			// 共用入口：默认文本节点走引擎编辑框，自绘（富）节点走**内联编辑器**
			.onClick(() => editNodeText(view, node)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.editTextModal'))
			// 备选入口：自绘节点的弹窗编辑（别名模式 / 原文模式 + 实时预览）
			.onClick(() => editNodeTextInModal(view, node)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addChild'))
			.setIcon('plus')
			.onClick(() => mindMap.execCommand(ENGINE_COMMANDS.INSERT_CHILD_NODE)),
	);
	// 中心主题是**虚拟文档根**（= 文件名，没有正文行）：它没有兄弟，也就没有
	// 「同级」可加、没有可上移/下移的位置、删除等于删掉整棵树。这些条目照旧
	// 摆着但置灰——照「联系 / 概要」的既有口径（本菜单其余项也不隐藏）：点了
	// 没反应比灰着更让人以为坏了（2026-11-03 实机）。
	menu.addItem((item) => {
		const entry = item
			.setTitle(t(view.lang, 'menu.addSibling'))
			.setIcon('circle-plus');
		return node.isRoot
			? entry.setDisabled(true)
			: entry.onClick(() => mindMap.execCommand(ENGINE_COMMANDS.INSERT_NODE));
	});
	// 兄弟间上/下移（引擎 UP_NODE / DOWN_NODE）：显式传节点——本菜单虽在入口处
	// node.active()，但画布委托路径可能处于多选态，激活列表首位未必是右键目标。
	// 置灰判据走 `siblingMoveBlocker`（与动作层同一份）：根节点没有兄弟，首个 /
	// 末个兄弟也无处可移——这两处点下去只会拿到「已是第一个 / 最后一个」的提示，
	// 属于「点了才知道不能点」（2026-11-03 实机）。
	menu.addItem((item) => {
		const entry = item
			.setTitle(t(view.lang, 'menu.moveUp'))
			.setIcon('arrow-up');
		return siblingMoveBlocker(node, -1)
			? entry.setDisabled(true)
			: entry.onClick(() => moveNodeUp(view, node));
	});
	menu.addItem((item) => {
		const entry = item
			.setTitle(t(view.lang, 'menu.moveDown'))
			.setIcon('arrow-down');
		return siblingMoveBlocker(node, 1)
			? entry.setDisabled(true)
			: entry.onClick(() => moveNodeDown(view, node));
	});
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.copyNode'))
			.setIcon('copy')
			// 剪贴板三入口统一走 view-clipboard（系统剪贴板 + Markdown 文本）：
			// 本菜单已在入口处 `node.active()`，故「复制」等价于复制该节点子树
			.onClick(() => copySelectedNodes(view)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.pasteAsChild'))
			.setIcon('clipboard')
			.onClick(() => pasteClipboardIntoNode(view, node)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addLink'))
			.setIcon('link')
			.onClick(() => {
				void addLinkToActiveNode(view);
			}),
	);
	// 节点已有链接时提供链接类动作（对齐 Obsidian 阅读视图的「链接右键」与
	// Canvas 的「Open in browser」：打开 / 新标签打开 / 复制链接）
	const linkRef = nodeLink(node);
	if (linkRef?.link) {
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.openLinkNewTab'))
				.setIcon('external-link')
				.onClick(() => view.openHyperlink(linkRef.link, 'tab')),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.copyLink'))
				.setIcon('copy')
				.onClick(() => {
					// 复制**文件里的写法**（`[[笔记|别名]]` / `[名](目录/笔记.md)` /
					// `<https://…>` / `![[报告.pdf]]`），粘回笔记即可用。
					// 写法由序列化器唯一产出（renderHyperlink）——此前直接复制通道
					// 原文，md 形态只拿到裸路径（粘回去是纯文本而非链接）；
					// 取不到写法时回落到通道原文。
					const written =
						renderHyperlink(node.getData() as MdNodeData) ?? linkRef.link;
					// 写入走 platform/clipboard（本文件头的「勿另开剪贴板通道」同样
					// 适用于这里）：失败留痕由它负责，这一层只按成败选文案
					void writeClipboardText(written).then((ok) => {
						new Notice(
							t(view.lang, ok ? 'common.linkCopied' : 'common.clipboardError'),
						);
					});
				}),
		);
	}
	if (
		getNodeDataString(node, 'hyperlink') ||
		getNodeDataString(node, 'mdWikiLinkpath')
	) {
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'modal.link.clear'))
				.setIcon('unlink')
				.onClick(() => clearNodeHyperlink(view, node)),
		);
	}
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addImage'))
			.setIcon('image')
			.onClick(() => {
				void addImageToActiveNode(view);
			}),
	);
	menu.addSeparator();
	if (getNodeDataString(node, 'image')) {
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.viewImageFullscreen'))
				.setIcon('maximize')
				.onClick(() => openNodeImageFullscreen(view, node)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.removeImage'))
				.setIcon('image')
				.onClick(() => removeNodeImage(view, node)),
		);
		// 移除文字（图片独占节点语义）：仅图片节点且确有文字时提供，
		// 清空文字后节点被图片独占（纯图行往返保持）。
		if (getNodeDataString(node, 'text').trim() !== '') {
			menu.addItem((item) =>
				item
					.setTitle(t(view.lang, 'menu.removeText'))
					.setIcon('eraser')
					.onClick(() => removeNodeText(view, node)),
			);
		}
	}
	// 视图级外观：布局沿用整篇偏好；「配色」在节点右键下**改节点颜色**
	// （写正文指令），空白右键才是整篇方案（data.json）——同一个标题两套语义，
	// 作用对象由右键落点决定（2026-10-27 用户裁决）。
	// 目标集合取右键按下时的快照（引擎在 contextmenu 阶段已折叠多选）。
	const snapshot = rightClickSelection.get(view);
	rightClickSelection.delete(view);
	const targets =
		snapshot && snapshot.node === node ? snapshot.nodes : [node];
	// 「联系」与「概要」同组（不与布局 / 配色同组）：它们都是**结构编辑**，
	// 那两项是外观。概要的落点有两种：选中集合够用（已多选相邻兄弟）就按选中建，
	// 否则进入「起点 → 终点」两次点选（起点的默认值就是右键的这个节点）。
	menu.addSeparator();
	addRelationItem(menu, view, node);
	addSummaryItem(menu, view, node, targets);
	menu.addSeparator();
	addLayoutMenu(menu, view);
	// 中心主题是**虚拟文档根**（文件名，没有正文行）：节点颜色无处持久化，
	// 故它走整篇配色（与空白右键一致）；其余节点走节点颜色。
	if (node.isRoot) {
		addPaletteMenu(menu, view);
	} else {
		addNodeColorMenu(menu, view, node, targets);
	}
	menu.addSeparator();
	menu.addItem((item) => {
		const entry = item
			.setTitle(t(view.lang, 'menu.deleteNode'))
			.setIcon('trash-2');
		// 删中心主题 = 删整棵树（等于清空正文），不给这个一次性入口
		return node.isRoot
			? entry.setDisabled(true)
			: entry.onClick(() => deleteActiveNode(view));
	});
	showExclusiveMenu(view, menu, { x: event.clientX, y: event.clientY });
}
