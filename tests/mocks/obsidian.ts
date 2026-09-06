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
export function normalizePath(p: unknown): string {
	return String(p).replace(/\\/g, '/');
}
