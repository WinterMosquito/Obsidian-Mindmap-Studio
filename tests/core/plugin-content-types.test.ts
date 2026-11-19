import { describe, expect, it } from 'vitest';
import { isPluginContentTarget, PLUGIN_LIVE_CLASS } from '../../src/core/plugin-content-types';

describe('插件活动组件事件归属', () => {
	it('空目标与普通画布事件留给导图', () => {
		expect(isPluginContentTarget(null)).toBe(false);
		expect(isPluginContentTarget(new EventTarget())).toBe(false);
		const ordinary = { closest: () => null } as unknown as EventTarget;
		expect(isPluginContentTarget(ordinary)).toBe(false);
	});
	it('使用元素能力判定，独立窗口中的控件不依赖本窗口 instanceof', () => {
		const queried: string[] = [];
		const foreign = { closest: (selector: string) => {
			queried.push(selector); return {};
		} } as unknown as EventTarget;
		expect(isPluginContentTarget(foreign)).toBe(true);
		expect(queried).toEqual([`.${PLUGIN_LIVE_CLASS}`]);
	});
});
