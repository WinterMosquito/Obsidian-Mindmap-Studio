/**
 * 图片保存：图片文件入库（遵循附件存放位置规则）、文件名清理。
 * 从 images.ts 拆出；地址解析回库内文件统一走 links-resolve.resolvePathToFile。
 */
import { App, Notice, TFile, normalizePath } from 'obsidian';
import { isImageExtension } from './constants';
import { createSerialQueue } from './concurrency';
import { notifyError } from './errors';
import { t, tf, type Language } from './i18n';

/**
 * 图片保存走全局串行队列原语：「文件名选择 + vault 写入」非原子，
 * 并发保存同名图片若各自通过存在性检查再分别 createBinary，会写同一目标
 * （TOCTOU，后写覆盖先写）。排队执行保证互斥原子性。
 */
const saveQueue = createSerialQueue();

/** 清理文件名中的非法字符（含控制字符） */
export function sanitizeFileName(name: string): string {
	let result = '';
	for (const char of name) {
		const code = char.charCodeAt(0);
		result += code < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char;
	}
	return result;
}

/**
 * 按 Unicode 码点截断文本。
 * 直接用 slice 会把 emoji 等代理对（surrogate pair）切成半个字符，
 * 落到文件名里就是乱码。
 */
function truncateByCodePoint(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join('');
}

/**
 * 保存图片到库的参数。
 *
 * 采用对象参数而非位置参数：本函数有 6 个形参、其中 4 个可选，
 * 位置传参极易错位（曾发生把 `lang` 传给 `preferredName` 的事故，
 * 因 Language 是 string 的子类型，TypeScript 完全不报错）。
 */
export interface SaveImageOptions {
	/** Obsidian App 实例 */
	app: App;
	/** 当前思维导图文件路径（用于确定附件目录） */
	sourcePath: string;
	/** 要保存的图片文件 */
	file: File;
	/** 大小上限（MB），默认 10 */
	maxSizeMB?: number;
	/** 可选真实文件名（text/uri-list 解码，修复乱码） */
	preferredName?: string;
	/**
	 * 显式命名（最高优先级，覆盖 File.name 与 preferredName）：
	 * 剪贴板粘贴按 Obsidian 核心约定命名（Pasted image YYYYMMDDHHMMSS）时使用。
	 */
	filename?: string;
	/** 提示语言，默认 'zh' */
	lang?: Language;
}

/**
 * Obsidian 核心的粘贴图片命名约定：`Pasted image YYYYMMDDHHMMSS`。
 * 见官方帮助「Editing and formatting/Attachments」——粘贴的附件由 Obsidian
 * 在默认附件位置创建文件；核心实际命名即此前缀 + 秒级时间戳（不本地化），
 * 用户的工作流（搜索、反链、笔记引用）依赖该约定，故对齐。
 */
export function buildPastedImageName(now = new Date()): string {
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `Pasted image ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
		now.getDate(),
	)}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 将图片文件保存到库的附件目录。
 * 存储路径遵循 Obsidian 系统设置中的"附件存放位置"规则
 * （通过 `fileManager.getAvailablePathForAttachment` 获取）。
 *
 * 保存串行化：「文件名选择 + 写入」在内部排队（见文件头 saveQueue）。
 * @returns 保存后的 TFile；失败时返回 null 并弹提示
 */
export function saveImageToVault(
	options: SaveImageOptions,
): Promise<TFile | null> {
	return saveQueue(() => saveImageToVaultInner(options));
}

async function saveImageToVaultInner({
	app,
	sourcePath,
	file,
	maxSizeMB = 10,
	preferredName,
	filename,
	lang = 'zh',
}: SaveImageOptions): Promise<TFile | null> {
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	const isImage = file.type.startsWith('image/') || isImageExtension(ext);
	if (!isImage) {
		new Notice(t(lang, 'attachment.chooseImage'));
		return null;
	}
	const maxBytes = maxSizeMB * 1024 * 1024;
	if (file.size > maxBytes) {
		const sizeMB = (file.size / 1024 / 1024).toFixed(1);
		new Notice(
			tf(lang, 'attachment.tooLarge', { size: sizeMB, max: maxSizeMB }),
		);
		return null;
	}
	try {
		// 文件名选择与乱码修复：
		// 1. filename 显式命名最高优先（粘贴图片的 Obsidian 核心约定命名）；
		// 2. 默认用 File.name（用户拖入文件的真实原名，如「冬天.jpeg」）；
		// 3. 仅当 File.name 含乱码标志 U+FFFD（部分 Windows 来源被系统 ANSI
		//    代码页错误解码）时，才改用 preferredName（text/uri-list 解码名）；
		//    避免 preferredName 在个别来源中被错误转写而覆盖用户原名；
		// 4. 按 Unicode 码点截断，避免把 emoji 等代理对切成乱码。
		const needsNameFix = file.name.includes('\uFFFD');
		const rawName = needsNameFix && preferredName ? preferredName : file.name;
		const safeName = rawName.includes('\uFFFD') ? '' : rawName;
		const baseName = filename
			? sanitizeFileName(truncateByCodePoint(filename, 50))
			: sanitizeFileName(
					truncateByCodePoint(
						safeName.replace(/\.[^.]+$/, '') || 'image',
						50,
					),
				);
		// 文件名保持原名（不加时间戳/随机后缀）；
		// 遵循系统「附件存放位置」设置：必须传入 sourcePath。
		const fileName = `${baseName}.${ext}`;
		let availablePath = normalizePath(
			await app.fileManager.getAvailablePathForAttachment(
				fileName,
				sourcePath,
			),
		);
		// 重名兜底：目标已存在时按 Obsidian 惯例追加序号（"名称 1"、"名称 2"…）。
		// 不依赖 getAvailablePathForAttachment 的具体重名策略，
		// 也避免并发/历史同名文件被覆盖。
		let retry = 0;
		while (app.vault.getAbstractFileByPath(availablePath) && retry < 100) {
			retry++;
			availablePath = normalizePath(
				await app.fileManager.getAvailablePathForAttachment(
					`${baseName} ${retry}.${ext}`,
					sourcePath,
				),
			);
		}
		const targetPath = normalizePath(availablePath);
		const folder = targetPath.substring(0, targetPath.lastIndexOf('/'));
		if (folder && !app.vault.getAbstractFileByPath(folder)) {
			try {
				await app.vault.createFolder(folder);
			} catch {
				// 目录已存在等情况忽略
			}
		}
		const data = await file.arrayBuffer();
		return await app.vault.createBinary(targetPath, data);
	} catch (error) {
		console.error('保存图片失败', error);
		notifyError(lang, 'attachment.saveFailed', error);
		return null;
	}
}
