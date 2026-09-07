/**
 * links-tree 回归测试：文件重命名/删除后导图树内引用的同步——
 * 图片/附件/超链接三种载体 × rename/clear 两种模式，
 * 以及 URL 编码形态匹配、回收站退化清除、纯文本短路。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { App, TFile } from 'obsidian';
import { fileLookupIndex } from '../src/file-lookup';
import { parseWikilink } from '../src/domain/wikilink';
import {
	removeReferencesOnDelete,
	updateReferencesOnRename,
} from '../src/links-tree';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

function node(
	data: Record<string, unknown>,
	children: MindMapTreeNode[] = [],
): MindMapTreeNode {
	return { data, children };
}

function fakeApp(): App {
	return Object.assign(new App(), {
		vault: {
			getFiles: () => [],
			getResourcePath: (f: TFile) => `app://fake/${f.path}`,
		},
	});
}

function tfile(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		name: path.split('/').pop() ?? path,
		basename: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
	});
}

const app = fakeApp();

describe('updateReferencesOnRename（rename 模式）', () => {
	beforeEach(() => {
		fileLookupIndex.invalidate();
	});

	it('纯文本导图短路：无引用时返回 false 且不建索引', () => {
		const tree = node({ text: 'root' }, [node({ text: 'leaf' })]);
		expect(updateReferencesOnRename(tree, tfile('a.png'), 'old/a.png', app)).toBe(
			false,
		);
	});

	it('图片按完整路径匹配并指向新位置（资源地址形式）', () => {
		const file = tfile('assets/b.png');
		const tree = node({ text: 'root' }, [node({ text: 'n', image: 'assets/a.png' })]);
		expect(updateReferencesOnRename(tree, file, 'assets/a.png', app)).toBe(true);
		expect(tree.children[0]!.data.image).toBe('app://fake/assets/b.png');
	});

	it('图片按资源地址后缀匹配（含 URL 编码名解码）', () => {
		const file = tfile('assets/图2.png');
		const tree = node({ text: 'root' }, [
			node({
				text: 'n',
				image: `app://fake/assets/${encodeURIComponent('图.png')}`,
			}),
		]);
		expect(updateReferencesOnRename(tree, file, 'assets/图.png', app)).toBe(true);
		expect(tree.children[0]!.data.image).toBe('app://fake/assets/图2.png');
	});

	it('短名不误命中更长后缀（a.png ≠ ba.png）', () => {
		const tree = node({ text: 'root' }, [node({ text: 'n', image: 'x/ba.png' })]);
		expect(updateReferencesOnRename(tree, tfile('y/a.png'), 'x/a.png', app)).toBe(
			false,
		);
		expect(tree.children[0]!.data.image).toBe('x/ba.png');
	});

	it('附件重命名：attachmentUrl 换新地址、attachmentName 换新文件名', () => {
		const file = tfile('assets/b.pdf');
		const tree = node({ text: 'root' }, [
			node({
				text: 'n',
				attachmentUrl: 'app://fake/assets/a.pdf',
				attachmentName: 'a.pdf',
			}),
		]);
		expect(updateReferencesOnRename(tree, file, 'assets/a.pdf', app)).toBe(true);
		expect(tree.children[0]!.data.attachmentUrl).toBe('app://fake/assets/b.pdf');
		expect(tree.children[0]!.data.attachmentName).toBe('b.pdf');
	});

	it('[[链接]] 改指向新 basename，保留别名与区块', () => {
		const file = tfile('notes/新名.md');
		const tree = node({ text: 'root' }, [
			node({ text: 'n', hyperlink: '[[旧名#标题|别名]]' }),
		]);
		expect(updateReferencesOnRename(tree, file, 'notes/旧名.md', app)).toBe(true);
		const parts = parseWikilink(tree.children[0]!.data.hyperlink as string);
		expect(parts?.target).toBe('新名');
		expect(parts?.block).toBe('标题');
		expect(parts?.alias).toBe('别名');
	});

	it('[[folder/旧名]] 保留路径前缀', () => {
		const file = tfile('notes/新名.md');
		const tree = node({ text: 'root' }, [
			node({ text: 'n', hyperlink: '[[folder/旧名]]' }),
		]);
		updateReferencesOnRename(tree, file, 'folder/旧名.md', app);
		const parts = parseWikilink(tree.children[0]!.data.hyperlink as string);
		expect(parts?.target).toBe('folder/新名');
	});

	it('无关文件的引用不受影响', () => {
		const tree = node({ text: 'root' }, [
			node({ text: 'n', image: 'assets/other.png', hyperlink: '[[x]]' }),
		]);
		expect(updateReferencesOnRename(tree, tfile('a.png'), 'old/a.png', app)).toBe(
			false,
		);
		expect(tree.children[0]!.data.image).toBe('assets/other.png');
	});

	it('移入库内回收站（.trash/）退化为清除而非改指向', () => {
		const tree = node({ text: 'root' }, [node({ text: 'n', image: 'assets/a.png' })]);
		expect(
			updateReferencesOnRename(tree, tfile('.trash/a.png'), 'assets/a.png', app),
		).toBe(true);
		expect(tree.children[0]!.data.image).toBe('');
	});
});

describe('removeReferencesOnDelete（clear 模式）', () => {
	beforeEach(() => {
		fileLookupIndex.invalidate();
	});

	it('图片/附件/超链接引用一律清空（含子节点）', () => {
		const tree = node(
			{
				text: 'root',
				image: 'app://fake/assets/a.png',
				attachmentUrl: 'app://fake/assets/a.png',
				attachmentName: 'a.png',
				hyperlink: '[[a]]',
			},
			[node({ text: 'child', image: 'assets/a.png' })],
		);
		expect(removeReferencesOnDelete(tree, tfile('assets/a.png'), app)).toBe(true);
		expect(tree.data.image).toBe('');
		expect(tree.data.attachmentUrl).toBe('');
		expect(tree.data.hyperlink).toBe('');
		expect(tree.children[0]!.data.image).toBe('');
	});

	it('无关文件删除返回 false', () => {
		const tree = node({ text: 'root' }, [node({ text: 'n', image: 'assets/other.png' })]);
		expect(removeReferencesOnDelete(tree, tfile('a.png'), app)).toBe(false);
		expect(tree.children[0]!.data.image).toBe('assets/other.png');
	});
});
