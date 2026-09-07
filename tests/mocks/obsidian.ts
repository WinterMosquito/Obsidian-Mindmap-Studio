/**
 * obsidian 最小 mock：仅供 tests/ 在 Node 下回归纯逻辑。
 * 真实运行由 Obsidian 提供完整实现；这里只需要模块在加载时可链接
 * （ESM 具名导入会校验导出存在）、类可被 extends/instanceof。
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
/** 供 links-resolve 的 file:// 分支 instanceof 判定（getBasePath 由测试覆写） */
export class FileSystemAdapter {
	getBasePath(): string {
		return '/';
	}
}
export function normalizePath(p: unknown): string {
	return String(p).replace(/\\/g, '/');
}

/* ==== 以下桩仅为「模块图可加载 / 类可继承」（如 main.ts 全导入链的测试）：
   测试不实例化这些类的交互行为，方法按需补最小链式面 ==== */

export class TAbstractFile {}
export class MarkdownRenderChild {}
export class Modal {}
export class Component {}
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
