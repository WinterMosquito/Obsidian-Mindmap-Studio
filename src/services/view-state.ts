/**
 * 视图状态存储：按文件路径保存布局与视口（缩放/平移）。
 *
 * 导图文件正文必须保持纯 Markdown，布局/视口不写入文件；
 * 状态存插件 data.json（顶层 `viewState` 键，path → 状态），
 * 与 settings 合并写入（保持历史顶层设置格式兼容）。
 *
 * 状态：
 * - layout: 布局类型（logicalStructure/mindMap/...）
 * - lineStyle: 连线样式偏好（auto/curve/direct/straight；auto＝随布局）
 * - palette: 配色（预设 id `default/mint/amber/wisteria/forest/slate`，或「自定义」
 *   写入的 `#rrggbb`；**按文件记**，由右键菜单「配色」切换——配色不是全局设置，
 *   见 `core/constants.PALETTE_OPTIONS` / `normalizePalettePreference`）
 * - themeStyle: 边框样式（default＝有边框 / borderless＝无边框；**按文件记**，由右缘
 *   竖栏「边框」开关切换——同样不是全局设置，见 `core/constants.THEME_STYLE_OPTIONS`）
 * - view: 引擎 view.getTransformData() 输出（{transform, state}）
 */
import { createDebouncer, type Debouncer } from '../core/concurrency';
import { VIEW_STATE_PERSIST_MS } from '../core/constants';

export type PathState = Record<string, unknown>;

/**
 * 按文件记的四项偏好键——既是 `viewState` 条目里的字段名，也是外观四项
 * （布局 / 连线 / 配色 / 边框）的键。命名与字段一一对应，勿再起别名。
 */
export type PreferenceKey = 'layout' | 'lineStyle' | 'palette' | 'themeStyle';

/** 视图按文件记忆的四项偏好（全部有全局默认值或内置默认值） */
export interface FilePreferences {
	layout: string;
	lineStyle: string;
	themeStyle: string;
	palette: string;
}

/**
 * 「按文件偏好 + 全局默认」的合成——**四个维度必须同时给默认值**（类型强制），
 * 视图与新建流程共用这一处。
 *
 * 为什么收成一个函数：四个维度各自在视图里写一遍 `getX(path) ?? 默认`，
 * 极易在某一维写成「硬编码默认」而不是「settings 默认」——2026-10-21 的
 * `themeStyle` 就犯过这个错（回落 `DEFAULT_THEME_STYLE` 而非
 * `settings.defaultThemeStyle`，导致「默认边框样式」对新建导图无效）。
 * 并排写在一处后，缺省值写错一眼可见，且由单测锁死。
 *
 * 纯函数、零依赖：`saved` 只收「该文件是否记过」，未记过（undefined）即用默认。
 */
export function resolveFilePreferences(input: {
	saved: Partial<FilePreferences>;
	defaults: FilePreferences;
}): FilePreferences {
	return {
		layout: input.saved.layout ?? input.defaults.layout,
		lineStyle: input.saved.lineStyle ?? input.defaults.lineStyle,
		themeStyle: input.saved.themeStyle ?? input.defaults.themeStyle,
		palette: input.saved.palette ?? input.defaults.palette,
	};
}

const VIEW_STATE_KEY = 'viewState';

/**
 * 保存的视口（`view` 字段）是否**可用**：`state` 必须是对象且 scale/x/y 为有限数。
 *
 * 依据（vendor `View.setTransformData` 实读）：`Object.keys(viewData.state)` 与
 * `this[prop] = viewData.state[prop]` 都没有守卫——
 * - `state` 缺失 / 非对象 ⇒ **抛 TypeError**，调用方落 catch 走 fit，而日志是
 *   「恢复视图状态失败」（排查方向是错的）；
 * - `state` 是对象但缺 scale/x/y ⇒ 不抛，引擎把任意字段写进视图、视口纹丝不动，
 *   之后「内容可见性」判定基于**当前默认视口**给结论（可能误判为「已在目标
 *   视口」而跳过居中）。
 * 两种形态都恢复不出视口 ⇒ 在 hydrate 处丢弃（**只丢该字段**：同一段条目的
 * layout / lineStyle 与视口无关，保留）。`transform` 缺失是安全的
 * （`{...undefined}` = `{}`），不参与判定。
 *
 * 比 `engine/mindmap.viewStateSignature` 更严：那个用 `Number()` 兼容手改的
 * 数字字符串（只为比较），这里决定「能不能交给引擎」，故要求真 number。
 */
function isUsableSavedView(view: unknown): boolean {
	if (!view || typeof view !== 'object') {
		return false;
	}
	const state = (view as { state?: unknown }).state;
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return false;
	}
	const s = state as { scale?: unknown; x?: unknown; y?: unknown };
	const isFiniteNumber = (value: unknown): boolean =>
		typeof value === 'number' && Number.isFinite(value);
	return isFiniteNumber(s.scale) && isFiniteNumber(s.x) && isFiniteNumber(s.y);
}

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
		debounceMs = VIEW_STATE_PERSIST_MS,
	) {
		this.debouncer = createDebouncer(debounceMs);
	}

	/**
	 * 从插件 data.json 载入视图状态。
	 *
	 * @param data 必须是**完整的 data.json 顶层对象**（{viewState, ...settings}），
	 *   不是 viewState 子对象——hydrate 内部从 data[VIEW_STATE_KEY] 提取视图状态。
	 *   误传子对象时函数静默不加载任何状态，这里加了类型提示和 console.warn 提醒。
	 */
	hydrate(data: unknown): void {
		this.map.clear();
		if (!data || typeof data !== 'object') {
			return;
		}
		const raw = (data as Record<string, unknown>)[VIEW_STATE_KEY];
		if (!raw || typeof raw !== 'object') {
			// 误传 viewState 子对象而非 data.json 顶层的防御提示
			if ('layout' in (data as Record<string, unknown>)) {
				console.warn(
					'ViewStateStore.hydrate 期望完整 data.json 对象，疑似收到 viewState 子对象',
				);
			}
			return;
		}
		for (const [path, state] of Object.entries(
			raw as Record<string, unknown>,
		)) {
			if (state && typeof state === 'object') {
				const s = state as Record<string, unknown>;
				// 形状校验：只接受含已知字段的视图状态，丢弃畸形/异常条目
				// （防手改 data.json、引擎升级后 view 结构变化等导致的坏数据渗入）。
				// `view` 另做**可用性**校验（见 isUsableSavedView）：不可恢复的形态
				// 只丢该字段，同条目的 layout / lineStyle 照样生效。
				if ('view' in s && !isUsableSavedView(s.view)) {
					delete s.view;
				}
				if (
					'layout' in s ||
					'lineStyle' in s ||
					'palette' in s ||
					'themeStyle' in s ||
					'view' in s
				) {
					this.map.set(path, s);
				}
			}
		}
	}

	/** 序列化视图状态（供写盘；也会随 settings 全量保存时一并带上） */
	serialize(): Record<string, PathState> {
		return Object.fromEntries(this.map);
	}

	/**
	 * 读取某项「按文件偏好」；未记过 / 非字符串一律 `undefined`（由视图回落默认）。
	 *
	 * 四项取值同构，故只留这一个实现；下面的具名 getter 只提供语义与注释，
	 * 不再各写一遍 `typeof === 'string'`（那是典型的「第四处忘了改」位置）。
	 */
	getPreference(path: string, key: PreferenceKey): string | undefined {
		const value = this.map.get(path)?.[key];
		return typeof value === 'string' ? value : undefined;
	}

	/** 写入某项「按文件偏好」（外观入口切换后调用；与 `view` 字段共用 `patch` 合并语义） */
	setPreference(path: string, key: PreferenceKey, value: string): void {
		this.patch(path, { [key]: value });
	}

	getLayout(path: string): string | undefined {
		return this.getPreference(path, 'layout');
	}

	setLayout(path: string, value: string): void {
		this.setPreference(path, 'layout', value);
	}

	/** 连线样式偏好（auto/curve/direct/straight；非法值由解析层回落布局默认） */
	getLineStyle(path: string): string | undefined {
		return this.getPreference(path, 'lineStyle');
	}

	setLineStyle(path: string, value: string): void {
		this.setPreference(path, 'lineStyle', value);
	}

	/** 配色（按文件）：右键菜单切换后写入，未设置时由视图回落 `DEFAULT_PALETTE` */
	getPalette(path: string): string | undefined {
		return this.getPreference(path, 'palette');
	}

	setPalette(path: string, value: string): void {
		this.setPreference(path, 'palette', value);
	}

	/**
	 * 边框样式（按文件）：右缘竖栏「边框」开关切换后写入。
	 *
	 * 未设置时返回 `undefined`（本模块**不做**回退）：缺省值由视图经
	 * `resolveFilePreferences` 取 `settings.defaultThemeStyle`——**别**在这里写死
	 * `DEFAULT_THEME_STYLE`：那会让「默认边框样式」设置对新建导图失效
	 * （2026-10-21 实机缺陷，见 `docs/agents/conventions.md` K127 ⑨）。
	 */
	getThemeStyle(path: string): string | undefined {
		return this.getPreference(path, 'themeStyle');
	}

	setThemeStyle(path: string, value: string): void {
		this.setPreference(path, 'themeStyle', value);
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

	/**
	 * 启动期清理：剔除指向**已不存在文件**的键，返回被剔除的路径。
	 *
	 * 为什么需要补这一步：运行期的 `onDelete` 只在插件存活期间生效，插件被
	 * 禁用/未启动时从库中删除（或移出）的文件，其键会永久残留并随 data.json
	 * 无界增长（实测库中出现过 2 个指向已删文件的键）。故只在**启动**补一次，
	 * 不与运行期事件处理重复。
	 *
	 * @param isExistingPath 路径是否仍指向库内文件——由调用方注入，
	 *   store 自身不引入 App 依赖（与 persist 注入同口径，便于直测）。
	 * @returns 被剔除的路径列表（空表示无残留）
	 */
	pruneMissingPaths(isExistingPath: (path: string) => boolean): string[] {
		const removed: string[] = [];
		for (const path of [...this.map.keys()]) {
			if (!isExistingPath(path)) {
				this.map.delete(path);
				removed.push(path);
			}
		}
		if (removed.length > 0) {
			this.schedulePersist();
		}
		return removed;
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
