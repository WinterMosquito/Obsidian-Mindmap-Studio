/**
 * 「进入前编辑/阅读模式」（mdBackMode）**读回链路**回归（2026-10-15）。
 *
 * 背景（实机定位）：openAsMindMap 把进入前的 md 视图模式写进视图状态
 * （`leaf.setViewState({ state: { file, mdBackMode } })`，写入侧断言见
 * nav-history.test.ts），切回 Markdown 时须读回它以恢复阅读视图。
 *
 * 官方链路（实机读出源码，2026-10-15）：`setViewState` 把传入 state 原样
 * 交给 `view.setState`（读入点）；而 `leaf.getViewState()` 的 state **完全
 * 取自 `view.getState()`**（`{ type, state: e.getState() }`），视图基类链上
 * `View.getState()` 返回 `{}`、`FileView.getState()` 只回 `file`（写回点）。
 * 故视图必须**自行覆写 `setState` / `getState`** 两头承接 mdBackMode；否则
 * 读回恒 undefined → readMdBackMode 恒回退 'source' → 从阅读视图进入导图后
 * 切回 Markdown 永远落在编辑视图（缺陷根因，2026-10-15 已修）。
 *
 * 本文件与 nav-history.test.ts 的写入侧断言配对：这里钉住**读入、写回与
 * 键名一致**三个面——任一侧改名 / 覆写被删即红灯。
 */
import { describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import { MindMapView } from '../src/features/view';
import { openAsMindMap } from '../src/markdown/md-open';

/**
 * 引擎防腐面整体桩掉：`src/engine/mindmap` 顶层加载 vendor bundle
 * （simple-mind-map.cjs 顶层访问 `document`，Node 环境无法加载——与
 * engine-controller.test.ts 同款处置）。本文件只碰视图状态面
 * （setState / getState / openAsMindMap 的写入参数），不调用任何引擎函数，
 * 故空面即可（mock 键只在被访问时才要求存在）。
 */
vi.mock('../src/engine/mindmap', () => ({}));

/**
 * 建一个「只需状态面」的视图实例。
 *
 * 走 `Object.create(原型)` 而非构造器：构造函数会建引擎控制器/保存管线/文档
 * 服务（依赖真实 App 与 DOM，不在本断言面内）；`getState()` 只读 `file` 与
 * `mdBackMode` 两个字段，原型实例 + 铺字段与真实实例在该方法上等价。
 * 注意 `Object.create` 不跑类字段初始化（默认值 'source' 不会自动就位），
 * 故各用例都显式铺值。
 */
/** 断言基准路径（写入侧与读回侧共用；改名即全用例同步） */
const FILE_PATH = 'a.mindmap.md';

function createView(fields: {
	file: string;
	mdBackMode: 'source' | 'preview';
}): MindMapView {
	const view = Object.create(MindMapView.prototype) as MindMapView;
	Object.assign(view, {
		file: Object.assign(new TFile(), {
			path: fields.file,
			extension: 'md',
		}),
		mdBackMode: fields.mdBackMode,
	});
	return view;
}

describe('mdBackMode 读入/写回链路（setState / getState）', () => {
	it('原型覆写：MindMapView 必须自有 getState（基类默认实现只回 file）', () => {
		expect(
			Object.prototype.hasOwnProperty.call(MindMapView.prototype, 'getState'),
			'MindMapView 未覆写 getState()：官方 WorkspaceLeaf.getViewState() 的 state ' +
				'取自 view.getState()（实机读出），基类 FileView.getState() 只回 file ⇒ ' +
				'mdBackMode 永远读不回，切回 Markdown 恒落编辑视图',
		).toBe(true);
	});

	it('getState() 带回 file 与 mdBackMode（preview / source 原样返回）', () => {
		expect(
			createView({ file: FILE_PATH, mdBackMode: 'preview' }).getState(),
		).toMatchObject({ file: FILE_PATH, mdBackMode: 'preview' });
		expect(
			createView({ file: FILE_PATH, mdBackMode: 'source' }).getState(),
		).toMatchObject({ file: FILE_PATH, mdBackMode: 'source' });
	});

	it('键名一致：openAsMindMap 写入的状态键都能从 getState() 读回（单侧改名即断链）', async () => {
		const setViewState = vi.fn().mockResolvedValue(undefined);
		const leaf = {
			view: Object.assign(new MarkdownView(null as never), {
				getMode: () => 'preview',
			}),
			setViewState,
		};
		const file = Object.assign(new TFile(), {
			path: FILE_PATH,
			extension: 'md',
		});

		await openAsMindMap(leaf as never, file);

		const written =
			(setViewState.mock.calls[0]?.[0] as { state?: Record<string, unknown> })
				?.state ?? {};
		// 写入侧必须非空（否则本用例空转误绿）
		expect(Object.keys(written)).not.toHaveLength(0);

		const readBack = createView({
			file: FILE_PATH,
			mdBackMode: 'preview',
		}).getState();
		for (const key of Object.keys(written)) {
			expect(
				readBack,
				`写入状态键 ${key} 未能从 getState() 读回——视图状态读回链路断裂`,
			).toHaveProperty(key);
		}
	});

	it('setState 读入点：传入 state 的 mdBackMode 落字段（唯一权威来源，先于 super 装载）', async () => {
		const view = createView({ file: FILE_PATH, mdBackMode: 'source' });

		await view.setState(
			{ file: FILE_PATH, mdBackMode: 'preview' },
			{ history: false },
		);

		expect(view.getState()).toMatchObject({
			file: FILE_PATH,
			mdBackMode: 'preview',
		});
	});

	it('setState 防御：缺失 / 非法 / 非对象 state 一律回退 source（白名单）', async () => {
		const view = createView({ file: FILE_PATH, mdBackMode: 'preview' });
		const states: unknown[] = [
			{ file: FILE_PATH },
			{ file: FILE_PATH, mdBackMode: 'garbage' },
			null,
		];

		for (const state of states) {
			await view.setState(state, { history: false });
			expect(view.getState(), `state=${JSON.stringify(state)}`).toMatchObject({
				mdBackMode: 'source',
			});
		}
	});
});
