/**
 * 插件持久化（data.json）写入器。
 *
 * 写盘语义（原 main.ts 手写 commitData 串行链收口到通用原语）：
 * - 串行队列：所有写入排队执行，避免并发读-改-写互相覆盖；
 * - 写前重读合并：基于上一次写盘后的最新内容合并（{...current, ...data}），
 *   设置与视图状态等不同调用方合并写同一文件时不丢键；
 * - 错误回调优先、console.error 兜底：传入 onError 时调用方决定是否弹 Notice，
 *   未传入时静默吞错（保持 void 调用安全）。
 */
import { createSerialQueue } from './concurrency';

/** 宿主能力（Plugin.loadData/saveData 的最小形状） */
export interface PluginDataHost {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export interface PluginDataWriterOptions {
	/** 写盘失败回调（传 NotifyError 注入 i18n Notice） */
	onError?(error: unknown): void;
}

export class PluginDataWriter {
	private enqueue = createSerialQueue();

	constructor(
		private readonly host: PluginDataHost,
		private readonly options: PluginDataWriterOptions = {},
	) {}

	/** 合并写入：与当前 data.json 合并后落盘（入参键覆盖旧值，其余保留） */
	write(data: Record<string, unknown>): Promise<void> {
		return this.enqueue(async () => {
			try {
				const current = (await this.host.loadData()) as
					| Record<string, unknown>
					| null;
				await this.host.saveData({ ...(current ?? {}), ...data });
			} catch (error) {
				this.options.onError?.(error);
				if (!this.options.onError) {
					console.error('写入插件配置失败', error);
				}
			}
		});
	}
}
