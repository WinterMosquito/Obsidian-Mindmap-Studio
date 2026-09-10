/**
 * view-status 回归测试：状态栏节点计数的节流语义与视图关闭清理。
 *
 * 断言对象是模块自身的调度决策（何时计数、何时清空、何时被取消），
 * 而不是 mock 的调用次数本身：
 * - 状态栏设置关闭时零开销（不节流、不遍历整棵树）；
 * - 引擎缺失 / 计数抛错 → 清空状态栏而非崩溃（降级路径）；
 * - 高频 data_change 下只算一次 + 窗口结束后恰好补一次尾随（拿最新值，
 *   不复用第一次的结果）；
 * - trailingResetsWindow：尾随执行即「最新状态已展示」，下一次调用立即可见；
 * - 视图关闭（cancelStatusBarUpdate）后不再有尾随刷新落到已销毁视图。
 *
 * 计数与渲染根都来自 mindmap.ts 防腐层（本测试不验证引擎封装），
 * 故用 vi.mock 提供假引擎面：countTreeNodes / getRenderRoot。
 *
 * 末段另直接单测插件层实现 src/status-bar.ts（ElementStatusBarService）：
 * 计数文案（中文「N 个节点」/英文单复数分键）与元素生命周期（惰性取值、
 * onunload 置空后静默跳过），这一层被上面的用例以桩服务替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import type { Language } from '../src/i18n';
import { ElementStatusBarService } from '../src/status-bar';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	cancelStatusBarUpdate,
	updateStatusBar,
} from '../src/features/view-status';

const { countTreeNodesMock, getRenderRootMock } = vi.hoisted(() => ({
	countTreeNodesMock: vi.fn<(root: unknown) => number>(),
	getRenderRootMock: vi.fn<(mindMap: unknown) => unknown>(),
}));

vi.mock('../src/mindmap', () => ({
	countTreeNodes: countTreeNodesMock,
	getRenderRoot: getRenderRootMock,
}));

/** 节流窗口（与 src/features/view-status.ts 的 STATUS_BAR_THROTTLE_MS 一致） */
const THROTTLE_MS = 300;

/** fake timers 的起点：设为真实纪元毫秒，使节流器 lastRunAt=0 的首调用语义与运行时一致 */
const EPOCH_START_MS = 1_700_000_000_000;

interface Harness {
	readonly view: MindMapViewContext;
	readonly statusBar: {
		available: boolean;
		clear: ReturnType<typeof vi.fn>;
		showNodeCount: ReturnType<typeof vi.fn>;
	};
}

/**
 * 构造状态栏子系统所需的最窄视图桩。
 * 每个用例都新建视图对象：节流器按视图存在 WeakMap 里（按视图隔离状态）。
 */
function makeView(
	options: { mindMap?: MindMap | null; available?: boolean } = {},
): Harness {
	const statusBar = {
		available: options.available ?? true,
		clear: vi.fn(),
		showNodeCount: vi.fn(),
	};
	const view = {
		mindMap: options.mindMap === undefined ? ({} as MindMap) : options.mindMap,
		plugin: { statusBar },
	} as unknown as MindMapViewContext;
	return { view, statusBar };
}

/** 模拟引擎在视图存活期间被替换/销毁（renderer 收口后 getRenderRoot 为 null） */
function destroyEngine(view: MindMapViewContext): void {
	(view as unknown as { mindMap: MindMap | null }).mindMap = null;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(EPOCH_START_MS);
	countTreeNodesMock.mockReset();
	getRenderRootMock.mockReset();
	// getRenderRoot 默认返回一个「非空渲染根」，计数由 countTreeNodes 假实现决定
	getRenderRootMock.mockReturnValue({});
});

afterEach(() => {
	// 必须还原真实定时器：否则用例间会互相串扰（假时钟残留）
	vi.useRealTimers();
});

describe('updateStatusBar（节流与降级）', () => {
	it('状态栏不可用（设置关闭）：不节流、不遍历计数', () => {
		const { view, statusBar } = makeView({ available: false });
		updateStatusBar(view);
		vi.advanceTimersByTime(THROTTLE_MS * 3);

		// 零开销路径：连渲染根都不取
		expect(getRenderRootMock).not.toHaveBeenCalled();
		expect(countTreeNodesMock).not.toHaveBeenCalled();
		expect(statusBar.showNodeCount).not.toHaveBeenCalled();
		expect(statusBar.clear).not.toHaveBeenCalled();
	});

	it('引擎实例缺失：立即清空状态栏，不计数', () => {
		const { view, statusBar } = makeView({ mindMap: null });
		updateStatusBar(view);

		// 同步清空（不排尾随：没有可刷新的内容）
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(countTreeNodesMock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(THROTTLE_MS * 2);
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
	});

	it('首次调用立即计数并展示（不被节流窗口推迟）', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(7);

		updateStatusBar(view);

		// 同步断言：不推进时间就已经展示，说明是「立即执行」而非尾随
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledWith(7);
	});

	it('窗口内连续三次：只排一次尾随，尾随按 299ms 边界补一次并取最新值', () => {
		const { view, statusBar } = makeView();
		// 首次 1，尾随执行时重新计数得 42（证明不是复用第一次的结果）
		countTreeNodesMock.mockReturnValueOnce(1).mockReturnValueOnce(42);

		updateStatusBar(view); // t=0 立即执行
		vi.advanceTimersByTime(100); // t=100
		updateStatusBar(view); // 窗口内 → 排尾随（窗口余量 200ms）
		updateStatusBar(view); // 窗口内 → 合并进同一个尾随，不重复排期

		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(1);

		// 尾随在「本窗口末」触发：199ms 仍不触发，第 200ms 恰好触发一次
		vi.advanceTimersByTime(199);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(2);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(2);
		expect(statusBar.showNodeCount).toHaveBeenNthCalledWith(1, 1);
		expect(statusBar.showNodeCount).toHaveBeenNthCalledWith(2, 42);

		// 尾随已落地：再推进也不会有第二次尾随
		vi.advanceTimersByTime(THROTTLE_MS * 2);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(2);
	});

	it('尾随执行后窗口重置：下一次调用立即可见（不必再等一个窗口）', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(1);

		updateStatusBar(view); // 立即
		updateStatusBar(view); // 排尾随
		vi.advanceTimersByTime(THROTTLE_MS);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(2);

		// trailingResetsWindow=true：尾随已经展示了最新状态 → 窗口归零
		updateStatusBar(view);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(3);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(3);
	});

	it('不同视图各自独立节流（节流器按视图持有）', () => {
		const first = makeView();
		const second = makeView();
		countTreeNodesMock.mockReturnValue(2);

		// 两个视图在同一时刻各自立即执行：互不占用对方的窗口
		updateStatusBar(first.view);
		updateStatusBar(second.view);
		expect(first.statusBar.showNodeCount).toHaveBeenCalledWith(2);
		expect(second.statusBar.showNodeCount).toHaveBeenCalledWith(2);

		// 各自进入窗口后都只排尾随：一方被节流不会顺带压住另一方
		updateStatusBar(first.view);
		updateStatusBar(second.view);
		expect(first.statusBar.showNodeCount).toHaveBeenCalledTimes(1);
		expect(second.statusBar.showNodeCount).toHaveBeenCalledTimes(1);

		// 两个视图的尾随各自补齐
		vi.advanceTimersByTime(THROTTLE_MS);
		expect(first.statusBar.showNodeCount).toHaveBeenCalledTimes(2);
		expect(second.statusBar.showNodeCount).toHaveBeenCalledTimes(2);
	});

	it('尾随触发时引擎已被销毁：清空状态栏，不触碰已销毁实例', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(3);

		updateStatusBar(view); // 立即 → 3
		updateStatusBar(view); // 排尾随
		destroyEngine(view); // 尾随落地前引擎被销毁（视图刷新）
		vi.advanceTimersByTime(THROTTLE_MS);

		// 回调内重查 mindMap：改为清空，且不再遍历（countTreeNodes 仍只被调一次）
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(1);
		expect(getRenderRootMock).toHaveBeenCalledTimes(1);
	});

	it('计数抛错：清空状态栏且异常不外抛', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockImplementation(() => {
			throw new Error('引擎内部状态异常');
		});

		expect(() => updateStatusBar(view)).not.toThrow();
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).not.toHaveBeenCalled();
	});

	it('尾随执行期间抛错：同样降级为清空，不冒泡到定时器回调', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValueOnce(5).mockImplementation(() => {
			throw new Error('尾随执行时引擎异常');
		});

		updateStatusBar(view); // 立即 → 5
		updateStatusBar(view); // 排尾随
		expect(statusBar.showNodeCount).toHaveBeenCalledWith(5);

		// 若异常逃逸，advanceTimersByTime 会直接把错误抛进用例
		expect(() => vi.advanceTimersByTime(THROTTLE_MS)).not.toThrow();
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(1);
	});
});

describe('cancelStatusBarUpdate（视图关闭清理）', () => {
	it('取消未决尾随：关闭后不再有刷新落到已销毁视图', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(5);

		updateStatusBar(view); // 立即执行 → 1 次展示
		updateStatusBar(view); // 排尾随
		cancelStatusBarUpdate(view); // onClose 清理

		vi.advanceTimersByTime(THROTTLE_MS * 2);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(1);
		expect(statusBar.clear).not.toHaveBeenCalled();
	});

	it('从未调用过 updateStatusBar 时取消安全（onClose 路径不抛异常）', () => {
		const { view } = makeView();
		expect(() => cancelStatusBarUpdate(view)).not.toThrow();
	});

	it('取消只清尾随、不破坏节流器：视图复用后再次更新仍能立即展示', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(4);

		updateStatusBar(view); // 立即
		cancelStatusBarUpdate(view); // 无未决尾随也安全
		vi.advanceTimersByTime(THROTTLE_MS);

		updateStatusBar(view); // 窗口已过 → 立即执行
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(2);
		expect(statusBar.showNodeCount).toHaveBeenLastCalledWith(4);
	});
});

describe('ElementStatusBarService（状态栏计数文案与惰性元素）', () => {
	/** 状态栏元素桩：只记录被写入的文本（服务只用 setText 这一个能力） */
	class FakeStatusEl {
		readonly texts: string[] = [];

		setText(text: string): void {
			this.texts.push(text);
		}
	}

	/** 建服务：元素与语言都经闭包惰性取值，与插件层装配方式一致 */
	function makeService(
		getElement: () => FakeStatusEl | null,
		getLanguage: () => Language,
	): ElementStatusBarService {
		return new ElementStatusBarService(
			() => getElement() as unknown as HTMLElement | null,
			getLanguage,
		);
	}

	it('available 惰性反映元素是否存在（onunload 置空后变 false）', () => {
		const el = new FakeStatusEl();
		let holder: FakeStatusEl | null = null;
		const service = makeService(() => holder, () => 'zh');

		// 服务先于元素创建：构造期不得快照 null，否则状态栏永远不可用
		expect(service.available).toBe(false);
		holder = el;
		expect(service.available).toBe(true);

		holder = null; // onunload 置空
		expect(service.available).toBe(false);
	});

	it('中文：单复数同文，写入「N 个节点」', () => {
		const el = new FakeStatusEl();
		const service = makeService(() => el, () => 'zh');

		service.showNodeCount(1);
		service.showNodeCount(42);
		expect(el.texts).toEqual(['1 个节点', '42 个节点']);
	});

	it('英文：按单复数分键（1 node / 3 nodes）', () => {
		const el = new FakeStatusEl();
		const service = makeService(() => el, () => 'en');

		service.showNodeCount(1);
		service.showNodeCount(3);
		service.showNodeCount(0); // 0 走复数键
		expect(el.texts).toEqual(['1 node', '3 nodes', '0 nodes']);
	});

	it('语言切换后就地按新语言格式化（语言也是惰性取值）', () => {
		const el = new FakeStatusEl();
		let lang: Language = 'zh';
		const service = makeService(() => el, () => lang);

		service.showNodeCount(1);
		lang = 'en'; // 切换语言后无需重建服务
		service.showNodeCount(1);
		expect(el.texts).toEqual(['1 个节点', '1 node']);
	});

	it('元素缺失时展示与清空都静默跳过（不抛错、不残留）', () => {
		const service = makeService(() => null, () => 'zh');

		expect(() => service.showNodeCount(7)).not.toThrow();
		expect(() => service.clear()).not.toThrow();
	});

	it('清空写入空串（残留计数不会留在状态栏上）', () => {
		const el = new FakeStatusEl();
		const service = makeService(() => el, () => 'zh');

		service.showNodeCount(2);
		service.clear();
		expect(el.texts).toEqual(['2 个节点', '']);
	});
});
