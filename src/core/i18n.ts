/**
 * 国际化（i18n）：支持中文/英文，设置里切换。
 *
 * 采用 key-based 策略：`t(lang, key)` 从对应语言字典取值。
 * - ZH 字典的 key 集合决定了合法的 TranslationKey（编译期类型检查）
 * - EN 声明为 `Record<TranslationKey, string>`，键集合由编译期强制与 ZH 对齐，
 *   故**不存在**运行时回退（缺词条是编译错误，不是运行期分支）
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
	'command.exportImage': '导出图片',
	'command.created': '思维导图已创建',
	'command.createFailed': '创建思维导图失败：',
	'command.openFailed': '文件已创建，但打开失败：',
	'command.openAsMindMap': '以思维导图打开',
	'command.openAsMarkdown': '以 Markdown 打开',
	'command.backToMarkdown': '切换回 Markdown',
	'command.downgradeFailed': '切换为 Markdown 文档失败：',
	'command.upgradeFailed': '切换为思维导图文档失败：',
	'command.splitLinksAll': '拆分文档内全部混排双链',
	'modal.text.titleRaw': '编辑节点原文（Markdown）',
	'modal.text.hintRaw':
		'这里就是文件里的那一行：双链 `[[…]]`、URL、`**粗体**` 等语法原样保存，节点内渲染为可点文本 / 样式。多行请直接换行（只有首行承载链接语法）。',
	'modal.text.preview': '节点将显示为：',
	'nodeTextTruncated':
		'节点文本过长，此处仅显示开头部分；完整内容仍保存在文件中，双击节点可查看或编辑',
	'codeBlock.copy': '复制代码',
	'rename.titleConflict': '已存在同名文件，无法按中心节点重命名',
	// 供 notifyError 拼接根因：与 save.failed 同口径，中文用全角冒号结尾
	'rename.titleFailed': '按中心节点重命名文件失败：',

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
	'toolbar.palette': '配色：',
	'toolbar.themeStyle': '边框：',
	'toolbar.zoomIn': '放大',
	'toolbar.zoomOut': '缩小',
	'toolbar.resetZoom': '重置缩放（100%）',
	'toolbar.exportImage': '导出图片',

	// ===== 右键菜单 =====
	'menu.editText': '编辑文本',
	'menu.editTextModal': '在弹窗中编辑',
	'menu.addChild': '添加子节点',
	'menu.addSibling': '添加同级节点',
	// 与相邻兄弟交换顺序（引擎 UP_NODE / DOWN_NODE；拖拽摆放过的节点位置不跟随）
	'menu.moveUp': '上移节点',
	'menu.moveDown': '下移节点',
	'menu.copyNode': '复制节点',
	'menu.pasteAsChild': '粘贴为子节点',
	'menu.addLink': '添加链接',
	// 与 Obsidian 阅读视图「链接右键」同款动作（官方 Canvas 亦有 Open in browser）
	'menu.openLinkNewTab': '在新标签页打开链接',
	'menu.copyLink': '复制链接',
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
	'common.mindMapAlreadyOpen': '该导图已在其他标签页打开，已切换到该标签页',
	'common.arrangeDone': '已整理思维导图',
	'common.arrangeFailed': '无法整理思维导图',
	'common.fitClamped': '节点较多（{count} 个），已按最小可读比例居中（不会一次显示全部节点）',
	'common.noMatch': '没有匹配的节点',
	'common.nodeOne': '个节点',
	'common.nodeMany': '个节点',
	'common.selectNodeFirst': '请先选择一个节点',
	'common.rootCannotDelete': '中心节点不可删除',
	'common.rootCannotMove': '中心节点不可上移或下移',
	'common.moveAtTop': '已是同级中的第一个节点',
	'common.moveAtBottom': '已是同级中的最后一个节点',
	'common.clipboardEmpty': '剪贴板为空',
	// 复制节点的成功提示（2026-10-13 用户裁决：文案就一个字「复制」）
	'common.nodeCopied': '复制',
	'common.splitLinksNone': '文档中没有可拆分的混排双链',
	'common.splitLinksAllDone': '已拆分 {nodes} 个节点、{links} 条链接',
	'common.savingClipboardImage': '正在保存剪贴板图片…',
	'common.imageSavedTo': '图片已保存到：',
	'common.pasteImageFailed': '粘贴图片失败：',
	'common.insertLinkFailed': '添加链接失败：',
	'common.editTextFailed': '编辑节点文本失败：',
	'common.linkCopied': '链接已复制',
	'common.clipboardError': '无法访问剪贴板',
	'common.insertImageFailed': '添加图片失败：',
	'common.dropFailed': '处理拖入文件失败：',
	'common.imageSetOnNode': '已设置节点图片：',
	'common.imageNodeCreated': '已新建图片节点：',
	'common.linkedTo': '已将节点链接到',
	'common.nodeCreatedAndLinked': '已创建节点并链接到',
	'common.cannotOpen': '无法打开该文件类型',
	// 「用系统默认应用打开」的失败：主因是系统里没有关联应用，与「文件类型不受支持」
	// 不同源，故独立成键（见 platform/system-open.surfaceOpenResult）
	'common.systemOpenFailed': '无法用系统默认应用打开该文件',
	'common.refreshFailed': '应用设置后重绘导图失败，已保留当前视图：',
	// 官方 Canvas：双击画布空白新建卡片 / 空白右键「新建节点」
	'menu.newNode': '新建节点',

	// ===== 拖拽/导入 =====
	'common.selectNodeBeforeDrop': '请先选择一个节点，再拖入文件',
	'common.noFilesDropped': '未识别到可导入的文件',
	'common.importing': '正在导入',
	'common.filesToVault': '个文件到仓库中…',
	'common.imported': '已导入',
	'common.filesStored': '个文件（存放路径遵循「附件默认存放路径」设置）',
	'common.filesPlaced': '1 个挂到所选节点，其余各新建为子节点',
	'common.importFileFailed': '部分文件导入失败：',
	'common.absoluteLinkInserted':
		'已插入指向原文件位置的绝对链接（未复制进仓库）',

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

	// ===== 弹窗 - 节点文本（自绘节点的编辑入口）=====
	'modal.text.title': '编辑节点文本',
	'modal.text.hint':
		'节点文本 = 写回文件的内容，可含 [[双链]]、[链接](url)、图片与 **轻标记**（选中节点双击或按 F2 打开）',

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
	'settings.defaultLineStyleDesc': '新建思维导图时使用的默认连线样式（折线 / 曲线；仅逻辑结构图/思维导图/组织结构图可切换）',
	'settings.defaultTheme': '主题',
	'settings.defaultThemeDesc':
		'导图的明暗配色：跟随 Obsidian / 强制亮色 / 强制暗色',
	'settings.defaultThemeStyle': '默认边框样式',
	'settings.defaultThemeStyleDesc':
		'新建思维导图的边框样式（单篇导图可在顶栏「边框」随时切换）',
	'settings.saveLocation': '新建导图的默认位置',
	'settings.saveLocationDesc':
		'新建思维导图时保存到哪个文件夹。「跟随 Obsidian 设置」＝使用官方「文件与链接 → 新建笔记的默认位置」',
	'settings.saveLocation.obsidian': '跟随 Obsidian 设置',
	'settings.saveLocation.root': '仓库的根目录',
	'settings.saveLocation.current': '当前文件所在的文件夹',
	'settings.saveLocation.folder': '指定的文件夹',
	'settings.saveFolder': '目标文件夹',
	'settings.saveFolderDesc':
		'「指定的文件夹」模式下新建导图的保存目录；文件夹不存在时保存到仓库的根目录',
	'settings.saveFolderPlaceholder': '文件夹路径',
	'settings.autoSave': '自动保存',
	'settings.autoSaveDesc': '编辑思维导图时自动保存到笔记',
	'settings.enableDrag': '启用节点拖拽',
	'settings.enableDragDesc': '允许拖拽节点改变层级和顺序',
	'settings.exportScale': '导出图片倍率',
	'settings.exportScaleDesc':
		'导出 PNG 时的分辨率倍率（倍；越高越清晰，文件也越大；SVG 导出为矢量，不受倍率影响）',
	'settings.exportImageFormat': '导出格式',
	'settings.exportImageFormatDesc':
		'导出图片时使用的格式（PNG 位图 / SVG 矢量；倍率设置仅作用于 PNG）',
	'settings.exportFormat.png': 'PNG（位图）',
	'settings.exportFormat.svg': 'SVG（矢量）',
	'settings.autoSplitMixedLinks': '自动拆分混排双链',
	'settings.autoSplitMixedLinksDesc':
		'默认关闭。开启后，被编辑的节点若含「双链 + 描述文字」，自动把文档/附件双链拆分为子节点（图片与外链不动）——这会改写文件结构；整篇批处理请用命令「拆分文档内全部混排双链」',
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
	'lineStyle.curve': '曲线',
	'lineStyle.straight': '折线',
	// 固定直线布局（目录组织图/时间轴/鱼骨图）的描述：连线由布局类绘制、不可切换
	'lineStyle.fixedStraight': '直线',

	// ===== 主题选项 =====
	'theme.default': '跟随 Obsidian',
	'theme.forceLight': '强制亮色',
	'theme.forceDark': '强制暗色',
	'themeStyle.default': '有边框',
	'themeStyle.borderless': '无边框',
	'palette.default': '默认',
	'palette.mint': '薄荷',
	'palette.amber': '琥珀',
	'palette.wisteria': '紫藤',
	'palette.forest': '森林',
	'palette.slate': '石板',

	// ===== 搜索栏按钮提示 =====
	'search.prev': '上一个 (Shift+Enter)',
	'search.next': '下一个 (Enter)',
	'search.close': '关闭 (Escape)',

	// ===== 导出 =====
	'export.pngFailed': '导出 PNG 失败：',
	'export.svgFailed': '导出 SVG 失败：',

	// ===== 保存 =====
	'save.failed': '保存思维导图失败：',
	'save.externalChangeSkipped':
		'文件在外部被修改（同步盘/其它窗口），本次自动保存已跳过以避免覆盖；确认以导图内容为准后请手动保存：',
	'save.autoSuspended':
		'连续自动保存失败，已暂停自动保存；编辑内容仍在内存中，修复问题后请手动保存',
	'save.pluginDataFailed': '写入插件配置失败：',

	// ===== 图片保存 =====
	'attachment.tooLarge': '图片过大（{size} MB），最大支持 {max} MB',
	'attachment.saveFailed': '保存图片失败：',
	'attachment.chooseImage': '请选择图片文件',

	// ===== 节点图片 =====
	'nodeImage.alt': '节点图片',

	// ===== 代码块嵌入（```mindmap 只读导图） =====
	/** 块体没有 `#` 一级标题时的中心主题名（有标题则用标题文本） */
	'mindmapEmbed.root': '思维导图',
	'mindmapEmbed.empty': '代码块内没有可渲染的大纲内容',
	'mindmapEmbed.tooMany':
		'导图节点数 {count} 超过嵌入上限 {max}，此处仅显示大纲',
	'mindmapEmbed.renderFailed': '代码块导图渲染失败（详见控制台）',

	// ===== 默认内容（新建思维导图） =====
	'default.shortcutHint': '示例：把想法拆成子节点',
	'default.tabHint': 'Tab：添加子节点',
	'default.enterHint': 'Enter：添加同级节点',
	'default.fileNamePrefix': '思维导图',
} as const;

/** 英文字典（key → English） */
const EN: Record<TranslationKey, string> = {
	// ===== 命令 =====
	'command.createMindMap': 'Create new mind map',
	'command.createInCurrentFolder': 'Create mind map in current folder',
	'command.searchNodes': 'Search nodes',
	'command.fitCanvas': 'Fit to canvas',
	'command.arrange': 'Arrange mind map',
	'command.exportImage': 'Export image',
	'command.created': 'Mind map created',
	'command.createFailed': 'Failed to create mind map: ',
	'command.openFailed': 'File created, but failed to open it: ',
	'command.openAsMindMap': 'Open as mind map',
	'command.openAsMarkdown': 'Open as Markdown',
	'command.backToMarkdown': 'Switch to Markdown',
	'command.downgradeFailed': 'Failed to switch to a Markdown document: ',
	'command.upgradeFailed': 'Failed to switch to a mind map document: ',
	'command.splitLinksAll': 'Split all mixed links in document',
	'modal.text.titleRaw': 'Edit node source (Markdown)',
	'modal.text.hintRaw':
		'This is the actual line from the file: wikilink `[[…]]`, URL and `**bold**` syntax are kept verbatim and rendered as clickable text / styles inside the node. Add newlines for extra lines (only the first line carries link syntax).',
	'modal.text.preview': 'The node will show:',
	'nodeTextTruncated':
		'Node text is too long, so only the beginning is shown here; the full text is kept in the file (double-click the node to view or edit it).',
	'codeBlock.copy': 'Copy code',
	'rename.titleConflict': 'A file with that name already exists; cannot rename by central node',
	'rename.titleFailed': 'Failed to rename the file by its central node: ',

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
	'toolbar.palette': 'Palette: ',
	'toolbar.themeStyle': 'Border: ',
	'toolbar.zoomIn': 'Zoom in',
	'toolbar.zoomOut': 'Zoom out',
	'toolbar.resetZoom': 'Reset zoom (100%)',
	'toolbar.exportImage': 'Export image',

	// ===== 右键菜单 =====
	'menu.editText': 'Edit text',
	'menu.editTextModal': 'Edit in dialog',
	'menu.addChild': 'Add child node',
	'menu.addSibling': 'Add sibling node',
	'menu.moveUp': 'Move node up',
	'menu.moveDown': 'Move node down',
	'menu.copyNode': 'Copy node',
	'menu.pasteAsChild': 'Paste as child',
	'menu.addLink': 'Add link',
	'menu.openLinkNewTab': 'Open link in new tab',
	'menu.copyLink': 'Copy link',
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
	'common.mindMapAlreadyOpen':
		'This mind map is already open in another tab — switched to it',
	'common.arrangeDone': 'Mind map arranged',
	'common.arrangeFailed': 'Could not arrange the mind map',
	'common.fitClamped': 'Large map ({count} nodes): centered at the minimum readable zoom (not all nodes shown)',
	'common.noMatch': 'No matches',
	'common.nodeOne': 'node',
	'common.nodeMany': 'nodes',
	'common.selectNodeFirst': 'Please select a node first',
	'common.rootCannotDelete': 'The central node cannot be deleted',
	'common.rootCannotMove': 'The central node cannot be moved',
	'common.moveAtTop': 'Already the first sibling',
	'common.moveAtBottom': 'Already the last sibling',
	'common.clipboardEmpty': 'Clipboard is empty',
	'common.nodeCopied': 'Copy',
	'common.splitLinksNone': 'No mixed links to split in this document',
	'common.splitLinksAllDone': 'Split {links} link(s) in {nodes} node(s)',
	'common.savingClipboardImage': 'Saving clipboard image…',
	'common.imageSavedTo': 'Image saved to: ',
	'common.pasteImageFailed': 'Paste image failed: ',
	'common.insertLinkFailed': 'Add link failed: ',
	'common.editTextFailed': 'Failed to edit the node text: ',
	'common.linkCopied': 'Link copied',
	'common.clipboardError': 'Cannot access the clipboard',
	'common.insertImageFailed': 'Add image failed: ',
	'common.dropFailed': 'Failed to handle dropped file: ',
	'common.imageSetOnNode': 'Image set on node: ',
	'common.imageNodeCreated': 'Image node added: ',
	'common.linkedTo': 'Linked node to ',
	'common.nodeCreatedAndLinked': 'Node created and linked to ',
	'common.cannotOpen': 'Cannot open this file type',
	'common.systemOpenFailed': 'Could not open the file with the system default app',
	'common.refreshFailed':
		'Failed to redraw the mind map after applying settings — the current view was kept: ',
	// Official Canvas: double-click blank canvas / blank context menu to create a node
	'menu.newNode': 'New node',

	// ===== 拖拽/导入 =====
	'common.selectNodeBeforeDrop': 'Please select a node before dropping a file',
	'common.noFilesDropped': 'No importable files detected',
	'common.importing': 'Importing',
	'common.filesToVault': 'file(s) to the vault…',
	'common.imported': 'Imported',
	'common.filesStored':
		'file(s) (saved to the path in "Default location for new attachments")',
	'common.filesPlaced': '1 on the selected node, the rest as new child nodes',
	'common.importFileFailed': 'Some files failed to import: ',
	'common.absoluteLinkInserted':
		'Inserted absolute links to the original locations (files not copied)',

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

	// ===== Modal - node text (edit entry for custom-content nodes) =====
	'modal.text.title': 'Edit node text',
	'modal.text.hint':
		'Node text is what gets written back: [[wikilinks]], [links](url), images and **markup** are allowed (double-click a node or press F2)',

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
	'settings.defaultLineStyleDesc': 'Default connector style for new mind maps (Elbow / Curve; switchable only for Logical structure / Mind map / Organization chart)',
	'settings.defaultTheme': 'Theme',
	'settings.defaultThemeDesc':
		'Light/dark palette for mind maps: follow Obsidian / force light / force dark',
	'settings.defaultThemeStyle': 'Default border style',
	'settings.defaultThemeStyleDesc':
		'Border style for new mind maps (each map can switch it anytime from the "Border" dropdown in the toolbar)',
	'settings.saveLocation': 'Default location for new mind maps',
	'settings.saveLocationDesc':
		'Where new mind maps are saved. "Follow Obsidian setting" uses Files and links → Default location for new notes',
	'settings.saveLocation.obsidian': 'Follow Obsidian setting',
	'settings.saveLocation.root': 'Vault root',
	'settings.saveLocation.current': 'Same folder as current file',
	'settings.saveLocation.folder': 'In the folder specified below',
	'settings.saveFolder': 'Target folder',
	'settings.saveFolderDesc':
		'Folder for new mind maps in the "In the folder specified below" mode; if the folder does not exist, new mind maps are saved to the vault root',
	'settings.saveFolderPlaceholder': 'Folder path',
	'settings.autoSave': 'Auto-save',
	'settings.autoSaveDesc': 'Automatically save the mind map to the note while editing',
	'settings.enableDrag': 'Enable node dragging',
	'settings.enableDragDesc':
		'Allow dragging nodes to change hierarchy and order',
	'settings.exportScale': 'Export image scale',
	'settings.exportScaleDesc':
		'Resolution scale for PNG export (higher is sharper and the file is larger; SVG export is vector-based and unaffected)',
	'settings.exportImageFormat': 'Export format',
	'settings.exportImageFormatDesc':
		'Format used when exporting images (PNG raster / SVG vector; the scale setting only affects PNG)',
	'settings.exportFormat.png': 'PNG (raster)',
	'settings.exportFormat.svg': 'SVG (vector)',
	'settings.autoSplitMixedLinks': 'Auto-split mixed links',
	'settings.autoSplitMixedLinksDesc':
		'Off by default. When enabled, an edited node that mixes links with description text has its document/attachment links split into child nodes (images and external URLs are left untouched) — this rewrites the file structure; for a whole file use the command "Split all mixed links in document"',
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
	'lineStyle.curve': 'Curve',
	'lineStyle.straight': 'Elbow',
	// 固定直线布局（目录组织图/时间轴/鱼骨图）的描述：连线由布局类绘制、不可切换
	'lineStyle.fixedStraight': 'Straight',

	// ===== 主题选项 =====
	'theme.default': 'Follow Obsidian',
	'theme.forceLight': 'Force light',
	'theme.forceDark': 'Force dark',
	'themeStyle.default': 'Bordered',
	'themeStyle.borderless': 'Borderless',
	'palette.default': 'Default',
	'palette.mint': 'Mint',
	'palette.amber': 'Amber',
	'palette.wisteria': 'Wisteria',
	'palette.forest': 'Forest',
	'palette.slate': 'Slate',

	// ===== 搜索栏按钮提示 =====
	'search.prev': 'Previous (Shift+Enter)',
	'search.next': 'Next (Enter)',
	'search.close': 'Close (Escape)',

	// ===== 导出 =====
	'export.pngFailed': 'Export PNG failed: ',
	'export.svgFailed': 'Export SVG failed: ',

	// ===== 保存 =====
	'save.failed': 'Failed to save mind map: ',
	'save.externalChangeSkipped':
		'The file was modified externally (sync drive/another window); auto-save was skipped to avoid overwriting. If the mind map content is the one to keep, save manually: ',
	'save.autoSuspended':
		'Auto-save suspended after repeated failures; your edits are still in memory — save manually once the problem is fixed',
	'save.pluginDataFailed': 'Failed to write plugin config: ',

	// ===== 图片保存 =====
	'attachment.tooLarge':
		'Image is too large ({size} MB); the maximum is {max} MB',
	'attachment.saveFailed': 'Could not save the image: ',
	'attachment.chooseImage': 'Choose an image file',

	// ===== 节点图片 =====
	'nodeImage.alt': 'Node image',

	// ===== 代码块嵌入（```mindmap 只读导图） =====
	'mindmapEmbed.root': 'Mind map',
	'mindmapEmbed.empty': 'There is no outline content to render in this block',
	'mindmapEmbed.tooMany':
		'The map has {count} nodes, above the embed limit of {max}; showing an outline instead',
	'mindmapEmbed.renderFailed': 'Failed to render the mind map in this code block (see console)',

	// ===== 默认内容（新建思维导图） =====
	'default.shortcutHint': 'Example: break an idea into child nodes',
	'default.tabHint': 'Tab: add a child node',
	'default.enterHint': 'Enter: add a sibling node',
	'default.fileNamePrefix': 'MindMap',
};

/** 合法翻译 key（由 ZH 字典的 key 集合派生，编译期类型检查） */
export type TranslationKey = keyof typeof ZH;

/**
 * 根据语言取文案。
 * @param lang 当前语言（zh/en）
 * @param key 翻译 key（必须是 ZH 字典中定义的 key）
 */
export function t(lang: Language, key: TranslationKey): string {
	// EN 为完整 Record（编译期强制），`EN[key]` 恒有值，此前 `?? ZH[key]`
	// 是永不触发的死分支（且与「双语对齐」硬规则相悖），已删除。
	if (lang === 'en') {
		return EN[key];
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
