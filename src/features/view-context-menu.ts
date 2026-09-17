/**
 * 右键菜单：节点右键完整菜单与画布空白处通用菜单。从 view.ts 拆出。
 * 菜单动作（复制/粘贴/链接/图片/删除等）委托给 view-node-actions.ts。
 */
import { Menu, Notice } from 'obsidian';
import {
	ENGINE_COMMANDS,
	findNodeByDom,
	fitMindMap,
	getNodeDataString,
	getRenderRoot,
	resetZoom,
} from '../engine/mindmap';
import {
	addImageToActiveNode,
	addLinkToActiveNode,
	clearNodeHyperlink,
	copyNode,
	createChildNodeBelow,
	deleteActiveNode,
	editNodeText,
	pasteNodeAsChild,
	removeNodeImage,
	removeNodeText,
} from './view-node-actions';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { nodeLink } from './view-wikilink';
import { arrangeMindMap } from './view-toolbar';
import { t } from '../core/i18n';
import { renderHyperlink } from '../markdown/md-serialize';
import type { MdNodeData } from '../core/node-data';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

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
	// 空白处右键：画布委托。附件图标等未 stopPropagation 的冒泡事件
	// 命中节点时也统一走节点菜单，避免双菜单或菜单丢失。
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
				.onClick(() => pasteNodeAsChild(view, null)),
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
				.onClick(() => fitMindMap(view.mindMap)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'toolbar.arrange'))
				.setIcon('sparkles')
				.onClick(() => arrangeMindMap(view)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'toolbar.undoShort'))
				.setIcon('undo')
				.onClick(() => view.mindMap?.execCommand(ENGINE_COMMANDS.BACK)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'toolbar.redoShort'))
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
			// 共用入口：默认文本节点走引擎编辑框，自绘（富）节点走插件文本弹窗
			.onClick(() => editNodeText(view, node)),
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
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.copyNode'))
			.setIcon('copy')
			.onClick(() => copyNode(view, node)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.pasteAsChild'))
			.setIcon('clipboard')
			.onClick(() => pasteNodeAsChild(view, node)),
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
					void navigator.clipboard
						.writeText(written)
						.then(() => new Notice(t(view.lang, 'common.linkCopied')))
						.catch(() => new Notice(t(view.lang, 'common.clipboardError')));
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
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.deleteNode'))
			.setIcon('trash-2')
			.onClick(() => deleteActiveNode(view)),
	);
	menu.showAtPosition({ x: event.clientX, y: event.clientY });
}
