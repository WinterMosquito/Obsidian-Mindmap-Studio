/**
 * 声明模式文档：触发判定、声明读写与视图切换。
 *
 * 触发判据 = frontmatter 的 `Mindmap` 键值严格为 `Mindmap`（唯一收口在
 * domain/mindmap-property）。其它任何值（含默认回写的 `Markdown`）都不启用插件——
 * 插件不接管、不改文件、不写盘，交给 Obsidian 原生渲染。
 *
 * 布局只存在于 `Mindmap Layout` 键：`readDeclaredLayout` 是视图侧取布局的
 * **唯一入口**，`applyLayout`（view.ts）写属性也是唯一写入口。`data.json` 里
 * 不再有逐文件布局。
 *
 * 渲染承载（B3 显式切换）：命中的文件仍是普通 Markdown（默认用 Obsidian
 * markdown 视图打开）；插件在它出现于 markdown 视图时自动切到本插件的导图视图
 * （时机在 platform/mindmap-auto-open），用户可经「以 Markdown 打开」把它**持久
 * 降级**（把 `Mindmap` 改写为默认值 `Markdown`，布局键原样保留）。
 *
 * 打开方式不再存 data.json：文件本身就是声明，没有第二份状态可失配。
 */
import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../core/constants';
import { notifyError } from '../core/errors';
import { type Language } from '../core/i18n';
import {
	isMindMapDisabled,
	isMindMapEnabled,
	readLegacyLayout,
	readLegacyMindMapLayout,
	readMindMapLayout,
	setMindMapDisabled,
	setMindMapEnabled,
	setMindMapLayout,
} from '../domain/mindmap-property';

/**
 * 视图切换落定钩子（由组合根注入「导航历史卫生」，见 platform/nav-history，K111）：
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

/**
 * 本文件是否为「声明为思维导图」的 markdown（frontmatter 判据）。
 *
 * 走官方 MetadataCache（O(1) 缓存读取）：判据因此保持**同步**，文件菜单回调、
 * 命令 `checkCallback`、vault 事件这些只能同步返回的调用点无须改造。
 * 缓存尚未就绪（刚创建/刚改名）或读取失败时返回 false，由
 * `metadataCache.on('changed')` 补判（见 main.ts）。
 */
export function isMindMapFile(
	app: App,
	file: TFile | null | undefined,
): boolean {
	if (!file || file.extension !== 'md') {
		return false;
	}
	return isMindMapEnabled(app.metadataCache.getFileCache(file)?.frontmatter);
}

/**
 * 读本文件的布局声明（`Mindmap Layout` → 引擎 layout id）；无键 / 空值 / 未知值
 * 一律 `null`（由调用方回退设置项「默认布局」）。
 *
 * 同步读 MetadataCache——视图加载需要在**同步路径**上知道布局（手动升级不读它：
 * 那是「无声明」的入口，写的是种子值）。
 * 缓存滞后（刚写完属性）时返回 `null`，由调用方按默认布局兜底；随后的
 * `metadataCache.changed` 会把已打开的视图纠正过来（`view.syncDeclaredLayout`）。
 */
export function readDeclaredLayout(
	app: App,
	file: TFile | null | undefined,
): string | null {
	if (!file || file.extension !== 'md') {
		return null;
	}
	return readMindMapLayout(
		app.metadataCache.getFileCache(file)?.frontmatter,
	);
}

/**
 * 把文件切到「不启用」：`Mindmap` 改写为默认回写值 `Markdown`（**持久降级**）。
 *
 * 三个入口同语义：文件右键「以 Markdown 打开」、工具栏「切换回 Markdown」、
 * 命令 `mindmap-back-to-markdown`——同名动作不允许两种行为。
 *
 * 走官方 `FileManager.processFrontMatter`（YAML 解析/序列化归官方）；只改启用键，
 * **布局键与正文一律不动**——这正是「切回 Markdown 再切回来，布局还在」的原因。
 *
 * 短路条件只有「值已经就是 `Markdown`」：属幂等优化，避免每次切换都重序列化 YAML。
 * 键名恒为标准键 `Mindmap`（`setMindMapDisabled` 顺带收敛同名变体）。
 */
async function downgradeMindMapProperty(
	app: App,
	file: TFile,
	lang: Language,
): Promise<void> {
	if (isMindMapDisabled(app.metadataCache.getFileCache(file)?.frontmatter)) {
		return;
	}
	try {
		await app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				// 权威判据（缓存可能滞后）：已经是默认回写值时不覆盖
				if (isMindMapDisabled(fm)) {
					return;
				}
				setMindMapDisabled(fm);
			},
		);
	} catch (error) {
		// 用户可感：属性没改写成功，下次打开还会自动进导图——不能静默
		//（改写失败也不阻断切回 Markdown：视图仍切，属性问题单独提示）。
		console.error('改写思维导图属性失败，下次打开仍会进入导图视图:', file.path, error);
		notifyError(lang, 'command.downgradeFailed', error);
	}
}

/**
 * 把文件提升为「启用插件」（**持久升级**）：手动把任一篇普通笔记开为导图后的
 * 副作用——让它在 frontmatter 里正式成为导图，下次自动打开。
 *
 * 写 `Mindmap: Mindmap`；**布局键缺失或非法时**才补布局，取值顺序：① 旧契约写在
 * 启用键里的布局值（`Mindmap: Timeline`，见 `readLegacyLayout`）；② 布局键里的
 * 旧写法（`Mindmap Layout: LogicalStructure`，见 `readLegacyMindMapLayout`）；
 * ③ 种子值（设置「默认布局」对应的引擎 id，由调用方传入——`md-open` 不引
 * settings）。已有合法布局原样保留：升级动作不能把用户已选的布局重置成默认值。
 *
 * 走官方 `processFrontMatter`，键名与语言无关。**已启用且布局合法时不改写**
 * （免每次打开重序列化 YAML）；回调内再做一次权威判据兜住缓存滞后。
 */
async function upgradeMindMapProperty(
	app: App,
	file: TFile,
	lang: Language,
	seedLayout: string,
): Promise<void> {
	const cached = app.metadataCache.getFileCache(file)?.frontmatter;
	if (isMindMapEnabled(cached) && readMindMapLayout(cached) !== null) {
		// 已启用且布局合法：免磁盘写入
		return;
	}
	try {
		await app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				// 旧布局值有两个落点，都必须在写之前读：
				// ① 旧契约把布局写在启用键里（`Mindmap: Timeline`）——启动迁移会搬走它，
				//    但迁移尚未跑到时（刚同步进来的文件）不能把用户的布局选择换成种子值，
				//    且 `setMindMapEnabled` 会覆盖这一格；
				// ② 手改成布局键却还是旧写法（`Mindmap Layout: LogicalStructure`）——
				//    `readMindMapLayout` 只认 kebab，不接住同样会被种子值覆盖。
				const legacy =
					readLegacyLayout(frontmatter) ??
					readLegacyMindMapLayout(frontmatter);
				setMindMapEnabled(frontmatter);
				// 保留文件已声明的布局；缺失/非法才落旧值/种子值
				if (readMindMapLayout(frontmatter) === null) {
					setMindMapLayout(frontmatter, legacy ?? seedLayout);
				}
			},
		);
	} catch (error) {
		// 用户可感：声明没写成功，下次打开不会自动进导图——不能静默
		console.error('写入思维导图属性失败，导图声明不会持久:', file.path, error);
		notifyError(lang, 'command.upgradeFailed', error);
	}
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
const pendingSwitches = new WeakMap<WorkspaceLeaf, Promise<void>>();

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

/**
 * 把当前 leaf 切换到导图视图（记录进入前的编辑/阅读模式，供返回）。
 *
 * 纯视图切换、不写文件——声明驱动自动打开（platform/mindmap-auto-open）与
 * 已声明文件的入口走这里；手动把普通笔记开为导图需先经 `declareAndOpenAsMindMap`
 * 把声明落盘。
 */
export function openAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	const pending = pendingSwitches.get(leaf);
	if (pending) {
		return pending;
	}
	let timer: number | null = null;
	let done: Promise<void>;
	done = performOpenAsMindMap(leaf, file).finally(() => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
		// 只清自己（并发场景下后注册者覆盖，见上）
		if (pendingSwitches.get(leaf) === done) {
			pendingSwitches.delete(leaf);
		}
	});
	timer = window.setTimeout(() => {
		timer = null;
		// 卡死：摘掉登记让后续触发能重试（见 SWITCH_PENDING_TIMEOUT_MS）
		if (pendingSwitches.get(leaf) === done) {
			pendingSwitches.delete(leaf);
		}
	}, SWITCH_PENDING_TIMEOUT_MS);
	pendingSwitches.set(leaf, done);
	return done;
}

async function performOpenAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	// 已经是导图视图（重复触发 / 在导图标签内换文件）：不重复切换，否则白闪。
	// 防御式读：`leaf.view` 在叶子被分离的瞬间可能已清空（测试桩也没有这层）
	const view = leaf.view as
		| { getViewType?: () => string; containerEl?: HTMLElement }
		| null
		| undefined;
	if (view?.getViewType?.() === VIEW_TYPE) {
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

/**
 * 手动「以思维导图打开」：先把声明写入 frontmatter（标准键 `Mindmap`、值为
 * `seedLayout` 对应的属性标准值），再切到导图视图。使任一篇笔记经本入口打开
 * 后即成为正式导图，下次自动打开。已是声明的文件不重复写（见
 * `upgradeMindMapProperty`）。
 *
 * @param seedLayout 引擎 layout id（组合根传 `settings.defaultLayout`）——
 *   这里刻意不给默认值：第二个「默认布局」来源会与设置项各说各话。
 */
export async function declareAndOpenAsMindMap(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	lang: Language,
	seedLayout: string,
): Promise<void> {
	await upgradeMindMapProperty(app, file, lang, seedLayout);
	await openAsMindMap(leaf, file);
}

/**
 * 从导图视图切回 Markdown（mode: source 编辑 / preview 阅读）。
 *
 * 先降级属性再切换：改写属性后本 leaf 的导图视图仍持有文件，卸载时的保存会按
 * K45 读磁盘现值（此时已是 `Markdown`）回贴，不会把改写结果覆盖回 `Mindmap`。
 */
export async function openAsMarkdown(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	mode: 'source' | 'preview' = 'source',
	lang: Language = 'zh',
): Promise<void> {
	await downgradeMindMapProperty(app, file, lang);
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
