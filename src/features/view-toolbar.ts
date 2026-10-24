/**
 * 工具栏：**右缘竖排图标栈**（2026-10-22 第三版排布，对齐 Obsidian Canvas）。
 *
 * ## 布局
 * **四组**从右上方自上而下（组间 8px 间距，组内 32×32 图标）：
 * 1. 文档：返回 Markdown / 导出图片
 * 2. 外观：边框 / 连线（**状态开关**，点一下切到另一个值）
 * 3. 视图：放大 / 重置缩放 / 总览全局 / 整理 / 缩小
 * 4. 历史：撤销 / 重做
 *
 * ## 为什么这么排
 * - 外观四项拆两处入口：**边框 / 连线**是两态开关，留在屏上一点即切；
 *   **布局 / 配色**要「从多个值里选一个」，移入**右键菜单的二级菜单**
 *   （`view-context-menu.ts`），屏上不再占位；
 * - 顺序对齐 Canvas 右栏（缩放四件 → 撤销 → 重做），用户的鼠标行程可复用肌肉记忆；
 * - 节点级动作（＋子节点 / ＋同级 / 删除 / 插入链接 / 插入图片）一直在右键菜单里，
 *   屏上不重复提供。
 *
 * ## 穿透语义
 * 外层 `.mindmap-toolbar` 只是**穿透层**（`position:absolute; inset:0; pointer-events:none`），
 * 各组 `.mindmap-hud` 各自 `pointer-events:auto`——画布的拖拽/滚轮不受影响。
 * DOM 顺序即键盘 Tab 序。
 */
import { Notice, setIcon, setTooltip } from 'obsidian';
import {
	arrangeMindMap as arrangeMindMapEngine,
	ENGINE_COMMANDS,
	resetZoom,
	supportsLineStyleSwitch,
	zoomInMindMap,
	zoomOutMindMap,
} from '../engine/mindmap';
import { fitToScreen } from './view-viewport';
import { exportImage } from './view-export';
import { t } from '../core/i18n';
import type { MindMapViewContext } from './view-context';

/** 构建工具栏（右缘四组，顺序 = DOM 顺序 = Tab 序） */
export function buildToolbar(view: MindMapViewContext): void {
	const toolbar = view.toolbarEl;
	if (!toolbar) {
		return;
	}
	const rail = toolbar.createDiv('mindmap-hud mindmap-hud--rail');
	buildDocumentGroup(view, rail);
	buildAppearanceGroup(view, rail);
	buildViewportGroup(view, rail);
	buildHistoryGroup(view, rail);
}

/**
 * 组 2：外观开关 —— 边框 / 连线（**点一下切到另一个值**，直接写回 `data.json`）。
 *
 * 这两个是**状态**而非动作：图标本身表达当前值（实线/虚线方框、直线/曲线），
 * 屏上不摆文字（32px 竖栏摆不下，撑宽会挤掉画布），tooltip 只报名字。
 *
 * 写入走 `view.applyThemeStyle` / `view.applyLineStyle`：与右键菜单里的
 * 布局 / 配色共用 `commitPreference` 这一处收口（归一 → 应用引擎 →
 * 记 `viewState[路径]` → 落盘），不在这里另写一份持久化。
 */
function buildAppearanceGroup(
	view: MindMapViewContext,
	rail: HTMLElement,
): void {
	const group = rail.createDiv('mindmap-hud-group');

	/**
	 * 边框：图标随状态切换（有边框＝实线方框／无边框＝虚线方框）。
	 * 悬停文案**极简**——只报名字，状态由图标本身表达（用户 2026-10-23 裁决）。
	 */
	createToggleRow(group, {
		describe: () => ({
			icon:
				view.resolvePreference('themeStyle') === 'borderless'
					? 'square-dashed'
					: 'square',
			tooltip: t(view.lang, 'toolbar.themeStyle'),
		}),
		toggle: () =>
			view.applyThemeStyle(
				view.resolvePreference('themeStyle') === 'borderless'
					? 'default'
					: 'borderless',
			),
	});

	// 固定直线布局（目录组织图 / 时间轴 / 鱼骨图）的连线由布局固有绘制，
	// 切了也没用——按钮置灰，不给假的可切换态。
	if (!supportsLineStyleSwitch(view.resolvePreference('layout'))) {
		createToggleRow(group, {
			describe: () => ({
				icon: 'slash',
				tooltip: t(view.lang, 'toolbar.lineStyle'),
			}),
			disabled: true,
		});
		return;
	}
	createToggleRow(group, {
		describe: () => ({
			// 直线 `slash` / 曲线 `spline`：单笔画成对。
			// （试过 `tilde`——Obsidian 内置 Lucide **没有**该图标，setIcon 静默渲染空 svg，
			//  实测 svg.innerHTML 长度 0；这里记一笔，别再拿它当"更简单的曲线"。）
			icon:
				view.resolvePreference('lineStyle') === 'curve' ? 'spline' : 'slash',
			tooltip: t(view.lang, 'toolbar.lineStyle'),
		}),
		toggle: () =>
			view.applyLineStyle(
				view.resolvePreference('lineStyle') === 'curve' ? 'straight' : 'curve',
			),
	});
}

/** 组 1：文档 —— 返回 Markdown / 导出图片 */
function buildDocumentGroup(view: MindMapViewContext, rail: HTMLElement): void {
	const group = rail.createDiv('mindmap-hud-group');
	// 返回 Markdown：本视图承载的**任何** md 都可用（声明为导图的文件点击即持久降级）
	createToolButton(group, t(view.lang, 'toolbar.backToMarkdown'), 'file-text', () =>
		view.backToMarkdown(),
	);
	createToolButton(group, t(view.lang, 'toolbar.exportImage'), 'image', () => {
		void exportImage(view);
	});
}

/** 组 3：视图 —— 放大 / 重置缩放 / 总览全局 / 整理 / 缩小（对齐 Canvas 右栏顺序） */
function buildViewportGroup(view: MindMapViewContext, rail: HTMLElement): void {
	const group = rail.createDiv('mindmap-hud-group');
	createToolButton(group, t(view.lang, 'toolbar.zoomIn'), 'zoom-in', () =>
		zoomInMindMap(view.mindMap),
	);
	createToolButton(group, t(view.lang, 'toolbar.resetZoom'), 'rotate-ccw', () =>
		resetZoom(view.mindMap),
	);
	createToolButton(group, t(view.lang, 'toolbar.tipFit'), 'maximize', () =>
		fitToScreen(view),
	);
	// 整理：与右键菜单「自动整理」同一动作 —— 同下游 `arrangeMindMap`、同图标 `sparkles`
	// （换图标会被当成两个功能）。夹在「总览」与「缩小」之间：整理只重排、**保留视口**
	// （2026-10-24 起不再 fit），紧邻「总览」正好对应「想看全图」的去处。
	createToolButton(group, t(view.lang, 'toolbar.tipArrange'), 'sparkles', () =>
		arrangeMindMap(view),
	);
	createToolButton(group, t(view.lang, 'toolbar.zoomOut'), 'zoom-out', () =>
		zoomOutMindMap(view.mindMap),
	);
}

/** 组 4：历史 —— 撤销 / 重做 */
function buildHistoryGroup(view: MindMapViewContext, rail: HTMLElement): void {
	const group = rail.createDiv('mindmap-hud-group');
	// 撤销/重做：竖栏只放图标，tooltip 只报动作名（快捷键由命令面板/热键承载）
	createToolButton(group, t(view.lang, 'toolbar.undo'), 'undo', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.BACK);
	});
	createToolButton(group, t(view.lang, 'toolbar.redo'), 'redo', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD);
	});
}

/** 「状态开关」的显示态：图标与 tooltip 都随当前状态（`describe` 每次重算） */
interface ToggleRowState {
	icon: string;
	tooltip: string;
}

/** 可点的开关：必须给 `toggle` */
interface ToggleRowLive {
	/** 按**当前**状态给出图标与提示（切换后要重算，不能只在构建时算一次） */
	describe: () => ToggleRowState;
	toggle: () => void;
}

/** 置灰的开关：固定直线布局下的连线由布局固有绘制，切了也无效 ⇒ 没有可执行动作 */
interface ToggleRowDisabled {
	describe: () => ToggleRowState;
	disabled: true;
}

type ToggleRowSpec = ToggleRowLive | ToggleRowDisabled;

/**
 * 创建「状态开关」按钮：**只显示图标**，图标本身随状态切换
 * （有边框 `square` ↔ 无边框 `square-dashed`；折线 `slash` ↔ 曲线 `spline`）。
 *
 * 屏上不摆文字：两个按钮在 32×32 的竖栏里，文字会把组撑宽、挤掉画布；
 * tooltip 只报名字、状态由图标表达（用户 2026-10-23 裁决）。
 */
function createToggleRow(
	container: HTMLElement,
	spec: ToggleRowSpec,
): HTMLButtonElement {
	const initial = spec.describe();
	if (!('toggle' in spec)) {
		// 置灰态不走 createToolButton：它必然挂 onclick，这里要的是一个没有动作的按钮
		const disabledButton = container.createEl('button', {
			cls: 'mindmap-tool-btn',
		});
		setIcon(disabledButton, initial.icon);
		setTooltip(disabledButton, initial.tooltip);
		disabledButton.disabled = true;
		disabledButton.addClass('is-disabled');
		return disabledButton;
	}
	const button = createToolButton(container, initial.tooltip, initial.icon, () => {
		spec.toggle();
		// 外观变更**不重建工具栏**，所以点击后必须自己把图标/提示同步到新状态，
		// 否则按钮会一直显示点击前的样子（2026-10-23 实机踩到）。
		syncState();
	});
	/** 按当前状态回写图标与提示（构建时一次，之后每次切换一次） */
	function syncState(): void {
		const state = spec.describe();
		setIcon(button, state.icon);
		setTooltip(button, state.tooltip);
	}
	return button;
}

/** 创建工具按钮（提示/图标/点击回调） */
function createToolButton(
	container: HTMLElement,
	tooltip: string,
	icon: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', { cls: 'mindmap-tool-btn' });
	setIcon(button, icon);
	// 官方 tooltip（原生样式/定位；aria-label 由核心写入，不再手写 title）
	setTooltip(button, tooltip);
	button.onclick = onClick;
	return button;
}

/** 自动整理（画布右键菜单 / 命令面板入口）：重新按布局算法对齐（保留当前视口） */
export function arrangeMindMap(view: MindMapViewContext): void {
	if (!view.mindMap) {
		new Notice(t(view.lang, 'common.notLoaded'));
		return;
	}
	if (arrangeMindMapEngine(view.mindMap)) {
		new Notice(t(view.lang, 'common.arrangeDone'));
	} else {
		new Notice(t(view.lang, 'common.arrangeFailed'));
	}
}

/** 设置变更后重建工具栏 */
export function refreshToolbar(view: MindMapViewContext): void {
	if (!view.toolbarEl) {
		return;
	}
	view.toolbarEl.empty();
	buildToolbar(view);
}
