/**
 * 任务复选框的**交互收口**（渲染在 `node-inline-html`，数据在 `domain/md-task`）。
 *
 * ## 为什么在画布 capture 阶段接管
 * 复选框是自绘节点内容里的一个 `span`，而引擎在**节点 group** 上以 `mousedown`
 * 启动选中 / 拖拽，并用 `dblclick` 打开它自己的编辑框（自绘节点实测为 no-op，
 * 但仍会吞事件）。要「点一下就切换」必须：
 * - `mousedown`：`preventDefault + stopPropagation`（否则按下的那一刻节点开始被拖）；
 * - `click`：命中即切换（不再冒泡给引擎的节点点击语义）；
 * - `dblclick`：吞掉（连点两次 = 切两次，净零；同时避免打开编辑入口）。
 * 三条监听都挂**画布祖先的 capture**：capture 先于目标元素与其祖先的冒泡监听执行，
 * 因此不必与引擎的注册顺序赛跑（与 `view-viewport` 的滚轮接管同款理由）。
 *
 * ## 只做一件事
 * 切换 = **改那一行原文**（`applyRawNodeContent`）：重解析 → 渲染 → 保存调度
 * 全部复用既有编辑通道。**跳过提交后编排**（自动拆链 / 中心主题改名 / 节点计数）：
 * 勾选只改行首三个字符，不该引发结构变更。
 *
 * 右键菜单**刻意没有**任务条目（用户裁决 2026-10-28）：勾选只有「点复选框」这一个
 * 入口，因此也没有多选批量切换；图片节点不渲染复选框（同一裁决）。
 */
import { findNodeByDom } from '../engine/mindmap';
import { composeNodeContent } from '../markdown/md-serialize';
import { setTaskTokenInRaw, toggleTaskToken } from '../domain/md-task';
import { elementFromTarget } from '../core/event-binder';
import type { MdNodeData } from '../core/node-data';
import { applyRawNodeContent } from './node-inline-editor';
import { NODE_TASK_CLASS } from './node-inline-html';
import { taskStateOf } from './node-inline-tokenize';
import type { MindMapViewContext } from './view-context';

/** 复选框的命中选择器（类名唯一来源在 `node-inline-html`） */
const TASK_SELECTOR = `.${NODE_TASK_CLASS}`;

/** 事件目标是否落在某枚复选框内；是则返回该元素（跨 realm 判定见 `elementFromTarget`） */
function taskBoxOf(event: Event): Element | null {
	return elementFromTarget(event.target)?.closest(TASK_SELECTOR) ?? null;
}

/** 切换该复选框对应的节点（找不到节点 / 已非任务 → 静默放弃） */
function toggleTaskAt(view: MindMapViewContext, box: Element): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	const node = findNodeByDom(mindMap, box);
	if (!node) {
		return;
	}
	const data = node.getData() as MdNodeData;
	const state = taskStateOf(data);
	if (!state) {
		return;
	}
	// 原文 = 「下次写盘会写出的内容」的唯一来源（未编辑 = mdRaw，已编辑 = 合成）
	const raw = composeNodeContent(data, view.app);
	const token =
		typeof data.mdTaskToken === 'string' && data.mdTaskToken
			? data.mdTaskToken
			: state === 'done'
				? '[x]'
				: '[ ]';
	const next = setTaskTokenInRaw(raw, toggleTaskToken(token));
	if (next === raw) {
		return;
	}
	applyRawNodeContent(view, node, next, { afterCommit: false });
}

/**
 * 装配任务复选框交互（随引擎实例注册/清理；只读嵌入不调用本函数）。
 *
 * 三个监听都走 `engineEvents`（随引擎重建自动摘除，见 `core/event-binder`）。
 */
export function setupNodeTaskInteraction(view: MindMapViewContext): void {
	const canvasEl = view.canvasEl;
	if (!canvasEl) {
		return;
	}
	view.engineEvents.onDom(
		canvasEl,
		'mousedown',
		(event) => {
			if (event.button !== 0 || !taskBoxOf(event)) {
				return;
			}
			// 阻止引擎开始选中 / 拖拽；不阻止冒泡的话这次按下会被当成拖动起点
			event.preventDefault();
			event.stopPropagation();
		},
		true,
	);
	view.engineEvents.onDom(
		canvasEl,
		'click',
		(event) => {
			if (event.button !== 0) {
				return;
			}
			const box = taskBoxOf(event);
			if (!box) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			toggleTaskAt(view, box);
		},
		true,
	);
	view.engineEvents.onDom(
		canvasEl,
		'dblclick',
		(event) => {
			if (!taskBoxOf(event)) {
				return;
			}
			// 两次 click 已经把状态切回原样，这里只负责不打开编辑器
			event.preventDefault();
			event.stopPropagation();
		},
		true,
	);
}
