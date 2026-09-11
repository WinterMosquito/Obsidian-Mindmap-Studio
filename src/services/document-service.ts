/**
 * Markdown 文档服务：.mindmap.md 的读取/解析与保存管线（渲染层数据面）。
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
import { stripMindMapStem, AUTO_SAVE_DEBOUNCE_MS } from '../constants';
import { createDebouncer, createSerialQueue } from '../concurrency';
import { parseMdOutline } from '../md-outline';
import { serializeMdBody } from '../md-serialize';
import { walkResolveImagePaths } from '../images-path';
import { isMindMapMarkdownFile } from '../md-open';
import type { MindMapTreeNode } from '../../vendor/simple-mind-map.cjs';

/** 单次文档加载结果（视图据此前导引擎并更新自身文档状态） */
export interface DocumentLoadResult {
	tree: MindMapTreeNode;
	/** 原样保留的 frontmatter 块（含首尾 ---），保存时拼回文件头；无则 null */
	frontmatter: string | null;
	/** 文件是否为 .mindmap.md 文档模式（按文件名锁定） */
	isMdDocument: boolean;
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
		// 根（中心主题）文本 = 文件名（去 .mindmap 后缀）；改名由视图编排
		const rootName = stripMindMapStem(file.basename) || file.basename;
		const parsed = parseMdOutline(content, rootName);
		const tree = parsed.tree;
		// 图片：库内路径/外链 → 资源地址（mdImageTarget 保留原目标串，供回写）。
		// 图片尺寸不在此归一：视图加载走 walkCorrectImageSizesByAspect（按原始
		// 比例，探测失败自动回退固定尺寸）。
		walkResolveImagePaths(tree, this.app);
		return {
			tree,
			frontmatter: parsed.frontmatter,
			isMdDocument: isMindMapMarkdownFile(file),
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
	 */
	getFrontmatterFor(file: TFile): string | null;
	/** 自动保存开关（关闭时 schedule 不生效，显式 save 仍可用） */
	isAutoSave(): boolean;
	/** 写盘失败回调（视图据此弹用户可见提示；缺省仅 console.error） */
	onSaveError?(error: unknown): void;
}

const SAVE_DELAY_MS = AUTO_SAVE_DEBOUNCE_MS;

/**
 * 保存管线：防抖调度 + 串行写盘排空 + 卸载前快照兜底。
 * 原 view.ts save 机制逐行等价搬移：
 * - 写入进行中再触发 → 标记待写并立即快照（视图卸载时引擎可能随即销毁，
 *   提前快照保证最后一批编辑不丢失）；
 * - 循环排空：写盘期间若又有编辑（savePending），继续写最新快照；
 * - 文件已删除时不重建（Obsidian 删除 .mindmap 会触发 onUnloadFile）；
 * - **归属守卫**：排空期只接续同一文件的快照，不同文件的保存独立排队，
 *   绝不并入别人那一轮（详见文件头不变式）。
 */
export class SavePipeline {
	private debouncer = createDebouncer(SAVE_DELAY_MS);
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

	constructor(private readonly deps: SavePipelineDeps) {}

	/** 安排一次防抖自动保存（view-toolbar / view-node-actions 等外部模块调用） */
	schedule(): void {
		if (!this.deps.isAutoSave() || !this.deps.getFile()) {
			return;
		}
		this.debouncer.schedule(() => {
			void this.save();
		});
	}

	/** 取消尚未执行的防抖保存（文件切换/视图关闭时调用） */
	cancelTimer(): void {
		this.debouncer.cancel();
	}

	/**
	 * 写盘。
	 *
	 * @param file    目标文件；缺省取视图当前文件。**卸载/关闭路径必须显式传入
	 *                自己那份文件**——core 不 await onUnloadFile，隐式取值可能
	 *                已是新文件（会把旧文档内容写进新文件）。
	 * @param treeHint 调用方对**该文件**的树快照（卸载时同步抓取）。引擎已交班/
	 *                销毁导致活快照取不到时用它兜底，保证最后一批编辑不丢。
	 */
	async save(file?: TFile, treeHint?: MindMapTreeNode | null): Promise<void> {
		const target = file ?? this.deps.getFile();
		if (!target) {
			return;
		}
		// 文件已被删除时不应重新保存：Obsidian 删除 .mindmap 会触发 onUnloadFile，
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
			//（并入会把本文件的内容写进正被排空的另一个文件）。
			await this.activeSave;
			return this.save(target, treeHint);
		}
		// frontmatter 在请求时刻按目标文件抓取：排空期间即使视图已切到别的文件，
		// 本文件写出的仍是自己的文件头。
		const frontmatter = this.deps.getFrontmatterFor(target);
		this.saveInProgress = true;
		this.drainFile = target;
		this.activeSave = this.enqueue(async () => {
			try {
				// 循环排空：写盘期间若又有编辑（savePending），继续写最新快照
				let tree = this.takeTreeFor(target, treeHint);
				while (
					tree &&
					// 排空循环删除守卫是文件存在性检查（类型化 getter）
					this.deps.app.vault.getFileByPath(target.path)
				) {
					try {
						const content = this.serialize(tree, frontmatter);
						// 无差异写盘跳过：vault.modify 即使内容一字未变也会刷新 mtime 并
						// 惊动元数据缓存与同步，而「自动整理」这类操作只清拖拽坐标、
						// Markdown 文本没变。比对以**文件当前内容**为准——只跳过
						// 「要写的正是文件里已有的内容」，绝不吞掉真实差异；
						// 读取失败一律照常写盘（fail-open）。
						if ((await this.readCurrentContent(target)) !== content) {
							await this.deps.app.vault.modify(target, content);
						}
					} catch (error) {
						// 保存失败通常是磁盘满/权限，重试无意义；立即复位排空状态
						// 让下一次 scheduleSave 从头再来，而不是沿着这条错误链继续。
						console.error('保存思维导图失败', error);
						this.deps.onSaveError?.(error);
						this.savePending = false;
						this.pendingTree = null;
						this.pendingFile = null;
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
			} finally {
				this.saveInProgress = false;
				this.drainFile = null;
			}
		});
		return this.activeSave;
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

	/** 序列化为 md 大纲 + 原样 frontmatter（布局不入文件），保证尾随换行 */
	private serialize(tree: MindMapTreeNode, frontmatter: string | null): string {
		const body = serializeMdBody(tree, this.deps.app);
		let content = frontmatter
			? frontmatter.endsWith('\n')
				? frontmatter + body
				: `${frontmatter}\n${body}`
			: body;
		if (!content.endsWith('\n')) {
			content += '\n';
		}
		return content;
	}
}
