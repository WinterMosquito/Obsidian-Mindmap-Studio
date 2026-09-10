/**
 * obsidian 最小 mock：仅供 tests/ 在 Node 下回归纯逻辑。
 *
 * `obsidian` 包只发布类型声明、没有运行时 JS，所以 vitest.config.ts 把
 * `obsidian` alias 到本文件。这里的目标只有两个：
 *   1. 模块图能链接成功（ESM 具名导入会校验导出确实存在）；
 *   2. 被依赖的类能被 `extends` / `instanceof` / `new`。
 *
 * **交互行为不在这里实现**：各测试文件按需自建局部桩（不要把测试专用
 * 断言逻辑堆进本文件，它会污染其他测试的语义基线）。
 */

export class App {}
export class TFile {}
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

export function normalizePath(p: unknown): string {
	return String(p).replace(/\\/g, '/');
}

/* ==== 以下桩仅为「模块图可加载 / 类可继承」而存在（如 main.ts 全导入链的测试）：
   测试不实例化这些类的交互行为，方法只补最小可用链式面 ==== */

export class TAbstractFile {}
export class MarkdownRenderChild {}

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

export class Component {}

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

	constructor(leaf?: unknown) {
		this.leaf = leaf;
	}
}

export class Menu {
	addItem(_cb: unknown): Menu {
		return this;
	}

	addSeparator(): Menu {
		return this;
	}

	showAtPosition(_pos: unknown): void {}
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
};

export function setIcon(_parent: unknown, _iconId: string): void {}
