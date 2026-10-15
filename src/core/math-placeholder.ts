/**
 * 行内数学「字面占位串」的**形态单一来源**：编解码规则只有这一份。
 *
 * 占位串的三个产生 / 消费点（此前两处各写字面模板，值相同但无约束）：
 * - `features/node-inline-content.buildMathElement`：构建时写占位
 *   （与原文定界符**同形**——这是「未闭合标记按字面」安全口径的可见形态）；
 * - `platform/math-jax.attemptPlace`：产物未就绪（规则未 flush / 塌缩）时
 *   **同步撤回**为同一占位——「同形撤回」是「浏览器不绘制中间态」的前提；
 * - 导出 / 编辑回写路径按**原文**（`mdRaw`）走，不读本占位——本模块不参与
 *   保真链路，只保证屏上字面形态与构建方一致。
 *
 * 为什么落 core：消费方跨 `features`（深层 `node-inline-content` 必须保持
 * **零 Obsidian 依赖**，可被 `verify-visual` 直接打包）与 `platform` 两层；
 * 放 `platform/math-jax` 会被 `features/node-inline-content` import 而拖入
 * obsidian 依赖（该模块的显式约束，见其 `InlineContentDocument` 注释）。
 */

/**
 * 把 TeX 包成**与原文定界符同形**的字面占位：
 * 行内 `$…$`（缺省）/ 单行块级 `$$…$$`（`display === true`）。
 *
 * 调用方不得再内联字面模板——撤回路径与构建路径同串同源，断链即出现
 * 「撤回后与构建形态不一致」的静默分叉（占位既是回退态也是屏上可见文本）。
 */
export function formatMathPlaceholder(tex: string, display: boolean): string {
	return display ? `$$${tex}$$` : `$${tex}$`;
}
