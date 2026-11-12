/**
 * view-syntax 回归：层级语法的两条视图路径。
 *
 * 关注点（模块自身的分支，非 mock 行为）：
 * - **显式动作**（`applyDocumentSyntax`）：整篇重排走 `replaceMindMapData`
 *   （深拷贝 + 一条历史）、排保存、刷状态栏；已达标 → 只提示"无需改动"；
 * - **自动守卫**（`runSyntaxGuard`）：按落点就地升标题 / 降列表（不走整树回灌、
 *   不进历史）；转不了、或段落父下挂标题 → `BACK` 撤回这次编辑并提示原因；
 * - **空文档种子**（`md-heading-syntax.seedHeadingStart`，视图在 `loadMindMapFromFile`
 *   里调用，回归在 `tests/md-heading-syntax.test.ts`）：只有"正文没有节点"的
 *   文件才用设置里的起始级别，有内容的文件一律以正文为准。
 *
 * 引擎面以桩替换（`getRenderRoot` / `replaceMindMapData` / `ENGINE_COMMANDS`），
 * 树数据用真实结构（`getData` 返回同一 data 引用 = 引擎活引用语义）。
 */
import { Notice } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/core/i18n';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	applyDocumentSyntax,
	resolveDocumentSyntax,
	runSyntaxGuard,
} from '../src/features/view-syntax';
import { parseMdOutline } from '../src/markdown/md-outline';

const { execCommandMock, replaceDataMock, renderRootRef, ENGINE } = vi.hoisted(
	() => {
		/** 当前「引擎里的」渲染根（守卫走它；用例按需替换） */
		const ref: { current: LiveNodeStub | null } = { current: null };
		return {
			execCommandMock: vi.fn<(...args: unknown[]) => void>(),
			replaceDataMock: vi.fn<(...args: unknown[]) => void>(),
			renderRootRef: ref,
			// 命令名与 src/engine/mindmap.ts 的 ENGINE_COMMANDS 一致；常量表本身由
			// vendor-contract 把关，这里只验证编排传了哪一个命令
			ENGINE: { BACK: 'BACK' },
		};
	},
);

vi.mock('../src/engine/mindmap', () => ({
	ENGINE_COMMANDS: ENGINE,
	getRenderRoot: () => renderRootRef.current,
	replaceMindMapData: (...args: unknown[]): void => {
		replaceDataMock(...args);
	},
}));

/** 引擎渲染节点桩：`getData()` 返回**同一个** data 对象（活引用语义） */
interface LiveNodeStub {
	getData(): Record<string, unknown>;
	children: LiveNodeStub[];
}

function liveNode(
	data: Record<string, unknown>,
	children: LiveNodeStub[] = [],
): LiveNodeStub {
	return { getData: () => data, children };
}

/** 解析 md 为数据树（与生产同源的真实解析） */
function parseMd(md: string) {
	return parseMdOutline(md, '根').tree;
}

type DataTree = ReturnType<typeof parseMd>;

/** 由解析产物构造渲染根桩（`getData` 返回活引用，供守卫就地改写） */
function renderRoot(md: string): LiveNodeStub {
	const wrap = (node: DataTree): LiveNodeStub => ({
		getData: () => node.data,
		children: (node.children ?? []).map(wrap),
	});
	return wrap(parseMd(md));
}

function makeHarness(options: { tree?: unknown; settings?: unknown } = {}) {
	const raw = {
		mindMap: {
			execCommand: execCommandMock,
			// 整树深拷贝（级联路径先改副本再回灌，与引擎语义一致）
			getData: vi.fn(() => structuredClone(options.tree ?? parseMd('- 甲\n'))),
		},
		lang: 'zh',
		scheduleSave: vi.fn<() => void>(),
		// 守卫归一后必须把权威树同步进会话（K188）：不调用 ⇒ 保存写归一前写法
		commitDerivedTree: vi.fn<() => void>(),
		plugin: {
			settings: options.settings ?? { newMapSyntax: 'list' },
			// 状态栏不可用 ⇒ updateStatusBar 直接返回，用例无需计数桩
			statusBar: { available: false },
		},
	};
	return { view: raw as unknown as MindMapViewContext, raw };
}

type NoticeCtor = { instances: { message: string }[] };

/** 测试替身记录的全部提示（tests/mocks/obsidian.ts 的 Notice 桩） */
function notices(): { message: string }[] {
	return (Notice as unknown as NoticeCtor).instances;
}

function lastNotice(): string {
	return notices().at(-1)?.message ?? '';
}

beforeEach(() => {
	vi.clearAllMocks();
	notices().length = 0;
	renderRootRef.current = null;
});

describe('applyDocumentSyntax（右键级联：整篇重排）', () => {
	it('列表 → 标题：回灌整树、排保存、提示改写数量', () => {
		const { view, raw } = makeHarness({ tree: parseMd('- 甲\n  - 甲一\n') });
		applyDocumentSyntax(view, 1);
		expect(replaceDataMock).toHaveBeenCalledTimes(1);
		const tree = replaceDataMock.mock.calls[0]![1] as {
			data: Record<string, unknown>;
			children: { data: Record<string, unknown>; children: unknown[] }[];
		};
		expect(tree.children[0]!.data.mdType).toBe('heading');
		expect(tree.children[0]!.data.mdLevel).toBe(1);
		expect(tree.data).toMatchObject({ mdHeadingStart: 1 });
		expect(raw.scheduleSave).toHaveBeenCalledTimes(1);
		expect(lastNotice()).toBe(t('zh', 'syntax.done').replace('{count}', '2'));
	});

	it('已是目标语法：不改树、只提示无需改动', () => {
		const { view, raw } = makeHarness({ tree: parseMd('# 甲\n') });
		applyDocumentSyntax(view, 1);
		expect(replaceDataMock).not.toHaveBeenCalled();
		expect(raw.scheduleSave).not.toHaveBeenCalled();
		expect(lastNotice()).toBe(t('zh', 'syntax.none'));
	});

	it('一个都转不了：提示点名阻挡者（而不是笼统的「无需改动」）', () => {
		const { view } = makeHarness({
			tree: parseMd('- 代码\n  ```js\n  x\n  ```\n'),
		});
		applyDocumentSyntax(view, 1);
		expect(replaceDataMock).not.toHaveBeenCalled();
		expect(lastNotice()).toBe(
			t('zh', 'syntax.keptList').replace('{text}', '代码'),
		);
	});
});

describe('runSyntaxGuard（同级同语法守卫）', () => {
	it('标题组里混入列表项 → 就地升级（不整树回灌、不进历史）', () => {
		const root = renderRoot('# 甲\n\n- 乙\n');
		renderRootRef.current = root;
		const { view, raw } = makeHarness();
		// 解析结果是「乙 是甲的子节点」；手工改成同级混排（模拟拖拽落点）
		const jia = root.children[0]!;
		const yi = jia.children.pop()!;
		root.children.push(yi);
		runSyntaxGuard(view);
		expect(yi.getData().mdType).toBe('heading');
		expect(yi.getData().mdLevel).toBe(1);
		expect(replaceDataMock).not.toHaveBeenCalled();
		expect(execCommandMock).not.toHaveBeenCalled();
		expect(raw.scheduleSave).toHaveBeenCalledTimes(1);
		// 就地改的是引擎活数据：会话权威树必须同步（K188）
		expect(raw.commitDerivedTree).toHaveBeenCalledTimes(1);
		expect(lastNotice()).toContain('乙');
	});

	it('纯重定级（`##` 拖成 `#` 的同级）：提示点名，且不说「改为标题」', () => {
		// 2026-11-09 实机：这一支此前落到 guardUpgraded，名字是空的
		//（firstUpgraded 只在「列表 → 标题」时赋值）
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '甲', mdType: 'heading', mdLevel: 1 }),
			liveNode({ text: '乙', mdType: 'heading', mdLevel: 2 }),
		]);
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(raw.commitDerivedTree).toHaveBeenCalledTimes(1);
		expect(lastNotice()).toBe(
			t('zh', 'syntax.guardReleveled').replace('{text}', '乙'),
		);
	});

	it('转不了的节点（多行）→ BACK 撤回这次编辑并提示原因', () => {
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '甲', mdType: 'heading', mdLevel: 1 }),
			liveNode({
				text: '代码',
				mdType: 'list',
				mdMarker: '-',
				mdRaw: '代码\n```js\n```',
			}),
		]);
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).toHaveBeenCalledWith(ENGINE.BACK);
		expect(raw.scheduleSave).not.toHaveBeenCalled();
		expect(lastNotice()).toContain('代码');
	});

	it('**列表在前、标题在后是合法排布** → 静默（打开手写文件不被改写、不刷提示）', () => {
		// 2026-11-08 实机 P0：旧判据在这里判成「列表组混入标题」，加载时连发
		// 17 条提示并反复 BACK；正确行为是「这本来就能逐字往返，什么都不做」。
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '甲', mdType: 'list', mdMarker: '-' }),
			liveNode({ text: '乙', mdType: 'list', mdMarker: '-' }),
			liveNode({ text: '丙', mdType: 'heading', mdLevel: 1 }),
		]);
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).not.toHaveBeenCalled();
		expect(raw.scheduleSave).not.toHaveBeenCalled();
		expect(notices()).toHaveLength(0);
	});

	it('标题挂在列表下 → 就地降为列表（不撤回、排保存）+ 专有提示', () => {
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '甲', mdType: 'list', mdMarker: '-' }, [
				liveNode({ text: '乙', mdType: 'heading', mdLevel: 2 }),
			]),
		]);
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).not.toHaveBeenCalled();
		expect(raw.scheduleSave).toHaveBeenCalledTimes(1);
		expect(lastNotice()).toBe(
			t('zh', 'syntax.guardDowngradedAnchors')
				.replace('{count}', '1')
				.replace('{text}', '乙'),
		);
		const yi = renderRootRef.current.children[0]!.children[0]!;
		expect(yi.getData().mdType).toBe('list');
		expect(yi.getData().mdLevel).toBeUndefined();
	});

	it('降级含多个标题：提示报出失去锚点的标题总数', () => {
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '甲', mdType: 'list', mdMarker: '-' }, [
				liveNode({ text: '乙', mdType: 'heading', mdLevel: 2 }, [
					liveNode({ text: '乙一', mdType: 'heading', mdLevel: 3 }),
				]),
			]),
		]);
		const { view } = makeHarness();
		runSyntaxGuard(view);
		expect(lastNotice()).toBe(
			t('zh', 'syntax.guardDowngradedAnchors')
				.replace('{count}', '2')
				.replace('{text}', '乙'),
		);
	});

	it('标题挂在段落下 → 仍 BACK 撤回（降级保不住父子关系；生产不可达，仅兜底）', () => {
		// 解析器不会产出「段落父 + 标题子」，这里只锁防御分支的行为（K171）
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '段', mdType: 'plain' }, [
				liveNode({ text: '乙', mdType: 'heading', mdLevel: 2 }),
			]),
		]);
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).toHaveBeenCalledWith(ENGINE.BACK);
		expect(raw.scheduleSave).not.toHaveBeenCalled();
		expect(lastNotice()).toBe(
			t('zh', 'syntax.guardBlockedDowngrade').replace('{text}', '乙'),
		);
	});

	it('撤回后由 BACK 自己触发的下一轮判定被跳过（不空转、不刷屏）', () => {
		// 用「升级被阻挡」造一次 BACK：列表父下挂标题现在会就地降级，不再撤回
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: '甲', mdType: 'heading', mdLevel: 1 }),
			liveNode({
				text: '代码',
				mdType: 'list',
				mdMarker: '-',
				mdRaw: '代码\n```js\n```',
			}),
		]);
		const { view } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).toHaveBeenCalledWith(ENGINE.BACK);
		execCommandMock.mockClear();
		// BACK 的 data_change 会再进一次守卫：应被 suppress 拦下
		runSyntaxGuard(view);
		expect(execCommandMock).not.toHaveBeenCalled();
	});

	it('父级 6 级下挂标题 → 就地降为列表（不撤回）+ 专有提示', () => {
		renderRootRef.current = liveNode({ text: '根' }, [
			liveNode({ text: 'L6', mdType: 'heading', mdLevel: 6 }, [
				liveNode({ text: 'M6', mdType: 'heading', mdLevel: 2 }),
			]),
		]);
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).not.toHaveBeenCalled();
		expect(raw.scheduleSave).toHaveBeenCalled();
		expect(lastNotice()).toBe(
			t('zh', 'syntax.guardDowngradedAnchors')
				.replace('{count}', '1')
				.replace('{text}', 'M6'),
		);
	});

	it('无混排：静默（不提示、不排保存、不动历史）', () => {
		renderRootRef.current = renderRoot('# 甲\n\n- 甲一\n');
		const { view, raw } = makeHarness();
		runSyntaxGuard(view);
		expect(execCommandMock).not.toHaveBeenCalled();
		expect(raw.scheduleSave).not.toHaveBeenCalled();
		expect(raw.commitDerivedTree).not.toHaveBeenCalled();
		expect(notices()).toHaveLength(0);
	});
});

describe('resolveDocumentSyntax（级联勾选态）', () => {
	it('按正文实测：纯列表 / 一级起 / 二级起', () => {
		expect(
			resolveDocumentSyntax(makeHarness({ tree: parseMd('- 甲\n') }).view),
		).toBe('list');
		expect(
			resolveDocumentSyntax(makeHarness({ tree: parseMd('# 甲\n') }).view),
		).toBe(1);
		expect(
			resolveDocumentSyntax(makeHarness({ tree: parseMd('## 甲\n') }).view),
		).toBe(2);
	});
});
