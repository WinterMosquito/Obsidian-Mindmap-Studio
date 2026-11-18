/** K216：手势判据直测；真实 Event/View/Select 互斥链由 Chrome 门禁覆盖。 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import { canvasDragAction } from '../../vendor/patches/canvas-drag.js';
import { applyCanvasDragMode } from '../../src/engine/mindmap';

vi.hoisted(() => { (globalThis as { document?: unknown }).document ??= { documentElement: {} }; });
const { Drag } = createRequire(import.meta.url)('../../vendor/simple-mind-map.cjs') as {
	Drag: { prototype: { onNodeMousedown(node: unknown, event: unknown): void } };
};

describe('画布手势判据', () => {
	it.each([true, false])('两种模式 %s：plain 与 Meta/Ctrl 左拖互斥，中键与右键不竞争', enabled => {
		for (const modifier of [{ ctrlKey: false, metaKey: false }, { ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }, { ctrlKey: true, metaKey: true }]) {
			const modified = modifier.ctrlKey || modifier.metaKey;
			expect(canvasDragAction(enabled, { which: 1, ...modifier })).toBe(modified === enabled ? 'pan' : 'select');
			expect(canvasDragAction(enabled, { which: 2, ...modifier })).toBe('pan');
			expect(canvasDragAction(enabled, { which: 3, ...modifier })).toBe('select');
		}
	});
	it('未指定补丁配置时保留上游开关语义，未知鼠标键不建立手势', () => {
		expect(canvasDragAction(undefined, { which: 1, ctrlKey: false, metaKey: false })).toBeUndefined();
		expect(canvasDragAction(true, { which: 4, ctrlKey: false, metaKey: false })).toBeNull();
	});
	it('运行时更新不访问树、历史、视口或保存；重复值及空引擎不更新', () => {
		const updateConfig = vi.fn();
		const map = { opt: { dragCanvasWithModifier: true }, updateConfig } as unknown as MindMap;
		applyCanvasDragMode(map, false);
		expect(updateConfig).toHaveBeenCalledExactlyOnceWith({ dragCanvasWithModifier: false });
		applyCanvasDragMode(map, true);
		applyCanvasDragMode(null, false);
		expect(updateConfig).toHaveBeenCalledOnce();
	});
	it.each(['ctrlKey', 'metaKey'] as const)('热键模式从节点起手 %s 不建立结构 Drag，关闭时保持原生节点 Drag', modifier => {
		const map = { opt: { dragCanvasWithModifier: true }, toPos: vi.fn(() => ({ x: 1, y: 2 })) };
		const drag = Object.assign(Object.create(Drag.prototype) as { isMousedown: boolean; onNodeMousedown(node: unknown, event: unknown): void }, { mindMap: map, isMousedown: false });
		const event = { which: 1, ctrlKey: false, metaKey: false, [modifier]: true };
		drag.onNodeMousedown({}, event);
		expect(drag.isMousedown).toBe(false);
		map.opt.dragCanvasWithModifier = false;
		drag.onNodeMousedown({}, event);
		expect(drag.isMousedown).toBe(true);
	});
});
