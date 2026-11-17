/** 共享写回管线直测：真实 Markdown 解析/序列化，按一次批量提交检查历史与保存。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRawNodeContent, applyRawNodeContents } from '../src/features/node-content-write';
import { composeNodeContent } from '../src/markdown/md-serialize';
import type { MdNodeData } from '../src/core/node-data';
import type { MindMap, MindMapNode } from '../src/core/engine-types';
import type { ViewNodeEditContext } from '../src/features/view-context';

const mocks = vi.hoisted(() => ({ layout: vi.fn(), history: vi.fn() }));
vi.mock('../src/engine/mindmap', () => ({ markNodeNeedLayout: mocks.layout, recordHistory: mocks.history }));

function fixture() {
	const calls: string[] = [];
	const render = vi.fn(() => calls.push('render'));
	const mindMap = { render } as unknown as MindMap;
	const view = {
		mindMap, app: null,
		scheduleSave: vi.fn(() => calls.push('save')),
		notifyNodeContentCommitted: vi.fn(() => calls.push('notify')),
	} as unknown as ViewNodeEditContext;
	mocks.layout.mockImplementation(() => calls.push('layout'));
	mocks.history.mockImplementation(() => calls.push('history'));
	const data: MdNodeData = { text: '旧文本', mdType: 'list', mdLevel: 2, mdRaw: '旧文本' };
	const node = { getData: () => data } as unknown as MindMapNode;
	return { view, data, node, render, calls };
}

beforeEach(() => vi.resetAllMocks());

describe('共享节点原文写回', () => {
	it('多节点真实原文批量落地，只渲染/保存/记历史一次，通知在它们之后', () => {
		const h = fixture();
		const second: MdNodeData = { text: '第二条', mdType: 'heading', mdLevel: 3 };
		const secondNode = { getData: () => second } as unknown as MindMapNode;
		const raws = ['见 [[笔记|名字]] 与 **重点**  ', 'React / : ? 技术体系'];
		applyRawNodeContents(h.view, [{ node: h.node, raw: raws[0]! }, { node: secondNode, raw: raws[1]! }]);
		expect(composeNodeContent(h.data, null)).toBe(raws[0]);
		expect(composeNodeContent(second, null)).toBe(raws[1]);
		expect(h.data.mdLevel).toBe(2);
		expect(second.mdLevel).toBe(3);
		expect(h.calls).toEqual(['layout', 'layout', 'render', 'save', 'history', 'notify', 'notify']);
		expect(h.render).toHaveBeenCalledTimes(1);
		expect(mocks.history).toHaveBeenCalledWith(h.view.mindMap);
	});

	it('afterCommit:false 保留一次历史与保存，避免任务勾选触发结构编排', () => {
		const h = fixture();
		applyRawNodeContent(h.view, h.node, '[x] 完成任务', { afterCommit: false });
		expect(h.data.mdTask).toBe('done');
		expect(composeNodeContent(h.data, null)).toBe('[x] 完成任务');
		expect(h.calls).toEqual(['layout', 'render', 'save', 'history']);
	});

	it('空批次不排渲染、保存或历史', () => {
		const h = fixture();
		applyRawNodeContents(h.view, []);
		expect(h.calls).toEqual([]);
		expect(h.data.text).toBe('旧文本');
	});
});
