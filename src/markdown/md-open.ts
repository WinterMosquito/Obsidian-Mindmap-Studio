/**
 * 视图打开不改文件：普通 .md 可临时编辑为导图，专用 .mindmap.md 按声明默认打开。
 * 显式选择只属于当前 leaf；返回 Markdown 不升级/降级属性，重启不恢复普通笔记导图。
 */
import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../core/constants';
import { isDedicatedMindMapPath } from '../domain/mindmap-file';
import { isMindMapEnabled, readMindMapLayout } from '../domain/mindmap-property';

interface ViewModeChoice { file: TFile; mode: 'mindmap' | 'markdown' }
const viewModes = new WeakMap<WorkspaceLeaf, ViewModeChoice>();

function currentChoice(leaf: WorkspaceLeaf, file: TFile): ViewModeChoice | undefined {
	const choice = viewModes.get(leaf);
	if (choice && choice.file.path !== file.path) {
		viewModes.delete(leaf);
		return undefined;
	}
	return choice;
}

/** 自动打开尊重当前标签明确选择的 Markdown；导航换文件后选择失效。 */
export function canAutoOpenMindMap(leaf: WorkspaceLeaf, file: TFile): boolean {
	return currentChoice(leaf, file)?.mode !== 'markdown';
}

/** 当前运行期显式打开过的导图；不保存到 workspace.json 或插件数据。 */
export function isExplicitMindMapOpen(leaf: WorkspaceLeaf, file: TFile): boolean {
	return currentChoice(leaf, file)?.mode === 'mindmap';
}

/** 进入前的 Markdown 模式，非法/缺失状态一律回退编辑模式。 */
export function readMdBackMode(state: unknown): 'source' | 'preview' {
	return (state as { mdBackMode?: unknown } | null)?.mdBackMode === 'preview'
		? 'preview' : 'source';
}

/**
 * 视图切换落定钩子（由组合根注入「导航历史卫生」，见 platform/workspace/nav-history，K111）：
 * 打开 / 切回是**视图切换**而非导航点——把 leaf 历史里同文件的跨视图冗余条目
 * 收敛掉；否则侧键后退会落在「同文件旧视图态」上又被声明驱动逻辑切回，
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

/** 专用 .mindmap.md 且启用属性命中时默认打开；普通笔记只走显式临时入口。 */
export function isMindMapFile(
	app: App,
	file: TFile | null | undefined,
): boolean {
	if (!file || !isDedicatedMindMapPath(file.path)) {
		return false;
	}
	return isMindMapEnabled(app.metadataCache.getFileCache(file)?.frontmatter);
}

/** 专用文件读取布局属性，普通笔记返回 null 并使用当前视图默认布局。 */
export function readDeclaredLayout(
	app: App,
	file: TFile | null | undefined,
): string | null {
	if (!file || !isDedicatedMindMapPath(file.path)) {
		return null;
	}
	return readMindMapLayout(
		app.metadataCache.getFileCache(file)?.frontmatter,
	);
}

/**
 * 切换期间挂在 `.workspace-leaf` 上的类（样式见 styles.css 同名选择器）。
 *
 * 为什么需要：Obsidian 打开文件**先**建 markdown 视图并渲染，之后才轮到这里
 * 的 `setViewState`——普通打开只差一两帧，但启动恢复（重启 / 重载库）时叶子是
 * 逐批恢复的，中间能隔上数百毫秒，用户看到的就是「先闪一屏 Markdown 原文，
 * 再变成导图」。藏住内容区（保留布局，只改可见性）把这段观感压成空一帧。
 *
 * 只藏内容区：标签栏、滚动条、背景都不动，不产生跳动。
 */
const SWITCHING_CLASS = 'mindmap-view-switching';

/**
 * 同一 leaf 在途的切换（`WeakMap`：leaf 被销毁即随引用回收）。
 *
 * 自动打开有两条触发线（`active-leaf-change` 与 `file-open` 的立即尝试），
 * 启动恢复时两者会命中同一个 leaf——不去重就会 `setViewState` 两次，
 * 后一次在遮罩被摘掉之后又切一遍，画面重新闪回 Markdown。
 */
const pendingSwitches = new WeakMap<WorkspaceLeaf, { path: string; promise: Promise<void> }>();

/**
 * 在途切换的兜底超时（ms）：超过它仍未 settle 就从 `pendingSwitches` 摘掉。
 *
 * 正常 `setViewState` 是几十毫秒级；真挂起（视图系统处于中间态）时若不清，
 * 该 leaf 此后**永远**进不去导图视图（后续每次触发都拿到那个永不完成的
 * Promise），而用户看到的是「这个文件点了没反应」。清掉只是允许重试，
 * 不影响那次仍可能后来完成 —— 完成时的清理按 Promise 身份判定，不会误删
 * 后来者的登记。
 */
const SWITCH_PENDING_TIMEOUT_MS = 3000;

/** 切当前标签到导图，记录进入前的编辑/阅读模式；不写属性或正文。 */
export function openAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	const pending = pendingSwitches.get(leaf);
	if (pending) {
		return pending.path === file.path
			? pending.promise
			: pending.promise.then(() => openAsMindMap(leaf, file));
	}
	viewModes.set(leaf, { file, mode: 'mindmap' });
	let timer: number | null = null;
	let done: Promise<void>;
	done = performOpenAsMindMap(leaf, file).finally(() => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
		// 只清自己（并发场景下后注册者覆盖，见上）
		if (pendingSwitches.get(leaf)?.promise === done) {
			pendingSwitches.delete(leaf);
		}
	});
	timer = window.setTimeout(() => {
		timer = null;
		// 卡死：摘掉登记让后续触发能重试（见 SWITCH_PENDING_TIMEOUT_MS）
		if (pendingSwitches.get(leaf)?.promise === done) {
			pendingSwitches.delete(leaf);
		}
	}, SWITCH_PENDING_TIMEOUT_MS);
	pendingSwitches.set(leaf, { path: file.path, promise: done });
	return done;
}

async function performOpenAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	// 已经是导图视图（重复触发 / 在导图标签内换文件）：不重复切换，否则白闪。
	// 防御式读：`leaf.view` 在叶子被分离的瞬间可能已清空（测试桩也没有这层）
	const view = leaf.view as
		| { getViewType?: () => string; containerEl?: HTMLElement; file?: TFile | null }
		| null
		| undefined;
	if (view?.getViewType?.() === VIEW_TYPE && view.file?.path === file.path) {
		return;
	}
	const mode: 'source' | 'preview' =
		leaf.view instanceof MarkdownView ? leaf.view.getMode() : 'source';
	// 遮罩挂在 `.workspace-leaf` 上：`setViewState` 只换 `.workspace-leaf-content`
	// 里的视图，外层节点自始至终是同一个（2026-11-03 实测）
	const host = view?.containerEl?.parentElement ?? null;
	host?.addClass(SWITCHING_CLASS);
	try {
		await leaf.setViewState({
			type: VIEW_TYPE,
			state: { file: file.path, mdBackMode: mode },
		});
	} catch (error) {
		// 叶子可能已被替换/分离：记录即可，避免 void 调用产生未处理拒绝
		console.error('切换到思维导图视图失败:', error);
		return;
	} finally {
		// 无论成败都要摘（失败时留着 = 该 leaf 永久空白）
		host?.removeClass(SWITCHING_CLASS);
	}
	// 落定后再清理：setViewState 完成时本次切换已记入导航历史（K111）
	notifyViewSwitchDone(leaf, file.path, VIEW_TYPE);
}

/** 从导图切回 Markdown；只影响当前标签，不改文件属性。 */
export async function openAsMarkdown(
	leaf: WorkspaceLeaf,
	file: TFile,
	mode: 'source' | 'preview' = 'source',
): Promise<void> {
	viewModes.set(leaf, { file, mode: 'markdown' });
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
