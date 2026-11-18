/**
 * K215：主窗口右侧缩略图承载。只暂借一枚右侧 Outline 的公开 ItemView 容器，
 * 不替换其 ViewState、不访问核心插件渲染器。唯一非公开契约为 view type `outline`；
 * 类型/容器/所属窗口不符时跳过，缺失时使用插件自己的 ItemView。
 *
 * scoped CSS 隐藏原内容（包含刷新后新增子项与导航控件），释放立即恢复。
 * 主内容来源由组合根注入；sidebar 获焦仍按 getMostRecentLeaf(rootSplit) 跟随。
 * popout 无官方同窗口右侧栏 API，保留该窗口原浮层，不借用主窗口 Outline。
 */
import { ItemView, type Plugin, type WorkspaceLeaf, type WorkspaceItem } from 'obsidian';
import { t, type Language } from '../../core/i18n';
import { createWarnOnce } from '../../core/errors';

const VIEW_TYPE = 'mindmap-studio-minimap';

export interface SidebarMiniMapSource {
	/** 引擎会话身份：同文件不同视图与重建都必须重新绑定。 */
	key: object;
	mount: (container: HTMLElement) => (() => void) | null;
	refresh: () => void;
}

interface MountedSource {
	key: object;
	leaf: WorkspaceLeaf;
	content: HTMLElement;
	container: HTMLElement;
	host: HTMLElement;
	release: () => void;
}

/** 沿官方 parent 判侧栏归属；异常环/根节点自指时安全拒绝。 */
function belongsTo(leaf: WorkspaceLeaf, root: WorkspaceItem): boolean {
	const seen = new Set<WorkspaceItem>();
	let item: WorkspaceItem | undefined = leaf;
	while (item && !seen.has(item)) {
		if (item === root) { return true; }
		seen.add(item);
		item = item.parent;
	}
	return false;
}

class MiniMapSidebarView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private readonly language: () => Language) {
		super(leaf);
		this.navigation = false;
	}
	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return t(this.language(), 'minimap.title'); }
	override getIcon(): string { return 'map'; }
}

/** 插件生命周期拥有的单点协调器。DOM 仅在来源/承载发生变化时迁移。 */
export class MiniMapSidebar {
	private mounted: MountedSource | null = null;
	private fallback: WorkspaceLeaf | null = null;
	private pendingFallback: Promise<void> | null = null;
	private disposed = false;
	private readonly warn = createWarnOnce();

	constructor(
		private readonly plugin: Plugin,
		private readonly sourceFor: (leaf: WorkspaceLeaf) => SidebarMiniMapSource | null,
		language: () => Language,
	) {
		plugin.registerView(VIEW_TYPE, (leaf) => new MiniMapSidebarView(leaf, language));
		const workspace = plugin.app.workspace;
		plugin.registerEvent(workspace.on('active-leaf-change', () => this.refresh()));
		plugin.registerEvent(workspace.on('layout-change', () => this.refresh()));
		plugin.register(() => this.dispose());
		workspace.onLayoutReady(() => this.refresh());
	}

	refresh(): void {
		if (this.disposed) { return; }
		const workspace = this.plugin.app.workspace;
		const recent = workspace.getMostRecentLeaf(workspace.rootSplit);
		const source = recent ? this.sourceFor(recent) : null;
		if (!source) {
			this.release();
			this.closeFallback();
			return;
		}
		if (workspace.rightSplit.collapsed) { this.release(); return; }
		const outline = workspace.getLeavesOfType('outline').find((leaf) =>
			belongsTo(leaf, workspace.rightSplit)
			&& leaf.getContainer() === workspace.rootSplit
			&& leaf.view instanceof ItemView,
		);
		const leaf = outline ?? workspace.getLeavesOfType(VIEW_TYPE).find((candidate) =>
			belongsTo(candidate, workspace.rightSplit)
			&& candidate.getContainer() === workspace.rootSplit,
		);
		if (!leaf) {
			this.release();
			this.ensureFallback();
			return;
		}
		const view = leaf.view;
		if (!(view instanceof ItemView)) { this.release(); return; }
		if (this.mounted?.key === source.key && this.mounted.leaf === leaf
			&& this.mounted.content === view.contentEl && this.mounted.host.parentElement === view.contentEl) {
			source.refresh();
			return;
		}
		this.release();
		const host = view.contentEl.createDiv('mindmap-sidebar-mount');
		view.containerEl.addClass('mindmap-outline-host');
		view.contentEl.addClass('mindmap-outline-content');
		const release = source.mount(host);
		if (!release) {
			host.remove();
			view.containerEl.removeClass('mindmap-outline-host');
			view.contentEl.removeClass('mindmap-outline-content');
			return;
		}
		this.mounted = { key: source.key, leaf, content: view.contentEl, container: view.containerEl, host, release };
		if (outline) { this.closeFallback(); }
	}

	private ensureFallback(): void {
		if (this.pendingFallback || this.disposed) { return; }
		this.pendingFallback = this.plugin.app.workspace.ensureSideLeaf(VIEW_TYPE, 'right', {
			active: false, reveal: false,
		}).then((leaf) => {
			this.fallback = leaf;
			if (this.disposed) { this.closeFallback(); }
		}).catch((error: unknown) => {
			this.warn('Cannot open mind map sidebar', error);
		}).finally(() => {
			this.pendingFallback = null;
			if (!this.disposed && this.fallback) { this.refresh(); }
		});
	}

	private release(): void {
		const mounted = this.mounted;
		this.mounted = null;
		if (!mounted) { return; }
		mounted.release();
		mounted.host.remove();
		mounted.content.removeClass('mindmap-outline-content');
		mounted.container.removeClass('mindmap-outline-host');
	}

	private closeFallback(): void {
		const fallback = this.fallback;
		this.fallback = null;
		if (fallback?.view.getViewType() === VIEW_TYPE) { fallback.detach(); }
	}

	private dispose(): void {
		this.disposed = true;
		this.release();
		this.closeFallback();
	}
}
