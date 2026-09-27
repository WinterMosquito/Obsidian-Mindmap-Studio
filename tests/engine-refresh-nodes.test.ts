/**
 * 批量自绘重建（engine/mindmap.refreshNodesCustomContent）单元回归。
 *
 * 背景（P4 尺寸同步，2026-09-27）：MathJax 替换是异步的，引擎的离屏测量是
 * 同步的——替换定稿后必须重建该节点内容，让引擎按**真实产物**重新测宽测高。
 * 多段同时定稿时若逐个走 `refreshNodeCustomContent`，会各触发一次**全树**
 * `render()`；本函数保证 N 个节点 1 次重排。
 *
 * 断言口径：逐节点 `reRender(['custom'], {ignoreUpdateCustomTextWidth:true})`
 * ＋ **恰好一次** `mindMap.render()`；异常不中断、不吞掉其它节点。
 */
import { describe, expect, it, vi } from 'vitest';
import { refreshNodesCustomContent } from '../src/engine/mindmap';

// vendor cjs 以 vi.mock 桩替代真实模块（同 engine-history-limit.test.ts）：
// 本文件只验纯函数，不需要真实引擎；真实模块在 Node 下顶层求值会触碰 document。
vi.mock('../vendor/simple-mind-map.cjs', () => ({
	MindMap: class {},
	MindMapNode: class {},
	DoExport: class {},
	Select: class {},
	TouchEvent: class {},
	AssociativeLine: class {},
	KeyboardNavigation: class {},
	Search: class {},
	Drag: class {},
}));

/** 节点桩：只实现本函数访问的 `reRender` */
interface FakeNode {
	reRender: ReturnType<typeof vi.fn>;
}

function fakeNode(): FakeNode {
	return { reRender: vi.fn() };
}

describe('refreshNodesCustomContent（P4 批量重排）', () => {
	it('每个节点重建一次、全树 render 恰好一次', () => {
		const nodes = [fakeNode(), fakeNode(), fakeNode()];
		const render = vi.fn();

		refreshNodesCustomContent({ render } as never, nodes as never);

		for (const node of nodes) {
			expect(node.reRender).toHaveBeenCalledTimes(1);
			expect(node.reRender).toHaveBeenCalledWith(['custom'], {
				ignoreUpdateCustomTextWidth: true,
			});
		}
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('mindMap 为空 / 节点列表为空：安全 no-op', () => {
		const render = vi.fn();
		expect(() => refreshNodesCustomContent(null, [])).not.toThrow();
		expect(() =>
			refreshNodesCustomContent(null, [fakeNode() as never]),
		).not.toThrow();
		expect(render).not.toHaveBeenCalled();
	});

	it('单节点 reRender 抛错：不中断其它节点，render 仍执行', () => {
		const bad: FakeNode = {
			reRender: vi.fn(() => {
				throw new Error('boom');
			}),
		};
		const good = fakeNode();
		const render = vi.fn();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		refreshNodesCustomContent({ render } as never, [bad, good] as never);

		expect(good.reRender).toHaveBeenCalledTimes(1);
		expect(render).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it('节点缺 reRender（预测量代理对象形态）：显式告警一次、跳过该节点、不影响其它节点（K88）', () => {
		// 事故形态：调用方误传 vendor 预测量路径的轻量代理（只有 nodeData/getData）
		// ——旧实现的可选链 `reRender?.()` 会静默 no-op，尺寸永不同步
		const proxyLike = { nodeData: {}, getData: vi.fn() };
		const good = fakeNode();
		const render = vi.fn();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		refreshNodesCustomContent({ render } as never, [
			proxyLike,
			good,
		] as never);

		expect(good.reRender).toHaveBeenCalledTimes(1);
		expect(render).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});
});
