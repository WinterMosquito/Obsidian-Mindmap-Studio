/** 节点内容 task.styles：DOM/样式内聚，保持原输出与导出保真。 */


/**
 * 任务复选框的类名（**交互契约**：`features/view-node-task` 用它在画布 capture
 * 阶段命中点击目标；改这里必须同步改那边，两处都不许写字面量）。
 */
export const NODE_TASK_CLASS = 'mindmap-node-task';

/**
 * 复选框盒模型（**内联**：导出 SVG 不含 styles.css，见文件头的导出保真契约）。
 *
 * 尺寸取 13px：与 14/15px 正文的首行基线对齐后不顶高节点；对勾用普通文本
 * （`✓`）而非表单控件——`<input type=checkbox>` 在 foreignObject 的序列化 /
 * 光栅化路径上表现不一致，且无法内联主题色。
 *
 * **盒子本体不能有直接文本子节点**（`position: relative` 只服务于对勾层）：
 * 空 inline-block 的基线取底边 margin edge，一旦盒内出现 `✓`，基线改为字形
 * 基线 ⇒ 所在行盒被撑高 2px ⇒ 引擎重测出「勾选后节点高 26→28」，画布上节点
 * 上下各长 1px、**下方兄弟节点整列下移**、复选框相对文字下沉（2026-10-28 实机：
 * 未勾选 26 / 已勾选 28；内容盒高度对照 空=26、放 `✓`=28、清空=26、
 * `✓` 放绝对定位子元素=26）。故对勾一律走 `TASK_GLYPH_STYLES` 的绝对定位层，
 * 两层都渲染（未勾选层留空）以保证两态结构一致。
 */
export const TASK_BOX_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'relative',
	display: 'inline-block',
	boxSizing: 'border-box',
	width: '13px',
	height: '13px',
	lineHeight: '10px',
	textAlign: 'center',
	borderStyle: 'solid',
	borderWidth: '1.5px',
	borderRadius: '3px',
	marginRight: '6px',
	verticalAlign: '-2px',
	fontSize: '10px',
	fontWeight: '700',
	cursor: 'pointer',
	userSelect: 'none',
};

/**
 * 对勾层：**绝对定位**（不参与行盒 ⇒ 有没有 `✓` 都不改变盒子基线，见
 * `TASK_BOX_STYLES`）。`inset: 0` 铺满边框内的内容区，flex 居中抵消
 * `line-height`/字体度量差异；`pointerEvents: none` 让命中判定统一落在复选框
 * 本体上（`view-node-task` 的 `closest('.mindmap-node-task')` 之外不该有目标）。
 */
export const TASK_GLYPH_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'absolute',
	top: '0',
	left: '0',
	right: '0',
	bottom: '0',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	lineHeight: '1',
	fontSize: '10px',
	fontWeight: '700',
	pointerEvents: 'none',
};

/**
 * 深勾色：完成态盒底为纯白（`ink === '#ffffff'`，即底色过深的着色节点）时用。
 * 取柔和深灰蓝而非纯黑，与节点墨色（`#111827`）同族。
 */
const TASK_MARK_DARK = '#1f2937';

/**
 * 完成态的勾色：两条分支的判据**不同源**，故不能合并成一个三元。
 *
 * - **着色节点**：完成态盒底 = `ink`（构建期已知的十六进制）⇒ 勾色按盒底反推：
 *   深墨配白勾，纯白盒底配 `TASK_MARK_DARK`。纯白必为小写：`ink` 出自
 *   `domain/color.nodeInkColor`，它只在底色过深时返回字面量 `'#ffffff'`，
 *   其余情况一律返回深色。B 方案下填充恒为浅档 ⇒ 实际总走白勾，深勾分支留给
 *   **data 里出现深 fillColor**（旧数据 / 外部写入）的场合，是防御而非死代码。
 * - **主题节点**：底色是 CSS 变量，构建期拿不到亮度 ⇒ 交主题的语义色
 *   `--text-on-accent`（强调底色上的文字色），变量缺失时回退白勾（与原生
 *   `input[type=checkbox]` 同观感）。代价是浅色链接色配白勾对比不足——接受，
 *   「与主题自洽」优先（K151 ③）。
 *
 * 单独成函数而非内联三元：`obsidianmd/no-static-styles-assignment` 按 AST 拦
 * 「赋值右侧直接是字面量」，把 `var(--…)` 藏在 `return` 里即可合规——与
 * `Object.assign(el.style, 表)` 是同一类绕行手法（K91 ⑩），别改成直赋字面量。
 */
export function taskMarkColor(ink: string | undefined): string {
	if (ink === undefined) {
		return 'var(--text-on-accent, #ffffff)';
	}
	return ink === '#ffffff' ? TASK_MARK_DARK : '#ffffff';
}
