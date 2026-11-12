/**
 * Markdown 文档服务：导图文件的读取/解析与保存管线（渲染层数据面）。
 * 从 view.ts 拆出（第 4 步）。
 *
 * 本模块不含引擎依赖：
 * - 解析/序列化是纯 Markdown 往返（md-outline ⇄ md-serialize）；
 * - 保存管线的树快照经回调注入（引擎 getData 由调用方提供），
 *   引擎销毁后的兜底快照（pendingTree）由管线自身持有。
 *
 * 保存策略**照搬 Obsidian `TextFileView`**（2026-11-07）：
 * - 内容变更后 2 秒防抖写盘（官方 `requestSave` 的固定值）；
 * - 关闭 / 切换文件 / 插件卸载时立即保存（官方「默认只在关闭时保存」）；
 * - **不做冲突检测、不弹冲突提示、不挂起自动保存**：磁盘是唯一真相，多个
 *   同文件视图各自关闭时保存，后关闭者胜（与 Obsidian 多标签行为一致）。
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
import { AUTO_SAVE_DEBOUNCE_MS } from '../core/constants';
import { createDebouncer, createSerialQueue } from '../core/concurrency';
import { createWarnOnce } from '../core/errors';
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

/**
 * 自愈触发的留痕器（同一进程只打一次）：K158② 的根因至今未定位，靠「补排一次」
 * 兜底。每次复发都把「首处差异」记下来，下一次才有线索可用——否则自愈会把同类
 * 缺陷一起吞掉（2026-11-09 审核结论）。
 */
const warnConsistencyOnce = createWarnOnce();

/** 两段正文的首处差异（诊断用；只截取附近片段，避免把全文打进控制台） */
function firstDifference(
	left: string,
	right: string,
): { at: number; left: string; right: string } {
	const limit = Math.min(left.length, right.length);
	for (let i = 0; i < limit; i++) {
		if (left[i] !== right[i]) {
			return {
				at: i,
				left: left.slice(i, i + 40),
				right: right.slice(i, i + 40),
			};
		}
	}
	return {
		at: limit,
		left: left.slice(limit, limit + 40),
		right: right.slice(limit, limit + 40),
	};
}

/**
 * 迁移一张按路径键存的表；旧键不存在时什么都不做（不制造空条目）。
 *
 * 表值都是 string / number，`undefined` 不会作为有效值出现。
 */
function moveMapKey<T>(
	map: Map<string, T>,
	oldPath: string,
	newPath: string,
): void {
	const value = map.get(oldPath);
	if (value === undefined) {
		return;
	}
	map.delete(oldPath);
	map.set(newPath, value);
}

/** 单次文档加载结果（视图据此前导引擎并更新自身文档状态） */
export interface DocumentLoadResult {
	tree: MindMapTreeNode;
	/** 原样保留的 frontmatter 块（含首尾 ---），保存时拼回文件头；无则 null */
	frontmatter: string | null;
	/**
	 * 原样正文（frontmatter 之后，未规范化；**不含**两者之间的空行——空行由
	 * `writeBody` 按磁盘当前值拼回）：交给 `SavePipeline.markLoaded` 做
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

	/**
	 * 解析文件内容：Markdown 大纲 → 导图树（渲染层定位，无专有格式分支）。
	 *
	 * 公开给 `DocumentSession` 复用（外部写入后从磁盘重载必须是**同一份**
	 * 解析：图片地址解析、失败缓存解除、frontmatter 切分都只有这一处实现）。
	 */
	parse(content: string, file: TFile): DocumentLoadResult {
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
	 * **指定文件**的 md frontmatter（读取失败时的兜底文件头）。必须按文件键取，
	 * 不能用"最近加载的那份"——换文件期间它会变成新文件的值。
	 */
	getFrontmatterFor(file: TFile): string | null;
	/** 写盘失败回调（视图据此提示；缺省仅 console.error） */
	onSaveError?(error: unknown): void;
	/** 一轮排空**成功结束**（含「无差异跳过写盘」）时的回调：状态栏据此切「已保存」 */
	onSaved?(file: TFile): void;
	/**
	 * 本轮写盘**因磁盘已被别处改写而放弃**（2026-11-09，Level B，替代 K177）。
	 *
	 * 检测点：写盘前重读磁盘，若正文与「本会话上次读到/写出」不同 ⇒ **不写**，
	 * 回调一次，由会话改走「从磁盘重载 + 把新树追加为一条撤销快照」（对齐官方
	 * 外部写入语义：外部改动可撤销、草稿可按 Ctrl+Z 找回）。
	 */
	onExternalAbort?(file: TFile): void;
}

/**
 * `SavePipeline.schedule()` 的去向（调用方据此决定状态栏说什么）：
 * - `scheduled`：真的排上了 → 报「保存中」；
 * - `noFile`：还没有文件（加载中 / 已卸载）→ 什么也别报。
 */
export type ScheduleOutcome = 'scheduled' | 'noFile';

/** `save()` 的选项 */
export interface SaveOptions {
	/**
	 * 收尾一致性自检：写完后若活快照又与本轮写出不同，补排一轮自动保存。
	 * 只给自动保存路径用——显式保存（命令/卸载）的调用方已在同一 tick 抓新鲜
	 * 快照，且卸载路径补排会把定时器留到下一个文件。
	 */
	reconcile?: boolean;
}

/**
 * 保存管线：2 秒防抖调度 + 串行写盘排空 + 卸载前快照兜底。
 *
 * 写盘一律 `Vault.process`（原子读改写）；运行时没有该 API 时回退为
 * `cachedRead` + `modify`。文件头恒取**磁盘当前值**，正文取本视图序列化结果，
 * 因此属性/布局键不会被旧视图覆盖。
 *
 * - 写入进行中再触发 → 标记待写并立即快照（视图卸载时引擎可能随即销毁，
 *   提前快照保证最后一批编辑不丢失）；
 * - 循环排空：写盘期间若又有编辑（savePending），继续写最新快照；
 * - 文件已删除时不重建（Obsidian 删除文件会触发 onUnloadFile）；
 * - **归属守卫**：排空期只接续同一文件的快照，不同文件的保存独立排队，
 *   绝不并入别人那一轮（详见文件头不变式）。
 */
export class SavePipeline {
	private debouncer = createDebouncer(AUTO_SAVE_DEBOUNCE_MS);
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
	 * 「路径 → **加载完成时的正文**」基线（纯浏览不写盘，2026-11-02）。
	 *
	 * 序列化带规范化（空行归一、缩进统一、有序列表重排），与磁盘原文天然不等，
	 * 单靠「无差异写盘跳过」拦不住：打开一次笔记就把全文重写一遍——实测空行被吞、
	 * 松散列表变紧凑，Git / 同步盘平白多一个 diff，而用户根本没编辑过。
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
	 * 「路径 → **本视图最近一次写出的正文**」（写盘成功即更新，含无差异跳过）。
	 *
	 * 与 `loadedBody` 的分工：`loadedBody` 是「回到加载态」的判据（纯浏览守卫），
	 * 它**不随写盘更新**；本表回答「当前活快照是否还有没落盘的改动」——同文件
	 * 其它视图据此决定能否安全重载。用加载基线代替会让「写过盘但没再编辑」的
	 * 视图被永久视为脏，外部写入永远进不来（2026-11-07 实机：两个导图视图，
	 * 关闭一个写盘后另一个不刷新）。
	 */
	private readonly lastWrittenBody = new Map<string, string>();
	/**
	 * 「路径 → **加载时的原样正文**」（`splitFrontmatter().body`，未规范化，
	 * **不含 frontmatter 与正文之间的空行**——那段由写盘时按磁盘拼回）。
	 *
	 * 撤销回到加载态且本会话写过盘时，写回这一段而不是 `serializeMdBody` 的
	 * 结果：判据（`loadedBody`）本来就是拿序列化结果比的，两者等价；而磁盘上的
	 * 原文可能带规范会改掉的形态（空行、松散列表），写序列化结果等于把用户
	 * **没编辑过的行**重排一遍（违反「未编辑行逐字回写」）。
	 */
	private readonly loadedRawBody = new Map<string, string>();
	/**
	 * 「路径 → **本文件的换行形态**」（`\n` / `\r\n`，加载时从原样正文探测）。
	 *
	 * 序列化器恒输出 LF；CRLF 文件若直接落盘，文件头（磁盘原样）是 CRLF、
	 * 正文却是 LF——一次编辑就把所有未编辑行改写（2026-11-11 实机）。
	 * 写盘与基线比较都按本表输出，两种形态各保持原样。
	 */
	private readonly loadedEol = new Map<string, '\n' | '\r\n'>();
	/**
	 * 「路径 → **本视图上次看到的磁盘正文**」（加载时记、每次写盘成功后更新）。
	 *
	 * 唯一用途是**覆盖告警**：写盘时把本次读到的磁盘正文与它比，不一致说明别处
	 * 在本视图上次读到/写出之后改过文件，而本视图马上要整篇覆盖——提示一次，
	 * 不再静默。**不能拿 `lastWrittenBody` 代替**：那张表在「撤销回加载态」时存的是
	 * 序列化结果、磁盘上却是原样正文（规范化差异），比了会恒判冲突。
	 */
	private readonly lastSeenDiskBody = new Map<string, string>();
	/**
	 * 「本会话**确实写出过**该文件」的路径集合（`process`/`modify` 成功即加入）。
	 *
	 * 纯浏览守卫只在它为假时成立：写过之后，「回到加载态」不再是「文件本就该是
	 * 那个样子」，而是要把原样**写回去**（见 `loadedBody` 的第二段说明）。
	 * 只在 `markLoaded`（重新加载）时清除。
	 */
	private readonly wroteSinceLoad = new Set<string>();
	/**
	 * 「路径 → 收尾一致性补排次数」（见 `reconcileAfterSave`）。每次真实差异
	 * 递增，一旦某轮对得上就清零；达上限只留痕不再补排（防抖动空转）。
	 */
	private readonly consistencyRetries = new Map<string, number>();
	/**
	 * 正在写盘的路径（`Vault.process` / `modify` 的 await 窗口）。
	 *
	 * 写盘时宿主会派发 `vault.on('modify')`，而 `lastSeenDiskBody` 要等写盘
	 * 返回后才更新——自写回声可能被误判成外部改写（伪重载 + 多一条历史）。
	 * 会话侧据此在窗口内直接忽略该事件（2026-11-11 静态审查定位）。
	 */
	private readonly writingPaths = new Set<string>();

	constructor(private readonly deps: SavePipelineDeps) {}

	/**
	 * 安排一次 2 秒防抖自动保存（view-toolbar / view-node-actions 等外部模块调用）。
	 *
	 * **返回值只有两种**（调用方据此决定状态栏说什么）：
	 * - `scheduled`：真的排上了 → 报「保存中」；
	 * - `noFile`：还没有文件（加载中 / 已卸载）→ 什么也别报。
	 */
	schedule(): ScheduleOutcome {
		const file = this.deps.getFile();
		if (!file) {
			return 'noFile';
		}
		this.debouncer.schedule(() => {
			void this.save(undefined, undefined, { reconcile: true });
		});
		return 'scheduled';
	}

	/** 取消尚未执行的防抖保存（文件切换/视图关闭时调用） */
	cancelTimer(): void {
		this.debouncer.cancel();
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
		// **换行形态必须先于基线入库**：`buildBody` 按 `loadedEol` 输出。先算基线
		// 再写 EOL 会让 CRLF 文件的基线恒为 LF 形态，而此后每轮比较都用 CRLF ⇒
		// `isAtLoadedState` 永远不成立，纯浏览守卫整体失效（2026-11-12 实机：
		// 同内容只差换行的两份文件，CRLF 那份开一次就被重写、LF 那份逐字不变）。
		if (typeof rawBody === 'string') {
			this.loadedRawBody.set(file.path, rawBody);
			this.lastSeenDiskBody.set(file.path, rawBody);
			// 换行形态随文件：CRLF 文件编辑后仍写 CRLF（不规范化成 LF）
			this.loadedEol.set(file.path, detectEol(rawBody));
		} else {
			this.loadedRawBody.delete(file.path);
			this.lastSeenDiskBody.delete(file.path);
			this.loadedEol.delete(file.path);
		}
		const body = this.buildBody(tree, file.path);
		this.loadedBody.set(file.path, body);
		// 刚加载：活快照与「最近写出的正文」一致（hasUnsavedChanges 的起点）
		this.lastWrittenBody.set(file.path, body);
		// 重新加载 ⇒ 「写过没有」重新起算（此时磁盘内容就是这次加载读到的内容）
		this.wroteSinceLoad.delete(file.path);
	}

	/**
	 * 文件重命名 / 移动：把按路径存的基线、写盘记录与一致性计数一并迁移。
	 *
	 * 六张表全部以 `file.path` 为键。只迁移会话键而不迁移它们，改名后：
	 * `isAtLoadedState` 读不到基线（纯浏览守卫失效，打开即重排全文）、
	 * `diskChangedSinceSeen` 恒 false（外部写入被吞、abort 判定失效）、
	 * `hasUnsavedChanges` 恒 false（草稿提示丢失）。`TFile` 在官方改名后
	 * 原地更新 `path`，所以调用方必须显式传入旧路径。
	 */
	rename(oldPath: string, newPath: string): void {
		if (oldPath === newPath) {
			return;
		}
		moveMapKey(this.loadedBody, oldPath, newPath);
		moveMapKey(this.lastWrittenBody, oldPath, newPath);
		moveMapKey(this.loadedRawBody, oldPath, newPath);
		moveMapKey(this.loadedEol, oldPath, newPath);
		moveMapKey(this.lastSeenDiskBody, oldPath, newPath);
		moveMapKey(this.consistencyRetries, oldPath, newPath);
		if (this.wroteSinceLoad.delete(oldPath)) {
			this.wroteSinceLoad.add(newPath);
		}
	}

	/**
	 * 「加载时的原样正文」（磁盘原文，未规范化）；未记录时为 `null`。
	 * 同文件其它视图写盘后，用它判断「正文是否真的变了」——只是改属性/切布局
	 * 不该触发一次引擎重建。
	 */
	loadedBodyFor(file: TFile): string | null {
		return this.loadedRawBody.get(file.path) ?? null;
	}

	/** 当前活快照的序列化正文；引擎未建/已销毁时为 `null`。 */
	currentBody(file: TFile): string | null {
		const tree = this.deps.getSnapshotFor(file);
		return tree ? this.buildBody(tree, file.path) : null;
	}

	/**
	 * 本视图对该文件是否有**未落盘的正文改动**（同文件其它视图同步前用它判断）：
	 * 与**最近一次写出的正文**逐字相同即无改动（写过盘但没再编辑 ⇒ 不脏）。
	 * 没有写盘记录时退回加载基线。取不到活快照（引擎未建/已销毁）时返回 false——
	 * 没有可写的活内容，谈不上未保存。
	 */
	hasUnsavedChanges(file: TFile): boolean {
		const tree = this.deps.getSnapshotFor(file);
		if (!tree) {
			return false;
		}
		// 优先比「最近一次写出的正文」：写过盘但没再编辑的视图不是脏的。
		// 没有写盘记录（基线尚未建立）时退回加载基线。
		const baseline =
			this.lastWrittenBody.get(file.path) ?? this.loadedBody.get(file.path);
		if (baseline === undefined) {
			return false;
		}
		return this.buildBody(tree, file.path) !== baseline;
	}

	/**
	 * 写盘。
	 *
	 * @param file    目标文件；缺省取视图当前文件。**卸载/关闭路径必须显式传入
	 *                自己那份文件**——core 不 await onUnloadFile，隐式取值可能
	 *                已是新文件（会把旧文档内容写进新文件）。
	 * @param treeHint 调用方对**该文件**的树快照（卸载时同步抓取）。引擎已交班/
	 *                销毁导致活快照取不到时用它兜底，保证最后一批编辑不丢。
	 * @param opts     见 `SaveOptions`（仅自动保存传 `reconcile`）。
	 */
	async save(
		file?: TFile,
		treeHint?: MindMapTreeNode | null,
		opts?: SaveOptions,
	): Promise<void> {
		const target = file ?? this.deps.getFile();
		if (!target) {
			return;
		}
		// 文件已被删除时不应重新保存：Obsidian 删除文件会触发 onUnloadFile，
		// 此时若继续写盘，会重建已被删除的文件（表现为"要删两次"）。
		if (!this.deps.app.vault.getFileByPath(target.path)) {
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
			await this.activeSave;
			return this.save(target, treeHint, opts);
		}
		// frontmatter 在请求时刻按目标文件抓取：排空期间即使视图已切到别的文件，
		// 本文件写出的仍是自己的文件头（磁盘读不到时的兜底）。
		const frontmatter = this.deps.getFrontmatterFor(target);
		this.saveInProgress = true;
		this.drainFile = target;
		this.activeSave = this.enqueue(async () => {
			/** 本轮最后写出的**正文**（收尾一致性自检用，判据与纯浏览守卫同源） */
			let lastBody: string | null = null;
			/** 本轮是否**真的写过盘**（收尾自检只对写过的轮次有意义） */
			let wroteDisk = false;
			/** 本轮是否因磁盘被别处改写而**放弃写盘**（每轮最多回调一次） */
			let externalAbort = false;
			/** 本轮是否因异常提前收场（失败轮不回调「已保存」） */
			let failed = false;
			try {
				// 循环排空：写盘期间若又有编辑（savePending），继续写最新快照
				let tree = this.takeTreeFor(target, treeHint);
				while (tree && this.deps.app.vault.getFileByPath(target.path)) {
					try {
						const body = this.buildBody(tree, target.path);
						lastBody = body;
						// 纯浏览不写盘：本轮正文与加载时逐字相同 ⇒ 本会话没有内容级
						// 改动。规范化结果不落盘——否则只是打开看一眼，文件就被重排。
						const atLoadedState =
							this.isAtLoadedState(target, body) === true;
						const wroteSinceLoad = this.wroteSinceLoad.has(target.path);
						if (atLoadedState && !wroteSinceLoad) {
							// 纯浏览：不写盘、不动任何基线
						} else {
							// 写过盘之后回到加载态，要把**加载时的原样正文**写回去
							// （避免把没编辑过的行规范化一遍）。
							const finalBody = atLoadedState
								? (this.loadedRawBody.get(target.path) ?? body)
								: body;
							const result = await this.writeBody(
								target,
								finalBody,
								frontmatter,
							);
							if (result.aborted) {
								// 磁盘已被别处改写：**一个字都不写**，交会话重载（对齐
								// 官方「外部改动不被陈旧视图覆盖」；K177 的「覆盖后提示」
								// 已被本条替换）
								externalAbort = true;
								tree = null;
								break;
							}
							const wrote = result.wrote;
							// 无论是否真的产生差异（无差异跳过），此刻磁盘正文就是
							// finalBody：更新「最近写出」基线，外部写入才能安全重载本视图。
							// **存序列化结果（`body`）而不是 `finalBody`**：本表的唯一消费者
							// `hasUnsavedChanges` 拿 `buildBody(活快照)` 来比，两边必须同源。
							// 存原样正文会让「撤销回加载态」那一支写完后恒被判脏（规范化差异
							// 永远存在），同文件另一个视图的写盘就再也不会被本视图接受。
							this.lastWrittenBody.set(target.path, body);
							if (wrote) {
								// 写过之后「纯浏览」不再成立（见 loadedBody 说明）
								this.wroteSinceLoad.add(target.path);
								wroteDisk = true;
							}
						}
					} catch (error) {
						// 保存失败通常是磁盘满/权限：留痕并结束本轮，下一次编辑照常
						// 重新排程（没有「挂起」这种插件特有状态）。
						console.error('保存思维导图失败', error);
						this.deps.onSaveError?.(error);
						this.savePending = false;
						this.pendingTree = null;
						this.pendingFile = null;
						failed = true;
						tree = null;
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
				// 磁盘上的反而是旧的。补排一次自动保存把差异追平；连续失败只留痕。
				//
				// **只对自动保存做**：显式保存（命令 / 卸载）的调用方本来就在同一个
				// tick 里抓新鲜快照，没有「陈旧」可言；卸载路径补排会把定时器留到
				// 下一个文件。
				if (externalAbort) {
					// 放弃本轮：基线不动（磁盘已是别人的内容），交会话重载
					this.savePending = false;
					this.pendingTree = null;
					this.pendingFile = null;
					this.deps.onExternalAbort?.(target);
					return;
				}
				if (opts?.reconcile && wroteDisk && lastBody !== null) {
					this.reconcileAfterSave(target, lastBody);
				}
				// 本轮排空成功（含无差异跳过）：通知视图「已保存」。
				// 失败轮不回调：失败态由 onSaveError 表达。
				if (
					!failed &&
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
	 * 原子写盘：`Vault.process`（读—改—写原子、同文件调用串行）；运行时缺失时
	 * 回退 `cachedRead` + `modify`。
	 *
	 * 文件头恒取**本次读到的磁盘内容**（读不到才用加载时快照），正文用调用方
	 * 序列化的结果——因此属性/布局键永远是最新磁盘值，不会被旧视图覆盖。
	 *
	 * @returns `wrote` = 是否真的写出（内容与磁盘一致时 false，不惊动 mtime/同步）；
	 *          `aborted` = 磁盘正文已在本会话上次读到/写出之后被别处改写 ⇒
	 *          **一个字都不写**（对齐官方：外部改动不被陈旧视图覆盖）
	 */
	private async writeBody(
		file: TFile,
		body: string,
		fallbackHeader: string | null,
	): Promise<{ wrote: boolean; aborted: boolean }> {
		/** 本轮是否因磁盘已变而放弃（`build` 内判定，调用方据此短路） */
		let aborted = false;
		const build = (current: string | null): string => {
			// 文件头与其后的空行都取**磁盘当前值**：`processFrontMatter` 只改文件头，
			// 不能因为一次正文写盘把它与正文之间的空行吃掉（2026-11-09 实机）。
			const parsed = current === null ? null : splitFrontmatter(current);
			const header = parsed ? parsed.frontmatter : fallbackHeader;
			const gap = parsed ? parsed.gap : '';
			// 放弃写盘（Level B，替代 K177 的覆盖告警）：只认「本会话见过磁盘正文」
			// 的文件。没见过（首次写盘且加载时没拿到 rawBody）不猜，避免误报。
			// 比较的是**正文**：只改文件头（属性面板 / 切布局）不算外部改写。
			if (parsed) {
				const seen = this.lastSeenDiskBody.get(file.path);
				if (seen !== undefined && parsed.body !== seen) {
					aborted = true;
					return current as string;
				}
			}
			return this.wrapBase(
				body,
				header,
				gap,
				this.loadedEol.get(file.path) ?? '\n',
			);
		};
		const current = await this.readCurrentContent(file);
		const next = current === null ? null : build(current);
		if (aborted) {
			return { wrote: false, aborted: true };
		}
		// 无差异写盘跳过：写盘即使内容一字未变也会刷新 mtime 并惊动元数据缓存
		// 与同步，而「自动整理」这类操作只清拖拽坐标、Markdown 文本没变。
		// 读取失败一律照常写盘（fail-open，绝不因读失败丢写）。
		if (next !== null && next === current) {
			return { wrote: false, aborted: false };
		}
		const vault = this.deps.app.vault as {
			process?: (
				target: TFile,
				fn: (data: string) => string,
			) => Promise<string>;
		};
		if (typeof vault.process === 'function') {
			let changed = false;
			this.writingPaths.add(file.path);
			try {
				await vault.process(file, (data) => {
				// 读与写之间磁盘又变了：返回原值（不写），交会话重载
				if (aborted) {
					return data;
				}
				const built = build(data);
				if (aborted) {
					return data;
				}
					changed = built !== data;
					return built;
				});
			} finally {
				this.writingPaths.delete(file.path);
			}
			if (aborted) {
				return { wrote: false, aborted: true };
			}
			// 写盘成功（含内容一致）：磁盘正文此刻就是 body，更新「上次看到」基线。
			// 存**落盘形态**（补齐尾随换行）：`serializeMdBody` 不带尾换行，而
			// `splitFrontmatter().body` 是磁盘原文（带）——存串行化形态会让下一次
			// 比较恒不相等、把正常写盘误判成外部改写（abort）。
			this.lastSeenDiskBody.set(file.path, this.asDiskBody(body, file.path));
			return { wrote: changed, aborted: false };
		}
		const content = build(current);
		if (aborted) {
			return { wrote: false, aborted: true };
		}
		if (current === content) {
			return { wrote: false, aborted: false };
		}
		this.writingPaths.add(file.path);
		try {
			await this.deps.app.vault.modify(file, content);
		} finally {
			this.writingPaths.delete(file.path);
		}
		this.lastSeenDiskBody.set(file.path, this.asDiskBody(body, file.path));
		return { wrote: true, aborted: false };
	}

	/**
	 * 序列化正文 → **落盘形态**（补齐尾随换行）。
	 *
	 * `serializeMdBody` 不写尾随换行、`wrapBase` 写盘时补一个；而
	 * `splitFrontmatter().body` 是磁盘原文（带换行）。「上次看到的磁盘正文」
	 * 必须与后者同口径，否则每次比较都差一个 `\n`、把正常写盘误判成外部改写。
	 */
	private asDiskBody(body: string, path?: string): string {
		const eol = path === undefined ? '\n' : (this.loadedEol.get(path) ?? '\n');
		return body.endsWith('\n') ? body : `${body}${eol}`;
	}

	/**
	 * 磁盘正文是否在本会话上次读到/写出之后变过（外部写入的唯一判据）。
	 *
	 * 组合根的 `vault.on('modify')` 用它区分「自己的写盘回声」（`lastSeenDiskBody`
	 * 已在写成功后更新为写出正文）与「别处改过」（需要放弃写盘 / 重载）。
	 */
	diskChangedSinceSeen(file: TFile, diskBody: string): boolean {
		const seen = this.lastSeenDiskBody.get(file.path);
		return seen !== undefined && diskBody !== seen;
	}

	/** 当前是否有本管线的写盘正在进行（自写回声的过滤器，见 `writingPaths`） */
	isWriting(path: string): boolean {
		return this.writingPaths.has(path);
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
	 * 下一次自然带最新快照。每路径最多补排 `MAX_CONSISTENCY_RETRIES` 次。
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
		const liveBody = this.buildBody(live, target.path);
		if (liveBody === writtenBody) {
			this.consistencyRetries.delete(target.path);
			return;
		}
		// 根因未定位（K158②）：至少把「差在哪」留下来，别再让自愈静默吞掉
		warnConsistencyOnce('保存收尾自检发现活快照与写出正文不一致（自愈兜底）', {
			path: target.path,
			...firstDifference(liveBody, writtenBody),
		});
		const retries = (this.consistencyRetries.get(target.path) ?? 0) + 1;
		if (retries > MAX_CONSISTENCY_RETRIES) {
			// 只提示一次（诊断线索），不抛错：用户的下一次编辑仍会正常排程，
			// 卸载/显式保存也会把最新内容写出去。
			// **必须把计数落在上限之上**：只告警不写回的话，后续每一轮写盘都会算出
			// 同一个「超限」值、再告警一次——「只提示一次」就成了每轮一条。
			if (this.consistencyRetries.get(target.path) === MAX_CONSISTENCY_RETRIES) {
				console.warn(
					'保存后仍有未落盘的内容差异，已停止自动补排',
					target.path,
				);
				this.consistencyRetries.set(target.path, retries);
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
	 * 本轮正文是否**逐字等于加载基线**：`null` = 基线未知（尚未 `markLoaded`）。
	 */
	private isAtLoadedState(file: TFile, body: string): boolean | null {
		const loaded = this.loadedBody.get(file.path);
		return loaded === undefined ? null : loaded === body;
	}

	/**
	 * 树 → Markdown 正文（不含文件头）。**纯浏览守卫与写盘共用这一段**：
	 * 两边必须逐字可比，另写一份就等于判据失真。
	 */
	private buildBody(tree: MindMapTreeNode, path?: string): string {
		const body = serializeMdBody(tree, this.deps.app);
		// 序列化器恒输出 LF；CRLF 文件按加载时探测的形态还原（见 loadedEol）
		return path !== undefined && this.loadedEol.get(path) === '\r\n'
			? body.replace(/\n/g, '\r\n')
			: body;
	}

	/**
	 * 正文 + 原样文件头 + 两者之间的空行拼成落盘内容（布局不入正文），保证尾随换行。
	 *
	 * `gap` 来自**磁盘当前内容**（`splitFrontmatter().gap`），与文件头同源：
	 * 0 行就紧贴、1 行是常规分隔、多行照原样——序列化器不参与这一段的生成，
	 * 故编辑正文不会把它规范化掉。
	 *
	 * 文件头**只有 BOM**（无属性块）时不能补换行——那会把 BOM 单独变成一行、
	 * 改动文件结构；其余形态（`---…---`）需要一个换行与正文分隔。
	 */
	private wrapBase(
		body: string,
		header: string | null,
		gap = '',
		eol: '\n' | '\r\n' = '\n',
	): string {
		let content: string;
		if (!header) {
			content = body;
		} else if (header === UTF8_BOM) {
			content = header + body;
		} else {
			const sep = header.endsWith('\n') ? '' : '\n';
			content = `${header}${sep}${gap}${body}`;
		}
		if (!content.endsWith('\n')) {
			content += eol;
		}
		return content;
	}
}

/**
 * 从原样正文探测换行形态：取**第一处**换行，`\r\n` ⇒ CRLF，否则 LF。
 *
 * 只看第一处（而不是全篇统计）：文件头恒按磁盘原样保留，正文的形态应跟随
 * 加载时读到的第一个换行——混合换行的文件不会被这里二次改写。
 */
function detectEol(body: string): '\n' | '\r\n' {
	const index = body.indexOf('\n');
	return index > 0 && body[index - 1] === '\r' ? '\r\n' : '\n';
}
