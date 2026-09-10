# Markdown ↔ 思维导图映射标准（MindMap Studio）

> 关联实现：`src/md-outline.ts`（解析）/ `src/md-serialize.ts`（回写）/ `src/features/view-wikilink.ts`（链接交互）/ `src/mindmap.ts`（图标与视口）；元数据契约 `src/domain/md-meta.ts`。
> 回归测试：`tests/md-roundtrip.test.ts`（往返回归：解析结构、层级深度、不动点、编辑合成、rawOk 分支矩阵、uid、视图状态）与 `tests/md-inline.test.ts`（行内 token 边界形态）。
> 本文档依据**当前工作区源码**重新核对后撰写（核对时点见文末「附：本轮核对状态」）。
>
> 本标准定义**双向**映射：① 一个标准的 Obsidian Markdown 文件如何**渲染**为思维导图；② 导图中的编辑如何**无损回写**为该 Markdown。**所有渲染/回写行为以此为准**；实现与本标准不一致处视为缺陷。

---

## 1. 定位与触发

- 插件是 Markdown 的**渲染层**：`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），无任何专有格式/标记。
- **触发**：文件名以 `.mindmap.md` 结尾（大小写不敏感）→ 通过命令面板「以思维导图打开」或文件右键同名项，把当前标签切换到导图视图（编辑模式与阅读模式入口均可用）；「切换回 Markdown」随时返回，并恢复进入前的编辑/阅读模式。标记后缀的判定/剥离/拼接唯一实现在 `src/constants.ts` 的 `hasMindMapMarker` / `stripMindMapStem` / `withMindMapMarker`。
- **打开方式记忆**：最后一次主动选择（「以思维导图打开」/「以 Markdown 打开（默认）」）记入插件状态；偏好为导图的文件在下一次以 markdown 视图打开时自动切入导图视图（双击/链接/恢复均生效）。恢复逻辑在 `src/open-as-restore.ts`（多档延时 + 代际防串扰；定时器经 `host: Component` 注册随组件注销清理）。
- 其余 `.md` 文件不受影响。**专有格式（`.mindmap` JSON）支持已删除**，不再存在独立通道。

---

## 2. 渲染方向：Markdown → 思维导图

**中心节点 = 虚拟文档根**（第 0 层，文本 = 去掉 `.mindmap` 后缀的文件名；仅当文件无任何标题时才作为内容树根）。虚拟根不产生 md 行（`src/md-outline.ts parseMdOutline` 构造 `{ data: { text: rootName } }`，回写时不输出）。

> **布局与视口持久化**：正文保持纯 Markdown，布局（`layout`）与视口（缩放/平移）不写入文件；插件将其存于 `data.json`（`viewState`，按文件路径 key，实现 `src/view-state.ts` 的 `ViewStateStore`），随文件改名/删除迁移或清理。
>
> **打开时的默认视口 = 100% 缩放 + 整体内容居中**（不是 fit 全图）：`src/mindmap.ts createMindMap` 显式传 `fit: false`；首帧后由 `src/services/engine-controller.ts restoreOrFitViewport()` 在 `VIEWPORT_RESTORE_DELAY_MS` 延时回调里执行——**有保存视口时** `mindMap.view.setTransformData(savedView)` 恢复；**无保存视口时**调 `centerContentAtFullScale(mindMap)`（`setScale(1, 画布中心)` → `measureContentBox()` 取渲染内容包围盒 → `translateXY` 把包围盒中心对齐画布中心）；只有该调用**抛异常**时才在 catch 中回退 `fitMindMap()`。README/AGENTS.md 所述语义与此一致，「适应画布」是工具栏/命令的手动动作（`src/commands.ts`、`src/features/view-toolbar.ts`、`src/features/view-context-menu.ts` 三处入口）。回归由 `npm run verify:visual` 的 viewport 探针覆盖（20 层深链大图必须 100% 缩放、整体内容居中，且重置缩放漂移 ≤1px）。
>
> **语义澄清**：`mindmap.ts` 中 `centerContentAtFullScale` 的源码注释仍写着「100% + 根节点居中」，这是**过时措辞**——实现与 `measureContentBox` 的实际行为都是按**渲染内容包围盒**居中（根节点居中会让偏心的树整体偏向一侧）。本文档以代码行为为准。

### 2.1 结构映射（大纲 → 树）

| Markdown 构造 | 映射 |
|---|---|
| `#` ~ `######` 标题 | 第 1 ~ 6 级子节点，与 `#` 数量严格对应（节点 `mdType: 'heading'`、`mdLevel` = 原始 `#` 数） |
| 标题下的无序/有序列表（缩进嵌套） | 该标题的子节点树（节点 `mdType: 'list'`、`mdMarker` = 原始标记）；无缩进列表项 = 标题的下一级（层级延续） |
| 6 级标题下的列表缩进（Tab/空格） | **第 7 级及以上**（列表缩进降级法：`###### A` 下缩进 1 层的 `- x` = 第 7 级，2 层 = 第 8 级…） |
| 无标题的纯列表文档 | 列表项从第 1 级子节点起 |
| YAML frontmatter | 不参与导图；原样保留在文件头（编辑只重写正文）。`splitFrontmatter` 已 export 为测试白盒钩子；正文开头再现 `---` 时只取第一个并 `console.warn` |
| 段落 / 引用 `>` / 表格 | 合并为「多行文本节点」（`mdType: 'plain'`，多行以 `\n` 连接）：内容保留、段落间空行归一（见 §3.4 降级） |
| 代码围栏（三个反引号 / 三个波浪号起止） | 围栏整体 **opaque** 并入 plain 文本节点：起止标记与内容（内部空行、缩进、类标题/列表行）逐行原样保留；围栏相邻的空行分隔保留，往返可再次识别 |
| 空行、`---` 分隔线 | 忽略（结构分隔信号） |

**层级规则**（`parseMdOutline` 的 `headingStack` / `contentParent` / `listStack` / `plainBuffer` 四件状态）：

1. 标题按 `#` 数量形成标题栈（栈底为 level 0 的虚拟根）；相邻标题级别相同/更浅时回到对应祖先（常规大纲语义）。
2. **跳级**（`#` 后直接 `####`）：按祖先链深度建层（不插入空层）；原始 `#` 数量记录在节点 `mdLevel`，回写不丢（`md-serialize.ts` 输出时把 `mdLevel` 钳在 1..6）。
3. **多根**（文档含多个同级 `#`）：均挂虚拟根下（拍平为单树）；无空分支。
4. 标题之间无列表时即纯标题树；段落/列表混排时按出现顺序（进入新标题时清空列表栈与段落缓冲）。
5. 列表项的**续行**（缩进大于列表栈顶的普通行）并入该列表项文本：`text` / `mdDerivedText` / `mdRaw` 三字段同步追加换行内容。
6. 解析与序列化均以迭代 / 显式栈实现（`src/domain/tree.ts` 的 `walkTree` 亦为显式栈先序遍历），深层缩进（数万级）不会栈溢出。

### 2.2 行内映射

统一入口是 `src/md-outline.ts tokenizeInline`（正则 `INLINE_RE`）+ `buildInlineData(raw)`；token 类型为 `wiki` / `wikiImg` / `mdLink` / `mdImg` / `autolink` / `bareUrl`，剥壳显示文本由 `tokenDisplay(tok)` 产出。

| Markdown 行内 | 节点行为 |
|---|---|
| `[[目标]]` / `[[目标\|别名]]` | 文本 = 别名‖目标名（`tokenDisplay` 剥壳，**无 `[[]]` 字面**）；首个文档双链写入 `mdWikiLinkpath`（`formatWikilink`，**不写引擎 hyperlink**——否则会与自绘文档页图标双显）；可点、可悬停预览。**节点内只显示别名**（无别名时为目标显示名）；纯双链节点（整行只有一个双链）编辑节点 = 改别名，见 §3.2 |
| 同上且目标为**附件**（`wikilinkTargetIsAttachment`：末段含扩展名且非文档类 `.md` / `.canvas` / `.base`——Canvas / Bases 属**文档**，走文档通道） | 走引擎 `attachmentUrl` 通道 + `mdAttachmentLinkpath` / `mdLinkStyle: 'wiki'`：节点显示**回形针图标**（与文档链接图标区分）；文本 = 别名‖目标文件名；点击按 Obsidian 语义打开（可渲染开标签页 / 系统媒体走系统应用） |
| `[文本](url)` | 文本 = 链接文本；首个链接 → `hyperlink` + `mdLinkStyle: 'md'`。**label 本身是 URL**（`[https://…](https://…)`，复制粘贴常见，判定 `isUrlLikeText(tok.label)`）时与裸 URL 同语义：URL 本体不进节点文本（icon-only） |
| `![[文件]]` / `![alt](url)` | 首个图片 → 节点图片（`image` / `mdImageTarget`），按比例统一尺寸；alt 存 `mdImageAlt`；嵌入标签里的尺寸参数存 `mdImageWidth` / `mdImageHeight`（`parseImageLabel`）。**纯图行的节点文本为空**（不回退文件名占位，见 §3.4） |
| `![[笔记]]` / `![[笔记.md]]` / `![[笔记#标题\|别名]]` / `![[看板.base#View]]` 等**文档嵌入**（目标末段为文档类扩展名 `.md` / `.canvas` / `.base`，或无扩展名） | 与文档双链**同通道**：`mdWikiLinkpath`（完整 wikilink）+ `mdLinkStyle: 'wiki'` + `mdEmbed: true` → 显示**自绘文档页图标**；节点文本 = 别名‖去 `.md` 的目标名（与 `[[笔记]]` 同口径）；可悬停预览、点图标打开。**管道位是别名**（`![[笔记\|300]]` 的 `300` 是别名，**不是**图片尺寸）。回写时按 `mdEmbed` 补回 `!` 保往返 |
| `![[报告.pdf]]` / `![[录音.mp3]]` 等**非图片、非文档嵌入**（末段含文档类之外的扩展名） | 不作为节点图（会空白）：转走附件通道（回形针 + 点击打开），记 `mdEmbed: true` 以便回写补回 `!`；该形态管道位官方**无明文**（PDF 官方用 `#height=` / `#page=`，音频无尺寸语法），故不解释、原文存 `mdEmbedPipe`，编辑节点后原样回写——不再丢用户写下的参数 |
| **`<url>` 自动链接**（含 `://` scheme） | `hyperlink` = url；**节点文本为空——只显示超链接图标**；悬停 title = 完整地址；回写为 `<url>` |
| **裸 URL**（行内直接书写 `https://…` / `ftp://` / `obsidian://`） | 与 `<url>` 同语义：目标尾部句读标点不属 URL（`BARE_URL_TRAILING_RE`）；**URL 本体不渲染进节点文本**；前后文本保留（结果连续空格折叠为单空格）；未编辑逐字回写原文，编辑后合成为 `<url>` |
| 行内多个链接 / 图片 | 首个链接 → 节点链接、首个图片 → 节点图；**其余剥壳为显示文本**，原文由 `mdRaw` 保真 |
| `**粗体**` `*斜体*` `` `代码` `` `~~删除~~` 等轻标记 | **不剥离、原样保留**在文本（无损；不注册富文本渲染，见 §3.5 边界） |

> **链接图标三类区分**（实现见 `src/mindmap.ts`）：外部 URL = 引擎原生链接图标（`hyperlink` 通道）；双链指向文档 = **自绘文档页图标**（`opt.createNodePrefixContent` 前缀内容 `buildWikiDocIcon`，尺寸 `WIKI_DOC_ICON_SIZE`，参与节点测宽；悬停 title = 目标名，点击 = Obsidian 打开）——`[[笔记]]` 文档双链与 `![[笔记]]` 文档嵌入**共用此图标**（二者仅回写时差一个 `!`）；双链指向附件 = 回形针图标（引擎 `attachmentUrl` 原生，`node_attachmentClick` 由视图接管）。URL 本体一律不进入节点文本（icon-only），避免长 URL 撑宽节点与双重表达。
>
> `createNodePrefixContent` 未收录于 `vendor/simple-mind-map.d.cts`，经 `Object.assign` 注入以避开类型断言（契约说明见 `src/mindmap.ts` 常量区注释）；历史上曾用 `addCustomContentToNode` 钩子，因其把元素放进 `foreignObject`、裸 `<g>` 实测 0×0 不可见且不参与测宽而被替换。
>
> **引用格式恒为 wikilink（有意偏离）**：新增链接/图片一律写 `[[笔记]]` / `[[附件.pdf]]` / `![[图.png]]`（`src/features/view-dnd.ts`、`src/modal-link.ts`、`src/md-serialize.ts`），**不**遵循 Obsidian 的「使用 Wiki 链接」/「新链接格式」设置——三类图标方案依赖文档双链走 `mdWikiLinkpath` 通道；若改为遵循偏好生成 `[文本](路径.md)`，文档链接会落到引擎 hyperlink 通道并显示原生链接图标，与既定视觉冲突。既有文件里已存在的 `[文本](路径.md)` 形态仍按 md 链接解析与回写（决策依据：审计文档 `docs/external-audit-2026-09-08.md` §5.2 / §7.4；该文档已从工作树移除，需要时用 `git log --diff-filter=D -- docs/external-audit-2026-09-08.md` 从历史取回）。

### 2.3 交互标准

| 操作 | 行为 |
|---|---|
| 悬停含 `[[..]]` 链接的节点 | Obsidian 原生页面预览（`hover-link`；需页面预览插件开启）。`hoverParent` 必须是官方 `HoverParent`（传视图 `leaf`），且触发前须调 `ensureOffsetSize(targetEl)` 补齐 SVG 节点的 `offsetWidth/offsetHeight`——否则官方弹窗锚定矩形 `bottom/right` 为 `NaN`，预览只会出现在上方 |
| **点击节点内链接文本**（渲染出的剥壳文本） | 当前标签页打开目标（与 Obsidian 阅读视图点击链接一致；仅命中链接文本生效，节点其余区域维持选中语义） |
| `Ctrl/Cmd + 点击` 节点 | 新标签页打开目标（优先取被点击链接的目标，其次节点链接） |
| 点击节点链接图标（引擎 hyperlink 图标） | 在当前标签打开目标（悬停图标显示目标名 title） |
| **URL `icon-only` 节点**（`<url>` 与裸 URL 行） | 节点仅显示链接图标，不渲染 URL 文本；点击 / 悬停显示并打开地址 |
| 点击附件回形针图标（双链指向附件） | 按 Obsidian 语义打开附件：可渲染类型开标签页，系统媒体（音视频）走系统应用，不可预览类型提示 |
| 普通单击节点 | 选中 / 编辑（与导图编辑语义一致，不劫持） |
| **双击节点 / 右键「编辑文本」/ `F2`** | **引擎原生就地编辑**（无编辑浮层/弹窗）：节点文本为**纯文本**，就地编辑该文本；保存后按 §3.2 合成回写（原 `mdRaw` 不再逐字保留——编辑即视为改动）。**纯双链节点内显示的就是别名，编辑即改别名**并回写 `[[目标\|新别名]]`（§3.2）。右键入口经 `src/mindmap.ts startNodeTextEdit`（**延后一个宏任务**再 emit `node_dblclick`，否则菜单 click 冒泡到 `document.body` 触发引擎 `body_click` 会立刻关闭刚打开的编辑框）；`F2` 由 `src/features/view-hotkeys.ts handleEditNodeHotkey` 在视图 scope 内接管（吞键 + 输入框内让位） |
| `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` | 引擎撤销/重做（视图 scope 接管；`Mod+Y` 在 macOS 不注册）。引擎自身未绑定这些键 |

> **不存在 richText（Markdown）节点形态**：全仓库 `src/**` 无 `richText`/`RichText` 注册或引用，节点文本一律是纯文本就地编辑。早期版本文档所述「richText 节点就地编辑渲染文本」已不成立。

---

## 3. 回写方向：导图编辑 → Markdown

### 3.1 行级「未编辑检测」（verbatim）

节点同时满足以下条件 → 保存时**整行逐字回写原文**（`mdRaw`），保留 `[[]]` / `[]()` / `<url>` 包裹、全部 token 与格式（判定函数在 `src/md-serialize.ts`，谓词收窄为 `data is MdNodeData & { mdRaw: string }`）：

- 有 `mdRaw`，且 `data.text === data.mdDerivedText`（用户未改文本）；
- 图片未更换：图片特征串（仓库路径或外链原文）仍出现在 `mdRaw` 中；
- 链接未新增/更新：`hyperlink` 的目标特征串出现在 `mdRaw` 中（文档双链则取 `mdWikiLinkpath` 去别名后的特征串，同口径）；若链接字段为空而 `mdRaw` 仍含链接语法 → 视为「清除链接」，需合成剥离。

> **段落（plain）内的链接属原文**：plain 多行文本节点不承载引擎链接/图片字段，因此未编辑段落中的 `[[]]`/`[]()`/`![]()`/`<url>` 一律随 `mdRaw` **逐字回写**（不会因「无 hyperlink」被判为清除链接而剥壳）；用户真正编辑该段文字后才走合成。
>
> **图片嵌入语法在「链接已清除」检测中以负向断言排除**（`(?<!!)\[\[`）：`![[..]]` 是图片而非链接，图文混合行可逐字往返。

### 3.2 合成回写（节点被编辑 / 新增 / 换图）

| 节点 | 回写规则 |
|---|---|
| heading | `#{mdLevel} 文本` + 行尾单链接 token（`mdLevel` 钳 1..6） |
| plain | `text` 多行；未编辑检测通过 → 原文 |
| list / 新节点 | `缩进 + 标记 + 文本`；有序列表按最终顺序重排 1..n；列表标记（`-`/`*`/`+`）保留；续行补 2 空格缩进；树的新增节点（无 md 元数据）按无序 `-` 输出 |
| **链接 token** | wiki → `[[..]]` 原样；**URL → `<url>`**（标准 autolink）；非 URL md 链接 → `[label](url)`，**目标含空格/括号/`<>`/`\` 时用尖括号包裹** `[label](<dest>)` 以免破坏 `(…)` 闭合；其余裸目标 → `[[..]]` |
| **纯双链节点**（整行只有一个双链：`mdLinkText`（文档）/ `attachmentName`（附件）== `mdDerivedText`，且文本已编辑、单行） | **编辑节点 = 改别名**：新文本写成 `[[目标\|新别名]]`（目标与 `#区块` 原样保留，改写走 `domain/wikilink.ts withWikilinkAlias`），不产出「新文本 + 行尾链接」；新文本 == 无别名时的默认显示名（或清空）→ 不写 `\|别名` 段（避免 `[[目标\|目标]]`）。判定 `md-serialize.ts editedWikilinkAlias`，回写与可见名同经 `effectiveDocWikiLink`。**文档嵌入 `![[笔记]]` 同样适用**（管道位是别名），回写时按 `mdEmbed` 补 `!` → `![[笔记\|新别名]]`。**不适用**：混合文本节点（`说明 [[链接]]`，会吞掉说明文字）、多行文本、**附件**嵌入 `![[报告.pdf]]`（管道位是尺寸参数）、URL / md 链接（无别名概念）、新文本含 `[`/`]`（手输 `[[新目标]]` 回落旧合成＝更接近「换链」） |
| **纯 URL / icon-only 节点**（文本为空 + URL 链接） | 只写 `<url>`（不写 `[label](<url>)`）；若节点文本残留旧 URL 显示名则清空（保持仅图标） |
| **图片 token** | 仓库路径 → `![[path]]`；外部 http/data/blob → `![alt](url)`；尺寸按 `目标\|宽度` 特征匹配判断是否需回写（终界 `]`/`x` 防前缀误匹配），未编辑则原文保真 |
| **frontmatter** | 正文重写前原样回贴文件头；仅正文（body）被重写 |
| **布局 / 视口 / 打开方式** | **不写入文件**：存 `data.json`（`viewState`，按文件路径 key） |

### 3.3 持久化边界

- 正文保持纯 Markdown；布局、视口、打开偏好一律不进正文（`src/view-state.ts` + `src/persistence.ts` 的 `PluginDataWriter`：串行队列 + 写前重读合并）。
- 中心节点 ⇄ 文件名：编辑中心节点文本会重命名 `.mindmap.md`——**必须走 `FileManager.renameFile`**（`src/features/view-title-renamer.ts`；`Vault.rename` 只改文件系统、不更新库内反链），Obsidian 原生更新链接/反链；外部改名后视图重载中心随新名。
- 保存管线在 `src/services/document-service.ts`（防抖 / 串行排空 / 卸载快照兜底 / `onSaveError` 上报）。

### 3.4 已知降级（不静默丢失，但格式/粒度归一）

| 场景 | 行为 |
|---|---|
| 段落 / 引用 / 表格 | 并入多行文本节点，内容保留；**段落间空行**在往返中归一 |
| 图片独占节点 | 纯图行（如 `- ![[x.png]]`）解析为**无文本节点**（不回退文件名占位）：图片节点删除文字（右键「移除文字」/双击清空）后即被图片独占，往返保持。代价：纯图节点不参与文本搜索 |
| 编辑**含链接的句子**（非纯双链节点） | 非首个链接 token 归一为行尾单链；纯双链节点改走「编辑 = 改别名」（§3.2），不再产生「文本 + 链接」 |
| 纯双链节点的图标 tooltip | 保存后（未重载）文档页图标 tooltip 仍显示旧别名（`mdLinkText` 未随编辑刷新），重载/下次解析后同步；链接目标与点击行为不受影响 |
| 编辑过文本的节点中的轻标记 | 标记文字随文本保存（用户可见），不再自动补 `**` 等 |
| 导图内对节点做**备注 / 样式 / 附件**（md 模式） | 已阻止并提示（无 md 回写语法） |
| 图片尺寸 | `![[图.png\|300]]`（仅宽、等比）/ `![[图.png\|300x150]]`（宽高）解析进 `mdImageWidth/mdImageHeight`；加载时 `walkCorrectImageSizesByAspect` 对带参节点按参数定尺寸（仅宽时探测原始比例补高），探测失败降级 |

### 3.5 边界与后续

- 引擎节点文本为 SVG 文本（非 HTML）：无法实现「文中内联蓝色链接」字面效果；整链节点以「剥壳文本 + 链接图标」呈现（URL 链接为「仅图标」）。方案 B（`customCreateNodeContent` 自绘节点）可做到内联，见 §5 可选项。
- `frontmatter` 触发（`type: mindmap`）为后续设置项。
- 未复核：`md-serialize.ts` 中参考式链接 `[ref]` / `[ref]: url` 的往返行为未逐例实测（见 §5.2 登记项）。

---

## 4. 示例

输入 `项目计划.mindmap.md`：

```markdown
---
tags: [规划]
---
# 项目计划
## 目标
- 里程碑一
- 里程碑二
###### 细则
- 第 7 级列表项
  - 第 8 级列表项
## 分工
参见 [[设计稿|设计]] 与 [仓库](https://github.com/example) 说明
```

导图（中心 = `项目计划`）：

```
项目计划（中心节点）
├── 目标 ────── 里程碑一 / 里程碑二
├── 细则 ────── 第 7 级列表项 ── 第 8 级列表项   （######=6 级 + 列表缩进 → 7/8 级）
└── 分工 ────── "参见 设计 与 仓库 说明"（悬停预览 / Ctrl+点击跳转）
```

未编辑任何节点直接保存 → 文件逐字不变（frontmatter、`######`、`[[设计稿|设计]]`、`[仓库](…)` 全部原样）。其中 `[[设计稿|设计]]` 走 `mdWikiLinkpath` 通道（显示自绘文档页图标），`[仓库](https://…)` 走 `hyperlink` 通道（显示引擎链接图标）。

---

## 5. 可选改进项（登记不实施）

> 以下为潜在增强，仅登记，**本版本不实现**；实施前需单独评审。

1. **方案 B 渲染**：以 `customCreateNodeContent` 自绘节点，实现节点文本内的**内联链接 / 富文本**（取代当前「URL 仅图标」的折中）。
2. **回写增强（分轮）**：已实现「链接目标转义/归一（含空格/括号目标用 `<...>` 包裹）」与「URL 显示名同步（仅图标，清空残留 URL 文本）」；**剩余**：参考式链接 `[ref]` / `[ref]: url` 的保留与归一；多链接句子按 `mdSegments` 分段保留（并入方案 B）。
3. **结构化映射扩展**：表格 → 子节点表；任务 `- [ ]` / 标签 / 备注 → 节点属性；引擎 tag / note / attachment 与 md 的双向映射。
4. **触发项**：`type: mindmap` frontmatter；带 `mindmap` 语言标记的代码块的独立布局/主题设置。
5. **可持续性**：图片尺寸缓存与 `lookupIndexedFile` 索引按 vault 代际失效；大图/深树的加载与搜索防抖、取消。
6. **多选 / 子树**：复制粘贴为嵌套 Markdown；折叠展开状态持久化。
7. **多链接节点可点化（审计结论：暂不实施）**：官方阅读视图里一行内每枚 `[[…]]` 都可点，本插件受引擎「单链接槽位」限制只渲染首个（见 §2.2 / §3.4）。实施需在自绘节点内容里为每枚链接生成可点元素与 hover 源，并新增「多链接」字段与回写规则；未实施前，未编辑原文逐字保真、编辑后降级为单链接。
8. **改用官方解析器（审计结论：不采用）**：官方 `parseLinktext` / `getLinkpath` 只返回 `path` / `subpath`（**不含别名**），本插件还需要 `alias` 与 `inner`（`openLinkText` 需整段透传），故保留 `domain/wikilink.parseWikilink` 作为唯一权威；换用不减代码，且会破坏 domain 零依赖边界（eslint 强制）。
9. **笔记嵌入管道位的语义风险（审计结论：保持现状并登记）**：`![[笔记|X]]` 的管道位官方**无明文**，本插件按 API `Reference.displayText` 口径当**别名**处理（节点文本 = 别名，编辑节点 = 改别名）。风险：若官方日后把嵌入管道定义为尺寸或忽略，本插件的回写口径会与核心分叉——届时按「管道位原文保留」整改（同 `mdEmbedPipe` 的做法）。空 `[[]]` 不作特殊处理（与核心一致：它不是链接）。

---

## 附：本轮核对状态（文档时点）

| 项 | 状态 |
|---|---|
| 核对依据 | 当前工作区源码（`src/md-outline.ts` 686 行、`src/md-serialize.ts` 619 行、`src/features/view-wikilink.ts` 208 行、`src/services/engine-controller.ts` 438 行、`src/mindmap.ts` 820 行）+ `manifest.json` 版本 **0.0.5** |
| 相对上一版本文档的**事实修正** | ① 文件头回归测试指向 `tests/md-roundtrip.test.ts` / `tests/md-inline.test.ts`（旧版指向已不存在的 `scratch/md-roundtrip/` 与 75 断言）；② §2 默认视口改为「100% + 内容包围盒居中」（旧版「回退设置默认布局并 fit 全图」错误，fit 仅异常兜底）；③ §2.3 删除 richText 节点形态（全仓库零注册）；④ 实现路径 `src/view-wikilink.ts` → `src/features/view-wikilink.ts` |
| 函数名核对 | `buildInlineData` / `tokenDisplay` / `tokenizeInline` / `parseMdOutline` / `splitFrontmatter` / `createNodePrefixContent` / `buildWikiDocIcon` / `measureContentBox` / `centerContentAtFullScale` / `fitMindMap` / `restoreOrFitViewport` **均存在**；旧版文档提到的 `stripUrlTokensForDisplay` / `stripMarkdownInline` **在当前源码中不存在**（URL icon-only 的剥离实际在 `buildInlineData` 内完成），已从本文档移除 |
| 未复核项 | 参考式链接往返（§3.5 已标注） |
| 回归文件口径 | `tests/md-roundtrip.test.ts` / `tests/md-inline.test.ts` 为 2026-09 批次重写产物；本文档**不引用任何断言/用例计数**（计数随重写变动，引用即会过时） |
