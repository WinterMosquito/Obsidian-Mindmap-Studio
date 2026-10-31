/**
 * 联系的**手绘锚定**交互层：建边后不自动选路，依次把两个手柄交给用户点放。
 *
 * ## 为什么要独立成文件
 * `view-node-relation` 负责"改哪一行"（建/删/改标签），本文件只负责一段
 * **瞬时交互会话**：overlay、指针跟随、两次落定、Esc 回滚。两者共用同一个
 * 提交回调（`onCommit(geo)`），不互相 import，避免循环。
 *
 * ## 会话（每个视图最多一个）
 * 1. `start`：起点手柄跟随指针；点击落定起点（端点 + 控制点 1）；
 * 2. `end`：终点手柄跟随指针；点击落定终点并**一次性**提交 `geo`；
 * 3. `Esc` / 引擎重建：丢弃会话，不写文件、不记历史。
 *
 * ## 为什么 overlay 挂在 `draw` 层
 * `draw` 组是引擎的**内容坐标层**（缩放/平移由它的 transform 承担），
 * 而 `clearDraw()` 只清四个子容器、不清 `draw` 的直接子元素 ⇒ 挂这里既
 * 自动跟随视口，又不会被引擎重绘顺手删掉。指针用 `relationClientToContent`
 * 反解到同一坐标系。
 */

import { Notice } from 'obsidian';
import type { MindMapNode } from '../core/engine-types';
import { t } from '../core/i18n';
import type { RelationGeometry } from '../domain/relation';
import {
	commitAnchorSession,
	createAnchorSession,
	moveAnchorSession,
	previewOf,
} from '../domain/relation-anchor';
import {
	relationCanvasLayer,
	relationClientToContent,
	relationNodeBox,
} from '../engine/mindmap';
import type { ViewNodeEditContext } from './view-context';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 锚定会话所需的视图面（比 `ViewNodeEditContext` 多一个画布容器） */
export interface RelationAnchorHost extends ViewNodeEditContext {
	readonly canvasEl: HTMLElement | null;
}

/** 按视图持有的收尾函数（解绑监听 + 移除 overlay；同时最多一个） */
const activeSessions = new WeakMap<object, () => void>();

function createSvg<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
	const element = document.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) {
		element.setAttribute(name, value);
	}
	return element;
}

function placeHandle(node: SVGCircleElement, x: number, y: number): void {
	node.setAttribute('cx', String(x));
	node.setAttribute('cy', String(y));
}

/**
 * 开始一次手绘锚定。
 *
 * @param onCommit 两次落定后的原子提交（由 `view-node-relation` 注入：
 *   写 `%%rel:… | geo=…%%`，目标无 id 时一并懒加）
 * @returns 是否进入了会话（引擎/节点未就绪时为 false）
 */
export function startRelationAnchor(
	host: RelationAnchorHost,
	from: MindMapNode,
	to: MindMapNode,
	onCommit: (geometry: RelationGeometry) => void,
): boolean {
	const mindMap = host.mindMap;
	const canvasEl = host.canvasEl;
	if (!mindMap || !canvasEl) {
		return false;
	}
	// 显式非空局部：下面的监听函数在闭包里引用它（TS 不在函数声明里保留窄化）
	const canvas: HTMLElement = canvasEl;
	const fromBox = relationNodeBox(from);
	const toBox = relationNodeBox(to);
	const layer = relationCanvasLayer(mindMap);
	if (!fromBox || !toBox || !layer) {
		return false;
	}
	// 同一视图只允许一个会话：重复进入视为重新开始（旧会话回滚，不写文件）
	cancelRelationAnchor(host);

	// 初始指针 = 目标节点中心（用户刚点完目标节点；移动鼠标后立即跟手）
	const session = createAnchorSession(fromBox, toBox, {
		x: toBox.left + toBox.width / 2,
		y: toBox.top + toBox.height / 2,
	});

	const group = createSvg('g', {
		class: 'tmm-relation-anchor-overlay',
		// overlay 只做视觉预览：所有指针事件都留给画布（落定由 canvas 监听）
		'pointer-events': 'none',
	});
	const path = createSvg('path', {
		fill: 'none',
		stroke: 'var(--interactive-accent, #7f6df2)',
		'stroke-width': '1.5',
		'stroke-dasharray': '4,4',
	});
	const controlLine = createSvg('line', {
		stroke: 'var(--interactive-accent, #7f6df2)',
		'stroke-width': '1',
		'stroke-dasharray': '2,3',
		opacity: '0.6',
	});
	const startHandle = createSvg('circle', {
		r: '5',
		fill: '#fff',
		stroke: 'var(--interactive-accent, #7f6df2)',
		'stroke-width': '1.5',
	});
	const endHandle = createSvg('circle', {
		r: '5',
		fill: '#fff',
		stroke: 'var(--interactive-accent, #7f6df2)',
		'stroke-width': '1.5',
	});
	group.append(path, controlLine, startHandle, endHandle);
	layer.append(group);

	const render = (): void => {
		const preview = previewOf(session);
		path.setAttribute('d', preview.path);
		placeHandle(startHandle, preview.startHandle.x, preview.startHandle.y);
		controlLine.setAttribute('x1', String(preview.startAnchor.x));
		controlLine.setAttribute('y1', String(preview.startAnchor.y));
		controlLine.setAttribute('x2', String(preview.startHandle.x));
		controlLine.setAttribute('y2', String(preview.startHandle.y));
		if (preview.endHandle) {
			endHandle.removeAttribute('display');
			placeHandle(endHandle, preview.endHandle.x, preview.endHandle.y);
		} else {
			endHandle.setAttribute('display', 'none');
		}
	};
	render();

	// popout 窗口的键盘事件挂在它自己的 window 上（与视图同文档）
	const win = canvas.ownerDocument.defaultView ?? window;

	function dispose(): void {
		// pointermove 挂在 window：指针移出画布后手柄仍跟随（点放仍需在画布内）
		win.removeEventListener('pointermove', onPointerMove, true);
		canvas.removeEventListener('pointerdown', onPointerDown, true);
		canvas.removeEventListener('pointerup', swallowClick, true);
		canvas.removeEventListener('mousedown', onMouseDown, true);
		canvas.removeEventListener('mouseup', swallowClick, true);
		canvas.removeEventListener('click', swallowClick, true);
		canvas.removeEventListener('contextmenu', onContextMenu, true);
		win.removeEventListener('keydown', onKeyDown, true);
		group.remove();
		activeSessions.delete(host);
	}

	function onPointerMove(event: PointerEvent): void {
		const point = relationClientToContent(
			host.mindMap,
			event.clientX,
			event.clientY,
		);
		if (!point) {
			return;
		}
		moveAnchorSession(session, point);
		render();
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) {
			return;
		}
		// 拦在引擎之前：否则会触发节点点击 / 画布拖动
		event.preventDefault();
		event.stopPropagation();
		const point = relationClientToContent(
			host.mindMap,
			event.clientX,
			event.clientY,
		);
		if (!point) {
			return;
		}
		moveAnchorSession(session, point);
		const geometry = commitAnchorSession(session);
		if (!geometry) {
			render();
			new Notice(t(host.lang, 'nodeRelation.anchorEnd'));
			return;
		}
		dispose();
		onCommit(geometry);
	}

	function onMouseDown(event: MouseEvent): void {
		if (event.button !== 0) {
			return;
		}
		// 引擎的节点拖拽 / 画布平移监听的是 mousedown（不是 pointerdown），
		// 只拦 pointerdown 挡不住它——落定那一下会把画布拖走。
		event.preventDefault();
		event.stopPropagation();
	}

	function swallowClick(event: MouseEvent): void {
		if (event.button !== 0) {
			return;
		}
		// 落定用 pointerdown 完成；随后的 pointerup / mouseup / click 不应再
		// 落到引擎（否则会选中节点、清激活线，看起来像"点了一下画布"）
		event.preventDefault();
		event.stopPropagation();
	}

	function onContextMenu(event: MouseEvent): void {
		// 会话期间不弹画布右键菜单：此刻的右键没有可作用的对象
		event.preventDefault();
		event.stopPropagation();
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		dispose();
	}

	win.addEventListener('pointermove', onPointerMove, true);
	canvas.addEventListener('pointerdown', onPointerDown, true);
	canvas.addEventListener('pointerup', swallowClick, true);
	canvas.addEventListener('mousedown', onMouseDown, true);
	canvas.addEventListener('mouseup', swallowClick, true);
	canvas.addEventListener('click', swallowClick, true);
	canvas.addEventListener('contextmenu', onContextMenu, true);
	win.addEventListener('keydown', onKeyDown, true);

	activeSessions.set(host, dispose);
	new Notice(t(host.lang, 'nodeRelation.anchorStart'));
	return true;
}

/**
 * 取消当前会话（Esc、引擎重建、切换文件）。
 *
 * @returns 是否真的取消了一个会话
 */
export function cancelRelationAnchor(host: object): boolean {
	const dispose = activeSessions.get(host);
	if (!dispose) {
		return false;
	}
	dispose();
	return true;
}
