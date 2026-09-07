/**
 * 视图状态存储：按文件路径保存布局与视口（缩放/平移）。
 *
 * .mindmap.md 正文必须保持纯 Markdown，布局/视口不写入文件；
 * 状态存插件 data.json（顶层 `viewState` 键，path → 状态），
 * 与 settings 合并写入（保持历史顶层设置格式兼容）。
 *
 * 状态：
 * - layout: 布局类型（logicalStructure/mindMap/...）
 * - view: 引擎 view.getTransformData() 输出（{transform, state}）
 */
import { createDebouncer, type Debouncer } from './concurrency';

export type PathState = Record<string, unknown>;

const VIEW_STATE_KEY = 'viewState';

export class ViewStateStore {
	private map = new Map<string, PathState>();
	private debouncer: Debouncer;

	/**
	 * @param persist     序列化后的状态写盘回调（由插件注入，合并 data.json）。
	 *   可返回 Promise（如 PluginDataWriter.write）：防抖路径忽略返回值，
	 *   flushNow 会原样返回给调用方，供卸载路径尽力跟踪写盘完成。
	 * @param debounceMs  写盘防抖
	 */
	constructor(
		private persist: (state: Record<string, PathState>) => void | Promise<void>,
		private debounceMs = 600,
	) {
		this.debouncer = createDebouncer(debounceMs);
	}

	/** 从插件 data.json 载入（顶层 viewState 键） */
	hydrate(data: unknown): void {
		this.map.clear();
		if (data && typeof data === 'object') {
			const raw = (data as Record<string, unknown>)[VIEW_STATE_KEY];
			if (raw && typeof raw === 'object') {
				for (const [path, state] of Object.entries(
					raw as Record<string, unknown>,
				)) {
					if (state && typeof state === 'object') {
						const s = state as Record<string, unknown>;
						// 形状校验：只接受含已知字段的视图状态，丢弃畸形/异常条目
						// （防手改 data.json、引擎升级后 view 结构变化等导致的坏数据渗入）。
						if ('layout' in s || 'view' in s || 'openAs' in s) {
							this.map.set(path, s);
						}
					}
				}
			}
		}
	}

	/** 序列化视图状态（供写盘；也会随 settings 全量保存时一并带上） */
	serialize(): Record<string, PathState> {
		return Object.fromEntries(this.map);
	}

	getLayout(path: string): string | undefined {
		const layout = this.map.get(path)?.layout;
		return typeof layout === 'string' ? layout : undefined;
	}

	setLayout(path: string, layout: string): void {
		this.patch(path, { layout });
	}

	/** 打开方式偏好：'mindmap' | 'markdown'（最后一次主动选择决定） */
	getOpenAs(path: string): 'mindmap' | 'markdown' | undefined {
		const openAs = this.map.get(path)?.openAs;
		return openAs === 'mindmap' || openAs === 'markdown' ? openAs : undefined;
	}

	setOpenAs(path: string, mode: 'mindmap' | 'markdown'): void {
		this.patch(path, { openAs: mode });
	}

	getView(path: string): unknown {
		return this.map.get(path)?.view;
	}

	setView(path: string, view: unknown): void {
		this.patch(path, { view });
	}

	/** 文件重命名后迁移状态键（路径变化） */
	renameKey(oldPath: string, newPath: string): void {
		const state = this.map.get(oldPath);
		if (!state) {
			return;
		}
		this.map.delete(oldPath);
		this.map.set(newPath, state);
		this.schedulePersist();
	}

	/** 文件删除后清理状态键 */
	removeKey(path: string): void {
		if (!this.map.delete(path)) {
			return;
		}
		this.schedulePersist();
	}

	private patch(path: string, partial: PathState): void {
		this.map.set(path, { ...(this.map.get(path) ?? {}), ...partial });
		this.schedulePersist();
	}

	private schedulePersist(): void {
		// 防抖路径 fire-and-forget：persist 返回 Promise 时不等待
		//（注入的 PluginDataWriter.write 内部吞错，不会产生未处理拒绝）。
		this.debouncer.schedule(() => {
			void this.persist(this.serialize());
		});
	}

	/**
	 * 立即排空未落盘的变更（插件卸载/视图关闭时调用）。
	 * @returns 有未决变更时返回 persist 的结果（Promise 透传）；
	 *   无未决变更返回 undefined。同步 onunload 无法 await 写盘，
	 *   但可借此持有在途写盘（日志/测试跟踪），使排空语义可观测。
	 */
	flushNow(): Promise<void> | undefined {
		if (this.debouncer.cancel()) {
			return Promise.resolve(this.persist(this.serialize()));
		}
		return undefined;
	}
}
