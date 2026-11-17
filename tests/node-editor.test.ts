/** UI 组件直测：不创建导图或文件，验证局部键盘、测量、焦点与事件生命周期。 */
import { describe, expect, it, vi } from 'vitest';
import { NodeEditor, type NodeEditorLayout } from '../src/ui/node-editor/node-editor';
import { makeDocStub, lastEl } from './helpers/node-editor-dom';

function setup() {
	const doc = makeDocStub();
	const onInput = vi.fn();
	const onCommit = vi.fn();
	const context = { font: '', letterSpacing: '', measureText: vi.fn((text: string) => ({ width: text.length * 10 })) };
	Object.assign(doc, { win: { createEl: () => ({ getContext: () => context }) } });
	const editor = new NodeEditor(doc as unknown as Document, { value: '原文', label: '编辑原文', onInput, onCommit });
	return { doc, editor, el: lastEl(doc), onInput, onCommit, context };
}

function layout(patch: Partial<NodeEditorLayout> = {}): NodeEditorLayout {
	return {
		rect: { left: 10.25, top: 20.75, width: 80, height: 30 },
		scale: 1,
		fixedWidth: '',
		appearance: { background: '#fff', color: '#222', borderRadius: '6px', boxShadow: '0 0 0 1px #555' },
		computed: {
			fontFamily: 'sans-serif', fontSize: '20px', fontWeight: '400', fontStyle: 'normal',
			lineHeight: '24px', letterSpacing: 'normal', paddingLeft: '6px', paddingRight: '6px',
			paddingTop: '4px', paddingBottom: '4px', maxWidth: '200px',
		} as CSSStyleDeclaration,
		...patch,
	};
}

function key(key: string, patch: Partial<KeyboardEvent> = {}) {
	return { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false,
		stopPropagation: vi.fn(), preventDefault: vi.fn(), ...patch };
}

describe('NodeEditor', () => {
	it('创建不抢焦点，定位后显式聚焦末尾，样式完全来自组件内联表', () => {
		const h = setup();
		expect(h.doc.created[0]?.options).toMatchObject({ cls: 'mindmap-node-inline-editor', attr: { 'aria-label': '编辑原文' } });
		expect(h.el.focus).not.toHaveBeenCalled();
		h.editor.updateLayout(layout());
		h.editor.focusAtEnd();
		expect(h.el.focus).toHaveBeenCalledTimes(1);
		expect(h.el.setSelectionRange).toHaveBeenCalledWith(2, 2);
		expect(h.el.style).toMatchObject({ position: 'fixed', overflow: 'hidden', resize: 'none', left: '10.25px', top: '20.75px' });
		h.editor.dispose();
	});

	it('宽度随原文增长到 maxWidth，固定宽度与缩放优先，高度增长后可收回', () => {
		const h = setup();
		h.el.value = '长'.repeat(30);
		h.el.scrollHeight = 85;
		h.editor.updateLayout(layout());
		expect(h.el.style.width).toBe('200px');
		expect(h.el.style.height).toBe('86px');
		h.editor.updateLayout(layout({ scale: 1.5, fixedWidth: '110px' }));
		expect(h.el.style.width).toBe('165px');
		expect(h.el.style.fontSize).toBe('30px');
		expect(h.el.style.paddingLeft).toBe('9px');
		h.el.value = '短';
		h.el.scrollHeight = 20;
		h.el.scrollTop = 55;
		h.editor.updateLayout(layout());
		expect(h.el.style.width).toBe('80px');
		expect(h.el.style.height).toBe('30px');
		expect(h.el.scrollTop).toBe(0);
		expect(h.onCommit).not.toHaveBeenCalled();
		h.editor.dispose();
	});

	it.each([
		key('Enter'), key('Enter', { metaKey: true }), key('Tab'), key('Escape'),
	])('%s 委托提交并阻止事件向外传播', (event) => {
		const h = setup();
		h.el.fire('keydown', event);
		expect(h.onCommit).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		h.editor.dispose();
	});

	it.each([
		key('Enter', { shiftKey: true }), key('Enter', { altKey: true }),
		key('Enter', { isComposing: true }), key('Process'), key('a'),
	])('%s 保持原生输入，不触发提交或 preventDefault', (event) => {
		const h = setup();
		h.el.fire('keydown', event);
		expect(h.onCommit).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		h.editor.dispose();
	});

	it('input 只委托尺寸更新；内部点击保持编辑，外部按下委托提交', () => {
		const h = setup();
		h.el.value = '未提交原文';
		h.el.fire('input', {});
		expect(h.onInput).toHaveBeenCalledTimes(1);
		expect(h.editor.value).toBe('未提交原文');
		h.doc.fireDoc('mousedown', { target: h.el });
		expect(h.onCommit).not.toHaveBeenCalled();
		h.doc.fireDoc('mousedown', { target: {} });
		expect(h.onCommit).toHaveBeenCalledTimes(1);
		for (const type of ['keyup', 'mousedown', 'click']) {
			const event = { stopPropagation: vi.fn() };
			h.el.fire(type, event);
			expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		}
		h.editor.dispose();
	});

	it('销毁幂等，解绑输入与 document，旧元素不再委托或测量，也不再次抢焦点', () => {
		const h = setup();
		h.editor.updateLayout(layout());
		const measures = h.context.measureText.mock.calls.length;
		h.editor.dispose();
		h.editor.dispose();
		expect(h.el.listenerCount()).toBe(0);
		h.el.fire('keydown', key('Enter'));
		h.el.fire('input', {});
		h.doc.fireDoc('mousedown', { target: {} });
		h.editor.updateLayout(layout());
		h.editor.focusAtEnd();
		expect(h.onCommit).not.toHaveBeenCalled();
		expect(h.onInput).not.toHaveBeenCalled();
		expect(h.context.measureText).toHaveBeenCalledTimes(measures);
		expect(h.doc.body.focus).toHaveBeenCalledTimes(1);
		expect(h.el.remove).toHaveBeenCalledTimes(1);
		expect(h.el.focus).not.toHaveBeenCalled();
	});
});
