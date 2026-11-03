/**
 * 声明驱动自动打开：frontmatter 声明为导图（`Mindmap: Mindmap`）的文件，
 * 每当它以 markdown 视图出现，就自动切到本插件的导图视图。
 *
 * 本模块只管**时机**，判据由组合根注入（`isDeclaredMindMapFile`，唯一实现在
 * markdown/md-open 的 isMindMapFile）。为什么需要这块时序逻辑：
 * 1. 运行期：双击/链接打开按 Obsidian 默认先落在 markdown 视图，需再切一次。
 *    用 active-leaf-change（携带已激活 leaf）判定而非 file-open（后者时序上活动
 *    视图可能尚未切换为 markdown，会漏判）；file-open 保留为互补兜底。
 *    属性**就地改动**（用户在属性面板加上 `Mindmap: Mindmap`）由组合根监听
 *    `metadataCache.on('changed')` 后调 activateDeclaredLeaves() 补判。
 * 2. 启动期：工作区恢复（重启）时 active-leaf-change 对初始叶子可能不触发、或
 *    触发瞬间 file 尚未就位——scheduleStartupRestore 以多档延时扫描恢复。
 *
 * 不再需要「打开方式偏好」：打开方式由文件属性承载（「以 Markdown 打开」= 把
 * 属性改写为 `Markdown`，见 markdown/md-open），没有第二份状态可失配。
 */
import type { Component, TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { AUTO_OPEN_SCAN_DEBOUNCE_MS, CORE_VIEW_TYPE } from '../core/constants';
import { createDebouncer, type Debouncer } from '../core/concurrency';
import { openAsMindMap } from '../markdown/md-open';

/**
 * `file-open` 未命中叶子时的重试延时（ms）。
 *
 * 一帧的量级：`file-open` 可能早于视图绑定文件，下一轮事件循环通常已就位。
 * 取 `setTimeout` 而非 `requestAnimationFrame`——窗口不可见（最小化 / 被遮挡）时
 * rAF 不执行，而启动恢复恰恰可能发生在这种状态下（与 AGENTS「引擎初始化排
 * rAF」同一坑）。
 */
const FILE_OPEN_RETRY_DELAY_MS = 16;

export class MindMapAutoOpener {
	/** 宿主组件（register 时注入）：启动恢复定时器随其注销清理 */
	private host: Component | null = null;
	/**
	 * 全量扫描的防抖器（`core/concurrency` 的既有调度原语；卸载时取消，见 `register`）。
	 * 用原语而非手写 `setTimeout`：窗口语义（重置 / 取消 / 幂等）与其它调度点同源。
	 */
	private readonly scanDebouncer: Debouncer = createDebouncer(
		AUTO_OPEN_SCAN_DEBOUNCE_MS,
	);

	constructor(
		private readonly workspace: Workspace,
		/** 声明判据（注入以避免本模块依赖 App 与 markdown 层实现细节） */
		private readonly isDeclared: (file: TFile) => boolean,
		/** 是否为本插件的导图视图（注入 MindMapView 类引用判定，避免本模块依赖视图实现） */
		private readonly isOwnView: (view: unknown) => boolean,
	) {}

	/** 注册运行期自动切换事件（插件 onload 调用；事件随 Component 清理） */
	register(component: Component): void {
		this.host = component;
		// 卸载清理：未决的扫描不再触发（`cancel` 幂等，与启动档位定时器同款收尾）
		component.register(() => this.scanDebouncer.cancel());
		// 运行期兜底：任何文件打开时，若它是声明为导图且当前在 markdown 视图，
		// 也切到导图视图（与 active-leaf-change 互补）。
		// **防抖触发**：启动恢复逐叶开文件、批量开标签会连发多次 file-open，而每次
		// 全量扫描都要遍历全部 markdown 叶子 + 逐叶读 frontmatter 判据（metadataCache
		// 查询）——整个突发扫一次即可（见 scheduleDeclaredLeavesScan）。
		component.registerEvent(
			this.workspace.on('file-open', (file) => {
				// 先按**这个文件**立即切一次（不防抖）：启动恢复时叶子一绑定文件
				// 就切走，不必等 400ms 档位——期间 markdown 已经画满屏，正是用户
				// 看到的「先闪一屏原文再变导图」（2026-11-03）。
				if (file) {
					this.switchFileNow(file);
				}
				// 兜底全量扫描（`active-leaf-change` 漏判、叶子尚未绑定文件等情况）
				this.scheduleDeclaredLeavesScan();
			}),
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
	 *
	 * **首档取 0ms**（2026-11-03）：Obsidian 通常是先恢复完工作区、再加载社区
	 * 插件，此时叶子**早已就绪**——原先首档 400ms 意味着启动后满屏 Markdown
	 * 原文停留 400ms 才切成导图（实测：启用插件到视图切换 436ms，正是这一档）。
	 * 立即试一次不成（重启早期叶子尚未绑定文件）仍有 400/1500/3500 兜底，
	 * 多扫一次的代价只是几个 `instanceof`。
	 */
	scheduleStartupRestore(
		delaysMs: readonly number[] = [0, 400, 1500, 3500],
	): void {
		delaysMs.forEach((ms) => {
			const id = window.setTimeout(() => this.activateDeclaredLeaves(), ms);
			// 插件卸载后不得再扫描/切换视图：随宿主组件注销清理未触发的定时器
			this.host?.register(() => window.clearTimeout(id));
		});
	}

	/**
	 * 全量扫描的**防抖**入口（`file-open` 与 `metadataCache.changed` 的共同入口）。
	 *
	 * 语义（`createDebouncer`）：窗口内的后续触发**重置**计时，突发结束后
	 * `AUTO_OPEN_SCAN_DEBOUNCE_MS` 落地一次。为什么不用「首次触发即计时」的节流：
	 * 启动恢复 / 批量同步会在数百毫秒内连发几十次事件，节流会按窗口数各扫一遍
	 *（每次全量扫描 = 全部 markdown 叶子 × frontmatter 判据读取），防抖则
	 * **整个突发只扫一次**；而单次打开文件两者都是「一窗口后落地」，用户感知一致。
	 *
	 * 已知边界（2026-10-15 登记，未改行为）：防抖只有「重置」而无**最长等待**，
	 * 若事件以小于窗口的间隔**持续**到达（极大批量同步），兜底扫描会被无限推迟。
	 * 用户可感的主路径不受影响（`active-leaf-change → autoSwitch` 不防抖）。
	 * 要彻底消除该饥饿需给共享原语 `createDebouncer` 加 maxWait（另议，不属本轮）。
	 *
	 * 与 `scheduleStartupRestore` 的分工：启动档位（400/1500/3500ms）要的是「早/中/晚
	 * 各试一次」的**固定节奏**，故仍直调 `activateDeclaredLeaves`；本方法只服务突发型
	 * 触发。两者共用同一个扫描实现，不产生第二份判定。
	 */
	scheduleDeclaredLeavesScan(): void {
		this.scanDebouncer.schedule(() => this.activateDeclaredLeaves());
	}

	/**
	 * 扫描全部 markdown 叶子，把声明为导图的文件切到导图视图。
	 * 组合根在 `metadataCache.on('changed')` 里调用（属性被就地加上时补判）。
	 */
	activateDeclaredLeaves(): void {
		const markdownLeaves = this.workspace.getLeavesOfType(
			CORE_VIEW_TYPE.MARKDOWN,
		);
		for (const leaf of markdownLeaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}
			const file = view.file;
			if (!file || !this.isDeclared(file)) {
				continue;
			}
			this.switchToMindMap(leaf, file);
		}
	}

	/**
	 * `file-open` 的**立即**入口：只切刚打开的这个文件所在的 markdown 叶子。
	 *
	 * 与 `activateDeclaredLeaves` 的差异只有范围与时机（不全量遍历、不防抖）：
	 * 启动恢复的每个叶子都会走一次 `file-open`，这里就地切走等于把「markdown
	 * 画满屏等 400ms 档位」压到「画之前就切完」。判据仍只有注入的 `isDeclared`
	 * 一份，`openAsMindMap` 里的并发去重保证不会与 `active-leaf-change` 抢着切。
	 */
	private switchFileNow(file: TFile, retried = false): void {
		if (!this.isDeclared(file)) {
			return;
		}
		let matched = false;
		for (const leaf of this.workspace.getLeavesOfType(CORE_VIEW_TYPE.MARKDOWN)) {
			const view = leaf.view;
			// 启动早期叶子可能刚建、尚未绑定文件：按 `view.file` 精确匹配，
			// 绑不上就交给重试与全量扫描（不猜、不扫别的叶子）
			if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
				continue;
			}
			matched = true;
			this.switchToMindMap(leaf, file);
		}
		if (matched || retried) {
			return;
		}
		// `file-open` 早于叶子绑定文件（启动恢复的常见顺序）：下一轮事件循环
		// 再试一次——通常那时 `view.file` 已经就位。仍不成则有 400ms 起的档位
		// 兜底，故只重试一次、不排链。
		const timer = window.setTimeout(
			() => this.switchFileNow(file, true),
			FILE_OPEN_RETRY_DELAY_MS,
		);
		this.host?.register(() => window.clearTimeout(timer));
	}

	private autoSwitch(leaf: WorkspaceLeaf): void {
		const markdownView = leaf.view;
		if (!(markdownView instanceof MarkdownView)) {
			return;
		}
		const file = markdownView.file;
		if (!file || !this.isDeclared(file)) {
			return;
		}
		this.switchToMindMap(leaf, file);
	}

	/**
	 * 两条扫描路径共用的切换入口。
	 *
	 * `openAsMindMap` 自身吞掉 `setViewState` 的拒绝（见 md-open.ts），这里的兜底
	 * 是**刻意的纵深防御**：扫描路径无用户手势触发，一旦上游契约变更，失败不应
	 * 以未处理拒绝的形式静默消失。两条路径共用一处也避免后续再次分叉。
	 */
	private switchToMindMap(leaf: WorkspaceLeaf, file: TFile): void {
		// `Promise.resolve` 包一层：入口一旦被替换/裁剪成同步实现（测试桩、旧版
		// shim），直接 `.catch` 会在 `void` 表达式上抛「undefined.catch」的
		// 未捕获异常——扫描是后台动作，不该把插件事件链带崩
		void Promise.resolve(openAsMindMap(leaf, file)).catch((error) =>
			console.error('自动切换思维导图视图失败:', file.path, error),
		);
	}
}
