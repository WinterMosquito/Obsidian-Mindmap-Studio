/**
 * sanitizeSettings 回归（src/settings.ts）。
 *
 * data.json 可能来自历史版本或手工编辑，坏值（language:'fr'、exportScale:'2'、
 * 'true' 伪布尔）一旦直通内存就会流入引擎/导出（NaN 尺寸、错误语言回退、越界档位）。
 * 这里锁定「类型正确 + 取值合法才采纳，其余回退默认」的不变式——data.json 加载与
 * 设置面板写回共用同一份校验。
 *
 * 取值域断言直接引用 constants.ts 的常量（EXPORT_SCALE_MIN/MAX 等），
 * 避免测试里另抄一份魔法数字而与面板定义脱节。
 */
import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_SETTINGS,
	diffLiveRefreshKeys,
	reportDroppedSettings,
	sanitizeSettings,
	type SettingsSanitizeReport,
} from '../src/settings';
import {
	EXPORT_IMAGE_FORMAT_OPTIONS,
	EXPORT_SCALE_MAX,
	EXPORT_SCALE_MIN,
	LAYOUT_OPTIONS,
	SAVE_LOCATION_OPTIONS,
	THEME_OPTIONS,
} from '../src/core/constants';

describe('sanitizeSettings（类型与取值校验）', () => {
	it('空对象返回默认设置，且是全新对象（不得复用 DEFAULT_SETTINGS 引用）', () => {
		const out = sanitizeSettings({});
		expect(out).toEqual(DEFAULT_SETTINGS);
		// 面板会直接改写返回值：共享常量引用会污染后续所有默认值
		expect(out).not.toBe(DEFAULT_SETTINGS);
		out.exportScale = 3;
		expect(DEFAULT_SETTINGS.exportScale).toBe(2);
	});

	/**
	 * 减法护栏（2026-10-09）：下面四项是**已移除**、不是「暂时不暴露」——
	 * 重新加回等于把产品决策改回去，必须是有意识的动作（并同步 README 与 K 条目）：
	 * - `autoUpdateLinks` → 改读**官方设置**（`platform/vault-prefs`）；
	 * - `performanceMode` / `performanceThreshold` → **常开 + 常量阈值**
	 *   （`core/constants.PERFORMANCE_NODE_THRESHOLD`）；
	 * - `selfDrawPlainNodes` → 纯文本节点**常开自绘**（`features/node-inline-content`）。
	 * 另锁一条**产品决策型默认值**：`autoSplitMixedLinks` 默认**关**（自动拆分改写
	 * 用户文件结构，须用户显式开启；批量场景另有显式命令）。
	 */
	it('减法护栏 + 产品决策型默认值（自动拆分混排双链默认关）', () => {
		expect(DEFAULT_SETTINGS.autoSplitMixedLinks).toBe(false);
		for (const removed of [
			'autoUpdateLinks',
			'performanceMode',
			'performanceThreshold',
			'selfDrawPlainNodes',
		]) {
			expect(removed in DEFAULT_SETTINGS).toBe(false);
		}
	});

	it('类型与取值全部合法的键原样保留', () => {
		const out = sanitizeSettings({
			defaultLayout: 'mindMap',
			defaultLineStyle: 'curve',
			defaultTheme: 'dark',
			defaultThemeStyle: 'borderless',
			saveLocation: 'folder',
			saveFolder: '笔记/导图',
			autoSave: false,
			autoSplitMixedLinks: false,
			exportScale: 4,
			enableDrag: false,
			exportImageFormat: 'svg',
			language: 'en',
		});
		expect(out).toEqual({
			defaultLayout: 'mindMap',
			defaultLineStyle: 'curve',
			defaultTheme: 'dark',
			defaultThemeStyle: 'borderless',
			saveLocation: 'folder',
			saveFolder: '笔记/导图',
			autoSave: false,
			autoSplitMixedLinks: false,
			exportScale: 4,
			enableDrag: false,
			exportImageFormat: 'svg',
			language: 'en',
		});
	});

	it('defaultThemeStyle 白名单：合法边框样式保留，未知值与旧数据回退默认', () => {
		expect(
			sanitizeSettings({ defaultThemeStyle: 'borderless' }).defaultThemeStyle,
		).toBe('borderless');
		expect(
			sanitizeSettings({ defaultThemeStyle: 'default' }).defaultThemeStyle,
		).toBe('default');
		for (const bad of ['nope', '', 'BORDERLESS', 42, null]) {
			expect(
				sanitizeSettings({ defaultThemeStyle: bad }).defaultThemeStyle,
				String(bad),
			).toBe('default');
		}
		// 缺省（存量 data.json 无此键）同样落到「有边框」
		expect(sanitizeSettings({}).defaultThemeStyle).toBe('default');
	});

	it('defaultLineStyle 白名单：两态保留，旧词汇 auto/direct 与坏值回退折线', () => {
		expect(sanitizeSettings({ defaultLineStyle: 'curve' }).defaultLineStyle).toBe(
			'curve',
		);
		expect(
			sanitizeSettings({ defaultLineStyle: 'straight' }).defaultLineStyle,
		).toBe('straight');
		// 2026-10-21 两态收敛：auto（随布局）/ direct（直连）不再是合法值
		for (const legacy of ['auto', 'direct', 'zigzag', 42]) {
			expect(
				sanitizeSettings({ defaultLineStyle: legacy }).defaultLineStyle,
				String(legacy),
			).toBe(DEFAULT_SETTINGS.defaultLineStyle);
		}
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

	it('数字字符串宽容转换（历史 data.json 里的 "2"）', () => {
		const out = sanitizeSettings({ exportScale: '2' });
		expect(out.exportScale).toBe(2);
		// 前后空白同样接受（手改文件常见）
		expect(sanitizeSettings({ exportScale: ' 3 ' }).exportScale).toBe(3);
	});

	it('非数字/非有限/空白字符串的数值回退默认，不产生 NaN', () => {
		expect(sanitizeSettings({ exportScale: 'abc' }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(sanitizeSettings({ exportScale: '' }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(sanitizeSettings({ exportScale: '   ' }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(sanitizeSettings({ exportScale: Number.NaN }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(sanitizeSettings({ exportScale: Number.POSITIVE_INFINITY }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
		expect(sanitizeSettings({ exportScale: Number.NEGATIVE_INFINITY }).exportScale).toBe(
			DEFAULT_SETTINGS.exportScale,
		);
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
		expect(sanitizeSettings({ autoSplitMixedLinks: null }).autoSplitMixedLinks).toBe(
			DEFAULT_SETTINGS.autoSplitMixedLinks,
		);
		// 合法布尔即使是 false 也必须保留（false 不等于"缺失"）
		expect(sanitizeSettings({ autoSave: false }).autoSave).toBe(false);
		expect(sanitizeSettings({ enableDrag: false }).enableDrag).toBe(false);
		// 自动拆分默认关（false）→ 开启必须被采纳
		expect(sanitizeSettings({ autoSplitMixedLinks: true }).autoSplitMixedLinks).toBe(
			true,
		);
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
		// 域内整数原样保留
		expect(sanitizeSettings({ exportScale: EXPORT_SCALE_MAX }).exportScale).toBe(
			EXPORT_SCALE_MAX,
		);
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

	it('saveFolder 过官方 normalizePath（粘贴的反斜杠路径不致静默回落库根）', () => {
		// 只断言与桩一致的形态：桩刻意只实现「反斜杠→正斜杠」（见
		// tests/mocks/obsidian.ts 的说明——真实实现还去重复/首尾斜杠，但那会
		// 波及 URL 形态调用点的观测实参）
		expect(sanitizeSettings({ saveFolder: '笔记\\导图' }).saveFolder).toBe(
			'笔记/导图',
		);
		// 空值仍是空值（库根语义，不能变成 '/'）
		expect(sanitizeSettings({ saveFolder: '' }).saveFolder).toBe('');
		// 归一不放松类型校验：非字符串照旧回退默认
		expect(sanitizeSettings({ saveFolder: 42 }).saveFolder).toBe(
			DEFAULT_SETTINGS.saveFolder,
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

	it('保存位置白名单（四态）：SAVE_LOCATION_OPTIONS 全量合法，清单外的值回退默认', () => {
		for (const option of SAVE_LOCATION_OPTIONS) {
			expect(sanitizeSettings({ saveLocation: option.value }).saveLocation).toBe(
				option.value,
			);
		}
		expect(sanitizeSettings({ saveLocation: 'desktop' }).saveLocation).toBe(
			DEFAULT_SETTINGS.saveLocation,
		);
		expect(sanitizeSettings({ saveLocation: 3 }).saveLocation).toBe(
			DEFAULT_SETTINGS.saveLocation,
		);
		expect(sanitizeSettings({ saveLocation: null }).saveLocation).toBe(
			DEFAULT_SETTINGS.saveLocation,
		);
		// 默认档＝跟随官方「新建笔记的默认位置」（引入本设置前的行为口径）
		expect(DEFAULT_SETTINGS.saveLocation).toBe('obsidian');
	});

	it('目标文件夹（saveFolder）只认字符串，非字符串回退默认并留痕', () => {
		expect(sanitizeSettings({ saveFolder: '笔记/导图' }).saveFolder).toBe(
			'笔记/导图',
		);
		// 空串合法（＝未配置，创建时回落库根）；不做存在性校验（可先配后建）
		expect(sanitizeSettings({ saveFolder: '' }).saveFolder).toBe('');
		expect(sanitizeSettings({ saveFolder: 42 }).saveFolder).toBe(
			DEFAULT_SETTINGS.saveFolder,
		);
		const report: SettingsSanitizeReport = { dropped: [] };
		sanitizeSettings({ saveFolder: 42 }, report);
		expect(report.dropped).toContain('saveFolder');
	});

	it('导出格式白名单：EXPORT_IMAGE_FORMAT_OPTIONS 全量合法，清单外的值回退默认', () => {
		for (const option of EXPORT_IMAGE_FORMAT_OPTIONS) {
			expect(
				sanitizeSettings({ exportImageFormat: option.value }).exportImageFormat,
			).toBe(option.value);
		}
		const report: SettingsSanitizeReport = { dropped: [] };
		expect(
			sanitizeSettings({ exportImageFormat: 'jpg' }, report).exportImageFormat,
		).toBe(DEFAULT_SETTINGS.exportImageFormat);
		expect(report.dropped, '非法格式须留痕').toContain('exportImageFormat');
		expect(
			sanitizeSettings({ exportImageFormat: 42 }).exportImageFormat,
		).toBe(DEFAULT_SETTINGS.exportImageFormat);
	});

	it('部分非法键只影响自身：合法键仍被采纳', () => {
		const out = sanitizeSettings({
			defaultLayout: 'fishbone',
			defaultTheme: 'not-a-theme',
			exportScale: 'abc',
			language: 'en',
			autoSave: 'yes',
		});
		expect(out).toEqual({
			defaultLayout: 'fishbone',
			defaultLineStyle: DEFAULT_SETTINGS.defaultLineStyle,
			defaultTheme: DEFAULT_SETTINGS.defaultTheme,
			defaultThemeStyle: DEFAULT_SETTINGS.defaultThemeStyle,
			saveLocation: DEFAULT_SETTINGS.saveLocation,
			saveFolder: DEFAULT_SETTINGS.saveFolder,
			exportScale: DEFAULT_SETTINGS.exportScale,
			language: 'en',
			autoSave: DEFAULT_SETTINGS.autoSave,
			autoSplitMixedLinks: DEFAULT_SETTINGS.autoSplitMixedLinks,
			enableDrag: DEFAULT_SETTINGS.enableDrag,
			exportImageFormat: DEFAULT_SETTINGS.exportImageFormat,
		});
	});
});

describe('diffLiveRefreshKeys（设置变更的最小刷新差集）', () => {
	/**
	 * 即时刷新键的完整清单（settings.ts 内部常量）：这里按**字面量**钉住契约——
	 * 增删即时刷新键必须同步改这份清单，避免差集悄悄漏键（视图侧就不再收到刷新）。
	 */
	const LIVE_REFRESH_KEYS = [
		'defaultLayout',
		'defaultLineStyle',
		'defaultTheme',
		'defaultThemeStyle',
		'enableDrag',
		'language',
	];

	it('首次应用（无快照）返回全部即时刷新键：视图走最完整路径', () => {
		const changed = diffLiveRefreshKeys(null, DEFAULT_SETTINGS);
		expect([...changed].sort()).toEqual([...LIVE_REFRESH_KEYS].sort());
	});

	it('无变化返回空集：视图不做任何刷新（不重建引擎）', () => {
		const changed = diffLiveRefreshKeys(
			{ ...DEFAULT_SETTINGS },
			{ ...DEFAULT_SETTINGS },
		);
		expect(changed.size).toBe(0);
	});

	it('只反映真变化的键（含「与新默认值同形」的 falsy 边界）', () => {
		expect([
			...diffLiveRefreshKeys(
				{ ...DEFAULT_SETTINGS },
				{ ...DEFAULT_SETTINGS, defaultTheme: 'dark' },
			),
		]).toEqual(['defaultTheme']);

		// enableDrag 默认 true → 置 false 必须算作变化（falsy 不等于「没变」）
		expect([
			...diffLiveRefreshKeys(
				{ ...DEFAULT_SETTINGS },
				{ ...DEFAULT_SETTINGS, enableDrag: false },
			),
		]).toEqual(['enableDrag']);

		// 非即时刷新键（导出倍率 / 自动保存）变化不触发任何视图刷新
		expect(
			diffLiveRefreshKeys(
				{ ...DEFAULT_SETTINGS },
				{ ...DEFAULT_SETTINGS, exportScale: 4, autoSave: false },
			).size,
		).toBe(0);
	});

	it('多键同时变化返回并集（主题与语言同改落在同一防抖窗口）', () => {
		const changed = diffLiveRefreshKeys(
			{ ...DEFAULT_SETTINGS },
			{
				...DEFAULT_SETTINGS,
				enableDrag: false,
				defaultTheme: 'light',
				language: 'en',
			},
		);
		expect([...changed].sort()).toEqual([
			'defaultTheme',
			'enableDrag',
			'language',
		]);
	});
});

/**
 * 非法设置的回退**必须可见**（2026-10-11）。
 *
 * 背景：坏值此前静默回退默认，用户看到的现象是「设置没生效」——属无痕退化
 * （AGENTS.md 决策表）。现在 `sanitizeSettings` 支持可选出参登记被回退/钳制的键，
 * 由 `reportDroppedSettings` 汇总留痕一次。
 */
describe('sanitizeSettings：非法值诊断报告', () => {
	const newReport = (): SettingsSanitizeReport => ({ dropped: [] });

	it('缺失键不进报告（全新安装 / 只改过一个键都不刷屏）', () => {
		const empty = newReport();
		sanitizeSettings({}, empty);
		expect(empty.dropped).toEqual([]);

		const partial = newReport();
		sanitizeSettings({ autoSave: false }, partial);
		expect(partial.dropped).toEqual([]);
	});

	it('类型错误 / 白名单外 / 语言非法：逐键登记（无值的不登记）', () => {
		const report = newReport();
		sanitizeSettings(
			{
				language: 'fr', // 非 zh/en
				defaultLayout: 'zigzag', // 白名单外
				defaultLineStyle: 42, // 类型错误
				autoSave: 'true', // 伪布尔
				exportScale: 'abc', // 非数字
				defaultTheme: 'dark', // 合法：不该出现
			},
			report,
		);
		expect([...report.dropped].sort()).toEqual([
			'autoSave',
			'defaultLayout',
			'defaultLineStyle',
			'exportScale',
			'language',
		]);
	});

	it('钳制（越界 / 小数）同样登记：坏值不直达引擎，但用户要知道改过', () => {
		const clamped = newReport();
		sanitizeSettings({ exportScale: 99 }, clamped);
		expect(clamped.dropped).toEqual(['exportScale']);

		const rounded = newReport();
		sanitizeSettings({ exportScale: 2.6 }, rounded);
		expect(rounded.dropped).toEqual(['exportScale']);

		// 域内整数是正常输入
		const ok = newReport();
		sanitizeSettings({ exportScale: 3 }, ok);
		expect(ok.dropped).toEqual([]);
	});

	it('宽容转换与未知键都不登记（历史 "2"、viewState 之外的杂键）', () => {
		const report = newReport();
		sanitizeSettings({ exportScale: ' 3 ', evil: 'x' }, report);
		expect(report.dropped).toEqual([]);
	});

	it('reportDroppedSettings：空清单不输出；非空汇总一次带统一前缀（进程内幂等）', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		reportDroppedSettings([]);
		expect(warnSpy).not.toHaveBeenCalled();

		reportDroppedSettings(['language', 'exportScale']);
		reportDroppedSettings(['defaultLayout']);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const message = String(warnSpy.mock.calls[0]?.[0]);
		expect(message).toContain('MindMap Studio：');
		expect(message).toContain('language、exportScale');

		warnSpy.mockRestore();
	});
});
