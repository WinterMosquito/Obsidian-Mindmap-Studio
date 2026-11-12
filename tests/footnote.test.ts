/**
 * 脚注（footnote）回归：定义行语法 + 文档级定义索引（`markdown/md-footnote`）。
 *
 * 锁四件事：
 * ① **语法判定的单一来源**：`md-outline.isLinkReferenceDefinition` 的 `^` 分支与
 *    渲染侧的索引共用 `isFootnoteDefinition`（不另写「以 `[^` 开头」）；
 * ② **定义行仍是普通节点**（v1 裁决：不隐藏、不搬家）——原文、位置、回写路径
 *    一个字都不动，索引只是**读侧**的旁路；
 * ③ **索引的保守边界**：围栏代码块 / 缩进代码行里的同形行不算定义（宁可漏，
 *    不可错——错了会让徽标指向一段代码）；
 * ④ **编辑跟随**：索引读 `domain/md-meta.nodeInlineSource`（未编辑 `mdRaw`、
 *    已编辑 `text`），改一次文本索引就变，无需重建。
 */
import { describe, expect, it } from 'vitest';
import {
	collectFootnoteDefinitions,
	isFootnoteDefinition,
	parseFootnoteDefinition,
	splitFootnoteDefinitions,
} from '../src/markdown/md-footnote';
import { ensureUniqueUids } from '../src/markdown/markdown';
import { isLinkReferenceDefinition, parseMdOutline } from '../src/markdown/md-outline';
import { walkTree } from '../src/domain/tree';
import type { MindMapTreeNode } from '../src/core/engine-types';

/** 解析 + 补 uid（生产路径同此：uid 由 `ensureUniqueUids` 补齐后才可定位） */
function treeOf(body: string): MindMapTreeNode {
	const tree = parseMdOutline(body, '根').tree;
	ensureUniqueUids(tree);
	return tree;
}

/**
 * 与生产路径同构：先序展平节点 data 再收索引。
 * 生产侧的展平由 `engine/mindmap.collectRenderNodeData` 完成（**只有引擎树有 uid**），
 * 这里用解析树 + `ensureUniqueUids` 模拟同一形态。
 */
function indexOf(tree: MindMapTreeNode | null) {
	const data: Record<string, unknown>[] = [];
	if (tree) {
		walkTree(tree, (node) => {
			if (node.data) {
				data.push(node.data);
			}
		});
	}
	return collectFootnoteDefinitions(data);
}

describe('parseFootnoteDefinition（定义行语法）', () => {
	it('标准形态：id + 正文', () => {
		expect(parseFootnoteDefinition('[^1]: 内容')).toEqual({
			id: '1',
			body: '内容',
		});
		// 命名脚注与数字脚注同权
		expect(parseFootnoteDefinition('[^note]: 命名')).toEqual({
			id: 'note',
			body: '命名',
		});
	});

	it('冒号后的空白不进食正文；无空白的紧凑写法同样成立', () => {
		expect(parseFootnoteDefinition('[^1]:   多空格正文')?.body).toBe('多空格正文');
		expect(parseFootnoteDefinition('[^1]:紧凑')?.body).toBe('紧凑');
		// 空正文合法（官方帮助未禁止；渲染侧会显示一个空浮层）
		expect(parseFootnoteDefinition('[^1]:')).toEqual({ id: '1', body: '' });
	});

	it('行首 ≤3 空格缩进容忍（与 md-outline 的 trim 口径一致）', () => {
		expect(parseFootnoteDefinition('   [^1]: 缩进两格')).toEqual({
			id: '1',
			body: '缩进两格',
		});
	});

	it('非定义形态一律 null（空 id / 无冒号 / 引用写法 / 普通链接标签）', () => {
		expect(parseFootnoteDefinition('[^]: 空 id')).toBeNull();
		expect(parseFootnoteDefinition('[^1] 引用不是定义')).toBeNull();
		expect(parseFootnoteDefinition('见[^1]')).toBeNull();
		expect(parseFootnoteDefinition('[文字]: 参考式链接')).toBeNull();
	});

	it('与解析层的豁免判定同源（`isLinkReferenceDefinition` 委托本判定）', () => {
		expect(isFootnoteDefinition('[^1]: x')).toBe(true);
		expect(isLinkReferenceDefinition('[^1]: x')).toBe(true);
		// `[^]:` 不是合法脚注定义；无 destination 也不算参考式定义
		expect(isFootnoteDefinition('[^]:')).toBe(false);
		expect(isLinkReferenceDefinition('[^]:')).toBe(false);
		// 对照：参考式链接仍由原分支处理（本次改动不碰它）
		expect(isLinkReferenceDefinition('[ref]: <https://example.com>')).toBe(true);
	});
});

describe('collectFootnoteDefinitions（文档序索引）', () => {
	it('基本形态：id / 正文 / 所在节点 uid', () => {
		const tree = treeOf('- 甲\n[^1]: 定义正文');
		const index = indexOf(tree);
		expect([...index.keys()]).toEqual(['1']);
		const def = index.get('1');
		expect(def?.body).toBe('定义正文');
		expect(def?.uid).toBeTruthy();
		// 定义行**仍是节点**（v1 裁决：不隐藏）——索引只是读侧旁路
		expect(tree.children?.[1]?.data?.text).toBe('[^1]: 定义正文');
	});

	it('多行定义：续行（缩进 2 空格）并入正文并剥掉缩进', () => {
		const tree = treeOf('[^1]: 第一行\n  第二行\n   第三行');
		expect(indexOf(tree).get('1')?.body).toBe(
			'第一行\n第二行\n第三行',
		);
	});

	it('Tab 起首的行按缩进代码处理，不算续行（与 `isIndentedCodeLine` 同口径）', () => {
		const tree = treeOf('[^1]: 第一行\n\t代码');
		expect(indexOf(tree).get('1')?.body).toBe('第一行');
	});

	it('相邻两条定义（解析层合并成同一段落节点）各自成条', () => {
		const tree = treeOf('[^1]: 甲\n[^2]: 乙');
		const index = indexOf(tree);
		expect(index.get('1')?.body).toBe('甲');
		expect(index.get('2')?.body).toBe('乙');
	});

	it('同一 id 重复：文档序第一条生效（与 GFM 的「首个定义生效」一致）', () => {
		const tree = treeOf('[^1]: 先\n[^1]: 后');
		expect(indexOf(tree).get('1')?.body).toBe('先');
	});

	it('围栏代码块里的同形行不是定义（保守跳过）', () => {
		const tree = treeOf('```md\n[^9]: 代码里的\n```\n[^1]: 真的');
		const index = indexOf(tree);
		expect(index.has('9')).toBe(false);
		expect(index.get('1')?.body).toBe('真的');
	});

	it('缩进代码块（≥4 空格）里的同形行不是定义', () => {
		const tree = treeOf('    [^9]: 缩进代码');
		expect(indexOf(tree).size).toBe(0);
	});

	it('只有引用、没有定义：索引为空（徽标仍显示，点击给提示）', () => {
		const tree = treeOf('- 见[^1] 的引用');
		expect(indexOf(tree).size).toBe(0);
	});

	it('编辑跟随：`text` 与快照不同后按编辑后的文本收定义', () => {
		const tree = treeOf('[^1]: 旧正文');
		const node = tree.children?.[0];
		expect(node).toBeDefined();
		if (!node?.data) {
			return;
		}
		node.data.text = '[^2]: 新正文';
		const index = indexOf(tree);
		expect(index.has('1')).toBe(false);
		expect(index.get('2')?.body).toBe('新正文');
	});

	it('空数据源：空表（引擎尚未渲染 / 视图已卸载）', () => {
		expect(indexOf(null).size).toBe(0);
		expect(collectFootnoteDefinitions([]).size).toBe(0);
	});
});

/**
 * 定义行**不渲染**（2026-11-11 用户裁决）：渲染期把定义行从显示源里剔掉，
 * 数据（`text` / `mdRaw`）一个字不动。判定与索引同源，故边界只需验一次。
 */
describe('splitFootnoteDefinitions（渲染期剥离）', () => {
	it('定义行与缩进续行一起剔除，其它行原样保留', () => {
		const { body, ids } = splitFootnoteDefinitions(
			'正文第一行\n[^1]: 定义甲\n  续行\n[^2]: 定义乙',
		);
		expect(body).toBe('正文第一行');
		expect(ids).toEqual(['1', '2']);
	});

	it('围栏代码块里的同形行保留（是代码，不是定义）', () => {
		const raw = '```md\n[^9]: 代码里的\n```';
		const { body, ids } = splitFootnoteDefinitions(raw);
		expect(body).toBe(raw);
		expect(ids).toEqual([]);
	});

	it('缩进代码行保留；与表格混排时只剔定义块', () => {
		const raw = '    [^9]: 缩进代码\n| 表 | 行 |\n[^1]: 定义';
		const { body, ids } = splitFootnoteDefinitions(raw);
		expect(body).toBe('    [^9]: 缩进代码\n| 表 | 行 |');
		expect(ids).toEqual(['1']);
	});

	it('围栏内容里带语言码的 ```js 不算闭合（行尾必须只剩空白）', () => {
		const raw = [
			'```md',
			'```js',
			'[^9]: 代码里的',
			'```',
			'[^1]: 真定义',
		].join('\n');
		const { body, ids } = splitFootnoteDefinitions(raw);
		expect(ids).toEqual(['1']);
		expect(body).toContain('[^9]: 代码里的');
	});

	it('同列的非空行是**另一段正文**：不随定义一起隐藏（2026-11-12 实机）', () => {
		const { body, ids } = splitFootnoteDefinitions(
			'正文第一段\n[^1]: 定义正文\n后续正文不应消失',
		);
		expect(ids).toEqual(['1']);
		expect(body, '第三行与定义同列 ⇒ 是独立段落，必须保留').toBe(
			'正文第一段\n后续正文不应消失',
		);
	});

	it('列表项续行按**相对缩进**判：> 0 隐藏、0 保留并结束定义（indents 来自解析层）', () => {
		// 列表项的续行在 mdRaw 里是 trimStart 形态（绝对缩进只剩 indents 这一份）
		const indented = splitFootnoteDefinitions(
			'正文\n[^1]: 定义\n真正的续行\n接着的正文',
			[0, 0, 4, 0],
		);
		expect(indented.ids).toEqual(['1']);
		expect(indented.body).toBe('正文\n接着的正文');

		const sameColumn = splitFootnoteDefinitions(
			'正文\n[^1]: 定义\n接着的正文\n真正的续行',
			[0, 0, 0, 4],
		);
		expect(sameColumn.ids).toEqual(['1']);
		expect(sameColumn.body, '同列行结束定义，其后的缩进行属正文').toBe(
			'正文\n接着的正文\n真正的续行',
		);
	});

	it('整段都是定义：body 为空、ids 全收（调用方据此渲染汇总 chip）', () => {
		const { body, ids } = splitFootnoteDefinitions('[^a]: 甲\n[^b]: 乙');
		expect(body.trim()).toBe('');
		expect(ids).toEqual(['a', 'b']);
	});

	it('同行自闭合围栏（```code```）不进入围栏态：其后的定义照常剥离（2026-11-12）', () => {
		// 此前只认「行首定界符即开围栏」，自闭合形态会让其后每一行都被当成
		// 「围栏内」⇒ 真实定义既不剥离也不进索引（徽标点了没有目标）。
		const raw = ['```code```', '[^1]: 真定义'].join('\n');
		const { body, ids } = splitFootnoteDefinitions(raw);
		expect(ids, '定义被索引').toEqual(['1']);
		expect(body, '只留自闭合围栏那一行').toBe('```code```');
	});
});
