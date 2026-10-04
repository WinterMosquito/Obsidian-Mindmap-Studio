/**
 * 节点内联编辑器回归（features/node-inline-editor）。
 *
 * 覆盖：
 * - `resolveInlineEditKey` 纯函数判定表（2026-09-28 裁决）：`Enter`/`Mod+Enter`/
 *   `Tab`/`Escape` = 提交（Esc 为「停止并保留」）；`Shift+Enter` = 换行；
 *   `Alt+Enter` 与其他键 = 让位；
 * - 会话生命周期：打开 → `isInlineNodeEditing` 为真；提交（**有改动才写回**，
 *   未改动不写盘，对齐弹窗原文模式）；点击编辑器外（document mousedown）与
 *   画布滚轮（引擎 mousewheel）提交；`closeInlineEditor` 幂等；
 * - 引擎重建守卫：会话所属引擎与视图当前引擎不一致时不写回（重建路径已提前提交）；
 * - `isAnyNodeEditing` = 引擎编辑框 ∨ 内联编辑（快捷键/自动拆分/重命名的统一判据）。
 *
 * 隔离策略（与 tests/node-codeblock.test.ts 同款）：引擎面（getNodeGroupEl /
 * isEditingText / markNodeNeedLayout）、序列化与写回（composeNodeContent /
 * applyRawToNode）、图片面（images-path）全部 mock 为 spy；DOM 用最小桩
 * （body.createEl 造元素并记录、事件按需触发）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { ViewNodeEditContext } from '../src/features/view-context';

const {
	getNodeGroupElMock,
	isEditingTextMock,
	markNodeNeedLayoutMock,
	applyRawToNodeMock,
	walkImageSizeCorrectionsMock,
	resolveImagePathMock,
	ensureDefaultImageSizesMock,
} = vi.hoisted(() => ({
	getNodeGroupElMock: vi.fn(),
	isEditingTextMock: vi.fn(() => false),
	markNodeNeedLayoutMock: vi.fn(),
	applyRawToNodeMock: vi.fn(
		(data: Record<string, unknown>, raw: string): void => {
			data.text = raw;
		},
	),
	// 默认 resolve；用例按需 mockRejectedValueOnce 注入探测失败
	walkImageSizeCorrectionsMock: vi.fn(() => Promise.resolve()),
	resolveImagePathMock: vi.fn((path: string) => path),
	ensureDefaultImageSizesMock: vi.fn(),
}));

vi.mock('../src/engine/mindmap', () => ({
	getNodeGroupEl: getNodeGroupElMock,
	isEditingText: isEditingTextMock,
	markNodeNeedLayout: markNodeNeedLayoutMock,
}));

vi.mock('../src/markdown/md-serialize', () => ({
	composeNodeContent: vi.fn(() => 'RAW 原文'),
}));

vi.mock('../src/markdown/md-line-write', () => ({
	applyRawToNode: applyRawToNodeMock,
}));

vi.mock('../src/media/images-path', () => ({
	ensureDefaultImageSizes: ensureDefaultImageSizesMock,
	resolveImagePath: resolveImagePathMock,
	walkImageSizeCorrections: walkImageSizeCorrectionsMock,
}));

import {
	applyRawNodeContent,
	closeInlineEditor,
	isAnyNodeEditing,
	isInlineNodeEditing,
	openNodeInlineEditor,
	resolveInlineEditKey,
} from '../src/features/node-inline-editor';

/* —— 最小 DOM 桩 —— */

interface ElStub {
	style: Record<string, string>;
	value: string;
	/** 所属文档（提交时焦点归还 body、元素移除后解绑 document 监听用） */
	ownerDocument: unknown;
	remove: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
	setSelectionRange: ReturnType<typeof vi.fn>;
	contains: (node: unknown) => boolean;
	addEventListener: (type: string, handler: (event: unknown) => void) => void;
	/** 测试辅助：触发指定类型的已登记处理器 */
	fire: (type: string, event: unknown) => void;
}

interface DocStub {
	body: {
		createEl: (tag: string, options?: unknown) => ElStub;
		focus: ReturnType<typeof vi.fn>;
	};
	addEventListener: (
		type: string,
		handler: (event: unknown) => void,
		capture?: boolean,
	) => void;
	removeEventListener: (type: string, handler: (event: unknown) => void) => void;
	/** 测试辅助：触发 document 级监听（如 capture mousedown） */
	fireDoc: (type: string, event: unknown) => void;
	/** 创建记录（tag/options/元素本体） */
	created: { tag: string; options: unknown; el: ElStub }[];
}

function makeElStub(): ElStub {
	const handlers = new Map<string, ((event: unknown) => void)[]>();
	const el: ElStub = {
		style: {},
		value: '',
		ownerDocument: undefined,
		remove: vi.fn(),
		focus: vi.fn(),
		setSelectionRange: vi.fn(),
		contains: (node) => node === el,
		addEventListener: (type, handler) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
		},
		fire: (type, event) => {
			for (const handler of handlers.get(type) ?? []) {
				handler(event);
			}
		},
	};
	return el;
}

function makeDocStub(): DocStub {
	const handlers = new Map<string, ((event: unknown) => void)[]>();
	const created: DocStub['created'] = [];
	const doc = {
		body: {
			createEl: (tag: string, options?: unknown): ElStub => {
				const el = makeElStub();
				// 回填所属文档（提交时焦点归还 body 用；运行时由 createEl 自然建立）
				el.ownerDocument = doc;
				created.push({ tag, options, el });
				return el;
			},
			focus: vi.fn(),
		},
		addEventListener: (type: string, handler: (event: unknown) => void) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
		},
		removeEventListener: (type: string, handler: (event: unknown) => void) => {
			const list = handlers.get(type) ?? [];
			handlers.set(
				type,
				list.filter((item) => item !== handler),
			);
		},
		fireDoc: (type: string, event: unknown) => {
			for (const handler of handlers.get(type) ?? []) {
				handler(event);
			}
		},
		created,
	};
	return doc;
}

/** 会话创建的最新 textarea（本模块每会话只建一个） */
function lastEl(doc: DocStub): ElStub {
	const entry = doc.created[doc.created.length - 1];
	if (!entry) {
		throw new Error('文档桩未创建任何元素');
	}
	return entry.el;
}

/** 引擎事件桩：记录 onEngine 注册并可按下标触发 */
function makeEngineEventsStub() {
	const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
	return {
		onEngine: vi.fn(
			(_mindMap: unknown, event: string, handler: (...args: unknown[]) => void) => {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
		),
		fire: (event: string) => {
			for (const handler of handlers.get(event) ?? []) {
				handler();
			}
		},
		has: (event: string) => (handlers.get(event) ?? []).length > 0,
	};
}

function makeView(mindMap: MindMap | null) {
	const engineEvents = makeEngineEventsStub();
	const notifyNodeContentCommitted = vi.fn();
	const view = {
		mindMap,
		engineEvents,
		viewEvents: {},
		app: {},
		lang: 'zh',
		scheduleSave: vi.fn(),
		// K108：提交后必须通知视图（中心主题改名 / 自动拆分 / 节点计数）
		notifyNodeContentCommitted,
	} as unknown as ViewNodeEditContext;
	return { view, engineEvents, notifyNodeContentCommitted };
}

/** 节点桩：getData 返回同一引用（写入可断言） */
function makeNode(data: Record<string, unknown> = { text: '旧' }): MindMapNode {
	return { getData: () => data } as unknown as MindMapNode;
}

/** 节点 group 桩：ownerDocument + 矩形（含缩放平移后的屏幕坐标口径） */
function makeGroupStub(doc: DocStub) {
	return {
		ownerDocument: doc,
		getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }),
	};
}

/** 键盘事件桩（处理器只读这些面） */
function keyEvent(
	key: string,
	mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {},
) {
	return {
		key,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		isComposing: false,
		stopPropagation: vi.fn(),
		preventDefault: vi.fn(),
		...mods,
	};
}

/** 打开一个会话（返回 view/节点数据/元素/引擎桩） */
function openSession() {
	const render = vi.fn();
	const mindMap = { render } as unknown as MindMap;
	const doc = makeDocStub();
	getNodeGroupElMock.mockReturnValue(makeGroupStub(doc));
	const { view, engineEvents, notifyNodeContentCommitted } = makeView(mindMap);
	const data: Record<string, unknown> = { text: '旧' };
	const node = makeNode(data);
	openNodeInlineEditor(view, node);
	return {
		mindMap,
		render,
		doc,
		view,
		engineEvents,
		data,
		node,
		el: lastEl(doc),
		notifyNodeContentCommitted,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	isEditingTextMock.mockReturnValue(false);
	applyRawToNodeMock.mockImplementation((data: Record<string, unknown>, raw: string) => {
		data.text = raw;
	});
	// 探测默认成功；失败用例用 mockRejectedValueOnce 单次覆盖
	walkImageSizeCorrectionsMock.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
	vi.clearAllMocks();
});

/** 排空微任务链：让 .then/.catch 回调落地（探测链是 fire-and-forget，需显式等待） */
async function flushMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

describe('resolveInlineEditKey（按键 → 动作判定表）', () => {
	it('Enter / Mod+Enter / Tab / Escape = 提交（Esc 为「停止并保留」）', () => {
		expect(resolveInlineEditKey(keyEvent('Enter'))).toBe('commit');
		expect(resolveInlineEditKey(keyEvent('Enter', { ctrlKey: true }))).toBe('commit');
		expect(resolveInlineEditKey(keyEvent('Enter', { metaKey: true }))).toBe('commit');
		expect(resolveInlineEditKey(keyEvent('Tab'))).toBe('commit');
		expect(resolveInlineEditKey(keyEvent('Escape'))).toBe('commit');
	});

	it('Shift+Enter = 换行（多行节点）；Alt+Enter 与其他键 = 让位', () => {
		expect(resolveInlineEditKey(keyEvent('Enter', { shiftKey: true }))).toBe('newline');
		expect(resolveInlineEditKey(keyEvent('Enter', { altKey: true }))).toBe('none');
		expect(resolveInlineEditKey(keyEvent('a'))).toBe('none');
		expect(resolveInlineEditKey(keyEvent('ArrowDown'))).toBe('none');
	});
});

describe('内联编辑会话（打开 / 提交 / 关闭）', () => {
	it('打开：登记会话、创建 textarea（挂 body）、聚焦并置光标末尾', () => {
		const { mindMap, doc, el } = openSession();
		expect(isInlineNodeEditing(mindMap), '打开后为 true').toBe(true);
		expect(doc.created).toHaveLength(1);
		expect(doc.created[0]?.tag).toBe('textarea');
		expect(el.value, '预填 = composeNodeContent 输出').toBe('RAW 原文');
		expect(el.focus).toHaveBeenCalledTimes(1);
		expect(el.setSelectionRange, '光标置末尾（防误覆盖）').toHaveBeenCalledWith(
			'RAW 原文'.length,
			'RAW 原文'.length,
		);
	});

	it('Enter 提交：有改动才写回（applyRawToNode + render + scheduleSave + 关会话）', () => {
		const { mindMap, render, doc, view, data, node, el } = openSession();
		el.value = '新原文';
		el.fire('keydown', keyEvent('Enter'));

		expect(applyRawToNodeMock).toHaveBeenCalledWith(data, '新原文');
		expect(data.text).toBe('新原文');
		expect(markNodeNeedLayoutMock).toHaveBeenCalledWith(node);
		expect(render).toHaveBeenCalled();
		expect(view.scheduleSave).toHaveBeenCalledTimes(1);
		expect(el.remove).toHaveBeenCalled();
		expect(doc.body.focus, '焦点归还 body（引擎快捷键需要 target=body）').toHaveBeenCalled();
		expect(isInlineNodeEditing(mindMap)).toBe(false);
	});

	it('未改动提交：不写盘不重渲染（对齐弹窗原文模式的「未改动不写」）', () => {
		const { mindMap, render, view, el } = openSession();
		el.fire('keydown', keyEvent('Enter'));

		expect(applyRawToNodeMock).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
		expect(view.scheduleSave).not.toHaveBeenCalled();
		expect(isInlineNodeEditing(mindMap), '会话仍关闭').toBe(false);
	});

	it('Shift+Enter：保持编辑（不提交、不写回）', () => {
		const { mindMap, el } = openSession();
		el.value = '第一行\n第二行';
		el.fire('keydown', keyEvent('Enter', { shiftKey: true }));

		expect(applyRawToNodeMock).not.toHaveBeenCalled();
		expect(isInlineNodeEditing(mindMap), '仍在编辑中').toBe(true);
	});

	it('IME 组合中的 Enter（isComposing）：不提交', () => {
		const { mindMap, el } = openSession();
		el.fire('keydown', { ...keyEvent('Enter'), isComposing: true });
		expect(isInlineNodeEditing(mindMap)).toBe(true);
		expect(applyRawToNodeMock).not.toHaveBeenCalled();
	});

	it('点击编辑器外（document mousedown）：提交；编辑器内点击不提交', () => {
		const first = openSession();
		first.el.value = '改动';
		// 编辑器内（contains 命中）：不提交
		first.doc.fireDoc('mousedown', { target: first.el });
		expect(isInlineNodeEditing(first.mindMap)).toBe(true);
		// 编辑器外：提交
		first.doc.fireDoc('mousedown', { target: { tag: 'outside' } });
		expect(applyRawToNodeMock).toHaveBeenCalledWith(first.data, '改动');
		expect(isInlineNodeEditing(first.mindMap)).toBe(false);
	});

	it('画布滚轮（引擎 mousewheel）：提交（对齐引擎编辑框的隐藏语义）', () => {
		const { mindMap, view, engineEvents, el } = openSession();
		expect(engineEvents.has('mousewheel')).toBe(true);
		el.value = '滚轮前输入';
		engineEvents.fire('mousewheel');
		expect(view.scheduleSave).toHaveBeenCalledTimes(1);
		expect(isInlineNodeEditing(mindMap)).toBe(false);
	});

	it('引擎重建守卫：会话所属引擎 ≠ 视图当前引擎时提交不写回', () => {
		const { mindMap, view, engineEvents, el } = openSession();
		el.value = '重建期间输入';
		// 模拟「视图已换到新引擎」：同一 view 对象的 mindMap 指向新实例
		(view as unknown as { mindMap: MindMap }).mindMap = {} as MindMap;
		engineEvents.fire('mousewheel');
		expect(
			applyRawToNodeMock,
			'旧引擎的输入不再写回（重建路径已提前提交过）',
		).not.toHaveBeenCalled();
		expect(isInlineNodeEditing(mindMap), '旧会话已摘除').toBe(false);
	});

	it('closeInlineEditor：无会话幂等 no-op；有会话则提交关闭', () => {
		const bare = makeView({} as MindMap);
		expect(() => closeInlineEditor(bare.view)).not.toThrow();

		const { mindMap, view, el, data } = openSession();
		el.value = '关闭时提交';
		closeInlineEditor(view);
		expect(data.text).toBe('关闭时提交');
		expect(isInlineNodeEditing(mindMap)).toBe(false);
	});

	it('K108 提交通知：提交后通知视图（中心主题改名 / 自动拆分 / 节点计数）', () => {
		// 回归：插件侧编辑通道不走引擎命令，不派发 data_change /
		// node_text_edit_change；若不显式通知，中心主题改名文件与「编辑后
		// 自动拆分混排双链」在默认自绘渲染下静默失效（实机定位）。
		const { view, node, el, notifyNodeContentCommitted } = openSession();
		el.value = '混排 [[笔记]] 尾巴';
		closeInlineEditor(view);

		expect(notifyNodeContentCommitted).toHaveBeenCalledTimes(1);
		expect(notifyNodeContentCommitted).toHaveBeenCalledWith(node);
	});

	it('K108 提交通知：值未变（无改动提交）不通知视图', () => {
		const { view, el, notifyNodeContentCommitted } = openSession();
		// 与打开时的初值保持一致（会话的 initialValue 即此刻的框内值）
		const unchanged = el.value;
		el.value = unchanged;
		closeInlineEditor(view);
		expect(notifyNodeContentCommitted).not.toHaveBeenCalled();
	});

	it('重复打开（同一引擎）：先提交既有会话（对齐引擎「先结束当前编辑」）', () => {
		const render = vi.fn();
		const mindMap = { render } as unknown as MindMap;
		const doc = makeDocStub();
		getNodeGroupElMock.mockReturnValue(makeGroupStub(doc));
		const { view } = makeView(mindMap);
		const data1: Record<string, unknown> = { text: 'A' };
		openNodeInlineEditor(view, makeNode(data1));
		lastEl(doc).value = 'A 改';
		const data2: Record<string, unknown> = { text: 'B' };
		openNodeInlineEditor(view, makeNode(data2));

		expect(data1.text, '第一会话已提交').toBe('A 改');
		expect(doc.created, '两次打开各建一个编辑器').toHaveLength(2);
		expect(isInlineNodeEditing(mindMap)).toBe(true);
		expect(data2.text, '第二会话未提交').toBe('B');
	});
});

describe('isAnyNodeEditing（统一编辑态判据）', () => {
	it('引擎编辑框进行中 → true（即使内联无会话）', () => {
		const mindMap = {} as MindMap;
		isEditingTextMock.mockReturnValue(true);
		expect(isAnyNodeEditing(mindMap)).toBe(true);
		isEditingTextMock.mockReturnValue(false);
		expect(isAnyNodeEditing(mindMap)).toBe(false);
	});

	it('内联编辑进行中 → true；null 引擎 → false', () => {
		const { mindMap } = openSession();
		expect(isAnyNodeEditing(mindMap)).toBe(true);
		expect(isAnyNodeEditing(null)).toBe(false);
		expect(isInlineNodeEditing(null)).toBe(false);
	});
});

/**
 * `applyRawNodeContent`：弹窗/内联的**原文写回入口**（2026-10-04 代码审查补齐）。
 *
 * 此前该导出函数**无任何直接用例**（`tests/` 侧只覆盖 `resolveInlineEditKey`、
 * 会话生命周期与 `isAnyNodeEditing`），而它是 K108 的关键编排点——末尾漏掉
 * `notifyNodeContentCommitted` 会让「中心主题改名文件 / 编辑后自动拆分混排双链 /
 * 节点计数」三条后续编排静默失效（该通道不走引擎命令、不派发 `data_change`）。
 *
 * 本组锁三件事：① 基础编排（写回 → 重排 → 渲染 → 保存 → 通知）的**顺序与次数**；
 * ② 图片面只在**有 image 字段**时探测，且成功后补一次重排；③ **探测失败降级**——
 * 抛错不得变成未处理拒绝，也不得影响写回/渲染/保存（K97：未设尺寸＝默认大小即
 * 安全终态，失败只需留痕）。
 */
describe('applyRawNodeContent（原文写回 + 图片尺寸探测降级）', () => {
	/** 图片节点桩：data 带 image 字段（触发图片面分支） */
	function imageNode(image = 'old.png') {
		return makeNode({ text: '旧', image });
	}

	it('无 image 字段：只做写回 → 重排 → 渲染 → 保存 → K108 通知，不触发探测', () => {
		const render = vi.fn();
		const { view, notifyNodeContentCommitted } = makeView({
			render,
		} as unknown as MindMap);
		const node = makeNode({ text: '旧' });

		applyRawNodeContent(view, node, '新原文');

		expect(applyRawToNodeMock, '原文整体重建').toHaveBeenCalledWith(
			expect.anything(),
			'新原文',
		);
		expect(walkImageSizeCorrectionsMock, '无图即不探测').not.toHaveBeenCalled();
		expect(markNodeNeedLayoutMock).toHaveBeenCalledWith(node);
		expect(render, '末尾那一次渲染').toHaveBeenCalledTimes(1);
		expect(view.scheduleSave).toHaveBeenCalledTimes(1);
		expect(notifyNodeContentCommitted, 'K108：三条后续编排依赖它').toHaveBeenCalledWith(
			node,
		);
	});

	it('有 image 字段：解析地址 + 填默认尺寸 + 探测成功后补一次重排（共两次渲染）', async () => {
		const render = vi.fn();
		const { view } = makeView({ render } as unknown as MindMap);
		const node = imageNode();

		applyRawNodeContent(view, node, '新原文');
		await flushMicrotasks();

		expect(
			resolveImagePathMock,
			'图片地址经统一解析入口（第二参为 app，用于解析库相对路径）',
		).toHaveBeenCalledWith('old.png', view.app);
		expect(ensureDefaultImageSizesMock, '引擎硬要求 image 必有 imageSize').toHaveBeenCalled();
		expect(walkImageSizeCorrectionsMock).toHaveBeenCalledTimes(1);
		expect(render, '探测补一次 + 末尾一次').toHaveBeenCalledTimes(2);
		expect(markNodeNeedLayoutMock, '探测成功也补一次重排').toHaveBeenCalledTimes(2);
	});

	it('探测失败：降级为 console.warn，不产生未处理拒绝，且写回/保存/通知不受影响', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const render = vi.fn();
		const { view, notifyNodeContentCommitted } = makeView({
			render,
		} as unknown as MindMap);
		const node = imageNode();
		walkImageSizeCorrectionsMock.mockRejectedValueOnce(new Error('probe boom'));

		// 关键：返回 undefined 而非 reject —— 证明降级真的接住了
		expect(applyRawNodeContent(view, node, '新原文')).toBeUndefined();
		await expect(flushMicrotasks()).resolves.toBeUndefined();

		expect(warnSpy, '失败必须留痕（静默跳过会让问题无痕退化）').toHaveBeenCalledWith(
			'图片尺寸探测失败，保持默认尺寸',
			expect.any(Error),
		);
		expect(render, '探测补渲染被跳过，只剩末尾那一次').toHaveBeenCalledTimes(1);
		expect(view.scheduleSave, '写回不受探测失败影响').toHaveBeenCalledTimes(1);
		expect(notifyNodeContentCommitted, 'K108 通知不受影响').toHaveBeenCalledWith(node);
		warnSpy.mockRestore();
	});
});
