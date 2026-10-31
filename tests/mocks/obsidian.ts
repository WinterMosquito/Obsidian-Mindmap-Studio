/**
 * obsidian 最小 mock：仅供 tests/ 在 Node 下回归纯逻辑。
 *
 * `obsidian` 包只发布类型声明、没有运行时 JS，所以 vitest.config.ts 把
 * `obsidian` alias 到本文件。这里的目标只有两个：
 *   1. 模块图能链接成功（ESM 具名导入会校验导出确实存在）；
 *   2. 被依赖的类能被 `extends` / `instanceof` / `new`。
 *
 * **交互行为不在这里实现**：各测试文件按需自建局部桩（不要把测试专用
 * 断言逻辑堆进本文件，它会污染其他测试的语义基线）。例外是**官方契约的
 * 最小语义**（`Keymap.isModEvent` / `setTooltip` 写入 aria-label）：生产代码
 * 经它们分流与落提示、多个套件共同依赖，故集中于此并按官方 d.ts 语义实现。
 */

export class App {}
export class TFile {}
/**
 * loadMathJax 桩：仅保证模块图可链接（platform/math-jax 具名导入）。
 * 真实语义（注入 MathJax 到主窗口）属交互行为，由各测试局部 vi.mock 覆写。
 */
export async function loadMathJax(): Promise<void> {}

/**
 * 官方 HTTP 原语替身（platform/math-jax-fonts 读字体用）：
 * 单测只测纯函数，预取路径不在覆盖面，故返回「空数组」即可（调用方会回退）。
 */
export async function requestUrl(
	_request: unknown,
): Promise<{ status: number; arrayBuffer: ArrayBuffer }> {
	return { status: 404, arrayBuffer: new ArrayBuffer(0) };
}
/**
 * loadPrism 桩：仅保证模块图可链接（platform/prism-code 具名导入）。
 * 真实语义（把 Prism 注入 window）属交互行为，由 prism-code.test.ts 局部
 * vi.mock + window.Prism 假件覆写。
 */
export async function loadPrism(): Promise<unknown> {
	return {};
}
export class TFolder {}
export class MarkdownView {}
export class WorkspaceLeaf {}
export class Plugin {}

export class PluginSettingTab {
	constructor(_app: unknown, _plugin: unknown) {}
}

export class Notice {
	constructor(_message?: string, _timeout?: number) {}
}

/** 供 links-resolve 的 file:// 分支做 instanceof 判定（getBasePath 由测试覆写） */
export class FileSystemAdapter {
	getBasePath(): string {
		return '/';
	}
}

/**
 * `normalizePath` 桩：**只做反斜杠→正斜杠**（刻意不实现去重复/首尾斜杠）。
 *
 * 为什么不照 d.ts 补全：生产代码会把 `app://` 形态的**资源地址**也交给官方
 * `normalizePath`（`links/file-lookup.lookupIndexedFile`、`links-resolve`），
 * 而真实实现的「去重复斜杠」会把它改成 `app:/…`。桩若照做，会改变这些调用点
 * 在用例里被观测到的实参——那是「桩的保真度」问题而不是产品行为问题，故留待
 * 调用点收敛（见本批待裁决项）后再一起对齐。依赖它的用例只断言两端都成立的
 * 形态（反斜杠、空串、类型回退）。
 */
export function normalizePath(p: unknown): string {
	return String(p).replace(/\\/g, '/');
}

/* ==== 以下桩仅为「模块图可加载 / 类可继承」而存在（如 main.ts 全导入链的测试）：
   测试不实例化这些类的交互行为，方法只补最小可用链式面 ==== */

export class TAbstractFile {}

/** Modal 桩：只保证 createModalSettle 的 setCloseCallback 可链式调用 */
export class Modal {
	private closeCallback: (() => unknown) | null = null;

	setCloseCallback(callback: () => unknown): this {
		this.closeCallback = callback;
		return this;
	}

	/** 供测试模拟用户关闭弹窗（真实实现由 Obsidian 提供） */
	close(): void {
		this.closeCallback?.();
	}
}

/**
 * Component 桩：只补「注册即记录」的最小面。
 *
 * 生产代码只用它做生命周期登记（`register` 收集清理回调、`registerEvent`
 * 登记官方事件），真实语义（卸载时按登记清理）由 Obsidian 提供；测试若需
 * 驱动卸载，直接取 `cleanups` 逐条调用即可，不在本文件实现调度。
 */
export class Component {
	/** 已登记的清理回调（测试可读；生产代码不读） */
	readonly cleanups: (() => void)[] = [];
	/** 已登记的官方事件（测试可读；生产代码不读） */
	readonly registeredEvents: unknown[] = [];

	register(cleanup: () => void): void {
		this.cleanups.push(cleanup);
	}

	registerEvent(eventRef: unknown): void {
		this.registeredEvents.push(eventRef);
	}
}

/**
 * MarkdownRenderChild 桩：`features/mindmap-codeblock` 的渲染子基类。
 *
 * 只保证「可继承 + 构造时接住 containerEl + register 可链路」——
 * 真实渲染（引擎挂载、观察器、DOM 装配）由 verify:visual 的
 * codeblock-embed 场景覆盖，Node 环境不虚拟 DOM。
 */
export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}

	onload(): void {}

	onunload(): void {}
}

/**
 * 最小 Scope 桩：记录注册项，供快捷键接线断言。
 *
 * 真实语义见官方 obsidian.d.ts：`register(modifiers, key, func)` 返回注册项；
 * `View.scope` 默认 null，须视图自行 `new Scope(app.scope)`（obsidian 1.5.7+）。
 */
export class Scope {
	readonly parent: unknown;
	readonly registered: {
		modifiers: unknown;
		key: unknown;
		handler: unknown;
	}[] = [];

	constructor(parent?: unknown) {
		this.parent = parent;
	}

	register(modifiers: unknown, key: unknown, handler: unknown): unknown {
		const entry = { modifiers, key, handler };
		this.registered.push(entry);
		return entry;
	}

	unregister(_handler: unknown): void {}
}

export class FileView {
	leaf: unknown;
	file: unknown = null;

	constructor(leaf?: unknown) {
		this.leaf = leaf;
	}

	/**
	 * 官方契约最小语义（obsidian.d.ts `FileView.getState()`）：视图状态只携带
	 * 当前文件路径。实机读出（2026-10-15）的官方实现为
	 * `{...View.getState()（恒 {}）, file}`——**自定义 state 字段不会自动保留**，
	 * 视图须自行覆写 getState() 带回（如 MindMapView 的 mdBackMode）。
	 * `MindMapView.getState` 的 super 调用链与读回断言依赖这一步。
	 */
	getState(): Record<string, unknown> {
		const file = this.file as { path?: unknown } | null;
		return typeof file?.path === 'string' ? { file: file.path } : {};
	}

	/**
	 * 官方契约最小语义（obsidian.d.ts `FileView.setState(state, result)`）：
	 * 接收传入 state 并落 `file`（真实实现随后经 `loadFile` 触发
	 * `onLoadFile`，属交互行为不在 mock 面）。`MindMapView.setState` 覆写的
	 * super 调用链与「读入点」断言依赖这一步。
	 */
	async setState(state: unknown, _result?: unknown): Promise<void> {
		const path = (state as { file?: unknown } | null)?.file;
		if (typeof path === 'string') {
			this.file = { path };
		}
	}
}

export class Menu {
	/** 是否已被关闭（`ui/menu-submenu.showExclusiveMenu` 会关掉同宿主上一个菜单） */
	hidden = false;
	hideCallbacks: (() => unknown)[] = [];

	addItem(_cb: unknown): Menu {
		return this;
	}

	addSeparator(): Menu {
		return this;
	}

	showAtPosition(_pos: unknown): Menu {
		return this;
	}

	hide(): Menu {
		this.hidden = true;
		this.hideCallbacks.forEach((cb) => cb());
		return this;
	}

	onHide(cb: () => unknown): void {
		this.hideCallbacks.push(cb);
	}
}

export class ButtonComponent {
	setButtonText(_t: string): ButtonComponent {
		return this;
	}

	onClick(_cb: unknown): ButtonComponent {
		return this;
	}

	setCta(): ButtonComponent {
		return this;
	}

	/** 官方组件级 tooltip（modal-image 经它落提示；本桩不记录调用） */
	setTooltip(_tooltip: string): ButtonComponent {
		return this;
	}
}

export class AbstractInputSuggest {
	constructor(_app: unknown, _inputEl: unknown) {}
}

export class Workspace {}

export const Platform = {
	isDesktopApp: true,
	isMobile: false,
	isIosApp: false,
	isAndroidApp: false,
	/** 平台判定参与「拖入修饰键」分派（mac 用 Option、其余用 Ctrl），测试按 win/linux 基线 */
	isMacOS: false,
	isWin: true,
	isLinux: false,
};

export function setIcon(_parent: unknown, _iconId: string): void {}

/**
 * setTooltip 桩：官方行为的最小面——写 `aria-label`（Obsidian 原生 tooltip
 * 由它驱动）。工具栏按钮与丝带提示的无障碍断言依赖这一步写入；
 * 位置/延迟等展示行为不在 mock 范围。
 */
export function setTooltip(
	el: HTMLElement,
	tooltip: string,
	options?: { placement?: 'top' | 'bottom' | 'left' | 'right' },
): void {
	el.setAttribute('aria-label', tooltip);
	// 官方按**本次调用**决定展示位置（省略＝默认下方）：不传就清掉旧值。
	// 不清的话，「状态回写时漏传 placement」在测试里测不出来——2026-10-26
	// 工具栏的 `syncState` 正是这么漏的（切换一次后提示从左侧跳到下方）。
	if (options?.placement) {
		el.setAttribute('data-tooltip-position', options.placement);
	} else if (typeof el.removeAttribute === 'function') {
		el.removeAttribute('data-tooltip-position');
	}
}

/**
 * Keymap 桩：实现官方 `Keymap.isModEvent` 的**文档语义**（修饰键表）——
 * view-wikilink 经它分流链接落点，测试需要与生产同一条官方口径；
 * 与 Platform / Scope / Modal 桩同理，只补被生产代码消费的最小面。
 * 官方 d.ts：'tab' if Cmd/Ctrl（或中键）、'split' if Cmd/Ctrl+Alt、
 * 'window' if Cmd/Ctrl+Alt+Shift，否则 false。
 */
export class Keymap {
	static isModEvent(
		evt?: {
			ctrlKey?: boolean;
			metaKey?: boolean;
			altKey?: boolean;
			shiftKey?: boolean;
			button?: number;
		} | null,
	): 'tab' | 'split' | 'window' | false {
		if (!evt) {
			return false;
		}
		if (evt.ctrlKey === true || evt.metaKey === true) {
			return evt.altKey === true
				? evt.shiftKey === true
					? 'window'
					: 'split'
				: 'tab';
		}
		return evt.button === 1 ? 'tab' : false;
	}
}
