/**
 * 新建思维导图的**落点判定**回归（src/creation.ts）。
 *
 * 覆盖点（每条对应一次真实缺陷或一条路径约定）：
 * - 库根目录（`folderPath === ''`）是**合法取值**，不得回落默认解析。
 *   原实现用 `folderPath || ...` 会把「显式指定库根」误判成「未指定」，
 *   文件被静默建到别的目录（文件浏览器里对着库根点「新建思维导图」即触发）。
 * - `undefined` 才是「未指定」，此时按设置 `saveLocation` 四档解析
 *   （`obsidian` 跟随官方 getNewFileParent / `root` / `current` / `folder`），
 *   规则与 Obsidian Canvas 同口径：
 *   - `obsidian`：sourcePath 传活动文件路径（无活动文件传空串，官方 d.ts 约定）；
 *   - `current`：活动文件父目录（无活动文件 → 库根）；`MindMapView` 是
 *     `FileView`，故导图视图下取到本导图所在文件夹（d.ts getActiveFile 注释）；
 *   - `folder`：文件夹不存在 → **静默**回落库根、不自动创建（对齐 Canvas）；
 * - 库根 TFolder（实机 path 为 `'/'`）归一为**空串**：库内相对路径不带前导
 *   斜杠。官方 `normalizePath` **确实**承诺剥离前导斜杠（obsidian.d.ts 示例
 *   `normalizePath('/foo/bar'); // foo/bar`）；本实现刻意**不依赖**它——
 *   用 `TFolder.isRoot()` 判定后归一（口径与 `src/creation.ts` 的注释同源）。
 * - 存在性检查（重名追加序号）与最终 create 用**同一套**路径口径。
 *
 * 为什么自建 obsidian 桩：仓库 mock（tests/mocks/obsidian.ts）的 App 是空类，
 * 断言全部落在「vault.create 收到的路径」「getNewFileParent 的 sourcePath」上，
 * 故只需一个记录型 App 桩；弹窗与打开方式用 vi.mock 整模块替换，
 * 不测其内部行为（那部分由 modal-input.test.ts 负责）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { createNewMindMap, type NewMindMapSettings } from '../src/creation';

/** 用例间清空 mock 调用记录（两个 describe 共用，故置于文件级） */
beforeEach(() => {
	vi.clearAllMocks();
});

/** 弹窗确认后返回的文件名（不含扩展名，`.md` 由 creation 补） */
const TYPED_NAME = '测试导图';

/** 错误提示通道：用于区分「创建失败」与「已创建但打开失败」两条错误边界 */
const errors = vi.hoisted(() => ({ notifyError: vi.fn() }));
vi.mock('../src/core/errors', () => errors);

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

/** 文件夹桩：只含实现消费的面（isRoot 判定 + path） */
interface FolderStub {
	readonly path: string;
	readonly isRoot: () => boolean;
}

/** 库根：实机 `getRoot().path === '/'`（本次改动前实测），isRoot 为真 */
const ROOT_FOLDER: FolderStub = { path: '/', isRoot: () => true };

/** 非根文件夹桩 */
function folderStub(path: string): FolderStub {
	return { path, isRoot: () => false };
}

/** 活动文件桩：parent 为文件夹桩 */
interface ActiveFileStub {
	readonly path: string;
	readonly parent: FolderStub;
}

interface StubOptions {
	/** getNewFileParent 的返回值（`obsidian` 档；缺省为库根） */
	readonly parentFallback?: FolderStub;
	/** 当前活动文件（缺省 null＝无活动文件） */
	readonly activeFile?: ActiveFileStub | null;
	/** 库内已存在的文件夹（`folder` 档/归一断言的查询面） */
	readonly folders?: readonly FolderStub[];
	/** 已存在的文件路径集合（供重名序号分支命中） */
	readonly existingPaths?: ReadonlySet<string>;
	/** 落盘即失败（`vault.create` 抛错：无任何副作用） */
	readonly createFails?: boolean;
	/** 落盘成功但打开失败（`leaf.openFile` 抛错：文件已在库中） */
	readonly openFileFails?: boolean;
}

/** 记录型 App 桩 */
interface StubApp {
	readonly app: App;
	readonly created: CreatedFile[];
	/** getNewFileParent 收到的 sourcePath 序列（含「不该调用」的零次断言） */
	readonly parentSourcePaths: string[];
	/** 存在性检查实际用过的路径（用于「同一口径」断言） */
	readonly probedPaths: string[];
}

function createStubApp(options: StubOptions = {}): StubApp {
	const created: CreatedFile[] = [];
	const probed: string[] = [];
	const parentSourcePaths: string[] = [];
	const folderByPath = new Map<string, FolderStub>(
		(options.folders ?? []).map((folder) => [folder.path, folder]),
	);
	const activeFile = options.activeFile ?? null;
	const app = {
		vault: {
			create: vi.fn(async (path: string, content: string) => {
				if (options.createFails) {
					throw new Error('创建失败（桩）');
				}
				created.push({ path, content });
				return { path };
			}),
			getFileByPath: vi.fn((path: string) => {
				probed.push(path);
				return options.existingPaths?.has(path) ? { path } : null;
			}),
			getFolderByPath: vi.fn((path: string) => {
				// 实机：getFolderByPath('/') 返回根（本次改动前实测）
				if (path === '/') {
					return ROOT_FOLDER;
				}
				return folderByPath.get(path) ?? null;
			}),
			getRoot: vi.fn(() => ROOT_FOLDER),
		},
		fileManager: {
			getNewFileParent: vi.fn((sourcePath: string) => {
				parentSourcePaths.push(sourcePath);
				return options.parentFallback ?? ROOT_FOLDER;
			}),
		},
		workspace: {
			getActiveFile: vi.fn(() => activeFile),
			getLeaf: vi.fn(() => ({
				openFile: vi.fn(async () => {
					if (options.openFileFails) {
						throw new Error('打开失败（桩）');
					}
				}),
			})),
		},
	};
	return {
		app: app as unknown as App,
		created,
		parentSourcePaths,
		probedPaths: probed,
	};
}

/** 设置桩：默认档＝跟随 Obsidian（与 DEFAULT_SETTINGS 同口径） */
function settingsStub(
	overrides: Partial<NewMindMapSettings> = {},
): NewMindMapSettings {
	return {
		language: 'zh',
		saveLocation: 'obsidian',
		saveFolder: '',
		// 与 DEFAULT_SETTINGS.defaultLayout 同口径：它是新建文件的**种子**布局
		defaultLayout: 'logicalStructure',
		...overrides,
	};
}

/** 期望的文件名（新建一律是普通 `.md`；导图身份靠正文的属性声明） */
function expectedFileName(): string {
	return `${TYPED_NAME}.md`;
}

describe('新建思维导图的落点判定', () => {
	describe('显式落点（右键文件夹 /「在当前文件夹新建」）：不受设置影响', () => {
		it('库根目录：空串是合法落点，既不回落默认解析也不产生前导斜杠', async () => {
			const stub = createStubApp({ parentFallback: folderStub('别处的目录') });
			await createNewMindMap(stub.app, settingsStub(), '');
			expect(stub.parentSourcePaths).toEqual([]);
			expect(stub.created).toHaveLength(1);
			expect(stub.created[0]?.path).toBe(expectedFileName());
			expect(stub.created[0]?.path.startsWith('/')).toBe(false);
			// 导图身份来自正文的属性声明（标准键 `Mindmap`，与语言无关）；
			// 值是**种子布局**的标准值（默认逻辑结构图 → LogicalStructure）
			expect(
				stub.created[0]?.content.startsWith('---\nMindmap: LogicalStructure\n---\n'),
			).toBe(true);
		});

		it('种子布局取设置 defaultLayout：思维导图 → `Mindmap: Mindmap`', async () => {
			const stub = createStubApp();
			await createNewMindMap(
				stub.app,
				settingsStub({ defaultLayout: 'mindMap' }),
				'',
			);
			expect(
				stub.created[0]?.content.startsWith('---\nMindmap: Mindmap\n---\n'),
			).toBe(true);
		});

		it('指定目录：拼接为「目录/名称」，存在性检查用同一路径口径', async () => {
			const stub = createStubApp();
			await createNewMindMap(stub.app, settingsStub(), '子目录/更深的目录');
			expect(stub.created[0]?.path).toBe(
				`子目录/更深的目录/${expectedFileName()}`,
			);
			expect(stub.probedPaths).toContain(
				`子目录/更深的目录/${expectedFileName()}`,
			);
		});
	});

	describe('未指定落点：按设置 saveLocation 解析', () => {
		it('obsidian（默认档）：把活动文件路径交给官方 getNewFileParent', async () => {
			const stub = createStubApp({
				parentFallback: folderStub('官方默认目录'),
				activeFile: { path: 'A/B/笔记.md', parent: folderStub('A/B') },
			});
			await createNewMindMap(stub.app, settingsStub(), undefined);
			expect(stub.parentSourcePaths).toEqual(['A/B/笔记.md']);
			expect(stub.created[0]?.path).toBe(`官方默认目录/${expectedFileName()}`);
		});

		it('obsidian：无活动文件时传空串（官方 d.ts 约定）', async () => {
			const stub = createStubApp({
				parentFallback: folderStub('官方默认目录'),
				activeFile: null,
			});
			await createNewMindMap(stub.app, settingsStub(), undefined);
			expect(stub.parentSourcePaths).toEqual(['']);
		});

		it('obsidian：官方回落根目录（实机 path 为 "/"）时归一为空串，不产生前导斜杠', async () => {
			const stub = createStubApp({ parentFallback: ROOT_FOLDER });
			await createNewMindMap(stub.app, settingsStub(), undefined);
			expect(stub.created[0]?.path).toBe(expectedFileName());
		});

		it('root 档：不调 getNewFileParent，直接落库根（同样归一无前导斜杠）', async () => {
			const stub = createStubApp();
			await createNewMindMap(
				stub.app,
				settingsStub({ saveLocation: 'root' }),
				undefined,
			);
			expect(stub.parentSourcePaths).toEqual([]);
			expect(stub.created[0]?.path).toBe(expectedFileName());
		});

		it('current 档：落活动文件所在文件夹（导图视图下即本导图所在文件夹）', async () => {
			const stub = createStubApp({
				activeFile: {
					path: '笔记/导图/当前导图.md',
					parent: folderStub('笔记/导图'),
				},
			});
			await createNewMindMap(
				stub.app,
				settingsStub({ saveLocation: 'current' }),
				undefined,
			);
			expect(stub.parentSourcePaths).toEqual([]);
			expect(stub.created[0]?.path).toBe(`笔记/导图/${expectedFileName()}`);
		});

		it('current 档：无活动文件 → 库根', async () => {
			const stub = createStubApp({ activeFile: null });
			await createNewMindMap(
				stub.app,
				settingsStub({ saveLocation: 'current' }),
				undefined,
			);
			expect(stub.created[0]?.path).toBe(expectedFileName());
		});

		it('folder 档：指定文件夹存在 → 用它', async () => {
			const stub = createStubApp({
				folders: [folderStub('笔记/导图')],
			});
			await createNewMindMap(
				stub.app,
				settingsStub({ saveLocation: 'folder', saveFolder: '笔记/导图' }),
				undefined,
			);
			expect(stub.parentSourcePaths).toEqual([]);
			expect(stub.created[0]?.path).toBe(`笔记/导图/${expectedFileName()}`);
		});

		it('folder 档：文件夹不存在/未配置 → 静默回落库根（对齐 Canvas，不自动创建）', async () => {
			const missing = createStubApp();
			await createNewMindMap(
				missing.app,
				settingsStub({ saveLocation: 'folder', saveFolder: '已被删除' }),
				undefined,
			);
			expect(missing.created[0]?.path).toBe(expectedFileName());

			const empty = createStubApp();
			await createNewMindMap(
				empty.app,
				settingsStub({ saveLocation: 'folder', saveFolder: '' }),
				undefined,
			);
			expect(empty.created[0]?.path).toBe(expectedFileName());
		});
	});

	it('库根 + 重名：按 Obsidian 惯例追加序号，仍不带前导斜杠', async () => {
		const stub = createStubApp({ existingPaths: new Set([expectedFileName()]) });
		await createNewMindMap(stub.app, settingsStub(), '');
		// 首次探针用库根口径（不带前导斜杠），命中后追加序号 1
		expect(stub.probedPaths[0]).toBe(expectedFileName());
		expect(stub.created[0]?.path).toBe('测试导图 1.md');
	});
});

/**
 * 错误边界（2026-10-17）：创建与打开是**两段**副作用——
 * - `vault.create` 失败：库里什么都没有，提示「创建失败」准确；
 * - `leaf.openFile` 失败：文件已在库中，沿用「创建失败」会诱导用户重试，
 *   在同目录产生 `名称 1.md` 之类的重复文件。
 */
describe('创建与打开的错误边界', () => {
	it('创建失败：提示「创建失败」，不产生文件', async () => {
		const stub = createStubApp({ createFails: true });

		await createNewMindMap(stub.app, settingsStub(), '');

		expect(stub.created).toHaveLength(0);
		expect(errors.notifyError).toHaveBeenCalledTimes(1);
		expect(errors.notifyError).toHaveBeenCalledWith(
			'zh',
			'command.createFailed',
			expect.any(Error),
		);
	});

	it('打开失败：文件保留在库中，提示「已创建但打开失败」而非「创建失败」', async () => {
		const stub = createStubApp({ openFileFails: true });

		await createNewMindMap(stub.app, settingsStub(), '');

		// 文件已落盘：不得因打开失败而被回滚，也不得重报创建失败
		expect(stub.created).toHaveLength(1);
		expect(errors.notifyError).toHaveBeenCalledTimes(1);
		expect(errors.notifyError).toHaveBeenCalledWith(
			'zh',
			'command.openFailed',
			expect.any(Error),
		);
	});
});
