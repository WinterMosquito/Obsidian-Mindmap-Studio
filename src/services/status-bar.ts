/**
 * 状态栏服务：节点计数 + 保存状态的展示与清空（DOM 所有权归插件层）。
 *
 * 此前 view-status / view 直接操作 plugin.statusBarEl.setText——状态栏 DOM
 * 的读写散落在视图侧多处；收敛为服务后视图只广播计数/保存状态，文本格式化
 * （i18n）与元素生命周期（onunload 置空）都由插件层负责。
 *
 * **保存状态是常驻的**（2026-11-04）：写盘失败 / 自动保存挂起此前只有一次性
 * Notice，用户关掉提示后没有任何「未保存」线索；现在状态栏同时承载
 * `保存中… / 已保存 / 未保存`，失败态一直留到下一次成功写入。
 */
import { t, type Language, type TranslationKey } from '../core/i18n';

/**
 * 保存状态：
 * - `idle`：没有进行中的写盘、也没有失败（新加载 / 已清空）——不计入文案；
 * - `saving`：已排程或正在写盘；
 * - `saved`：最近一轮排空成功（含「无差异跳过」）；
 * - `unsaved`：写盘失败——常驻到下一次成功。
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'unsaved';

/** 状态文案键（`idle` 不显示，故不在表内） */
const SAVE_STATE_KEYS: Record<Exclude<SaveState, 'idle'>, TranslationKey> = {
	saving: 'common.saveSaving',
	saved: 'common.saveSaved',
	unsaved: 'common.saveUnsaved',
};

/** 计数与状态之间的分隔符（中英文共用；两侧各一个空格） */
const STATUS_SEPARATOR = ' · ';

/** 状态栏服务契约：节点计数 / 保存状态展示与清空 */
export interface StatusBarService {
	/** 状态栏元素是否可用（插件未启用状态栏/onunload 后为 false） */
	readonly available: boolean;
	/** 显示节点计数（"12 nodes"，按当前语言格式化） */
	showNodeCount(count: number): void;
	/** 显示保存状态（与计数组合成一行；`idle` 等于不显示状态段） */
	showSaveState(state: SaveState): void;
	/** 清空状态栏文本并复位内部状态（视图关闭/切换到非导图视图） */
	clear(): void;
}

/**
 * 插件层默认实现：元素与语言均经惰性取值器获取——onload 时序上状态栏元素晚于
 * 服务字段创建，onunload 后元素被置空，两种情况下的调用都静默跳过（不抛错、
 * 不残留文本）。
 *
 * 内部持有 `count` / `state` 两个字段再统一渲染：调用方可以只更新其中一个
 * （例如 data_change 只刷新计数、写盘回调只刷新状态），另一段不会丢。
 */
export class ElementStatusBarService implements StatusBarService {
	/** 最近一次展示的节点数（null = 尚未计数） */
	private count: number | null = null;
	/** 当前保存状态（idle = 不显示状态段） */
	private state: SaveState = 'idle';
	/**
	 * 上一次渲染时用的语言：语言切换后即使 count / state 都没变，也必须
	 * 重写一次文案（调用方只会继续推同一个计数，不会另发「语言变了」事件）。
	 */
	private renderedLang: Language | null = null;

	constructor(
		private readonly getElement: () => HTMLElement | null,
		private readonly getLanguage: () => Language,
	) {}

	get available(): boolean {
		return this.getElement() !== null;
	}

	showNodeCount(count: number): void {
		if (this.count === count && this.renderedLang === this.getLanguage()) {
			return;
		}
		this.count = count;
		this.render();
	}

	showSaveState(state: SaveState): void {
		if (this.state === state && this.renderedLang === this.getLanguage()) {
			return;
		}
		this.state = state;
		this.render();
	}

	clear(): void {
		this.count = null;
		this.state = 'idle';
		this.renderedLang = null;
		this.getElement()?.setText('');
	}

	/** 唯一渲染点：`<N 个节点>[ · <保存状态>]`（`idle` 时只剩计数） */
	private render(): void {
		const el = this.getElement();
		if (!el) {
			return;
		}
		const lang = this.getLanguage();
		const parts: string[] = [];
		if (this.count !== null) {
			// 单复数分键：英文 "1 node" / "3 nodes"（中文两键同文）
			const key = this.count === 1 ? 'common.nodeOne' : 'common.nodeMany';
			parts.push(`${this.count} ${t(lang, key)}`);
		}
		if (this.state !== 'idle') {
			parts.push(t(lang, SAVE_STATE_KEYS[this.state]));
		}
		el.setText(parts.join(STATUS_SEPARATOR));
		this.renderedLang = lang;
	}
}
