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
 */
import { Menu, Notice, type MenuItem } from 'obsidian';
import {
	ENGINE_COMMANDS,
	findNodeByDom,
	getActiveNodes,
	getNodeDataString,
	getRenderRoot,
	resetZoom,
} from '../engine/mindmap';
import {
	isCustomPaletteValue,
	LAYOUT_OPTIONS,
	PALETTE_OPTIONS,
} from '../core/constants';
import { COLOR_DIRECTIVE_NONE } from '../domain/color';
import { openColorInputModal } from '../ui/modal-color';
import {
	applyNodeColor,
	effectiveNodeColorOf,
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
import { nodeLink } from './view-wikilink';
import { arrangeMindMap } from './view-toolbar';
import { t, type TranslationKey } from '../core/i18n';
import { writeClipboardText } from '../platform/clipboard';
import { renderHyperlink } from '../markdown/md-serialize';
import type { MdNodeData } from '../core/node-data';
import type { MindMapNode } from '../core/engine-types';
import type { MindMapViewContext } from './view-context';

/**
 * 追加一个**二级菜单**（「布局」「配色」）。
 *
 * 优先用宿主原生级联：条目右侧出现箭头，悬停/点击由宿主展开并贴住父项——与
 * Obsidian 自带菜单（如「切换编辑器」）同一套观感；运行时缺该方法时**回退**为
 * 「点击父项 → 在光标处弹出独立菜单」（键盘触发用条目矩形当锚点）。
 *
 * 勾选态一律**现算**（`spec.current` 由调用方从 `resolve*` 取），不缓存第二份
 * 状态——外观只存 `data.json` 的 `viewState[路径]` 一处；父项标题只给名字，
 * 当前值靠子项勾选态表达。
 */
function addCascadingMenu(
	menu: Menu,
	view: MindMapViewContext,
	spec: {
		title: TranslationKey;
		icon: string;
		build: (submenu: Menu) => void;
	},
): void {
	menu.addItem((item) => {
		item.setTitle(t(view.lang, spec.title)).setIcon(spec.icon);
		const nativeSubmenu = createNativeSubmenu(item);
		if (nativeSubmenu) {
			spec.build(nativeSubmenu);
			return item;
		}
		// 回退：宿主没有原生级联时，点击后在光标处弹出（只用 d.ts 声明的 API）
		const submenu = new Menu();
		spec.build(submenu);
		item.onClick((evt) => {
			if ('clientX' in evt) {
				submenu.showAtMouseEvent(evt);
				return;
			}
			// 键盘触发没有鼠标坐标：用**被激活的菜单项**矩形当锚点
			//（弹到 0,0 会跑到屏幕左上角，与操作位置脱节）
			const target = evt.target;
			const rect =
				target instanceof HTMLElement ? target.getBoundingClientRect() : null;
			submenu.showAtPosition(
				rect ? { x: rect.left, y: rect.bottom } : { x: 0, y: 0 },
			);
		});
		return item;
	});
}

/**
 * 原生级联子菜单的**私有触点**（规则 9 登记；唯一出处）。
 *
 * `MenuItem.setSubmenu` **不在** `obsidian.d.ts`，但 Obsidian 1.14.4 运行时确实
 * 有（主程序源码 `setSubmenu` + 实机核对）。真实语义：
 * - **无参调用**：内部 `new Menu()`、给条目加 `has-submenu` 与右向箭头，
 *   返回那个菜单——要往里 `addItem` 的是**返回值**；
 * - 展开与定位由宿主 `Menu` 负责：悬停约 250ms（或点击）展开，位置贴住父项右缘；
 * - 手机上改为整页切换（`isPhone` 分支），同样不需要我们干预。
 *
 * ⚠ 2026-10-23 曾记「挂上 setSubmenu 也不展开」——那是**用法错误**：把它当 setter
 * 传了自建 Menu（参数被忽略），条目加到了没人引用的那个菜单上。2026-10-27 订正。
 */
function createNativeSubmenu(item: MenuItem): Menu | null {
	const factory = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu;
	if (typeof factory !== 'function') {
		return null;
	}
	try {
		return factory.call(item);
	} catch (error) {
		console.warn('创建原生子菜单失败，回退为点击弹出', error);
		return null;
	}
}

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
	addCascadingMenu(menu, view, {
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
 * 「自定义…」项（整篇配色 / 节点配色共用）：分隔线 + 颜色弹窗 + 写回。
 *
 * 两处唯一的差别是「写到哪里」（`onPick`），输入与校验完全一致，勿各写一份。
 * `onPick` 只在用户提交了**合法颜色**时被调用：取消 / 关闭不回调，调用方不必判空。
 *
 * @param checked 当前值是否已是自定义色（勾选态的现算结果）
 * @param initial 弹窗预填值（null = 空输入框）
 */
function addCustomColorItem(
	submenu: Menu,
	view: MindMapViewContext,
	options: {
		checked: boolean;
		initial: string | null;
		onPick: (color: string) => void;
	},
): void {
	submenu.addSeparator();
	submenu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'palette.custom'))
			.setChecked(options.checked)
			.onClick(() => {
				void openColorInputModal(view.app, view.lang, options.initial).then(
					(color) => {
						if (color) {
							options.onPick(color);
						}
					},
				);
			}),
	);
}

/**
 * 空白画布的「配色」：改**整篇**方案（写 `data.json` 的 `viewState[路径].palette`）。
 *
 * 预设 6 项之后多一项「自定义」：值是一个十六进制，同样按文件记；读取侧
 * `normalizePalettePreference` 保留它，渲染侧由 `mindmap-palette` 派生五档色板。
 */
function addPaletteMenu(menu: Menu, view: MindMapViewContext): void {
	const current = view.resolvePreference('palette');
	const custom = isCustomPaletteValue(current);
	addCascadingMenu(menu, view, {
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
			addCustomColorItem(submenu, view, {
				checked: custom,
				// 预设 id 不是颜色值：带着它预填只会让输入框一打开就报非法
				initial: custom ? current : null,
				onPick: (color) => view.applyPalette(color),
			});
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
 * **分组与空白右键的整篇配色完全一致**：默认 + 五个颜色同组，只在「自定义」前画
 * 一条分隔线，两处标题序列逐项相同（节点侧曾多画一条线，2026-10-27 实机指出）。
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
	addCascadingMenu(menu, view, {
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
			addCustomColorItem(submenu, view, {
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
	// 节点右键：引擎对节点 contextmenu 做了 stopPropagation，
	// 事件不会冒泡到画布，必须改用引擎的 node_contextmenu 事件。
	view.engineEvents.onEngine(view.mindMap, 'node_contextmenu', (...args: unknown[]) => {
		const event = args[0] as MouseEvent;
		const node = args[1] as MindMapNode | undefined;
		if (node) {
			showNodeContextMenu(view, event, node);
		}
	});
	// 空白处右键：画布委托。**留住**「命中节点则走节点菜单」这一支——节点自己的
	// contextmenu 处理器**并非无条件** stopPropagation：`readonly` 或 `e.ctrlKey`
	// 时它直接 return（上游 `render/node/MindMapNode.js`），事件会冒泡到画布。
	// macOS 的 Ctrl+左键即走这条路径；删掉该支会让它落到空白菜单（2026-10-15
	// 复核：审计曾判其为死分支，实测依据不足）。
	view.engineEvents.onDom(view.canvasEl, 'contextmenu', (event) => {
		event.preventDefault();
		const target = event.target as HTMLElement;
		const nodeEl = target.closest<HTMLElement>('.smm-node');
		const node = nodeEl ? findNodeByDom(view.mindMap, nodeEl) : null;
		if (node) {
			showNodeContextMenu(view, event, node);
			return;
		}
		const menu = new Menu();
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
		menu.showAtPosition({ x: event.clientX, y: event.clientY });
	});
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
	// 引擎无 ACTIVE_NODE 命令；节点实例的 active() 是官方激活方式
	node.active();
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
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addSibling'))
			.setIcon('circle-plus')
			.onClick(() => mindMap.execCommand(ENGINE_COMMANDS.INSERT_NODE)),
	);
	// 兄弟间上/下移（引擎 UP_NODE / DOWN_NODE）：显式传节点——本菜单虽在入口处
	// node.active()，但画布委托路径可能处于多选态，激活列表首位未必是右键目标；
	// 根节点/首尾的拒绝与提示收口在 moveNodeUp/moveNodeDown（本层不预判）
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.moveUp'))
			.setIcon('arrow-up')
			.onClick(() => moveNodeUp(view, node)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.moveDown'))
			.setIcon('arrow-down')
			.onClick(() => moveNodeDown(view, node)),
	);
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
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.deleteNode'))
			.setIcon('trash-2')
			.onClick(() => deleteActiveNode(view)),
	);
	menu.showAtPosition({ x: event.clientX, y: event.clientY });
}
