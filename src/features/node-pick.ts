/**
 * 节点**落点模式**：「进入选点态 → 用户点节点 → 推进或结束」。
 *
 * 为什么要有这一层（2026-11-02 加「概要」时抽出的）：联系与概要都要这套交互，
 * 而引擎的 `node_click` / `draw_click` **各自只有一个**（谁先注册谁先跑）。
 * 两个特性各持一份 pending 必然互相看不见——概要选点期间点节点会被联系的点选
 * 顺手消费掉，`Esc` 也只能取消其中一方。收口到这里后：
 *
 * - **会话唯一**：再次 `startNodePick` 顶掉旧会话（旧提示一并关掉）；
 * - **取消唯一**：`Esc` / 点画布空白 / 引擎重建都走 {@link cancelNodePick}，
 *   `view-hotkeys` 只调它一次——返回值本身就是「有没有人在选点」；
 * - **步数由会话自己决定**：`onPick` 返回 `'continue'` 可以留在模式里再点一次
 *   （概要就是两步：起点由右键节点给定 → 再点终点）。
 *
 * 提示统一用 `Notice`（与联系一致：不占画布、无需布局、`Esc` 之后自动消失）。
 */

import { Notice } from 'obsidian';
import type { MindMapNode } from '../core/engine-types';
import type { ViewNodeEditContext } from './view-context';

/** 一次落点的结果：结束会话 / 继续等下一次点击 */
type NodePickOutcome = 'done' | 'continue';

/** 一次选点会话 */
export interface NodePickSession {
	/** 进入时的提示文案（会话结束时自动收起） */
	hint: string;
	/**
	 * 命中一个节点。
	 *
	 * 根节点 / 概要节点等**不可作为落点**的情形由调用方自己判断并提示，
	 * 返回 `'continue'` 即可（本模块不替业务判定「哪个节点能用」）。
	 */
	onPick: (node: MindMapNode) => NodePickOutcome;
	/**
	 * 会话被**取消**（`Esc` / 点画布空白 / 引擎重建 / 被新会话顶掉）。
	 * `'done'` 结束时**不**调用——那条路径调用方自己往下推进。
	 */
	onCancel?: () => void;
}

interface ActivePick {
	readonly session: NodePickSession;
	readonly notice: Notice;
}

/** 按视图持有（WeakMap：视图销毁即回收，不需要额外清理表） */
const activePicks = new WeakMap<object, ActivePick>();

/**
 * 结束会话。
 * @param notify 是否通知 `onCancel`（`'done'` 路径传 false）
 * @returns 是否真的结束了一个会话（false = 本来就不在模式里）
 */
function endNodePick(view: object, notify: boolean): boolean {
	const active = activePicks.get(view);
	if (!active) {
		return false;
	}
	activePicks.delete(view);
	// 测试环境的 Notice 桩可能没有 hide：防御式调用，不让清理抛错
	(active.notice as unknown as { hide?: () => void }).hide?.();
	if (notify) {
		active.session.onCancel?.();
	}
	return true;
}

/** 进入落点模式（重复进入 = 顶掉旧会话，不会叠出两条提示） */
export function startNodePick(
	view: ViewNodeEditContext,
	session: NodePickSession,
): void {
	endNodePick(view, true);
	// `0` = 常驻，直到会话结束显式 `hide()`：选点态可能停十几秒（用户在挑终点），
	// 默认 5 s 自动消失会让「点哪里？Esc 是什么？」的指引在最需要时不见
	activePicks.set(view, { session, notice: new Notice(session.hint, 0) });
}

/**
 * 取消落点会话（`Esc` / 点画布空白 / 视图关闭）。
 *
 * @returns 是否真的取消了一个会话（false = 本来就不在模式里）
 */
export function cancelNodePick(view: object): boolean {
	return endNodePick(view, true);
}

/**
 * 引擎 `node_click` 的落点。
 *
 * @returns 是否消费了本次点击（false = 当前没有会话，事件该还给别的处理者）
 */
export function handleNodePickClick(view: object, node: MindMapNode): boolean {
	const active = activePicks.get(view);
	if (!active) {
		return false;
	}
	if (active.session.onPick(node) === 'done') {
		endNodePick(view, false);
	}
	return true;
}

/**
 * 注册引擎事件（随引擎重建调用一次）。
 *
 * **重建即视为放弃**：换了文件 / 切回 Markdown 再回来，旧节点引用一律作废——
 * 留着 pending 会让下一次点击作用在一个不在树上的节点上（写进游离 data，
 * 文件毫无变化，用户只觉得「点了没用」）。
 */
export function setupNodePick(view: ViewNodeEditContext): void {
	cancelNodePick(view);
	if (!view.mindMap) {
		return;
	}
	view.engineEvents.onEngine(view.mindMap, 'node_click', (...args: unknown[]) => {
		const node = args[0] as MindMapNode | undefined;
		if (node) {
			handleNodePickClick(view, node);
		}
	});
	view.engineEvents.onEngine(view.mindMap, 'draw_click', () => {
		cancelNodePick(view);
	});
}
