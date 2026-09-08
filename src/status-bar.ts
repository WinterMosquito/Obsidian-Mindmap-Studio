/**
 * 状态栏服务：节点计数的展示与清空（DOM 所有权归插件层）。
 *
 * 此前 view-status / view 直接操作 plugin.statusBarEl.setText——状态栏 DOM
 * 的读写散落在视图侧多处；收敛为服务后视图只广播计数/清空请求，
 * 文本格式化（i18n）与元素生命周期（onunload 置空）都由插件层负责。
 */
import { t, type Language } from './i18n';

/** 状态栏服务契约：节点计数展示与清空 */
export interface StatusBarService {
	/** 状态栏元素是否可用（插件未启用状态栏/onunload 后为 false） */
	readonly available: boolean;
	/** 显示节点计数（"12 nodes"，按当前语言格式化） */
	showNodeCount(count: number): void;
	/** 清空状态栏文本（视图关闭/切换到非导图视图） */
	clear(): void;
}

/**
 * 插件层默认实现：元素与语言均经惰性取值器获取——
 * onload 时序上状态栏元素晚于服务字段创建，onunload 后元素被置空，
 * 两种情况下的调用都静默跳过（不抛错、不残留文本）。
 */
export class ElementStatusBarService implements StatusBarService {
	constructor(
		private readonly getElement: () => HTMLElement | null,
		private readonly getLanguage: () => Language,
	) {}

	get available(): boolean {
		return this.getElement() !== null;
	}

	showNodeCount(count: number): void {
		const el = this.getElement();
		if (!el) {
			return;
		}
		// 单复数分键：英文 "1 node" / "3 nodes"（中文两键同文）
		const key = count === 1 ? 'common.nodeOne' : 'common.nodeMany';
		el.setText(`${count} ${t(this.getLanguage(), key)}`);
	}

	clear(): void {
		this.getElement()?.setText('');
	}
}
