/** Markdown 标题栏快捷入口：官方 addAction，按视图归属去重并随组件卸载清理。 */
import { MarkdownView, setTooltip } from 'obsidian';
import type { Component, Workspace } from 'obsidian';
import { CORE_VIEW_TYPE } from '../../core/constants';
import { t, type Language } from '../../core/i18n';
import { openAsMindMap } from '../../markdown/md-open';

export class MarkdownMindMapAction {
	private readonly actions = new Map<MarkdownView, HTMLElement>();
	private disposed = false;
	private pending = false;

	constructor(
		private readonly workspace: Workspace,
		private readonly language: () => Language,
	) {}

	register(host: Component): void {
		host.register(() => this.dispose());
		host.registerEvent(this.workspace.on('file-open', () => this.scheduleRefresh()));
		host.registerEvent(this.workspace.on('active-leaf-change', () => this.scheduleRefresh()));
		host.registerEvent(this.workspace.on('layout-change', () => this.scheduleRefresh()));
		this.workspace.onLayoutReady(() => this.refresh());
	}

	private scheduleRefresh(): void {
		if (this.pending || this.disposed) return;
		this.pending = true;
		queueMicrotask(() => {
			this.pending = false;
			this.refresh();
		});
	}

	refresh(): void {
		if (this.disposed) return;
		const current = new Set<MarkdownView>();
		for (const leaf of this.workspace.getLeavesOfType(CORE_VIEW_TYPE.MARKDOWN)) {
			const view = leaf.view;
			// MarkdownView 的标题栏可能先于 file 绑定，动作在点击时再读当前文件。
			if (!(view instanceof MarkdownView) || (view.file && view.file.extension !== 'md')) continue;
			current.add(view);
			let action = this.actions.get(view);
			if (action && !action.isConnected) {
				action.remove();
				this.actions.delete(view);
				action = undefined;
			}
			if (!action) {
				action = view.addAction('network', t(this.language(), 'command.openAsMindMap'), () => {
					// 点击时读取此视图的当前文件，分屏时不使用全局活动文件。
					const file = view.file;
					if (!this.disposed && file?.extension === 'md') void openAsMindMap(view.leaf, file);
				});
				action.addClass('mindmap-open-action');
				this.actions.set(view, action);
			}
			setTooltip(action, t(this.language(), 'command.openAsMindMap'));
		}
		for (const [view, action] of this.actions) {
			if (current.has(view)) continue;
			action.remove();
			this.actions.delete(view);
		}
	}

	private dispose(): void {
		this.disposed = true;
		for (const action of this.actions.values()) action.remove();
		this.actions.clear();
	}
}
