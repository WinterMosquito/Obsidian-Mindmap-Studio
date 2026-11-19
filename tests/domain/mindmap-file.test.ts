import { describe, expect, it } from 'vitest';
import { isDedicatedMindMapPath, mindMapFileName, mindMapFileTitle } from '../../src/domain/mindmap-file';

describe('专用 Markdown 导图文件', () => {
	it.each(['React', 'React.md', 'React.mindmap.md', 'React.MINDMAP.MD', 'React.mindmap'])('输入 %s 只保留一份格式后缀', (name) => {
		expect(mindMapFileName(name)).toBe('React.mindmap.md');
	});
	it.each([
		['notes/React.mindmap.md', true], ['React.MINDMAP.MD', true],
		['React.md', false], ['React.mindmap 1.md', false], ['React.mindmap.md.bak', false],
	])('%s 的身份判据', (path, expected) => {
		expect(isDedicatedMindMapPath(path)).toBe(expected);
	});
	it('专用图隐藏格式后缀，普通笔记保留实际 basename', () => {
		expect(mindMapFileTitle({ path: 'React.mindmap.md', basename: 'React.mindmap' })).toBe('React');
		expect(mindMapFileTitle({ path: 'React.notes.md', basename: 'React.notes' })).toBe('React.notes');
	});
});
