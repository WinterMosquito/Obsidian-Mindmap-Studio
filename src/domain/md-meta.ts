/**
 * Markdown 渲染层附加在节点 data 上的元数据（md* 前缀）。
 *
 * 此前这些 key 散落在 `Record<string, unknown>` / AnyObject（any）上，
 * 读侧到处 typeof 收窄、写侧无约束；统一由本接口声明类型：
 * - 写入方：md-outline（解析时）、images-path（加载期尺寸校正）、
 *   view-image-actions（插入/更换/移除图片）、image-resize（拖拽调宽）；
 * - 读取方：md-serialize（回写判定与合成）、视图模块。
 *
 * 元数据仅为本插件序列化层服务，引擎不识别（渲染无语义），
 * 不写入 .mindmap.md 文件正文。
 */

import type { TaskState } from './md-task';

/**
 * 「节点文本自解析后是否被编辑过」——回写侧与渲染侧的**唯一判据**。
 *
 * 解析期 `text === mdDerivedText`（两者同取 derived）；用户编辑只改 `text`，
 * `mdDerivedText` 保留解析期快照（见 md-outline 的字段说明）。
 *
 * **快照缺失**（从未从 Markdown 解析过的新建节点）一律按「未编辑」：没有基准
 * 就无法判定，保守按未编辑——回写走逐字回写（保住原文）、渲染取 mdRaw、自动
 * 拆分不动手。`mdRaw` 与快照**恒同源写入**（md-outline / links-split /
 * links-rename / md-line-write 四处都是成对写），故「有 mdRaw 而无快照」的
 * 状态解析侧产生不出来，两侧口径在真实数据上等价。
 *
 * 为什么收口（2026-10-15）：同一比较此前在 md-serialize（rawOk）、links-rename、
 * view-split-links、wiki-display、node-inline-content 各写一遍，其中三处还各自
 * 处理「快照缺失」的边界——口径迟早分叉。
 *
 * @param text 节点当前文本（data.text）
 * @param mdDerivedText 解析期快照（data.mdDerivedText）
 */
export function isNodeTextEdited(text: unknown, mdDerivedText: unknown): boolean {
	return typeof mdDerivedText === 'string' && text !== mdDerivedText;
}

/**
 * 节点的**行内原文来源**：未编辑 → `mdRaw`（逐字原文，含 `%%注释%%` / 链接语法）；
 * 已编辑 → `data.text` + 关系指令行（`mdRaw` 是解析期快照，编辑后过期）。
 *
 * 唯一实现（2026-10-27 收口）：自绘接管判定（`node-inline-content.resolveSelfDrawSource`）、
 * 节点配色指令（`engine/mindmap-colors`）与关系指令（`domain/relation`）必须读同一份
 * 原文，否则「节点显示里有注释、样式/关系却按旧行解析」这类漂移无从发现。`mdRaw`
 * 缺失时同样回落 `text`（新建节点没有原文快照）。
 *
 * **已编辑时补回 `mdDirectiveTail`**（2026-10-30）：关系指令被剥出 `text` 存在该字段
 * 里，不补回来的话「引擎内联编辑一次文本 → 关系全部消失」。
 */
export function nodeInlineSource(data: Record<string, unknown>): string {
	const text = typeof data.text === 'string' ? data.text : '';
	if (!isNodeTextEdited(data.text, data.mdDerivedText)) {
		const raw = data.mdRaw;
		if (typeof raw === 'string' && raw) {
			return raw;
		}
	}
	const tail =
		typeof data.mdDirectiveTail === 'string' ? data.mdDirectiveTail.trim() : '';
	return tail ? `${text}\n${tail}` : text;
}

/** 行类型（data.mdType）：md 三种行形态 */
type MdLineType = 'heading' | 'list' | 'plain';

/** 链接样式（data.mdLinkStyle）：wiki 双链 / md 标准链接（含 autolink） */
type MdLinkStyle = 'wiki' | 'md';

/**
 * 图片嵌入的语法形态（data.mdImageStyle）：wiki `![[图.png]]` / md `![alt](图.png)`。
 *
 * 来源两处、语义不同：
 * - **解析期**：按原文形态记录（保往返——未编辑时 mdRaw 逐字回写，编辑后合成回写
 *   也须保持用户原本的写法，不能把 `![a](b.png)` 翻成 `![[b.png]]`）；
 * - **新建/换图**：跟随官方设置「Use \[\[Wikilinks\]\]」（见 platform/vault-prefs），
 *   关闭时写 md 形态——官方该设置同时管 links 与 images。
 */
type MdImageStyle = 'wiki' | 'md';

/**
 * 行内 token 段（`mdSegments` 的元素，见 MdNodeMeta.mdSegments）。
 * 有显示名者：`text` 与解析侧 `pieces` 中的那一段**逐字相同**（对齐基准）；
 * 无显示名者：`text` 为空串，并带**上下文锚点**（`before` / `after` / `sepBefore` /
 * `sepAfter`）——见下方「无显示名段的锚点」小节。
 * `raw` 恒为该 token 的原文切片。
 */
export interface MdTokenSegment {
	/** 'image' = 走 image 字段的图片嵌入；'link' = 链接类（双链/md 链接/文档或附件嵌入） */
	kind: 'link' | 'image';
	/** token 在显示文本中的样子（剥壳显示名，与 data.text 的那一段逐字相同） */
	text: string;
	/** 原文切片（`[[A]]` / `![[图|300]]` / `[文本](url)`） */
	raw: string;
	/**
	 * 该 token 是否由「首链 / 首图」字段承载：
	 * true → 合成时取**实时渲染形态**（别名、尺寸可能已被编辑）；
	 * false → 额外 token（多链接 / 多 URL / 多图里字段装不下的那部分），按其原文
	 * `raw` 原样输出；`text` 为剥壳显示名或空串（无显示名者，见字段契约）。
	 */
	first: boolean;
	/**
	 * 锚点前文（**左邻**非空白文字 run，已 trim；过长取尾部，合成侧据此反查）。
	 *
	 * 仅无显示名段登记，见「无显示名段的锚点」。
	 */
	before?: string;
	/**
	 * 锚点后文（**右邻**非空白文字 run，已 trim；过长取头部）。
	 * 仅无显示名段登记，`before` 为空时合成侧改用它反查（行首即 token 的形态）。
	 */
	after?: string;
	/** 原文 token **左侧**是否有空白分隔（决定回写时补不补一个空格） */
	sepBefore?: boolean;
	/** 原文 token **右侧**是否有空白分隔（`sepBefore` 为假时的次选） */
	sepAfter?: boolean;
}

/**
 * 无显示名段的锚点（`MdTokenSegment.before` / `after` / `sepBefore` / `sepAfter`）
 *
 * 背景：首图与 icon-only 的 URL **不向显示文本贡献任何字符**（前者以节点图呈现，
 * 后者只留图标），因此合成回写时既无「显示名」可原位替换、段序也对不上 `data.text`，
 * 只能走尾插——于是图片被搬到**行尾**（`前 ![[图|200]] 后` → `前 后 ![[图|260]]`，
 * 顺序被改写），且尾插的 `line + ' ' + tail` 还会凭空多出一个空格。
 *
 * 锚点用原文里 token **紧邻的文字**记位置：合成侧在编辑后的新文本里反查该文字，
 * 把 token 插回它原先所在的那一侧，顺序与分隔空白随之复原。锚点文字被用户改掉时
 * 反查失败，回落尾插（内容不丢，位置退化——与既有兜底同档）。
 */

export interface MdNodeMeta {
	/** 原始 md 行（可能多行）：未编辑逐字回写的依据 */
	mdRaw?: string;
	/** 解析后的剥壳文本：data.text === mdDerivedText 即「未被用户编辑」 */
	mdDerivedText?: string;
	/** 行类型：heading / list / plain；新建用户节点无此字段 */
	mdType?: MdLineType;
	/** 标题级别 1-6（跳级保留原始 # 数） */
	mdLevel?: number;
	/** 列表标记：'-' / '*' / '+'，有序列表为 'ordered' */
	mdMarker?: string;
	/** 链接样式：wiki 双链 / md 标准链接 */
	mdLinkStyle?: MdLinkStyle;
	/** md 链接的标签文本（autolink 时为目标 URL） */
	mdLinkText?: string;
	/**
	 * 附件双链的原始 linkpath（`[[报告.pdf]]` 的 `报告.pdf`）。
	 * 双链指向附件时节点走引擎 attachmentUrl 字段（回形针图标，不写
	 * hyperlink 以免链接图标双显）；本字段保留原始引用供回写合成重建
	 * wikilink（attachmentUrl 可能被视图层重写为解析后的库内路径）。
	 */
	mdAttachmentLinkpath?: string;
	/**
	 * 文档双链的完整 wikilink（`[[笔记]]` / `[[路径/笔记|别名]]`）。
	 * 文档双链**不写**引擎 hyperlink 字段——引擎会为任何 hyperlink 渲染原生
	 * 链接图标，与自绘文档页图标双显；本字段承载链接本体，供回写合成、
	 * 悬停预览、引用更新（重命名/删除）与图标点击使用。
	 * 语义对齐附件通道 mdAttachmentLinkpath（同为「非引擎字段的链接载体」）。
	 *
	 * **文档嵌入**（`![[笔记]]` / `![[笔记.md]]`）也走本通道——与文档双链同图标
	 * 同交互，差异只在本字段回写时由 `mdEmbed` 补回 `!`。
	 */
	mdWikiLinkpath?: string;
	/**
	 * 该引用在原文中用的是**嵌入**语法 `![[X]]`（而非链接 `[[X]]`）；回写时据此
	 * 补回 `!`，保证 `![[…]]` 往返不丢。两种落点都会置位：
	 * - **文档嵌入**（目标为 `.md`/`.canvas`/`.base`/无扩展名）→ 走 `mdWikiLinkpath`
	 *   通道（文档页图标），管道位是**别名**；
	 * - **附件嵌入**（PDF/音视频等非图片）→ 走 `attachmentUrl` 通道（回形针），
	 *   管道位语义官方未定义，原文存 `mdEmbedPipe`。
	 * 图片嵌入（`![[图.png]]`）不置位——它是节点图，天然带 `!` 由 renderImage 输出。
	 */
	mdEmbed?: boolean;
	/**
	 * **非图片附件**嵌入语法的管道位原文（`![[报告.pdf|300]]` 的 `300`）。
	 *
	 * 官方未定义该位语义：PDF 用 `#page=` / `#height=`、音频无尺寸语法，只有图片的
	 * `|宽` / `|宽x高` 有明文（那种走 `mdImageWidth` / `mdImageHeight`）。故此处
	 * **不解释、原文保留**，由 md-serialize 原样写回——编辑节点后不丢用户写下的参数。
	 */
	mdEmbedPipe?: string;
	/** 图片的原始库内引用（![[路径]] 的路径）：换图检测与回写目标 */
	mdImageTarget?: string;
	/** 图片嵌入的语法形态（见 MdImageStyle；缺省按 wiki 处理） */
	mdImageStyle?: MdImageStyle;
	/**
	 * 嵌入语法的显示尺寸参数（Obsidian 官方语法：`![[图|宽度]]` /
	 * `![[图|宽x高]]` / `![alt|宽度](url)`）。仅宽度时高度按原始宽高比
	 * 在加载校正时补齐；序列化时经 renderImage 回写尺寸参数
	 * （源行有显式高度时回写 `|宽x高`，否则维持 `|宽度`）。
	 */
	mdImageWidth?: number;
	/** 嵌入语法的显示高度（仅官方 `宽x高` 双参数写法携带；可选） */
	mdImageHeight?: number;
	/**
	 * 外链 Markdown 图片的替代文本（`![说明|300](url)` 的 `说明`）。
	 * 官方语法 `![alt|宽x高](url)` 的 alt 与尺寸共存，编辑节点后合成回写
	 * 需原样保留，否则 alt 丢失。
	 */
	mdImageAlt?: string;
	/**
	 * 行内 token 段（**显示文本 ↔ 原文**的对齐表，也是**唯一的行内 token 台账**）。
	 *
	 * 一行内的 token 分两类，全部按出现顺序登记在此：
	 * - **首图 / 首链**（由 `image` / `hyperlink` / `mdWikiLinkpath` / `attachmentUrl`
	 *   字段承载）→ `first: true`：合成时取**实时渲染形态**（别名、尺寸可能已被编辑）；
	 * - **额外 token**（多链接 / 多 URL / 多图里字段装不下的那部分）→ `first: false`：
	 *   记录**原文切片**，合成时原样输出。这批此前单存于 `mdExtraTokens`，与对齐表
	 *   两表并存需要人工同步（links-split / 清除链接两处）——已并入本字段（单一权威）。
	 *
	 * `text` 是该 token 在**显示文本**里的样子（剥壳显示名，与 `data.text` 的那一段
	 * 逐字相同）：编辑后据此在新文本里按序定位，把 token 写回**原位**（K52）。
	 * **无显示名的 token**（首图、URL icon-only、非图片附件嵌入）登记为 `text: ''`
	 * ——位置信息不在显示文本中 → 合成时保持尾插，且首 token 由字段实时渲染，
	 * 不会写出过期原文。
	 *
	 * 未编辑时仍走 mdRaw 逐字回写，本字段不参与；`links-split` 重写父行时按
	 * 新行解析结果整体重建（避免被抽走的 token 凭旧记录复活）。
	 */
	mdSegments?: MdTokenSegment[];
	/**
	 * 节点图尺寸来自**加载期自动校正**（按原始宽高比算出的显示尺寸，非用户意图）。
	 *
	 * 引擎侧仍需 `imageSize.custom = true` 才能精确渲染——`custom:false` 会被引擎按
	 * `imgMaxWidth/imgMaxHeight` 重新适配（宽图丢掉「统一高度」语义，见 bundle 的
	 * `getImgShowSize`）。但该尺寸**不得回写**：否则用户从未动过的行会在保存后凭空
	 * 多出 `|宽度` 参数（2026-09-11 定为缺陷）。
	 *
	 * 清除时机：用户拖拽调宽（`setNodeImageSize` 前的提交）与「插入/更换图片」
	 * ——那两种是用户意图，尺寸应照旧回写。
	 */
	mdImageAutoSize?: boolean;
	/**
	 * 任务列表状态（GFM task list item）。
	 *
	 * 只在 `mdType === 'list'` 且**首行**以 `[ ]` / `[x]` / `[X]` 开头时存在；
	 * 判定与合成收口在 `domain/md-task`。`mdRaw` 保留 token（逐字回写），
	 * `text` / `mdDerivedText` 剥掉 token（显示文本）——两者必须**一起**剥，
	 * 否则 `md-serialize.rawOk` 会把每个任务节点判成「已编辑」。
	 */
	mdTask?: TaskState;
	/**
	 * 任务 token 的**原样**写法（`[ ]` / `[x]` / `[X]`）。
	 *
	 * 合成回写时逐字还原（不把用户写的 `[X]` 规范化成 `[x]`）；仅在 `mdTask`
	 * 存在时有意义。切换状态时由 `domain/md-task.toggleTaskToken` 生成新值。
	 */
	mdTaskToken?: string;
	/**
	 * **联系指令行**的逐字原文（多个指令行以 `\n` 连接），已从 `text` 剥出。
	 *
	 * 形态见 `domain/relation`：`%%id:xxxxxx%% %%rel:xxxxxx | 标签%%`，位置是
	 * 节点最后一个物理行的**下一行**（独立一行、整行只有指令段）。选择独立行而
	 * 不是行内尾插是实机结论：行尾指令会让 Obsidian 的 heading 文本变成
	 * `支付 %%id:9c2e%%`，`[[#支付]]` 与行尾 `^block-id` 一起失效。
	 *
	 * 与 `mdTaskToken` 同构：`mdRaw` 逐字保留、`text` / `mdDerivedText` 一起剥、
	 * 合成回写时贴回节点末行（缩进由序列化器按节点类型补）。派生状态（id / 出边）
	 * **不落字段**，由 `domain/relation.relationStateOf` 读时算出——引擎内联编辑
	 * 会直接改写 `data.text`，缓存字段必然过期。
	 */
	mdDirectiveTail?: string;
}
