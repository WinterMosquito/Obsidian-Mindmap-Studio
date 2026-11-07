/**
 * Markdown 文档服务：导图文件的读取/解析与保存管线（渲染层数据面）。
 * 从 view.ts 拆出（第 4 步）。
 *
 * 本模块不含引擎依赖：
 * - 解析/序列化是纯 Markdown 往返（md-outline ⇄ md-serialize）；
 * - 保存管线的树快照经回调注入（引擎 getData 由调用方提供），
 *   引擎销毁后的兜底快照（pendingTree）由管线自身持有。
 *
 * 归属不变式（本模块唯一的硬约束）：
 *   **一次写盘的目标文件与其内容必须属于同一个文件。**
 * core 不 await `onUnloadFile`，视图切换期间 `getFile()`/引擎都可能已经指向新
 * 文件，故内容一律经 `getSnapshotFor(file)`/`getFrontmatterFor(file)` 按文件取，
 * 排空循环**不读**"最近加载"的活引用；卸载路径由调用方显式传入自己的文件与
 * 树快照（`save(file, treeHint)`）。违反该不变式会把新文档正文写进旧文件、
 * 或让旧文件丢掉 frontmatter。
 */
import { App, TFile } from 'obsidian';
import {
	AUTO_SAVE_DEBOUNCE_MS,
	SAVE_FAILURE_SUSPEND_THRESHOLD,
} from '../core/constants';
import { createDebouncer, createSerialQueue } from '../core/concurrency';
import { walkTree } from '../domain/tree';
import { parseMdOutline, splitFrontmatter, UTF8_BOM } from '../markdown/md-outline';
import { serializeMdBody } from '../markdown/md-serialize';
import { forgetImageFail, walkResolveImagePaths } from '../media/images-path';
import type { MindMapTreeNode } from '../core/engine-types';

/**
 * 收尾一致性补排的次数上限：超过即判定「每轮都在变」（抖动），只留痕不再补排。
 * 正常编辑一轮就对得上（计数器随即清零），3 足够覆盖「编辑恰好落在排空尾」这类
 * 真实的连发场景。
 */
const MAX_CONSISTENCY_RETRIES = 3;

/** 单次文档加载结果（视图据此前导引擎并更新自身文档状态） */
export interface DocumentLoadResult {
	tree: MindMapTreeNode;
	/** 原样保留的 frontmatter 块（含首尾 ---），保存时拼回文件头；无则 null */
	frontmatter: string | null;
	/**
	 * 原样正文（frontmatter 之后，未规范化）：交给 `SavePipeline.markLoaded` 做
	 * 「回到加载态」的逐字还原（见 `loadedRawBody`）。
	 */
	body: string;
}

/**
 * 文档读写：读文件 → md 大纲解析为导图树（图片地址就地解析为资源地址）。
 * 抛错时由调用方处理（文件删除/损坏等半加载场景）。
 */
export class DocumentService {
	constructor(private readonly app: App) {}

	async load(file: TFile): Promise<DocumentLoadResult> {
		const content = await this.app.vault.read(file);
		return this.parse(content, file);
	}

	/** 解析文件内容：Markdown 大纲 → 导图树（渲染层定位，无专有格式分支） */
	private parse(content: string, file: TFile): DocumentLoadResult {
		// 根（中心主题）文本 = 文件名（不含扩展名）；改名由视图编排
		const rootName = file.basename;
		const parsed = parseMdOutline(content, rootName);
		const tree = parsed.tree;
		// 图片：库内路径/外链 → 资源地址（mdImageTarget 保留原目标串，供回写）。
		// 图片尺寸不在此归一：视图加载走 walkImageSizeCorrections（K97：未设置
		// 尺寸的图一律保持默认大小；带官方参数时按参数，仅宽时探测原始比例补高）。
		walkResolveImagePaths(tree, this.app);
		// 重开导图 = 给这些图一次重新探测的机会：失败缓存（5 min）只为同一会话内
		// 的反复渲染节流，不该跨打开周期压着瞬态失败（同步刚落地的图、
		// 库索引尚未就绪）。只清本文件用到的地址，不横扫全局缓存。
		walkTree(tree, (node) => {
			const image = node.data?.['image'];
			if (typeof image === 'string' && image) {
				forgetImageFail(image);
			}
		});
		return {
			tree,
			frontmatter: parsed.frontmatter,
			body: parsed.body,
		};
	}
}

/** 保存管线依赖（全部窄化注入，不持有视图/引擎引用；内容 getter 一律按文件取） */
export interface SavePipelineDeps {
	app: App;
	/** 视图当前文件（视图关闭/卸载中可能为 null） */
	getFile(): TFile | null;
	/**
	 * **指定文件**的树快照：引擎当前不持有该文件时为 null（引擎已销毁时同样为
	 * null，此时管线用排空期提前抓的兜底快照续写）。
	 */
	getSnapshotFor(file: TFile): MindMapTreeNode | null;
	/**
	 * **指定文件**的 md frontmatter（保存时拼回文件头）。必须按文件键取，
	 * 不能用"最近加载的那份"——换文件期间它会变成新文件的值。
	 *
	 * 注意：这只是**读取失败时的兜底**。正常写盘以磁盘当前内容为准（见 save
	 * 内注释）：视图打开期间外部改动的属性不会被这份旧快照覆盖。
	 */
	getFrontmatterFor(file: TFile): string | null;
	/** 自动保存开关（关闭时 schedule 不生效，显式 save 仍可用） */
	isAutoSave(): boolean;
	/** 写盘失败回调（视图据此弹用户可见提示；缺省仅 console.error） */
	onSaveError?(error: unknown): void;
	/**
	 * 检测到**外部修改**时的回调（P1a，仅自动保存路径触发）：自动保存绝不
	 * 覆盖他处改动（同步盘/其它窗口/手动编辑），跳过本轮写盘并提示用户。
	 * 每个文件路径只提示一次（后续静默跳过，防告警疲劳），用户显式保存
	 * （手动命令/卸载路径）不带检测，成功后恢复正常。
	 */
	onExternalChange?(file: TFile): void;
	/**
	 * 连续写盘失败达到阈值、自动保存被挂起时的回调（P1b）：挂起后
	 * `schedule()` 不再排程（防告警疲劳），显式 save 不受影响，一次成功即恢复。
	 */
	onAutoSaveSuspended?(): void;
	/**
	 * 一轮排空**成功结束**（含「无差异跳过写盘」）时的回调：视图据此把状态栏
	 * 从「保存中」切到「已保存」。冲突跳过与写盘异常不调用（两者已有各自的
	 * 「未保存」语义，见 onExternalChange / onSaveError）。
	 */
	onSaved?(file: TFile): void;
	/**
	 * autoSave **关闭**时「有没有未落盘的改动」的判定结果（`SchedulePipeline.checkDirty`，
	 * 只读、不写盘）。`false` ＝ 与加载基线逐字相同（回到加载态 / 还没编辑过）。
	 *
	 * 与 `onSaved` 的分工：`onSaved` 来自真的排空过一轮（含无差异跳过），本回调
	 * 来自「根本没排程、只做比较」的路径——两者都终结「保存中」，但只有前者能
	 * 说「刚写过盘」。带 `file`：防抖窗口内视图可能已换文件，判决属于旧文件。
	 */
	onDirty?(dirty: boolean, file: TFile): void;
}

/**
 * `SavePipeline.schedule()` 的去向（见该方法文档）。
 *
 * 用字符串联合而不是 boolean：调用方要区分「排上了」「被挂起」「自动保存关着」
 * ——三者对状态栏的含义完全不同（保存中 / 未保存 / 由 `onDirty` 判定）。
 */
export type ScheduleOutcome = 'scheduled' | 'off' | 'suspended' | 'noFile';

/**
 * 保存管线：防抖调度 + 串行写盘排空 + 卸载前快照兜底。
 * 原 view.ts save 机制逐行等价搬移：
 * - 写入进行中再触发 → 标记待写并立即快照（视图卸载时引擎可能随即销毁，
 *   提前快照保证最后一批编辑不丢失）；
 * - 循环排空：写盘期间若又有编辑（savePending），继续写最新快照；
 * - 文件已删除时不重建（Obsidian 删除文件会触发 onUnloadFile）；
 * - **归属守卫**：排空期只接续同一文件的快照，不同文件的保存独立排队，
 *   绝不并入别人那一轮（详见文件头不变式）。
 */
export class SavePipeline {
	private debouncer = createDebouncer(AUTO_SAVE_DEBOUNCE_MS);
	/**
	 * autoSave 关闭时的「只判定」防抖器（见 `checkDirty`）：与写盘防抖器分开，
	 * 因为两者互斥地使用（同一时刻只有一个在排程），分开后语义不会互相干扰。
	 */
	private dirtyDebouncer = createDebouncer(AUTO_SAVE_DEBOUNCE_MS);
	/** 串行写盘队列：所有 save 调用共享，调用方可 await 完整排空 */
	private enqueue = createSerialQueue();
	private saveInProgress = false;
	private savePending = false;
	/** 待写快照：视图卸载时引擎已销毁，用它兜底最后一批编辑 */
	private pendingTree: MindMapTreeNode | null = null;
	/** pendingTree 所属文件（跨文件不可复用） */
	private pendingFile: TFile | null = null;
	/** 正在排空的文件：整轮排空的写盘归属不随视图当前文件漂移 */
	private drainFile: TFile | null = null;
	/** 最近一次写盘任务（写入中再触发时，await 它即等价于等排空） */
	private activeSave: Promise<void> = Promise.resolve();
	/**
	 * 「路径 → 上次写盘落地的完整内容」基线（P1a 外部改动检测）：自动保存
	 * 写盘前比对磁盘当前内容，不一致即说明有外部修改（同步盘/其它窗口/
	 * 手动编辑）。显式保存（命令/卸载路径）不检测，成功后同样更新基线。
	 */
	private readonly lastWritten = new Map<string, string>();
	/**
	 * 「路径 → **加载完成时的正文**」基线（纯浏览不写盘，2026-11-02）。
	 *
	 * 序列化带规范化（空行归一、缩进统一、有序列表重排），与磁盘原文天然不等，
	 * 单靠「无差异写盘跳过」拦不住：打开一次笔记（`onEngineReady` 后引擎会发
	 * `data_change` → 排一轮自动保存）就把全文重写一遍——实测空行被吞、松散
	 * 列表变紧凑，Git / 同步盘平白多一个 diff，而用户根本没编辑过。
	 *
	 * 判据：本轮正文与该基线**逐字相同** ⇒ 本次会话没有任何内容级改动 ⇒ 跳过
	 * 写盘。只存正文（不含文件头）是刻意的：文件头恒取磁盘当前值、本管线从不
	 * 修改它，所以「只在属性面板改了 frontmatter / 切了布局」不该连带把正文
	 * 规范化一遍。基线只在**加载**时记录（`markLoaded`），编辑后不更新，故真实
	 * 改动照常落盘。
	 *
	 * **但不能无条件跳过**：本会话一旦写过盘，磁盘上已是「编辑后」的内容，此时
	 * 撤销回到加载态在磁盘上就是一次**真实改动**。故判定还要看
	 * `wroteSinceLoad`——写过之后回到加载态必须落盘（写回 `loadedRawBody`），
	 * 否则屏上是原样、文件里是改后，重开又跳回改后（2026-11-02 实机确认）。
	 */
	private readonly loadedBody = new Map<string, string>();
	/**
	 * 「路径 → **加载时的原样正文**」（`splitFrontmatter().body`，未规范化）。
	 *
	 * 撤销回到加载态且本会话写过盘时，写回这一段而不是 `serializeMdBody` 的
	 * 结果：判据（`loadedBody`）本来就是拿序列化结果比的，两者等价；而磁盘上的
	 * 原文可能带规范会改掉的形态（空行、松散列表），写序列化结果等于把用户
	 * **没编辑过的行**重排一遍（违反「未编辑行逐字回写」）。
	 */
	private readonly loadedRawBody = new Map<string, string>();
	/**
	 * 「本会话**确实写出过**该文件」的路径集合（`vault.modify` 成功即加入）。
	 *
	 * 纯浏览守卫只在它为假时成立：写过之后，「回到加载态」不再是「文件本就该是
	 * 那个样子」，而是要把原样**写回去**（见 `loadedBody` 的第二段说明）。
	 * 只在 `markLoaded`（重新加载）时清除。
	 */
	private readonly wroteSinceLoad = new Set<string>();
	/** 已就「外部修改」提示过的文件：**同一冲突**只提示一次（防告警疲劳）；
	 * 成功落盘即解除（见写盘成功路径），让下一次冲突重新提示 */
	private readonly externalConflictNotified = new Set<string>();
	/**
	 * 「路径 → 收尾一致性补排次数」（见 `reconcileAfterSave`）。每次真实差异
	 * 递增，一旦某轮对得上就清零；达上限只留痕不再补排（防抖动空转）。
	 */
	private readonly consistencyRetries = new Map<string, number>();
	/** 连续写盘失败次数（P1b）：成功一次即清零 */
	private consecutiveSaveFailures = 0;
	/** 连续失败达阈值后挂起自动保存（schedule 不再排程；显式 save 不受影响） */
	private autoSaveSuspended = false;

	constructor(private readonly deps: SavePipelineDeps) {}

	/**
	 * 安排一次防抖自动保存（view-toolbar / view-node-actions 等外部模块调用）。
	 *
	 * **返回值分四种**（调用方据此决定状态栏说什么，别只判真假）：
	 * - `scheduled`：真的排上了 → 报「保存中」；
	 * - `suspended`：连续失败被挂起 → 报「未保存」（内容确实没落盘）；
	 * - `off`：自动保存关闭 → 不报「保存中」（永远不会收尾），改由
	 *   `checkDirty`（同样防抖）判定「有没有未落盘的改动」；
	 * - `noFile`：还没有文件（加载中 / 已卸载）→ 什么也别报。
	 */
	schedule(): ScheduleOutcome {
		// P1b 连续失败降级：挂起后不再排程（防告警疲劳）；显式 save 仍可用，
		// 一次成功即解除挂起（见写盘成功路径）。
		if (this.autoSaveSuspended) {
			return 'suspended';
		}
		const file = this.deps.getFile();
		if (!file) {
			return 'noFile';
		}
		if (!this.deps.isAutoSave()) {
			// 自动保存关闭时仍要回答「有没有未落盘的改动」——否则编辑过的文档在
			// 状态栏上没有任何线索（关掉一次性提示之后，用户只能靠记忆）。
			// 只判定、不写盘：判据就是「本轮序列化 vs 加载基线」，与纯浏览守卫同源。
			this.dirtyDebouncer.schedule(() => this.checkDirty(file));
			return 'off';
		}
		this.debouncer.schedule(() => {
			void this.save(undefined, undefined, { checkExternal: true });
		});
		return 'scheduled';
	}

	/** 取消尚未执行的防抖保存（文件切换/视图关闭时调用） */
	cancelTimer(): void {
		this.debouncer.cancel();
		this.dirtyDebouncer.cancel();
	}

	/**
	 * autoSave 关闭时的**只判定**轮次：内存正文是否已偏离加载基线。
	 *
	 * 不写盘、不动任何基线（`lastWritten` / `wroteSinceLoad` / 冲突提示），只经
	 * `onDirty` 把判决交给视图。判据与 `save` 的纯浏览守卫**同源**——都走
	 * `isAtLoadedState`，否则「状态栏说未保存、保存时却跳过」这类分叉迟早出现。
	 *
	 * 取不到快照（引擎已交班/销毁）或还没记基线（加载未完成）时**不表态**：
	 * 此时任何结论都是猜的。
	 */
	private checkDirty(file: TFile): void {
		const tree = this.deps.getSnapshotFor(file);
		if (!tree) {
			return;
		}
		const atLoadedState = this.isAtLoadedState(file, this.buildBody(tree));
		if (atLoadedState === null) {
			return;
		}
		this.deps.onDirty?.(!atLoadedState, file);
	}

	/**
	 * 本轮正文是否**逐字等于加载基线**：`null` = 基线未知（尚未 `markLoaded`）。
	 *
	 * 纯浏览守卫（`save`）与 `checkDirty` 共用这一处，判据只有一份。
	 */
	private isAtLoadedState(file: TFile, body: string): boolean | null {
		const loaded = this.loadedBody.get(file.path);
		return loaded === undefined ? null : loaded === body;
	}

	/**
	 * 作废某文件的写盘基线（**经外部通道写过该文件之后**必须调用）。
	 *
	 * 基线只描述「本管线上次写出的内容」；用 `processFrontMatter` 之类绕过管线的
	 * 写入之后它必然过期。不作者废时，下一次自动保存会把这次写入误判成「他处
	 * 修改」而整轮跳过——冲突提示只报一次，此后每次编辑都静默不落盘，直到一次
	 * 显式保存（命令 / 卸载）成功才恢复。删掉基线即回到「首次保存」语义：
	 * 不检测、直接写，写完重新建立基线。
	 */
	forgetBaseline(file: TFile): void {
		// 同一文件正在排空：本轮结束会写入新基线，中途删等于白丢一次检测
		if (this.drainFile?.path === file.path) {
			return;
		}
		this.lastWritten.delete(file.path);
		this.externalConflictNotified.delete(file.path);
	}

	/**
	 * 记录某文件**加载完成时的正文**（「纯浏览不写盘」的基线，见 `loadedBody`）。
	 *
	 * @param file 刚加载完成的文件
	 * @param tree 该文件加载后的树快照（与写盘取的是同一个来源，两边才可比）
	 * @param rawBody 磁盘上的**原样正文**（`DocumentLoadResult.body`）：撤销回到
	 *   加载态时按它逐字还原。缺省则回落到序列化结果（仍能修正屏上/盘上分叉，
	 *   只是没编辑过的行会被规范化）。
	 *
	 * **调用时机只有加载**：文件加载、引擎创建完成之后。引擎因设置刷新而重建时
	 * 不能再调——那会把用户尚未落盘的编辑误标成基线，随后一轮保存被当成
	 * 「纯浏览」跳过（编辑丢失）。
	 */
	markLoaded(
		file: TFile,
		tree: MindMapTreeNode | null,
		rawBody?: string | null,
	): void {
		if (!tree) {
			return;
		}
		this.loadedBody.set(file.path, this.buildBody(tree));
		if (typeof rawBody === 'string') {
			this.loadedRawBody.set(file.path, rawBody);
		} else {
			this.loadedRawBody.delete(file.path);
		}
		// 重新加载 ⇒ 「写过没有」重新起算（此时磁盘内容就是这次加载读到的内容）
		this.wroteSinceLoad.delete(file.path);
	}

	/**
	 * 写盘。
	 *
	 * @param file    目标文件；缺省取视图当前文件。**卸载/关闭路径必须显式传入
	 *                自己那份文件**——core 不 await onUnloadFile，隐式取值可能
	 *                已是新文件（会把旧文档内容写进新文件）。
	 * @param treeHint 调用方对**该文件**的树快照（卸载时同步抓取）。引擎已交班/
	 *                销毁导致活快照取不到时用它兜底，保证最后一批编辑不丢。
	 * @param opts     `checkExternal` 仅自动保存启用。**重入（另一文件正在排空）
	 *                必须一起透传**——排队不等于降级，见「不同文件」分支。
	 */
	async save(
		file?: TFile,
		treeHint?: MindMapTreeNode | null,
		opts?: { checkExternal?: boolean },
	): Promise<void> {
		// 外部改动检测仅自动保存开启（P1a）：显式保存（命令/卸载路径）视为
		// 知情决策——卸载时哪怕外部改过也必须落盘，否则丢编辑。
		const checkExternal = opts?.checkExternal ?? false;
		const target = file ?? this.deps.getFile();
		if (!target) {
			return;
		}
		// 文件已被删除时不应重新保存：Obsidian 删除文件会触发 onUnloadFile，
		// 此时若继续 vault.modify，会重建已被删除的文件（表现为"要删两次"）。
		if (
			// 删除守卫是文件存在性检查（类型化 getter，官方推荐）
			!this.deps.app.vault.getFileByPath(target.path)
		) {
			return;
		}
		if (this.saveInProgress) {
			if (this.drainFile?.path === target.path) {
				// 同一文件：标记待写并立即快照最新数据。
				// 视图卸载（onUnloadFile/onClose）时引擎可能随即被销毁，
				// 提前快照保证最后一批编辑不丢失。
				this.savePending = true;
				const snapshot = treeHint ?? this.deps.getSnapshotFor(target);
				if (snapshot) {
					this.pendingTree = snapshot;
					this.pendingFile = target;
				}
				return this.activeSave;
			}
			// 不同文件：等在排空的那一轮收尾后独立入队，绝不并入别人的批次
			//（并入会把本文件的内容写进正被排空的另一个文件）。**opts 必须一起
			// 透传**：漏掉它会把这次自动保存降级成 checkExternal: false，正好绕过
			// P1a「绝不覆盖他人改动」这条唯一防线。
			await this.activeSave;
			return this.save(target, treeHint, opts);
		}
		// frontmatter 在请求时刻按目标文件抓取：排空期间即使视图已切到别的文件，
		// 本文件写出的仍是自己的文件头。
		const frontmatter = this.deps.getFrontmatterFor(target);
		this.saveInProgress = true;
		this.drainFile = target;
		this.activeSave = this.enqueue(async () => {
			/** 本轮最后写出的**正文**（收尾一致性自检用，判据与纯浏览守卫同源） */
			let lastBody: string | null = null;
			/**
			 * 本轮是否**真的写过盘**。收尾自检只对写过的轮次有意义：没写盘的轮次
			 * 只有两种——「纯浏览跳过」（磁盘本就该是那个样子）与「磁盘已等价」，
			 * 两者的磁盘内容都等于本轮序列化结果，活快照若再变只可能是**新编辑**，
			 * 而新编辑自己会排下一轮（`data_change` → `schedule`）。省下的是一次
			 * 全树序列化，大图（数千节点）每轮都要付。
			 */
			let wroteDisk = false;
			/** 本轮因冲突/异常提前收场：这类收场不该做一致性补排（会空转） */
			let aborted = false;
			try {
				// 循环排空：写盘期间若又有编辑（savePending），继续写最新快照
				let tree = this.takeTreeFor(target, treeHint);
				while (
					tree &&
					// 排空循环删除守卫是文件存在性检查（类型化 getter）
					this.deps.app.vault.getFileByPath(target.path)
				) {
					try {
						const current = await this.readCurrentContent(target);
						// P1a 外部改动检测（仅自动保存）：磁盘当前内容与我们上次写出的
						// 基线不一致（且确有基线）→ 文件被外部修改（同步盘/其它窗口/
						// 手动编辑）。自动保存**绝不覆盖**他人改动：跳过本轮（同失败
						// 路径复位），每路径只提示一次；用户显式保存不受此限。
						if (checkExternal && current !== null) {
							const baseline = this.lastWritten.get(target.path);
							if (baseline !== undefined && current !== baseline) {
								if (!this.externalConflictNotified.has(target.path)) {
									this.externalConflictNotified.add(target.path);
									this.deps.onExternalChange?.(target);
								}
								this.savePending = false;
								this.pendingTree = null;
								this.pendingFile = null;
								tree = null;
								aborted = true;
								break;
							}
						}
						// 文件头以**磁盘当前内容**为准：视图打开期间用户可在属性面板、
						// 其它窗格甚至其它设备（同步）改属性，而插件只持有加载时的快照——
						// 直接回贴会把那些改动抹掉（表现为「偶有笔记属性丢失」）。
						// 读不到时才回落到按文件存的快照（不因读失败丢文件头）。
						const header =
							current === null
								? frontmatter
								: splitFrontmatter(current).frontmatter;
						// 正文与文件头分开算：判据只看**正文**（见下面的纯浏览守卫）——
						// 文件头恒取磁盘当前值、本管线从不修改它，故「只在属性面板改了
						// frontmatter」不该触发一次全文重写。
						const body = this.buildBody(tree);
						lastBody = body;
						// 纯浏览不写盘（2026-11-02）：本轮**正文**与加载时逐字相同
						// ⇒ 本次会话没有任何内容级改动。规范化结果不落盘——否则只是
						// 打开看一眼，文件就被重排（空行被吞、松散列表变紧凑），
						// Git / 同步盘平白多一个 diff。判据刻意不含文件头：布局/属性
						// 由用户在属性面板改，本管线回贴的又是**磁盘当前值**，
						// 那种改动不需要（也不该）带着正文一起重写。
						// 判据与 `checkDirty`（autoSave 关闭时的状态栏判定）同源。
						const atLoadedState = this.isAtLoadedState(target, body) === true;
						// 「本会话写过盘」之后，回到加载态在磁盘上**是一次真实改动**
						//（磁盘此刻是编辑后的内容），故守卫不成立、必须写盘；写回的
						// 是加载时的原样正文，避免把没编辑过的行规范化一遍。
						// 实测症状（2026-11-02）：编辑 → Ctrl+Z 屏上回到原样、文件仍是
						// 改后内容，关闭再重开又跳回改后（撤销等于没发生）。
						const wroteSinceLoad = this.wroteSinceLoad.has(target.path);
						const content =
							atLoadedState && wroteSinceLoad
								? this.wrapBase(
										this.loadedRawBody.get(target.path) ?? body,
										header,
									)
								: this.wrapBase(body, header);
						if (atLoadedState && !wroteSinceLoad) {
							// 基线仍按**磁盘当前内容**建立：后续真实编辑触发的自动
							// 保存要走 P1a 外部改动检测，基线缺失会让它把「他处刚改
							// 过」误当成「首次保存」而直接覆盖。读不到内容就不动基线
							//（下次照旧 fail-open）。
							if (current !== null && current !== this.lastWritten.get(target.path)) {
								this.lastWritten.set(target.path, current);
							}
						} else if (current !== content) {
							// 无差异写盘跳过：vault.modify 即使内容一字未变也会刷新 mtime
							// 并惊动元数据缓存与同步，而「自动整理」这类操作只清拖拽
							// 坐标、Markdown 文本没变。比对以**文件当前内容**为准——只
							// 跳过「要写的正是文件里已有的内容」，绝不吞掉真实差异；
							// 读取失败一律照常写盘（fail-open）。
							await this.deps.app.vault.modify(target, content);
							// P1a：本轮内容成为该文件的新基线
							this.lastWritten.set(target.path, content);
							// 写过之后「纯浏览」不再成立：即使随后撤销回加载态，磁盘
							// 上也必须再写一次把原样还原（见守卫处的说明）
							this.wroteSinceLoad.add(target.path);
							wroteDisk = true;
						} else {
							// 磁盘内容与本轮序列化结果等价：同样更新基线
							this.lastWritten.set(target.path, content);
						}
						// P1b：一次成功即清零失败计数并解除自动保存挂起（显式保存
						// 成功同样恢复）。
						// 冲突已解除：本轮落盘成功即把「已提示」标记还给下一次冲突
						//（只 add 不 delete 会让同一文件的第二次外部改动**静默**扣住
						// 不写盘——用户以为自动保存正常，编辑其实一直没落盘）
						this.externalConflictNotified.delete(target.path);
						this.consecutiveSaveFailures = 0;
						this.autoSaveSuspended = false;
					} catch (error) {
						// 保存失败通常是磁盘满/权限，重试无意义；立即复位排空状态
						// 让下一次 scheduleSave 从头再来，而不是沿着这条错误链继续。
						console.error('保存思维导图失败', error);
						this.deps.onSaveError?.(error);
						this.savePending = false;
						this.pendingTree = null;
						this.pendingFile = null;
						aborted = true;
						tree = null;
						// P1b：连续失败达阈值 → 挂起自动保存（一次性提示），显式
						// 保存不受影响；任何一次成功都会解除挂起并清零计数。
						this.consecutiveSaveFailures++;
						if (
							!this.autoSaveSuspended &&
							this.consecutiveSaveFailures >= SAVE_FAILURE_SUSPEND_THRESHOLD
						) {
							this.autoSaveSuspended = true;
							this.deps.onAutoSaveSuspended?.();
						}
						break;
					}
					if (!this.savePending) {
						tree = null;
						break;
					}
					this.savePending = false;
					// 续写**同一文件**的下一份快照（续写路径不再带 treeHint：
					// 此刻引擎活快照若可得必然比请求时刻的兜底快照新）
					tree = this.takeTreeFor(target);
				}
				// 收尾一致性自检（2026-11-02）：本轮写完，活快照必须与该轮写出
				// 的内容一致。不一致只有一种解释——这一轮读到的是**陈旧快照**，
				// 磁盘上的反而是旧的（实机见过一次：DOM 与 data 都已是 `[x]`，
				// 文件仍是 `[ ]`，且此后没有新的保存被排上，直到显式保存）。
				// 这里补排一次自动保存把差异追平；连续失败只留痕、不再空转。
				//
				// **只对自动保存做**：显式保存（命令 / 卸载）的调用方本来就在同一个
				// tick 里抓新鲜快照，没有「陈旧」可言；而卸载路径若在此补排，定时器
				// 会活过视图拆卸、可能落到下一个刚加载的文件上（那时的基线还没记录，
				// 一次补排就变成「打开即重写」——正是本批要消灭的行为）。
				// **也只对写过盘的轮次做**：没写盘的轮次磁盘本就等于本轮序列化结果，
				// 活快照若再变只可能是新编辑，而新编辑会自己排下一轮（见 `wroteDisk`）。
				if (checkExternal && !aborted && wroteDisk && lastBody !== null) {
					this.reconcileAfterSave(target, lastBody);
				}
				// 本轮排空成功（含无差异跳过）：通知视图「已保存」。冲突跳过
				// （aborted）与异常（catch 内 break）不走这里——两者已分别经
				// onExternalChange / onSaveError 给出「未保存」语义。
				// 文件在排空期间被删除、或本轮根本没取到快照（引擎已交班 ⇒ 一行
				// 都没写）时同样不报：状态栏的「已保存」只能来自真的排空过一轮。
				if (
					!aborted &&
					lastBody !== null &&
					this.deps.app.vault.getFileByPath(target.path)
				) {
					this.deps.onSaved?.(target);
				}
			} finally {
				this.saveInProgress = false;
				this.drainFile = null;
			}
		});
		return this.activeSave;
	}

	/**
	 * 收尾一致性自检：活快照序列化后仍与本轮写出不同 ⇒ 补排一次保存。
	 *
	 * 为什么值得每轮多一次序列化：写盘用的是「排空循环开头的快照」，而快照
	 * 可能早于本次编辑（引擎 `getData()` 在原地点被替换后、或重入路径取到
	 * 上一轮的 pendingTree）。一次真实差异意味着**用户编辑没落盘**，代价远高于
	 * 一次 serialize（无 IO）。判据与写盘同源（`serialize`），不会误报。
	 *
	 * 不在这里直接 `await save()`：那会在排空队列里自我嵌套；交给防抖调度，
	 * 下一次自然带上 `checkExternal` 与最新快照。每路径最多补排
	 * `MAX_CONSISTENCY_RETRIES` 次（真出现「每轮都在变」的抖动时只留痕）。
	 */
	private reconcileAfterSave(target: TFile, writtenBody: string): void {
		if (!this.deps.app.vault.getFileByPath(target.path)) {
			return;
		}
		const live = this.deps.getSnapshotFor(target);
		if (!live) {
			// 引擎已交班/销毁（卸载路径）：无从比较，交给下一位持有者
			return;
		}
		// 与纯浏览守卫同一判据（只比正文）：文件头恒取磁盘当前值，与本轮
		// 是否「落盘落后」无关——把文件头算进比较只会带来一次无谓的补排。
		if (this.buildBody(live) === writtenBody) {
			this.consistencyRetries.delete(target.path);
			return;
		}
		const retries = (this.consistencyRetries.get(target.path) ?? 0) + 1;
		if (retries > MAX_CONSISTENCY_RETRIES) {
			// 只提示一次（诊断线索），不抛错、不挂起自动保存：用户的下一次
			// 编辑仍会正常排程，卸载/显式保存也会把最新内容写出去。
			if (retries === MAX_CONSISTENCY_RETRIES + 1) {
				console.warn(
					'保存后仍有未落盘的内容差异，已停止自动补排',
					target.path,
				);
			}
			return;
		}
		this.consistencyRetries.set(target.path, retries);
		this.schedule();
	}

	/**
	 * 读目标文件当前内容（供「无差异写盘跳过」比对）。
	 *
	 * 走 `vault.cachedRead`（内存缓存，不产生磁盘 IO）；该 API 未入本项目
	 * 测试桩与老版本运行时的最小面，缺失或读取抛错时返回 null——
	 * 调用方必然判定为「内容不同」→ 照常写盘（fail-open，绝不因读失败丢写）。
	 */
	private async readCurrentContent(file: TFile): Promise<string | null> {
		const vault = this.deps.app.vault as {
			cachedRead?: (target: TFile) => Promise<string>;
		};
		try {
			return vault.cachedRead ? await vault.cachedRead(file) : null;
		} catch {
			return null;
		}
	}

	/**
	 * 取该文件的下一份待写快照：引擎活快照（同文件时最新）→ 调用方兜底快照
	 * → 排空期提前抓的兜底快照。三者都按文件校验并与消费同步清空，
	 * 保证不会把别的文件的内容写进本文件。
	 */
	private takeTreeFor(
		file: TFile,
		treeHint?: MindMapTreeNode | null,
	): MindMapTreeNode | null {
		const live = this.deps.getSnapshotFor(file);
		const fallback =
			this.pendingFile?.path === file.path ? this.pendingTree : null;
		this.pendingTree = null;
		this.pendingFile = null;
		return live ?? treeHint ?? fallback;
	}

	/**
	 * 树 → Markdown 正文（不含文件头）。**纯浏览守卫与写盘共用这一段**：
	 * 两边必须逐字可比，另写一份就等于判据失真。
	 */
	private buildBody(tree: MindMapTreeNode): string {
		return serializeMdBody(tree, this.deps.app);
	}

	/**
	 * 正文 + 原样文件头拼成落盘内容（布局不入文件），保证尾随换行。
	 *
	 * 文件头**只有 BOM**（无属性块）时不能补换行——那会把 BOM 单独变成一行、
	 * 改动文件结构；其余形态（`---…---`）需要一个换行与正文分隔。
	 */
	private wrapBase(body: string, header: string | null): string {
		let content: string;
		if (!header) {
			content = body;
		} else if (header.endsWith('\n') || header === UTF8_BOM) {
			content = header + body;
		} else {
			content = `${header}\n${body}`;
		}
		if (!content.endsWith('\n')) {
			content += '\n';
		}
		return content;
	}
}
