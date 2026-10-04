/**
 * 链接「生效显示名」纯判定回归（`domain/wiki-display.ts`，K6 口径）。
 *
 * 为什么补这个测试：该判定是**跨模块复用**的关键口径——回写合成
 * （`md-serialize.renderHyperlink` + `nodeLinkDisplay`）与文档页图标 tooltip
 * （`engine/mindmap`）必须走同一入口，两者不一致会让合成写出「新文本 + 链接」
 * 重复一次（历史上已发生，见 K6 / K52）。文件是 domain 纯逻辑（零依赖）却被三个
 * 消费方依赖，此前**无任何直接用例**（仅经端到端往返间接覆盖），闸门条件一旦被误改，
 * 只有靠长链路的往返测试才暴露。
 *
 * 断言口径：每条用例锁定 `editedWikilinkAlias` 文件头列出的**一道闸门**
 * （① 非 wiki ② 已编辑 ③ 单行 ④ 纯链接 ⑤ 附件嵌入 ⑥ 别名含方括号），
 * 外加 `effectiveDocWikiLink` 的「冗余省略」与 `docWikiLinkDisplay` 的
 * 「别名优先 / 回落默认名」——三者的**分歧点**才是缺陷高发处。
 *
 * **负向自检**（对齐 K53 ⑨ / `verify:visual` 的负向自检惯例，证明断言非空转且
 * 定位精准）：① 拆掉闸门①（`mdLinkStyle !== 'wiki'` 早退）→ **精确 1 例**报红；
 * ⑤ 拆掉闸门⑤ 的 `data.mdEmbed !== true` 条件 → **精确 1 例**报红（附件嵌入用例）。
 * 两次均已还原（还原后 `git diff` 对 `src/domain/wiki-display.ts` 为空）。
 */
import { describe, expect, it } from 'vitest';
import {
	docWikiLinkDisplay,
	editedWikilinkAlias,
	effectiveDocWikiLink,
	type WikiAliasSource,
} from '../src/domain/wiki-display';

/**
 * 文档双链节点的最小数据面。
 * 默认形态＝「已编辑的纯双链」：`text`（新别名）≠ `mdDerivedText`（解析期显示名）。
 */
function docNode(over: Partial<WikiAliasSource> = {}): WikiAliasSource {
	return {
		mdLinkStyle: 'wiki',
		mdWikiLinkpath: '[[笔记]]',
		mdLinkText: '笔记',
		mdDerivedText: '笔记',
		text: '新别名',
		...over,
	};
}

describe('editedWikilinkAlias（逐道闸门）', () => {
	it('文档双链已编辑 → 新别名（trim 后）', () => {
		expect(editedWikilinkAlias(docNode())).toBe('新别名');
		expect(editedWikilinkAlias(docNode({ text: '  空格别名  ' }))).toBe('空格别名');
	});

	it('闸门① 非 wiki 链接（md 链接）→ null：URL/md 链接无别名概念', () => {
		expect(editedWikilinkAlias(docNode({ mdLinkStyle: 'md' }))).toBeNull();
	});

	it('闸门② 未编辑（text === derived）→ null：整行逐字回写，无需改写别名', () => {
		expect(editedWikilinkAlias(docNode({ text: '笔记' }))).toBeNull();
	});

	it('闸门② 数据面不足（缺 text / derived 为空串）→ null', () => {
		expect(
			editedWikilinkAlias({ mdLinkStyle: 'wiki', mdWikiLinkpath: '[[笔记]]' }),
		).toBeNull();
		expect(editedWikilinkAlias(docNode({ mdDerivedText: '' }))).toBeNull();
	});

	it('闸门③ 多行文本 → null：无「唯一别名」语义，回落旧合成', () => {
		expect(editedWikilinkAlias(docNode({ text: '第一行\n第二行' }))).toBeNull();
	});

	it('闸门④ 非纯双链（原文除链接外还有别的文字）→ null', () => {
		// 文档通道要求 mdLinkText（解析期可见名）=== derived；不等即说明行内还有内容
		expect(editedWikilinkAlias(docNode({ mdDerivedText: '说明 笔记' }))).toBeNull();
	});

	it('闸门⑤ 附件嵌入（mdEmbed 且无文档通道）→ null：管道位是尺寸不是别名', () => {
		expect(
			editedWikilinkAlias({
				mdLinkStyle: 'wiki',
				mdEmbed: true,
				attachmentUrl: '报告.pdf',
				attachmentName: '报告',
				mdDerivedText: '报告',
				text: '新名',
			}),
		).toBeNull();
	});

	it('附件双链（非嵌入）已编辑 → 别名（attachmentName === derived）', () => {
		expect(
			editedWikilinkAlias({
				mdLinkStyle: 'wiki',
				attachmentUrl: '报告.pdf',
				attachmentName: '报告',
				mdDerivedText: '报告',
				text: '新名',
			}),
		).toBe('新名');
	});

	it('文档嵌入（mdEmbed + 文档通道）→ 适用：.md 目标的管道位就是别名（K6 ③）', () => {
		expect(editedWikilinkAlias(docNode({ mdEmbed: true }))).toBe('新别名');
	});

	it('闸门⑥ 别名含方括号 → null：避免写出 [[目标|[[新目标]]]] 畸形嵌套', () => {
		expect(editedWikilinkAlias(docNode({ text: '新[[目标]]' }))).toBeNull();
		expect(editedWikilinkAlias(docNode({ text: '新]别名' }))).toBeNull();
	});

	it('清空别名 → 返回空串（调用方据此去掉 | 段，而非写空别名）', () => {
		expect(editedWikilinkAlias(docNode({ text: '' }))).toBe('');
		expect(editedWikilinkAlias(docNode({ text: '   ' }))).toBe('');
	});

	it('无任何通道（既无文档通道也无附件）→ null', () => {
		expect(
			editedWikilinkAlias({
				mdLinkStyle: 'wiki',
				mdDerivedText: '笔记',
				text: '新别名',
			}),
		).toBeNull();
	});
});

describe('effectiveDocWikiLink（回写与可见名共用的生效链接）', () => {
	it('未编辑 → 原样返回（逐字回写不动链接）', () => {
		expect(effectiveDocWikiLink(docNode({ text: '笔记' }), '[[笔记]]')).toBe(
			'[[笔记]]',
		);
	});

	it('已编辑 → 写新别名', () => {
		expect(effectiveDocWikiLink(docNode(), '[[笔记]]')).toBe('[[笔记|新别名]]');
	});

	it('新别名与默认显示名相同 → 不产出 [[目标|目标]] 冗余', () => {
		// 带空格绕过「未编辑」闸门，命中的正是「冗余省略」分支
		expect(effectiveDocWikiLink(docNode({ text: ' 笔记 ' }), '[[笔记]]')).toBe(
			'[[笔记]]',
		);
	});

	it('清空别名 → 去掉别名段', () => {
		expect(
			effectiveDocWikiLink(docNode({ text: '' }), '[[笔记|旧别名]]'),
		).toBe('[[笔记]]');
	});

	it('保留既有目标路径与区块（只替换 | 之后那段）', () => {
		expect(effectiveDocWikiLink(docNode(), '[[子目录/笔记#标题]]')).toBe(
			'[[子目录/笔记#标题|新别名]]',
		);
	});
});

describe('docWikiLinkDisplay（节点可见名 / 文档页图标 tooltip 口径）', () => {
	it('非文档双链（无 mdWikiLinkpath / 空串）→ null', () => {
		expect(
			docWikiLinkDisplay({ mdLinkStyle: 'wiki', mdDerivedText: 'x', text: 'y' }),
		).toBeNull();
		expect(
			docWikiLinkDisplay({ mdWikiLinkpath: '', mdDerivedText: 'x', text: 'y' }),
		).toBeNull();
	});

	it('未编辑 → 原显示名（去 .md 的目标名）', () => {
		expect(docWikiLinkDisplay(docNode({ text: '笔记' }))).toBe('笔记');
		expect(
			docWikiLinkDisplay(
				docNode({
					text: '笔记',
					mdWikiLinkpath: '[[子目录/笔记.md]]',
					mdLinkText: '笔记',
					mdDerivedText: '笔记',
				}),
			),
		).toBe('笔记');
	});

	it('已编辑 → 新别名（tooltip 不停留在旧别名，无需重载）', () => {
		expect(docWikiLinkDisplay(docNode())).toBe('新别名');
	});

	it('未编辑且原文带别名 → 别名优先于目标名', () => {
		expect(
			docWikiLinkDisplay(
				docNode({
					text: '旧别名',
					mdWikiLinkpath: '[[笔记|旧别名]]',
					mdLinkText: '旧别名',
					mdDerivedText: '旧别名',
				}),
			),
		).toBe('旧别名');
	});

	it('已编辑成与默认显示名相同 → 回落默认名（不产出 [[目标|目标]]）', () => {
		expect(
			docWikiLinkDisplay(
				docNode({
					text: ' 笔记 ',
					mdWikiLinkpath: '[[笔记|旧别名]]',
					mdLinkText: '旧别名',
					mdDerivedText: '旧别名',
				}),
			),
		).toBe('笔记');
	});
});
