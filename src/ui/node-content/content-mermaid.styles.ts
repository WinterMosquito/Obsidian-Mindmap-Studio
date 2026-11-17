/** 节点内容 mermaid.styles：DOM/样式内聚，保持原输出与导出保真。 */


/**
 * mermaid 图容器类名（`tmm-*` 前缀：与代码块同属「围栏块」子系统，见
 * `core/constants` 的前缀纪律）。
 *
 * 只在**渲染成功**时出现：图不可用（语法错误 / 未注册类型 / 超限）时该段回落
 * `.tmm-codeblock`，故「有没有 `.tmm-mermaid`」就是「这节点画的是图还是源码」
 * 的唯一判据（verify:visual 与调试选择器都用它）。
 */
export const MERMAID_BLOCK_CLASS = 'tmm-mermaid';

/**
 * mermaid 图容器：外观几乎全部来自 Pele 自己的 SVG（底色/线条/字号都是
 * `--pele-*` 变量），本表只管「盒」与「手感」：
 * - `pointerEvents: 'auto'` —— 容器**必须可悬停**：复制按钮靠 `:hover` 显形，
 *   容器若不可命中就永远悬停不到（2026-11-09 实机踩到）。让位的是图本身
 *   （`MERMAID_FIGURE_STYLE`：`<svg>` 不参与命中），只有锚点与按钮自行放行；
 * - `lineHeight: '0'` —— SVG 是行内元素，不清零会在底部留一条基线缝；
 * - `maxWidth: 100%` + `overflow: hidden` —— 宽图靠 SVG 自带的
 *   `max-width:100%;height:auto` 等比缩小，容器只负责兜住溢出；
 * - **不设高度上限**：图的高度就是它的信息量，代码块那套「限高 + 块内滚动」
 *   会把图裁掉一块（导出克隆里更明显）。
 */
export const MERMAID_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'relative',
	display: 'block',
	boxSizing: 'border-box',
	margin: '4px 0',
	maxWidth: '100%',
	overflow: 'hidden',
	lineHeight: '0',
	pointerEvents: 'auto',
	// **不透明纸面**：图有自己的底色，不把节点色透上来（2026-11-09 用户裁决）。
	// 颜色只由主题（明暗）决定：宿主有 `--pele-bg` 时用它，缺失时退回
	// `--background-primary`（老版本 Obsidian / 无 Pele 的环境）。
	// 写在**内联样式**里而不是 styles.css：类规则不进导出克隆，透明纸面会让
	// 彩色节点上的图直接压在节点填充上。
	backgroundColor: 'var(--pele-bg, var(--background-primary))',
};

/**
 * 图本身**不参与命中**：容器必须可悬停（复制按钮靠 `:hover` 显形，容器若是
 * `pointer-events:none` 就永远悬停不到），但图若也命中就会抢走拖拽 / 双击 / 文字
 * 选择——故让 `<svg>` 让位、点击落在容器上（事件照常冒泡到引擎的节点监听）。
 */
export const MERMAID_FIGURE_STYLE: Partial<CSSStyleDeclaration> = {
	pointerEvents: 'none',
};

/** 图内锚点的内联样式：图让位后，锚点是唯一需要命中能力的子元素 */
export const MERMAID_ANCHOR_STYLE: Partial<CSSStyleDeclaration> = {
	pointerEvents: 'auto',
	cursor: 'pointer',
};

/** 复制按钮的命中回收（与锚点同因：容器不可命中，子元素必须显式放行） */
export const MERMAID_COPY_HIT_STYLE: Partial<CSSStyleDeclaration> = {
	pointerEvents: 'auto',
};
