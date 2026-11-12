/**
 * 文档会话注册表：`路径 → DocumentSession` 的唯一入口。
 *
 * ## 为什么按路径键
 * Obsidian 的文件身份在库内由路径表达（`TFile` 实例在重命名后原地更新
 * `path`）；会话必须与「正在编辑的那个文件」一一对应，否则外部写入 /
 * 保存归属 / 历史都会错位。重命名时**只迁移键**，会话与视图都不重建
 * （实机：官方两个 Markdown 视图在改名后 `file.path` 原地更新、历史条数
 * 不变、引擎不重载）。
 *
 * ## 生命周期
 * - 第一个视图加载 → `acquire`（不存在则读盘一次并建会话）；
 * - 后续视图加载 → 复用同一会话（**不再读盘**：磁盘可能落后于未保存改动）；
 * - 每个视图解绑 → 会话 flush 一次并保留；最后一个解绑 → 会话销毁、键移除；
 * - 重命名 / 外部写入由组合根的单点订阅转发进来（`VaultSyncService`，K30）。
 */
import { App, TFile } from 'obsidian';
import {
	DocumentSession,
	type DocumentSessionOptions,
} from './document-session';

export class DocumentSessionRegistry {
	private readonly sessions = new Map<string, DocumentSession>();

	constructor(
		private readonly app: App,
		/**
		 * 广播合并窗口（ms）。**生产不要传**：缺省由
		 * `DocumentSession.computeBroadcastDelayMs` 按节点数分级（≤600 节点
		 * 0 ms、更大 60 ms）；只有测试需要确定的时间窗。
		 */
		private readonly broadcastDelayMs?: number,
		/** 测试注入（文档读取 / 解析）；生产恒为空 */
		private readonly sessionOptions: Partial<DocumentSessionOptions> = {},
	) {}

	/**
	 * 取该文件的会话；不存在则读盘一次并建好。
	 *
	 * 并发调用（同一路径两个视图同时 onLoadFile）由「先登记占位、再 await
	 * 加载」消解：第二个调用拿到的会话 `load()` 尚未完成，`acquire` 会等它。
	 */
	async acquire(file: TFile): Promise<DocumentSession> {
		const existing = this.sessions.get(file.path);
		if (existing) {
			await existing.load();
			return existing;
		}
		const session = new DocumentSession({
			...this.sessionOptions,
			app: this.app,
			file,
			// 只有测试显式给值时才固定窗口；缺省让会话按节点数分级
			...(this.broadcastDelayMs === undefined
				? {}
				: { broadcastDelayMs: this.broadcastDelayMs }),
			onEmpty: (empty) => this.release(empty),
		});
		this.sessions.set(file.path, session);
		try {
			await session.load();
		} catch (error) {
			this.sessions.delete(file.path);
			throw error;
		}
		return session;
	}

	/** 按路径查会话（不存在返回 undefined；不触发加载） */
	find(path: string): DocumentSession | undefined {
		return this.sessions.get(path);
	}

	/** 文件重命名 / 移动：只迁移键，会话与视图不重建 */
	rename(oldPath: string, newPath: string): void {
		const session = this.sessions.get(oldPath);
		if (!session) {
			return;
		}
		// 保存管线的六张基线表也按路径存：只搬 Map 键而不搬它们，改名后
		// 纯浏览守卫、外部改动判定与草稿判据会一起失配（2026-11-09 实机：
		// atLoaded=null / dirty=false / 外部正文变化判不出）。
		session.rename(oldPath, newPath);
		this.sessions.delete(oldPath);
		if (newPath !== oldPath) {
			this.sessions.set(newPath, session);
		}
	}

	/** 外部写入：转发给对应会话（一个文件一次，不逐视图重复处理） */
	onModify(file: TFile): void {
		this.sessions.get(file.path)?.onExternalModify(file);
	}

	/** 插件卸载：销毁全部会话（视图侧 onClose 已各自 flush） */
	dispose(): void {
		for (const session of this.sessions.values()) {
			session.destroy();
		}
		this.sessions.clear();
	}

	/** 会话空转（最后一个视图解绑）：移除键 */
	private release(session: DocumentSession): void {
		if (this.sessions.get(session.path) === session) {
			this.sessions.delete(session.path);
		}
	}
}
