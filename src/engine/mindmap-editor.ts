/**
 * 节点编辑框的显示适配，不改变文本、事件与提交时机。
 *
 * vendor 的 showEditTextBox 在显示时重写内联 background / boxShadow；无边框节点
 * 会回退白底。因此在原方法完成后同步应用节点底色（透明节点取画布底色）。
 * beforeTextEdit 只有显示前拦截能力，无法覆盖后续赋值；私有方法缺失时保留原行为。
 * 适配随引擎实例回收，既不改 vendor 产物，也不使用全局 CSS 覆盖其他插件。
 */
import type { MindMap, MindMapNode } from '../core/engine-types';
import { getDrawTransform } from './mindmap-viewport';

interface NodeStyle {
	merge?(key: string): unknown;
}

export interface NodeEditorAppearance {
	background: string;
	color: string;
	borderRadius: number;
}

/** 生效样式只经引擎防腐面读取；DOM 取所属窗口，兼容 popout。 */
export function readNodeEditorAppearance(
	mindMap: MindMap | null,
	node: MindMapNode,
): NodeEditorAppearance {
	const style = (node as unknown as { style?: NodeStyle }).style;
	const data = node.getData() as Record<string, unknown> | null;
	const read = (key: string): unknown => style?.merge?.(key) ?? data?.[key];
	const fill = read('fillColor');
	const color = read('color');
	const radius = Number(read('borderRadius'));
	const canvas = mindMap?.opt?.el as HTMLElement | undefined;
	const canvasColor = canvas?.ownerDocument?.defaultView?.getComputedStyle(canvas).backgroundColor;
	return {
		background:
			typeof fill === 'string' && fill && fill !== 'transparent'
				? fill
				: canvasColor && canvasColor !== 'rgba(0, 0, 0, 0)' && canvasColor !== 'transparent'
					? canvasColor
					: 'var(--background-primary)',
		color: typeof color === 'string' && color ? color : 'var(--text-normal)',
		borderRadius: Number.isFinite(radius) && radius >= 0 ? radius : 6,
	};
}

interface TextEditor {
	textEditNode?: HTMLElement | null;
	showEditTextBox?(params: { node: MindMapNode }): void;
}

const adapted = new WeakSet<object>();

/** engine 内部安装入口，所有编辑入口（插入、双击、F2、缩放重开）共用。 */
export function installNodeEditorAppearance(mindMap: MindMap): void {
	const editor = (mindMap.renderer as unknown as { textEdit?: TextEditor } | undefined)?.textEdit;
	if (!editor || typeof editor.showEditTextBox !== 'function' || adapted.has(editor)) return;
	const original = editor.showEditTextBox.bind(editor);
	adapted.add(editor);
	editor.showEditTextBox = function (params): void {
		original(params);
		const el = this.textEditNode;
		if (!el) return;
		try {
			const appearance = readNodeEditorAppearance(mindMap, params.node);
			Object.assign(el.style, {
				background: appearance.background,
				color: appearance.color,
				borderRadius: `${appearance.borderRadius * getDrawTransform(mindMap).scaleX}px`,
				boxShadow: 'none',
			});
		} catch (error) {
			console.warn('节点编辑框样式适配失败，保留引擎样式', error);
		}
	};
}
