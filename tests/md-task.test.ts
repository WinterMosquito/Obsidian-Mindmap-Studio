/**
 * 任务列表行（GFM task list item）的解析 / 合成回归。
 *
 * 覆盖三类契约：
 * - **解析**：token 只从列表项首行识别，`mdRaw` 保留 token、显示文本剥掉；
 * - **回写**：未编辑逐字、编辑后拼回（三种大小写）、拆分链接后仍带 token；
 * - **切换**：只改首行行首 token，续行与其余字节不动。
 *
 * 源码依据：src/domain/md-task.ts、src/markdown/{md-outline,md-serialize,md-line-write,links-split}.ts。
 */
import { describe, expect, it } from 'vitest';
import { parseMdOutline } from '../src/markdown/md-outline';
import { composeNodeContent, serializeMdBody } from '../src/markdown/md-serialize';
import { applyRawToNode } from '../src/markdown/md-line-write';
import { splitAllLinksInTree } from '../src/markdown/links-split';
import {
	parseTaskPrefix,
	setTaskTokenInRaw,
	stripTaskPrefix,
	toggleTaskToken,
} from '../src/domain/md-task';
import type { MdNodeData } from '../src/core/node-data';
import type { MindMapTreeNode } from '../src/core/engine-types';

/** 解析正文 → 虚拟根（frontmatter 不用） */
function parse(body: string): MindMapTreeNode {
	return parseMdOutline(body, 'T').tree;
}

/** 首个正文节点（虚拟根的第一个子节点） */
function first(root: MindMapTreeNode): MindMapTreeNode {
	return root.children[0]!;
}

describe('md-task：行首前缀的纯逻辑', () => {
	it('识别三种 token 并给出状态', () => {
		expect(parseTaskPrefix('[ ] 待办')).toEqual({
			state: 'todo',
			token: '[ ]',
		});
		expect(parseTaskPrefix('[x] 完成')).toEqual({
			state: 'done',
			token: '[x]',
		});
		// 大小写原样保留（合成时逐字还原）
		expect(parseTaskPrefix('[X] 完成')).toEqual({
			state: 'done',
			token: '[X]',
		});
	});

	it('无空白分隔、非行首、空正文之外的形态不识别', () => {
		// GFM：`[ ]` 后必须是空白或行尾
		expect(parseTaskPrefix('[ ]没有空格')).toBeNull();
		expect(parseTaskPrefix('前 [ ] 不行')).toBeNull();
		expect(parseTaskPrefix('**[ ] 粗体内**')).toBeNull();
	});

	it('行尾 token（无正文）也成立', () => {
		expect(parseTaskPrefix('[ ]')).toEqual({ state: 'todo', token: '[ ]' });
	});

	it('剥离显示文本前缀（含归一化后的空白）', () => {
		expect(stripTaskPrefix('[ ] 写周报')).toBe('写周报');
		expect(stripTaskPrefix('[x]  多空格')).toBe('多空格');
		expect(stripTaskPrefix('[ ]')).toBe('');
		// 非任务形态原样
		expect(stripTaskPrefix('写周报 [ ]')).toBe('写周报 [ ]');
	});

	it('切换 token：完成形态统一回写成 `[ ]`', () => {
		expect(toggleTaskToken('[ ]')).toBe('[x]');
		expect(toggleTaskToken('[x]')).toBe('[ ]');
		expect(toggleTaskToken('[X]')).toBe('[ ]');
	});

	it('只替换首行 token（续行逐字不动）', () => {
		expect(setTaskTokenInRaw('[ ] 第一行\n[ ] 第二行', '[x]')).toBe(
			'[x] 第一行\n[ ] 第二行',
		);
		// 不是任务行 → 原样返回
		expect(setTaskTokenInRaw('普通行', '[x]')).toBe('普通行');
	});
});

describe('任务：解析侧的派生字段', () => {
	it('mdRaw 含 token，text / mdDerivedText 同步剥掉', () => {
		const node = first(parse('- [ ] 写周报'));
		expect(node.data['mdRaw']).toBe('[ ] 写周报');
		expect(node.data['text']).toBe('写周报');
		expect(node.data['mdDerivedText']).toBe('写周报');
		expect(node.data['mdTask']).toBe('todo');
		expect(node.data['mdTaskToken']).toBe('[ ]');
		expect(node.data['mdType']).toBe('list');
	});

	it('大小写原样保留', () => {
		const node = first(parse('- [X] 已完成'));
		expect(node.data['mdTask']).toBe('done');
		expect(node.data['mdTaskToken']).toBe('[X]');
		expect(node.data['text']).toBe('已完成');
	});

	it('空正文任务：文本为空但状态在', () => {
		const node = first(parse('- [ ]'));
		expect(node.data['text']).toBe('');
		expect(node.data['mdTask']).toBe('todo');
		expect(node.data['mdRaw']).toBe('[ ]');
	});

	it('标题行与「无空白分隔」不产生任务字段', () => {
		const heading = first(parse('# [ ] 标题里的方括号'));
		expect(heading.data['mdTask']).toBeUndefined();
		expect(heading.data['text']).toBe('[ ] 标题里的方括号');

		const tight = first(parse('- [ ]没有空格'));
		expect(tight.data['mdTask']).toBeUndefined();
		expect(tight.data['text']).toBe('[ ]没有空格');
	});

	it('嵌套任务各有状态', () => {
		const root = parse('- [ ] 父\n  - [x] 子');
		const parent = root.children[0]!;
		expect(parent.data['mdTask']).toBe('todo');
		expect(parent.children[0]!.data['mdTask']).toBe('done');
	});
});

describe('任务：写回', () => {
	const body = '- [ ] 写周报\n- [x] 已发布\n  - [X] 归档';

	it('未编辑逐字回写（不动点）', () => {
		const tree = parse(body);
		expect(serializeMdBody(tree)).toBe(body);
	});

	it('编辑文本后 token 仍在（三种写法各一例）', () => {
		const tree = parse(body);
		const todo = tree.children[0]!;
		todo.data['text'] = '改成新名';
		const done = tree.children[1]!;
		done.data['text'] = '已发版';
		const upper = done.children[0]!;
		upper.data['text'] = '已归档';

		expect(serializeMdBody(tree)).toBe(
			'- [ ] 改成新名\n- [x] 已发版\n  - [X] 已归档',
		);
		// 合成内容本身（编辑弹窗预填）也带 token
		expect(composeNodeContent(todo.data as MdNodeData, null)).toBe('[ ] 改成新名');
	});

	it('原文写回：token 变化即状态变化，删掉 token 即不再是任务', () => {
		const data: MdNodeData = {
			mdType: 'list',
			text: '写周报',
			mdRaw: '[ ] 写周报',
			mdDerivedText: '写周报',
			mdTask: 'todo',
			mdTaskToken: '[ ]',
		};
		applyRawToNode(data, '[x] 写周报');
		expect(data.mdTask).toBe('done');
		expect(data.mdTaskToken).toBe('[x]');
		expect(data.text).toBe('写周报');
		expect(data.mdRaw).toBe('[x] 写周报');

		applyRawToNode(data, '写周报');
		expect(data.mdTask).toBeUndefined();
		expect(data.mdTaskToken).toBeUndefined();
		expect(data.text).toBe('写周报');
	});

	it('拆分混排链接后任务前缀仍在（父节点不被降级）', () => {
		const tree = parse('- [ ] 关于 [[冬天]] 的问题');
		const result = splitAllLinksInTree(tree, null);
		expect(result.links).toBe(1);
		const parent = tree.children[0]!;
		expect(parent.data['mdTask']).toBe('todo');
		expect(parent.data['text']).toBe('关于冬天的问题');
		expect(serializeMdBody(tree)).toBe(
			'- [ ] 关于冬天的问题\n  - [[冬天]]',
		);
	});

	it('图片节点上的任务不参与显示层（渲染侧判据），但数据与回写仍保真', () => {
		const tree = parse('- [ ] ![[a.png]]');
		const node = tree.children[0]!;
		expect(node.data['mdTask']).toBe('todo');
		expect(node.data['image']).toBeDefined();
		expect(serializeMdBody(tree)).toBe('- [ ] ![[a.png]]');
	});
});
