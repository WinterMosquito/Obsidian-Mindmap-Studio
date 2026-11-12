/**
 * 文档会话（`services/document-session.ts` + registry）直测。
 *
 * 覆盖 Level B 的四条硬约束：
 * 1. **一份文档**：同路径并发 acquire 只读盘一次，两个视图共享同一会话树；
 * 2. **无回声**：提交只广播给**其它**视图（发起视图跳过），接收视图的应用
 *    不产生新的提交（`applySnapshot` 由视图实现，测试桩记录调用）；
 * 3. **共享撤销**：单游标时间线，撤销 / 重做广播给所有视图；
 * 4. **外部写入对齐官方**：有草稿 ⇒ 重载 + 一条可撤销快照 + 提示一次；
 *    无草稿 ⇒ 静默重载；每次解绑都 flush，最后一个解绑销毁会话。
 *
 * 桩：App 只提供 SavePipeline / 会话实际用到的 vault 方法；文档读取与解析
 * 经 `loadDocument` / `parseDocument` 注入（绕开 Obsidian 运行时）。
 * 序列化用真实 `serializeMdBody`（正文即 `# <子节点文本>`），保证「纯浏览
 * 守卫」「abort 判定」与生产同一口径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { IMAGE_HEIGHT, IMAGE_WIDTH } from '../src/core/constants';
import {
	DocumentSession,
	SESSION_BROADCAST_DELAY_MS,
	computeBroadcastDelayMs,
} from '../src/services/document-session';
import { DocumentSessionRegistry } from '../src/services/document-session-registry';
import type { DocumentLoadResult } from '../src/services/document-service';
import type { MindMapTreeNode } from '../src/core/engine-types';
import type { SessionViewPort } from '../src/services/document-session';
import type { SaveState } from '../src/services/status-bar';

const FILE_PATH = 'notes/session.mindmap.md';
const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

/** 单子树：根 + 一个子节点（序列化后正文是 `# <text>`） */
function tree(text: string): MindMapTreeNode {
	return {
		data: { text: 'Root' },
		children: [{ data: { text }, children: [] }],
	};
}

/** 测试视图桩：记录应用过的快照、保存状态与外部重载提示次数 */
class FakeView implements SessionViewPort {
	readonly applied: MindMapTreeNode[] = [];
	readonly states: SaveState[] = [];
	notices = 0;
	staleNotices = 0;
	beforeApplyCalls = 0;

	/** 应用前钩子（模拟「提交未完成的内联编辑」） */
	onBeforeApply: (() => void) | null = null;

	/** `applySnapshot` 的返回值（false = 引擎尚未就绪，模拟后台 0 尺寸等待） */
	applyReturns = true;

	constructor(
		readonly path: string,
		private readonly active = false,
	) {}

	get isActiveView(): boolean {
		return this.active;
	}

	beforeApplySnapshot(): void {
		this.beforeApplyCalls++;
		this.onBeforeApply?.();
	}

	applySnapshot(next: MindMapTreeNode): boolean {
		this.applied.push(next);
		return this.applyReturns;
	}

	afterApplySnapshot(): void {
		// 只用于确认调用面存在（生产侧刷状态栏 / 历史按钮）
	}

	setSessionSaveState(state: SaveState): void {
		this.states.push(state);
	}

	notifyExternalReload(): void {
		this.notices++;
	}

	notifyStaleCommit(): void {
		this.staleNotices++;
	}
}

interface Harness {
	app: App;
	file: TFile;
	disk: { body: string; tree: MindMapTreeNode };
	session: DocumentSession;
	/** 供注册表注入的读取器（与 session 内部用的是同一份） */
	loadDocument: () => Promise<DocumentLoadResult>;
	loadCount: number;
}

function makeHarness(
	options: {
		body?: string;
		text?: string;
		isDocumentHidden?: () => boolean;
	} = {},
): Harness {
	const file = Object.assign(new TFile(), {
		path: FILE_PATH,
		basename: 'session.mindmap',
	});
	const disk = {
		body: options.body ?? '# A\n',
		tree: tree(options.text ?? 'A'),
	};
	const state = { loadCount: 0 };
	const app = Object.assign(new App(), {
		vault: {
			read: async (): Promise<string> => disk.body,
			cachedRead: async (): Promise<string> => disk.body,
			modify: async (_target: TFile, content: string): Promise<void> => {
				disk.body = content;
			},
			process: async (
				_target: TFile,
				fn: (data: string) => string,
			): Promise<string> => {
				const next = fn(disk.body);
				disk.body = next;
				return next;
			},
			getFileByPath: (path: string) => (path === FILE_PATH ? file : null),
			// 含图片的树在序列化 / 图片地址解析时会走官方链接解析与索引兜底
			getFiles: () => [file],
		},
		metadataCache: {
			getFirstLinkpathDest: () => null,
		},
	});
	const loadDocument = async (): Promise<DocumentLoadResult> => {
		state.loadCount++;
		return { tree: tree(options.text ?? 'A'), frontmatter: null, body: disk.body };
	};
	const session = new DocumentSession({
		app,
		file,
		broadcastDelayMs: 1,
		loadDocument,
		parseDocument: (raw) => ({
			tree: disk.tree,
			frontmatter: null,
			body: raw,
		}),
		...(options.isDocumentHidden
			? { isDocumentHidden: options.isDocumentHidden }
			: {}),
	});
	return {
		app,
		file,
		disk,
		session,
		loadDocument,
		get loadCount() {
			return state.loadCount;
		},
	};
}

/** 加载会话并记录加载基线（生产由第一个引擎就绪触发） */
async function open(h: Harness): Promise<void> {
	await h.session.load();
	h.session.markLoadedFromEngine(tree('A'));
}

const live = (h: Harness): MindMapTreeNode => {
	const current = h.session.tree;
	if (!current) {
		throw new Error('会话树未就绪');
	}
	return current;
};

const serialized = (h: Harness): string => JSON.stringify(h.session.tree);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('DocumentSession（提交与广播）', () => {
	it('提交更新权威树 / 版本 / 历史，并只广播给其它视图（发起视图跳过）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);

		const edited = tree('B');
		expect(h.session.commit(edited, a)).toBe(true);
		await delay(20);

		expect(live(h).children?.[0]?.data?.text).toBe('B');
		expect(h.session.version).toBe(2);
		expect(h.session.canUndo()).toBe(true);
		expect(a.applied, '发起视图不重复应用').toHaveLength(0);
		expect(b.applied).toHaveLength(1);
		expect(b.applied[0]?.children?.[0]?.data?.text).toBe('B');
	});

	it('与当前树逐字相同的提交被忽略（防幽灵历史 / 防回声）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		h.session.attach(a);

		const before = serialized(h);
		expect(h.session.commit(tree('A'), a)).toBe(false);
		await delay(20);

		expect(serialized(h)).toBe(before);
		expect(h.session.canUndo()).toBe(false);
		expect(a.applied).toHaveLength(0);
	});

	it('updateCurrent（派生归一）：更新权威树与版本、**不新增历史**、广播给其它视图', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);

		h.session.commit(tree('B'), a);
		await delay(20);
		b.applied.length = 0;

		// 守卫就地改写后的树：文本不变，只多了语法元数据（编辑器看不见）
		const normalized = tree('B');
		normalized.children[0]!.data = {
			text: 'B',
			mdType: 'heading',
			mdLevel: 1,
		};
		expect(h.session.updateCurrent(normalized, a)).toBe(true);
		await delay(20);

		// 权威树已更新、其它视图收到（发起视图跳过）
		expect(live(h).children?.[0]?.data?.mdType).toBe('heading');
		expect(b.applied.at(-1)?.children?.[0]?.data?.mdType).toBe('heading');
		expect(a.applied, '发起视图不重复应用').toHaveLength(0);

		// **不进历史**：撤销一步回到编辑前（A），而不是归一前的 B
		expect(h.session.undo()).toBe(true);
		expect(live(h).children?.[0]?.data?.text).toBe('A');
	});

	it('updateCurrent：与当前树逐字相同则忽略（不广播、不排保存）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		h.session.attach(a);

		expect(h.session.updateCurrent(tree('A'), a)).toBe(false);
		await delay(20);
		expect(a.applied).toHaveLength(0);
	});

	it('attach 预置已应用版本：视图用自己的 cloneTree 建引擎后，onViewReady 不再重放整树', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		h.session.attach(a);

		// 视图紧接 attach 就用 cloneTree 建引擎：内容与会话树逐字相同
		h.session.onViewReady(a);

		expect(a.applied, '不重复应用（大图白付一次整树渲染）').toHaveLength(0);
		expect(a.beforeApplyCalls).toBe(0);
	});

	it('onViewReady 给落后的视图补一次（广播时引擎未就绪、没有落地）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		b.applyReturns = false; // 引擎尚未建好（后台 0 尺寸等待）
		h.session.attach(a);
		h.session.attach(b);

		h.session.commit(tree('B'), a);
		await delay(20);
		expect(b.applied, '尝试过但没落地').toHaveLength(1);

		b.applied.length = 0;
		b.applyReturns = true;
		h.session.onViewReady(b);

		expect(b.applied).toHaveLength(1);
		expect(b.applied[0]?.children?.[0]?.data?.text).toBe('B');
	});

	it('撤销 / 重做广播给**所有**视图（含发起者），并保持历史可用态', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);

		h.session.commit(tree('B'), a);
		await delay(20);
		a.applied.length = 0;
		b.applied.length = 0;

		expect(h.session.undo()).toBe(true);
		expect(a.applied).toHaveLength(1);
		expect(b.applied).toHaveLength(1);
		expect(a.applied[0]?.children?.[0]?.data?.text).toBe('A');
		expect(h.session.historyAvailability()).toEqual({
			canUndo: false,
			canRedo: true,
		});

		expect(h.session.redo()).toBe(true);
		expect(a.applied.at(-1)?.children?.[0]?.data?.text).toBe('B');
		expect(h.session.historyAvailability()).toEqual({
			canUndo: true,
			canRedo: false,
		});
	});

	it('撤销发生在合并窗口内：发起视图也必须收到（不能停在旧内容）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);

		h.session.commit(tree('B'), a); // 广播还在合并窗口里
		expect(h.session.undo()).toBe(true); // 立刻撤销
		await delay(20);

		expect(
			a.applied.at(-1)?.children?.[0]?.data?.text,
			'发起视图不得被 pendingOrigin 跳过',
		).toBe('A');
		expect(b.applied.at(-1)?.children?.[0]?.data?.text).toBe('A');
	});

	it('应用前提交的内联编辑不被丢弃，且只渲染一次（无二次广播）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);
		let fired = false;
		a.onBeforeApply = () => {
			if (fired) {
				return;
			}
			fired = true;
			// 模拟「内联编辑在应用前一刻提交」：必须落进会话，不能被 applying 吞掉
			h.session.commit(tree('C'), a);
		};

		h.session.commit(tree('B'), a);
		await delay(20);

		expect(live(h).children?.[0]?.data?.text).toBe('C');
		expect(b.applied, '应用前提交只应产生一次渲染').toHaveLength(1);
		expect(b.applied[0]?.children?.[0]?.data?.text).toBe('C');
	});

	it('基于旧树的提交被拒绝并提示：保留已有编辑，由广播把该视图刷回权威树', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);

		expect(h.session.commit(tree('A-edit'), a)).toBe(true);
		expect(
			h.session.commit(tree('B-edit'), b),
			'B 尚未收到 A 的广播，提交基于旧树',
		).toBe(false);
		expect(a.staleNotices).toBe(0);
		expect(b.staleNotices, '被拒视图必须收到一次提示').toBe(1);

		await delay(20);
		expect(live(h).children?.[0]?.data?.text, 'A 的编辑不得被覆盖').toBe(
			'A-edit',
		);
		expect(
			b.applied.at(-1)?.children?.[0]?.data?.text,
			'被拒视图回到权威树',
		).toBe('A-edit');
	});

	it('历史空时撤销 / 重做是 no-op（不广播、不抛错）', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH);
		h.session.attach(a);

		expect(h.session.undo()).toBe(false);
		expect(h.session.redo()).toBe(false);
		expect(a.applied).toHaveLength(0);
	});

	it('广播窗口按图规模分级：600 节点以内直接推送，超过走合并窗口', () => {
		expect(computeBroadcastDelayMs(1)).toBe(0);
		expect(computeBroadcastDelayMs(600)).toBe(0);
		expect(computeBroadcastDelayMs(601)).toBe(SESSION_BROADCAST_DELAY_MS);
	});

	it('隐藏窗口推迟应用，恢复可见时补一次（不重复应用）', async () => {
		let hidden = true;
		const h = makeHarness({ isDocumentHidden: () => hidden });
		await open(h);
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		h.session.attach(a);
		h.session.attach(b);

		h.session.commit(tree('B'), a);
		await delay(20);
		expect(b.applied, '隐藏窗口不渲染').toHaveLength(0);
		expect(h.session.version, '数据与历史照常更新').toBe(2);

		hidden = false;
		h.session.handleVisibilityChange();
		expect(b.applied).toHaveLength(1);
		expect(b.applied[0]?.children?.[0]?.data?.text).toBe('B');

		// 再调一次不得重复应用（pending 已清）
		h.session.handleVisibilityChange();
		expect(b.applied).toHaveLength(1);
	});
});

describe('DocumentSession（外部写入）', () => {
	it('有未保存草稿：重载外部版本 + 追加一条撤销快照 + 提示一次', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH, true);
		h.session.attach(a);

		h.session.commit(tree('草稿'), a);
		await delay(20);
		a.applied.length = 0;

		// 外部改写：磁盘与解析结果都变成 EXT
		h.disk.body = '# EXT\n';
		h.disk.tree = tree('EXT');
		h.session.onExternalModify(h.file);
		await delay(30);

		expect(live(h).children?.[0]?.data?.text).toBe('EXT');
		expect(a.applied.at(-1)?.children?.[0]?.data?.text).toBe('EXT');
		expect(a.notices, '有草稿必须提示一次').toBe(1);

		// Ctrl+Z 回到草稿（外部改动是一条可撤销步骤）
		expect(h.session.undo()).toBe(true);
		expect(live(h).children?.[0]?.data?.text).toBe('草稿');
		expect(a.applied.at(-1)?.children?.[0]?.data?.text).toBe('草稿');
	});

	it('无未保存改动：静默重载（不提示），外部改动仍可撤销', async () => {
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH, true);
		h.session.attach(a);

		h.disk.body = '# EXT\n';
		h.disk.tree = tree('EXT');
		h.session.onExternalModify(h.file);
		await delay(30);

		expect(live(h).children?.[0]?.data?.text).toBe('EXT');
		expect(a.applied.at(-1)?.children?.[0]?.data?.text).toBe('EXT');
		expect(a.notices, '无草稿不得提示').toBe(0);
		expect(h.session.canUndo(), '外部改动同样进历史（官方口径）').toBe(true);
	});

	it('广播给视图的树已补齐图片默认尺寸（缺 imageSize 会让引擎整图中断）', async () => {
		// 2026-11-12 实机：含 `![[图]]` 的导图做一次外部写入，外部分支重载的树
		// 来自解析器（不产 imageSize）。直接进引擎后 `getImgShowSize` 对缺失值
		// 解构抛错 ⇒ `renderer.root` 变 null，视图停在旧画面。补齐只能发生在
		// 会话出口（服务的所有 port 都经 applyToPort）。
		const h = makeHarness();
		await open(h);
		const a = new FakeView(FILE_PATH, true);
		h.session.attach(a);

		h.disk.body = '# 相册\n';
		h.disk.tree = {
			data: { text: 'Root' },
			children: [
				{ data: { text: '', image: 'assets/pic.png' }, children: [] },
			],
		};
		h.session.onExternalModify(h.file);
		await delay(30);

		const applied = a.applied.at(-1);
		expect(applied?.children?.[0]?.data?.imageSize).toEqual({
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			custom: false,
		});
		// 派生字段不得回灌会话权威树（写盘只读 md 字段，跨视图比较要逐字）
		expect(live(h).children?.[0]?.data?.imageSize).toBeUndefined();
		expect(applied).not.toBe(live(h));
	});
});

describe('DocumentSession（生命周期与注册表）', () => {
	it('同路径并发 acquire 只读盘一次，返回同一会话', async () => {
		const h = makeHarness();
		const registry = new DocumentSessionRegistry(h.app, 1, {
			loadDocument: h.loadDocument,
		});
		const [first, second] = await Promise.all([
			registry.acquire(h.file),
			registry.acquire(h.file),
		]);

		expect(first).toBe(second);
		expect(h.loadCount).toBe(1);
		expect(registry.find(FILE_PATH)).toBe(first);
	});

	it('重命名只迁移键：会话与视图都不重建', async () => {
		const h = makeHarness();
		const registry = new DocumentSessionRegistry(h.app, 1, {
			loadDocument: h.loadDocument,
		});
		const session = await registry.acquire(h.file);
		const view = new FakeView(FILE_PATH);
		session.attach(view);
		await delay(10);

		h.file.path = 'notes/renamed.mindmap.md';
		registry.rename(FILE_PATH, h.file.path);

		expect(registry.find(FILE_PATH)).toBeUndefined();
		expect(registry.find('notes/renamed.mindmap.md')).toBe(session);
		expect(session.viewCount).toBe(1);
		expect(session.canUndo()).toBe(false);
	});

	it('注册表未显式传窗口时按图规模分级：小图 0 ms 即广播', async () => {
		const h = makeHarness();
		const registry = new DocumentSessionRegistry(h.app, undefined, {
			loadDocument: h.loadDocument,
		});
		const session = await registry.acquire(h.file);
		session.markLoadedFromEngine(tree('A'));
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		session.attach(a);
		session.attach(b);

		session.commit(tree('B'), a);
		await delay(5);

		expect(b.applied, '≤600 节点应走 0 ms 窗口').toHaveLength(1);
		expect(b.applied[0]?.children?.[0]?.data?.text).toBe('B');
		session.destroy();
	});

	it('重命名后仍保持纯浏览守卫：基线随路径迁移', async () => {
		// 磁盘正文带一个规范化会改掉的形态（两个空格）：纯浏览守卫成立时
		// 一轮 flush 不写盘；基线丢失则会按序列化结果重排（K194）。
		const h = makeHarness({ body: '#  A\n' });
		const registry = new DocumentSessionRegistry(h.app, 1, {
			loadDocument: h.loadDocument,
		});
		const session = await registry.acquire(h.file);
		session.markLoadedFromEngine(tree('A'));

		await session.flush();
		expect(h.disk.body, '未改名：纯浏览不写盘').toBe('#  A\n');

		h.file.path = 'notes/renamed.mindmap.md';
		registry.rename(FILE_PATH, h.file.path);
		await session.flush();
		expect(h.disk.body, '改名后仍不得把未编辑行规范化').toBe('#  A\n');
		session.destroy();
	});

	it('重命名后外部写入仍能触发重载（lastSeenDiskBody 随路径迁移）', async () => {
		const h = makeHarness();
		const registry = new DocumentSessionRegistry(h.app, 1, {
			loadDocument: h.loadDocument,
		});
		const session = await registry.acquire(h.file);
		session.markLoadedFromEngine(tree('A'));
		const a = new FakeView(FILE_PATH, true);
		session.attach(a);

		h.file.path = 'notes/renamed.mindmap.md';
		registry.rename(FILE_PATH, h.file.path);
		h.disk.body = '# EXT\n';
		h.disk.tree = tree('EXT');
		session.onExternalModify(h.file);
		await delay(30);

		expect(session.tree?.children?.[0]?.data?.text).toBe('EXT');
		expect(a.applied.at(-1)?.children?.[0]?.data?.text).toBe('EXT');
		session.destroy();
	});

	it('每次解绑都 flush（无差异跳过）；最后一个解绑销毁会话并从注册表移除', async () => {
		const h = makeHarness();
		const registry = new DocumentSessionRegistry(h.app, 1, {
			loadDocument: h.loadDocument,
		});
		const session = await registry.acquire(h.file);
		// 生产由第一个视图的引擎就绪触发；这里直接以会话初始树记录基线
		session.markLoadedFromEngine(tree('A'));
		const a = new FakeView(FILE_PATH);
		const b = new FakeView(FILE_PATH);
		session.attach(a);
		session.attach(b);

		session.commit(tree('B'), a);
		await delay(20);

		await session.detach(a);
		expect(h.session.destroyed).toBe(false);
		expect(registry.find(FILE_PATH)).toBe(session);
		// 关闭即落盘（对齐官方 onUnloadFile）
		expect(h.disk.body.trim()).toBe('# B');

		await session.detach(b);
		expect(session.destroyed).toBe(true);
		expect(registry.find(FILE_PATH)).toBeUndefined();
	});

	it('未记录加载基线时不写盘（纯浏览守卫，K156）', async () => {
		const h = makeHarness();
		await h.session.load();
		// 不调 markLoadedFromEngine
		await h.session.flush();
		expect(h.disk.body).toBe('# A\n');
	});
});
