/**
 * 层级语法（Markdown 标题 / 无序列表）的视图侧执行：右键「层级语法」级联的
 * 整篇重排 + 编辑期的一致性守卫。判定与换算全部在 `markdown/md-heading-syntax`
 * （纯逻辑，零引擎依赖）；本模块只做三件事：挂引擎事件、改写引擎数据、给反馈。
 *
 * ## 两条路径的写入方式不同（有意）
 * - **显式动作**（右键级联）：`getData()` 深拷贝 → 规划改写 → `replaceMindMapData`，
 *   整篇一条撤销历史（与批量拆分双链同一路径）；
 * - **自动归一**（守卫）：`liveNodeTree()` 包装渲染节点、**就地**改 md 字段，
 *   **不进撤销栈**——md 字段不参与绘制，改完无需重渲染，用户的 `Ctrl+Z` 仍是一步
 *   撤掉「拖拽 + 语法换算」（否则要按两次，且第一次看起来"没反应"）。
 *
 * ## 为什么守卫要认拖拽
 * 引擎在**拖拽过程中**就持续执行 `MOVE_NODE_TO`（每次 hover 落点都是一次命令），
 * 期间多次 `data_change`。若不屏蔽，去抖后的守卫会对着半途的树做判断、甚至
 * 用 `BACK` 撤回一个还在进行的手势。故 `node_dragging` 置位、`node_dragend`
 * 清位并立即跑一次；`data_change` 那条路只在非拖拽时跑（兜住粘贴 / 撤销 / 重做）。
 */
import { Notice } from 'obsidian';
import { createDebouncer, type Debouncer } from '../core/concurrency';
import { t, tf } from '../core/i18n';
import {
	ENGINE_COMMANDS,
	getRenderRoot,
	replaceMindMapData,
} from '../engine/mindmap';
import {
	currentDocumentSyntax,
	planDocumentSyntax,
} from '../markdown/md-heading-format';
import { normalizeSiblingSyntax } from '../markdown/md-heading-normalize';
import {
	liveNodeTree,
	type DocumentSyntax,
} from '../markdown/md-heading-syntax';
import { updateStatusBar } from './view-status';
import type { MindMapViewContext } from './view-context';

/** 守卫的去抖窗口：与自动拆分同一拍（拖拽结束另有即时触发） */
const GUARD_DEBOUNCE_MS = 120;

interface SyntaxGuardState {
	/**
	 * 拖拽进行中（引擎逐落点执行 `MOVE_NODE_TO`，此刻不做判断）。
	 *
	 * 置位靠 `node_dragging`、清位靠 `node_dragend`。极端情况（在窗口外松开鼠标）
	 * 可能收不到 `node_dragend`：此时**落点也没有落地**（两者同在引擎的 mouseup
	 * 处理里），故不会造出混排组；标志位留到下一次拖拽结束时自然清掉。
	 */
	dragging: boolean;
	/**
	 * 刚用 `BACK` 撤回了一次编辑：`BACK` 自己会发 `data_change`，若立刻重判就会
	 * 「撤回 → 重判 → 再撤回」地空转（2026-11-08 实机：一条手写文件刷出 17 条
	 * 重复提示）。置位后**跳过下一轮**判定。
	 */
	suppress: boolean;
	debouncer: Debouncer;
}

/** 按视图持有的守卫状态（WeakMap：视图关闭后可回收） */
const guards = new WeakMap<MindMapViewContext, SyntaxGuardState>();

function guardState(view: MindMapViewContext): SyntaxGuardState {
	let state = guards.get(view);
	if (!state) {
		state = {
			dragging: false,
			suppress: false,
			debouncer: createDebouncer(GUARD_DEBOUNCE_MS),
		};
		guards.set(view, state);
	}
	return state;
}

/** 本文件当前的层级语法（右键级联的勾选态；现算，不存第二份状态） */
export function resolveDocumentSyntax(view: MindMapViewContext): DocumentSyntax {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return 'list';
	}
	return currentDocumentSyntax(mindMap.getData());
}

/**
 * 右键「层级语法」：整篇重排到目标语法（一次撤销历史）。
 *
 * 提示只报**首个**阻挡者：整层不转时用户需要知道"改哪一个才能继续"，
 * 一次列全反而读不完（且下一次点击仍会重新计算）。
 */
export function applyDocumentSyntax(
	view: MindMapViewContext,
	target: DocumentSyntax,
): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	const tree = mindMap.getData();
	const plan = planDocumentSyntax(tree, target);
	const blocker = plan.blocked[0];
	if (plan.converted === 0) {
		// 一个都没转成时要区分两种原因：本来就达标 vs 整层被挡住（后者必须
		// 说清"是谁挡住了"，否则用户只会看到"无需改动"而不知所措）。
		// `plan` 改的是 `getData()` 的**深拷贝**（含 mdHeadingStart 删除），
		// 这里直接丢弃即可，不会污染引擎（K171）。
		new Notice(
			blocker
				? tf(view.lang, 'syntax.keptList', { text: blocker.text })
				: t(view.lang, 'syntax.none'),
		);
		return;
	}
	replaceMindMapData(mindMap, tree);
	view.scheduleSave();
	updateStatusBar(view);
	const done = tf(view.lang, 'syntax.done', { count: plan.converted });
	new Notice(
		blocker
			? `${done}\n${tf(view.lang, 'syntax.keptList', { text: blocker.text })}`
			: done,
	);
}

/** 挂上守卫的引擎事件（每个引擎实例一次，`setupFeatures` 调用） */
export function setupSyntaxGuard(view: MindMapViewContext): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	// 新一代引擎：上一代的拖拽手势与「刚撤回」闩锁都属于旧实例。`dragging` 不复位
	// 会让此后每轮守卫都被判成「拖拽中」而**静默跳过**（旧引擎在拖拽中途被重建——
	// 换布局 / 改设置刷新——时必然留下这个残值）；未决的去抖任务同样作废。
	const state = guardState(view);
	state.dragging = false;
	state.suppress = false;
	state.debouncer.cancel();
	view.engineEvents.onEngine(mindMap, 'node_dragging', () => {
		state.dragging = true;
	});
	view.engineEvents.onEngine(mindMap, 'node_dragend', () => {
		state.dragging = false;
		state.debouncer.cancel();
		runSyntaxGuard(view);
	});
}

/** `data_change` 后由视图调度（拖拽中不跑，见文件头） */
export function scheduleSyntaxGuard(view: MindMapViewContext): void {
	const state = guardState(view);
	state.debouncer.schedule(() => {
		if (!state.dragging) {
			runSyntaxGuard(view);
		}
	});
}

/** 视图关闭 / 卸载时取消未决的去抖任务 */
export function cancelSyntaxGuard(view: MindMapViewContext): void {
	guards.get(view)?.debouncer.cancel();
	guards.delete(view);
}

/**
 * 跑一次一致性守卫：把兄弟组归一到落点语法（列表父降列表、标题组升标题）。
 *
 * `blocked` 非空 ⇒ 这次编辑（拖拽 / 撤销落回）在目标层无合法形态：**撤回该次
 * 编辑**并提示原因（段落父下挂标题，降级也保不住父子关系）。混合组一落盘，
 * 重开就会被解析成另一棵树——宁可弹回，也不静默写坏文件。
 */
export function runSyntaxGuard(view: MindMapViewContext): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	const state = guardState(view);
	if (state.suppress) {
		// 上一轮刚 `BACK` 撤回：这次 data_change 由撤回自身触发，不再判定
		state.suppress = false;
		return;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return;
	}
	const result = normalizeSiblingSyntax(liveNodeTree(root));
	const blocker = result.blocked[0];
	if (blocker) {
		if (view.undo) {
			// 会话撤销（Level B）：应用通道**不发 `data_change`**，不会重入本守卫，
			// 故不置 `suppress`——置了会吞掉下一次真实编辑的判定。
			view.undo();
		} else {
			state.suppress = true;
			mindMap.execCommand(ENGINE_COMMANDS.BACK);
		}
		new Notice(
			tf(
				view.lang,
				blocker.kind === 'downgrade'
					? 'syntax.guardBlockedDowngrade'
					: 'syntax.guardBlockedUpgrade',
				{ text: blocker.text },
			),
		);
		return;
	}
	if (result.converted > 0) {
		// 就地改的是**引擎活数据**：`data_change` 早已发过（保存排程早于本守卫），
		// 而会话保存自己的权威树 ⇒ 不同步会让「屏上已归一、文件没写」（K188）。
		// 无会话的桩没有这个钩子，它们保存时本来就取引擎快照。
		view.commitDerivedTree?.();
		view.scheduleSave();
		// 降级会丢掉标题身份（大纲条目 / `[[#标题]]` 锚点），比升级更需要
		// 说清：两类降级各有自己的文案，优先级高于升级；只要本轮真有标题被
		// 降级，就换成「N 个标题失去锚点」的文案（2026-11-09，K178）
		const key =
			result.demotedHeadings > 0
				? 'syntax.guardDowngradedAnchors'
				: result.firstDowngraded
					? 'syntax.guardDowngraded'
					: result.firstDemoted
						? 'syntax.guardDemoted'
						: result.firstUpgraded
							? 'syntax.guardUpgraded'
							: // 只剩纯重定级（`##` → `#`）：没有节点「变成标题」，
								// 用不带名字的专属文案（此前会把空名字塞进「改为标题」，K189）
								'syntax.guardReleveled';
		const text =
			result.firstDowngraded ||
			result.firstDemoted ||
			result.firstUpgraded ||
			result.firstReleveled;
		new Notice(
			tf(view.lang, key, { text, count: result.demotedHeadings }),
		);
	}
}


