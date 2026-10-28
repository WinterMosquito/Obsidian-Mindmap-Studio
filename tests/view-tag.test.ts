/**
 * 标签点击接管（`features/view-tag`）回归：画布 capture 命中 → 搜标签。
 *
 * 契约：
 * - 命中 `a.tag[data-tag]` 才拦（preventDefault + stopPropagation），否则放行；
 * - 名称取 `data-tag`（不带 `#`），语言取宿主语言；
 * - 跨 realm：目标只按 `closest` 能力判定，不用 `instanceof`。
 *
 * 平台侧（`platform/tag-search`）整体 mock：本文件只验「谁被调用」，
 * 私有触点的防御式行为由 tag-search.test.ts 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openTagSearch = vi.hoisted(() => vi.fn());

vi.mock('../src/platform/tag-search', () => ({ openTagSearch }));

import { registerTagClicks } from '../src/features/view-tag';

interface Listeners {
	click?: (event: unknown) => void;
}

function setup() {
	const listeners: Listeners = {};
	const events = {
		onDom: (_target: unknown, type: string, handler: (event: unknown) => void) => {
			listeners[type as keyof Listeners] = handler;
		},
	};
	const app = { name: 'app' };
	registerTagClicks(events as never, {} as HTMLElement, app as never, 'en');
	return { listeners, app };
}

function clickOn(target: unknown) {
	return {
		target,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
}

describe('registerTagClicks', () => {
	beforeEach(() => {
		openTagSearch.mockClear();
	});

	it('命中标签：拦下事件并用 data-tag 搜索', () => {
		const { listeners, app } = setup();
		const tag = { getAttribute: (name: string) => (name === 'data-tag' ? '项目' : null) };
		const event = clickOn({ closest: () => tag });
		listeners.click!(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
		expect(openTagSearch).toHaveBeenCalledWith(app, '项目', 'en');
	});

	it('未命中标签：不拦，交回引擎', () => {
		const { listeners } = setup();
		const event = clickOn({ closest: () => null });
		listeners.click!(event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(openTagSearch).not.toHaveBeenCalled();
	});

	it('目标没有 closest 能力（非元素）：安全跳过', () => {
		const { listeners } = setup();
		const event = clickOn({});
		expect(() => listeners.click!(event)).not.toThrow();
		expect(openTagSearch).not.toHaveBeenCalled();
	});
});
