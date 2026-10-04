/**
 * 插件持久化（data.json）写入器。
 *
 * 写盘语义（原 main.ts 手写 commitData 串行链收口到通用原语）：
 * - 串行队列：所有写入排队执行，避免并发读-改-写互相覆盖；
 * - 写前重读合并：基于上一次写盘后的最新内容合并（{...current, ...data}），
 *   设置与视图状态等不同调用方合并写同一文件时不丢键；
 * - 错误回调优先、console.error 兜底：传入 onError 时**完全由它接管**（调用方
 *   决定是否弹 Notice），此时不再打 console 冗余噪音；**未传入 onError 时打
 *   `console.error`** 留痕（⚠ 此前本注释写「静默吞错」与实现不符，已修正；
 *   契约由 tests/persistence.test.ts 两条用例锁定：缺省仅 console.error /
 *   注入 onError 后 console.error 不介入）。两条路径下 write 自身都**不拒绝**，
 *   以保持调用方普遍使用的 `void writer.write(...)` 不产生未处理拒绝。
 */
import { createSerialQueue } from './concurrency';

/** 宿主能力（Plugin.loadData/saveData 的最小形状） */
export interface PluginDataHost {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export interface PluginDataWriterOptions {
	/**
	 * 写盘失败回调（传 NotifyError 注入 i18n Notice）。
	 *
	 * 声明为**函数类型属性**而非方法语法（2026-10-04 代码审查修正）：本回调被
	 * 取出后独立调用（先读入局部量再判空，避免同一可选属性读两次）。写成方法
	 * 语法 `onError?(error): void` 时 TS 隐含 `this: any`，只能靠 `this: void`
	 * 标注压制 `@typescript-eslint/unbound-method`——而那等于**关闭**该规则对
	 * 未来的保护。函数类型属性写法从类型层面就没有隐含 `this`，规则无需压制，
	 * 后续若传入未绑定的方法引用也能被拦下。现有唯一实现方传箭头函数
	 * （`main.ts` 的 `onError: (error) => notifyError(...)`），两种写法都兼容。
	 */
	onError?: (error: unknown) => void;
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
				// 两分支互斥：读一次存局部量，避免同一可选属性被读两次
				// （`options` 虽为 readonly，但重复读取让「谁兜底」的判据分散在两行）。
				const onError = this.options.onError;
				if (onError) {
					onError(error);
				} else {
					console.error('写入插件配置失败', error);
				}
			}
		});
	}
}
