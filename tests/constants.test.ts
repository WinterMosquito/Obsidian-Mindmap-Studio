/**
 * 扩展名清单边界：文档类（md / canvas / base）与「Obsidian 标签页可渲染」两套判定。
 *
 * 为什么单独成文件：它们各自决定不同的用户可见行为——
 * - `isDocumentExtension` / `wikilinkTargetIsAttachment`（domain/wikilink）→ 双链算文档
 *   （自绘文档页图标）还是附件（回形针）——**这是分流的权威口径**，拖入、联想、点击
 *   三条路径共用（2026-09-15 收敛：`constants` 里的「可链接附件」与「系统媒体」两份
 *   白名单已删除，它们比解析侧窄且与新行为脱节）；
 * - `canOpenInObsidian`（constants）→ 点击后开标签页，还是交系统默认应用
 *   （不可渲染的扩展名一律外跳，不再区分音视频）。
 * 改一处会同时影响解析、拖拽、弹窗与点击多条路径，故集中锁定。
 * 起因：`.base` 曾漏登记在 `canOpenInObsidian`，指向 base 的链接被误判「无法预览」
 * （Canvas/Bases 都是官方文档类文件，见 en/Plugins/Canvas.md、en/Bases/Views.md）。
 */
import { describe, expect, it } from 'vitest';
import {
	canOpenInObsidian,
	shouldEnablePerformanceMode,
} from '../src/core/constants';
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
		{ ext: 'docx', expected: false, why: '不可渲染 → 交系统默认应用（2026-09-15 起不再只弹提示）' },
		{ ext: 'exe', expected: false, why: '同上' },
		{ ext: 'zip', expected: false, why: '同上' },
		{ ext: 'mp5', expected: false, why: '未登记扩展名不猜测（同样交系统应用）' },
	])('canOpenInObsidian($ext) === $expected（$why）', ({ ext, expected }) => {
		expect(canOpenInObsidian(ext)).toBe(expected);
	});
});

describe('shouldEnablePerformanceMode — 性能模式阈值判据（创建期与运行期共用）', () => {
	it('开关关闭时无论节点多少都不启用', () => {
		expect(shouldEnablePerformanceMode(5000, false, 1)).toBe(false);
	});

	it('阈值边界：等于阈值即启用（>= 而非 >），差一个不启用', () => {
		expect(shouldEnablePerformanceMode(500, true, 500)).toBe(true);
		expect(shouldEnablePerformanceMode(499, true, 500)).toBe(false);
	});

	it('取值域不做钳制（由 sanitizeSettings 负责）：0 节点边界只按判据走', () => {
		expect(shouldEnablePerformanceMode(0, true, 0)).toBe(true);
		expect(shouldEnablePerformanceMode(0, true, 100)).toBe(false);
	});
});
