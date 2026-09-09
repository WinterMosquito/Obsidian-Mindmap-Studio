/**
 * 全局常量定义。
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
 * 可链接的附件扩展（音/视/PDF 等库内文件）：
 * 在导图中以 [[库内路径]] 链接形式引用（Obsidian 打开/系统应用）。
 * 图片不在此列——图片走 image 语义（![[...]] 渲染）。
 */
const LINK_ATTACHMENT_EXTENSIONS = [
	...AUDIO_VIDEO_EXTENSIONS,
	// 文档
	'pdf',
	'epub',
	'zip',
];

/** 判断扩展名是否为可链接附件 */
export function isLinkAttachmentExtension(extension: string): boolean {
	return LINK_ATTACHMENT_EXTENSIONS.includes(extension.toLowerCase());
}

/** 粘贴/拖入图片大小上限（MB） */
export const MAX_IMAGE_SIZE_MB = 10;

/** 判断扩展名是否为图片 */
export function isImageExtension(extension: string): boolean {
	return IMAGE_EXTENSIONS.includes(extension.toLowerCase());
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
 * 设置项取值域：设置面板滑块的 min/max 与 sanitizeSettings 的钳制共用同一来源，
 * 避免「面板能选 1-4、data.json 手改成 99 却直达引擎」这类漂移。
 */
export const EXPORT_SCALE_MIN = 1;
export const EXPORT_SCALE_MAX = 4;
export const PERFORMANCE_THRESHOLD_MIN = 100;
export const PERFORMANCE_THRESHOLD_MAX = 2000;

/**
 * Obsidian 能在标签页中渲染、不会出现空白页的扩展名（md/canvas/PDF/图片/纯文本·代码）。
 * 用于点击导图内链接/附件时判断能否直接用 Obsidian 打开。
 * 音频/视频不在其中：Obsidian 桌面端没有音频/视频的标签页视图，
 * 打开后会交由系统默认应用并留下一个空白标签页（见 SYSTEM_MEDIA_EXTENSIONS）。
 */
const OBSIDIAN_RENDER_EXTENSIONS: ReadonlySet<string> = new Set([
	'md',
	'canvas',
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
const SYSTEM_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set(
	AUDIO_VIDEO_EXTENSIONS,
);

/** 判断某扩展名能否在 Obsidian 标签页中直接打开（可渲染、不出现空白标签页） */
export function canOpenInObsidian(extension: string): boolean {
	return OBSIDIAN_RENDER_EXTENSIONS.has(extension.toLowerCase());
}

/** 判断某扩展名是否为系统默认应用打开的音频/视频（Obsidian 无标签页视图） */
export function isSystemMediaExtension(extension: string): boolean {
	return SYSTEM_MEDIA_EXTENSIONS.has(extension.toLowerCase());
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
 * - AUTO_SAVE_DEBOUNCE_MS       ：自动保存防抖（引擎修改触发保存）；
 * - VIEW_STATE_PERSIST_MS       ：ViewStateStore 布局/视口防抖；
 * - TITLE_RENAME_DEBOUNCE_MS    ：中心主题重命名防抖。
 */
export const SETTINGS_PERSIST_DEBOUNCE_MS = 400;
/**
 * 自动保存防抖（SavePipeline 引擎修改触发）。
 * 设为 800ms——比视图状态持久化长（避免引擎高频数据变更时与磁盘 I/O 争抢），
 * 但不超过用户感知阈值（秒级无响应会被认为卡死）。
 */
export const AUTO_SAVE_DEBOUNCE_MS = 800;
export const VIEW_STATE_PERSIST_MS = 600;
/**
 * 标题重命名防抖（更长——涉及 Obsidian vault.rename 引发反链更新，
 * 1.5s 等待用户停止打字 + isEditingText 守卫二次确认编辑结束）。
 */
export const TITLE_RENAME_DEBOUNCE_MS = 1500;

/**
 * RESET_LAYOUT 后重置视口（100% + 根节点居中）的等待延迟（毫秒）。
 * 引擎 resetLayout 内部同步 render → 浏览器 reflow 需要时间；
 * 不用 requestAnimationFrame（只保证下帧前回调，不保证 reflow 已完成）。
 * 80ms 在所有设备上远快于用户感知阈值，同时留出引擎内部处理余量；
 * 若引擎升级提供「布局完成」回调，应优先替换此处。
 */
export const RESET_LAYOUT_VIEWPORT_DELAY_MS = 80;

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
