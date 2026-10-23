/**
 * 声明模式文档：触发判定与视图切换。
 *
 * 触发判据 = frontmatter 的 `Type` / `类型` 值为 `mindmap`（唯一收口在
 * domain/mindmap-property）。文件**名**不再参与判定——`.mindmap.md` 后缀连同
 * 其判定/剥离/拼接三函数已于 2026-10-12 退役（存量文件由迁移命令改为
 * `命名.md` + 属性声明）。
 *
 * 渲染承载（B3 显式切换）：命中的文件仍是普通 Markdown（默认用 Obsidian
 * markdown 视图打开）；插件在它出现于 markdown 视图时自动切到本插件的导图视图
 * （时机在 platform/mindmap-auto-open），用户可经「以 Markdown 打开」把它**持久
 * 降级**（改写属性为 `Markdown`）。
 *
 * 打开方式不再存 data.json：文件本身就是声明，没有第二份状态可失配。
 */
import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../core/constants';
import { notifyError } from '../core/errors';
import { type Language } from '../core/i18n';
import {
	convergeMindMapPropertyKey,
	isMindMapDeclarationValue,
	isMindMapProperty,
	isMindMapPropertyKey,
	mindMapPropertyKey,
	MINDMAP_MARKDOWN_VALUE,
	MINDMAP_TYPE_VALUE,
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
	return isMindMapProperty(app.metadataCache.getFileCache(file)?.frontmatter);
}

/**
 * 把文件的导图声明改写为 `Markdown`（**持久降级**）。
 *
 * 三个入口同语义：文件右键「以 Markdown 打开」、工具栏「切换回 Markdown」、
 * 命令 `mindmap-back-to-markdown`——同名动作不允许两种行为。
 *
 * 走官方 `FileManager.processFrontMatter`（YAML 解析/序列化归官方）；只改
 * **命中的那个键**（保留用户原本写的是 `Type` 还是 `类型`），其它属性与正文
 * 一律不动——正文由其后的保存管线按 K45 取**磁盘现值**回贴，故两者先后顺序
 * 无需额外协调。无命中键（本就不是声明文件）时不写入。
 *
 * 键名随语言收敛（`convergeMindMapPropertyKey`）：命中键改写为 `Markdown` 的同时
 * 把 `Type`/`类型` 收敛为当前语言的唯一键，避免降级后两把键并存。
 */
async function downgradeMindMapProperty(
	app: App,
	file: TFile,
	lang: Language,
): Promise<void> {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	// 已有 `类型`/`Type` 但值非导图（如已是 `Markdown`）→ 不动 YAML（目的已达）
	if (frontmatter && hasAnyMindMapKey(frontmatter) && !isMindMapProperty(frontmatter)) {
		return;
	}
	try {
		await app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				// 权威判据（缓存可能滞后）：已有非导图属性时不覆盖值
				if (hasAnyMindMapKey(fm) && !isMindMapProperty(fm)) {
					return;
				}
				convergeMindMapPropertyKey(fm, lang, MINDMAP_MARKDOWN_VALUE);
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
 * 把文件提升为「声明为思维导图」（**持久升级**）：手动把任一篇普通笔记开为
 * 导图后的副作用——让它在 frontmatter 里正式成为导图，下次自动打开。
 *
 * 走官方 `processFrontMatter`，经 `convergeMindMapPropertyKey` 把声明收敛为
 * 当前语言的唯一键（zh `类型` / en `Type`）、值 `Mindmap`。**已声明为导图且
 * 键唯一时不改写**（免每次打开重序列化 YAML）；外层 `isMindMapFile` 用
 * MetadataCache 做「免写」优化，回调内再做一次权威判据兜住缓存滞后——即便优化
 * 失效也绝不新增第二把键（这正是「改语言后 `Type`/`类型` 并存」的根因）。
 */
async function upgradeMindMapProperty(
	app: App,
	file: TFile,
	lang: Language,
): Promise<void> {
	if (isMindMapFile(app, file)) {
		// 已是 Mindmap 声明：免磁盘写入（值已正确，不必动 YAML）
		return;
	}
	try {
		await app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				const keys = Object.keys(frontmatter).filter(isMindMapPropertyKey);
				if (isMindMapProperty(frontmatter)) {
					// 缓存误判「未声明」：文件其实已声明——仅在存在重复键时收敛，
					// 否则原样保留（不因打开而重命名键，键名收敛交给语言切换迁移）
					if (keys.length > 1) {
						convergeMindMapPropertyKey(frontmatter, lang);
					}
					return;
				}
				convergeMindMapPropertyKey(frontmatter, lang, MINDMAP_TYPE_VALUE);
			},
		);
	} catch (error) {
		// 用户可感：声明没写成功，下次打开不会自动进导图——不能静默
		console.error('写入思维导图属性失败，导图声明不会持久:', file.path, error);
		notifyError(lang, 'command.upgradeFailed', error);
	}
}

/** frontmatter 是否含 `类型`/`Type` 键（不看值；键名大小写不敏感） */
function hasAnyMindMapKey(frontmatter: Record<string, unknown>): boolean {
	return Object.keys(frontmatter).some(isMindMapPropertyKey);
}

/**
 * 把当前 leaf 切换到导图视图（记录进入前的编辑/阅读模式，供返回）。
 *
 * 纯视图切换、不写文件——声明驱动自动打开（platform/mindmap-auto-open）与
 * 已声明文件的入口走这里；手动把普通笔记开为导图需先经 `declareAndOpenAsMindMap`
 * 把声明落盘。
 */
export async function openAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	const mode: 'source' | 'preview' =
		leaf.view instanceof MarkdownView ? leaf.view.getMode() : 'source';
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

/**
 * 手动「以思维导图打开」：先把声明写入 frontmatter（按语言选 `类型`/`Type`、
 * 值 `Mindmap`），再切到导图视图。使任一篇笔记经本入口打开后即成为正式导图，
 * 下次自动打开。已是声明的文件不重复写（见 `upgradeMindMapProperty`）。
 */
export async function declareAndOpenAsMindMap(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	lang: Language = 'zh',
): Promise<void> {
	await upgradeMindMapProperty(app, file, lang);
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

/**
 * 语言切换后的属性键迁移：把库内每个含 `类型`/`Type` 键的 md 文件的声明键
 * **重命名为当前语言的键**（zh `类型` ⇄ en `Type`），并收敛历史遗留的重复键。
 *
 * 这是「改语言时键名随语言走」的唯一入口。要点：
 * - 只改**键名**（值 `Mindmap`/`Markdown` 原样保留）；
 * - **只认本插件写的值**（`isMindMapDeclarationValue`）：`类型: wiki` 这类同名但
 *   语义无关的属性属于用户数据，按键名全库改名会把它变成 `Type: wiki`
 *   （2026-10-23 实测踩到，本库 10 页笔记被改）；
 * - 目标键已被**非声明值**占用时整文件跳过（`converge` 会把值迁到目标键上、
 *   直接覆盖那条无关属性）；
 * - 已是唯一目标键 → 免写（避免每次切语言全库重写）；
 * - 只触碰含声明的文件，逐个 `processFrontMatter`（YAML 由官方序列化）；
 *   单文件失败只留痕（`console.error`）并继续——一次迁移不因个别文件半途而废。
 *
 * 键名收敛的原子实现见 `domain/mindmap-property.convergeMindMapPropertyKey`。
 */
export async function migrateMindMapPropertyKeys(
	app: App,
	lang: Language,
): Promise<void> {
	const target = mindMapPropertyKey(lang);
	for (const file of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) {
			continue;
		}
		const keys = Object.keys(frontmatter).filter(
			(key) =>
				isMindMapPropertyKey(key) && isMindMapDeclarationValue(frontmatter[key]),
		);
		if (keys.length === 0) {
			continue;
		}
		// 已是唯一目标键 → 无需改写（迁移的常见路径，必须免写）
		if (keys.length === 1 && keys[0] === target) {
			continue;
		}
		// 目标键被非声明值占着（`类型: wiki` + `Type: Mindmap` 这类混用库）⇒ 跳过：
		// converge 会把声明值迁到目标键上并覆盖那条无关属性。
		if (
			frontmatter[target] !== undefined &&
			!isMindMapDeclarationValue(frontmatter[target])
		) {
			console.warn('属性键迁移跳过（目标键已被非导图属性占用）:', file.path);
			continue;
		}
		try {
			await app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					convergeMindMapPropertyKey(fm, lang);
				},
			);
		} catch (error) {
			console.error('迁移思维导图属性键失败:', file.path, error);
		}
	}
}
