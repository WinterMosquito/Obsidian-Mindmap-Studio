import { App, Plugin, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import {
	EXPORT_SCALE_MAX,
	EXPORT_SCALE_MIN,
	LAYOUT_OPTIONS,
	PERFORMANCE_THRESHOLD_MAX,
	PERFORMANCE_THRESHOLD_MIN,
	THEME_OPTIONS,
} from './constants';
import { Language, LANGUAGE_OPTIONS, t } from './i18n';

/**
 * MindMapStudioSettingTab 对宿主插件的窄化契约。
 * 仅包含设置面板实际使用的成员（读写设置 + 持久化 + 视图刷新）。
 * 替代此前的 MindMapStudioPlugin 具体类引用，打破 main ↔ settings 循环依赖。
 */
interface IPluginSettingsHost {
	settings: MindMapStudioSettings;
	scheduleSettingsPersist(): void;
	applySettingsToViews(): void;
	/** 语言变更后刷新命令面板/丝带/状态栏/搜索栏文案 */
	refreshLanguageUi(): void;
}

/** 插件设置 */
export interface MindMapStudioSettings {
	defaultLayout: string;
	defaultTheme: string;
	autoSave: boolean;
	exportScale: number;
	enableDrag: boolean;
	performanceMode: boolean;
	performanceThreshold: number;
	language: Language;
}

export const DEFAULT_SETTINGS: MindMapStudioSettings = {
	defaultLayout: 'logicalStructure',
	defaultTheme: 'default',
	autoSave: true,
	exportScale: 2,
	enableDrag: true,
	// 默认开启性能模式：节点数超过阈值（performanceThreshold）时自动启用
	// 虚拟渲染（仅渲染可视区域节点）。用户可在此关闭。
	performanceMode: true,
	performanceThreshold: 500,
	language: 'zh',
};

/**
 * 校验/归一化从 data.json 读出的设置。历史或手工数据可能含非法类型
 * （如 language:'fr'、exportScale:'2'、performanceThreshold:'abc'），
 * 直接 Object.assign 会让坏值覆盖默认值并流入运算（NaN/错误语言回退）。
 * 只采纳「类型正确 + 取值合法」的键，其余用默认值。
 */
export function sanitizeSettings(
	raw: Record<string, unknown>,
): MindMapStudioSettings {
	const pickString = (key: keyof MindMapStudioSettings): string | undefined => {
		const value = raw[key];
		return typeof value === 'string' ? value : undefined;
	};
	const pickNumber = (key: keyof MindMapStudioSettings): number | undefined => {
		const value = raw[key];
		const num =
			typeof value === 'number'
				? value
				: typeof value === 'string' && value.trim() !== ''
					? Number(value)
					: NaN;
		return Number.isFinite(num) ? num : undefined;
	};
	const pickBool = (key: keyof MindMapStudioSettings): boolean | undefined => {
		const value = raw[key];
		return typeof value === 'boolean' ? value : undefined;
	};
	/** 白名单取值（布局/主题等枚举）：不在清单内即视为非法 → 回退默认 */
	const pickFrom = (
		key: keyof MindMapStudioSettings,
		allowed: readonly { value: string }[],
	): string | undefined => {
		const value = pickString(key);
		return value && allowed.some((option) => option.value === value)
			? value
			: undefined;
	};
	/** 数值钳制（含取整）：坏值不直达引擎/导出（如手改 data.json 的 99） */
	const pickClampedInt = (
		key: keyof MindMapStudioSettings,
		min: number,
		max: number,
	): number | undefined => {
		const value = pickNumber(key);
		if (value === undefined) {
			return undefined;
		}
		return Math.min(max, Math.max(min, Math.round(value)));
	};
	const language = pickString('language');
	return {
		defaultLayout:
			pickFrom('defaultLayout', LAYOUT_OPTIONS) ??
			DEFAULT_SETTINGS.defaultLayout,
		defaultTheme:
			pickFrom('defaultTheme', THEME_OPTIONS) ?? DEFAULT_SETTINGS.defaultTheme,
		autoSave: pickBool('autoSave') ?? DEFAULT_SETTINGS.autoSave,
		exportScale:
			pickClampedInt('exportScale', EXPORT_SCALE_MIN, EXPORT_SCALE_MAX) ??
			DEFAULT_SETTINGS.exportScale,
		enableDrag: pickBool('enableDrag') ?? DEFAULT_SETTINGS.enableDrag,
		performanceMode:
			pickBool('performanceMode') ?? DEFAULT_SETTINGS.performanceMode,
		performanceThreshold:
			pickClampedInt(
				'performanceThreshold',
				PERFORMANCE_THRESHOLD_MIN,
				PERFORMANCE_THRESHOLD_MAX,
			) ?? DEFAULT_SETTINGS.performanceThreshold,
		language:
			language === 'zh' || language === 'en'
				? language
				: DEFAULT_SETTINGS.language,
	};
}

/** 变更后需要即时应用到已打开视图的设置项 */
const LIVE_REFRESH_SETTING_KEYS = new Set<string>([
	'defaultLayout',
	'defaultTheme',
	'enableDrag',
	'performanceMode',
	'performanceThreshold',
	'language',
]);

/** 设置面板 */
export class MindMapStudioSettingTab extends PluginSettingTab {
	declare plugin: Plugin & IPluginSettingsHost;

	constructor(app: App, plugin: Plugin & IPluginSettingsHost) {
		super(app, plugin);
	}

	/** 当前界面语言 */
	private get lang(): Language {
		return this.plugin.settings.language;
	}

	/**
	 * 声明式设置定义（Obsidian 1.13+）：
	 * 新版本用它渲染设置页并获得设置搜索支持；
	 * 1.13 以下自动忽略本方法、回退到 display()。
	 */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		const layoutOptions = Object.fromEntries(
			LAYOUT_OPTIONS.map((option) => [
				option.value,
				t(this.lang, option.label),
			]),
		);
		const themeOptions = Object.fromEntries(
			THEME_OPTIONS.map((option) => [
				option.value,
				t(this.lang, option.label),
			]),
		);
		// 语言下拉选项（label 用语言自身的名字，不随界面语言变化）
		const languageOptions = Object.fromEntries(
			LANGUAGE_OPTIONS.map((option) => [option.value, option.label]),
		);
		return [
			{
				type: 'group',
				heading: t(this.lang, 'settings.title'),
				items: [
					{
						name: t(this.lang, 'settings.language'),
						desc: t(this.lang, 'settings.languageDesc'),
						control: {
							type: 'dropdown',
							key: 'language',
							options: languageOptions,
						},
					},
					{
						name: t(this.lang, 'settings.defaultLayout'),
						desc: t(this.lang, 'settings.defaultLayoutDesc'),
						control: {
							type: 'dropdown',
							key: 'defaultLayout',
							options: layoutOptions,
						},
					},
					{
						name: t(this.lang, 'settings.defaultTheme'),
						desc: t(this.lang, 'settings.defaultThemeDesc'),
						control: {
							type: 'dropdown',
							key: 'defaultTheme',
							options: themeOptions,
						},
					},
					{
						name: t(this.lang, 'settings.autoSave'),
						desc: t(this.lang, 'settings.autoSaveDesc'),
						control: { type: 'toggle', key: 'autoSave' },
					},
					{
						name: t(this.lang, 'settings.enableDrag'),
						desc: t(this.lang, 'settings.enableDragDesc'),
						control: { type: 'toggle', key: 'enableDrag' },
					},
					{
						name: t(this.lang, 'settings.performanceMode'),
						desc: t(this.lang, 'settings.performanceModeDesc'),
						control: { type: 'toggle', key: 'performanceMode' },
					},
					{
						name: t(this.lang, 'settings.performanceThreshold'),
						desc: t(this.lang, 'settings.performanceThresholdDesc'),
						control: {
							type: 'slider',
							key: 'performanceThreshold',
							min: PERFORMANCE_THRESHOLD_MIN,
							max: PERFORMANCE_THRESHOLD_MAX,
							step: 100,
						},
					},
					{
						name: t(this.lang, 'settings.exportScale'),
						desc: t(this.lang, 'settings.exportScaleDesc'),
						control: {
							type: 'slider',
							key: 'exportScale',
							min: EXPORT_SCALE_MIN,
							max: EXPORT_SCALE_MAX,
							step: 1,
						},
					},
				],
			},
		];
	}

	/**
	 * 声明式设置写回（1.13+）：变更设置、持久化，
	 * 并按需即时应用到已打开的视图。
	 *
	 * 写回经 sanitizeSettings 校验归一（与 data.json 加载共用同一不变式），
	 * 不裸写内存对象——宿主对 slider 等控件传值的类型变化不会绕过校验。
	 */
	override setControlValue(key: string, value: unknown): void {
		this.plugin.settings = sanitizeSettings({
			...this.plugin.settings,
			[key]: value,
		});
		// 防抖落盘：滑块等高频控件逐档触发，写盘在 main 侧合并为一次
		//（内存设置已经 sanitizeSettings 即时生效，不受防抖影响）
		this.plugin.scheduleSettingsPersist();
		if (LIVE_REFRESH_SETTING_KEYS.has(key)) {
			this.plugin.applySettingsToViews();
		}
		// 语言切换后：命令面板/丝带/状态栏/搜索栏文案随语言刷新，
		// 并重渲染设置面板以刷新语言。
		// Obsidian 1.13+ 由 getSettingDefinitions() 声明式渲染，display() 已被弃用；
		// 直接调用 display() 会清空容器并叠加一套命令式控件，与声明式渲染冲突，
		// 导致设置面板时而中文时而英文。改用 update() 重新求值并重渲染（仅 1.13+ 走这里）。
		if (key === 'language') {
			this.plugin.refreshLanguageUi();
			this.update();
		}
	}

}
