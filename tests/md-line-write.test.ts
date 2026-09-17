/**
 * 节点行内容**原文写入**回归（`md-line-write.applyRawToNode`）。
 *
 * 这条链路支撑「编辑弹窗 = 编辑文件里的那一行」（用户实测反馈：别名视图下双链
 * 只剩剥壳名、外链 icon-only 完全不可见）。锁定三件事：
 * ① **整体重建**行内字段——旧通道值（旧附件/旧 hyperlink/旧台账）不残留，
 *    否则会写出「旧链接 + 新文本」这类错行；
 * ② 写完后处于**未编辑**状态（`text === mdDerivedText` + `mdRaw`）⇒ 保存时逐字
 *    写回用户输入（与「从文件重新加载这一行」等价），这是「写入原文件再渲染」的兑现；
 * ③ 结构字段（`mdType`/`mdLevel`）不被文本编辑牵动。
 *
 * 解析/序列化彼此为逆映射，故断言直接对 `composeNodeContent`（写盘口径）做逐字
 * 比对——它同时是弹窗预填的实现，两处必须是同一份内容。
 */
import { describe, expect, it } from 'vitest';
import { applyRawToNode } from '../src/markdown/md-line-write';
import { composeNodeContent } from '../src/markdown/md-serialize';
import type { MdNodeData } from '../src/core/node-data';

/** 一个「list 节点」的起始数据（模拟解析产物后用户改原文） */
function baseData(patch: MdNodeData = {}): MdNodeData {
	return { text: '', mdRaw: '', mdDerivedText: '', mdType: 'list', ...patch };
}

describe('applyRawToNode（原文写入）', () => {
	it('写完后即「未编辑」：写盘口径逐字等于用户输入（写入原文件再渲染）', () => {
		const data = baseData();
		const raw = '见 [[笔记A]] 与 **重点** 和 https://example.com/x';
		applyRawToNode(data, raw);

		expect(data.text).toBe('见 笔记A 与 **重点** 和');
		expect(data.mdDerivedText).toBe(data.text);
		expect(data.mdRaw).toBe(raw);
		expect(composeNodeContent(data, null), '下次写盘 = 用户输入').toBe(raw);
	});

	it('整体重建链接通道：换链后旧值不残留', () => {
		const data = baseData({
			// 模拟上一版解析残留：文档双链 + 嵌入标记 + 附件字段三套并存
			mdWikiLinkpath: '[[旧笔记]]',
			mdLinkStyle: 'wiki',
			mdLinkText: '旧笔记',
			mdEmbed: true,
			mdEmbedPipe: '300',
			attachmentUrl: 'assets/旧附件.pdf',
			attachmentName: '旧附件.pdf',
			mdAttachmentLinkpath: 'assets/旧附件.pdf',
		});
		applyRawToNode(data, '见 [[新笔记|别名]]');

		expect(data.mdWikiLinkpath).toBe('[[新笔记|别名]]');
		expect(data.mdLinkText, '显示名取别名').toBe('别名');
		expect(data.mdEmbed, '内嵌语法标记不残留').toBeUndefined();
		expect(data.mdEmbedPipe).toBeUndefined();
		expect(data.attachmentUrl, '附件通道整体让位').toBeUndefined();
		expect(data.attachmentName).toBeUndefined();
		expect(data.mdAttachmentLinkpath).toBeUndefined();
		expect(data.mdSegments, '台账按新原文重建').toEqual([
			{ kind: 'link', text: '别名', raw: '[[新笔记|别名]]', first: true },
		]);
	});

	it('外链：icon-only 目标进 hyperlink 字段（原文可见、字段不丢）', () => {
		const data = baseData();
		applyRawToNode(data, '参考 <https://example.com/a> 说明');

		expect(data.hyperlink).toBe('https://example.com/a');
		expect(data.text, 'URL 本体不进显示文本（引擎侧口径）').toBe('参考 说明');
		expect(composeNodeContent(data, null)).toBe('参考 <https://example.com/a> 说明');
	});

	it('多图：写入首图字段、移除后图片字段整体清空（含自动尺寸标记）', () => {
		const data = baseData();
		applyRawToNode(data, '前 ![[a.png]] 后');
		expect(data.image).toBe('a.png');
		expect(data.mdImageTarget).toBe('a.png');

		// 用户把图片从原文里删掉 → 字段必须一起消失（否则回形针/图片复活）
		data.mdImageAutoSize = true;
		applyRawToNode(data, '前 后');
		expect(data.image).toBeUndefined();
		expect(data.mdImageTarget).toBeUndefined();
		expect(data.mdImageAutoSize, '自动尺寸标记随图片一起清').toBeUndefined();
		expect(composeNodeContent(data, null)).toBe('前 后');
	});

	it('多行：首行承载链接语法，续行按纯文本并入（缩进由序列化器补）', () => {
		const data = baseData();
		applyRawToNode(data, '首行 [[A]]\n  续行 **文本**\n第二续行');

		expect(data.text).toBe('首行 A\n续行 **文本**\n第二续行');
		expect(data.mdRaw, '续行行首空白按解析侧口径 trimStart').toBe(
			'首行 [[A]]\n续行 **文本**\n第二续行',
		);
		expect(composeNodeContent(data, null)).toBe(
			'首行 [[A]]\n续行 **文本**\n第二续行',
		);
	});

	it('未闭合语法：按字面保真，不抛错、不吞字符', () => {
		const data = baseData();
		applyRawToNode(data, '见 [[未闭合 与 **半');
		expect(data.text).toBe('见 [[未闭合 与 **半');
		expect(composeNodeContent(data, null)).toBe('见 [[未闭合 与 **半');
	});

	it('结构字段不受影响（行类型与层级由树决定）', () => {
		const data = baseData({ mdType: 'heading', mdLevel: 3 });
		applyRawToNode(data, '标题改了');
		expect(data.mdType).toBe('heading');
		expect(data.mdLevel).toBe(3);
	});
});
