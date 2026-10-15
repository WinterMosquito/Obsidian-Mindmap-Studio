/**
 * 自绘节点内容的**装配收口**：平台实现 → `InlineContentOptions`。
 *
 * 为什么单独成文件：内容构建（`node-inline-content`）刻意零 Obsidian 依赖，
 * 全部能力经 `InlineContentOptions` 注入；而注入实现的**消费方有两个**——
 * `features/view.ts`（文件视图）与 `features/mindmap-codeblock.ts`
 * （```` ```mindmap ```` 代码块嵌入）。两处各写一遍这五项绑定，将来新增第六
 * 条渲染通道（如 mermaid）就会出现漂移：一处加了、另一处静默缺失（属无痕
 * 退化，与 AGENTS.md 硬规则 5「不造第二份收口」同族）。本文件只做
 * 「平台实现 → 选项对象」的单向绑定，**不含任何判定逻辑**。
 *
 * 与宿主相关的只有两项，作为参数进来：
 * - `isResolvedLink`：库内 linkpath 是否解析到真实文件（未解析 → 链接弱化
 *   配色）。两个消费方注的是**同一个** `view-link-navigator.isResolvedWikiLinkpath`
 *   （入参是双方共用的窄宿主面 `MindMapLinkHost`）。
 * - `onSettled`：异步内容定稿（公式替换 / 代码块高亮）后的**尺寸同步**入口。
 *   两者各持自己的 `ContentRemeasureSession`（同一实现、两个宿主）。
 */
import {
	getRenderedMathNode,
	renderMathWithMathJax,
} from '../platform/math-jax';
import {
	getRenderedCodeNodes,
	renderCodeWithPrism,
} from '../platform/prism-code';
import type { InlineContentOptions } from './node-inline-content';

/**
 * 装配依赖。
 *
 * 两项都声明为**函数属性**而非方法语法（同 `ViewNodeEditContext.scheduleSave`
 * 的理由）：调用方会把引用直接透传给选项对象，方法语法会触发
 * `unbound-method` 告警。
 */
export interface NodeContentWiringDeps {
	/** 库内 linkpath 是否已解析到真实文件（未解析 → 弱化配色） */
	isResolvedLink: (linkpath: string) => boolean;
	/** 异步内容定稿（公式替换 / 代码块高亮）后请求尺寸重测 */
	onSettled: (holder: HTMLElement) => void;
}

/** 组装节点内联内容选项（平台实现固定，宿主相关的两项由调用方注入） */
export function createInlineContentOptions(
	deps: NodeContentWiringDeps,
): InlineContentOptions {
	return {
		isResolvedLink: deps.isResolvedLink,
		// 定稿回调经平台入口的第 4 参绑定（platform 层不得依赖 features，
		// 故回调只能在上层绑定，见 node-inline-content 的 renderCode 注释）；
		// 第 5 参 = 构建该段的引擎实例（归属登记，供引擎销毁时精确清理未定稿
		// 段——不按 DOM 连接状态判归属的理由见 platform/math-jax 的 unsettledMath）
		renderMath: (_doc, tex, holder, display, owner) =>
			renderMathWithMathJax(tex, holder, display, deps.onSettled, owner),
		getCachedMath: (tex, display) => getRenderedMathNode(tex, display),
		renderCode: (_doc, code, codeLang, holder) =>
			renderCodeWithPrism(code, codeLang, holder, deps.onSettled),
		getCachedCode: (code, codeLang) => getRenderedCodeNodes(code, codeLang),
	};
}
