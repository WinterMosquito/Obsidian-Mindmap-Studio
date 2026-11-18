/** K216：持久化归一、声明式双语控件与即时写回走同一设置入口。 */
import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { t } from '../src/core/i18n';
import { DEFAULT_SETTINGS, diffLiveRefreshKeys, MindMapStudioSettingTab, sanitizeSettings } from '../src/settings';

describe('画布热键拖拽设置', () => {
	it('缺省开启，合法 false 可保存；坏值回退并留痕，加载不修改输入', () => {
		expect(DEFAULT_SETTINGS.dragCanvasWithModifier).toBe(true);
		const raw = Object.freeze({ dragCanvasWithModifier: false });
		expect(sanitizeSettings(raw).dragCanvasWithModifier).toBe(false);
		expect(sanitizeSettings(JSON.parse(JSON.stringify(raw)) as Record<string, unknown>).dragCanvasWithModifier).toBe(false);
		for (const value of ['false', 'true', 0, 1, null, {}, []]) {
			const report = { dropped: [] as string[] };
			expect(sanitizeSettings({ dragCanvasWithModifier: value }, report).dragCanvasWithModifier).toBe(true);
			expect(report.dropped).toEqual(['dragCanvasWithModifier']);
		}
		const report = { dropped: [] as string[] };
		expect(sanitizeSettings({}, report).dragCanvasWithModifier).toBe(true);
		expect(report.dropped).toEqual([]);
	});

	it('面板定义与写回：原名、双语、持久化及即时刷新', () => {
		const persist = vi.fn(), refresh = vi.fn(), cleanup = vi.fn();
		const host = {
			settings: { ...DEFAULT_SETTINGS }, scheduleSettingsPersist: persist,
			applySettingsToViews: refresh, offerColorSentinelCleanup: cleanup, refreshLanguageUi: vi.fn(),
		} as unknown as ConstructorParameters<typeof MindMapStudioSettingTab>[1];
		const tab = new MindMapStudioSettingTab({} as App, host);
		tab.plugin = host;
		tab.containerEl = { addClass: vi.fn() } as unknown as HTMLElement;
		for (const language of ['zh', 'en'] as const) {
			host.settings.language = language;
			const items = tab.getSettingDefinitions().flatMap(item => 'items' in item ? item.items ?? [] : [item]);
			const setting = items.find(item => 'control' in item && item.control?.key === 'dragCanvasWithModifier');
			expect(setting).toMatchObject({ name: t(language, 'settings.dragCanvasWithModifier'), control: { type: 'toggle' } });
		}
		expect(t('zh', 'settings.dragCanvasWithModifier')).toBe('基于热键拖拽(若不开启则按住鼠标拖拽时移动导图)');
		const previous = { ...host.settings };
		tab.setControlValue('dragCanvasWithModifier', false);
		expect(host.settings.dragCanvasWithModifier).toBe(false);
		expect([...diffLiveRefreshKeys(previous, host.settings)]).toEqual(['dragCanvasWithModifier']);
		expect(persist).toHaveBeenCalledOnce();
		expect(refresh).toHaveBeenCalledOnce();
		expect(cleanup).not.toHaveBeenCalled();
	});
});
