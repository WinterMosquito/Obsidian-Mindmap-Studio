/**
 * 节点原文编辑组件：骨架、内联样式、缩放后的尺寸、输入与焦点。
 * 调用方提供屏幕矩形/内容样式及回调；组件不读取节点、引擎、视图或文件。
 * 编辑期只更新 DOM，任何写回均由提交回调承接。
 */
import { EventBinder } from '../../core/event-binder';
import { resolveInlineEditKey } from '../../domain/node-edit-key';
import { EDITOR_STYLES } from './node-editor.styles';

interface NodeEditorOptions {
	value: string;
	label: string;
	onInput: () => void;
	onCommit: () => void;
}

export interface NodeEditorLayout {
	rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;
	scale: number;
	computed?: CSSStyleDeclaration;
	/** 内容盒未缩放的显式宽度；空字符串表示随原文测量。 */
	fixedWidth: string;
	appearance: Pick<CSSStyleDeclaration, 'background' | 'color' | 'borderRadius' | 'boxShadow'>;
}

export class NodeEditor {
	readonly element: HTMLTextAreaElement;
	private readonly events = new EventBinder();
	private measureContext: CanvasRenderingContext2D | null;
	private disposed = false;

	constructor(private readonly doc: Document, options: NodeEditorOptions) {
		const el = doc.body.createEl('textarea', {
			cls: 'mindmap-node-inline-editor',
			attr: { spellcheck: 'false', 'aria-label': options.label },
		});
		this.element = el;
		Object.assign(el.style, EDITOR_STYLES);
		el.value = options.value;
		// 所属窗口的公开 Elements API；Canvas 仅测量，不挂进 DOM。
		const domWindow = doc.win as (Window & { createEl?: typeof createEl }) | undefined;
		this.measureContext = domWindow?.createEl?.('canvas').getContext('2d') ?? null;
		this.events.onDom(el, 'input', options.onInput);
		this.events.onDom(el, 'keydown', (event) => {
			event.stopPropagation();
			if (event.isComposing || event.key === 'Process') return;
			const action = resolveInlineEditKey(event);
			if (action !== 'commit') return;
			event.preventDefault();
			options.onCommit();
		});
		for (const type of ['keyup', 'mousedown', 'click'] as const) {
			this.events.onDom(el, type, (event) => event.stopPropagation());
		}
		// capture 先于画布拖拽/右键处理；编辑器内部按下保持编辑。
		this.events.onDom(doc, 'mousedown', (event) => {
			const target = event.target as Node | null;
			if (target && el.contains(target)) return;
			options.onCommit();
		}, true);
	}

	get value(): string { return this.element.value; }

	focusAtEnd(): void {
		if (this.disposed) return;
		const el = this.element;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
		el.scrollTop = 0;
	}

	/** 沿用原内容盒起点与字号，不取整；原文增长到 maxWidth 后换行增高。 */
	updateLayout({ rect, scale, computed, fixedWidth, appearance }: NodeEditorLayout): void {
		if (this.disposed) return;
		const el = this.element;
		Object.assign(el.style, appearance);
		if (computed) {
			const pixels = (value: string): string => `${(Number.parseFloat(value) || 0) * scale}px`;
			Object.assign(el.style, {
				fontFamily: computed.fontFamily,
				fontSize: pixels(computed.fontSize),
				fontWeight: computed.fontWeight,
				fontStyle: computed.fontStyle,
				letterSpacing: computed.letterSpacing === 'normal' ? 'normal' : pixels(computed.letterSpacing),
				lineHeight: computed.lineHeight === 'normal' ? 'normal' : pixels(computed.lineHeight),
				paddingTop: pixels(computed.paddingTop),
				paddingRight: pixels(computed.paddingRight),
				paddingBottom: pixels(computed.paddingBottom),
				paddingLeft: pixels(computed.paddingLeft),
			});
		}
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top}px`;
		let width = rect.width;
		const context = this.measureContext;
		if (computed && context) {
			context.font = `${computed.fontStyle} ${computed.fontWeight} ${el.style.fontSize} ${computed.fontFamily}`;
			context.letterSpacing = el.style.letterSpacing;
			let textWidth = 0;
			for (const line of el.value.split('\n')) textWidth = Math.max(textWidth, context.measureText(line).width);
			const padding = Number.parseFloat(el.style.paddingLeft) + Number.parseFloat(el.style.paddingRight);
			const maxWidth = Number.parseFloat(computed.maxWidth) * scale;
			const naturalWidth = textWidth + padding + 2 * scale;
			const explicitWidth = Number.parseFloat(fixedWidth) * scale;
			width = explicitWidth > 0 ? explicitWidth : Math.max(rect.width, Math.min(naturalWidth, maxWidth || naturalWidth));
		}
		el.style.width = `${width}px`;
		Object.assign(el.style, { height: '0' });
		el.style.height = `${Math.max(rect.height, el.scrollHeight ? el.scrollHeight + 1 : 0)}px`;
		el.scrollTop = 0;
	}

	/** 解绑所有局部监听并释放测量上下文；焦点归还所属文档 body。 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.events.destroy();
		this.measureContext = null;
		this.element.remove();
		this.doc.body.focus();
	}
}
