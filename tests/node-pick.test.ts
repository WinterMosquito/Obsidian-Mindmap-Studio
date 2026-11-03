/**
 * 共享落点会话（`features/node-pick`）：联系的「点目标节点」与概要的
 * 「起点 → 终点」两步都跑在它上面。
 *
 * 这一层唯一的职责是**会话唯一性**与**取消收敛**，所以用例也只锁这两件事：
 * 谁能结束会话、结束后谁收不到回调、重建/重复进入怎么清。
 *
 * 断言口径：不用「有没有内部状态」的判断函数（那只是实现的影子），一律看
 * **下一次点击是否仍被消费**、**提示是否收起**——用户能观察到的就是这两样。
 */
import { describe, expect, it, vi } from 'vitest';
// 直接取桩模块（vitest 把 'obsidian' 别名到同一文件）：只有它带 `instances`
import { Notice } from './mocks/obsidian';
import type { MindMapNode } from '../src/core/engine-types';
import {
	cancelNodePick,
	handleNodePickClick,
	setupNodePick,
	startNodePick,
} from '../src/features/node-pick';
import type { ViewNodeEditContext } from '../src/features/view-context';

/** 引擎事件桩：记录注册的引擎监听，供用例手动触发 */
function makeHost(withEngine = true) {
	const handlers = new Map<string, (...args: unknown[]) => void>();
	const view = {
		mindMap: withEngine ? { on: () => undefined } : null,
		engineEvents: {
			onEngine: (_mindMap: unknown, name: string, cb: (...a: unknown[]) => void) => {
				handlers.set(name, cb);
			},
		},
	} as unknown as ViewNodeEditContext;
	return {
		view,
		fire: (name: string, ...args: unknown[]): void => handlers.get(name)?.(...args),
	};
}

const node = (text: string): MindMapNode => ({ getData: () => text }) as unknown as MindMapNode;

/** 每次断言前清空提示记录（同一进程里用例共享静态数组） */
function latestNotice(): Notice | undefined {
	return Notice.instances.at(-1);
}

describe('落点会话：进入 / 落点 / 结束', () => {
	it('未进入时：不消费点击，取消也无状态可清', () => {
		const { view } = makeHost();
		expect(handleNodePickClick(view, node('甲'))).toBe(false);
		expect(cancelNodePick(view)).toBe(false);
	});

	it('进入后点一下即结束（`done`）：拿到落点节点，且不再消费后续点击', () => {
		const { view } = makeHost();
		const onPick = vi.fn(() => 'done' as const);
		startNodePick(view, { hint: '点目标节点', onPick });

		expect(handleNodePickClick(view, node('甲'))).toBe(true);
		expect(onPick).toHaveBeenCalledTimes(1);
		// 会话已结束：第二次点击属于别人
		expect(handleNodePickClick(view, node('乙'))).toBe(false);
	});

	it('`continue` 保持会话（概要的两步就靠它）：可以连点两次', () => {
		const { view } = makeHost();
		const seen: string[] = [];
		startNodePick(view, {
			hint: '第一步',
			onPick: (picked) => {
				seen.push(picked.getData('text') as string);
				return 'continue';
			},
		});

		expect(handleNodePickClick(view, node('甲'))).toBe(true);
		// 第二次点击仍被消费 ⇒ 会话还活着
		expect(handleNodePickClick(view, node('乙'))).toBe(true);
		expect(seen).toEqual(['甲', '乙']);
		// 仍在模式里：取消真的取消到了东西
		expect(cancelNodePick(view)).toBe(true);
	});

	it('`done` 不触发 onCancel（那条路径由调用方自己往下推进）', () => {
		const { view } = makeHost();
		const onCancel = vi.fn();
		startNodePick(view, { hint: 'h', onPick: () => 'done', onCancel });

		handleNodePickClick(view, node('甲'));
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('取消（Esc / 点空白）：通知一次 onCancel，且幂等', () => {
		const { view } = makeHost();
		const onCancel = vi.fn();
		startNodePick(view, { hint: 'h', onPick: () => 'continue', onCancel });

		expect(cancelNodePick(view)).toBe(true);
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(cancelNodePick(view)).toBe(false);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});

describe('提示：进入即显示，结束即收起', () => {
	it('进入创建常驻提示（不自动消失），取消后收起', () => {
		const { view } = makeHost();
		startNodePick(view, { hint: '第一步', onPick: () => 'continue' });
		const notice = latestNotice();
		expect(notice?.message).toBe('第一步');
		expect(notice?.hidden).toBe(false);

		cancelNodePick(view);
		expect(notice?.hidden).toBe(true);
	});

	it('`done` 路径同样收起（提示不许留给下一条会话）', () => {
		const { view } = makeHost();
		startNodePick(view, { hint: 'h', onPick: () => 'done' });
		const notice = latestNotice();

		handleNodePickClick(view, node('甲'));
		expect(notice?.hidden).toBe(true);
	});
});

describe('会话唯一性与引擎重建', () => {
	it('重复进入顶掉旧会话：旧会话收到 onCancel，屏上只留最新提示', () => {
		const { view } = makeHost();
		const firstCancel = vi.fn();
		startNodePick(view, { hint: '旧', onPick: () => 'continue', onCancel: firstCancel });

		startNodePick(view, { hint: '新', onPick: () => 'continue' });

		expect(firstCancel).toHaveBeenCalledTimes(1);
		expect(latestNotice()?.message).toBe('新');
		expect(latestNotice()?.hidden).toBe(false);
	});

	it('注册 node_click / draw_click，并在重建时清掉残留会话', () => {
		const { view, fire } = makeHost();
		const onPick = vi.fn(() => 'done' as const);
		startNodePick(view, { hint: 'h', onPick });

		setupNodePick(view);
		// 重建即放弃：旧会话不再收点击（旧节点引用已随引擎失效）
		fire('node_click', node('甲'));
		expect(onPick).not.toHaveBeenCalled();

		// 重建后再进入，点击能从引擎事件走到会话里
		startNodePick(view, { hint: 'h', onPick });
		fire('node_click', node('甲'));
		expect(onPick).toHaveBeenCalledTimes(1);

		// 点画布空白＝取消：之后的节点点击不再进回调
		const afterDraw = vi.fn(() => 'done' as const);
		startNodePick(view, { hint: 'h', onPick: afterDraw });
		fire('draw_click');
		fire('node_click', node('乙'));
		expect(afterDraw).not.toHaveBeenCalled();
	});

	it('没有引擎时不注册监听（也不误清别处的状态）', () => {
		const { view, fire } = makeHost(false);
		setupNodePick(view);
		// 没有监听 ⇒ fire 什么都不做，也不抛错
		expect(() => fire('node_click', node('甲'))).not.toThrow();
	});
});
