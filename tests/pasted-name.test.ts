/**
 * 粘贴图片命名约定 + 文件名清理回归。
 *
 * 官方帮助「Editing and formatting/Attachments」：粘贴的附件由 Obsidian
 * 在默认附件位置创建文件；核心实际命名为 `Pasted image YYYYMMDDHHMMSS`
 * （不本地化），用户工作流依赖该约定。
 *
 * sanitizeFileName 覆盖 Obsidian 自己的文件名约束（核心 `msgUnsafeCharacters`
 * 与 `Vault.checkPath`）：含 `# ^ [ ]` 的名字无法被双链正确引用，以点/空格
 * 结尾或 CON/PRN 等保留名会被核心直接拒绝。
 */
import { describe, expect, it } from 'vitest';
import { buildPastedImageName, sanitizeFileName } from '../src/images-save';

describe('buildPastedImageName（Obsidian 粘贴命名约定）', () => {
	it('按 Pasted image YYYYMMDDHHMMSS 格式命名', () => {
		const name = buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3));
		expect(name).toBe('Pasted image 20260906210503');
	});

	it('单位数月/日/时/分/秒补零', () => {
		const name = buildPastedImageName(new Date(2026, 0, 4, 7, 8, 9));
		expect(name).toBe('Pasted image 20260104070809');
	});

	it('不含路径分隔符与扩展名（扩展名由保存层按文件类型追加）', () => {
		const name = buildPastedImageName(new Date(2026, 8, 6, 21, 5, 3));
		expect(name).not.toMatch(/[/\\]/);
		expect(name).not.toContain('.');
	});
});

describe('sanitizeFileName（Obsidian 文件名约束）', () => {
	it('替换文件系统禁止字符与控制字符', () => {
		expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe(
			'a_b_c_d_e_f_g_h_i_j',
		);
		expect(sanitizeFileName('换\u0000行')).toBe('换_行');
	});

	it('替换 Obsidian 额外禁止的 # ^ [ ]（含这些字符的名字无法被双链引用）', () => {
		expect(sanitizeFileName('标题#锚点')).toBe('标题_锚点');
		expect(sanitizeFileName('报告[1]^2')).toBe('报告_1__2');
	});

	it('去掉结尾的点与空格（核心 checkPath 直接抛错）', () => {
		expect(sanitizeFileName('结尾点.')).toBe('结尾点');
		expect(sanitizeFileName('结尾空格 ')).toBe('结尾空格');
		expect(sanitizeFileName('点与空格. ')).toBe('点与空格');
	});

	it('Windows 保留名加后缀（CON/PRN/COM1… 核心拒绝）', () => {
		expect(sanitizeFileName('CON')).toBe('CON_');
		expect(sanitizeFileName('com1')).toBe('com1_');
		expect(sanitizeFileName('console')).toBe('console');
	});

	it('全部字符被清理时返回空串（由调用方兜底命名）', () => {
		expect(sanitizeFileName('***')).toBe('___');
		expect(sanitizeFileName('...')).toBe('');
	});
});
