/**
 * 引擎**离屏测量容器**的残渣清理（`engine/mindmap.clearMeasureResidue`）回归。
 *
 * 为什么必须有这一层：这处清理的收益全是**不可见**的（无障碍树少一个孤立
 * `role=checkbox`、全局查询不多算幽灵元素），跑图、截图、像素比对都不会红——
 * 被删掉也不会有任何功能症状，只有读屏用户会重新多遇到一个复选框。故用直测
 * 锁行为、用源码契约锁「注册还在」。
 *
 * 两件事分别锁：
 * ① `clearMeasureResidue` 的形态——清空内容 + 标 `aria-hidden`（后者才是把副本
 *    移出无障碍树的那一步，只清空内容不够：下一次测量又会填回去）；
 * ② `createMindMap` 内**确实注册**了 `node_tree_render_end` 回调——容器懒创建，
 *    创建时清不到，时机只能在渲染结束；漏注册则函数变死代码。
 *
 * vendor cjs 以 vi.mock 桩替代（与 engine-minimap-capture 同款）：本文件只验
 * 这两个纯形态，不需要真实引擎（也避免 Node 下引擎顶层求值触碰 document）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { clearMeasureResidue } from '../src/engine/mindmap';
import type { MindMap } from '../vendor/simple-mind-map.cjs';

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

const MINDMAP_SOURCE = readFileSync(
	new URL('../src/engine/mindmap.ts', import.meta.url),
	'utf8',
);

/**
 * 假容器：只带清理路径实际触碰的面（`textContent` / `childNodes` / 属性读写）。
 * `textContent` 的 setter 同时清空 `childNodes`——否则「已清空就不再写」无从断言。
 */
class FakeHost {
	readonly attrs = new Map<string, string>();
	childNodes: unknown[] = [];
	/** 写操作计数（属性写 + 内容写），用于断言幂等 */
	writes = 0;
	private text: string;

	constructor(content: string) {
		this.text = content;
		if (content) {
			this.childNodes = [{ nodeType: 3 }];
		}
	}

	get textContent(): string {
		return this.text;
	}

	set textContent(value: string) {
		this.writes++;
		this.text = value;
		this.childNodes = [];
	}

	setAttribute(name: string, value: string): void {
		this.writes++;
		this.attrs.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attrs.get(name) ?? null;
	}

	hasAttribute(name: string): boolean {
		return this.attrs.has(name);
	}
}

function fakeHost(content = '<span class="mindmap-node-task"></span>'): FakeHost {
	return new FakeHost(content);
}

/** 只带 `clearMeasureResidue` 实际读取的那一个字段（假宿主不是真 `Element`） */
function asMindMap(host: object): MindMap {
	return {
		commonCaches: { measureCustomNodeContentSizeEl: host },
	} as unknown as MindMap;
}

describe('clearMeasureResidue：隔离引擎的测量副本', () => {
	it('清空内容并戴上 aria-hidden 与 inert', () => {
		const host = fakeHost();
		clearMeasureResidue(asMindMap(host));
		expect(host.textContent).toBe('');
		expect(host.childNodes).toHaveLength(0);
		// 只清内容不够：下一次测量会把副本填回去（单节点 reRender 后残渣最长活到
		// 下一次整树渲染），这两个属性才是对**未来副本**的隔离
		expect(host.attrs.get('aria-hidden')).toBe('true');
		expect(host.attrs.has('inert')).toBe(true);
	});

	it('幂等：第二次调用不再产生任何写操作', () => {
		const host = fakeHost();
		const mindMap = asMindMap(host);
		clearMeasureResidue(mindMap);
		const afterFirst = host.writes;
		clearMeasureResidue(mindMap);
		expect(host.textContent).toBe('');
		expect(host.attrs.get('aria-hidden')).toBe('true');
		expect(host.attrs.get('inert')).toBe('');
		// 渲染结束是高频点：已是目标状态就一个写操作都不该有
		expect(host.writes).toBe(afterFirst);
	});

	it('容器缺失 / 空实例 / null 一律安全 no-op（未测量过、单测桩、已销毁）', () => {
		expect(() => clearMeasureResidue(null)).not.toThrow();
		expect(() => clearMeasureResidue({} as unknown as MindMap)).not.toThrow();
		expect(() =>
			clearMeasureResidue({ commonCaches: {} } as unknown as MindMap),
		).not.toThrow();
		expect(() =>
			clearMeasureResidue({
				commonCaches: { measureCustomNodeContentSizeEl: null },
			} as unknown as MindMap),
		).not.toThrow();
	});
});

describe('注册点：渲染结束时清理（源码契约）', () => {
	it('createMindMap 内挂在 node_tree_render_end 上', () => {
		// 容器懒创建 ⇒ 只能等渲染结束；注册必须在 createMindMap 内，视图与
		// 只读嵌入两个创建点才都被覆盖（勿挪到某个调用方）
		expect(MINDMAP_SOURCE).toContain(
			"mindMap.on('node_tree_render_end', () => clearMeasureResidue(mindMap));",
		);
	});
});
