/**
 * 由「依赖契约 + 创建选项」拼出 `createMindMap` 的入参。
 *
 * 从 `services/engine-controller.ts` 的 `renderMindMap` 拆出（2026-10-22，
 * **纯提取，零行为改动**）：这段是 40 行纯适配——把 `deps` 上的回调包成引擎要的
 * 形态，与控制器状态无关，故可整体外移。
 *
 * 之所以单独成文件而不是并进 `engine-controller-deps.ts`：那个文件是**纯类型**
 * 的契约面（其文件头已声明），混入运行时代码会让「改契约 = 改这个文件」的
 * 边界失效。
 *
 * 三处箭头包装**不是风格问题**：`deps` 上的回调是裸方法引用，直接传给引擎后
 * 脱离对象会触发 `@typescript-eslint/unbound-method`，且运行时 `this` 语义也
 * 会变（deps 未持有 this）。故逐个包一层箭头，勿「简化」成方法引用。
 */
import type { CreateMindMapOptions } from '../engine/mindmap';
import type {
	EngineControllerDeps,
	EngineSetupOptions,
} from './engine-controller-deps';

/**
 * @param deps 控制器依赖（取 isDark / lang / 三个可选注入）
 * @param setup 视图侧的创建选项（布局 / 连线 / 主题 / 配色 / 拖拽）
 */
export function buildCreateOptions(
	deps: EngineControllerDeps,
	setup: EngineSetupOptions,
): CreateMindMapOptions {
	/** 节点内联内容渲染器（缺省 = 不开启引擎自绘节点内容通道） */
	const nodeContentRenderer = deps.createNodeContent ?? null;
	/** 导出 SVG 后处理链（组合根注入，按序应用；空链 = 不注册钩子） */
	const exportSvgTransforms = deps.exportSvgTransforms ?? [];
	/** 快捷键前置钩子（剪贴板三键回收；缺省 = 引擎快捷键行为不变） */
	const beforeShortcutRun = deps.beforeShortcutRun ?? null;
	return {
		layout: setup.layout,
		lineStyle: setup.lineStyle,
		themePref: setup.themePref,
		themeStyle: setup.themeStyle,
		palette: setup.palette,
		isDark: deps.isDark(),
		enableDrag: setup.enableDrag,
		lang: deps.getLang(),
		onHyperlinkJump: (link) => deps.openHyperlink(link),
		// 快捷键前置钩子（剪贴板三键回收，见 deps.beforeShortcutRun）：
		// 包一层箭头——deps 上的回调脱离对象后才不会触发 unbound-method
		beforeShortcutRun: beforeShortcutRun
			? (key, nodes) => beforeShortcutRun(key, nodes)
			: null,
		// 节点内联内容（方案 B 原型）：缺省时引擎两键为 false/null，全部走默认文本。
		// 包一层箭头：方法引用脱离对象会触发 unbound-method（deps 未持有 this 语义）。
		// `owner`（本次引擎实例）由 createMindMap 注入并沿构建链透传，
		// 本层只做转发（语义见 CreateMindMapOptions.createNodeContent）
		createNodeContent: nodeContentRenderer
			? (node, doc, style, lang, owner) =>
					nodeContentRenderer(node, doc, style, lang, owner)
			: null,
		// 导出 SVG 后处理链（组合根注入，按序应用）：MathJax CHTML 逐字符
		// 样式注入克隆 SVG——否则导出图中 `<mjx-c>` 无 `::before` 字形规则、
		// 渲染为空白（用户导出 PNG 实测）；随后复制按钮隐身
		// （styles.css 图标规则删除后，「变量间接层」隐式隐身机制退役）。
		// services 层不直接依赖 features（K51），链在 view.ts 装配后注入。
		handleExportSvg:
			exportSvgTransforms.length > 0
				? (svg: unknown) =>
						exportSvgTransforms.reduce<unknown>(
							(acc, transform) => transform(acc),
							svg,
						)
				: null,
	};
}
