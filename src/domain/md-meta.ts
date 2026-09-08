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
	 */
	mdWikiLinkpath?: string;
	/**
	 * 该附件引用在原文中用的是**嵌入**语法 `![[附件]]`（而非链接 `[[附件]]`）。
	 * 非图片附件（PDF/音视频等）无法作为节点图渲染，改走 attachmentUrl 通道
	 * 显示回形针；回写时据此补回 `!`，保证 `![[报告.pdf]]` 往返不丢。
	 */
	mdEmbed?: boolean;
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
