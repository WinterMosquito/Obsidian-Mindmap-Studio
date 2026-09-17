/**
 * 行内数学渲染（官方 `loadMathJax()` 通道，生产实现的唯一落点）。
 *
 * 职责：把 `node-inline-content` 生成的**字面占位**（`$…$`，见
 * `buildMathElement`）异步替换为 MathJax 产物。设计约束：
 * - **注入式**：`node-inline-content` 保持零 Obsidian 依赖（无运行时可打包/可
 *   单测），本模块是唯一 import `obsidian` 的数学渲染实现；
 * - **占位即回退**：MathJax 未就绪、`tex2svg` 不存在、渲染抛错、holder 已脱离
 *   文档（导出快照/节点被重建）四种情形都**不替换**——字面显示与「未闭合标记
 *   按字面」同一条安全口径；
 * - 已知边界：导出 PNG/SVG 走离屏克隆时序，占位可能先于渲染被序列化 → 导出图
 *   中数学显示为字面 `$…$`（屏上视图不受影响）。
 *
 * MathJax v3 的 `tex2svg(tex, { display: false })` 返回 `mjx-container` 元素；
 * 字体与基线样式由宿主全局 CSS（`.mjx-container`）提供，本模块不注入额外样式。
 */
import { loadMathJax } from 'obsidian';

/** 本模块实际消费的 MathJax 面（窄化，避免 any） */
interface MathJaxLike {
	tex2svg?: (tex: string, options?: { display?: boolean }) => Node | null;
}

/** 行内数学的显示类名（主题/调试定位用；样式交宿主全局 `.mjx-container`） */
const MATH_CONTAINER_CLASS = 'mindmap-inline-math';

/**
 * 渲染一段行内 TeX 到 holder（异步，fire-and-forget；调用方无需等待）。
 * 多个节点并发渲染安全：`loadMathJax()` 内部对加载去重，`tex2svg` 为纯函数。
 */
export function renderMathWithMathJax(
	tex: string,
	holder: HTMLElement,
): void {
	void (async () => {
		try {
			await loadMathJax();
			// MathJax 由官方 loadMathJax 注入**主窗口**（popout 视图的 holder 挂
			// 跨文档节点合法，appendChild 自动 adopt）；不取 activeWindow——
			// 渲染产物属于主窗口 document
			const mathJax = (window as unknown as { MathJax?: MathJaxLike }).MathJax;
			const rendered = mathJax?.tex2svg?.(tex, { display: false }) ?? null;
			// holder 可能已随节点重建/导出克隆脱离文档：只在仍在文档中时替换，
			// 避免对游离节点做无意义写入（导出图中保持字面，见文件头边界）
			if (rendered && holder.isConnected) {
				holder.replaceChildren(rendered);
				holder.classList.add(MATH_CONTAINER_CLASS);
			}
		} catch (error) {
			console.warn('行内数学渲染失败，保留字面显示', error);
		}
	})();
}
