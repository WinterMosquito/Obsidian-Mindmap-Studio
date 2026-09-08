/**
 * 「以思维导图打开」偏好恢复器。从 main.ts 拆出
 * （原 active-leaf-change / file-open 注册与 restoreOpenAsPreferences）。
 *
 * 打开方式记忆（viewState.openAs = 'mindmap'）在两种场景会失效，本模块补齐：
 * 1. 运行期：偏好为 mindmap 的 .mindmap.md 以 markdown 视图被激活时自动切回
 *    导图视图。用 active-leaf-change（携带已激活 leaf）判定而非 file-open
 *    （后者时序上活动视图可能尚未切换为 markdown，会漏判）；file-open 保留
 *    为互补兜底。
 * 2. 启动期：工作区恢复（重启）时 active-leaf-change 对初始叶子可能不触发、
 *    或触发瞬间 file 尚未就位——scheduleStartupRestore 以多档延时扫描恢复，
 *    早/中/晚各试一次，恢复流程结束后即固定为导图视图；否则重启后文件会以
 *    Markdown 打开，且布局（仅在导图视图加载时按路径读取）不会被应用。
 */
import type {
	App,
	Component,
	Workspace,
	WorkspaceLeaf,
} from 'obsidian';
import { MarkdownView } from 'obsidian';
import { CORE_VIEW_TYPE } from './constants';
import { isMindMapMarkdownFile, openAsMindMap } from './md-open';

/** openAs 偏好查询契约（视图状态存储） */
export interface OpenAsLookup {
	getOpenAs(path: string): 'mindmap' | 'markdown' | undefined;
}

export class OpenAsPreferenceRestorer {
	/** 宿主组件（register 时注入）：启动恢复定时器随其注销清理 */
	private host: Component | null = null;

	constructor(
		private readonly app: App,
		private readonly workspace: Workspace,
		private readonly openAs: OpenAsLookup,
		/** 是否为本插件的导图视图（注入 MindMapView 类引用判定，避免本模块依赖视图实现） */
		private readonly isOwnView: (view: unknown) => boolean,
	) {}

	/** 注册运行期自动切换事件（插件 onload 调用；事件随 Component 清理） */
	register(component: Component): void {
		this.host = component;
		// 运行期兜底：任何文件打开时，若它是偏好为思维导图的 .mindmap.md 且
		// 当前在 markdown 视图，也切回导图视图（与 active-leaf-change 互补）。
		component.registerEvent(
			this.workspace.on('file-open', () => this.restoreMarkdownLeaves()),
		);
		component.registerEvent(
			this.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf || this.isOwnView(leaf.view)) {
					return; // 已是导图视图（含在导图标签内切换文件）
				}
				this.autoSwitch(leaf);
			}),
		);
	}

	/**
	 * 启动/布局就绪后多档延时恢复：Obsidian 恢复叶子是异步的，可能先建
	 * markdown 视图、稍后才绑定文件，且切换到导图视图后还可能被尚未结束的
	 * 恢复流程短暂覆盖。故多档延时扫描——早/中/晚各试一次。
	 */
	scheduleStartupRestore(delaysMs: readonly number[] = [400, 1500, 3500]): void {
		delaysMs.forEach((ms) => {
			const id = window.setTimeout(() => this.restoreMarkdownLeaves(), ms);
			// 插件卸载后不得再扫描/切换视图：随宿主组件注销清理未触发的定时器
			this.host?.register(() => window.clearTimeout(id));
		});
	}

	/** 扫描全部 markdown 叶子，把偏好为 mindmap 的 .mindmap.md 切回导图视图 */
	private restoreMarkdownLeaves(): void {
		const markdownLeaves = this.workspace.getLeavesOfType(
			CORE_VIEW_TYPE.MARKDOWN,
		);
		for (const leaf of markdownLeaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}
			const file = view.file;
			if (!file || !isMindMapMarkdownFile(file)) {
				continue;
			}
			if (this.openAs.getOpenAs(file.path) !== 'mindmap') {
				continue;
			}
			void openAsMindMap(leaf, file).catch((error) =>
				console.error('自动切换思维导图视图失败:', file.path, error),
			);
		}
	}

	private autoSwitch(leaf: WorkspaceLeaf): void {
		const markdownView = leaf.view;
		if (!(markdownView instanceof MarkdownView)) {
			return;
		}
		const file = markdownView.file;
		if (!file || !isMindMapMarkdownFile(file)) {
			return;
		}
		if (this.openAs.getOpenAs(file.path) !== 'mindmap') {
			return;
		}
		void openAsMindMap(leaf, file);
	}
}
