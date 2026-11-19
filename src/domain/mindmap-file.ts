/** 专用导图仍是 Markdown；完整后缀、显示标题和文件命名只有这一份规则。 */
export const MINDMAP_FILE_SUFFIX = '.mindmap.md';

export function isDedicatedMindMapPath(path: string): boolean {
	return path.toLowerCase().endsWith(MINDMAP_FILE_SUFFIX);
}

/** 命名输入允许带 .md / .mindmap.md，生成时只附加一次完整后缀。 */
export function mindMapFileName(name: string): string {
	return name.replace(/(?:\.mindmap)?\.md$|\.mindmap$/i, '') + MINDMAP_FILE_SUFFIX;
}

/** TFile 的窄化数据形态；普通笔记的标题保持原样。 */
export function mindMapFileTitle(file: { path: string; basename: string }): string {
	return isDedicatedMindMapPath(file.path)
		? file.basename.slice(0, -'.mindmap'.length)
		: file.basename;
}
