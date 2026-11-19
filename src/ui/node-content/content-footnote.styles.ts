/** 节点内容 footnote.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { THEME_LINK_COLOR } from './content-common.styles';

/**
 * 脚注引用徽标的类名与 id 属性名（**交互契约**：`features/content/view-footnote` 按
 * `[data-footnote-id]` 命中点击/悬停目标，两处共用这两个常量）。
 *
 * 徽标结构与 Obsidian 阅读视图的 `sup > a.footnote-ref` 同形但**刻意不共用类名**：
 * 节点内容在画布里，宿主的 `.footnote-ref` 全局样式（阅读视图的脚注样式）会意外
 * 命中它；`a` 也**不写 href / data-href**——`view-wikilink` 的 `ANCHOR_SELECTOR`
 * 因此不会把它当链接（链接三通道零改动，与标签 pill 同一条纪律）。
 */
export const FOOTNOTE_REF_CLASS = 'mindmap-node-footnote-ref';

/** 徽标上的脚注 id 属性（点击/悬停的唯一命中依据） */
export const FOOTNOTE_ID_ATTR = 'data-footnote-id';

/**
 * 「纯定义节点」汇总 chip 的类名与 id 列表属性（**交互契约**：
 * `features/content/view-footnote` 按类名命中、按 `data-footnote-ids` 展开全部定义）。
 *
 * 定义行不再铺在节点里（2026-11-11）：整节点只有定义时，接管一个 chip 而不是
 * 空内容——否则引擎会回落渲染 `data.text`，隐藏静默失效。
 */
export const FOOTNOTE_SUMMARY_CLASS = 'mindmap-node-footnote-summary';

/**
 * chip 上的定义 id 列表（**换行分隔**；点击/悬停据此展开全部定义）。
 *
 * 分隔符不能是逗号：脚注 id 允许含逗号（`[^a,b]` 是**一个** id，见
 * `md-footnote.FOOTNOTE_ID_SOURCE` 的字符类），逗号分隔会把一条定义拆成两条
 * 都判「未定义」（2026-11-12 实机）。换行不在 id 字符类里，天然无歧义。
 */
export const FOOTNOTE_IDS_ATTR = 'data-footnote-ids';

/**
 * 脚注引用徽标的样式（**内联**：导出 SVG 不含 styles.css，理由同 CONTENT_STYLES）。
 *
 * 上标由 `<sup>` 承担（HTML 在 foreignObject 里按 UA 样式表渲染），这里只钉住
 * 字号与基线：不写 `vertical-align` 的话不同主题的行高会把它压进正文行内，
 * 看起来像「1 贴在字上」。颜色走链接色（阅读视图同款），**着色节点**改用派生
 * 墨色 + 下划线（与 `anchorStyle` 同一规则：彩色底上不给第五种颜色）。
 */
export const FOOTNOTE_SUP_STYLES: Partial<CSSStyleDeclaration> = {
	// **固定宽度**（2026-11-11 实机复现）：引擎在**字体就绪前**测宽，而数字宽度
	// 随字体变化——窄节点上字体到位后第二枚徽标被挤到第二行（内容盒 31→51、引擎
	// 节点框仍是 31 ⇒ 溢出压住下方节点）。`inline-block + min-width` 让徽标宽度
	// 不随字体漂移（测量值 = 渲染值），负边距之类"缩宽度"的手段无效：测量宽会
	// 跟着缩，换行点不变。
	display: 'inline-block',
	minWidth: '0.9em',
	textAlign: 'center',
	fontSize: '0.75em',
	lineHeight: '1',
	verticalAlign: 'super',
	whiteSpace: 'nowrap',
	color: THEME_LINK_COLOR,
};

/**
 * 徽标内层 `<a>` 的样式（无 href：只作点击目标与光标提示）。
 *
 * ⚠ **不要给内边距**（2026-11-11 实机复现）：`padding: 0 1px` 让每枚徽标多占 2px，
 * 一行两枚就是 4px——节点内宽恰好卡在临界时，第二个徽标会被挤到**第二行**，内容盒
 * 高度从 31 变 51，而引擎的节点框仍是测量时的 31 ⇒ 文字溢出节点、压住下方节点
 * （`脚注-05-嵌入.md` 的「引用₁ 与 ₂」）。宽度预算归零后单行复原。
 */
export const FOOTNOTE_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'inherit',
	textDecoration: 'none',
	cursor: 'pointer',
};

/**
 * 脚注汇总 chip 的样式（**内联**：导出 SVG 不含 styles.css，理由同 CONTENT_STYLES）。
 *
 * `user-select: none` + `cursor: pointer`：它是一个「打开入口」，不是可读内容
 * （正文在浮层里，那里可选择复制）。
 */
export const FOOTNOTE_SUMMARY_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'inline-block',
	padding: '1px 7px',
	borderRadius: '10px',
	fontSize: '0.82em',
	lineHeight: '1.6',
	whiteSpace: 'nowrap',
	backgroundColor: 'var(--background-secondary, rgba(128, 128, 128, 0.12))',
	color: 'var(--text-muted, #888)',
	cursor: 'pointer',
	userSelect: 'none',
};
