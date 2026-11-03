/**
 * 「加载会话」：一次文件加载的**跨时机状态**。
 *
 * 从 `features/view.ts` 拆出（2026-10-22，**只搬状态、不改控制流**）。
 *
 * 为什么单独立一个类：这四个字段被 `onOpen` 与 `onLoadFile` **两个入口**读写，
 * 而 Obsidian 不保证这两个入口的调用时序——它们合在一起才表达「一次加载进行到
 * 哪一步」，散在 1255 行的类里时，谁负责清空、按什么顺序清，只能靠通读。
 *
 * 时序契约（搬动时逐字保留，勿合并或改序）：
 * - `whenReady`：`onOpen` 进入时**重建**、DOM 装配完成后 `resolve`；
 *   `onLoadFile` 用它等装配完成（替代旧的 10ms `setTimeout` 轮询）。
 *   视图关闭时重置为**永不 resolve** 的 Promise（`onClose`），
 *   使排队中的 `onLoadFile` 自然退出而不是超时后继续跑。
 * - `loadingFilePath`：同文件互斥的依据（同一导图只允许一个实例持有引擎）；
 *   三个 `if (this.loadingFilePath !== file.path) return` 是**异步续跑前**的
 *   唯一守卫，删任何一个都会在文件切换后继续用旧 tree 建引擎。
 * - `pendingInitRaf`：必须可取消——视图关闭/文件切换后该回调仍会执行，
 *   届时容器可能仍在 DOM 且尺寸非零，会在**已关闭的视图**上建出完整引擎实例
 *   （无人销毁）。取消逻辑收在 `cancelInitFrame` 一处。
 * - `pendingImageCorrections`：探测在首帧前起步、首帧后回灌；引擎尚未创建时
 *   留待 `onEngineReady`，文件切换/卸载时丢弃。
 * - `pendingBaseline` / `pendingRenderHint`：同样等 `onEngineReady`——两者都
 *   需要「引擎已存在」（前者取树快照、后者绑首帧事件），而 0 尺寸等待期恰好
 *   没有引擎；文件切换/卸载时丢弃。
 */
import type { ImageSizeCorrection } from '../media/images-path';

export class LoadSession {
	/**
	 * 视图装配完成信号：`onOpen` 进入时重建、DOM 装配完成后 resolve。
	 * `onLoadFile` 与 `onOpen` 的调用时序 Obsidian 不保证，前者据此
	 * 等待装配完成（替代原 10ms setTimeout 轮询的 waitForReady）。
	 */
	whenReady: Promise<void> = new Promise<void>(() => {});

	/**
	 * 文件加载去重：`onOpen` 与 `onLoadFile` 都会为同一文件触发加载
	 * （Obsidian 对 FileView 的调用时序不保证），记录进行中的加载路径，
	 * 避免同一文件被重复读取、重复创建引擎实例。
	 */
	loadingFilePath: string | null = null;

	/**
	 * 待执行的引擎初始化帧（`loadMindMapFromFile` 用 rAF 等首帧布局就绪）。
	 * 必须可取消：视图关闭/文件切换后该回调仍会执行，届时容器可能仍在 DOM
	 * 且尺寸非零，会在已关闭的视图上建出完整引擎实例（无人销毁）。
	 */
	pendingInitRaf: number | null = null;

	/**
	 * 挂起的「图片尺寸校正」结果（探测在首帧前起步、首帧后回灌）。
	 * 引擎尚未创建时留待 `onEngineReady`；文件切换/卸载时丢弃。
	 */
	pendingImageCorrections: ImageSizeCorrection[] | null = null;

	/**
	 * 挂起的「加载时序列化基线」记录（由 `SavePipeline.markLoaded` 落账）。
	 *
	 * 为什么不是「rAF 里 initMindMap 之后直接记」：`initMindMap` 在容器 0 尺寸
	 * （后台标签/折叠面板）时**不建引擎**，只挂 ResizeObserver 等尺寸就绪，此刻
	 * `getDataSnapshot()` 为 null，`markLoaded` 的空守卫会静默吞掉这次记录 ⇒ 该
	 * 文件此后每轮自动保存都不再是「纯浏览」（打开即重排全文，正是要消灭的行为）。
	 * 故把原样正文留在这里，由 `onEngineReady`（引擎真正建好那一刻）补记。
	 *
	 * **只在加载路径写入**（设置刷新重建不写，否则会把未落盘的编辑误标成基线），
	 * 消费前还要核对路径——否则会把 A 文件的原文记成 B 文件的基线。
	 */
	pendingBaseline: { path: string; rawBody: string } | null = null;

	/**
	 * 挂起的「大图首帧提示」节点数（只有 ≥ 阈值时才有值，否则 null）。
	 *
	 * 与 `pendingBaseline` 同一个根因：提示必须赶在**首帧渲染开始之前**上屏
	 * （引擎的 `render()` 排在 `setTimeout(0)`），而绑摘除事件需要 `mindMap` 已
	 * 存在。0 尺寸等待时此刻 mindMap 为 null ⇒ 绑不上 `node_tree_render_end`，
	 * 提示只能等 15 s 兜底，而它是不透明全屏遮罩（切回来会像卡死 15 s）。
	 * 节点数在加载路径用解析出的树算好（零拷贝），交给 `onEngineReady` 消费。
	 */
	pendingRenderHint: number | null = null;

	/**
	 * 取消已排期的首帧初始化（幂等）。
	 *
	 * `win` 由调用方给（视图的 `containerEl.win`）：popout 场景下窗口对象与
	 * 全局 `window` 不是同一个，`cancelAnimationFrame` 必须落在排期时的那个窗口上。
	 */
	cancelInitFrame(win: Window): void {
		if (this.pendingInitRaf !== null) {
			win.cancelAnimationFrame(this.pendingInitRaf);
			this.pendingInitRaf = null;
		}
	}
}
