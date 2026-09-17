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
/** Markdown 渲染模式（.mindmap.md）的完整后缀（含点） */
export const MD_FILE_SUFFIX = '.mindmap.md';

/**
 * .mindmap.md 标记的判定/剥离/拼接唯一实现（大小写不敏感）。
 * 勿在各模块手写同名正则或 replace——此前散落 4 处，规则变更需改多处。
 */
const MD_MARKER_RE = /\.mindmap\.md$/i;
/** basename 上复合后缀的 stem 段（'笔记.mindmap' 中的 '.mindmap'） */
const MD_STEM_SUFFIX_RE = /\.mindmap$/i;

/** 名称（路径或文件名）是否以 .mindmap.md 结尾 */
export function hasMindMapMarker(name: string): boolean {
	return MD_MARKER_RE.test(name);
}

/** 剥离 basename 上的 .mindmap stem 段（'笔记.mindmap' → '笔记'；无则原样） */
export function stripMindMapStem(basename: string): string {
	return basename.replace(MD_STEM_SUFFIX_RE, '');
}

/** 保证名称以 .mindmap.md 结尾（容忍误输入 .mindmap 或已有完整后缀） */
export function withMindMapMarker(name: string): string {
	if (MD_MARKER_RE.test(name)) {
		return name;
	}
	if (MD_STEM_SUFFIX_RE.test(name)) {
		return `${name}.md`;
	}
	return `${name}${MD_FILE_SUFFIX}`;
}

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
 * 连线样式偏好：auto＝随布局（布局默认见 mindmap-theme.lineStyleForLayout：
 * 四种直线布局取 straight、两种曲线布局取 curve）；其余三值强制指定。
 * 引擎三态（curve 曲线 / direct 直连 / straight 正交折线）仅对逻辑结构图、
 * 思维导图、组织结构图生效；目录组织图/时间轴/鱼骨图为布局类原生直线。
 */
type LineStylePreference = 'auto' | 'curve' | 'direct' | 'straight';

export interface LineStyleOption {
	value: LineStylePreference;
	label: TranslationKey;
}

/** 连线样式选项（工具栏选择器与设置面板共用） */
export const LINE_STYLE_OPTIONS: LineStyleOption[] = [
	{ value: 'auto', label: 'lineStyle.auto' },
	{ value: 'curve', label: 'lineStyle.curve' },
	{ value: 'direct', label: 'lineStyle.direct' },
	{ value: 'straight', label: 'lineStyle.straight' },
];

export interface ThemeOption {
	value: string;
	label: TranslationKey;
}

/** 主题选项 */
export const THEME_OPTIONS: ThemeOption[] = [
	{ value: 'default', label: 'theme.default' },
	{ value: 'light', label: 'theme.forceLight' },
	{ value: 'dark', label: 'theme.forceDark' },
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
 * 「可链接附件」与「系统媒体」两个清单的公共部分（派生避免逐字重复）。
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
export const PERFORMANCE_THRESHOLD_MIN = 100;
export const PERFORMANCE_THRESHOLD_MAX = 2000;

/**
 * 是否启用性能模式（虚拟渲染）：插件设置（开关 + 节点数阈值）的**唯一判据**。
 *
 * 创建（`engine/mindmap.createMindMap`，按数据树）与运行时切换
 * （`services/engine-controller.applyPerformance`，按渲染树）共用——两处节点数
 * 口径同构（count 探针已钉住「性能模式下渲染树结构仍完整」），故阈值语义在
 * 创建期与运行期完全一致；改判据只需改这一处。
 */
export function shouldEnablePerformanceMode(
	nodeCount: number,
	performanceMode: boolean,
	performanceThreshold: number,
): boolean {
	return performanceMode && nodeCount >= performanceThreshold;
}

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
 * 比落盘防抖短：应用是**用户可见**的（布局/主题/性能开关），要让「松手即生效」
 * 的感觉成立；但必须防抖——LIVE_REFRESH 键里含滑块（如 performanceThreshold，
 * step 100），而仍走重建的键（拖拽开关、语言）一轮 = 每个打开的视图**销毁并重建
 * 引擎 + 全量重渲染**，拖一次滑块就是几十轮。
 *
 * 2026-09-17 起按键差集分流：主题原地生效（`setThemeConfig`，K59）、性能模式与
 * 阈值原地切换（`updateConfig`，K60）、默认布局/默认连线样式对已打开的图本就不
 * 生效故直接跳过；目前只剩拖拽开关与语言仍重建。防抖仍保留——滑块档位本身仍会
 * 反复触发应用。
 */
export const SETTINGS_APPLY_DEBOUNCE_MS = 250;
/**
 * 自动保存防抖（SavePipeline 引擎修改触发）。
 * 设为 800ms——比视图状态持久化长（避免引擎高频数据变更时与磁盘 I/O 争抢），
 * 但不超过用户感知阈值（秒级无响应会被认为卡死）。
 */
export const AUTO_SAVE_DEBOUNCE_MS = 800;
/**
 * 引擎数据变更后「自动拆分混排双链」检查的延后一拍（毫秒）。
 * 文本编辑提交与数据写入可能在同一轮事件里，立刻检查会读到编辑框尚未收起的
 * 中间态（isEditingText 仍为真）；延后很短一瞬让引擎先完成收尾。
 */
export const AUTO_SPLIT_CHECK_DELAY_MS = 120;
export const VIEW_STATE_PERSIST_MS = 600;
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
 * 拖拽落点辅助判定半径（像素，CSS 像素空间，无需 devicePixelRatio）。
 * 引擎原生要求指针精确落在目标矩形内，此常量扩展为均匀圆形判定区。
 * 经验值 120px 覆盖多数兄弟节点间距（150–200px），密集布局下不误命中。
 */
export const DRAG_TARGET_RADIUS_PX = 120;

/**
 * 统一的节点图片显示尺寸。
 * 所有插入的图片都会以该固定高度显示，并完整呈现在子主题框架内；
 * SVG <image> 默认 preserveAspectRatio="xMidYMid meet"，图片会等比
 * 缩放并居中（必要时留白），不会被拉伸变形，也不会超出框架。
 */
export const IMAGE_WIDTH = 200;
export const IMAGE_HEIGHT = 120;

/**
 * Obsidian 核心视图类型标识（官方未公开常量；d.ts 的
 * `getLeavesOfType(viewType: string)` 仅接受字符串，无类型校验）。
 * 集中在常量表，核心改名/升级时一处核对，避免散落字符串漂移。
 */
export const CORE_VIEW_TYPE = {
	/** 文件浏览器视图（file-creator.ts 注入「新建」菜单） */
	FILE_EXPLORER: 'file-explorer',
	/** Markdown 视图（切回编辑/阅读，md-open.ts / open-as-restore.ts） */
	MARKDOWN: 'markdown',
} as const;

/**
 * 悬停预览事件名（`workspace.trigger('hover-link', …)`）。
 * 官方 `Workspace.on` 的类型化事件清单中不含该名（仅有 `registerHoverLinkSource`
 * 声明数据源），故集中为常量，避免拼写漂移。
 */
export const HOVER_LINK_EVENT = 'hover-link';
