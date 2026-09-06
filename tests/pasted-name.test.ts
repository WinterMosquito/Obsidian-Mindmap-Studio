/**
 * 粘贴图片命名约定回归（对齐 Obsidian 核心行为）。
 *
 * 官方帮助「Editing and formatting/Attachments」：粘贴的附件由 Obsidian
 * 在默认附件位置创建文件；核心实际命名为 `Pasted image YYYYMMDDHHMMSS`
 * （不本地化），用户工作流依赖该约定。
 */
import { describe, expect, it } from 'vitest';
import { buildPastedImageName } from '../src/images-save';

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
