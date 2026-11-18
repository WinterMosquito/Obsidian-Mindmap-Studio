/** 节点内容 common.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { type NodeContentTones } from '../../domain/color';

/**
 * **主题链接色链**：内链 / 标签 pill / 任务复选框的**唯一基色来源**。
 *
 * 为什么是一条共享常量：三者的可见口径都是「跟主题的链接色」，一旦各写一份
 * `var(--link-color, …)` 字符串，任何一处调整兜底链都会与另两处失配
 * （硬规则 5「不造第二份判定」）。链上还有两个**下级**消费者，同样复用本常量
 * 而不是手抄：`EXTERNAL_LINK_STYLES`（外链优先）与 `UNRESOLVED_LINK_STYLES`
 * （未解析色优先）。**着色节点不适用**——那里改走 `params.tones.ink`（派生
 * 墨色），与 `anchorStyle` 同一套规则。
 *
 * 后两级兜底服务导出图（导出 SVG 内没有主题变量上下文）：`--link-color`
 * 缺失退 `--text-accent`，再退 Obsidian 默认强调色 `#7f6df2`。导出侧另有
 * `platform/export-svg-postprocess` 注入宿主实际值，两者互为兜底。
 *
 * **导出注入取的是 computed value，链路两端对称**：`getComputedStyle` 对自定义
 * 属性已完成 `var()` 替换——默认主题 `--link-color: var(--text-accent)` 实测取到
 * `hsl(210, 100%, 50%)`，注入进导出 SVG 的也是这个字面量，故**不需要**把被引用
 * 的下级变量逐个收进 `CSS_VARS_TO_EXPORT`。唯一边界同样对称：引用目标未定义 ⇒
 * 该变量 computed 值为**空串**（guaranteed-invalid）⇒ 导出侧 `!value` 跳过注入、
 * `var(--link-color, …)` 落备用值，屏上同一时刻也退到 `--text-accent`（实测
 * `--link-color: var(--nope)` → computed `''`、标签色 `rgb(0, 128, 255)`）。
 */
export const THEME_LINK_COLOR = 'var(--link-color, var(--text-accent, #7f6df2))';

/**
 * 「外框类」容器（表格 / 围栏代码块）：着色节点把主题的浅灰外框换成派生色
 * ——主题 `#e4e4e4` 在彩色底上对比仅 1.2，等于没有框。
 */
export function withDerivedBorder(
	base: Partial<CSSStyleDeclaration>,
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	return tones ? { ...base, border: `1px solid ${tones.border}` } : base;
}
