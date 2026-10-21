/**
 * 全局常量定义。
 *
 * 扩展名分流的**权威口径**（2026-09-15 收敛）：文档 = `domain/wikilink.isDocumentExtension`
 * （md / canvas / base），其余带扩展名者 = 附件（`wikilinkTargetIsAttachment`）——
 * 拖入、联想、点击三条路径共用它。本文件只保留「可渲染清单」这类**渲染能力**判定
 * （`canOpenInObsidian` / `isRenderableImageExtension` / `isEmbeddableAttachmentExtension`），
 * 不再维护「可链接附件」白名单（比解析侧窄，会造成「拖入被拒、手写却行」）。
 */
import type { TranslationKey } from './i18n';

/** 自定义视图类型标识 */
export const VIEW_TYPE = 'mindmap-view';

/**
 * Markdown 代码块的**语言标识**（```` ```mindmap ````）：普通笔记中把块体
 * 大纲**只读渲染**为导图（`features/mindmap-codeblock`）。
 *
 * 语言串**沿用 0.0.1/0.0.2 的 `mindmap`**（该能力于 0.0.3 移除，本键恢复）——
 * 存量笔记无需改动即重新可用。与第三方插件（如 Enhancing Mindmap）抢注同一
 * 语言键的行为官方未文档化（谁后注册谁生效，属已知风险，见
 * `docs/markdown-mindmap-standard.md` 的代码块嵌入一节）。
 */
export const CODE_BLOCK_LANGUAGE = 'mindmap';

/**
 * 代码块嵌入的**节点数上限**：超过即降级为只读缩进大纲（不建引擎实例）。
 *
 * 与 `PERFORMANCE_NODE_THRESHOLD` 语义不同，故不复用：那个是「引擎虚拟渲染」
 * 阈值（超了照样渲染，只是少画）；这里是「嵌入形态**拒绝建引擎**」的硬上限
 * ——一篇笔记可以有很多块，每块一个引擎实例（含离屏测量、MathJax/Prism 注入）
 * 会让打开成本随块数线性叠加，而大纲形态零成本且信息不丢。
 */
export const CODE_BLOCK_MAX_NODES = 500;

/**
 * 数学段 holder 的**已渲染标记类**。
 *
 * 单一来源：`platform/math-jax` 的异步替换路径与
 * `features/node-inline-content` 的**缓存命中同步放置路径**必须同口径——
 * 两条路径都代表"已渲染"，主题、调试定位与断言选择器才有唯一依据
 * （此前两处各写字面值，值相同但无约束）。
 */
/**
 * 自绘内容 / 渲染标记类名的前缀纪律（2026-10-15 登记）：全仓存在**两套**前缀——
 * `mindmap-*`（数学与自绘内容：`MATH_RENDERED_HOLDER_CLASS`、
 * `node-inline-content` 的段类名）与 `tmm-*`（代码块与嵌入：
 * `CODE_BLOCK_CLASS` / `CODE_RENDERED_CLASS` / `.tmm-embed-canvas`）。
 *
 * 规则：**同一子系统内保持一致**，跨子系统勿混用（主题与 `verify:visual` 的探针
 * 选择器按字面引用这些类名）；新类名就落在所在子系统已有的前缀上，不做整体迁移
 * （迁移会同时动 styles.css / 导出后处理链 / 探针，收益只是"看起来统一"）。
 */
export const MATH_RENDERED_HOLDER_CLASS = 'mindmap-inline-math';

/**
 * 代码块 `<code>` 的**已高亮标记类**。
 *
 * 与 `MATH_RENDERED_HOLDER_CLASS` 同款纪律（单一来源）：`platform/prism-code` 的
 * 异步高亮路径与 `features/node-inline-content` 的**缓存命中同步放置路径**都写它，
 * 两条路径都代表"已高亮"——主题、调试定位与断言选择器才有唯一依据。
 *
 * 只表示"子节点已是 token 元素"；**不代表有颜色**——语言未登记时高亮整体跳过，
 * 类名同样会写（`<code>` 内是字面文本，与围栏未闭合时的既有口径一致）。
 */
export const CODE_RENDERED_CLASS = 'tmm-code-hl';

/**
 * Prism token 元素的类名（token 类型类由 Prism 决定，此处只固定**基类**）。
 *
 * 主题色由宿主 `app.css` 的 `.token.<类型>` 规则给出（与阅读视图同源）；本插件
 * 另在 `platform/prism-code` 探测其计算色并**内联**到每个 token 元素上，使屏上与
 * 导出 SVG（不含 styles.css）同色。
 */
export const PRISM_TOKEN_CLASS = 'token';

/**
 * 新建导图的默认保存位置（四态）。
 *
 * - `obsidian`：跟随官方「设置 → 文件与链接 → 新建笔记的默认位置」
 *   （经 `FileManager.getNewFileParent` 完整生效，含核心的「指定文件夹」模式）；
 * - `root`：仓库的根目录；
 * - `current`：当前文件（含导图视图，`MindMapView` 是 `FileView`）所在的文件夹；
 * - `folder`：`settings.saveFolder` 指定的文件夹。
 *
 * 后三态与 Obsidian Canvas「新白板文件的默认位置」同口径，`obsidian` 为本插件
 * 默认档（Canvas 无对应档）。「当前/指定文件夹」不可解析时一律回落库根
 * （对齐 Canvas：不自动创建文件夹）。
 */
export type SaveLocation = 'obsidian' | 'root' | 'current' | 'folder';

export interface SaveLocationOption {
	value: SaveLocation;
	label: TranslationKey;
}

/** 保存位置选项（设置面板下拉与 sanitizeSettings 白名单共用） */
export const SAVE_LOCATION_OPTIONS: SaveLocationOption[] = [
	{ value: 'obsidian', label: 'settings.saveLocation.obsidian' },
	{ value: 'root', label: 'settings.saveLocation.root' },
	{ value: 'current', label: 'settings.saveLocation.current' },
	{ value: 'folder', label: 'settings.saveLocation.folder' },
];

export interface LayoutOption {
	value: string;
	label: TranslationKey;
}

/** 工具栏布局选择器中提供的六种布局 */
export const LAYOUT_OPTIONS: LayoutOption[] = [
	{ value: 'logicalStructure', label: 'layout.logical' },
	{ value: 'mindMap', label: 'layout.mindMap' },
	{ value: 'organizationStructure', label: 'layout.organization' },
	{ value: 'catalogOrganization', label: 'layout.catalog' },
	{ value: 'timeline', label: 'layout.timeline' },
	{ value: 'fishbone', label: 'layout.fishbone' },
];

/**
 * 连线样式偏好：折线（straight，正交折线）/ 曲线（curve）。
 *
 * 2026-10-21 收敛（用户裁决）：原四态砍掉两项——
 * - `auto`（随布局）下线：默认值已固定为折线，「跟随布局」不再有信息量；
 * - `direct`（直连）下线：与折线的观感差异不足以再占一个用户选项。
 *
 * 存量 `data.json` 里的 auto / direct / 未知值由 `normalizeLineStylePreference`
 * 在**读取侧**归一为折线（不批量改写用户数据，下一次切换样式时自然落盘）。
 *
 * 固定直线布局（目录组织图 / 时间轴 / 鱼骨图）由布局类自行绘制直线、`lineStyle`
 * 对其无效；工具栏对这三者只显示「直线」描述（`lineStyle.fixedStraight`），
 * 不作为可选项。
 */
type LineStylePreference = 'straight' | 'curve';

/** 新建导图与脏值归一使用的默认连线样式：折线 */
export const DEFAULT_LINE_STYLE: LineStylePreference = 'straight';

export interface LineStyleOption {
	value: LineStylePreference;
	label: TranslationKey;
}

/** 连线样式选项（工具栏选择器与设置面板共用；顺序＝界面顺序：折线在上） */
export const LINE_STYLE_OPTIONS: LineStyleOption[] = [
	{ value: 'straight', label: 'lineStyle.straight' },
	{ value: 'curve', label: 'lineStyle.curve' },
];

/**
 * 存量 / 脏值归一：只有 `curve` 保留，其余（`auto` / `direct` / 未知 / 空串 /
 * 非字符串）一律折线——与默认值同源，避免「默认折线、脏值却回曲线」的第二份口径。
 */
export function normalizeLineStylePreference(value: unknown): LineStylePreference {
	return value === 'curve' ? 'curve' : DEFAULT_LINE_STYLE;
}

export interface ThemeOption {
	value: string;
	label: TranslationKey;
}

/** 主题色选项（明暗配色；与「主题」是两个正交维度，见 `THEME_STYLE_OPTIONS`） */
export const THEME_OPTIONS: ThemeOption[] = [
	{ value: 'default', label: 'theme.default' },
	{ value: 'light', label: 'theme.forceLight' },
	{ value: 'dark', label: 'theme.forceDark' },
];

/**
 * 「主题色」（明暗配色）与「主题」（节点外观风格）是**两个正交维度**：
 * - 主题色 = `THEME_OPTIONS`（跟随 Obsidian / 强制亮 / 强制暗），只决定色板；
 * - 主题 = `THEME_STYLE_OPTIONS`（本表），只决定节点外观（是否绘制填充/边框）。
 *
 * 二者在设置面板紧邻呈现，但持久化字段（`defaultTheme` / `themeStyle`）与
 * 渲染通道各自独立：给主题加选项不动任何色值，改配色也不动节点形态。
 *
 * **新增主题的规范**（唯一源在本表 + `engine/mindmap-theme-presets.ts` 的
 * `THEME_STYLE_PRESETS`，两者由 `Record<ThemeStyleId, …>` 在编译期强制对齐）：
 * 1. `value` 一旦发布**永不更名**——它会写进 `data.json`，改名即用户设置失效；
 * 2. 显示名只走 `label`（i18n 键，中英必须成对），不在数据里写文案；
 * 3. 主题只能表达**全局**外观：不得引入节点级样式（本插件节点样式无持久化位，
 *    Markdown 是唯一真相）；
 * 4. 主题是纯视图态：不碰 Markdown、`mdRaw` 与节点数据。
 */
export interface ThemeStyleOption {
	value: string;
	label: TranslationKey;
}

/**
 * 主题选项（设置面板下拉与 sanitizeSettings 白名单共用；顺序＝界面顺序）。
 *
 * `as const` 让**本表成为 id 的唯一源**：`ThemeStyleId` 由它派生，
 * `THEME_STYLE_PRESETS` 又用 `Record<ThemeStyleId, …>` 反向约束——新增主题只加
 * 数组一项，漏写外观配置即编译失败，不存在「类型与选项表两处维护」的漂移面。
 */
export const THEME_STYLE_OPTIONS = [
	{ value: 'default', label: 'themeStyle.default' },
	{ value: 'borderless', label: 'themeStyle.borderless' },
] as const satisfies readonly ThemeStyleOption[];

/** 主题 id（从选项表派生；勿手写第二份字面量联合） */
export type ThemeStyleId = (typeof THEME_STYLE_OPTIONS)[number]['value'];

/** 新建导图与脏值归一使用的默认主题（＝存量外观，升级观感零变化） */
export const DEFAULT_THEME_STYLE: ThemeStyleId = 'default';

/**
 * 脏值归一（渲染侧兜底）：不在白名单内（未知 id / 手改 data.json / 空串 /
 * 非字符串）一律回退默认主题——与 `normalizeLineStylePreference` 同口径。
 * 设置读取侧的诊断（丢弃非法值并留痕）仍走 `settings.sanitizeSettings` 的
 * `pickFrom`，两者目的不同：此处保证渲染入口永不因脏值失败。
 */
export function normalizeThemeStyle(value: unknown): ThemeStyleId {
	const match = THEME_STYLE_OPTIONS.find((option) => option.value === value);
	return match ? match.value : DEFAULT_THEME_STYLE;
}

/**
 * 配色（色相方案）——与「主题色」（明暗）、「主题」（节点形态）**三维正交**：
 * - 主题色（`THEME_OPTIONS`）决定亮/暗色板；
 * - 主题（`THEME_STYLE_OPTIONS`）决定节点是否绘制填充/描边；
 * - 配色（本表）决定整套色板的色相。
 *
 * 每套配色必须在 `engine/mindmap-theme-presets.ts` 的 `PALETTES` 里同时给出
 * light / dark 两档（`Record<PaletteId, …>` 编译期强制）。
 * **文字色不随配色变**（三档共用、按明暗定），故每套只维护 5 个填充/线色。
 *
 * 规范同主题：id 发布即冻结（写进 `data.json`）；新增配色＝本表加一项 +
 * `PALETTES` 加两档 + i18n 一对，渲染代码零改动。
 */
export interface PaletteOption {
	value: string;
	label: TranslationKey;
}

/**
 * 配色选项（顺序＝界面顺序；首项「默认」＝本特性引入前的蓝色基准）。
 *
 * ⚠ 与「主题色」「主题」不同，**配色不是全局设置**：它按文件记在
 * `data.json` 的 `viewState[<路径>].palette`，由导图顶栏切换（与布局/连线样式
 * 同一种「按文件记忆」形态）。故本表只供工具栏与白名单使用，不进
 * `MindMapStudioSettings`。
 */
export const PALETTE_OPTIONS = [
	{ value: 'default', label: 'palette.default' },
	{ value: 'mint', label: 'palette.mint' },
	{ value: 'amber', label: 'palette.amber' },
	{ value: 'wisteria', label: 'palette.wisteria' },
	{ value: 'forest', label: 'palette.forest' },
	{ value: 'slate', label: 'palette.slate' },
] as const satisfies readonly PaletteOption[];

/** 配色 id（从选项表派生；勿手写第二份字面量联合） */
export type PaletteId = (typeof PALETTE_OPTIONS)[number]['value'];

/** 未设置时的配色（＝本特性引入前的蓝色基准，升级观感零变化） */
export const DEFAULT_PALETTE: PaletteId = 'default';

/**
 * 脏值归一（渲染侧兜底）：未知 id / 手改 data.json / 空串 / 非字符串
 * 一律回退默认配色——与 `normalizeThemeStyle` 同口径。
 */
export function normalizePalette(value: unknown): PaletteId {
	const match = PALETTE_OPTIONS.find((option) => option.value === value);
	return match ? match.value : DEFAULT_PALETTE;
}

/**
 * 导出图片格式的**唯一来源**（settings 设置项 / engine 导出参数 / features 入口
 * 共用本类型，勿各自再写一份 `'png' | 'svg'`）。
 */
export type ExportImageFormat = 'png' | 'svg';

export interface ExportImageFormatOption {
	value: ExportImageFormat;
	label: TranslationKey;
}

/** 导出图片格式选项（设置面板下拉与 sanitizeSettings 白名单共用） */
export const EXPORT_IMAGE_FORMAT_OPTIONS: ExportImageFormatOption[] = [
	{ value: 'png', label: 'settings.exportFormat.png' },
	{ value: 'svg', label: 'settings.exportFormat.svg' },
];

/** 支持的图片扩展名（拖拽插入） */
const IMAGE_EXTENSIONS = [
	'png',
	'jpg',
	'jpeg',
	'gif',
	'svg',
	'webp',
	'bmp',
	'ico',
];

/**
 * 音频/视频扩展基表：Obsidian 桌面端没有音频/视频的标签页视图。
 * 「可链接附件」与「系统媒体」两份清单已于 2026-09-15 删除（附件口径收敛到
 * `domain/wikilink.wikilinkTargetIsAttachment`），此处仅作派生基表保留。
 */
const AUDIO_VIDEO_EXTENSIONS = [
	// 音频
	'mp3',
	'wav',
	'm4a',
	'm4b',
	'm4s',
	'ogg',
	'oga',
	'opus',
	'weba',
	'flac',
	'aac',
	'amr',
	'wma',
	'3gp',
	// 视频
	'mp4',
	'm4v',
	'webm',
	'ogv',
	'mov',
	'mkv',
	'avi',
	'flv',
	'wmv',
	'ts',
];

/**
 * 可在 Obsidian 中**嵌入渲染**的附件扩展（官方帮助「Embed files / Accepted file
 * formats」：音频、视频、PDF 都能 `![[…]]` 直接嵌进笔记；图片另有 image 语义）。
 *
 * 拖入这类文件时默认写**嵌入**语法（`![[报告.pdf]]`），与 Obsidian 拖放一致；
 * 其余附件（zip/epub 等不可嵌入）写普通链接 `[[文件.zip]]`。
 */
const EMBEDDABLE_ATTACHMENT_EXTENSIONS = [
	...AUDIO_VIDEO_EXTENSIONS,
	'pdf',
];

/** 判断扩展名是否为可嵌入渲染的附件（拖入默认写 `![[…]]`，见上） */
export function isEmbeddableAttachmentExtension(extension: string): boolean {
	return EMBEDDABLE_ATTACHMENT_EXTENSIONS.includes(extension.toLowerCase());
}

/** 粘贴/拖入图片大小上限（MB） */
export const MAX_IMAGE_SIZE_MB = 10;

/** 判断扩展名是否为图片 */
export function isImageExtension(extension: string): boolean {
	return IMAGE_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * 是否缩进代码块行（CommonMark：≥4 空格或制表符起首）。
 *
 * 这类行的内容是**代码**，其中的 `![[..]]` / `[..](..)` 不参与行内语义。
 * 解析（段落首行不采纳图片字段）与回写（不据此剥离）必须共用本判定，
 * 否则会把代码行当图片剥离后清空。
 */
export function isIndentedCodeLine(rawLine: string): boolean {
	return /^(?: {4,}|\t)/.test(rawLine);
}

/**
 * 围栏信息行 → **Prism 语言 id**（规范化；不合规返回空串）。
 *
 * 信息行是自由文本（```` ```js title="a.js" ````、```` ``` js ````），而语言 id 会
 * ① 拼进 `<code class="language-…">`（**类名不能是任意用户文本**）② 查
 * `Prism.languages[id]`。故取**首个空白分隔词**并按白名单校验：
 * - 只放行 `[A-Za-z][A-Za-z0-9+#._-]*`（覆盖 `js`/`ts`/`csharp`/`objectivec`/`c++`/
 *   `f#`/`meson.build` 一类），一律小写（Prism 语法键为小写）；
 * - 其余（含空串、`__proto__`、`constructor`、含空格/引号/尖括号者）→ 空串 =
 *   不高亮（调用方保留字面显示，见`platform/prism-code` 的语法查找守卫）。
 *
 * 收口在 core：`features/node-inline-content`（建类名）与 `platform/prism-code`
 * （查语法）必须同一口径，分写会漂移。
 */
export function normalizeFenceLanguage(info: string): string {
	const token = info.trim().split(/\s+/, 1)[0] ?? '';
	return /^[A-Za-z][A-Za-z0-9+#._-]*$/.test(token) ? token.toLowerCase() : '';
}

/** Obsidian 可渲染清单中的图片段：拖拽图片扩展 + Obsidian 额外支持的位图格式 */
const OBSIDIAN_RENDER_IMAGE_EXTENSIONS = [
	...IMAGE_EXTENSIONS,
	'avif',
	'apng',
	'jxl',
	'tif',
	'tiff',
];

/** 判断某扩展名是否属于 Obsidian 可渲染的图片（比拖拽图片清单宽：含 avif/apng/jxl/tif/tiff） */
export function isRenderableImageExtension(extension: string): boolean {
	return OBSIDIAN_RENDER_IMAGE_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * 目标串是否指向**可渲染图片**（末段扩展名判定；先剥 `?`/`#` 后缀再取扩展名）。
 *
 * 目标可携带查询串/锚点——资源地址 `图片.png?1789`（官方 getResourcePath 形态）
 * 不剥会把扩展名读成 `png?1789` 而误判。调用方：回写侧「链接已清除」检测
 * （图片类嵌入不是链接，`md-serialize.rawHasForeignEmbed`）与链接拆分
 * （`links-split.isExtractableToken`）。与 `md-outline.isImageEmbedTarget` 的差异：
 * 后者处理 wikilink **原文内层**（`#` 是块引用语义，不剥离），本函数面向可能
 * 含缓存串的地址形态，故剥离 `?`/`#`。
 */
export function isRenderableImageTarget(target: string): boolean {
	const path = target.split(/[?#]/)[0] ?? '';
	const name = path.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return false;
	}
	return isRenderableImageExtension(name.slice(dot + 1));
}

/**
 * 设置项取值域：设置面板滑块的 min/max 与 sanitizeSettings 的钳制共用同一来源，
 * 避免「面板能选 1-4、data.json 手改成 99 却直达引擎」这类漂移。
 */
export const EXPORT_SCALE_MIN = 1;
export const EXPORT_SCALE_MAX = 4;

/**
 * 性能模式（虚拟渲染）的**内部判据**：节点数 ≥ 此值即只渲染视口附近的节点。
 *
 * 2026-10-09 减法：此前是设置项（开关 + 可调阈值 100–2000）。用户无法为
 * 「阈值取多少合适」建立心智模型，而虚拟渲染在大图下**总是更优**、在阈值之下
 * 本就不生效（无副作用）⇒ 收成常量，设置面板少两项。
 *
 * 阈值依据：500 节点≈「一屏能看完」的边界，低于此值时虚拟渲染的调度开销无收益。
 * 调整只影响「何时开始虚拟渲染」，不改变渲染结果（count 探针钉住「性能模式下
 * 渲染树结构仍完整」）。
 */
const PERFORMANCE_NODE_THRESHOLD = 500;

/**
 * 是否启用性能模式（虚拟渲染）：**唯一判据**（创建期与运行期共用）。
 *
 * `nodeCount` 创建期按数据树、运行期按渲染树计数——两处口径同构（count 探针已
 * 钉住「性能模式下渲染树结构仍完整」），故阈值语义在创建期与运行期完全一致。
 * `enabled` / `threshold` 只作为**引擎级覆盖**存在（`verify:visual` 的 perf 探针
 * 要构造「阈值之上 / 之下」两种局面），生产路径不传、走默认值。
 */
export function shouldEnablePerformanceMode(
	nodeCount: number,
	enabled: boolean = true,
	threshold: number = PERFORMANCE_NODE_THRESHOLD,
): boolean {
	return enabled && nodeCount >= threshold;
}

/**
 * 打开分片渲染阈值（2026-09-25 性能轮方案 B）：节点数 ≥ 此值时引擎 `_render`
 * 整树渲染走既有 async 通道（`MindMapNode.render` 的第三参数），把 1s 级同步
 * 冻结拆成短任务链，打开大图时 UI 保持响应。
 *
 * 通道载体**补丁 12 起**是「任务队列 + MessageChannel 批量消费（8ms/批）」；
 * 补丁 6 的原实现是「每子节点一个 `setTimeout(0)`」，被 HTML 的嵌套定时器
 * 4ms 下限放大（5000 节点整树可见实测 20–38s），已废弃。
 *
 * 阈值依据（实测账本）：同步打开耗时 ∝ 节点数（5000 节点 ≈ 1.15s，K72）；
 * 千节点级同步冻结约 230ms 已接近可感边缘，故取 1000。分片的总时长代价与
 * 冻结消除实测对照见 AGENTS.md K75（`--bench-open` + `BENCH_RENDER_ASYNC`）。
 * 引擎侧只读 opt.renderAsync（不存在 = 同步，行为与上游一致，见补丁 6）。
 */
export const RENDER_ASYNC_NODE_THRESHOLD = 1000;

/**
 * 「适应画布」的大图阈值（2026-10-17 实机读数 + 产品裁决）：节点数超过它**且**
 * 真 fit 比例低于可读下限时，fit 抬到下限并给一句提示（判据与提示各在一处：
 * `engine/mindmap-viewport.LARGE_MAP_MIN_FIT_SCALE` 决定是否钳制并回吐
 * `clamped`，`features/view-viewport.fitToScreen` 只负责转述）。
 *
 * 依据：fit 的目标是「整树可见」，而剪枝（`pruneSubtreeEnabled`）在全部可见时
 * 必然解除 ⇒ 整树一次性装配进 DOM。实测 500 节点 0.55s、1000 节点 0.94s、
 * 5000 节点在**补丁 12 之前 20–38s**（每子节点一个 `setTimeout`，被嵌套定时器
 * 4ms 下限放大；对照关掉剪枝仍 19.7s ⇒ 成本是排队+装配，不是剪枝本身）。
 *
 * 1–2k 属可接受范围（亚秒、全览仍有信息量），故自 2000 起才可能启用下限。
 * 补丁 12（批量消费）后大图的整树装配已回到秒内，但 5000 节点真 fit 比例约
 * 0.03（文字 <1px）没有信息量，因此**下限仍然保留**——两件事各自独立成立。
 */
export const HEAVY_FIT_NODE_THRESHOLD = 2000;

/**
 * Obsidian 能在标签页中渲染、不会出现空白页的扩展名（md/canvas/PDF/图片/纯文本·代码）。
 * 用于点击导图内链接/附件时判断能否直接用 Obsidian 打开。
 * 音频/视频不在其中：Obsidian 桌面端没有音频/视频的标签页视图，
 * 打开后会交由系统默认应用并留下一个空白标签页（见 SYSTEM_MEDIA_EXTENSIONS）。
 */
const OBSIDIAN_RENDER_EXTENSIONS: ReadonlySet<string> = new Set([
	'md',
	// Canvas / Bases：官方一类可在标签页打开的库内文档（.canvas / .base），
	// 缺 .base 会让指向 base 的链接被提示「无法预览」
	'canvas',
	'base',
	'pdf',
	// 思维导图（本插件注册了视图，可在 Obsidian 标签页中打开）
	'mindmap',
	// 图片
	...OBSIDIAN_RENDER_IMAGE_EXTENSIONS,
	// 纯文本 / 代码（Obsidian 以文本方式渲染，不会空白）
	'txt',
	'text',
	'log',
	'json',
	'css',
	'js',
	'jsx',
	'ts',
	'tsx',
	'html',
	'htm',
	'xml',
	'yaml',
	'yml',
	'csv',
	'tsv',
	'ini',
	'toml',
	'conf',
	'cfg',
	'mjs',
	'cjs',
	'mdx',
	'py',
	'rb',
	'sh',
	'bat',
	'ps1',
	'sql',
]);

/**
 * 系统媒体（音频/视频）：Obsidian 无标签页视图，点击后应改由系统默认应用打开
 * （桌面端 shell.openPath），而不是在 Obsidian 中新建空白标签页。
 */
/**
 * 判断某扩展名能否在 Obsidian 标签页中直接打开（可渲染、不出现空白标签页）。
 * 其余一律交系统默认应用（音视频如此，zip/docx 等也如此——2026-09-15 统一，
 * 见 `platform/system-open` 与 `view-link-navigator.openResolvedTarget`）。
 */
export function canOpenInObsidian(extension: string): boolean {
	return OBSIDIAN_RENDER_EXTENSIONS.has(extension.toLowerCase());
}

/** 生成全局唯一的节点 uid（引擎对 uid 格式无要求，仅需全局唯一） */
export function generateUid(): string {
	return `tmm-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * 防抖/节流时间常量集中管理——所有模块必须引用此处而非手写数字。
 * 此前设置持久化 400ms（main.ts）、自动保存 600ms（view.ts）散落两处，
 * 维护者难以发现"为什么不一样、哪个改了不该改"。集中后：
 * - SETTINGS_PERSIST_DEBOUNCE_MS ：设置面板控件（滑块等）高频写入 → 合并突发；
 * - SETTINGS_APPLY_DEBOUNCE_MS   ：设置变更**应用到视图**的防抖（重建引擎很贵）；
 * - AUTO_SAVE_DEBOUNCE_MS       ：自动保存防抖（引擎修改触发保存）；
 * - VIEW_STATE_PERSIST_MS       ：ViewStateStore 布局/视口防抖；
 * - TITLE_RENAME_DEBOUNCE_MS    ：中心主题重命名防抖。
 */
export const SETTINGS_PERSIST_DEBOUNCE_MS = 400;
/**
 * 设置变更应用到已打开视图的防抖（`applySettingsToViews`）。
 *
 * 比落盘防抖短：应用是**用户可见**的（布局/主题/拖拽开关），要让「松手即生效」
 * 的感觉成立；但必须防抖——仍走重建的键（拖拽开关、语言）一轮 = 每个打开的视图
 * **销毁并重建引擎 + 全量重渲染**，连点几次就是几十轮。
 *
 * 2026-09-17 起按键差集分流：主题原地生效（`setThemeConfig`，K59）、默认布局/
 * 默认连线样式对已打开的图本就不生效故直接跳过；目前只剩拖拽开关与语言仍重建。
 * 防抖仍保留——面板上的连续操作（勾选开关、切换语言）仍会反复触发应用。
 * （2026-10-09 减法前这里还有两个滑块键：`performanceThreshold` 已随设置项删除，
 * 见 K117④；现存唯一滑块 `exportScale` 不在 LIVE_REFRESH 键内。）
 */
export const SETTINGS_APPLY_DEBOUNCE_MS = 250;
/**
 * 自动保存防抖（SavePipeline 引擎修改触发）。
 * 设为 800ms——比视图状态持久化长（避免引擎高频数据变更时与磁盘 I/O 争抢），
 * 但不超过用户感知阈值（秒级无响应会被认为卡死）。
 */
export const AUTO_SAVE_DEBOUNCE_MS = 800;
/**
 * 连续自动保存失败达到该次数后**挂起自动保存**（P1b 降级）：
 * 磁盘满/权限类失败重试无意义，继续每次弹错只会造成告警疲劳；
 * 显式保存（命令/卸载路径）不受影响，一次成功即解除挂起。
 */
export const SAVE_FAILURE_SUSPEND_THRESHOLD = 3;
/**
 * 引擎数据变更后「自动拆分混排双链」检查的延后一拍（毫秒）。
 * 文本编辑提交与数据写入可能在同一轮事件里，立刻检查会读到编辑框尚未收起的
 * 中间态（isEditingText 仍为真）；延后很短一瞬让引擎先完成收尾。
 */
export const AUTO_SPLIT_CHECK_DELAY_MS = 120;
export const VIEW_STATE_PERSIST_MS = 600;
/**
 * 「声明为导图的文件自动切到导图视图」的**全量扫描防抖窗口**（毫秒）。
 * 启动恢复 / 批量开标签会连发多次 `file-open`，而每次全量扫描都要遍历全部
 * markdown 叶子并逐叶读 frontmatter 判据——整个突发只扫一次
 * （见 `platform/mindmap-auto-open`）。**集中在此**：实现与测试同源，
 * 避免两处各写一个裸 50（常量一改测试就静默失真）。
 */
export const AUTO_OPEN_SCAN_DEBOUNCE_MS = 50;
/**
 * 标题重命名防抖（更长——涉及 FileManager.renameFile 引发全库链接/反链更新，
 * 1.5s 等待用户停止打字 + isEditingText 守卫二次确认编辑结束）。
 */
export const TITLE_RENAME_DEBOUNCE_MS = 1500;

/**
 * RESET_LAYOUT 后适应画布（fit 全图）的等待延迟（毫秒）。
 * 引擎 resetLayout 内部同步 render → 浏览器 reflow 需要时间；
 * 不用 requestAnimationFrame（只保证下帧前回调，不保证 reflow 已完成）。
 * 80ms 在所有设备上远快于用户感知阈值，同时留出引擎内部处理余量；
 * 若引擎升级提供「布局完成」回调，应优先替换此处。
 */
export const RESET_LAYOUT_VIEWPORT_DELAY_MS = 80;

/**
 * RESET_LAYOUT 前的「渲染窗口」等待参数（毫秒，K67）。
 *
 * 引擎 `Renderer._render` 先把 `renderer.root` 置 null，再由布局回填；而布局
 * `doLayout` 经分片执行器逐步跑（每步之间 `setTimeout(0)`，见 vendor 的 It），
 * 故 root 缺失会**跨越多个宏任务**。窗口期内执行 RESET_LAYOUT 会遍历 null 根，
 * 在回调首行抛 `TypeError: Cannot set properties of null (setting 'customLeft')`
 * （用户实测，见 K67）。故 `arrangeMindMap` 在 root 缺失时按此间隔轮询等回填，
 * 超过上限则放弃（只记日志）。
 */
export const RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS = 50;
export const RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS = 2000;

/**
 * 统一的节点图片显示尺寸。
 * 所有插入的图片都会以该固定高度显示，并完整呈现在子主题框架内；
 * SVG <image> 默认 preserveAspectRatio="xMidYMid meet"，图片会等比
 * 缩放并居中（必要时留白），不会被拉伸变形，也不会超出框架。
 */
export const IMAGE_WIDTH = 200;
export const IMAGE_HEIGHT = 120;

/**
 * 图片展示的**长边上限**（px）：未设置尺寸的图按原始大小展示时，超过此值的
 * 等比缩小（**只缩不放**；用户显式参数 `![[图|2000]]` 不受此限，用户意图优先）。
 *
 * 封顶而非无限：导图节点是**空间对象**——一张 2000px 截图会把画布版面压扁，
 * 与 `CODE_BLOCK_MAX_HEIGHT_PX` 同一理由（轻量渲染定位）。数值口径：默认盒
 * 宽 200 的 2.4 倍，≈ Obsidian 分栏可视宽的一半——单节点不霸屏、图片仍可辨；
 * 要看清原图细节点击图片打开全屏（`onNodeImageClick`）。
 * 与引擎主题的 `imgMaxWidth/imgMaxHeight` 分工：后者只约束 `custom:false`
 * 的兜底路径（首帧/探测失败），本值约束 `custom:true` 的自然尺寸路径。
 */
export const IMAGE_MAX_SIDE_PX = 480;

/**
 * 节点内代码块（自绘 ``` 围栏段）的最大显示高度（像素）。
 *
 * 封顶而非无限高：导图节点是**空间对象**——一个百行代码块会把画布版面彻底压扁，
 * 与「轻量渲染」的定位相悖。超出部分由块内纵向滚动承接（滚动条见 styles.css）。
 * 数值口径：≈ 24 行（0.9em × 1.45 行高）——覆盖常规示例片段，又不喧宾夺主。
 */
export const CODE_BLOCK_MAX_HEIGHT_PX = 360;

/**
 * Obsidian 核心视图类型标识（官方未公开常量；d.ts 的
 * `getLeavesOfType(viewType: string)` 仅接受字符串，无类型校验）。
 * 集中在常量表，核心改名/升级时一处核对，避免散落字符串漂移。
 */
export const CORE_VIEW_TYPE = {
	/** Markdown 视图（切回编辑/阅读，md-open.ts / open-as-restore.ts） */
	MARKDOWN: 'markdown',
} as const;

/**
 * 悬停预览事件名（`workspace.trigger('hover-link', …)`）。
 * 官方 `Workspace.on` 的类型化事件清单中不含该名（仅有 `registerHoverLinkSource`
 * 声明数据源），故集中为常量，避免拼写漂移。
 */
export const HOVER_LINK_EVENT = 'hover-link';
