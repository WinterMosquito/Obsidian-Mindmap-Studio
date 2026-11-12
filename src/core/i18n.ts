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
	// ===== 文件右键菜单 =====
	'fileMenu.createMindMap': '新建导图',

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
	// 点击徽标但全文没有这条定义
	'footnote.missingDefinition': '未找到脚注定义 [^{id}]',
	// 定义存在但引擎没能定位（引擎方法缺失 / 渲染树尚未就绪）
	'footnote.revealFailed': '无法定位到脚注 [^{id}] 的定义节点',
	// 纯定义节点的汇总 chip（定义正文不铺在节点里，只作「这里有脚注」的入口）。
	// 不报条数：写「脚注 N」会被读成「第 N 条脚注」，「N 条脚注」又嫌啰嗦
	// （2026-11-11 用户裁决：只显示「脚注」）
	'footnote.summaryLabel': '脚注',
	'codeBlock.copy': '复制代码',
	// mermaid 图容器的复制按钮（复制的是图的**源码**，不是渲染产物）
	'mermaid.copy': '复制 Mermaid 源码',
	// 任务复选框的无障碍标签（点击切换，无右键入口）
	'node.task.markDone': '标记为完成',
	'node.task.markUndone': '标记为未完成',
	// 标签点击 → 官方搜索插件（私有触点缺失时的可见回退）
	'tag.searchUnavailable': '无法打开标签搜索（未找到搜索插件）',
	'rename.titleConflict': '已存在同名文件，无法按中心节点重命名',
	// 供 notifyError 拼接根因：与 save.failed 同口径，中文用全角冒号结尾
	'rename.titleFailed': '按中心节点重命名文件失败：',

	// ===== 工具栏 =====
	'toolbar.undo': '撤销',
	'toolbar.redo': '重做',
	'toolbar.backToMarkdown': '返回',
	'toolbar.arrange': '自动整理',
	'toolbar.searchPlaceholder': '搜索节点…',
	'toolbar.layout': '布局',
	'toolbar.lineStyle': '连线',
	'toolbar.palette': '配色',
	'toolbar.themeStyle': '边框',
	'toolbar.zoomIn': '放大',
	'toolbar.zoomOut': '缩小',
	'toolbar.resetZoom': '重置',
	'toolbar.exportImage': '导出',
	'toolbar.tipFit': '总览',
	'toolbar.tipArrange': '整理',

	// ===== 层级语法（标题 / 无序列表）=====
	'syntax.title': '层级语法',
	'syntax.list': '无序列表',
	'syntax.heading1': '标题（一级）',
	'syntax.heading2': '标题（二级）',
	'syntax.done': '已改写 {count} 个节点',
	'syntax.none': '已是该层级语法，无需改动',
	'syntax.keptList': '「{text}」无法写成标题，本层保持列表',
	'syntax.pasteBlocked':
		'粘贴内容含无法写成标题的节点（多行 / 任务项 / 有序列表）；请先选中一个标题节点，再粘贴为其子节点',
	'syntax.guardUpgraded': '已按该层语法把「{text}」改为标题',
	'syntax.guardReleveled':
		'已按该层语法调整「{text}」的标题级别',
	'syntax.guardDowngraded':
		'已按该层语法把「{text}」改为无序列表（Ctrl+Z 可撤销）',
	'syntax.guardDemoted':
		'第 6 级之下写不了标题，「{text}」已改为无序列表（Ctrl+Z 可撤销）',
	'syntax.guardDowngradedAnchors':
		'已把 {count} 个标题改为无序列表（含「{text}」）；指向这些标题的 [[#标题]] 链接将失效，可用 Ctrl+Z 撤销',
	// 「这次改动」而非「这次拖拽」：同一条分支也可能是粘贴 / 撤销落回触发的
	'syntax.guardBlockedUpgrade':
		'该层使用标题语法，「{text}」无法写成标题，已撤回这次改动',
	'syntax.guardBlockedDowngrade':
		'段落之下无法保留标题（「{text}」），已撤回这次改动；请用右键「层级语法」显式转换',

	// ===== 右键菜单 =====
	'menu.editText': '编辑文本',
	'menu.editTextModal': '在弹窗中编辑',
	'menu.addChild': '添加子节点',
	'menu.addSibling': '添加同级节点',
	// 与相邻兄弟交换顺序（引擎 UP_NODE / DOWN_NODE；拖拽摆放过的节点位置不跟随）
	'menu.moveUp': '上移节点',
	'menu.moveDown': '下移节点',
	'menu.copyNode': '复制节点',
	/** 多选时的复制：标题报数量（与「概要（覆盖 N 个）」同一口径） */
	'menu.copyNodeCount': '复制 {count} 个节点',
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
	// 节点右键「配色」首项：UI 只叫「默认」（＝不写指令、跟随整篇配色；
	// 与「清除节点颜色」同一个动作，2026-10-27 用户裁决合并并简化文案）
	'menu.color.follow': '默认',

	// ===== 通用提示/通知 =====
	'common.mindMap': '思维导图',
	'common.notLoaded': '思维导图尚未加载',
	'common.arrangeDone': '已整理思维导图',
	'common.arrangeFailed': '无法整理思维导图',
	'common.fitClamped': '节点较多（{count} 个），已按最小可读比例居中（不会一次显示全部节点）',
	'common.noMatch': '没有匹配的节点',
	'common.nodeOne': '个节点',
	'common.nodeMany': '个节点',
	'common.saveSaving': '保存中…',
	'common.saveSaved': '已保存',
	'common.saveUnsaved': '未保存',
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

	// ===== 弹窗 - 配色作用范围清理（K175）=====
	'modal.colorScopeCleanup.title': '清理旧的「不继承」标记？',
	'modal.colorScopeCleanup.body':
		'已切换为「含子节点」。在 {files} 个已打开的导图中共有 {count} 处 `%%none%%`（阻断继承）；其中可能包含你手动设过「默认」的节点。\n清理会把这些标记从正文删除，相关节点将重新继承上层颜色；文件会被改写（可用 Ctrl+Z 撤销）。',
	'modal.colorScopeCleanup.confirm': '清理',
	'modal.colorScopeCleanup.keep': '保留',
	'colorScope.cleanupDone': '已清理 {count} 处 `%%none%%`',

	// ===== 设置 =====
	// 分组标题（面板按「常规 / 外观 / 文件与保存 / 交互与导出」四段排布）
	'settings.groupGeneral': '常规',
	'settings.groupAppearance': '外观',
	'settings.groupFile': '文件与保存',
	'settings.groupExport': '交互与导出',
	'settings.language': '语言',
	'settings.languageDesc': '插件界面与提示的语言，切换后立即生效',
	'settings.defaultLayout': '默认布局',
	'settings.defaultLayoutDesc':
		'新建导图使用的布局\n已有导图各自把布局记在文件属性里，可在右键菜单「布局」中切换',
	'settings.defaultLineStyle': '默认连线样式',
	'settings.defaultLineStyleDesc':
		'新建导图使用的连线样式\n仅逻辑结构图、思维导图、组织结构图支持折线与曲线',
	'settings.defaultThemeStyle': '默认边框样式',
	'settings.defaultThemeStyleDesc':
		'新建导图使用的边框样式\n单篇导图可在右缘竖栏点「边框」切换；已有导图保留各自设置',
	'settings.defaultTheme': '明暗主题',
	'settings.defaultThemeDesc':
		'导图的明暗配色\n跟随 Obsidian：随宿主主题自动切换；固定亮色或暗色可保持导图观感不变',
	'settings.nodeColorScope': '配色作用范围',
	'settings.nodeColorScopeDesc':
		'右键节点「配色」时颜色的作用范围\n仅本节点：只给选中节点上色，子节点不继承，连线也不染色\n含子节点：整支子树同色，连线一起染色\n从「仅本节点」切回「含子节点」时，会询问是否清理已打开导图里的旧标记',
	'settings.nodeColorScope.subtree': '含子节点',
	'settings.nodeColorScope.node': '仅本节点',
	'settings.saveLocation': '新建导图的默认位置',
	'settings.saveLocationDesc':
		'新建导图保存到哪个文件夹\n「跟随 Obsidian 设置」：使用官方「文件与链接 → 新建笔记的默认位置」',
	'settings.saveLocation.obsidian': '跟随 Obsidian 设置',
	'settings.saveLocation.root': '仓库的根目录',
	'settings.saveLocation.current': '当前文件所在的文件夹',
	'settings.saveLocation.folder': '指定的文件夹',
	'settings.saveFolder': '目标文件夹',
	'settings.saveFolderDesc':
		'「指定的文件夹」模式使用的目录\n目录不存在时，新建导图保存到仓库根目录',
	'settings.newMapSyntax': '新建导图的层级语法',
	'settings.newMapSyntaxDesc':
		'新建导图的正文语法\n列表：用无序列表表达层级；标题：用 Markdown 标题表达层级（可从一级或二级开始，六级之后回落列表）\n只影响新建与空的导图；已有导图按自身写法回写，可在右键菜单「层级语法」中转换',
	'settings.saveFolderPlaceholder': '文件夹路径',
	'settings.autoSplitMixedLinks': '自动拆分混排双链',
	'settings.autoSplitMixedLinksDesc':
		'编辑节点时，若正文混有链接与描述文字，自动把链接拆成子节点\n仅处理文档与附件链接（图片和外链不动）；会改写文件结构，默认关闭\n整篇处理可用命令「拆分文档内全部混排双链」',
	'settings.enableDrag': '启用节点拖拽',
	'settings.enableDragDesc':
		'允许拖动节点调整层级与顺序\n关闭后只能通过编辑文本改变层级',
	'settings.exportScale': '导出图片倍率',
	'settings.exportScaleDesc':
		'导出 PNG 的分辨率倍率：越高越清晰，文件也越大\nSVG 是矢量格式，不受影响',
	'settings.exportImageFormat': '导出格式',
	'settings.exportImageFormatDesc':
		'导出图片的默认格式（PNG 位图 / SVG 矢量）\n倍率设置只影响 PNG',
	'settings.exportFormat.png': 'PNG（位图）',
	'settings.exportFormat.svg': 'SVG（矢量）',

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

	// ===== 主题选项 =====
	'theme.default': '跟随 Obsidian',
	'theme.forceLight': '强制亮色',
	'theme.forceDark': '强制暗色',
	'themeStyle.default': '有边框',
	'themeStyle.borderless': '无边框',
	'palette.default': '默认',
	// 色号统一两个字（2026-11-05）：不用植物/物品名，也不用单字
	'palette.teal': '青碧',
	'palette.blue': '湛蓝',
	'palette.purple': '紫棠',
	'palette.crimson': '绯红',
	'palette.orange': '暖橙',
	'palette.gold': '麦黄',
	'palette.green': '翠绿',
	'palette.grey': '银灰',
	'palette.mist': '雾白',
	// 节点级配色（右键「配色」）：只列非默认配色（「默认」项已表达跟随整篇）
	'palette.custom': '自定义',
	'palette.branchColors': '按分支自动上色',
	'nodeColor.teal': '青碧',
	'nodeColor.blue': '湛蓝',
	'nodeColor.purple': '紫棠',
	'nodeColor.crimson': '绯红',
	'nodeColor.orange': '暖橙',
	'nodeColor.gold': '麦黄',
	'nodeColor.green': '翠绿',
	'nodeColor.grey': '银灰',
	'nodeColor.mist': '雾白',
	// 联系（关系连线）：节点右键「联系」直落选点；线右键「编辑标签 / 删除」
	'nodeRelation.add': '联系',
	'nodeRelation.addHint': '点击目标节点完成，Esc 取消',
	'nodeRelation.anchorStart': '移动鼠标，点击落定起点（Esc 取消）',
	'nodeRelation.anchorEnd': '点击落定终点（Esc 取消）',
	'nodeRelation.exists': '已存在指向该节点的联系',
	'nodeRelation.color': '联系配色',
	'nodeRelation.editLabel': '编辑联系标签',
	'nodeRelation.delete': '删除联系',
	'nodeRelation.labelPlaceholder': '可选说明',
	'nodeRelation.labelInvalid': '标签不能包含 %% 或 [[ ]]',
	'nodeRelation.rootUnsupported': '中心主题不能作为联系端点',
	// 概要（Summary）：节点右键建；概要节点右键改文字 / 删除
	'summary.add': '概要',
	/** 两次点选入口（没有够用的多选时） */
	'summary.addPick': '概要…',
	/** 选中集合够用：标题直接报覆盖数 */
	'summary.addCount': '概要（覆盖 {count} 个）',
	'summary.pickHint': '概要：从「{node}」开始，点击最后一个节点完成（Esc 取消）',
	'summary.pickNotSibling': '终点必须与起点同级（Esc 取消）',
	'summary.pickInvalid': '这里不能放概要（Esc 取消）',
	'summary.pickOverlap': '与已有概要重叠，换个终点（Esc 取消）',
	'summary.defaultText': '概要',
	/** 创建场景的弹窗标题（与「编辑」区分：此前两处共用「编辑概要文字」） */
	'summary.newText': '新建概要',
	'summary.editText': '编辑概要文字',
	'summary.delete': '删除概要',
	'summary.textPlaceholder': '概要文字',
	'summary.textInvalid': '文字不能包含 %% 或 [[ ]]',
	'summary.textEmpty': '概要文字不能为空',
	'summary.needSiblings': '概要只能覆盖相邻的同级节点',
	'summary.rootUnsupported': '中心主题不能作为概要对象',
	'summary.overlap': '该范围已有概要',
	'summary.unresolved': '正文里找不到这条概要，请直接编辑笔记里的 %%sum%% 行',

	// ===== 弹窗 - 自定义颜色 =====
	'modal.color.title': '自定义颜色',
	'modal.color.hint':
		'填十六进制（#89CFF0）或 RGB（137, 207, 240）；写入文件时统一为十六进制。这是「主色」：插件据此配出浅底色与同色连线。',
	'modal.color.placeholder': '#89CFF0 或 137, 207, 240',
	'modal.color.invalid': '无法识别：请填 #89CFF0 或 137, 207, 240',

	// ===== 搜索栏按钮提示 =====
	'search.prev': '上一个 (Shift+Enter)',
	'search.next': '下一个 (Enter)',
	'search.close': '关闭 (Escape)',

	// ===== 大图首帧渲染 =====
	'view.renderingLargeMap': '正在渲染 {count} 个节点…',
	// 「返回」把文件属性降级为 Markdown 是持久改动（下次不再自动进导图），
	// 而界面只表现为换了个视图 ⇒ 必须告知，否则用户以为只是切换显示
	'view.backToMarkdownDone': '已切回 Markdown；该文件属性已改为 Mindmap: Markdown',

	// ===== 导出 =====
	'export.exporting': '正在导出图片…（首次导出需准备数学字体，可能较慢）',
	// 导出走浏览器下载，文件落在系统下载目录而不是库内——不报路径用户找不到
	'export.done': '已导出 {name}（系统下载目录）',
	'export.pngFailed': '导出 PNG 失败：',
	'export.svgFailed': '导出 SVG 失败：',

	// ===== 保存 =====
	'save.failed': '保存思维导图失败：',
	'save.pluginDataFailed': '写入插件配置失败：',
	'save.externalReloaded':
		'本文件已被外部修改，已载入最新版本；你的未保存修改可按 Ctrl+Z 找回',
	'save.staleCommit':
		'另一视图刚有修改，本次编辑未合并；已载入最新内容',

	// ===== 视图（运行期动作失败） =====
	'view.layoutWriteFailed': '切换布局失败（文件属性未写入）：',

	// ===== 图片保存 =====
	'attachment.tooLarge': '图片过大（{size} MB），最大支持 {max} MB',
	'attachment.saveFailed': '保存图片失败：',
	'attachment.chooseImage': '请选择图片文件',

	// ===== 节点图片 =====
	'nodeImage.alt': '节点图片',

	// ===== 代码块嵌入（```mindmap 只读导图） =====
	/** 块体没有 `#` 一级标题时的中心主题名（有标题则用标题文本） */
	'mindmapEmbed.root': '思维导图',
	/** 只读角标（嵌入形态没有编辑入口，给一个可见提示） */
	'mindmapEmbed.readonly': '只读',
	'mindmapEmbed.empty': '代码块内没有可渲染的大纲内容',
	'mindmapEmbed.tooMany':
		'导图节点数 {count} 超过嵌入上限 {max}，此处仅显示大纲',
	'mindmapEmbed.renderFailed': '代码块导图渲染失败（详见控制台）',
	'mindmapEmbed.unknownLayout':
		'此处忽略布局指令「{value}」（不是六种布局之一），已改用默认布局',

	// ===== 默认内容（新建思维导图） =====
	'default.shortcutHint': '示例：把想法拆成子节点',
	'default.tabHint': 'Tab：添加子节点',
	'default.enterHint': 'Enter：添加同级节点',
	'default.fileNamePrefix': '思维导图',
} as const;

/** 英文字典（key → English） */
const EN: Record<TranslationKey, string> = {
	// ===== 文件右键菜单 =====
	'fileMenu.createMindMap': 'New mind map',

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
	'footnote.missingDefinition': 'Footnote definition [^{id}] not found',
	'footnote.revealFailed': 'Could not jump to the definition of footnote [^{id}]',
	'footnote.summaryLabel': 'Footnotes',
	'codeBlock.copy': 'Copy code',
	'mermaid.copy': 'Copy Mermaid source',
	'node.task.markDone': 'Mark as done',
	'node.task.markUndone': 'Mark as not done',
	'tag.searchUnavailable': 'Could not open tag search (search plugin not found)',
	'rename.titleConflict': 'A file with that name already exists; cannot rename by central node',
	'rename.titleFailed': 'Failed to rename the file by its central node: ',

	// ===== 工具栏 =====
	'toolbar.undo': 'Undo',
	'toolbar.redo': 'Redo',
	'toolbar.backToMarkdown': 'Back',
	'toolbar.arrange': 'Auto arrange',
	'toolbar.searchPlaceholder': 'Search nodes…',
	'toolbar.layout': 'Layout',
	'toolbar.lineStyle': 'Line style',
	'toolbar.palette': 'Palette',
	'toolbar.themeStyle': 'Border',
	'toolbar.zoomIn': 'Zoom in',
	'toolbar.zoomOut': 'Zoom out',
	'toolbar.resetZoom': 'Reset',
	'toolbar.exportImage': 'Export',
	'toolbar.tipFit': 'Fit',
	'toolbar.tipArrange': 'Tidy',

	// ===== Heading / bullet syntax =====
	'syntax.title': 'Syntax',
	'syntax.list': 'Bullet list',
	'syntax.heading1': 'Headings (level 1)',
	'syntax.heading2': 'Headings (level 2)',
	'syntax.done': 'Rewrote {count} node(s)',
	'syntax.none': 'Already in this syntax; nothing to change',
	'syntax.keptList': '"{text}" cannot be a heading, so this level stays a list',
	'syntax.pasteBlocked':
		'The pasted content contains nodes that cannot become headings (multi-line / task / ordered list); select a heading node first and paste as its children',
	'syntax.guardUpgraded': '"{text}" became a heading to match this level',
	'syntax.guardReleveled':
		'Adjusted the heading level of "{text}" to match this level',
	'syntax.guardDowngraded':
		'"{text}" became a bullet item to match this level (Ctrl+Z to undo)',
	'syntax.guardDemoted':
		'Nothing sits below level 6 as a heading, so "{text}" became a bullet item (Ctrl+Z to undo)',
	'syntax.guardDowngradedAnchors':
		'Converted {count} heading(s) to bullet items (including "{text}"); links such as [[#Heading]] to them will break — Ctrl+Z to undo',
	'syntax.guardBlockedUpgrade':
		'This level uses headings and "{text}" cannot be one, so the change was undone',
	'syntax.guardBlockedDowngrade':
		'A paragraph cannot host a heading ("{text}"), so the change was undone; use the "Syntax" submenu to convert it explicitly',

	// ===== 右键菜单 =====
	'menu.editText': 'Edit text',
	'menu.editTextModal': 'Edit in dialog',
	'menu.addChild': 'Add child node',
	'menu.addSibling': 'Add sibling node',
	'menu.moveUp': 'Move node up',
	'menu.moveDown': 'Move node down',
	'menu.copyNode': 'Copy node',
	/** Multi-selection copy: report the count (same convention as the summary item) */
	'menu.copyNodeCount': 'Copy {count} topics',
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
	// Node "Palette" first item: the UI says just "Default" (= no directive, follow
	// the map palette; same action as clearing the node colour)
	'menu.color.follow': 'Default',

	// ===== 通用提示/通知 =====
	'common.mindMap': 'Mind map',
	'common.notLoaded': 'Mind map not loaded yet',
	'common.arrangeDone': 'Mind map arranged',
	'common.arrangeFailed': 'Could not arrange the mind map',
	'common.fitClamped': 'Large map ({count} nodes): centered at the minimum readable zoom (not all nodes shown)',
	'common.noMatch': 'No matches',
	'common.nodeOne': 'node',
	'common.nodeMany': 'nodes',
	'common.saveSaving': 'Saving…',
	'common.saveSaved': 'Saved',
	'common.saveUnsaved': 'Unsaved',
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

	// ===== Modal - color scope cleanup (K175) =====
	'modal.colorScopeCleanup.title': 'Remove old "do not inherit" markers?',
	'modal.colorScopeCleanup.body':
		'Switched to "With children". Across {files} open map(s) there are {count} `%%none%%` marker(s) blocking inheritance; some may be nodes you explicitly set to "Default".\nCleaning removes them from the document, so those nodes inherit the ancestor colour again. The files will be rewritten (Ctrl+Z can undo).',
	'modal.colorScopeCleanup.confirm': 'Remove',
	'modal.colorScopeCleanup.keep': 'Keep',
	'colorScope.cleanupDone': 'Removed {count} `%%none%%` marker(s)',

	// ===== 设置 =====
	'settings.groupGeneral': 'General',
	'settings.groupAppearance': 'Appearance',
	'settings.groupFile': 'Files and saving',
	'settings.groupExport': 'Interaction and export',
	'settings.language': 'Language',
	'settings.languageDesc':
		'Language of the plugin UI and notices; applies immediately',
	'settings.defaultLayout': 'Default layout',
	'settings.defaultLayoutDesc':
		'Layout used for new mind maps\nExisting maps keep their own layout in the file properties; switch it from the right-click "Layout" menu',
	'settings.defaultLineStyle': 'Default line style',
	'settings.defaultLineStyleDesc':
		'Connector style for new mind maps\nElbow/curve can only be switched for Logical structure, Mind map and Organization chart',
	'settings.defaultThemeStyle': 'Default border style',
	'settings.defaultThemeStyleDesc':
		'Border style for new mind maps\nEach map can switch it with the "Border" button in the right-hand rail; existing maps keep their own setting',
	'settings.defaultTheme': 'Light/dark theme',
	'settings.defaultThemeDesc':
		'Light/dark palette for mind maps\nFollow Obsidian switches with the app theme; forcing light or dark keeps the map appearance fixed',
	'settings.nodeColorScope': 'Color scope',
	'settings.nodeColorScopeDesc':
		'How far a node colour from the right-click "Color" menu applies\nNode only: colours just the selected nodes; children do not inherit and connectors stay uncoloured\nWith children: colours the whole subtree, including connectors\nSwitching back to "With children" asks whether to clear old markers from open maps',
	'settings.saveLocation': 'Default location for new mind maps',
	'settings.saveLocationDesc':
		'Folder where new mind maps are saved\n"Follow Obsidian setting" uses Files and links → Default location for new notes',
	'settings.saveLocation.obsidian': 'Follow Obsidian setting',
	'settings.saveLocation.root': 'Vault root',
	'settings.saveLocation.current': 'Same folder as current file',
	'settings.saveLocation.folder': 'In the folder specified below',
	'settings.saveFolder': 'Target folder',
	'settings.saveFolderDesc':
		'Folder used by the "In the folder specified below" mode\nIf it does not exist, new mind maps go to the vault root',
	'settings.newMapSyntax': 'Syntax for new mind maps',
	'settings.newMapSyntaxDesc':
		'How the body of new mind maps is written\nList: hierarchy as bullet lists; Headings: hierarchy as Markdown headings (start at level 1 or 2; falls back to lists after level 6)\nOnly affects new and empty maps; existing maps keep their own syntax and can be converted from the right-click "Syntax" menu',
	'settings.saveFolderPlaceholder': 'Folder path',
	'settings.autoSplitMixedLinks': 'Auto-split mixed links',
	'settings.autoSplitMixedLinksDesc':
		'When an edited node mixes links with description text, split the links into child nodes\nOnly document and attachment links are handled (images and external URLs are untouched); this rewrites the file structure and is off by default\nUse the command "Split all mixed links in document" for the whole file',
	'settings.enableDrag': 'Enable node dragging',
	'settings.enableDragDesc':
		'Allow dragging nodes to change hierarchy and order\nWhen off, hierarchy can only be changed by editing text',
	'settings.exportScale': 'Export image scale',
	'settings.exportScaleDesc':
		'Resolution scale for PNG export: higher is sharper and larger\nSVG is vector-based and unaffected',
	'settings.exportImageFormat': 'Export format',
	'settings.exportImageFormatDesc':
		'Default format for image export (PNG raster / SVG vector)\nThe scale setting only affects PNG',
	'settings.exportFormat.png': 'PNG (raster)',
	'settings.exportFormat.svg': 'SVG (vector)',

	// ===== 布局选项 =====
	'layout.logical': 'Logical structure',
	'layout.mindMap': 'Mind map',
	'layout.organization': 'Organization chart',
	'layout.catalog': 'Catalog organization',
	'layout.timeline': 'Timeline',
	'layout.fishbone': 'Fishbone',

	// ===== 连线样式 =====
	'lineStyle.curve': 'Curve',
	'lineStyle.straight': 'Elbow',

	// ===== 主题选项 =====
	'theme.default': 'Follow Obsidian',
	'theme.forceLight': 'Force light',
	'theme.forceDark': 'Force dark',
	'themeStyle.default': 'Bordered',
	'themeStyle.borderless': 'Borderless',
	'settings.nodeColorScope.subtree': 'With children',
	'settings.nodeColorScope.node': 'Node only',
	'palette.default': 'Default',
	'palette.teal': 'Teal',
	'palette.blue': 'Azure',
	'palette.purple': 'Purple',
	'palette.crimson': 'Crimson',
	'palette.orange': 'Orange',
	'palette.gold': 'Gold',
	'palette.green': 'Green',
	'palette.grey': 'Grey',
	'palette.mist': 'Mist',
	// Node-level colours: non-default schemes only ("Default" already means follow the map)
	'palette.custom': 'Custom',
	'palette.branchColors': 'Colour by branch',
	'nodeColor.teal': 'Teal',
	'nodeColor.blue': 'Azure',
	'nodeColor.purple': 'Purple',
	'nodeColor.crimson': 'Crimson',
	'nodeColor.orange': 'Orange',
	'nodeColor.gold': 'Gold',
	'nodeColor.green': 'Green',
	'nodeColor.grey': 'Grey',
	'nodeColor.mist': 'Mist',
	// Relationships (node context menu entry + line context menu + label modal)
	'nodeRelation.add': 'Relationship',
	'nodeRelation.addHint': 'Click the target node, Esc to cancel',
	'nodeRelation.anchorStart': 'Move the pointer, click to place the start',
	'nodeRelation.anchorEnd': 'Click to place the end',
	'nodeRelation.exists': 'A relationship to this node already exists',
	'nodeRelation.color': 'Relationship color',
	'nodeRelation.editLabel': 'Edit relationship label',
	'nodeRelation.delete': 'Delete relationship',
	'nodeRelation.labelPlaceholder': 'Optional label',
	'nodeRelation.labelInvalid': 'Label cannot contain %% or [[ ]]',
	'nodeRelation.rootUnsupported': 'The central topic cannot be linked',
	// Summary (create from the node menu; edit text / delete from the summary node)
	'summary.add': 'Summary',
	'summary.addPick': 'Summary…',
	'summary.addCount': 'Summary ({count} topics)',
	'summary.pickHint': 'Summary: starting at "{node}" — click the last topic (Esc to cancel)',
	'summary.pickNotSibling': 'The end must be a sibling of the start (Esc to cancel)',
	'summary.pickInvalid': 'A summary cannot go here (Esc to cancel)',
	'summary.pickOverlap': 'Overlaps an existing summary — pick another end (Esc to cancel)',
	'summary.defaultText': 'Summary',
	/** Create-mode dialog title (used to share "Edit summary text" with edit mode) */
	'summary.newText': 'New summary',
	'summary.editText': 'Edit summary text',
	'summary.delete': 'Delete summary',
	'summary.textPlaceholder': 'Summary text',
	'summary.textInvalid': 'Text cannot contain %% or [[ ]]',
	'summary.textEmpty': 'Summary text cannot be empty',
	'summary.needSiblings': 'A summary can only cover adjacent sibling topics',
	'summary.rootUnsupported': 'The central topic cannot be summarized',
	'summary.overlap': 'This range already has a summary',
	'summary.unresolved':
		'This summary is no longer in the note text — edit its %%sum%% line directly',

	// ===== 弹窗 - 自定义颜色 =====
	'modal.color.title': 'Custom colour',
	'modal.color.hint':
		'Enter a hex colour (#89CFF0) or RGB (137, 207, 240); it is written as hex. This is the base colour: the light fill and matching connector are derived from it.',
	'modal.color.placeholder': '#89CFF0 or 137, 207, 240',
	'modal.color.invalid': 'Not a colour: use #89CFF0 or 137, 207, 240',

	// ===== 搜索栏按钮提示 =====
	'search.prev': 'Previous (Shift+Enter)',
	'search.next': 'Next (Enter)',
	'search.close': 'Close (Escape)',

	// ===== 大图首帧渲染 =====
	'view.renderingLargeMap': 'Rendering {count} nodes…',
	// "Back" downgrades the file property to Markdown (persistent) while the UI
	// only looks like a view switch — say so, or it reads as a display toggle
	'view.backToMarkdownDone':
		'Switched back to Markdown; the file property is now Mindmap: Markdown',

	// ===== 导出 =====
	'export.exporting':
		'Exporting image… (first export prepares math fonts and may take a while)',
	'export.pngFailed': 'Export PNG failed: ',
	// Export uses browser download → the file lands in the OS download folder,
	// not in the vault; without the path the user cannot find it
	'export.done': 'Exported {name} (system downloads folder)',
	'export.svgFailed': 'Export SVG failed: ',

	// ===== 保存 =====
	'save.failed': 'Failed to save mind map: ',
	'save.pluginDataFailed': 'Failed to write plugin config: ',
	'save.externalReloaded':
		'This file was modified externally. Loaded the latest version; press Ctrl+Z to restore your unsaved changes.',
	'save.staleCommit':
		'Another view just changed this map; this edit was not merged. The latest content has been loaded.',

	// ===== 视图（运行期动作失败） =====
	'view.layoutWriteFailed':
		'Could not switch layout (the file property was not written): ',

	// ===== 图片保存 =====
	'attachment.tooLarge':
		'Image is too large ({size} MB); the maximum is {max} MB',
	'attachment.saveFailed': 'Could not save the image: ',
	'attachment.chooseImage': 'Choose an image file',

	// ===== 节点图片 =====
	'nodeImage.alt': 'Node image',

	// ===== 代码块嵌入（```mindmap 只读导图） =====
	'mindmapEmbed.root': 'Mind map',
	'mindmapEmbed.readonly': 'Read-only',
	'mindmapEmbed.empty': 'There is no outline content to render in this block',
	'mindmapEmbed.tooMany':
		'The map has {count} nodes, above the embed limit of {max}; showing an outline instead',
	'mindmapEmbed.renderFailed': 'Failed to render the mind map in this code block (see console)',
	'mindmapEmbed.unknownLayout':
		'Layout directive "{value}" is ignored here (not one of the six layouts); the default layout is used instead',

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
