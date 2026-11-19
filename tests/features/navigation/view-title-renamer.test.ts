import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TITLE_RENAME_DEBOUNCE_MS } from '../../../src/core/constants';
import { TitleRenamer } from '../../../src/features/navigation/view-title-renamer';

afterEach(() => vi.useRealTimers());

describe('专用导图中心主题改名', () => {
	it.each([
		['React.mindmap.md', 'React.mindmap', '新主题', '新主题.mindmap.md'],
		['Notes/React.mindmap.md', 'React.mindmap', '新主题', 'Notes/新主题.mindmap.md'],
		['React.mindmap.md', 'React.mindmap', 'React', null],
		['React.md', 'React', '新主题', null],
	] as const)('%s → %s', async (path, basename, title, expected) => {
		vi.useFakeTimers();
		const file = Object.assign(new TFile(), {
			path, basename, extension: 'md',
			parent: { path: path.includes('/') ? 'Notes' : '/', isRoot: () => !path.includes('/') },
		});
		const rename = vi.fn(async () => undefined);
		const renamer = new TitleRenamer({
			app: {
				metadataCache: { getFileCache: () => ({ frontmatter: { Mindmap: 'Mindmap' } }) },
				vault: { getFileByPath: () => null, getFolderByPath: () => null },
				fileManager: { renameFile: rename },
			} as never,
			getFile: () => file, getRootText: () => title, isEditingText: () => false, lang: 'zh',
		});
		renamer.schedule();
		await vi.advanceTimersByTimeAsync(TITLE_RENAME_DEBOUNCE_MS);
		if (expected) expect(rename).toHaveBeenCalledWith(file, expected);
		else expect(rename).not.toHaveBeenCalled();
		renamer.cancel();
	});
});
