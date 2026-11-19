/**
 * 两条节点编辑通道的外观与临时显示管理，不改变文本、事件与提交时机。
 *
 * vendor 的 showEditTextBox 在显示时重写内联 background / boxShadow；无边框节点
 * 会回退白底。因此在原方法完成后同步应用节点底色（透明节点取画布底色）。
 * beforeTextEdit 只有显示前拦截能力，无法覆盖后续赋值；私有方法缺失时保留原行为。
 * 适配随引擎实例回收，既不改 vendor 产物，也不使用全局 CSS 覆盖其他插件。
 */
import type { MindMap, MindMapNode } from '../core/engine-types';
import { getDrawTransform } from './mindmap-viewport';
import { getNodeGroupEl } from './mindmap-nodes';

/** 高亮与编辑面共用几何，随内容增长；不再保留旧尺寸的 SVG 选中框。 */
const NODE_EDITOR_FOCUS_SHADOW = '0 0 0 1px var(--interactive-accent)';

/** 暂藏整个节点但保留可测量尺寸；两条通道共用，恢复幂等且保留原属性。 */
export function hideNodeForEditing(group: Element): () => void {
	const visibility = group.getAttribute('visibility');
	group.setAttribute('visibility', 'hidden');
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		if (visibility === null) group.removeAttribute('visibility');
		else group.setAttribute('visibility', visibility);
	};
}

interface NodeStyle {
	merge?(key: string): unknown;
}

export interface NodeEditorAppearance {
	background: string;
	color: string;
	borderRadius: number;
	focusShadow: string;
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
		focusShadow: NODE_EDITOR_FOCUS_SHADOW,
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
	currentNode?: MindMapNode | null;
	showTextEdit?: boolean;
	showEditTextBox?(params: { node: MindMapNode }): void;
	hideEditTextBox?(): void;
	removeTextEditEl?(): void;
}

const adapted = new WeakSet<object>();

/** engine 内部安装入口，所有编辑入口（插入、双击、F2、缩放重开）共用。 */
export function installNodeEditorAppearance(mindMap: MindMap): void {
	const editor = (mindMap.renderer as unknown as { textEdit?: TextEditor } | undefined)?.textEdit;
	if (!editor || typeof editor.showEditTextBox !== 'function' || adapted.has(editor)) return;
	const original = editor.showEditTextBox.bind(editor);
	adapted.add(editor);
	let restore: (() => void) | null = null;
	const release = (): void => {
		restore?.();
		restore = null;
	};
	// 私有关闭方法缺失时只适配外观，避免隐藏节点后没有恢复入口。
	if (typeof editor.hideEditTextBox === 'function') {
		for (const key of ['hideEditTextBox', 'removeTextEditEl'] as const) {
			const close = editor[key]?.bind(editor);
			if (!close) continue;
			editor[key] = () => {
				release();
				close();
			};
		}
		mindMap.on?.('beforeDestroy', release);
	}
	editor.showEditTextBox = function (params): void {
		original(params);
		const el = this.textEditNode;
		if (!el || this.showTextEdit === false) return;
		try {
			const node = this.currentNode ?? params.node;
			const appearance = readNodeEditorAppearance(mindMap, node);
			Object.assign(el.style, {
				background: appearance.background,
				color: appearance.color,
				borderRadius: `${appearance.borderRadius * getDrawTransform(mindMap).scaleX}px`,
				boxShadow: appearance.focusShadow,
			});
			release();
			const group = getNodeGroupEl(node);
			if (group && typeof this.hideEditTextBox === 'function') restore = hideNodeForEditing(group);
		} catch (error) {
			console.warn('节点编辑框样式适配失败，保留引擎样式', error);
		}
	};
}
