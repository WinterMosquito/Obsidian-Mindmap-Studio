/**
 * 新建思维导图的**落点判定**回归（src/creation.ts）。
 *
 * 覆盖点（每条对应一次真实缺陷或一条路径约定）：
 * - 库根目录（`folderPath === ''`）是**合法取值**，不得回落
 *   `fileManager.getNewFileParent('')`。Obsidian 库根的 path 就是空串，
 *   原实现用 `folderPath || ...` 会把「显式指定库根」误判成「未指定」，
 *   文件被静默建到别的目录（文件浏览器里对着库根点「新建思维导图」即触发）。
 * - `undefined` 才是「未指定」，此时才回落 `getNewFileParent`。
 * - 拼接口径：库根产出 `名称.mindmap.md`（**不带前导斜杠**），子目录产出
 *   `目录/名称.mindmap.md`——不为前导斜杠依赖 `normalizePath` 的未承诺行为。
 * - 存在性检查（重名追加序号）与最终 create 用**同一套**路径口径。
 *
 * 为什么自建 obsidian 桩：仓库 mock（tests/mocks/obsidian.ts）的 App 是空类，
 * 断言全部落在「vault.create 收到的路径」与「getNewFileParent 是否被调用」上，
 * 故只需一个记录型App 桩；弹窗与打开方式用 vi.mock 整模块替换，
 * 不测其内部行为（那部分由 modal-input.test.ts 负责）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { withMindMapMarker } from '../src/core/constants';
import { createNewMindMap } from '../src/creation';

/** 弹窗确认后返回的文件名（不含扩展名，扩展名由 withMindMapMarker 补） */
const TYPED_NAME = '测试导图';

vi.mock('../src/ui/modal-name', () => ({
	openNameInputModal: vi.fn(async () => TYPED_NAME),
}));

vi.mock('../src/markdown/md-open', () => ({
	openAsMindMap: vi.fn(async () => undefined),
}));

/** create 落点记录（断言面：路径与内容） */
interface CreatedFile {
	readonly path: string;
	readonly content: string;
}

/** 已存在的路径集合（供重名序号分支命中） */
interface StubApp {
	readonly app: App;
	readonly created: CreatedFile[];
	/** getNewFileParent 的调用次数（用于「不该回落」的断言） */
	readonly fallbackCalls: () => number;
	/** 存在性检查实际用过的路径（用于「同一口径」断言） */
	readonly probedPaths: () => string[];
}

/**
 * 记录型 App 桩。
 * @param newFileParentPath `getNewFileParent` 的返回路径（回落分支用）
 * @param existingPaths 已存在的路径（命中即视为重名）
 */
function createStubApp(
	newFileParentPath: string,
	existingPaths: ReadonlySet<string> = new Set(),
): StubApp {
	const created: CreatedFile[] = [];
	const probed: string[] = [];
	let fallbackCalls = 0;
	const app = {
		vault: {
			create: vi.fn(async (path: string, content: string) => {
				created.push({ path, content });
				return { path };
			}),
			getFileByPath: vi.fn((path: string) => {
				probed.push(path);
				return existingPaths.has(path) ? { path } : null;
			}),
			getFolderByPath: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => {
				fallbackCalls++;
				return { path: newFileParentPath };
			}),
		},
		workspace: {
			getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => undefined) })),
		},
	};
	return {
		app: app as unknown as App,
		created,
		fallbackCalls: () => fallbackCalls,
		probedPaths: () => probed,
	};
}

/** 期望的文件名（走生产代码的扩展名口径，避免测试里硬编码 '.mindmap.md'） */
function expectedFileName(): string {
	return withMindMapMarker(TYPED_NAME);
}

describe('新建思维导图的落点判定', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('库根目录：空串是合法落点，既不回落默认目录也不产生前导斜杠', async () => {
		const stub = createStubApp('别处的目录');
		await createNewMindMap(stub.app, 'zh', '');
		expect(stub.fallbackCalls()).toBe(0);
		expect(stub.created).toHaveLength(1);
		expect(stub.created[0]?.path).toBe(expectedFileName());
		expect(stub.created[0]?.path.startsWith('/')).toBe(false);
	});

	it('指定目录：拼接为「目录/名称」，存在性检查用同一路径口径', async () => {
		const stub = createStubApp('别处的目录');
		await createNewMindMap(stub.app, 'zh', '子目录/更深的目录');
		expect(stub.fallbackCalls()).toBe(0);
		expect(stub.created[0]?.path).toBe(
			`子目录/更深的目录/${expectedFileName()}`,
		);
		expect(stub.probedPaths()).toContain(
			`子目录/更深的目录/${expectedFileName()}`,
		);
	});

	it('未指定目录（undefined）：回落 getNewFileParent 的路径', async () => {
		const stub = createStubApp('默认目录');
		await createNewMindMap(stub.app, 'zh', undefined);
		expect(stub.fallbackCalls()).toBe(1);
		expect(stub.created[0]?.path).toBe(`默认目录/${expectedFileName()}`);
	});

	it('库根 + 重名：按 Obsidian 惯例追加序号，仍不带前导斜杠', async () => {
		const stub = createStubApp('别处的目录', new Set([expectedFileName()]));
		await createNewMindMap(stub.app, 'zh', '');
		// 首次探针用库根口径（不带前导斜杠），命中后追加序号 1
		expect(stub.probedPaths()[0]).toBe(expectedFileName());
		expect(stub.created[0]?.path).toBe('测试导图 1.mindmap.md');
	});
});