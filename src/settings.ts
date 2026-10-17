import {
	App,
	normalizePath,
	Plugin,
	PluginSettingTab,
	type SettingDefinitionItem,
} from 'obsidian';
import {
	EXPORT_IMAGE_FORMAT_OPTIONS,
	EXPORT_SCALE_MAX,
	EXPORT_SCALE_MIN,
	LAYOUT_OPTIONS,
	LINE_STYLE_OPTIONS,
	SAVE_LOCATION_OPTIONS,
	THEME_OPTIONS,
	type ExportImageFormat,
	type SaveLocation,
} from './core/constants';
import { Language, LANGUAGE_OPTIONS, t, type TranslationKey } from './core/i18n';
import { createWarnOnce } from './core/errors';

/**
 * MindMapStudioSettingTab 对宿主插件的窄化契约。
 * 仅包含设置面板实际使用的成员（读写设置 + 持久化 + 视图刷新）。
 * 替代此前的 MindMapStudioPlugin 具体类引用，打破 main ↔ settings 循环依赖。
 */
interface SettingsHost {
	settings: MindMapStudioSettings;
	scheduleSettingsPersist(): void;
	applySettingsToViews(): void;
	/** 语言变更后刷新命令面板/丝带/状态栏/搜索栏文案 */
	refreshLanguageUi(): void;
}

/** 插件设置 */
export interface MindMapStudioSettings {
	defaultLayout: string;
	/** 默认连线样式（auto/curve/direct/straight；auto＝随布局） */
	defaultLineStyle: string;
	defaultTheme: string;
	/**
	 * 新建导图的默认保存位置（四态，见 `core/constants` 的 `SaveLocation`）。
	 * 默认 `obsidian`：完整跟随官方「设置 → 文件与链接 → 新建笔记的默认位置」；
	 * 其余三态为显式覆盖（与 Obsidian Canvas 同口径）。
	 */
	saveLocation: SaveLocation;
	/** `saveLocation === 'folder'` 时的目标文件夹（库内路径；不存在时回落库根） */
	saveFolder: string;
	autoSave: boolean;
	/**
	 * 被编辑节点含「双链 + 描述文字」时自动拆分为子节点（见 links-split）。
	 *
	 * **默认关闭**（2026-10-09 减法）：自动拆分是**结构性改写用户文件**（把行内
	 * 链接抽成子节点），且自绘节点已能让一行内每枚链接各自可点（`node-inline-content`），
	 * 该结构性补偿不必默认发生。存量 data.json 里已为 `true` 的仍保持开启；
	 * 整篇批处理走显式命令 `mindmap-split-links-all`（不受本设置约束）。
	 */
	autoSplitMixedLinks: boolean;
	exportScale: number;
	enableDrag: boolean;
	/** 导出图片格式（png 位图 / svg 矢量）；点击导出按钮时按此直接导出 */
	exportImageFormat: ExportImageFormat;
	language: Language;
}

export const DEFAULT_SETTINGS: MindMapStudioSettings = {
	defaultLayout: 'logicalStructure',
	// auto：随布局（四种直线布局 straight、两种曲线布局 curve），保持既有观感
	defaultLineStyle: 'auto',
	defaultTheme: 'default',
	// 默认跟随官方「新建笔记的默认位置」（经 getNewFileParent 完整生效）——
	// 与引入本设置前的行为一致；另三档为用户显式覆盖
	saveLocation: 'obsidian',
	// 可先配后建：创建时解析不到（被删/改名）则回落库根，不在此处校验存在性
	saveFolder: '',
	autoSave: true,
	// 默认关闭（2026-10-09 减法）：改写文件结构须由用户显式开启；开启后仅作用于
	// 被编辑节点（存量未编辑节点仍不会被改写），批量场景用显式拆分命令
	autoSplitMixedLinks: false,
	exportScale: 2,
	enableDrag: true,
	exportImageFormat: 'png',
	language: 'zh',
};

/**
 * 校验/归一化的**诊断报告**（可选出参，见 `sanitizeSettings`）。
 * 只登记「在 data.json 里确实给了值、但没被采纳」的键——缺失键是正常情况，
 * 不进报告（否则每次全新安装都会报一串）。
 */
export interface SettingsSanitizeReport {
	/** 被回退默认值或钳制的设置字段名（按出现顺序去重） */
	dropped: string[];
}

/**
 * 「非法设置被回退/钳制」的汇总留痕（进程内一次）。
 *
 * 为什么必须留痕：data.json 可被手工编辑或来自旧版本，坏值**静默**换掉之后，
 * 用户看到的现象是「设置没生效」——属无痕退化（AGENTS.md 决策表：
 * 静默跳过会让问题无痕退化）。汇总一次而不是逐键刷屏。
 */
const warnDroppedSettings = createWarnOnce();

export function reportDroppedSettings(dropped: readonly string[]): void {
	if (dropped.length === 0) {
		return;
	}
	warnDroppedSettings(
		`设置项取值非法，已回退默认或被钳制：${dropped.join('、')}`,
	);
}

/**
 * 校验/归一化从 data.json 读出的设置。历史或手工数据可能含坏值
 * （如 language:'fr'、enableDrag:'yes'、exportScale:'abc'），
 * 直接 Object.assign 会让坏值覆盖默认值并流入运算（NaN/错误语言回退）。
 * 只采纳「类型正确 + 取值合法」的键，其余用默认值；数值键额外**宽容**
 * 纯数字字符串（历史 data.json 里的 `"2"` / `" 3 "` → Number 转换后按钳制域校验，
 * 见 tests/settings.test.ts「数字字符串宽容转换」；此前注释误把 `'2'` 列为被回退）。
 *
 * @param report 可选出参：填入被回退/钳制的键（调用方交给
 *   `reportDroppedSettings` 留痕；纯函数语义不变，不传即零开销）。
 */
export function sanitizeSettings(
	raw: Record<string, unknown>,
	report?: SettingsSanitizeReport,
): MindMapStudioSettings {
	// 被回退/钳制的键（有值才登记；缺失键不进报告）
	const dropped = new Set<string>();
	const drop = (key: string): void => {
		dropped.add(key);
	};
	const pickString = (key: keyof MindMapStudioSettings): string | undefined => {
		const value = raw[key];
		if (typeof value === 'string') {
			return value;
		}
		if (value !== undefined) {
			drop(key);
		}
		return undefined;
	};
	/**
	 * 数值候选：数字原型，或**非空白**数字字符串（历史 data.json 的 `"2"` / `" 3 "`）；
	 * 其余一律 NaN（由调用方判定回退）。拆出来是为了让 `pickNumber` 只表达
	 * 「缺失 → 跳过、非有限 → 留痕回退」这一层语义。
	 */
	const toNumber = (value: unknown): number => {
		if (typeof value === 'number') {
			return value;
		}
		if (typeof value === 'string' && value.trim() !== '') {
			return Number(value);
		}
		return Number.NaN;
	};
	const pickNumber = (key: keyof MindMapStudioSettings): number | undefined => {
		const value = raw[key];
		if (value === undefined) {
			return undefined;
		}
		const num = toNumber(value);
		if (Number.isFinite(num)) {
			return num;
		}
		drop(key);
		return undefined;
	};
	const pickBool = (key: keyof MindMapStudioSettings): boolean | undefined => {
		const value = raw[key];
		if (typeof value === 'boolean') {
			return value;
		}
		if (value !== undefined) {
			drop(key);
		}
		return undefined;
	};
	/** 白名单取值（布局/主题/导出格式等枚举）：不在清单内即视为非法 → 回退默认 */
	const pickFrom = <T extends string>(
		key: keyof MindMapStudioSettings,
		allowed: readonly { value: T }[],
	): T | undefined => {
		const value = pickString(key);
		if (value === undefined) {
			return undefined;
		}
		const match = allowed.find((option) => option.value === value);
		if (match) {
			return match.value;
		}
		drop(key);
		return undefined;
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
		const clamped = Math.min(max, Math.max(min, Math.round(value)));
		if (clamped !== value) {
			drop(key);
		}
		return clamped;
	};
	// 语言：白名单取自 `LANGUAGE_OPTIONS`（与设置面板下拉同源），非法值回退默认并留痕
	const language =
		pickFrom('language', LANGUAGE_OPTIONS) ?? DEFAULT_SETTINGS.language;
	// ⚠ 报告必须在**对象字面量求值之后**回填：pick* 是在字面量里被调用的
	//（写在 return 之前会拿到空的 dropped）。
	const settings: MindMapStudioSettings = {
		defaultLayout:
			pickFrom('defaultLayout', LAYOUT_OPTIONS) ??
			DEFAULT_SETTINGS.defaultLayout,
		defaultLineStyle:
			pickFrom('defaultLineStyle', LINE_STYLE_OPTIONS) ??
			DEFAULT_SETTINGS.defaultLineStyle,
		defaultTheme:
			pickFrom('defaultTheme', THEME_OPTIONS) ?? DEFAULT_SETTINGS.defaultTheme,
		saveLocation:
			pickFrom('saveLocation', SAVE_LOCATION_OPTIONS) ??
			DEFAULT_SETTINGS.saveLocation,
		// 纯字符串：文件夹可先配后建，存在性在创建时判定（不可解析才回落库根）。
		// 归一化走**官方** `normalizePath`（d.ts：正斜杠 / 去掉重复与首尾斜杠 /
		// 反斜杠→正斜杠 / 非断行空格→普通空格 / NFC）——不归一的话，从资源管理器
		// 粘贴 `笔记\子目录` 或带尾随斜杠的值会令 `getFolderByPath` 恒 null，
		// 按设计静默回落库根，用户只看到「设置没生效」
		saveFolder: normalizePath(
			pickString('saveFolder') ?? DEFAULT_SETTINGS.saveFolder,
		),
		autoSave: pickBool('autoSave') ?? DEFAULT_SETTINGS.autoSave,
		autoSplitMixedLinks:
			pickBool('autoSplitMixedLinks') ??
			DEFAULT_SETTINGS.autoSplitMixedLinks,
		exportScale:
			pickClampedInt('exportScale', EXPORT_SCALE_MIN, EXPORT_SCALE_MAX) ??
			DEFAULT_SETTINGS.exportScale,
		enableDrag: pickBool('enableDrag') ?? DEFAULT_SETTINGS.enableDrag,
		exportImageFormat:
			pickFrom('exportImageFormat', EXPORT_IMAGE_FORMAT_OPTIONS) ??
			DEFAULT_SETTINGS.exportImageFormat,
		language,
	};
	if (report) {
		report.dropped.push(...dropped);
	}
	return settings;
}

/**
 * 变更后需要即时应用到已打开视图的设置项。
 *
 * 以 `as const satisfies` 声明（而非 `Set<string>`）：键名写错或混入非设置字段
 * 会在编译期报错；差集函数因此可按字面量联合索引设置对象，不再需要
 * `key as keyof MindMapStudioSettings` 强转。
 */
const LIVE_REFRESH_SETTING_KEYS = [
	'defaultLayout',
	'defaultLineStyle',
	'defaultTheme',
	'enableDrag',
	'language',
] as const satisfies readonly (keyof MindMapStudioSettings)[];

type LiveRefreshSettingKey = (typeof LIVE_REFRESH_SETTING_KEYS)[number];

/** 即时刷新键的查表集合（避免每次线性扫描；也免去对字面量数组做类型断言） */
const LIVE_REFRESH_KEY_SET: ReadonlySet<string> = new Set(
	LIVE_REFRESH_SETTING_KEYS,
);

/** 设置面板写回分流：该键是否属于「即时刷新」类 */
function isLiveRefreshKey(key: string): key is LiveRefreshSettingKey {
	return LIVE_REFRESH_KEY_SET.has(key);
}

/**
 * 相对「上次已应用」的设置快照，算出本次真正变化的 LIVE_REFRESH 键（首次应用 = 全部）。
 *
 * 为什么要算差集（2026-09-17 性能轮，见 AGENTS.md K59）：应用动作此前一律让每个视图
 * **重建引擎 + 全量重渲染**，而其中多数键**根本不影响已打开的图**——默认布局 / 默认
 * 连线样式在文件加载时已定为「文件显式选择 ?? 默认值」，之后再改默认值不会改变已打开
 * 的图；主题则有引擎的原地通道（`setThemeConfig`）。算出差集后，视图只做真会改变
 * 渲染的事（`features/view.applySettingsChange`）。
 *
 * 保守口径：`previous === null`（首次应用）返回**全部键**，让视图走最完整的路径，
 * 不依赖「调用方一定先记过快照」这一隐式前提。
 */
export function diffLiveRefreshKeys(
	previous: MindMapStudioSettings | null,
	next: MindMapStudioSettings,
): Set<string> {
	const changed = new Set<string>();
	for (const key of LIVE_REFRESH_SETTING_KEYS) {
		if (previous === null || previous[key] !== next[key]) {
			changed.add(key);
		}
	}
	return changed;
}

/** 设置面板 */
export class MindMapStudioSettingTab extends PluginSettingTab {
	declare plugin: Plugin & SettingsHost;

	constructor(app: App, plugin: Plugin & SettingsHost) {
		super(app, plugin);
	}

	/** 当前界面语言 */
	private get lang(): Language {
		return this.plugin.settings.language;
	}

	/**
	 * 选项表 → 官方 dropdown 的 `{ value: label }` 映射（按当前语言取词）。
	 *
	 * 设置页有 5 个下拉共用这一形态；此前每处各写一遍 `Object.fromEntries(map)`，
	 * 改取词口径（如回退策略）时得改 5 遍。
	 */
	private localizedOptions(
		options: readonly { value: string; label: TranslationKey }[],
	): Record<string, string> {
		return Object.fromEntries(
			options.map((option) => [option.value, t(this.lang, option.label)]),
		);
	}

	/**
	 * 声明式设置定义（Obsidian 1.13+）：新版本用它渲染设置页并获得设置搜索支持。
	 *
	 * 本插件**不**实现命令式的 `display()` 回退：低于 1.13 的宿主基类根本不调用
	 * 本方法（也不存在声明式渲染能力），设置页会空白——因此这类宿主由
	 * `manifest.minAppVersion: 1.13.0` 拦截，不属支持范围。`override` 只是编译期
	 * 契约（对齐宿主签名），不代表运行期存在旧版本分支。
	 */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		const layoutOptions = this.localizedOptions(LAYOUT_OPTIONS);
		const lineStyleOptions = this.localizedOptions(LINE_STYLE_OPTIONS);
		const themeOptions = this.localizedOptions(THEME_OPTIONS);
		const saveLocationOptions = this.localizedOptions(SAVE_LOCATION_OPTIONS);
		const exportImageFormatOptions = this.localizedOptions(
			EXPORT_IMAGE_FORMAT_OPTIONS,
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
						name: t(this.lang, 'settings.defaultLineStyle'),
						desc: t(this.lang, 'settings.defaultLineStyleDesc'),
						control: {
							type: 'dropdown',
							key: 'defaultLineStyle',
							options: lineStyleOptions,
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
						name: t(this.lang, 'settings.saveLocation'),
						desc: t(this.lang, 'settings.saveLocationDesc'),
						control: {
							type: 'dropdown',
							key: 'saveLocation',
							options: saveLocationOptions,
						},
					},
					{
						name: t(this.lang, 'settings.saveFolder'),
						desc: t(this.lang, 'settings.saveFolderDesc'),
						// 仅「指定的文件夹」档显示；visible 每次渲染求值，
						// 下拉切换后由 setControlValue 调 update() 重算（d.ts 契约）
						visible: (): boolean =>
							this.plugin.settings.saveLocation === 'folder',
						control: {
							type: 'folder',
							key: 'saveFolder',
							placeholder: t(this.lang, 'settings.saveFolderPlaceholder'),
						},
					},
					{
						name: t(this.lang, 'settings.autoSave'),
						desc: t(this.lang, 'settings.autoSaveDesc'),
						control: { type: 'toggle', key: 'autoSave' },
					},
					{
						name: t(this.lang, 'settings.autoSplitMixedLinks'),
						desc: t(this.lang, 'settings.autoSplitMixedLinksDesc'),
						control: { type: 'toggle', key: 'autoSplitMixedLinks' },
					},
					{
						name: t(this.lang, 'settings.enableDrag'),
						desc: t(this.lang, 'settings.enableDragDesc'),
						control: { type: 'toggle', key: 'enableDrag' },
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
					{
						name: t(this.lang, 'settings.exportImageFormat'),
						desc: t(this.lang, 'settings.exportImageFormatDesc'),
						control: {
							type: 'dropdown',
							key: 'exportImageFormat',
							options: exportImageFormatOptions,
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
		const report: SettingsSanitizeReport = { dropped: [] };
		this.plugin.settings = sanitizeSettings(
			{
				...this.plugin.settings,
				[key]: value,
			},
			report,
		);
		// 面板控件正常不会给出非法值：一旦出现即控件契约漂移，需留痕
		reportDroppedSettings(report.dropped);
		// 防抖落盘：滑块等高频控件逐档触发，写盘在 main 侧合并为一次
		//（内存设置已经 sanitizeSettings 即时生效，不受防抖影响）
		this.plugin.scheduleSettingsPersist();
		if (isLiveRefreshKey(key)) {
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
		// 保存位置切档：重算「目标文件夹」项的 `visible` 谓词——官方为此提供
		// `refreshDomState()`（obsidian.d.ts:9290：「Re-evaluate every visible
		// and disabled predicate … Cheap: toggles CSS state in place, no
		// re-render」，1.13.0 起），而非 `update()`——后者整页重渲染并重建搜索
		// 索引，且会让刚操作完的下拉框失焦。`update()` 只留给**结构**变化
		//（新增/删除定义项），语言切换属此类，见上。
		if (key === 'saveLocation') {
			this.refreshDomState();
		}
	}
}
