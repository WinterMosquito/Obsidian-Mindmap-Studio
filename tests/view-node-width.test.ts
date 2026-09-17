/**
 * 节点宽度收尾回归（features/view-node-width.ts）。
 *
 * 为什么钉死这一条：自绘（富）节点的宽高**全部来自内容元素的离屏测宽**，而引擎
 * 「拖左右边框改宽」结束时只 `setData({ customTextWidth })` + `render()`，
 * **不会**重建自绘内容（vendor `createNodeData`：只有 keys 含 'custom' 才重调
 * `customCreateNodeContent`）。不补这一步，元素仍在旧宽度下折行 → 节点高度不随
 * 宽度变化（2026-09-16 用户实测缺陷）。本文件只验证「何时重建、传哪个节点」，
 * 尺寸几何由 `npm run verify:visual` 的 inline 探针实测。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	gateNodeWidthHandles,
	setupNodeWidthRefresh,
} from '../src/features/view-node-width';

const mocks = vi.hoisted(() => ({
	refreshNodeCustomContent: vi.fn<
		(mindMap: unknown, node: unknown) => void
	>(),
}));

vi.mock('../src/engine/mindmap', () => ({
	refreshNodeCustomContent: mocks.refreshNodeCustomContent,
}));

interface EngineRegistration {
	event: string;
	listener: (...args: unknown[]) => void;
}

/** 视图桩：mindMap + 记录型的引擎事件绑定器 */
function makeView(mindMap: unknown) {
	const registrations: EngineRegistration[] = [];
	const view = {
		mindMap,
		engineEvents: {
			onEngine: (
				_engine: unknown,
				event: string,
				listener: (...args: unknown[]) => void,
			) => {
				registrations.push({ event, listener });
			},
		} as unknown,
	} as unknown as MindMapViewContext;
	return { view, registrations };
}

const node = {} as MindMapNode;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('setupNodeWidthRefresh（拖宽结束 → 重建自绘内容）', () => {
	it('订阅 dragModifyNodeWidthEnd，并把事件带来的节点传给重建入口', () => {
		const mindMap = { id: 'mm' };
		const { view, registrations } = makeView(mindMap);

		setupNodeWidthRefresh(view);

		expect(registrations.map((entry) => entry.event)).toEqual([
			'dragModifyNodeWidthEnd',
		]);

		registrations[0]!.listener(node);
		expect(mocks.refreshNodeCustomContent).toHaveBeenCalledTimes(1);
		expect(mocks.refreshNodeCustomContent).toHaveBeenCalledWith(mindMap, node);
	});

	it('事件未带节点（异常形态）：不重建、不抛错', () => {
		const { view, registrations } = makeView({ id: 'mm' });

		setupNodeWidthRefresh(view);

		expect(() => registrations[0]!.listener()).not.toThrow();
		expect(mocks.refreshNodeCustomContent).not.toHaveBeenCalled();
	});

	it('引擎缺失（mindMap 为 null）：不订阅（无处可重建）', () => {
		const { view, registrations } = makeView(null);

		expect(() => setupNodeWidthRefresh(view)).not.toThrow();
		expect(registrations).toHaveLength(0);
	});
});

/**
 * 手柄门禁：引擎只看**全局开关**（本插件恒开）⇒ 纯文本节点上也有左右边框手柄，
 * 但引擎的 SVG 文本路径不认 `customTextWidth`（拖了没反应，用户实测 2026-09-16）。
 * 门禁把判定收窄成「该节点会被自绘接管」，与 `buildInlineNodeContent` 同一来源。
 */
describe('gateNodeWidthHandles（每节点手柄门禁）', () => {
	/**
	 * 引擎 Node 桩：`checkEnableDragModifyNodeWidth` 按引擎原样返回
	 * **真值但非 `true`**（引擎实现是 `开关 && (richText || (自绘开 && 回调))`
	 * ——最后落到的就是回调函数本身）。门禁必须按真值判断，写 `=== true` 会让
	 * 所有节点都被判成「无手柄」（拖宽整体失效，无头实测踩过）。
	 */
	class FakeNode {
		constructor(private readonly data: Record<string, unknown>) {}

		getData(key?: string): unknown {
			return key === undefined ? this.data : this.data[key];
		}

		checkEnableDragModifyNodeWidth(): unknown {
			return () => null;
		}
	}

	const asNode = (node: FakeNode): MindMapNode => node as unknown as MindMapNode;

	it('纯文本节点：门禁后手柄不可用（死手柄不再出现在画布上）', () => {
		const node = new FakeNode({ text: 'Plain', mdRaw: 'Plain' });
		expect(
			node.checkEnableDragModifyNodeWidth(),
			'前置：引擎门禁真值（函数本身，非布尔 true）',
		).toBeTruthy();

		gateNodeWidthHandles(asNode(node));

		expect(node.checkEnableDragModifyNodeWidth()).toBe(false);
	});

	it('自绘节点（含链接/轻标记/超长）：手柄照旧可用（拖宽确实生效）', () => {
		for (const data of [
			// 未编辑形态：text === mdDerivedText ⇒ 渲染源取 mdRaw（含链接语法）
			{ text: '见 笔记A', mdDerivedText: '见 笔记A', mdRaw: '见 [[笔记A]]' },
			{ text: '重点', mdDerivedText: '重点', mdRaw: '**重点**' },
			{
				text: 'L'.repeat(2001),
				mdDerivedText: 'L'.repeat(2001),
				mdRaw: 'L'.repeat(2001),
			},
		]) {
			const node = new FakeNode(data);
			gateNodeWidthHandles(asNode(node));
			expect(node.checkEnableDragModifyNodeWidth(), JSON.stringify(data).slice(0, 40)).toBe(
				true,
			);
		}
	});

	it('含图节点：手柄不可用（图片由引擎图片通道渲染，自绘不接管）', () => {
		const node = new FakeNode({
			text: '见图',
			mdRaw: '见图 ![[a.png]] 与 [[B]]',
			image: 'a.png',
		});

		gateNodeWidthHandles(asNode(node));

		expect(node.checkEnableDragModifyNodeWidth()).toBe(false);
	});

	it('幂等：重复安装只包一层（原始门禁不被叠包）', () => {
		const node = new FakeNode({ text: 'Plain' });
		const proto = Object.getPrototypeOf(node) as {
			checkEnableDragModifyNodeWidth: () => boolean;
		};

		gateNodeWidthHandles(asNode(node));
		const wrapped = proto.checkEnableDragModifyNodeWidth;
		gateNodeWidthHandles(asNode(node));

		expect(proto.checkEnableDragModifyNodeWidth).toBe(wrapped);
	});

	it('原型没有该门禁（引擎形态变化）：静默跳过，不抛错', () => {
		const bare = { getData: () => ({ text: 'x' }) } as unknown as MindMapNode;

		expect(() => gateNodeWidthHandles(bare)).not.toThrow();
	});
});
