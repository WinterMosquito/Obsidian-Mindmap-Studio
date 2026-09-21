/**
 * Vault 同步服务：响应库内文件的 rename/delete/create 事件。
 *
 * Markdown 渲染层下插件不再持有 .mindmap 附件索引/反链等跨文件状态，
 * 本服务仅剩两类职责：
 * 1. 打开视图的引用更新 —— 文件重命名/删除后，通知每个打开的导图视图
 *    同步树内图片/[[链接]] 引用（links-tree 预检零拷贝）；
 * 2. 文件查找缓存保鲜 —— create 增量补建、rename/delete 整体失效共享的
 *    path→file 缓存（图片解析/回写用，file-lookup 惰性重建）。
 *
 * 本服务是 vault rename/delete/create 事件的**单一注册入口**：
 * 插件侧的补充处理（如视图状态键迁移）经 hooks 注入，不再各自
 * registerEvent 第二份订阅（此前 main.ts 与本服务双订阅同名事件）。
 *
 * 用结构接口 MindMapViewLike 替代直接 import MindMapView，避免与
 * view.ts（其运行时 import main.ts）形成循环依赖。
 */
import { App, Plugin, TAbstractFile, TFile } from 'obsidian';
import { VIEW_TYPE } from '../core/constants';
import { fileLookupIndex } from '../links/file-lookup';

/** MindMapView 的最小结构接口：仅暴露本服务需要的成员 */
interface MindMapViewLike {
	mindMap: unknown;
	updateReferencesOnRename(file: TFile, oldPath: string): void;
	updateReferencesOnDelete(file: TFile): void;
}

/** 插件侧补充处理钩子（在缓存失效与引用更新之后按原顺序分发） */
export interface VaultSyncHooks {
	/** rename 补充处理（含非 TFile 的 TFolder 等场景，调用方自行收窄） */
	onRename?(file: TAbstractFile, oldPath: string): void;
	/** delete 补充处理 */
	onDelete?(file: TAbstractFile): void;
}

export class VaultSyncService {
	constructor(private app: App) {}

	/**
	 * 注册全部 vault 事件处理器（在插件 onload 中调用一次）。
	 * @param hooks 插件侧补充处理（如 viewState 键迁移），缺省无
	 */
	attach(plugin: Plugin, hooks: VaultSyncHooks = {}): void {
		plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				fileLookupIndex.invalidate();
				if (file instanceof TFile) {
					this.forEachOpenMindMapView((view) => {
						if (view.mindMap) {
							view.updateReferencesOnRename(file, oldPath);
						}
					});
				}
				hooks.onRename?.(file, oldPath);
			}),
		);
		plugin.registerEvent(
			this.app.vault.on('delete', (file) => {
				fileLookupIndex.invalidate();
				if (file instanceof TFile) {
					this.forEachOpenMindMapView((view) => {
						if (view.mindMap) {
							view.updateReferencesOnDelete(file);
						}
					});
				}
				hooks.onDelete?.(file);
			}),
		);
		plugin.registerEvent(
			this.app.vault.on('create', (file) => {
				// 库内新建**文件**：**增量**补建索引（create 是最高频的一类库事件
				// ——批量导入/外部同步；原「整体失效」会让风暴期内的每次查询都
				// 付一遍全量重建）。文件夹不影响文件索引（索引只收录 TFile），
				// 若一并整体失效则每次建目录都白白废弃索引。
				if (file instanceof TFile) {
					fileLookupIndex.noteCreated(this.app, file);
				}
			}),
		);
	}

	/** 遍历所有打开的思维导图视图 */
	private forEachOpenMindMapView(
		callback: (view: MindMapViewLike) => void,
	): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			// getLeavesOfType(VIEW_TYPE) 已保证 leaf.view 是 MindMapView 实例，
			// 经 unknown 中转做结构断言（避免与 view.ts 的运行时循环依赖）。
			callback(leaf.view as unknown as MindMapViewLike);
		});
	}
}
