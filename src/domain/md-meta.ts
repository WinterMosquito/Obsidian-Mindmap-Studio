/**
 * Markdown 渲染层附加在节点 data 上的元数据（md* 前缀）。
 *
 * 此前这些 key 散落在 `Record<string, unknown>` / AnyObject（any）上，
 * 读侧到处 typeof 收窄、写侧无约束；统一由本接口声明类型：
 * - 写入方：md-outline（解析时）、view-node-actions（换图时）；
 * - 读取方：md-serialize（回写判定与合成）、视图模块。
 *
 * 元数据仅为本插件序列化层服务，引擎不识别（渲染无语义），
 * 不写入 .mindmap.md 文件正文。
 */

/** 行类型（data.mdType）：md 三种行形态 */
export type MdLineType = 'heading' | 'list' | 'plain';

/** 链接样式（data.mdLinkStyle）：wiki 双链 / md 标准链接（含 autolink） */
export type MdLinkStyle = 'wiki' | 'md';

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
}
