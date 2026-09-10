/**
 * 剪贴板图片命名与保存层文件名优先级回归（images-save.ts）。
 *
 * 命名对齐 **Obsidian 核心实际行为**（社区惯例）：粘贴的附件名为
 * `Pasted image YYYYMMDDHHMMSS`（不本地化）。官方帮助只规定「粘贴的附件存到
 * 默认附件位置」，未规定文件名格式——这里锁的是核心行为，因为用户既有工作流
 * （按名字搜索/引用粘贴图）依赖它。
 *
 * 保存层的文件名选择顺序（`filename` > `File.name` > `preferredName`）同样要锁死：
 * - `filename` 是**显式命名**（粘贴路径专用），必须覆盖其余两个候选；
 * - `preferredName`（text/uri-list 解码名）只在 `File.name` 含乱码标志 U+FFFD
 *   时启用——否则会把用户真实原名覆盖成平台转写名。
 * 故本文件按「优先级矩阵 + 精确落盘路径」断言，而不是只断言「保存成功」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { TFile as TFileClass } from 'obsidian';
import {
	buildPastedImageName,
	sanitizeFileName,
	saveImageToVault,
} from '../src/images-save';

describe('buildPastedImageName（Obsidian 粘贴命名约定）', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('默认取系统当前时间：Pasted image YYYYMMDDHHMMSS（fake timers 固定时钟）', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 6, 21, 5, 3));
		// 无参调用走 `now = new Date()`，是粘贴路径真实使用的形态
		expect(buildPastedImageName()).toBe('Pasted image 20260906210503');
	});

	it('月/日/时/分/秒逐位补零，跨年边界同样成立', () => {
		const cases: [Date, string][] = [
			[new Date(2026, 0, 4, 7, 8, 9), 'Pasted image 20260104070809'],
			[new Date(2026, 0, 1, 0, 0, 0), 'Pasted image 20260101000000'],
			[new Date(2026, 11, 31, 23, 59, 59), 'Pasted image 20261231235959'],
			// 闰日
			[new Date(2024, 1, 29, 12, 0, 0), 'Pasted image 20240229120000'],
			// 两位月/日与两位时分秒：不做多余补零
			[new Date(2026, 9, 18, 15, 42, 7), 'Pasted image 20261018154207'],
		];
		for (const [date, expected] of cases) {
			expect(buildPastedImageName(date)).toBe(expected);
		}
	});

	it('名称本身不含路径分隔符与扩展名（扩展名由保存层按文件类型追加）', () => {
		const name = buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3));
		expect(name.startsWith('Pasted image ')).toBe(true);
		expect(name).not.toMatch(/[/\\]/);
		expect(name).not.toContain('.');
	});

	it('时间粒度到秒：同一秒内两次粘贴同名，由保存层的重名兜底区分', () => {
		expect(buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3))).toBe(
			buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3)),
		);
		expect(buildPastedImageName(new Date(2026, 8, 6, 21, 5, 4))).toBe(
			'Pasted image 20260906210504',
		);
	});
});

describe('sanitizeFileName（Obsidian 文件名约束）', () => {
	it('替换文件系统禁止字符与控制字符', () => {
		const cases: [string, string][] = [
			['a<b>c:d"e/f\\g|h?i*j', 'a_b_c_d_e_f_g_h_i_j'],
			['换\u0000行', '换_行'],
			// Obsidian 额外禁止的 # ^ [ ]（含这些字符的名字无法被双链引用）
			['标题#锚点', '标题_锚点'],
			['报告[1]^2', '报告_1__2'],
			// 结尾的点/空格（核心 checkPath 直接抛错）
			['结尾点.', '结尾点'],
			['结尾空格  ', '结尾空格'],
			// Windows 保留设备名（核心同样拒绝）
			['CON', 'CON_'],
			['com1', 'com1_'],
			['console', 'console'],
			// 全部字符被清理时返回空串（调用方兜底命名）
			['...', ''],
		];
		for (const [input, expected] of cases) {
			expect(sanitizeFileName(input)).toBe(expected);
		}
	});
});

/** 图片 File 桩：保存层只读 name/type/size 与 arrayBuffer() */
function fakeImageFile(
	name: string,
	size = 1024,
	type = 'image/png',
): File {
	return {
		name,
		type,
		size,
		arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(size),
	} as unknown as File;
}

interface VaultStub {
	app: App;
	/** createBinary 落盘记录（path 即最终文件路径） */
	created: { path: string; data: ArrayBuffer }[];
	/** getAvailablePathForAttachment 收到的 (fileName, sourcePath) */
	attachmentQueries: string[];
	createdFolders: string[];
}

/**
 * App 桩：附件目录解析恒返回 `attachments/<name>`（隔离 Obsidian 自身的
 * 重名策略，便于断言保存层自己的重名兜底循环）。
 */
function makeVaultStub(takenPaths: string[] = []): VaultStub {
	const taken = new Set(takenPaths);
	const created: { path: string; data: ArrayBuffer }[] = [];
	const attachmentQueries: string[] = [];
	const createdFolders: string[] = [];
	const app = {
		fileManager: {
			getAvailablePathForAttachment: async (
				fileName: string,
				sourcePath: string,
			): Promise<string> => {
				attachmentQueries.push(`${fileName}@${sourcePath}`);
				return `attachments/${fileName}`;
			},
		},
		vault: {
			getFileByPath: (path: string): TFile | null =>
				taken.has(path) ? Object.assign(new TFileClass(), { path }) : null,
			getFolderByPath: (path: string): object | null =>
				path === 'attachments' ? {} : null,
			createFolder: async (path: string): Promise<void> => {
				createdFolders.push(path);
			},
			createBinary: async (path: string, data: ArrayBuffer): Promise<TFile> => {
				created.push({ path, data });
				return Object.assign(new TFileClass(), { path });
			},
		},
	};
	return {
		app: app as unknown as App,
		created,
		attachmentQueries,
		createdFolders,
	};
}

describe('saveImageToVault 文件名优先级（filename > File.name > preferredName）', () => {
	it('filename 显式命名最高优先：覆盖 File.name 与 preferredName（仅粘贴路径使用）', async () => {
		const vault = makeVaultStub();
		const file = fakeImageFile('clipboard.png'); // 剪贴板来源的通用名
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'notes/a.mindmap.md',
			file,
			preferredName: '平台转写名.png',
			filename: buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3)),
		});

		expect(result?.path).toBe('attachments/Pasted image 20260906210503.png');
		expect(vault.created.map((entry) => entry.path)).toEqual([
			'attachments/Pasted image 20260906210503.png',
		]);
		// sourcePath 透传给官方附件路径解析（遵循「附件默认存放路径」设置）
		expect(vault.attachmentQueries).toEqual([
			'Pasted image 20260906210503.png@notes/a.mindmap.md',
		]);
		// 扩展名按 File.name 的小写化后缀追加
		expect(vault.createdFolders).toEqual([]);
	});

	it('无 filename 时用 File.name（拖入/外部粘贴的真实原名），preferredName 被忽略', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('冬天.jpeg'),
			preferredName: 'winter.jpeg',
		});
		// 原名不含乱码标志：绝不用 preferredName 覆盖用户文件名
		expect(result?.path).toBe('attachments/冬天.jpeg');
	});

	it('仅当 File.name 含乱码标志 U+FFFD 时改用 preferredName（text/uri-list 解码名）', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('\uFFFD\uFFFD.png'),
			preferredName: '春天.png',
		});
		expect(result?.path).toBe('attachments/春天.png');
	});

	it('File.name 与 preferredName 都含乱码：兜底名 image', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('\uFFFD.png'),
			preferredName: '\uFFFD\uFFFD.png',
		});
		expect(result?.path).toBe('attachments/image.png');
	});

	it('filename 为空串视为未提供（falsy 回落 File.name）', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('shot.png'),
			filename: '',
		});
		expect(result?.path).toBe('attachments/shot.png');
	});

	it('显式命名按 Unicode 码点截断到 50 字符（代理对不被切成半个字符）', async () => {
		const vault = makeVaultStub();
		const emoji = '😀'.repeat(60);
		await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('clipboard.png'),
			filename: emoji,
		});
		expect(vault.created[0]?.path).toBe(`attachments/${'😀'.repeat(50)}.png`);
	});

	it('同一秒内重复粘贴：目标已存在时按 Obsidian 惯例追加序号', async () => {
		const pasted = buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3));
		const vault = makeVaultStub([`attachments/${pasted}.png`]);
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('clipboard.png'),
			filename: pasted,
		});
		expect(result?.path).toBe(`attachments/${pasted} 1.png`);
		expect(vault.attachmentQueries).toEqual([
			`${pasted}.png@a.mindmap.md`,
			`${pasted} 1.png@a.mindmap.md`,
		]);
	});

	it('扩展名统一小写化（File.name 后缀大小写不影响落盘名）', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			// 无 MIME 类型时经 isImageExtension 兜底判定为图片
			file: fakeImageFile('图.PNG', 1024, ''),
		});
		expect(result?.path).toBe('attachments/图.png');
	});

	it('非图片文件不写库（返回 null）', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('note.txt', 1024, 'text/plain'),
		});
		expect(result).toBeNull();
		expect(vault.created).toHaveLength(0);
		expect(vault.attachmentQueries).toEqual([]);
	});

	it('超过大小上限不写库（返回 null）', async () => {
		const vault = makeVaultStub();
		const result = await saveImageToVault({
			app: vault.app,
			sourcePath: 'a.mindmap.md',
			file: fakeImageFile('big.png', 2 * 1024 * 1024),
			filename: 'Pasted image 20260906210503',
			maxSizeMB: 1,
		});
		expect(result).toBeNull();
		expect(vault.created).toHaveLength(0);
	});
});
