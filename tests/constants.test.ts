/**
 * 扩展名清单边界：文档类（md / canvas / base）、可链接附件、系统媒体、
 * 「Obsidian 标签页可渲染」四份清单的分流。
 *
 * 为什么单独成文件：这几份清单各自决定不同的用户可见行为——
 * - `isDocumentExtension`（domain/wikilink）→ 双链算文档（自绘文档页图标）还是附件（回形针）；
 * - `isLinkAttachmentExtension`（constants）→ 拖入/联想把它当可链接附件；
 * - `canOpenInObsidian`（constants）→ 点击后开标签页，还是提示「无法预览」；
 * - `isSystemMediaExtension`（constants）→ 音视频交系统默认应用。
 * 改一处会同时影响解析、拖拽、弹窗与点击多条路径，故集中锁定。
 * 起因：`.base` 曾漏登记在 `canOpenInObsidian`，指向 base 的链接被误判「无法预览」
 * （Canvas/Bases 都是官方文档类文件，见 en/Plugins/Canvas.md、en/Bases/Views.md）。
 */
import { describe, expect, it } from 'vitest';
import {
	canOpenInObsidian,
	isLinkAttachmentExtension,
	isSystemMediaExtension,
} from '../src/constants';
import { isDocumentExtension, wikilinkTargetIsAttachment } from '../src/domain/wikilink';

describe('isDocumentExtension / wikilinkTargetIsAttachment — 文档 vs 附件', () => {
	it.each([
		{ ext: 'md', doc: true, why: 'Markdown 笔记' },
		{ ext: 'canvas', doc: true, why: 'Canvas 是官方文档类文件' },
		{ ext: 'base', doc: true, why: 'Bases 是官方文档类文件' },
		{ ext: 'BASE', doc: true, why: '大小写不敏感' },
		{ ext: '', doc: false, why: '空扩展名不是文档类扩展名（无扩展名的链接另行判定）' },
		{ ext: 'pdf', doc: false, why: 'PDF 是附件' },
		{ ext: 'png', doc: false, why: '图片是附件（链接形态）；嵌入形态走节点图' },
	])('isDocumentExtension($ext) === $doc（$why）', ({ ext, doc }) => {
		expect(isDocumentExtension(ext)).toBe(doc);
	});

	it('链接目标的文档/附件分流与扩展名清单一致', () => {
		// 文档类 → 不是附件（走 mdWikiLinkpath 通道，自绘文档页图标）
		expect(wikilinkTargetIsAttachment('画布.canvas')).toBe(false);
		expect(wikilinkTargetIsAttachment('folder/看板.base#View')).toBe(false);
		// 非文档类含扩展名 → 附件（走 attachmentUrl 通道，回形针）
		expect(wikilinkTargetIsAttachment('报告.pdf')).toBe(true);
		expect(wikilinkTargetIsAttachment('图.png')).toBe(true);
		// 无扩展名 → 文档（Obsidian 默认语义）
		expect(wikilinkTargetIsAttachment('笔记')).toBe(false);
	});
});

describe('canOpenInObsidian — Obsidian 标签页可渲染清单', () => {
	it.each([
		{ ext: 'md', expected: true, why: '笔记' },
		{ ext: 'canvas', expected: true, why: 'Canvas 有标签页视图' },
		{ ext: 'base', expected: true, why: 'Bases 有标签页视图（漏登记会被误判「无法预览」）' },
		{ ext: 'BASE', expected: true, why: '大小写不敏感' },
		{ ext: 'pdf', expected: true, why: 'PDF 阅读器' },
		{ ext: 'png', expected: true, why: '图片查看' },
		{ ext: 'txt', expected: true, why: '纯文本以文本方式渲染，不空白' },
		{ ext: 'mp3', expected: false, why: '音频无标签页视图 → 交系统应用' },
		{ ext: 'mp4', expected: false, why: '视频无标签页视图 → 交系统应用' },
		{ ext: 'docx', expected: false, why: '不可预览 → 提示' },
		{ ext: 'exe', expected: false, why: '不可预览 → 提示' },
	])('canOpenInObsidian($ext) === $expected（$why）', ({ ext, expected }) => {
		expect(canOpenInObsidian(ext)).toBe(expected);
	});
});

describe('isLinkAttachmentExtension — 可链接附件清单', () => {
	it.each([
		{ ext: 'pdf', expected: true, why: 'PDF' },
		{ ext: 'epub', expected: true, why: '电子书' },
		{ ext: 'zip', expected: true, why: '压缩包' },
		{ ext: 'mp3', expected: true, why: '音频' },
		{ ext: 'mp4', expected: true, why: '视频' },
		{ ext: 'png', expected: false, why: '图片走 image 语义（![[…]]），不在附件清单' },
		{ ext: 'md', expected: false, why: 'md 是文档，不是附件' },
		{ ext: 'canvas', expected: false, why: 'Canvas 是文档类（见 isDocumentExtension）' },
		{ ext: 'base', expected: false, why: 'Bases 是文档类（见 isDocumentExtension）' },
	])('isLinkAttachmentExtension($ext) === $expected（$why）', ({ ext, expected }) => {
		expect(isLinkAttachmentExtension(ext)).toBe(expected);
	});
});

describe('isSystemMediaExtension — 系统媒体清单', () => {
	it.each([
		{ ext: 'mp3', expected: true, why: '音频交系统默认应用' },
		{ ext: 'mp4', expected: true, why: '视频交系统默认应用' },
		{ ext: 'MOV', expected: true, why: '大小写不敏感' },
		{ ext: 'pdf', expected: false, why: 'PDF 有 Obsidian 标签页视图' },
		{ ext: 'mp5', expected: false, why: '未登记扩展名不猜测' },
	])('isSystemMediaExtension($ext) === $expected（$why）', ({ ext, expected }) => {
		expect(isSystemMediaExtension(ext)).toBe(expected);
	});
});
