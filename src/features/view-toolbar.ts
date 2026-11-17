/** 工具栏业务适配：分组、外观偏好、视口与会话动作；DOM 由 ui/toolbar 持有。 */
import { Notice } from 'obsidian';
import {
	arrangeMindMap as arrangeMindMapEngine,
	ENGINE_COMMANDS,
	readHistoryAvailability,
	resetZoom,
	supportsLineStyleSwitch,
	zoomInMindMap,
	zoomOutMindMap,
} from '../engine/mindmap';
import { Toolbar, type ToolbarButtonSpec } from '../ui/toolbar/toolbar';
import { fitToScreen } from './view-viewport';
import { exportImage } from './view-export';
import { refreshMiniMapAfterRender } from './view-minimap';
import { t, type TranslationKey } from '../core/i18n';
import type { MindMapViewContext } from './view-context';

const toolbars = new WeakMap<HTMLElement, Toolbar>();

/** 四组 / 十按钮 / DOM 顺序即 Tab 序。整理保留在右键与命令面板。 */
export function buildToolbar(view: MindMapViewContext): void {
	if (!view.toolbarEl) return;
	disposeToolbar(view);
	const action = (id: string, key: TranslationKey, icon: string, onClick: () => void): ToolbarButtonSpec => ({
		id, describe: () => ({ icon, tooltip: t(view.lang, key) }), onClick,
	});
	const history = (id: 'undo' | 'redo'): ToolbarButtonSpec => ({
		id,
		describe: () => {
			const availability = view.historyAvailability?.() ?? readHistoryAvailability(view.mindMap);
			return {
				icon: id, tooltip: t(view.lang, `toolbar.${id}`),
				disabled: !(id === 'undo' ? availability.canUndo : availability.canRedo),
			};
		},
		onClick: () => {
			if (view[id]) view[id]();
			else view.mindMap?.execCommand(id === 'undo' ? ENGINE_COMMANDS.BACK : ENGINE_COMMANDS.FORWARD);
			syncHistoryButtons(view);
		},
	});
	const lineSwitch = supportsLineStyleSwitch(view.resolveLayout());
	const toolbar = new Toolbar(view.toolbarEl, [
		[
			action('markdown', 'toolbar.backToMarkdown', 'file-text', () => view.backToMarkdown()),
			action('export', 'toolbar.exportImage', 'image', () => { void exportImage(view); }),
		],
		[
			{
				id: 'border',
				describe: () => ({
					icon: view.resolvePreference('themeStyle') === 'borderless' ? 'square-dashed' : 'square',
					tooltip: t(view.lang, 'toolbar.themeStyle'),
					pressed: view.resolvePreference('themeStyle') !== 'borderless',
				}),
				onClick: () => view.applyThemeStyle(view.resolvePreference('themeStyle') === 'borderless' ? 'default' : 'borderless'),
			},
			{
				id: 'line',
				describe: () => ({
					icon: lineSwitch && view.resolvePreference('lineStyle') === 'curve' ? 'spline' : 'slash',
					tooltip: t(view.lang, 'toolbar.lineStyle'),
					...(lineSwitch ? { pressed: view.resolvePreference('lineStyle') === 'curve' } : { disabled: true }),
				}),
				...(lineSwitch ? { onClick: () => view.applyLineStyle(view.resolvePreference('lineStyle') === 'curve' ? 'straight' : 'curve') } : {}),
			},
		],
		[
			action('zoom-in', 'toolbar.zoomIn', 'zoom-in', () => zoomInMindMap(view.mindMap)),
			action('reset', 'toolbar.resetZoom', 'rotate-ccw', () => resetZoom(view.mindMap)),
			action('fit', 'toolbar.tipFit', 'maximize', () => fitToScreen(view)),
			action('zoom-out', 'toolbar.zoomOut', 'zoom-out', () => zoomOutMindMap(view.mindMap)),
		],
		[history('undo'), history('redo')],
	]);
	toolbars.set(view.toolbarEl, toolbar);
}

/** 只读会话可用性；无会话的测试桩沿用引擎判据。 */
export function syncHistoryButtons(view: MindMapViewContext): void {
	if (view.toolbarEl) toolbars.get(view.toolbarEl)?.refresh(['undo', 'redo']);
}

export function disposeToolbar(view: MindMapViewContext): void {
	if (!view.toolbarEl) return;
	toolbars.get(view.toolbarEl)?.dispose();
	toolbars.delete(view.toolbarEl);
}

/** 自动整理（画布右键菜单 / 命令面板入口）：重新按布局算法对齐（保留当前视口） */
export function arrangeMindMap(view: MindMapViewContext): void {
	if (!view.mindMap) {
		new Notice(t(view.lang, 'common.notLoaded'));
		return;
	}
	if (arrangeMindMapEngine(view.mindMap)) {
		// 重排是异步分片的（`RESET_LAYOUT` → 根未回填轮询 → 80ms 后 fit）：当场取样
		// 只能拿到旧几何，还会白耗 30s 刷新窗口。挂「渲染落地补画」，与切布局同一条
		// 通道；不刷则整图轮廓变化要等半分钟才反映到缩略图。
		refreshMiniMapAfterRender(view);
		new Notice(t(view.lang, 'common.arrangeDone'));
	} else {
		new Notice(t(view.lang, 'common.arrangeFailed'));
	}
}

/** 布局/语言变化后重建规格，旧组件先清理自己的 DOM 与回调。 */
export function refreshToolbar(view: MindMapViewContext): void {
	buildToolbar(view);
}
