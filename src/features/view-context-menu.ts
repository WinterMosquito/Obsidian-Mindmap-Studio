/**
 * 右键菜单：节点右键完整菜单与画布空白处通用菜单。从 view.ts 拆出。
 * 菜单动作（链接/图片/删除等）委托给 view-node-actions.ts；
 * 剪贴板三项（复制节点 / 粘贴为子节点 / 粘贴节点）走 view-clipboard——
 * 那里是系统剪贴板（Markdown 文本）的**唯一**收口，勿在本文件另开一条。
 *
 * 另承载**外观两项的级联入口**（布局 / 配色，`addChoiceMenu`）：节点右键与
 * 空白右键共用同一份；边框 / 连线不在这里（它们在右缘竖栏的开关按钮上）。
 */
import { Menu, Notice } from 'obsidian';
import {
	ENGINE_COMMANDS,
	findNodeByDom,
	getNodeDataString,
	getRenderRoot,
	resetZoom,
} from '../engine/mindmap';
import { LAYOUT_OPTIONS, PALETTE_OPTIONS } from '../core/constants';
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
 * 追加一个「勾选当前值」的**级联菜单**（用户口中的「二级菜单」）。
 *
 * ## 为什么不用 `MenuItem.setSubmenu`
 * 官方 `obsidian.d.ts` **没有** 这个方法。实测里给它挂上 `setSubmenu` 后宿主确实
 * 会加 `has-submenu` 类，但悬停/点击**都不会展开**（2026-10-23 实机复现），
 * 属未声明的内部方法 —— 不可依赖。
 *
 * ## 官方支持的做法
 * 父项 `onClick((evt) => 子菜单.showAtMouseEvent(evt))`：子菜单弹在光标处，
 * 全程只用 d.ts 里声明过的 `Menu` / `onClick` / `showAtMouseEvent` /
 * `showAtPosition`。代价是没有悬停箭头，故**当前值靠子项勾选态**表达
 * （父项标题只给名字；2026-10-23 复核：不拼「布局：逻辑结构图」，
 * 现有用例按标题精确匹配，且勾选态已足够）。
 * 键盘触发时 `evt` 没有坐标，用菜单项矩形当锚点，避免弹到屏幕左上角。
 *
 * 勾选态一律**现算**（`spec.current` 由调用方从 `resolve*` 取），不缓存第二份
 * 状态——外观只存 `data.json` 的 `viewState[路径]` 一处。
 */
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
	const submenu = new Menu();
	for (const option of spec.options) {
		submenu.addItem((item) =>
			item
				.setTitle(t(view.lang, option.label))
				.setChecked(option.value === spec.current)
				.onClick(() => spec.onPick(option.value)),
		);
	}
	menu.addItem((item) =>
		item.setTitle(t(view.lang, spec.title)).setIcon(spec.icon).onClick((evt) => {
			if ('clientX' in evt) {
				submenu.showAtMouseEvent(evt);
				return;
			}
			// 键盘触发没有鼠标坐标：用**被激活的菜单项**矩形当锚点
			// （弹到 0,0 会跑到屏幕左上角，与操作位置脱节）
			const target = evt.target;
			const rect =
				target instanceof HTMLElement ? target.getBoundingClientRect() : null;
			submenu.showAtPosition(
				rect ? { x: rect.left, y: rect.bottom } : { x: 0, y: 0 },
			);
		}),
	);
}

/**
 * 视图级外观菜单：**布局 / 配色**（空白右键与节点右键共用同一份）。
 *
 * 连线与边框不在这里——它们已升为右缘竖栏的**开关按钮**（点一下互切），
 * 菜单里再放一份就成了第二个入口（2026-10-23 用户裁决）。
 */
function addLayoutPaletteMenus(menu: Menu, view: MindMapViewContext): void {
	addChoiceMenu(menu, view, {
		title: 'toolbar.layout',
		icon: 'layout-dashboard',
		current: view.resolvePreference('layout'),
		options: LAYOUT_OPTIONS,
		onPick: (value) => view.applyLayout(value),
	});
	addChoiceMenu(menu, view, {
		title: 'toolbar.palette',
		icon: 'palette',
		current: view.resolvePreference('palette'),
		options: PALETTE_OPTIONS,
		onPick: (value) => view.applyPalette(value),
	});
}

/** 注册右键菜单监听（引擎重建时随 initMindMap 调用） */
export function setupContextMenu(view: MindMapViewContext): void {
	if (!view.canvasEl || !view.mindMap) {
		return;
	}
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
		// 外观四项拆两处入口：**布局 / 配色**在此处（与节点右键共用的级联菜单），
		// **边框 / 连线**在右缘竖栏的开关按钮（屏上不重复提供）。
		// 勾选态＝当前生效值（`resolve*` 现算，不存第二份状态）。
		menu.addSeparator();
		addLayoutPaletteMenus(menu, view);
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
	// 视图级外观（布局 / 配色）：与空白右键**同一份**菜单，节点右键也能直接改，
	// 不必先取消选中再点空白处（2026-10-23 用户要求）。
	menu.addSeparator();
	addLayoutPaletteMenus(menu, view);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.deleteNode'))
			.setIcon('trash-2')
			.onClick(() => deleteActiveNode(view)),
	);
	menu.showAtPosition({ x: event.clientX, y: event.clientY });
}
