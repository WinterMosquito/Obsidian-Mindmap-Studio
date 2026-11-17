/** 编辑框跟随节点/画布底色，并保持引擎显示与提交入口不变。 */
import { describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../src/core/engine-types';

vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

import { installNodeEditorAppearance, readNodeEditorAppearance } from '../src/engine/mindmap-editor';

function harness(fill = 'transparent', canvasColor = 'rgb(30, 30, 30)') {
	const data = { text: 'original', fillColor: fill, color: '#d0d0d0', borderRadius: 6 };
	const node = {
		getData: () => data,
		style: { merge: (key: string) => data[key as keyof typeof data] },
	} as unknown as MindMapNode;
	const el = { style: { background: '', color: '', borderRadius: '', boxShadow: '' } };
	const show = vi.fn(function (this: { textEditNode: typeof el }, _params: { node: MindMapNode }) {
		Object.assign(this.textEditNode.style, { background: '#fff', boxShadow: '0 0 20px rgba(0,0,0,.5)' });
	});
	const editor = { textEditNode: el, showEditTextBox: show };
	const mindMap = {
		renderer: { textEdit: editor },
		opt: { el: { ownerDocument: { defaultView: { getComputedStyle: () => ({ backgroundColor: canvasColor }) } } } },
		view: { getTransformData: () => ({ transform: { scaleX: 1.5, scaleY: 1.5 } }) },
	} as unknown as MindMap;
	return { node, data, el, editor, show, mindMap };
}

describe('节点编辑框外观', () => {
	it.each(['rgb(255, 255, 255)', 'rgb(30, 30, 30)'])('透明节点跟随画布底色 %s', (canvasColor) => {
		const h = harness('transparent', canvasColor);
		installNodeEditorAppearance(h.mindMap);
		h.editor.showEditTextBox({ node: h.node });
		expect(h.el.style.background).toBe(canvasColor);
		expect(h.el.style.color).toBe('#d0d0d0');
		expect(h.el.style.boxShadow).toBe('none');
		expect(h.el.style.borderRadius).toBe('9px');
		expect(h.show).toHaveBeenCalledTimes(1);
		expect(h.show.mock.instances[0]).toBe(h.editor);
		expect(h.data.text).toBe('original');
	});

	it('着色节点使用其实际填充色；每次显示重新读取，切换节点不沿用旧色', () => {
		const h = harness('#89cFF0');
		installNodeEditorAppearance(h.mindMap);
		h.editor.showEditTextBox({ node: h.node });
		expect(h.el.style.background).toBe('#89cFF0');
		h.data.fillColor = '#2e9e8f';
		h.editor.showEditTextBox({ node: h.node });
		expect(h.el.style.background).toBe('#2e9e8f');
		expect(h.show).toHaveBeenCalledTimes(2);
	});

	it('重复安装不重复包装，原显示方法仍只执行一次', () => {
		const h = harness();
		installNodeEditorAppearance(h.mindMap);
		installNodeEditorAppearance(h.mindMap);
		h.editor.showEditTextBox({ node: h.node });
		expect(h.show).toHaveBeenCalledTimes(1);
	});

	it('运行时缺少私有编辑方法时安全跳过', () => {
		expect(() => installNodeEditorAppearance({ renderer: {} } as MindMap)).not.toThrow();
	});

	it('没有 DOM 和样式合并器时回退到节点数据与宿主主题', () => {
		const node = { getData: () => ({ text: 'legacy' }) } as unknown as MindMapNode;
		expect(readNodeEditorAppearance(null, node)).toEqual({
			background: 'var(--background-primary)', color: 'var(--text-normal)', borderRadius: 6,
		});
	});
});
