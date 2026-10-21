/**
 * 工具栏逻辑：构建/重建工具栏、工具按钮、自动整理。从 view.ts 拆出。
 * 节点操作（链接/图片/删除）委托给 view-node-actions.ts。
 */
import { Notice, setIcon, setTooltip } from 'obsidian';
import {
	LAYOUT_OPTIONS,
	LINE_STYLE_OPTIONS,
	normalizeLineStylePreference,
} from '../core/constants';
import {
	arrangeMindMap as arrangeMindMapEngine,
	ENGINE_COMMANDS,
	resetZoom,
	supportsLineStyleSwitch,
	zoomInMindMap,
	zoomOutMindMap,
} from '../engine/mindmap';
import { fitToScreen } from './view-viewport';
import { openSearchBar } from './view-search';
import { exportImage } from './view-export';
import {
	addImageToActiveNode,
	addLinkToActiveNode,
	deleteActiveNode,
} from './view-node-actions';
import { t } from '../core/i18n';
import type { MindMapViewContext } from './view-context';

/**
 * 构建工具栏（左：编辑/插入；中：布局；右：画布/导入导出）。
 *
 * 编排壳：三个分组各自独立构建、按原序调用——纯移动，DOM 创建顺序不变。
 */
export function buildToolbar(view: MindMapViewContext): void {
	const toolbar = view.toolbarEl;
	if (!toolbar) {
		return;
	}
	buildToolbarLeftGroup(view, toolbar);
	buildToolbarCenterGroup(view, toolbar);
	buildToolbarRightGroup(view, toolbar);
}

/** 左组：编辑/插入（md 文档模式返回入口 → 节点增删 → 撤销重做 → 整理 → 搜索/链接/图片） */
function buildToolbarLeftGroup(
	view: MindMapViewContext,
	toolbar: HTMLElement,
): void {
	const leftGroup = toolbar.createDiv('mindmap-toolbar-group');
	// 返回 Markdown 编辑/阅读的入口：本视图承载的**任何** md 都可用
	//（声明为导图的文件点击即持久降级，普通笔记开为导图时点击即原样返回）
	createToolButton(
		leftGroup,
		t(view.lang, 'toolbar.backToMarkdown'),
		'file-text',
		() => view.backToMarkdown(),
	);
	leftGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(leftGroup, t(view.lang, 'toolbar.addChild'), 'plus', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.INSERT_CHILD_NODE);
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.addSibling'), 'circle-plus', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.INSERT_NODE);
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.deleteNode'), 'trash-2', () => {
		deleteActiveNode(view);
	});
	leftGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(leftGroup, t(view.lang, 'toolbar.undo'), 'undo', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.BACK);
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.redo'), 'redo', () => {
		view.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD);
	});
	createToolButton(
		leftGroup,
		t(view.lang, 'toolbar.arrange'),
		'sparkles',
		() => arrangeMindMap(view),
	);
	leftGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(leftGroup, t(view.lang, 'toolbar.search'), 'search', () =>
		openSearchBar(view),
	);
	createToolButton(leftGroup, t(view.lang, 'toolbar.insertLink'), 'link', () => {
		void addLinkToActiveNode(view);
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.insertImage'), 'image', () => {
		void addImageToActiveNode(view);
	});
}

/** 中组：布局与连线样式下拉（连线选项面随布局重建，见 syncLineStyleOptions） */
function buildToolbarCenterGroup(
	view: MindMapViewContext,
	toolbar: HTMLElement,
): void {
	const centerGroup = toolbar.createDiv(
		'mindmap-toolbar-group mindmap-toolbar-center',
	);
	centerGroup.createSpan('mindmap-toolbar-label').setText(t(view.lang, 'toolbar.layout'));
	// 局部量持有 select：选项面与初值设置都用它（`view.layoutSelect` 只是暴露给
	// 视图契约的引用，供外部读）。同函数内不混用非空断言与判空——`refreshToolbar`
	// 重建时会重新执行本函数，闭包不会持有旧元素。
	const layoutSelect = centerGroup.createEl('select', {
		cls: 'mindmap-layout-select',
	});
	view.layoutSelect = layoutSelect;
	LAYOUT_OPTIONS.forEach((option) => {
		const optionEl = layoutSelect.createEl('option');
		optionEl.value = option.value;
		optionEl.setText(t(view.lang, option.label));
	});
	layoutSelect.value = view.plugin.settings.defaultLayout;
	layoutSelect.onchange = () => {
		// 布局持久化到视图状态存储（.mindmap.md 正文不写入布局）
		view.applyLayout(layoutSelect.value);
	};

	centerGroup.createDiv('mindmap-toolbar-separator');
	centerGroup.createSpan('mindmap-toolbar-label').setText(
		t(view.lang, 'toolbar.lineStyle'),
	);
	// 视图契约引用照旧（`syncLineStyleOptions` 经 view 读它，且它可能在工具栏尚未
	// 构建时就被调用——那里的判空是必要的）；本函数内一律用局部量，同上。
	const lineStyleSelect = centerGroup.createEl('select', {
		cls: 'mindmap-line-style-select',
	});
	view.lineStyleSelect = lineStyleSelect;
	// 初始按全局默认布局构建选项面；引擎就绪后由 onEngineReady 按文件实际布局校正
	syncLineStyleOptions(
		view,
		view.plugin.settings.defaultLayout,
		view.plugin.settings.defaultLineStyle,
	);
	lineStyleSelect.onchange = () => {
		// 连线样式偏好持久化到视图状态存储（两态：折线 / 曲线；正文不写入）
		view.applyLineStyle(lineStyleSelect.value);
	};
}

/** 右组：画布控制与导出（顺序左→右：重置缩放 → 适应画布 → 放大 → 缩小 → 导出） */
function buildToolbarRightGroup(
	view: MindMapViewContext,
	toolbar: HTMLElement,
): void {
	const rightGroup = toolbar.createDiv(
		'mindmap-toolbar-group mindmap-toolbar-right',
	);
	// 顺序（左→右）：重置缩放 → 适应画布 → 放大 → 缩小 → 导出
	createToolButton(
		rightGroup,
		t(view.lang, 'toolbar.resetZoom'),
		'rotate-ccw',
		() => resetZoom(view.mindMap),
	);
	createToolButton(rightGroup, t(view.lang, 'command.fitCanvas'), 'maximize', () =>
		fitToScreen(view),
	);
	createToolButton(rightGroup, t(view.lang, 'toolbar.zoomIn'), 'zoom-in', () =>
		zoomInMindMap(view.mindMap),
	);
	createToolButton(rightGroup, t(view.lang, 'toolbar.zoomOut'), 'zoom-out', () =>
		zoomOutMindMap(view.mindMap),
	);
	rightGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(rightGroup, t(view.lang, 'toolbar.exportImage'), 'image', () => {
		void exportImage(view);
	});
}

/**
 * 按布局重建连线样式选项集（工具栏「连线」下拉，2026-10-21 收敛为两态）：
 * - 支持切换的布局（逻辑结构图/思维导图/组织结构图）：**折线、曲线**两项，
 *   顺序即界面顺序（折线在上），值＝偏好归一结果；
 * - 固定直线布局（目录组织图/时间轴/鱼骨图）：仅一项「**直线**」——连线由布局类
 *   固定、不可切换，控件只表达**现状**（不再用「自动」这种会让人以为可选的措辞）。
 *   文件里的偏好不受影响：切回支持切换的布局后按会话偏好恢复显示。
 */
export function syncLineStyleOptions(
	view: MindMapViewContext,
	layout: string,
	preference: string,
): void {
	const select = view.lineStyleSelect;
	if (!select) {
		return;
	}
	select.empty();
	if (supportsLineStyleSwitch(layout)) {
		LINE_STYLE_OPTIONS.forEach((option) => {
			const optionEl = select.createEl('option');
			optionEl.value = option.value;
			optionEl.setText(t(view.lang, option.label));
		});
		// 脏 data.json 的未知偏好不落到 select.value（会显示空白）：归一为折线
		select.value = normalizeLineStylePreference(preference);
		return;
	}
	const optionEl = select.createEl('option');
	optionEl.value = 'straight';
	optionEl.setText(t(view.lang, 'lineStyle.fixedStraight'));
	select.value = 'straight';
}

/** 创建工具栏按钮（提示/图标/点击回调） */
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

/** 自动整理（需求 3）：重新按布局算法对齐摆放各主题并适配画布 */
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
