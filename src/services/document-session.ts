/**
 * 文档会话：**一个文件一份权威树 + 一条撤销时间线 + 一条保存管线**（Level B）。
 *
 * ## 为什么要它
 * 每个导图视图各有一套引擎 / 历史 / 保存管线时（Level A）：
 * - 一侧编辑要等它自己写盘、另一侧再从磁盘重载并**重建引擎**才可见（实机
 *   ≈2.2 s，且历史 / 选中态随旧实例丢弃）；
 * - 两侧都编辑时后写者覆盖前者（K177 只提示不阻止）；
 * - 撤销线各视图一条，B 撤不掉 A 的修改。
 *
 * ## 职责边界
 * - **数据**：`tree` 是唯一可写真相；视图引擎树只是只读投影。
 * - **历史**：`SessionHistory`（单游标），见该模块文件头。
 * - **保存**：`SavePipeline` 由会话持有（2 s 防抖 / 关闭 flush / 纯浏览守卫
 *   全部沿用）；视图不再各自排保存。
 * - **UI**：一律经 `SessionViewPort` 窄接口回调（投票「哪个视图是活动视图」
 *   交视图实现）——services 不依赖 features（模块矩阵）。
 *
 * ## 无回声的关键
 * 广播**不**走引擎 `updateData()`：它会 `command.addHistory()`，进而发出
 * `data_change`（编辑期该事件的唯一发源），接收视图就会再排一次保存、
 * 再跑一遍语法守卫 / 标题改名（双写 + 重复编排）。`engine/mindmap-snapshot`
 * 走「`handleData` + `renderer.setData` + `render`」——实测历史不增、
 * `data_change` 不发、视口与选中不变（2026-11-09 实机）。
 *
 * ## 外部写入（对齐官方 1.15.0）
 * 官方：外部改动总是进入视图（能合并则合并、否则替换），**只有该视图有未
 * 保存改动时**弹一次「已被外部修改，正在自动合并更改」，整次外部改动是一条
 * 可撤销步骤（Ctrl+Z 回到草稿，随后的自动保存再把草稿写回）。
 *
 * 本插件不做树级合并（会重写未编辑行、违反 `mdRaw` 逐字保真），故恒定走
 * 官方那条「不可合并」分支：放弃本轮写盘 → 从磁盘重载 → 把重载后的新树
 * **追加为一条历史**（于是 Ctrl+Z 正好回到草稿）→ 有草稿时提示一次、无草稿
 * 静默。草稿找回后照常排保存，与官方「撤销后写回」一致。
 */
import { App, TFile } from 'obsidian';
import { createDebouncer, type Debouncer } from '../core/concurrency';
import type { MindMapTreeNode } from '../core/engine-types';
import { cloneTree as cloneJsonTree, walkTree } from '../domain/tree';
import { resolveHistoryLimit } from '../engine/mindmap-history';
import { splitFrontmatter } from '../markdown/md-outline';
import { withDefaultImageSizes } from '../media/images-path';
import {
	DocumentService,
	SavePipeline,
	type DocumentLoadResult,
} from './document-service';
import { SessionHistory } from './document-session-history';

/**
 * 跨视图广播的**大图**合并窗口（ms）。
 *
 * 引擎的 `data_change` 已由 `addHistoryTime`（本插件设为 16 ms，见
 * `engine/mindmap` 的 `HISTORY_ADD_THROTTLE_MS`）节流；这里再合并一层只为把
 * 「连续输入触发的多次提交」压成一次广播。5000 节点实测每次应用 ≈90–141 ms，
 * 逐键广播会占满主线程，所以大图仍留窗口；小图见下方直接广播阈值。
 */
export const SESSION_BROADCAST_DELAY_MS = 60;

/**
 * 小图直接广播阈值（节点数）。
 *
 * 官方 Markdown 视图是「编辑即推送」（实测 ≈12 ms）。本插件的应用是整树
 * 渲染，成本随节点数线性上升：小图一次应用只有几毫秒，完全没必要再等合并
 * 窗口——直接 0 延迟（下一任务）推送，体感向官方靠拢；大图仍走 60 ms 合并，
 * 避免逐键把主线程占满（K185）。
 */
const SESSION_DIRECT_BROADCAST_NODE_LIMIT = 600;

/** 按节点数选择广播合并窗口：小图 0（下一任务即推送）/ 大图 60 ms */
export function computeBroadcastDelayMs(nodeCount: number): number {
	return nodeCount <= SESSION_DIRECT_BROADCAST_NODE_LIMIT
		? 0
		: SESSION_BROADCAST_DELAY_MS;
}

/** 保存状态（与 `services/status-bar` 的 `SaveState` 同值域） */
export type SessionSaveState = 'idle' | 'saving' | 'saved' | 'unsaved';

/**
 * 视图对会话的最小契约（services 不依赖 features，故由视图实现）。
 *
 * 所有方法都必须**幂等且可重入安全**：广播期间可能叠加重入（例如
 * `beforeApplySnapshot` 提交内联编辑器又触发一次提交）。
 */
export interface SessionViewPort {
	/** 当前文件路径（视图切换文件后随之变化） */
	readonly path: string;
	/** 本视图此刻是否是工作区活动视图（状态栏只由活动视图写，K166） */
	readonly isActiveView: boolean;
	/** 应用快照前：提交并收起内联编辑器、取消选点 / 联系锚定等节点引用会话 */
	beforeApplySnapshot(): void;
	/**
	 * 应用快照（视图实现负责调 `engine/mindmap-snapshot.applySessionSnapshot`）。
	 *
	 * @returns 是否真的应用（引擎尚未创建 / 已销毁时 false）：会话据此决定
	 *   「已应用版本」，未应用的下一次 `onViewReady` 会补。
	 */
	applySnapshot(tree: MindMapTreeNode): boolean;
	/** 应用快照后：只刷新界面（状态栏 / 小地图 / 历史按钮），**不排保存** */
	afterApplySnapshot(): void;
	/** 保存状态（写本视图字段；是否推给共享状态栏由视图按活动态决定） */
	setSessionSaveState(state: SessionSaveState): void;
	/** 外部写入重载完成（有草稿时必须提示一次） */
	notifyExternalReload(): void;
	/** 本次提交基于旧树、已被拒绝（另一视图刚提交）：提示一次 */
	notifyStaleCommit(): void;
}

export interface DocumentSessionOptions {
	app: App;
	file: TFile;
	/** 广播合并窗口（测试可调小；缺省按节点数 `computeBroadcastDelayMs`） */
	broadcastDelayMs?: number;
	/**
	 * 测试注入：文档是否隐藏（缺省读 `document.visibilityState`）。
	 * 隐藏窗口里不应用快照（rAF 已暂停，渲染只会堆积），恢复可见时补一次。
	 */
	isDocumentHidden?: () => boolean;
	/** 最后一个视图解绑后回调（注册表据此移除条目） */
	onEmpty?: (session: DocumentSession) => void;
	/**
	 * 测试注入：读盘 + 解析（缺省 `DocumentService.load`）。
	 * 生产路径不需要——只有单测要绕开 Obsidian 运行时。
	 */
	loadDocument?: (file: TFile) => Promise<DocumentLoadResult>;
	/** 测试注入：原样正文 → 解析结果（外部写入重载用；缺省 `DocumentService.parse`） */
	parseDocument?: (raw: string, file: TFile) => DocumentLoadResult;
}

/** 判等：引擎数据树是纯 JSON，逐字比较即可（与 `addHistory` 同口径） */
function sameTree(left: MindMapTreeNode, right: MindMapTreeNode): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** 树的节点数（历史上限预算用） */
function countNodes(tree: MindMapTreeNode): number {
	let count = 0;
	walkTree(tree, () => {
		count++;
	});
	return count;
}

export class DocumentSession {
	private readonly app: App;
	private readonly documents: DocumentService;
	private readonly loadDocument: (file: TFile) => Promise<DocumentLoadResult>;
	private readonly parseDocument: (
		raw: string,
		file: TFile,
	) => DocumentLoadResult;
	private readonly savePipeline: SavePipeline;
	private readonly history: SessionHistory<MindMapTreeNode>;
	private readonly views = new Set<SessionViewPort>();
	/** 每个视图已应用的会话版本（`onViewReady` 补一次「落后」的视图） */
	private readonly appliedVersions = new WeakMap<SessionViewPort, number>();
	/** 每个视图上一次「过期提交」提示时的会话版本（同一版本只提示一次） */
	private readonly staleNotifiedVersion = new WeakMap<SessionViewPort, number>();
	/** 合并窗口按图规模动态选择（小图 0 / 大图 60 ms），延迟变化时重建 */
	private broadcastDebouncer: Debouncer = createDebouncer(0);
	private broadcastDelayValue = -1;
	/** 隐藏窗口里被推迟的广播（恢复可见时补一次，避免后台堆积渲染） */
	private pendingHiddenBroadcast = false;
	private readonly visibilityListener: (() => void) | null = null;
	private readonly onEmpty: ((session: DocumentSession) => void) | undefined;
	/** 首次加载的进行中 Promise（并发 acquire 必须等同一份，不能各自返回空树） */
	private loadPromise: Promise<void> | null = null;

	private treeValue: MindMapTreeNode | null = null;
	private frontmatterValue: string | null = null;
	private rawBodyValue = '';
	/** 会话内容版本：每次 tree 变更 +1（用于视图就绪时补同步） */
	private versionValue = 0;
	private loaded = false;
	private loading = false;
	private applying = false;
	/** 会话已销毁（最后一个视图解绑 / 插件卸载） */
	private disposed = false;
	/** 首次引擎就绪时记一次加载基线（K156④：引擎重建不得重记） */
	private baselineRecorded = false;
	private reloading = false;
	private pendingReload = false;
	private lastSaveState: SessionSaveState = 'idle';
	/** 本轮广播的发起视图：不给自己应用（它已经是新内容，重渲染只会抢焦点） */
	private pendingOrigin: SessionViewPort | null = null;
	constructor(private readonly options: DocumentSessionOptions) {
		this.app = options.app;
		this.documents = new DocumentService(options.app);
		this.loadDocument =
			options.loadDocument ?? ((file) => this.documents.load(file));
		this.parseDocument =
			options.parseDocument ??
			((raw, file) => this.documents.parse(raw, file));
		this.onEmpty = options.onEmpty;
		// 恢复可见时补广播：隐藏窗口里 `rAF` 已暂停，此时应用快照只会把渲染
		// 任务堆在队列里（官方在后台同样不重绘）
		if (typeof document !== 'undefined') {
			this.visibilityListener = () => this.handleVisibilityChange();
			document.addEventListener('visibilitychange', this.visibilityListener);
		}
		this.history = new SessionHistory<MindMapTreeNode>(() =>
			resolveHistoryLimit(this.treeValue ? countNodes(this.treeValue) : 1),
		);
		this.savePipeline = new SavePipeline({
			app: this.app,
			getFile: () => this.file,
			// 归属不变式：内容按文件取，且只认本会话（会话与文件一一对应）
			getSnapshotFor: (file) => (file.path === this.path ? this.treeValue : null),
			getFrontmatterFor: (file) =>
				file.path === this.path ? this.frontmatterValue : null,
			onSaveError: () => this.routeSaveState('unsaved'),
			onSaved: () => this.routeSaveState('saved'),
			// 写盘前发现磁盘正文被别处改过 ⇒ 放弃本轮（不覆盖），改走重载
			onExternalAbort: () => {
				void this.reloadFromDisk();
			},
		});
	}

	/** 会话当前文件（重命名后 `TFile` 实例原地更新，路径随之变化） */
	get file(): TFile {
		return this.options.file;
	}

	get path(): string {
		return this.file.path;
	}

	/** 会话内容版本（视图就绪时比对是否落后） */
	get version(): number {
		return this.versionValue;
	}

	/** 权威树（只读；调用方需要写时先深拷贝） */
	get tree(): MindMapTreeNode | null {
		return this.treeValue;
	}

	/** 当前保存状态（视图切换活动态时重推） */
	get saveState(): SessionSaveState {
		return this.lastSaveState;
	}

	/** 已绑定的视图数 */
	get viewCount(): number {
		return this.views.size;
	}

	get destroyed(): boolean {
		return this.disposed;
	}

	/** 首次加载：读盘 + 解析（后续视图复用同一棵树与同一条历史） */
	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}
		// 两个视图同时 onLoadFile 时必须等**同一次**读取：直接返回会让后来者
		// 拿到尚未就绪的树（`cloneTree()` 为 null ⇒ 视图报「加载失败」）。
		this.loadPromise ??= this.doLoad();
		return this.loadPromise;
	}

	private async doLoad(): Promise<void> {
		this.loading = true;
		try {
			const doc = await this.loadDocument(this.file);
			this.treeValue = doc.tree;
			this.frontmatterValue = doc.frontmatter;
			this.rawBodyValue = doc.body;
			this.history.reset(doc.tree);
			this.versionValue++;
			this.loaded = true;
		} finally {
			this.loading = false;
			this.loadPromise = null;
		}
	}

	/** 深拷贝一份权威树（视图建引擎 / 广播用；避免跨视图串改） */
	cloneTree(): MindMapTreeNode | null {
		return this.treeValue ? cloneJsonTree(this.treeValue) : null;
	}

	/**
	 * 绑定视图（不发内容：视图在自己的加载路径里取 `cloneTree()`）。
	 *
	 * 同时**预置「已应用版本」**：视图紧接着就用 `cloneTree()` 建引擎，内容与
	 * 此刻的会话树逐字相同——不预置的话 `onViewReady` 会把它判成「落后」，
	 * 再用 `applySessionSnapshot` 重放一次整树（大图 ≈90–141 ms 白付一次渲染，
	 * 2026-11-09 实测）。
	 *
	 * 只在**落后**时补：绑定与 `cloneTree()` 之间没有 await，故预置版本就是
	 * 视图拿到的内容；期间若有别的视图提交，版本变了，`onViewReady` 仍会补一次。
	 */
	attach(port: SessionViewPort): void {
		if (this.destroyed) {
			return;
		}
		this.views.add(port);
		this.appliedVersions.set(port, this.versionValue);
	}

	/**
	 * 视图引擎就绪：若它在加载期间落后于会话版本（另一视图已提交），补一次应用。
	 * 引擎尚未建好时视图不会走到这里（`onEngineReady` 才调）。
	 */
	onViewReady(port: SessionViewPort): void {
		if (this.destroyed || !this.treeValue) {
			return;
		}
		if (this.appliedVersions.get(port) === this.versionValue) {
			return;
		}
		this.applyToPort(port);
	}

	/**
	 * 解绑视图：**每次解绑都 flush**（对齐官方 `TextFileView.onUnloadFile`：
	 * 关闭即保存、无差异由管线跳过），最后一个视图解绑后销毁会话。
	 */
	async detach(port: SessionViewPort): Promise<void> {
		if (!this.views.delete(port)) {
			return;
		}
		this.appliedVersions.delete(port);
		try {
			await this.flush();
		} catch (error) {
			console.error('会话关闭保存失败', error);
		}
		if (this.views.size === 0) {
			this.destroy();
			this.onEmpty?.(this);
		}
	}

	/** 立即写盘（关闭 / 换文件 / 显式保存；无差异由管线跳过） */
	async flush(): Promise<void> {
		// 基线未记录（引擎首帧前）时不能写：序列化结果与磁盘原文有规范化差异，
		// 此时写盘等于「只打开看一眼就重排全文」（K156 的原始缺陷）。
		if (!this.loaded || this.destroyed || !this.baselineRecorded) {
			return;
		}
		await this.savePipeline.save();
	}

	/** 安排一次 2 s 防抖保存并上报「保存中」 */
	scheduleSave(): void {
		if (!this.loaded || this.destroyed || this.loading) {
			return;
		}
		if (this.savePipeline.schedule() === 'scheduled') {
			this.routeSaveState('saving');
		}
	}

	/** 「内容是否已落盘」的唯一判据（供视图 / 外部写入分支共用） */
	hasUnsavedChanges(): boolean {
		return this.loaded && this.savePipeline.hasUnsavedChanges(this.file);
	}

	/**
	 * 提交一次编辑（由**发起视图**的 `data_change` / 插件编辑通道调用）。
	 *
	 * - 与当前树逐字相同 ⇒ 不入历史、不广播（`seedInitialHistory` 的
	 *   `data_change` 因此不会造出幽灵历史）；
	 * - 入历史（截断 redo 分支）→ 更新权威树 → 合并窗口后广播给其它视图 →
	 *   排一次保存。
	 *
	 * 接收视图的应用通道**不产生 `data_change`**，故同一次编辑只会进这里一次。
	 */
	commit(tree: MindMapTreeNode, origin?: SessionViewPort): boolean {
		if (!this.loaded || this.loading || this.applying || this.destroyed) {
			return false;
		}
		if (!this.treeValue) {
			return false;
		}
		if (origin && this.isStaleOrigin(origin)) {
			this.rejectStale(origin);
			return false;
		}
		if (sameTree(this.treeValue, tree)) {
			return false;
		}
		const snapshot = cloneJsonTree(tree);
		this.treeValue = snapshot;
		this.versionValue++;
		// 发起视图的引擎此刻就是这份内容：记成「已应用」，否则它下一次
		// 编辑会被误判成基于旧树的过期提交（广播跳过 origin，不会替它更新）
		if (origin) {
			this.appliedVersions.set(origin, this.versionValue);
		}
		// 上面的 `sameTree` 已证明与当前树不同：不必再为判等序列化两遍整树
		this.history.push(snapshot, sameTree, true);
		this.pendingOrigin = origin ?? null;
		this.scheduleBroadcast();
		this.scheduleSave();
		return true;
	}

	/**
	 * 用**派生归一**后的树更新当前快照（**不进历史**、不动游标）。
	 *
	 * 与 {@link commit} 的分工：编辑本身走 `commit`（一条历史）；编辑之后的
	 * 「就地修正」（层级语法守卫改 `mdType` / `mdLevel`，不重渲染）走本方法——
	 * 它是那次编辑的一部分，Ctrl+Z 必须一步撤掉两者。
	 *
	 * **为什么必须有它**：守卫改的是引擎活数据，`data_change` 已经发过
	 * （保存排程早于守卫），而会话保存的是自己的权威树——不在这里同步，
	 * 守卫的结果只存在于屏上：文件仍是归一前的写法，重开会解析成另一棵树
	 * （2026-11-09 实机：`# 甲` + `- 列表乙` 升级成两个一级标题，屏上对、
	 * 文件没写）。
	 */
	updateCurrent(tree: MindMapTreeNode, origin?: SessionViewPort): boolean {
		if (!this.loaded || this.loading || this.applying || this.destroyed) {
			return false;
		}
		if (!this.treeValue) {
			return false;
		}
		if (origin && this.isStaleOrigin(origin)) {
			this.rejectStale(origin);
			return false;
		}
		if (sameTree(this.treeValue, tree)) {
			return false;
		}
		const snapshot = cloneJsonTree(tree);
		// 先换历史再换权威树：`replaceCurrent` 失败（尚未 reset）时不能留下
		// 「树是新的、历史还是旧的」这种半更新状态
		if (!this.history.replaceCurrent(snapshot)) {
			return false;
		}
		this.treeValue = snapshot;
		this.versionValue++;
		if (origin) {
			this.appliedVersions.set(origin, this.versionValue);
		}
		// 发起视图已经是新内容；其它视图按合并窗口收到同一次归一
		this.pendingOrigin = origin ?? null;
		this.scheduleBroadcast();
		this.scheduleSave();
		return true;
	}

	canUndo(): boolean {
		return this.loaded && !this.applying && this.history.canUndo();
	}

	canRedo(): boolean {
		return this.loaded && !this.applying && this.history.canRedo();
	}

	/** 撤销一步并把结果广播给**所有**视图（含发起者） */
	undo(): boolean {
		if (!this.canUndo()) {
			return false;
		}
		const next = this.history.undo();
		if (!next) {
			return false;
		}
		this.replaceTree(next);
		// forceAll：撤销可能发生在「某视图刚提交、广播还在合并窗口里」的那一刻，
		// 此时 `pendingOrigin` 仍指向它——若照常跳过，它会停在撤销前的旧内容上
		this.broadcastNow(true);
		this.scheduleSave();
		return true;
	}

	/** 重做一步（同上） */
	redo(): boolean {
		if (!this.canRedo()) {
			return false;
		}
		const next = this.history.redo();
		if (!next) {
			return false;
		}
		this.replaceTree(next);
		this.broadcastNow(true);
		this.scheduleSave();
		return true;
	}

	/** 历史状态（竖栏按钮可用态） */
	historyAvailability(): { canUndo: boolean; canRedo: boolean } {
		return { canUndo: this.canUndo(), canRedo: this.canRedo() };
	}

	/**
	 * 首次引擎就绪时记录加载基线（纯浏览不写盘，K156）。
	 *
	 * 用**引擎快照**而不是解析树：与写盘取的是同一来源（会话树在提交时会被
	 * 引擎快照替换），两边才逐字可比。只记一次——设置刷新重建引擎不重记
	 * （K156④ 的教训：重记会把未落盘编辑误标成基线）。
	 */
	markLoadedFromEngine(snapshot: MindMapTreeNode | null): void {
		if (!snapshot || this.baselineRecorded || !this.loaded) {
			return;
		}
		this.baselineRecorded = true;
		this.savePipeline.markLoaded(this.file, snapshot, this.rawBodyValue);
	}

	/**
	 * 文件重命名 / 移动：迁移保存管线的路径键基线（会话键由注册表搬）。
	 *
	 * `TFile` 实例在官方改名后原地更新 `path`，故必须显式接旧路径——调用时
	 * `this.path` 已经是新路径。
	 */
	rename(oldPath: string, newPath: string): void {
		if (this.destroyed || oldPath === newPath) {
			return;
		}
		this.savePipeline.rename(oldPath, newPath);
	}

	/** 外部 `modify` 入口（组合根的 `vault.on('modify')` 单点分发） */
	onExternalModify(file: TFile): void {
		if (this.destroyed || file.path !== this.path) {
			return;
		}
		if (this.reloading) {
			this.pendingReload = true;
			return;
		}
		void this.handleExternalChange();
	}

	/** 销毁会话（最后一个视图解绑 / 插件卸载） */
	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.disposed = true;
		this.broadcastDebouncer.cancel();
		this.savePipeline.cancelTimer();
		if (this.visibilityListener && typeof document !== 'undefined') {
			document.removeEventListener(
				'visibilitychange',
				this.visibilityListener,
			);
		}
		this.views.clear();
	}

	// ---- 内部：外部写入 ----

	/**
	 * 磁盘正文是否被别处改过；改过则放弃本轮写盘并重载。
	 *
	 * 自己的写盘不会命中：`SavePipeline` 在写成功后已把 `lastSeenDiskBody`
	 * 更新为写出正文。
	 */
	private async handleExternalChange(): Promise<void> {
		// 自己正在写盘：宿主已派发的 modify 是回声，不是外部改动
		if (this.savePipeline.isWriting(this.path)) {
			return;
		}
		try {
			const content = await this.app.vault.read(this.file);
			const diskBody = splitFrontmatter(content).body;
			if (!this.savePipeline.diskChangedSinceSeen(this.file, diskBody)) {
				return;
			}
			await this.reloadFromDisk(content);
		} catch (error) {
			console.warn('外部写入后重载会话失败:', this.path, error);
		}
	}

	/**
	 * 从磁盘重载（外部写入的唯一落地路径）。
	 *
	 * 与官方对齐：外部改动是**一条可撤销步骤**——把重载后的新树追加进历史，
	 * `Ctrl+Z` 正好回到草稿；有草稿时提示一次，无草稿静默。
	 */
	private async reloadFromDisk(content?: string): Promise<void> {
		if (this.reloading || this.destroyed) {
			this.pendingReload = true;
			return;
		}
		this.reloading = true;
		try {
			const raw = content ?? (await this.app.vault.read(this.file));
			const doc = this.parseDocument(raw, this.file);
			const hadDraft = this.hasUnsavedChanges();
			this.treeValue = doc.tree;
			this.frontmatterValue = doc.frontmatter;
			this.rawBodyValue = doc.body;
			this.versionValue++;
			// 追加新树 = 让「撤销」回到重载前的草稿（与官方合并/替换同构）
			this.history.push(doc.tree, sameTree);
			// 基线重置为新磁盘内容：重载本身不该被判脏、也不该再写一次
			this.savePipeline.markLoaded(this.file, doc.tree, doc.body);
			this.baselineRecorded = true;
			// 外部版本必须落到**所有**视图（含此刻的 pendingOrigin）
			this.broadcastNow(true);
			// 磁盘此刻就是会话内容：状态栏报「已保存」（重载本身不写盘）
			this.routeSaveState('saved');
			if (hadDraft) {
				const port = this.activePort();
				port?.notifyExternalReload();
			}
		} catch (error) {
			console.warn('重载会话失败:', this.path, error);
		} finally {
			this.reloading = false;
			if (this.pendingReload) {
				this.pendingReload = false;
				// 让出一拍：重载期间的 `modify` 只看最终磁盘状态（与视图侧
				// 「补比一轮」同一手法，见 K177 的 pendingExternalModify）
				window.setTimeout(() => {
					void this.handleExternalChange();
				}, 0);
			}
		}
	}

	// ---- 内部：广播 ----

	private replaceTree(tree: MindMapTreeNode): void {
		this.treeValue = tree;
		this.versionValue++;
	}

	private scheduleBroadcast(): void {
		const delay =
			this.options.broadcastDelayMs ??
			computeBroadcastDelayMs(this.treeValue ? countNodes(this.treeValue) : 1);
		const debouncer = this.ensureBroadcastDebouncer(delay);
		// 已有待执行的广播就不再 schedule：`createDebouncer` 每次都会重置计时器，
		// 连续 stale 提交会把广播无限推迟（2026-11-11 静态审查定位）。
		if (!debouncer.isPending()) {
			debouncer.schedule(() => {
				this.broadcastNow();
			});
		}
	}

	/** 合并窗口随图规模变化：延迟变了就换一个 debouncer（旧的未决任务丢弃） */
	private ensureBroadcastDebouncer(delay: number): Debouncer {
		if (delay !== this.broadcastDelayValue) {
			this.broadcastDebouncer.cancel();
			this.broadcastDebouncer = createDebouncer(delay);
			this.broadcastDelayValue = delay;
		}
		return this.broadcastDebouncer;
	}

	/** 文档是否隐藏（隐藏窗口不重绘；测试可注入） */
	private documentHidden(): boolean {
		if (this.options.isDocumentHidden) {
			return this.options.isDocumentHidden();
		}
		return (
			typeof document !== 'undefined' &&
			document.visibilityState === 'hidden'
		);
	}

	/**
	 * 恢复可见：补一次被推迟的广播。
	 *
	 * 隐藏期间树与历史照常更新（撤销 / 保存都不停），只是**不渲染**——
	 * 与官方「后台不重绘」同口径。测试直接调用本方法模拟可见性恢复。
	 */
	handleVisibilityChange(): void {
		if (this.destroyed || this.documentHidden()) {
			return;
		}
		if (!this.pendingHiddenBroadcast) {
			return;
		}
		this.pendingHiddenBroadcast = false;
		this.broadcastNow();
	}

	/**
	 * 立刻广播（撤销 / 重做 / 外部重载不等合并窗口）。
	 *
	 * @param forceAll 连 `pendingOrigin` 一起应用。撤销 / 重做 / 外部重载必须
	 *   为真：它们改变的是**全局状态**，发起视图也不能停在旧内容上（否则会
	 *   出现「A 显示 n0X、B 显示 n0」这种分叉，2026-11-09 实机复现）。
	 */
	private broadcastNow(forceAll = false): void {
		this.broadcastDebouncer.cancel();
		if (forceAll) {
			this.pendingOrigin = null;
		}
		if (this.destroyed || !this.treeValue) {
			return;
		}
		// 隐藏窗口：只记「有未应用的版本」，恢复可见时一次补上
		if (this.documentHidden()) {
			this.pendingHiddenBroadcast = true;
			return;
		}
		this.pendingHiddenBroadcast = false;
		if (this.applying) {
			return;
		}
		const ports = [...this.views];
		// 先把「应用前」的编辑会话收干净（可能提交新编辑 → 会再排一次广播）
		for (const port of ports) {
			port.beforeApplySnapshot();
		}
		const tree = this.treeValue;
		if (!tree) {
			return;
		}
		const origin = this.pendingOrigin;
		this.pendingOrigin = null;
		this.applying = true;
		try {
			for (const port of ports) {
				// 发起视图已经是新内容：再应用一次只会白付一次整树渲染，还可能
				// 打断它正在进行的交互（内联编辑 / 拖拽）
				if (port === origin) {
					continue;
				}
				this.applyToPort(port, tree);
			}
		} finally {
			this.applying = false;
			// `beforeApplySnapshot` 提交内联编辑时会排一次广播；此刻已经应用了
			// 最新树，那个排队的广播就是**第二次整树渲染**（大图 ≈120 ms）。
			// 应用期间 `applying` 会拒绝新的提交 ⇒ 取消它是安全的。
			this.broadcastDebouncer.cancel();
		}
	}

	private applyToPort(port: SessionViewPort, tree?: MindMapTreeNode): void {
		const source = tree ?? this.treeValue;
		if (!source) {
			return;
		}
		try {
			// 不在这里再整树拷贝：`applySessionSnapshot` 的 `handleData` 本来就会
			// 深拷贝（引擎侧从不持有会话树），大图能省一次整树 structuredClone。
			// **但图片默认尺寸必须先补**：外部分支重载的树来自解析器（不产
			// `imageSize`），引擎 `createImgNode → getImgShowSize` 对缺失值直接
			// 解构抛错 ⇒ 整图渲染中断（`renderer.root` 变 null，视图停在旧画面）。
			// `withDefaultImageSizes` 无缺尺寸图片时原样返回 ⇒ 热路径零拷贝；
			// 补齐时拷贝后补，派生字段不回灌会话权威树（2026-11-12 实机回归）。
			const applied = port.applySnapshot(withDefaultImageSizes(source));
			// 先记「已应用」再跑 afterApplySnapshot：后者若同步提交（当前实现
			// 只刷 UI，但接口允许），提交的是刚落地的新树，不该被判过期
			if (applied) {
				this.appliedVersions.set(port, this.versionValue);
			}
			port.afterApplySnapshot();
		} catch (error) {
			console.error('应用会话快照失败', this.path, error);
		}
	}

	/**
	 * 该视图的引擎是否还停在旧版本（它的提交基于过期树）。
	 *
	 * 两个视图各自持有完整树：B 在收到 A 的广播之前提交，快照不含 A 的编辑，
	 * 直接接受就会整树覆盖（2026-11-09 实机：会话树只剩 B，A 也被刷成 B）。
	 */
	private isStaleOrigin(origin: SessionViewPort): boolean {
		const applied = this.appliedVersions.get(origin);
		return applied !== undefined && applied < this.versionValue;
	}

	/**
	 * 拒绝过期提交：保留会话已有版本、提示发起视图、并尽快把权威树刷给它。
	 *
	 * 本插件不做树级合并（保 `mdRaw` 逐字），所以选择「可见地不合并」而不是
	 * 静默覆盖另一侧的编辑。被拒视图不是 `pendingOrigin`，紧随的广播必定
	 * 把它列入收件人。
	 */
	private rejectStale(origin: SessionViewPort): void {
		// 同一会话版本只提示一次：连续输入会在 60 ms 广播窗口内产生一串被拒提交，
		// 逐条弹 Notice 会刷屏（契约是「提示一次」）。
		if (this.staleNotifiedVersion.get(origin) !== this.versionValue) {
			this.staleNotifiedVersion.set(origin, this.versionValue);
			origin.notifyStaleCommit();
		}
		this.scheduleBroadcast();
	}

	private routeSaveState(state: SessionSaveState): void {
		this.lastSaveState = state;
		for (const port of this.views) {
			port.setSessionSaveState(state);
		}
	}

	private activePort(): SessionViewPort | null {
		for (const port of this.views) {
			if (port.isActiveView) {
				return port;
			}
		}
		return this.views.values().next().value ?? null;
	}
}
