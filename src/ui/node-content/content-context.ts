/** 节点内容 context：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentOptions, type InlineSegment, type InlineContentDocument } from '../../core/node-content-types';
import { type Language } from '../../core/i18n';
import { type NodeContentTones } from '../../domain/color';

/** `buildContentElement` 的构建参数（一次装配读一次的取值，随段递归下传） */
export interface BuildContentParams {
	pluginScope?: { nodeId: string; nextIndex: number };
	/** 原入口注入的段解析与装配，引用/表格/轻标记共用。 */
	renderer: InlineContentRenderer;
	/**
	 * 非空表示「只显示了开头」（超长截断，见 MAX_INLINE_CONTENT_CHARS）：除尾部 `…`
	 * 外再挂 `title` 悬停提示与 `data-truncated` 标记，避免用户误以为文件里也只有
	 * 这么点内容（完整文本始终在文件与 `data.text` 中）。
	 */
	truncationTitle: string | null;
	/**
	 * 引擎「拖动节点左右边框改宽」写入的**显式宽度**（content px；null = 未拖过，
	 * 走 CONTENT_STYLES 的 500 折行上限）。见 customTextWidthOf。
	 */
	explicitWidth: number | null;
	/** 外部解析依赖（未解析链接弱化，见 InlineContentOptions） */
	options: InlineContentOptions;
	/** 界面语言：代码块复制按钮的 aria-label 等构建期文案（见 buildCodeBlockElement） */
	lang: Language;
	/**
	 * 构建该内容的引擎实例（不透明 token；只透传给 `renderMath`，见其说明）。
	 * 内层递归（`buildTextElement` 的 children）同样携带——归属与嵌套深度无关。
	 */
	owner: object | null;
	/**
	 * 节点级配色派生出的内容色（`null` = 未着色节点，走原主题样式）。
	 *
	 * 只由 `data.fillColor` 决定（指令的唯一落点），**不跟随明暗主题**：
	 * 写进文件的实色不随主题变，内容色也应保持一致。
	 */
	tones: NodeContentTones | null;
	/**
	 * 任务状态（`null` = 非任务）：复选框是自绘内容的**第一个子元素**，与文本
	 * 同处一个 `foreignObject`，导出 SVG 时随内容一起序列化。
	 */
	task: 'todo' | 'done' | null;
	/**
	 * **纯定义节点**的定义 id（非空 ⇒ 本节点没有可见正文，只画一枚汇总 chip）。
	 *
	 * 与 `task` 同款定位：它是内容本身，不是段。定义行已在
	 * `resolveSelfDrawSource` 里被剥离（`splitFootnoteDefinitions`），此处只剩
	 * 「有几条、分别是哪些 id」这个事实。
	 */
	footnoteIds: readonly string[] | null;
}

/** 同一段管线的窄回调；组件不反向 import features，不重写 Markdown 解析。 */
export interface InlineContentRenderer {
 buildInlineSegments(raw: string): readonly InlineSegment[];
 appendSegments(doc: InlineContentDocument, parent: HTMLElement, segments: readonly InlineSegment[], params: BuildContentParams, depth: number): void;
 buildTextElement(doc: InlineContentDocument, segment: InlineSegment, params: BuildContentParams): Node;
}
