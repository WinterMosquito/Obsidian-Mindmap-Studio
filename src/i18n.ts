/**
 * 国际化（i18n）：支持中文/英文，设置里切换。
 *
 * 采用 key-based 策略：`t(lang, key)` 从对应语言字典取值。
 * - ZH 字典的 key 集合决定了合法的 TranslationKey（编译期类型检查）
 * - EN 字典缺失时回退到 ZH
 * - 翻译值中可含 {name} / {count} 等占位符，由调用方在模板字符串中拼接
 */

/** 支持的语言 */
export type Language = 'zh' | 'en';

/** 插件设置中的语言选项 */
export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
	{ value: 'zh', label: '中文' },
	{ value: 'en', label: 'English' },
];

/** 中文字典（key → 中文） */
const ZH = {
	// ===== 命令 =====
	'command.createMindMap': '新建思维导图',
	'command.createInCurrentFolder': '在当前文件文件夹新建思维导图',
	'command.searchNodes': '搜索节点',
	'command.fitCanvas': '适应画布',
	'command.arrange': '自动整理思维导图',
	'command.exportPng': '导出为 PNG',
	'command.created': '思维导图已创建',
	'command.createFailed': '创建思维导图失败：',
	'command.openAsMindMap': '以思维导图打开',
	'command.openAsMarkdown': '以 Markdown 打开',
	'command.backToMarkdown': '切换回 Markdown',
	'command.splitLinks': '拆分节点内双链为子节点',
	'command.splitLinksAll': '拆分文档内全部混排双链',
	'rename.titleConflict': '已存在同名文件，无法按中心节点重命名',
	'rename.titleFailed': '按中心节点重命名文件失败',

	// ===== 工具栏 =====
	'toolbar.addChild': '添加子节点 (Tab)',
	'toolbar.addSibling': '添加同级节点 (Enter)',
	'toolbar.deleteNode': '删除节点 (Delete)',
	'toolbar.undo': '撤销 (Ctrl+Z / Command+Z)',
	'toolbar.redo': '重做 (Ctrl+Y / Command+Shift+Z)',
	'toolbar.backToMarkdown': '切换回 Markdown',
	'toolbar.undoShort': '撤销',
	'toolbar.redoShort': '重做',
	'toolbar.arrange': '自动整理',
	'toolbar.search': '搜索节点 (Ctrl+F)',
	'toolbar.searchPlaceholder': '搜索节点…',
	'toolbar.insertLink': '添加链接',
	'toolbar.insertImage': '添加图片',
	'toolbar.layout': '布局：',
	'toolbar.lineStyle': '连线：',
	'toolbar.zoomIn': '放大',
	'toolbar.zoomOut': '缩小',
	'toolbar.resetZoom': '重置缩放（100%）',
	'toolbar.exportPng': '导出 PNG',

	// ===== 右键菜单 =====
	'menu.editText': '编辑文本',
	'menu.addChild': '添加子节点',
	'menu.addSibling': '添加同级节点',
	'menu.copyNode': '复制节点',
	'menu.pasteAsChild': '粘贴为子节点',
	'menu.addLink': '添加链接',
	'menu.addImage': '添加图片',
	'menu.viewImageFullscreen': '全屏查看图片',
	'menu.removeImage': '移除图片',
	'menu.removeText': '移除文本',
	'menu.deleteNode': '删除节点',
	'menu.pasteNode': '粘贴节点',
	'menu.resetZoom': '重置缩放',

	// ===== 通用提示/通知 =====
	'common.mindMap': '思维导图',
	'common.notLoaded': '思维导图尚未加载',
	'common.arrangeDone': '已整理思维导图',
	'common.arrangeFailed': '无法整理思维导图',
	'common.noMatch': '没有匹配的节点',
	'common.nodeOne': '个节点',
	'common.nodeMany': '个节点',
	'common.selectNodeFirst': '请先选择一个节点',
	'common.rootCannotDelete': '中心节点不可删除',
	'common.clipboardEmpty': '剪贴板为空',
	'common.nodeCopied': '节点已复制',
	'common.splitLinksNone': '当前节点没有可拆分的混排双链',
	'common.splitLinksDone': '已拆分 {count} 条链接为子节点',
	'common.splitLinksAllDone': '已拆分 {nodes} 个节点、{links} 条链接',
	'common.selectNodeBeforePasteImage': '请先选择一个节点再粘贴图片',
	'common.savingClipboardImage': '正在保存剪贴板图片…',
	'common.imageSavedTo': '图片已保存到：',
	'common.pasteImageFailed': '粘贴图片失败：',
	'common.insertLinkFailed': '添加链接失败：',
	'common.insertImageFailed': '添加图片失败：',
	'common.dropFailed': '处理拖入文件失败：',
	'common.imageSetOnNode': '已设置节点图片：',
	'common.linkedTo': '已将节点链接到',
	'common.nodeCreatedAndLinked': '已创建节点并链接到',
	'common.cannotPreview': '无法在 Obsidian 中预览该文件类型',
	'common.cannotOpen': '无法打开该文件类型',

	// ===== 拖拽/导入 =====
	'common.selectNodeBeforeDrop': '请先选择一个节点，再拖入图片',
	'common.onlySupportedFiles':
		'不支持的文件类型（仅支持笔记、图片与可链接的附件）',
	'common.onlyImagesSupported': '外部拖入仅支持图片文件',
	'common.noImagesDropped': '未识别到图片文件',
	'common.importing': '正在导入',
	'common.imagesToVault': '张图片到仓库中…',
	'common.imported': '已导入',
	'common.imagesStored': '张图片（存放路径遵循「附件默认存放路径」设置）',
	'common.imagesPlaced': '1 张挂到所选节点，其余各新建为子节点',
	'common.importImageFailed': '部分图片导入失败：',

	// ===== 弹窗 - 链接 =====
	'modal.link.title': '设置节点链接',
	'modal.link.placeholder': '输入 URL 或搜索笔记/附件…',
	'modal.link.clear': '清除链接',

	// ===== 弹窗 - 图片 =====
	'modal.image.title': '设置节点图片',
	'modal.image.urlLabel': '图片 URL 或仓库路径：',
	'modal.image.hint': '输入 URL，或点击下方选择本地图片（自动保存到附件目录）',
	'modal.image.chooseLocal': '选择本地图片',
	'modal.image.paste': '粘贴图片',
	'modal.image.localHint': '从本地选择图片文件，自动保存到附件目录',
	'modal.image.loadFailed': '图片加载失败',
	'modal.image.none': '无图片',
	'modal.image.saving': '正在保存到附件目录…',
	'modal.image.saved': '已保存：',
	'modal.image.saveFailed': '保存失败',
	'modal.image.noClipboardImage': '剪贴板中没有图片',
	'modal.image.clipboardError': '无法访问剪贴板',
	'modal.image.clear': '清除图片',
	'modal.image.internalPath': '仓库路径：',
	'modal.image.address': '图片 URL：',

	// ===== 弹窗 - 命名 =====
	'modal.name.folder': '文件夹：',

	// ===== 通用按钮 =====
	'modal.cancel': '取消',
	'modal.create': '创建',
	'modal.apply': '应用',

	// ===== 设置 =====
	'settings.title': '设置',
	'settings.defaultLayout': '默认布局',
	'settings.defaultLayoutDesc': '新建思维导图时使用的默认布局',
	'settings.defaultLineStyle': '默认连线样式',
	'settings.defaultLineStyleDesc': '新建思维导图时使用的默认连线样式（自动＝随布局；仅逻辑结构图/思维导图/组织结构图支持三态切换）',
	'settings.defaultTheme': '默认主题',
	'settings.defaultThemeDesc': '新建思维导图时使用的默认主题',
	'settings.autoSave': '自动保存',
	'settings.autoSaveDesc': '编辑思维导图时自动保存到笔记',
	'settings.enableDrag': '启用节点拖拽',
	'settings.enableDragDesc': '允许拖拽节点改变层级和顺序',
	'settings.performanceMode': '性能模式',
	'settings.performanceModeDesc':
		'节点数超过阈值时只绘制视野内的节点，大图滚动更流畅',
	'settings.performanceThreshold': '性能模式阈值',
	'settings.performanceThresholdDesc': '节点数达到该数量时自动启用性能模式（仅性能模式开启时生效）',
	'settings.exportScale': '导出图片倍率',
	'settings.exportScaleDesc':
		'导出 PNG 时的分辨率倍率（倍；越高越清晰，文件也越大）',
	'settings.autoSplitMixedLinks': '自动拆分混排双链',
	'settings.autoSplitMixedLinksDesc':
		'被编辑的节点若含「双链 + 描述文字」，自动把文档/附件双链拆分为子节点（图片与外链不动）',
	'settings.language': '语言',
	'settings.languageDesc': '界面语言',

	// ===== 布局选项 =====
	'layout.logical': '逻辑结构图',
	'layout.mindMap': '思维导图',
	'layout.organization': '组织结构图',
	'layout.catalog': '目录组织图',
	'layout.timeline': '时间轴',
	'layout.fishbone': '鱼骨图',

	// ===== 连线样式 =====
	'lineStyle.auto': '自动',
	'lineStyle.curve': '曲线',
	'lineStyle.direct': '直连',
	'lineStyle.straight': '折线',

	// ===== 主题选项 =====
	'theme.default': '默认（跟随 Obsidian 配色）',
	'theme.forceLight': '强制亮色',
	'theme.forceDark': '强制暗色',

	// ===== 搜索栏按钮提示 =====
	'search.prev': '上一个 (Shift+Enter)',
	'search.next': '下一个 (Enter)',
	'search.close': '关闭 (Escape)',

	// ===== 导出 =====
	'export.pngFailed': '导出 PNG 失败：',

	// ===== 保存 =====
	'save.failed': '保存思维导图失败：',
	'save.pluginDataFailed': '写入插件配置失败：',

	// ===== 图片保存 =====
	'attachment.tooLarge': '图片过大（{size} MB），最大支持 {max} MB',
	'attachment.saveFailed': '保存图片失败：',
	'attachment.chooseImage': '请选择图片文件',

	// ===== 节点图片 =====
	'nodeImage.alt': '节点图片',

	// ===== 默认内容（新建思维导图） =====
	'default.shortcutHint': '示例：把想法拆成子节点',
	'default.tabHint': 'Tab：添加子节点',
	'default.enterHint': 'Enter：添加同级节点',
	'default.fileNamePrefix': '思维导图',
	'default.secondLevel': '节点',
	'default.belowSecondLevel': '子节点',
} as const;

/** 英文字典（key → English） */
const EN: Record<TranslationKey, string> = {
	// ===== 命令 =====
	'command.createMindMap': 'Create new mind map',
	'command.createInCurrentFolder': 'Create mind map in current folder',
	'command.searchNodes': 'Search nodes',
	'command.fitCanvas': 'Fit to canvas',
	'command.arrange': 'Arrange mind map',
	'command.exportPng': 'Export as PNG',
	'command.created': 'Mind map created',
	'command.createFailed': 'Failed to create mind map: ',
	'command.openAsMindMap': 'Open as mind map',
	'command.openAsMarkdown': 'Open as Markdown',
	'command.backToMarkdown': 'Switch to Markdown',
	'command.splitLinks': 'Split links into child nodes',
	'command.splitLinksAll': 'Split all mixed links in document',
	'rename.titleConflict': 'A file with that name already exists; cannot rename by central node',
	'rename.titleFailed': 'Failed to rename the file by its central node',

	// ===== 工具栏 =====
	'toolbar.addChild': 'Add child node (Tab)',
	'toolbar.addSibling': 'Add sibling node (Enter)',
	'toolbar.deleteNode': 'Delete node (Delete)',
	'toolbar.undo': 'Undo (Ctrl+Z / Command+Z)',
	'toolbar.redo': 'Redo (Ctrl+Y / Command+Shift+Z)',
	'toolbar.backToMarkdown': 'Switch to Markdown',
	'toolbar.undoShort': 'Undo',
	'toolbar.redoShort': 'Redo',
	'toolbar.arrange': 'Auto arrange',
	'toolbar.search': 'Search nodes (Ctrl+F)',
	'toolbar.searchPlaceholder': 'Search nodes…',
	'toolbar.insertLink': 'Add link',
	'toolbar.insertImage': 'Add image',
	'toolbar.layout': 'Layout: ',
	'toolbar.lineStyle': 'Line style: ',
	'toolbar.zoomIn': 'Zoom in',
	'toolbar.zoomOut': 'Zoom out',
	'toolbar.resetZoom': 'Reset zoom (100%)',
	'toolbar.exportPng': 'Export PNG',

	// ===== 右键菜单 =====
	'menu.editText': 'Edit text',
	'menu.addChild': 'Add child node',
	'menu.addSibling': 'Add sibling node',
	'menu.copyNode': 'Copy node',
	'menu.pasteAsChild': 'Paste as child',
	'menu.addLink': 'Add link',
	'menu.addImage': 'Add image',
	'menu.viewImageFullscreen': 'View image fullscreen',
	'menu.removeImage': 'Remove image',
	'menu.removeText': 'Remove text',
	'menu.deleteNode': 'Delete node',
	'menu.pasteNode': 'Paste node',
	'menu.resetZoom': 'Reset zoom',

	// ===== 通用提示/通知 =====
	'common.mindMap': 'Mind map',
	'common.notLoaded': 'Mind map not loaded yet',
	'common.arrangeDone': 'Mind map arranged',
	'common.arrangeFailed': 'Could not arrange the mind map',
	'common.noMatch': 'No matches',
	'common.nodeOne': 'node',
	'common.nodeMany': 'nodes',
	'common.selectNodeFirst': 'Please select a node first',
	'common.rootCannotDelete': 'The central node cannot be deleted',
	'common.clipboardEmpty': 'Clipboard is empty',
	'common.nodeCopied': 'Node copied',
	'common.splitLinksNone': 'No mixed links to split in this node',
	'common.splitLinksDone': 'Split {count} link(s) into child nodes',
	'common.splitLinksAllDone': 'Split {links} link(s) in {nodes} node(s)',
	'common.selectNodeBeforePasteImage': 'Please select a node before pasting an image',
	'common.savingClipboardImage': 'Saving clipboard image…',
	'common.imageSavedTo': 'Image saved to: ',
	'common.pasteImageFailed': 'Paste image failed: ',
	'common.insertLinkFailed': 'Add link failed: ',
	'common.insertImageFailed': 'Add image failed: ',
	'common.dropFailed': 'Failed to handle dropped file: ',
	'common.imageSetOnNode': 'Image set on node: ',
	'common.linkedTo': 'Linked node to ',
	'common.nodeCreatedAndLinked': 'Node created and linked to ',
	'common.cannotPreview': 'Cannot preview this file type in Obsidian',
	'common.cannotOpen': 'Cannot open this file type',

	// ===== 拖拽/导入 =====
	'common.selectNodeBeforeDrop': 'Please select a node before dropping an image',
	'common.onlySupportedFiles':
		'Unsupported file type (notes, images and linkable attachments only)',
	'common.onlyImagesSupported': 'Only image files can be dropped from outside Obsidian',
	'common.noImagesDropped': 'No image files detected',
	'common.importing': 'Importing',
	'common.imagesToVault': 'image(s) to the vault…',
	'common.imported': 'Imported',
	'common.imagesStored': 'image(s) (saved to the path in "Default location for new attachments")',
	'common.imagesPlaced': '1 on the selected node, the rest as new child nodes',
	'common.importImageFailed': 'Some images failed to import: ',

	// ===== 弹窗 - 链接 =====
	'modal.link.title': 'Set node link',
	'modal.link.placeholder': 'Enter a URL or search notes/attachments…',
	'modal.link.clear': 'Clear link',

	// ===== 弹窗 - 图片 =====
	'modal.image.title': 'Set node image',
	'modal.image.urlLabel': 'Image URL or vault path: ',
	'modal.image.hint':
		'Enter URL, or choose a local image below (auto-saved to attachments)',
	'modal.image.chooseLocal': 'Choose local image',
	'modal.image.paste': 'Paste image',
	'modal.image.localHint':
		'Choose a local image; it is saved to the attachment folder',
	'modal.image.loadFailed': 'Image load failed',
	'modal.image.none': 'No image',
	'modal.image.saving': 'Saving to the attachment folder…',
	'modal.image.saved': 'Saved: ',
	'modal.image.saveFailed': 'Could not save the image',
	'modal.image.noClipboardImage': 'No image in clipboard',
	'modal.image.clipboardError': 'Cannot access the clipboard',
	'modal.image.clear': 'Clear image',
	'modal.image.internalPath': 'Vault path: ',
	'modal.image.address': 'Image URL: ',

	// ===== 弹窗 - 命名 =====
	'modal.name.folder': 'Folder: ',

	// ===== 通用按钮 =====
	'modal.cancel': 'Cancel',
	'modal.create': 'Create',
	'modal.apply': 'Apply',

	// ===== 设置 =====
	'settings.title': 'Settings',
	'settings.defaultLayout': 'Default layout',
	'settings.defaultLayoutDesc': 'Default layout when creating a new mind map',
	'settings.defaultLineStyle': 'Default line style',
	'settings.defaultLineStyleDesc': 'Default connector style for new mind maps ("Auto" follows the layout; switchable only for Logical structure / Mind map / Organization chart)',
	'settings.defaultTheme': 'Default theme',
	'settings.defaultThemeDesc': 'Default theme when creating a new mind map',
	'settings.autoSave': 'Auto-save',
	'settings.autoSaveDesc': 'Automatically save the mind map to the note while editing',
	'settings.enableDrag': 'Enable node dragging',
	'settings.enableDragDesc':
		'Allow dragging nodes to change hierarchy and order',
	'settings.performanceMode': 'Performance mode',
	'settings.performanceModeDesc':
		'Draw only the nodes in view when the node count exceeds the threshold, which keeps large mind maps responsive',
	'settings.performanceThreshold': 'Node count threshold',
	'settings.performanceThresholdDesc':
		'Enable performance mode when the node count reaches this value (only when performance mode is on)',
	'settings.exportScale': 'Export image scale',
	'settings.exportScaleDesc':
		'Resolution scale for PNG export (higher is sharper and the file is larger)',
	'settings.autoSplitMixedLinks': 'Auto-split mixed links',
	'settings.autoSplitMixedLinksDesc':
		'When an edited node mixes links with description text, split document/attachment links into child nodes (images and external URLs are left untouched)',
	'settings.language': 'Language',
	'settings.languageDesc': 'UI language',

	// ===== 布局选项 =====
	'layout.logical': 'Logical structure',
	'layout.mindMap': 'Mind map',
	'layout.organization': 'Organization chart',
	'layout.catalog': 'Catalog organization',
	'layout.timeline': 'Timeline',
	'layout.fishbone': 'Fishbone',

	// ===== Line style =====
	'lineStyle.auto': 'Auto',
	'lineStyle.curve': 'Curve',
	'lineStyle.direct': 'Direct',
	'lineStyle.straight': 'Elbow',

	// ===== 主题选项 =====
	'theme.default': 'Default (use Obsidian color scheme)',
	'theme.forceLight': 'Force light',
	'theme.forceDark': 'Force dark',

	// ===== 搜索栏按钮提示 =====
	'search.prev': 'Previous (Shift+Enter)',
	'search.next': 'Next (Enter)',
	'search.close': 'Close (Escape)',

	// ===== 导出 =====
	'export.pngFailed': 'Export PNG failed: ',

	// ===== 保存 =====
	'save.failed': 'Failed to save mind map: ',
	'save.pluginDataFailed': 'Failed to write plugin config: ',

	// ===== 图片保存 =====
	'attachment.tooLarge':
		'Image is too large ({size} MB); the maximum is {max} MB',
	'attachment.saveFailed': 'Could not save the image: ',
	'attachment.chooseImage': 'Choose an image file',

	// ===== 节点图片 =====
	'nodeImage.alt': 'Node image',

	// ===== 默认内容（新建思维导图） =====
	'default.shortcutHint': 'Example: break an idea into child nodes',
	'default.tabHint': 'Tab: add a child node',
	'default.enterHint': 'Enter: add a sibling node',
	'default.fileNamePrefix': 'MindMap',
	'default.secondLevel': 'Node',
	'default.belowSecondLevel': 'Child node',
};

/** 合法翻译 key（由 ZH 字典的 key 集合派生，编译期类型检查） */
export type TranslationKey = keyof typeof ZH;

/**
 * 根据语言取文案。
 * @param lang 当前语言（zh/en）
 * @param key 翻译 key（必须是 ZH 字典中定义的 key）
 */
export function t(lang: Language, key: TranslationKey): string {
	if (lang === 'en') {
		return EN[key] ?? ZH[key];
	}
	return ZH[key];
}

/**
 * 取文案并替换 {name} 占位符（此前仅 images-save 用 .replace 链手工替换）。
 * @param params 占位符名 → 值（数字/字符串）
 */
export function tf(
	lang: Language,
	key: TranslationKey,
	params: Record<string, string | number>,
): string {
	let text = t(lang, key);
	for (const [name, value] of Object.entries(params)) {
		text = text.replaceAll(`{${name}}`, String(value));
	}
	return text;
}
