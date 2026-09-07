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
	/** 图片的原始库内引用（![[路径]] 的路径）：换图检测与回写目标 */
	mdImageTarget?: string;
	/**
	 * 嵌入语法的显示尺寸参数（Obsidian 官方语法：`![[图|宽度]]` /
	 * `![[图|宽x高]]` / `![alt|宽度](url)`）。仅宽度时高度按原始宽高比
	 * 在加载校正时补齐；序列化时经 renderImage 回写 `|宽度`。
	 */
	mdImageWidth?: number;
	/** 嵌入语法的显示高度（仅官方 `宽x高` 双参数写法携带；可选） */
	mdImageHeight?: number;
}
