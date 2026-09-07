/**
 * Markdown 文档服务：.mindmap.md 的读取/解析与保存管线（渲染层数据面）。
 * 从 view.ts 拆出（第 4 步）。
 *
 * 本模块不含引擎依赖：
 * - 解析/序列化是纯 Markdown 往返（md-outline ⇄ md-serialize）；
 * - 保存管线的树快照经回调注入（引擎 getData 由调用方提供），
 *   引擎销毁后的兜底快照（pendingTree）由管线自身持有。
 */
import { App, TFile } from 'obsidian';
import { stripMindMapStem } from '../constants';
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
		// 比例，探测失败自动回退固定尺寸），代码块路径自行调用 normalizeImageSizes。
		walkResolveImagePaths(tree, this.app);
		return {
			tree,
			frontmatter: parsed.frontmatter,
			isMdDocument: isMindMapMarkdownFile(file),
		};
	}
}

/** 保存管线依赖（全部窄化注入，不持有视图/引擎引用） */
export interface SavePipelineDeps {
	app: App;
	/** 视图当前文件（视图关闭/卸载中可能为 null） */
	getFile(): TFile | null;
	/** 引擎当前树快照（引擎已销毁时为 null，管线用兜底快照续写） */
	getSnapshot(): MindMapTreeNode | null;
	/** md frontmatter（保存时拼回文件头） */
	getFrontmatter(): string | null;
	/** 自动保存开关（关闭时 schedule 不生效，显式 save 仍可用） */
	isAutoSave(): boolean;
	/** 写盘失败回调（视图据此弹用户可见提示；缺省仅 console.error） */
	onSaveError?(error: unknown): void;
}

const SAVE_DELAY_MS = 800;

/**
 * 保存管线：防抖调度 + 串行写盘排空 + 卸载前快照兜底。
 * 原 view.ts save 机制逐行等价搬移：
 * - 写入进行中再触发 → 标记待写并立即快照（视图卸载时引擎可能随即销毁，
 *   提前快照保证最后一批编辑不丢失）；
 * - 循环排空：写盘期间若又有编辑（savePending），继续写最新快照；
 * - 文件已删除时不重建（Obsidian 删除 .mindmap 会触发 onUnloadFile）。
 */
export class SavePipeline {
	private debouncer = createDebouncer(SAVE_DELAY_MS);
	/** 串行写盘队列：所有 save 调用共享，调用方可 await 完整排空 */
	private enqueue = createSerialQueue();
	private saveInProgress = false;
	private savePending = false;
	/** 待写快照：视图卸载时引擎已销毁，用它兜底最后一批编辑 */
	private pendingTree: MindMapTreeNode | null = null;
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

	async save(): Promise<void> {
		const current = this.deps.getFile();
		if (!current) {
			return;
		}
		// 文件已被删除时不应重新保存：Obsidian 删除 .mindmap 会触发 onUnloadFile，
		// 此时若继续 vault.modify，会重建已被删除的文件（表现为"要删两次"）。
		if (
			// eslint-disable-next-line no-restricted-syntax -- 删除守卫是存在性检查，非文件解析
			!this.deps.app.vault.getAbstractFileByPath(current.path)
		) {
			return;
		}
		if (this.saveInProgress) {
			// 写入进行中：标记待写并立即快照最新数据。
			// 视图卸载（onUnloadFile/onClose）时引擎可能随即被销毁，
			// 提前快照保证最后一批编辑不丢失。
			this.savePending = true;
			this.pendingTree = this.deps.getSnapshot() ?? this.pendingTree;
			return this.activeSave;
		}
		const file = current;
		this.saveInProgress = true;
		this.activeSave = this.enqueue(async () => {
			try {
				// 循环排空：写盘期间若又有编辑（savePending），继续写最新快照
				let tree = this.deps.getSnapshot();
				while (
					tree &&
					// eslint-disable-next-line no-restricted-syntax -- 排空循环删除守卫是存在性检查，非文件解析
					this.deps.app.vault.getAbstractFileByPath(file.path)
				) {
					try {
						await this.deps.app.vault.modify(
							file,
							this.serialize(tree),
						);
					} catch (error) {
						console.error('保存思维导图失败', error);
						this.deps.onSaveError?.(error);
					}
					if (!this.savePending) {
						tree = null;
						break;
					}
					this.savePending = false;
					tree = this.deps.getSnapshot() ?? this.pendingTree;
					this.pendingTree = null;
				}
			} finally {
				this.saveInProgress = false;
			}
		});
		return this.activeSave;
	}

	/** 序列化为 md 大纲 + 原样 frontmatter（布局不入文件），保证尾随换行 */
	private serialize(tree: MindMapTreeNode): string {
		const body = serializeMdBody(tree, this.deps.app);
		const frontmatter = this.deps.getFrontmatter();
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
