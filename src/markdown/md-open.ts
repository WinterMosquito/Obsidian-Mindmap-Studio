/**
 * .mindmap.md 文档模式：触发判定与视图切换。
 *
 * 渲染承载（B3 显式切换）：.mindmap.md 仍是普通 Markdown（默认用 Obsidian
 * markdown 视图打开）；用户通过命令/文件右键「以思维导图打开」显式把当前
 * leaf 切到本插件的导图视图（编辑与阅读模式下入口均可用），并可随时切回。
 */
import { MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { CORE_VIEW_TYPE, hasMindMapMarker, VIEW_TYPE } from '../core/constants';

/**
 * 「以思维导图打开」偏好写入钩子（由插件注册，经 view-state 记录
 * openAs=mindmap —— 双向偏好：最后一次主动选择决定下次打开方式）。
 */
let openAsPreferenceHook: ((path: string) => void) | null = null;

export function setOpenAsPreferenceHook(
	hook: ((path: string) => void) | null,
): void {
	openAsPreferenceHook = hook;
}

/**
 * 视图切换落定钩子（由组合根注入「导航历史卫生」，见 platform/nav-history，K111）：
 * 打开 / 切回是**视图切换**而非导航点——把 leaf 历史里同文件的跨视图冗余条目
 * 收敛掉；否则侧键后退会落在「同文件旧视图态」上又被偏好恢复逻辑切回，
 * 净效果为零（用户实测：导图视图下侧键后退无反应）。
 *
 * 约定：钩子自带防御（实现内部吞错降级），故在切换成功后的**try 之外**调用——
 * 钩子异常既不影响打开流程，也不会被误报成「切换视图失败」。
 */
let viewSwitchDoneHook:
	| ((leaf: WorkspaceLeaf, filePath: string, viewType: string) => void)
	| null = null;

export function setViewSwitchDoneHook(
	hook:
		| ((leaf: WorkspaceLeaf, filePath: string, viewType: string) => void)
		| null,
): void {
	viewSwitchDoneHook = hook;
}

/**
 * 通知钩子（调用点兜底吞错）：钩子实现自带防御，但调用点仍兜一层——视图切换
 * 已经落定，后处理异常既不能让 `void openAsMindMap(...)`（文件菜单等无 catch
 * 的调用方）产生未处理拒绝，也不能被误报成「切换视图失败」（见 K111）。
 */
function notifyViewSwitchDone(
	leaf: WorkspaceLeaf,
	filePath: string,
	viewType: string,
): void {
	try {
		viewSwitchDoneHook?.(leaf, filePath, viewType);
	} catch (error) {
		console.debug('视图切换后处理失败:', filePath, error);
	}
}

export function isMindMapMarkdownFile(
	file: TFile | null | undefined,
): boolean {
	return (
		!!file &&
		file.extension === 'md' &&
		hasMindMapMarker(file.path)
	);
}

/**
 * 把当前 leaf 切换到导图视图（记录进入前的编辑/阅读模式，供返回）。
 */
export async function openAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	const mode: 'source' | 'preview' =
		leaf.view instanceof MarkdownView ? leaf.view.getMode() : 'source';
	openAsPreferenceHook?.(file.path);
	try {
		await leaf.setViewState({
			type: VIEW_TYPE,
			state: { file: file.path, mdBackMode: mode },
		});
	} catch (error) {
		// 叶子可能已被替换/分离：记录即可，避免 void 调用产生未处理拒绝
		console.error('切换到思维导图视图失败:', error);
		return;
	}
	// 落定后再清理：setViewState 完成时本次切换已记入导航历史（K111）
	notifyViewSwitchDone(leaf, file.path, VIEW_TYPE);
}

/** 从导图视图切回 Markdown（mode: source 编辑 / preview 阅读） */
export async function openAsMarkdown(
	leaf: WorkspaceLeaf,
	file: TFile,
	mode: 'source' | 'preview' = 'source',
): Promise<void> {
	try {
		await leaf.setViewState({
			type: CORE_VIEW_TYPE.MARKDOWN,
			state: { file: file.path, mode },
		});
	} catch (error) {
		console.error('切换到 Markdown 视图失败:', error);
		return;
	}
	// 同 openAsMindMap：切回同样是视图切换，不构成导航点（K111）
	notifyViewSwitchDone(leaf, file.path, CORE_VIEW_TYPE.MARKDOWN);
}
