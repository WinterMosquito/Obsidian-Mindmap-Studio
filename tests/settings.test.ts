/**
 * sanitizeSettings 回归（src/settings.ts）。
 *
 * data.json 可能来自历史版本或手工编辑，坏值（language:'fr'、exportScale:'2'、
 * performanceThreshold:'abc'、'true' 伪布尔）一旦直通内存就会流入引擎/导出
 * （NaN 尺寸、错误语言回退、越界档位）。这里锁定「类型正确 + 取值合法才采纳，
 * 其余回退默认」的不变式——data.json 加载与设置面板写回共用同一份校验。
 *
 * 取值域断言直接引用 constants.ts 的常量（EXPORT_SCALE_MIN/MAX 等），
 * 避免测试里另抄一份魔法数字而与面板定义脱节。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings';
import {
	EXPORT_SCALE_MAX,
	EXPORT_SCALE_MIN,
	LAYOUT_OPTIONS,
	PERFORMANCE_THRESHOLD_MAX,
	PERFORMANCE_THRESHOLD_MIN,
	THEME_OPTIONS,
} from '../src/constants';

describe('sanitizeSettings（类型与取值校验）', () => {
	it('空对象返回默认设置，且是全新对象（不得复用 DEFAULT_SETTINGS 引用）', () => {
		const out = sanitizeSettings({});
		expect(out).toEqual(DEFAULT_SETTINGS);
		// 面板会直接改写返回值：共享常量引用会污染后续所有默认值
		expect(out).not.toBe(DEFAULT_SETTINGS);
		out.performanceThreshold = 1234;
		expect(DEFAULT_SETTINGS.performanceThreshold).toBe(500);
	});

	it('类型与取值全部合法的键原样保留', () => {
		const out = sanitizeSettings({
			defaultLayout: 'mindMap',
			defaultLineStyle: 'direct',
			defaultTheme: 'dark',
			autoSave: false,
			autoSplitMixedLinks: false,
			exportScale: 4,
			enableDrag: false,
			performanceMode: false,
			performanceThreshold: 100,
			language: 'en',
		});
		expect(out).toEqual({
			defaultLayout: 'mindMap',
			defaultLineStyle: 'direct',
			defaultTheme: 'dark',
			autoSave: false,
			autoSplitMixedLinks: false,
			exportScale: 4,
			enableDrag: false,
			performanceMode: false,
			performanceThreshold: 100,
			language: 'en',
		});
	});

	it('defaultLineStyle 白名单校验：合法值保留、非法/坏类型回退 auto', () => {
		expect(sanitizeSettings({ defaultLineStyle: 'direct' }).defaultLineStyle).toBe(
			'direct',
		);
		expect(sanitizeSettings({ defaultLineStyle: 'zigzag' }).defaultLineStyle).toBe(
			DEFAULT_SETTINGS.defaultLineStyle,
		);
		expect(sanitizeSettings({ defaultLineStyle: 42 }).defaultLineStyle).toBe(
			DEFAULT_SETTINGS.defaultLineStyle,
		);
	});

	it('结果键集恒等于设置键集：未知键不混入，缺键有默认值', () => {
		// sanitizeSettings 的返回签名是 MindMapStudioSettings（无索引签名），
		// 故按字段断言而不退化成 Record<string, unknown>
		const out = sanitizeSettings({ evil: 'x', exportScale: 3 });
		expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		expect(out.exportScale).toBe(3);
		// 无键取值 undefined：每个字段都必须落到具体默认值，不留 undefined
		expect(Object.values(out).every((v) => v !== undefined)).toBe(true);
	});

	it('数字字符串宽容转换（历史 data.json 里的 "2" / "800"）', () => {
		const out = sanitizeSettings({
			exportScale: '2',
			performanceThreshold: '800',
		});
		expect(out.exportScale).toBe(2);
		expect(out.performanceThreshold).toBe(800);
		// 前后空白同样接受（手改文件常见）
		expect(sanitizeSettings({ performanceThreshold: ' 800 ' }).performanceThreshold)
			.toBe(800);
	});

	it('非数字/非有限/空白字符串的数值回退默认，不产生 NaN', () => {
		expect(sanitizeSettings({ exportScale: 'abc' }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(sanitizeSettings({ exportScale: '' }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(
			sanitizeSettings({ performanceThreshold: '   ' }).performanceThreshold,
		).toBe(DEFAULT_SETTINGS.performanceThreshold);
		expect(sanitizeSettings({ exportScale: Number.NaN }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(
			sanitizeSettings({ performanceThreshold: Number.POSITIVE_INFINITY })
				.performanceThreshold,
		).toBe(DEFAULT_SETTINGS.performanceThreshold);
		expect(
			sanitizeSettings({ performanceThreshold: Number.NEGATIVE_INFINITY })
				.performanceThreshold,
		).toBe(DEFAULT_SETTINGS.performanceThreshold);
	});

	it('布尔字段只认真布尔：字符串/数字/空值一律回退默认', () => {
		expect(sanitizeSettings({ autoSave: 'true' }).autoSave).toBe(
			DEFAULT_SETTINGS.autoSave,
		);
		expect(sanitizeSettings({ autoSave: 0 }).autoSave).toBe(
			DEFAULT_SETTINGS.autoSave,
		);
		expect(sanitizeSettings({ enableDrag: 1 }).enableDrag).toBe(
			DEFAULT_SETTINGS.enableDrag,
		);
		expect(sanitizeSettings({ performanceMode: null }).performanceMode).toBe(
			DEFAULT_SETTINGS.performanceMode,
		);
		// 合法布尔即使是 false 也必须保留（false 不等于"缺失"）
		expect(sanitizeSettings({ autoSave: false }).autoSave).toBe(false);
		expect(sanitizeSettings({ enableDrag: false }).enableDrag).toBe(false);
	});

	it('数值字段钳制到面板取值域并取整（坏值不直达引擎/导出）', () => {
		expect(sanitizeSettings({ exportScale: 99 }).exportScale).toBe(
			EXPORT_SCALE_MAX,
		);
		expect(sanitizeSettings({ exportScale: 0 }).exportScale).toBe(
			EXPORT_SCALE_MIN,
		);
		expect(sanitizeSettings({ exportScale: -5 }).exportScale).toBe(
			EXPORT_SCALE_MIN,
		);
		expect(sanitizeSettings({ exportScale: 2.6 }).exportScale).toBe(3);
		expect(sanitizeSettings({ exportScale: 2.4 }).exportScale).toBe(2);

		expect(sanitizeSettings({ performanceThreshold: 5 }).performanceThreshold).toBe(
			PERFORMANCE_THRESHOLD_MIN,
		);
		expect(
			sanitizeSettings({ performanceThreshold: 99_999 }).performanceThreshold,
		).toBe(PERFORMANCE_THRESHOLD_MAX);
		expect(
			sanitizeSettings({ performanceThreshold: 149.6 }).performanceThreshold,
		).toBe(150);
		// 域内整数原样保留
		expect(
			sanitizeSettings({ performanceThreshold: PERFORMANCE_THRESHOLD_MAX })
				.performanceThreshold,
		).toBe(PERFORMANCE_THRESHOLD_MAX);
	});

	it('language 只接受 zh/en，其余（含非字符串）回退默认', () => {
		expect(sanitizeSettings({ language: 'en' }).language).toBe('en');
		expect(sanitizeSettings({ language: 'zh' }).language).toBe('zh');
		expect(sanitizeSettings({ language: 'fr' }).language).toBe(
			DEFAULT_SETTINGS.language,
		);
		expect(sanitizeSettings({ language: 42 }).language).toBe(
			DEFAULT_SETTINGS.language,
		);
		expect(sanitizeSettings({ language: 'EN' }).language).toBe(
			DEFAULT_SETTINGS.language,
		);
		expect(sanitizeSettings({ language: '' }).language).toBe(
			DEFAULT_SETTINGS.language,
		);
	});

	it('布局白名单：LAYOUT_OPTIONS 全量合法，清单外的值回退默认', () => {
		for (const option of LAYOUT_OPTIONS) {
			expect(sanitizeSettings({ defaultLayout: option.value }).defaultLayout)
				.toBe(option.value);
		}
		expect(sanitizeSettings({ defaultLayout: 'bogusLayout' }).defaultLayout).toBe(
			DEFAULT_SETTINGS.defaultLayout,
		);
		expect(sanitizeSettings({ defaultLayout: 7 }).defaultLayout).toBe(
			DEFAULT_SETTINGS.defaultLayout,
		);
		expect(sanitizeSettings({ defaultLayout: '' }).defaultLayout).toBe(
			DEFAULT_SETTINGS.defaultLayout,
		);
	});

	it('主题白名单：THEME_OPTIONS 全量合法，清单外的值回退默认', () => {
		for (const option of THEME_OPTIONS) {
			expect(sanitizeSettings({ defaultTheme: option.value }).defaultTheme).toBe(
				option.value,
			);
		}
		expect(sanitizeSettings({ defaultTheme: 'bogusTheme' }).defaultTheme).toBe(
			DEFAULT_SETTINGS.defaultTheme,
		);
		expect(sanitizeSettings({ defaultTheme: null }).defaultTheme).toBe(
			DEFAULT_SETTINGS.defaultTheme,
		);
	});

	it('部分非法键只影响自身：合法键仍被采纳', () => {
		const out = sanitizeSettings({
			defaultLayout: 'fishbone',
			defaultTheme: 'not-a-theme',
			exportScale: 3,
			performanceThreshold: 'abc',
			language: 'en',
			autoSave: 'yes',
		});
		expect(out).toEqual({
			defaultLayout: 'fishbone',
			defaultLineStyle: DEFAULT_SETTINGS.defaultLineStyle,
			defaultTheme: DEFAULT_SETTINGS.defaultTheme,
			exportScale: 3,
			performanceThreshold: DEFAULT_SETTINGS.performanceThreshold,
			language: 'en',
			autoSave: DEFAULT_SETTINGS.autoSave,
			autoSplitMixedLinks: DEFAULT_SETTINGS.autoSplitMixedLinks,
			enableDrag: DEFAULT_SETTINGS.enableDrag,
			performanceMode: DEFAULT_SETTINGS.performanceMode,
		});
	});
});
