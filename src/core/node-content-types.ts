/** 节点内容的共享数据与渲染注入契约；不依赖 features/UI/引擎实现。 */
import type { CalloutHeader } from '../domain/callout';
import type { PipeTable } from '../domain/pipe-table';

export interface InlineContentDocument {
	createElement(tag: string): HTMLElement;
	createTextNode(text: string): Node;
}

/** 行内轻标记（渲染期识别，**不改动 `data.text`**：原文仍由 mdRaw 逐字保真） */
export type InlineTextStyle =
	| 'bold'
	| 'boldItalic'
	| 'italic'
	| 'code'
	| 'strike'
	| 'highlight'
	| 'math';

/**
 * 自绘内容的**外部解析依赖**（注入式：本模块不接触 Obsidian API，
 * 以便在无运行时环境打包/单测，见 InlineContentDocument 的说明）。
 */
export interface InlineContentOptions {
	/**
	 * 库内 linkpath 是否**已解析**到文件（缺省视为已解析）。
	 *
	 * 未解析 → 锚点带 `is-unresolved` 类 + 弱化配色：对齐 Obsidian 阅读视图
	 * 「指向尚不存在的笔记的链接显示为更弱的颜色」。解析发生在**每次构建**时
	 * （不进段序列缓存——缓存按原文内容寻址，与库状态无关）。
	 */
	isResolvedLink?: (linkpath: string) => boolean;
	/**
	 * 数学（行内 `$…$` / 单行块级 `$$…$$`）的**异步渲染**注入
	 * （生产实现 = `platform/math-jax`）。
	 *
	 * 本模块保持零 Obsidian 依赖（`loadMathJax` 不可在无运行时打包），故数学
	 * 渲染作为能力注入：`buildMathElement` 先写**字面占位**（行内 `$…$` /
	 * 块级 `$$…$$`，即回退态），实现方在 MathJax 就绪后把 `holder` 内容替换为
	 * 渲染产物。失败/未注入时占位原样保留——与「未闭合标记按字面」同一条安全口径。
	 *
	 * `display` = 段模型的 display 标记（true → `tex2chtml` 的 `{ display: true }`，
	 * 渲染为独立居中公式；实现方需原样透传给 MathJax 通道）。
	 *
	 * `owner` = 构建该段的**引擎实例**（不透明 token，由 `engine/mindmap` 注入，
	 * 本模块原样透传）——平台侧据此登记归属，引擎销毁时精确清理未定稿段
	 * （`platform/math-jax` 的 `pruneUnsettledMathOwnedBy`，语义见那里的
	 * `unsettledMath`）。
	 */
	renderMath?: (
		doc: InlineContentDocument,
		tex: string,
		holder: HTMLElement,
		display: boolean,
		owner?: object | null,
	) => void;
	/**
	 * **产物缓存查询**（可选，P4 尺寸同步）：返回已渲染产物的**克隆**，未命中 null。
	 *
	 * 命中时 `buildMathElement` **同步**放置产物、**不走** `renderMath`——引擎随后
	 * 的离屏测量直接量到**真实宽高**，消除「按字面占位测量 → 替换后溢出」的窗口；
	 * 且重建路径不再触发异步替换（无重排循环）。注入实现见
	 * `platform/math-jax.getRenderedMathNode`（本模块不 import 该层）。
	 */
	getCachedMath?: (tex: string, display: boolean) => Node | null;
	/**
	 * **代码块 Prism 高亮**的注入（同 `renderMath` 的注入式纪律：生产实现 =
	 * `platform/prism-code`，那里是唯一 import `obsidian` 的代码高亮实现）。
	 *
	 * 本模块先写**字面代码**（信息行已剥、缩进/空行逐字），实现方在`loadPrism()`
	 * 就绪后把 holder 的子节点换成 token 元素。`lang` 已规范化为语言 id（空串 =
	 * 无语言/未登记 → 实现方**跳过**并保留字面）。
	 *
	 * `onSettled`（定稿回调）由**组合根注入时绑定**（视图层拿它触发节点尺寸重测，
	 * 同 `renderMath` 的注入形态），故本形参表里不出现——避免第二条回调通道。
	 * 本模块**不自己找节点**：引擎预测量路径会给代理对象（见 math-jax 文件头）。
	 */
	renderCode?: (
		doc: InlineContentDocument,
		code: string,
		lang: string,
		holder: HTMLElement,
	) => void;
	/**
	 * **已高亮产物查询**（可选，尺寸同步）：返回 token 子节点的克隆数组，未命中 null。
	 *
	 * 命中时 `buildCodeBlockElement` **同步**放置 token、不走 `renderCode`——引擎随后的
	 * 离屏测量直接量到真实宽高（消除「按字面测量 → 替换后溢出」的窗口），且重建
	 * 路径不再触发异步替换（无重排循环）。注入实现见
	 * `platform/prism-code.getRenderedCodeNodes`（本模块不 import 该层）。
	 */
	getCachedCode?: (code: string, lang: string) => readonly Node[] | null;
	/**
	 * **mermaid 图渲染**的注入（生产实现 = `platform/mermaid`；本模块不 import 该层）。
	 *
	 * 与 `renderCode` 的两点差别（照抄它的纪律前必读）：
	 * - **同步**：Pele 是纯字符串渲染（不等字体、不挂载），产物直接进 DOM——
	 *   引擎随后的离屏测量量到的就是图的真实宽高，**不需要**定稿回调与重排会话；
	 * - **返回 SVG 根元素**（不是字符串）：注入实现负责解析，本模块只 append
	 *   （跨文档 append 由 DOM 自动 adopt，popout 场景同样成立）；
	 * - **返回值为空即不接管**：语法错误 / 未注册类型 / 超限一律 null，调用方回落
	 *   块级代码块（同「未登记语言保留字面」的回退口径）。
	 */
	renderMermaid?: (source: string) => Node | null;
	/**
	 * **标注图标**的注入（生产实现 = `platform/callout-icon`，内部转调宿主
	 * `getIcon`；本模块与 `node-inline-html` 都不 import obsidian）。
	 *
	 * 入参是图标 **id**（`domain/callout.calloutVisualOf().icon` 给出的官方取值，
	 * 如 `lucide-info` / `help-circle` / `quote-glyph`——后两个在宿主里本就
	 * **没有** `lucide-` 前缀）。返回 null = 画不了（id 未登记 / 无宿主 /
	 * 无头验证环境）⇒ 标注**省略图标、保留标题与色块**，不抛错、不占位。
	 *
	 * 与 `renderMermaid` 同一形态（同步、返回已解析好的节点），差别只有一处：
	 * 图标是**装饰**，缺失不影响可读性，故不像 mermaid 那样回落成另一段内容。
	 */
	resolveCalloutIcon?: (iconId: string) => Node | null;
}

/**
 * 引用块（含标注）的内容模型（仅 kind = 'quote'）。
 *
 * 与 `PipeTable` 同款定位：**纯数据**，来自 `scanQuoteBlocks` 的块切分，DOM 装配
 * 在 `node-inline-html.buildQuoteElement`。
 *
 * **刻意不导出**：它只以 `InlineSegment.quote` 的字段形态对外（消费方按结构读
 * `header` / `body` 即可），单独导出会让它成为"没有调用方的公开类型"
 * （`npm run check:dead-code` 判红）。
 */
interface QuoteContent {
	/**
	 * 标注头部；`null` = **普通引用块**（无 `[!type]` 首行，如 `> 引用一句`）。
	 *
	 * 两者共用同一个段型与同一个盒子：官方阅读视图里普通引用块与标注本就是
	 * 「同一棵 blockquote 树上的两种装饰」，分两个段型只会让扫描与截断各写一遍。
	 */
	header: CalloutHeader | null;
	/**
	 * 正文原文，**已剥掉 `>` 前缀**（标注另有首行被剥离：那是头部，不是正文）。
	 *
	 * 行间以 `\n` 连接、行尾换行不含（块切分把边界换行算进了段 `text`）。
	 * DOM 层把它重新交给 `buildInlineSegments` 递归 — 内层的围栏块 / 表格 /
	 * 数学 / 链接因此自动成立，**不另写一套块级解析**（硬规则 5）。
	 */
	body: string;
}

/** 行内段：渲染节点内联内容的最小单元（纯数据，可单测） */
export interface InlineSegment {
	kind: 'text' | 'link' | 'table' | 'tag' | 'quote' | 'footnote';
	/**
	 * 纯文本原样 / 链接段的**剥壳显示名**（`tokenDisplay` 口径，与节点文本一致）
	 * / 表格段的**原文块文本**（逐字：含外框管道、`\|` 转义与边界换行）。截断上限
	 * 与编辑弹窗预览都按它计量（见 `clampSegments` / `inlineContentPreview`）。
	 *
	 * ⚠ 段序列 `text` 拼接 **≈ 原文、非逐字相等**：文本段经空格归一
	 * （`normalizeSpaces`）与首尾空白剔除（`trimEdges`），`%%注释%%` 整段不进段
	 * 序列——只有**表格段**的 `text` 是逐字切片。需要逐字原文请用 `mdRaw` /
	 * `data.text`（回写侧同款口径）。
	 */
	text: string;
	/** 链接段跳转目标：wiki = 原始 linkpath；md 链接 / URL = 地址原文 */
	link?: string;
	/**
	 * 标签段的名称（**不含** `#`，`kind === 'tag'` 专用）。
	 *
	 * `text` 是带 `#` 的显示形态（`#项目/子项目`），本字段供点击时拼搜索查询
	 * （`tag:#名称`）。标签的识别只在**顶层 prose**（见 pushTagSegments）：
	 * 轻标记内部、代码 / 数学 / 注释 / 链接内一律不算。
	 */
	tag?: string;
	/**
	 * 该文本段是**转义产物**（`\#` → `#`），**只活在切段过程中**。
	 *
	 * 用途：标签判定必须跳过它——`\#标题` 在 Obsidian 里不是标签，而显示文本
	 * 已经丢掉了反斜杠，只能靠这个标记区分（见 pushPlain 的「转义不合并」）。
	 * 段序列装配完就逐段清掉（`pushInlineText` 重建段对象时不带本字段），
	 * 故 `buildInlineSegments` 的产物里读不到它，渲染层也不消费。
	 */
	escaped?: true;
	/** true = 库内目标（`a.internal-link[data-href]`）；false = 外部地址（`a.external-link[href]`） */
	internal?: boolean;
	/** 文本段的轻标记（仅 kind = 'text'；无标记的纯文本省略） */
	style?: InlineTextStyle;
	/**
	 * 轻标记体的**一层嵌套**（仅 kind = 'text' 且 style 存在；官方「combine
	 * them」，如 `**粗 _斜_**`）。子段不会再有 children（深度上限见
	 * MAX_MARKUP_DEPTH）；无样式子段（纯文本/转义结果）不进 children——
	 * 那种情形下标记体的字面就是显示文本（text 字段已承载）。
	 */
	children?: InlineSegment[];
	/**
	 * 数学段的显示模式（仅 style === 'math'）：true = 单行 `$$…$$`（display /
	 * 块级，渲染为独立居中公式），缺省 = 行内 `$…$`。该标记同时决定占位形态
	 * 与 `renderMath` 注入面的 `display` 形参（见 buildMathElement）。
	 */
	display?: boolean;
	/**
	 * **围栏代码块**标记（仅 style === 'code' 且来自 fence 分支）：true = 块级
	 * 代码块（buildCodeBlockElement：底色盒 + 复制按钮 + Prism 高亮），缺省 =
	 * 行内码（`` ` `` 单反引号）。与 `display` 同款纪律：**重建段对象时必须保留**，
	 * 否则块级渲染会静默退化回行内码。
	 */
	block?: true;
	/**
	 * 围栏**信息行给出的语言 id**（仅 style === 'code' 且 block 标记）：已按
	 * `core/constants.normalizeFenceLanguage` 白名单规范化（小写；不合规为空串）。
	 *
	 * 空串有两种含义，**都不高亮**、都保留字面：① 无信息行（``` ``` ``` /缩进式
	 * 代码块）；② 信息行给了 Prism 未登记的语言码（用户可写任意语言码）。
	 * 该字段进 `<code class="language-…">`（宿主/主题选择器口径）并传给
	 * `platform/prism-code` 查语法。
	 */
	lang?: string;
	/**
	 * **表格段**的模型（仅 kind = 'table'）：解析在 `domain/pipe-table`（纯逻辑），
	 * DOM 装配与内联样式在 `node-inline-html`（`buildTableElement`）。
	 *
	 * 与 `block` / `display` 同款纪律：**重建或拷贝段对象时必须带上**，否则表格段
	 * 会退化成空元素（而 `clampSegments` 的就地切短路径会丢字段——它已排除表格段）。
	 */
	table?: PipeTable;
	/**
	 * **引用块段**的模型（仅 kind = 'quote'）：`header` 非空 = 标注，null = 普通引用。
	 *
	 * 同一款纪律：重建或拷贝段对象时必须带上（截断路径已把引用块列为**原子段**，不
	 * 走就地切短分支）。
	 */
	quote?: QuoteContent;
	/**
	 * 脚注引用的 id（仅 `kind === 'footnote'`；`text` 是它的显示形态，两者当前相同）。
	 *
	 * **只承载 id，不承载定义正文**：段序列按原文寻址缓存（同一段原文 → 同一份段），
	 * 若把定义正文塞进来，同一行在不同文档里就会产出不同段，缓存与「同一原文 → 同一
	 * DOM」的不变量同时失效。正文由交互层在**事件发生时**按 id 现查
	 * （`markdown/md-footnote.collectFootnoteDefinitions`）。
	 */
	footnote?: string;
}

