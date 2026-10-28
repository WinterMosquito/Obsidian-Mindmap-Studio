/**
 * 声明模式文档：触发判定、声明读写与视图切换。
 *
 * 触发判据 = frontmatter 的 `Mindmap` 键值为**布局枚举**之一（唯一收口在
 * domain/mindmap-property；旧键 `Type` / `类型` 自 2026-10-28 起完全不认）。
 * 文件**名**不再参与判定——`.mindmap.md` 后缀连同
 * 其判定/剥离/拼接三函数已于 2026-10-12 退役（存量文件由迁移命令改为
 * `命名.md` + 属性声明）。
 *
 * 布局只存在于文件属性（2026-10-29）：`readDeclaredLayout` 是视图侧取布局的
 * **唯一入口**，`applyLayout`（view.ts）写属性也是唯一写入口。`data.json` 里
 * 不再有逐文件布局。
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
	isMindMapPropertyKey,
	layoutPropertyValue,
	MINDMAP_MARKDOWN_VALUE,
	readMindMapDeclaration,
	setMindMapProperty,
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
	return readMindMapDeclaration(app.metadataCache.getFileCache(file)?.frontmatter)
		?.kind === 'layout';
}

/**
 * 读本文件声明的布局（引擎 layout id）；未声明 / 终止值 `Markdown` / 未知值
 * 一律 `null`。
 *
 * 同步读 MetadataCache——视图加载需要在**同步路径**上知道布局（手动升级不读它：
 * 那是「无声明」的入口，写的是种子值）。
 * 缓存滞后（刚写完属性）时返回 `null`，由调用方按种子值兜底；随后的
 * `metadataCache.changed` 会把已打开的视图纠正过来（`view.syncDeclaredLayout`）。
 */
export function readDeclaredLayout(
	app: App,
	file: TFile | null | undefined,
): string | null {
	if (!file || file.extension !== 'md') {
		return null;
	}
	const declaration = readMindMapDeclaration(
		app.metadataCache.getFileCache(file)?.frontmatter,
	);
	return declaration?.kind === 'layout' ? declaration.layoutId : null;
}

/**
 * 把文件的导图声明改写为 `Markdown`（**持久降级**）。
 *
 * 三个入口同语义：文件右键「以 Markdown 打开」、工具栏「切换回 Markdown」、
 * 命令 `mindmap-back-to-markdown`——同名动作不允许两种行为。
 *
 * 走官方 `FileManager.processFrontMatter`（YAML 解析/序列化归官方）；只改
 * 声明键 `Mindmap`，其它属性与正文一律不动——正文由其后的保存管线按 K45 取
 * **磁盘现值**回贴，故两者先后顺序无需额外协调。
 *
 * 短路条件只有「值**已经就是** `Markdown`」：其余（含旧语义下的 `Mindmap`、
 * 用户手写的未知值）一律改写——`Mindmap: Mindmap` 现在是「思维导图布局」，
 * 不认识它的旧版本会把它当导图打开，只有 `Markdown` 才是明确的终止值。
 *
 * 键名恒为标准键 `Mindmap`（`setMindMapProperty` 顺带收敛同名大小写变体），
 * 与界面语言无关。
 */
async function downgradeMindMapProperty(
	app: App,
	file: TFile,
	lang: Language,
): Promise<void> {
	const isTerminated = (frontmatter: unknown): boolean =>
		readMindMapDeclaration(frontmatter)?.kind === 'markdown';
	if (isTerminated(app.metadataCache.getFileCache(file)?.frontmatter)) {
		return;
	}
	try {
		await app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				// 权威判据（缓存可能滞后）：已经是终止值时不覆盖
				if (isTerminated(fm)) {
					return;
				}
				setMindMapProperty(fm, MINDMAP_MARKDOWN_VALUE);
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
 * 写入的是**种子值**：设置「默认布局」对应的属性标准值（不是恒写 `Mindmap`）
 * ——升级出来的文件与「新建导图」得到同一个初始布局。`md-open` 不引 settings
 * （组合根禁令），故种子由调用方以引擎 id 传入。
 *
 * 走官方 `processFrontMatter`，经 `setMindMapProperty` 把声明写到标准键
 * `Mindmap`（键名与语言无关）。**已声明为导图时不改写**（免每次打开重序列化
 * YAML）；外层 `isMindMapFile` 用 MetadataCache 做「免写」优化，回调内再做一次
 * 权威判据兜住缓存滞后——即便优化失效也绝不新增第二把键，且收敛同名变体时
 * **保留文件已声明的布局**（种子值只用于「本来就不是导图」的文件）。
 */
async function upgradeMindMapProperty(
	app: App,
	file: TFile,
	lang: Language,
	seedLayout: string,
): Promise<void> {
	if (isMindMapFile(app, file)) {
		// 已是导图声明：免磁盘写入（布局已正确，不必动 YAML）
		return;
	}
	const seedValue = layoutPropertyValue(seedLayout);
	try {
		await app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				const keys = Object.keys(frontmatter).filter(isMindMapPropertyKey);
				const declared = readMindMapDeclaration(frontmatter);
				if (declared?.kind === 'layout') {
					// 缓存误判「未声明」：文件其实已声明——仅在存在同名变体时收敛，
					// 否则原样保留（不因打开而重写键）。收敛写的是**声明值**：
					// ① 不能写种子值——那是「新建/升级时的初始布局」，用它收敛等于
					//    把用户已选的布局静默重置（`Mindmap: Timeline` + `mindmap: …`
					//    这种同名变体并存即可踩到）；
					// ② 写的是**标准值**（`declared.value` 已归一为 PascalCase）——
					//    不带值的 `setMindMapProperty(frontmatter)` 会原样留下用户拼写
					//    （`mind map` / `mindmap`），收敛就白做了。
					if (keys.length > 1) {
						setMindMapProperty(frontmatter, declared.value);
					}
					return;
				}
				setMindMapProperty(frontmatter, seedValue);
			},
		);
	} catch (error) {
		// 用户可感：声明没写成功，下次打开不会自动进导图——不能静默
		console.error('写入思维导图属性失败，导图声明不会持久:', file.path, error);
		notifyError(lang, 'command.upgradeFailed', error);
	}
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
