/**
 * sanitizeSettings 回归测试（settings.ts）。
 *
 * data.json 历史/手工数据可能含非法类型与取值；直接 Object.assign 会让
 * 坏值覆盖默认值并流入运算（NaN、错误语言回退）。这里锁定
 * 「类型正确 + 取值合法才采纳，其余回退默认」的契约。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings';

describe('sanitizeSettings', () => {
	it('空对象返回全默认', () => {
		expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it('类型与取值合法的键原样保留', () => {
		expect(
			sanitizeSettings({
				defaultLayout: 'mindMap',
				defaultTheme: 'dark',
				autoSave: false,
				exportScale: 4,
				enableDrag: false,
				performanceMode: false,
				performanceThreshold: 100,
				language: 'en',
			}),
		).toEqual({
			defaultLayout: 'mindMap',
			defaultTheme: 'dark',
			autoSave: false,
			exportScale: 4,
			enableDrag: false,
			performanceMode: false,
			performanceThreshold: 100,
			language: 'en',
		});
	});

	it('数字字符串宽容转换（历史数据兼容）', () => {
		const out = sanitizeSettings({ exportScale: '2', performanceThreshold: '800' });
		expect(out.exportScale).toBe(2);
		expect(out.performanceThreshold).toBe(800);
	});

	it('非有限数字与纯空白字符串回退默认', () => {
		const out = sanitizeSettings({
			exportScale: 'abc',
			performanceThreshold: '   ',
		});
		expect(out.exportScale).toBe(DEFAULT_SETTINGS.exportScale);
		expect(out.performanceThreshold).toBe(DEFAULT_SETTINGS.performanceThreshold);
	});

	it('NaN/Infinity/对象等非法类型回退默认', () => {
		const out = sanitizeSettings({
			exportScale: Number.NaN,
			performanceThreshold: Number.POSITIVE_INFINITY,
			autoSave: 'true',
			enableDrag: 1,
		});
		expect(out.exportScale).toBe(DEFAULT_SETTINGS.exportScale);
		expect(out.performanceThreshold).toBe(DEFAULT_SETTINGS.performanceThreshold);
		expect(out.autoSave).toBe(DEFAULT_SETTINGS.autoSave);
		expect(out.enableDrag).toBe(DEFAULT_SETTINGS.enableDrag);
	});

	it('language 只接受 zh/en，其余回退默认', () => {
		expect(sanitizeSettings({ language: 'fr' }).language).toBe(
			DEFAULT_SETTINGS.language,
		);
		expect(sanitizeSettings({ language: 42 }).language).toBe(
			DEFAULT_SETTINGS.language,
		);
		expect(sanitizeSettings({ language: 'en' }).language).toBe('en');
	});

	it('布局/主题白名单：非法值回退默认，合法值保留', () => {
		const bad = sanitizeSettings({
			defaultLayout: 'bogusLayout',
			defaultTheme: 'bogusTheme',
		});
		expect(bad.defaultLayout).toBe(DEFAULT_SETTINGS.defaultLayout);
		expect(bad.defaultTheme).toBe(DEFAULT_SETTINGS.defaultTheme);
		expect(sanitizeSettings({ defaultLayout: 'fishbone' }).defaultLayout).toBe(
			'fishbone',
		);
		expect(sanitizeSettings({ defaultTheme: 'light' }).defaultTheme).toBe(
			'light',
		);
	});

	it('数值钳制到面板取值域并取整（坏值不直达引擎/导出）', () => {
		expect(sanitizeSettings({ exportScale: 99 }).exportScale).toBe(4);
		expect(sanitizeSettings({ exportScale: 0 }).exportScale).toBe(1);
		expect(sanitizeSettings({ exportScale: 2.6 }).exportScale).toBe(3);
		expect(
			sanitizeSettings({ performanceThreshold: 5 }).performanceThreshold,
		).toBe(100);
		expect(
			sanitizeSettings({ performanceThreshold: 99999 }).performanceThreshold,
		).toBe(2000);
	});

	it('未知键不混入结果', () => {
		const out = sanitizeSettings({ evil: 'x', exportScale: 3 });
		expect(Object.keys(out).sort()).toEqual(
			Object.keys(DEFAULT_SETTINGS).sort(),
		);
		expect(out.exportScale).toBe(3);
	});
});
