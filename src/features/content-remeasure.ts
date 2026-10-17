/**
 * 自绘内容「定稿 → 尺寸同步」会话（P4 / K88 / K104 / K116）。
 *
 * 从 `features/view.ts` 外置（2026-10-11，`docs/agents/architecture.md` 早已登记
 * 的偏离项「数学校准会话仍在视图层」）。为什么落 features：它按 holder 反查真实
 * 节点并触发批量重排，依赖 engine 访问面——`platform` 不得依赖 engine（K51），
 * `services` 不得依赖 features，故只能在 features 层。外置后该会话**首次获得直测**
 * （此前只靠 `verify:visual` 的 inline 探针间接覆盖）。
 *
 * 职责单一：只做「按 holder 反查真实节点 → 合并为一次批量重排」+ 字体分批就绪的
 * 再同步 + 渲染窗口失败重试。不关心内容是什么（数学/代码块共用同一机制，K116）。
 *
 * ## 三条不变式（自 view.ts 原样继承，抽取时勿"顺手优化"）
 * ① **批量合并**：同帧多段定稿合并为一次批量重排——`setTimeout(0)` 宏任务合批，
 *    **不用 rAF**（后台/隐藏窗口会被节流，定稿永不落地）；
 * ② **按 holder 反查真实节点**：构建期闭包捕获的 node 可能是引擎**预测量代理**
 *    （vendor 补丁 5：只有 `nodeData`/`getData`，没有 `reRender`），`reRender?.()`
 *    会静默 no-op（K88 实机事故：512px 外框 / 655px 内容，29 次回调全收到代理）；
 * ③ **渲染窗口失败只重试一次**（K104）：`Renderer._render` 期间 `renderer.root`
 *    为 null（K67），两条解析路径必然全空——属预期中间态，暂存等
 *    `node_tree_render_end` 重试；仍失败才告警一次（K85 ①：静默即无痕退化）。
 *
 * ## ④ 可见性不变式（2026-10-14，实机复现的 0×0 事故）
 * 自绘内容的量测容器挂在 `mindMap.el` **内部**：叶子不可见（后台标签 / 启动
 * 恢复，`display:none`）时任何量测恒为 0×0；这类 0 落到节点上就是「公式节点
 * 连线收束成一点」，且切回前台**没有任何路径**会重测（`resize()` 只按现有
 * 尺寸重排，实机证实）。故：
 * - **隐藏态不测量**（`flush` / `retryDeferred` / 字体批次一律挂起）；
 * - **由隐藏转可见时自愈**：挂起的 holders 重新入批（复用同一完整回退链）、
 *   字体批次补做、并对「尺寸塌陷的内容节点」做一次症状重测（引擎内部在隐藏态
 *   的重渲染同样会落 0，不能只靠我们自己的挂起集合）；自愈拍到期时若宿主
 *   **又已隐藏**则原地保留脏标记等下一次可见（见 `recoverHidden`）。
 * 官方判据 = `Element.isShown()`（obsidian.d.ts:549）；挂点 = `View.onResize()`
 * （:10575，叶子由隐藏转可见时容器尺寸 0→非 0 必然触发）与
 * `workspace.on('active-leaf-change')`（:11030）。
 *
 * ## ⑤ 未定稿修复（2026-10-14，实机「数学公式永久字面」缺陷收口）
 * 被放弃的未定稿数学段（挂载等待预算耗尽；成因与修法见 `platform/math-jax`
 * 文件头与 `repairUnsettledMath` 的 JSDoc）在节点重进视口时**不会重建内容**
 * （剪枝只摘 DOM，引擎复用旧 group），必须在既有钩子上顺带修复：
 * - `node_tree_render_end` → `retryDeferred`（节点可能刚被复挂回来）；
 * - `loadingdone` → `remeasureSettled`（字体批次就绪，重试的天然时机）；
 * - 隐藏转可见自愈 → `recoverHidden`（经 `retryDeferred` 顺带，不另设路径）。
 * 作用域 = 宿主画布根（`getContentRoot`）；清理点 = `dispose`
 * （`clearUnsettledMath`，只清 root 内的段——root 外的残留由紧随其后的
 * `destroyInstance` 交接给按归属清的 `forgetEngine`）/ `forgetEngine`
 * （`pruneUnsettledMathOwnedBy`，**按引擎身份清**——2026-10-14 实机定案：
 * 首帧前预测量构建的 holder 本体从不挂载（vendor 补丁 5 A2），任何按 DOM
 * 连接状态的清理（含曾用的「只清已脱离」）都会把新引擎的全部懒加载段误清、
 * 字面从此无人修；引擎销毁是唯一无歧义的清理时机）。⚠ `resetNodes`
 * （新引擎就绪时调用）**不动登记面**——它跑在首帧之前，正是误清的高危时刻。
 * 登记面是 `platform/math-jax` 的模块级单例，跨视图存活，GC 兜不住。
 * **修复本身不做可见性守卫**（与 ①②③ 三条路径不同）：它在隐藏态无害（下游
 * 各自守卫），而 `isVisible()` 在无头运行时不存在——高频路径不得依赖宿主面
 * 缺口（论证见 `repairUnsettled` 方法注释）。
 */
import type { MindMap, MindMapNode } from '../core/engine-types';
import { createWarnOnce } from '../core/errors';
import {
	findNodesByContentProducts,
	isNodeCollapsed,
	refreshNodesCustomContent,
	resolveNodesByDoms,
} from '../engine/mindmap';
import {
	clearUnsettledMath,
	pruneUnsettledMathOwnedBy,
	repairUnsettledMath,
} from '../platform/math-jax';

/** 宿主的最窄访问面：引擎实例 + 视图生命周期注册（结构化类型，传入即兼容） */
export interface ContentRemeasureHost {
	/** 当前引擎实例（重建/关闭期间可能为 null；flush 据此静默结束） */
	getMindMap(): MindMap | null;
	/** 注册随视图卸载自动清理的回调（Obsidian `Component.register`） */
	register(cleanup: () => void): void;
	/**
	 * 宿主容器是否可见（官方 `Element.isShown()`：祖先链上无 `display:none`）。
	 * 不可见时不测量——量测容器在隐藏子树内恒得 0×0（见文件头 ④）。
	 */
	isVisible(): boolean;
	/**
	 * 自绘内容 holder 的**画布根**（`mindmap-canvas-container`）：未定稿修复
	 * （`repairUnsettledMath`）与登记面清理（`clearUnsettledMath`）的作用域。
	 * 引擎尚未建 / 已销毁时返回 null（调用方静默跳过）。
	 */
	getContentRoot(): Node | null;
}

/** `document.fonts` 的最小形态（只用到 `loadingdone` 监听；可注入以便测试） */
export interface FontSetLike {
	addEventListener?(type: string, listener: () => void): void;
	removeEventListener?(type: string, listener: () => void): void;
}

/** 缺省字体面：全局 `document.fonts`（node 测试环境无 window → null，静默不装） */
function defaultFontSet(): FontSetLike | null {
	if (typeof window === 'undefined') {
		return null;
	}
	const doc = window.document as unknown as { fonts?: FontSetLike };
	return doc.fonts ?? null;
}

export class ContentRemeasureSession {
	/** 当前批次的 holder（首个定稿者排定时器，后续同帧定稿并入） */
	private pending: Set<HTMLElement> | null = null;
	/** 未决批次的定时器（视图关闭时取消，防关闭后空跑；window.setTimeout 返回 number） */
	private pendingTimer: number | null = null;

	/**
	 * 已成功解析并同步过的**真实节点**（**不清空**）。
	 *
	 * 用途：MathJax 字体是**分批**加载的（`document.fonts` 的 `loadingdone` 会
	 * 多次触发）；首批就绪时的测量可能在后续批次变大——内容多的节点尤甚
	 * （实机实测：655px 内容 / 512px 外框）。字体每就绪一批就再同步一次。
	 * （代码块节点也会进入该集合：多一次重测无害，且避免两套并行集合。）
	 */
	private readonly settledNodes = new Set<MindMapNode>();

	/**
	 * 隐藏态挂起的 holders（不变式 ④）：`flush` 在宿主不可见时不测量，
	 * 本批 holders 原样留到这里；可见后逐个 `schedule` 重新入批——复用
	 * resolve → 产物兜底 → 暂存重试的**完整**链路，不另写一套解析。
	 */
	private hiddenPending: Set<HTMLElement> | null = null;

	/** 观察到过「宿主不可见」（隐藏转变的唯一判据；无脏时自愈零成本） */
	private wasHidden = false;

	/** 字体批次在隐藏态被跳过（`remeasureSettled`）：可见后补做一次 */
	private settledDirty = false;

	/** 自愈的合帧定时器（见 `syncVisibility`；与批次同一拍宏任务） */
	private recoverTimer: number | null = null;

	/**
	 * 「引擎渲染窗口」内解析失败的 holder（K104）：暂存到
	 * `node_tree_render_end`（root 已回填）重试，不在当时告警。
	 */
	private deferred: Set<HTMLElement> | null = null;
	/** 暂存 holders 只重试一次：仍失败才告警（既防静默退化，也防反复重试） */
	private deferredRetried = false;

	/** 字体就绪监听只装一次（经 `host.register` 随视图卸载摘除） */
	private fontsHookInstalled = false;

	/**
	 * 「定稿 holder 未能解析归属节点」告警留痕（同一会话只提示一次）。
	 * 去重与前缀由 `core/errors.createWarnOnce` 统一实现（2026-10-11 收口）。
	 */
	private readonly warnUnresolved = createWarnOnce();

	constructor(
		private readonly host: ContentRemeasureHost,
		private readonly getFontSet: () => FontSetLike | null = defaultFontSet,
	) {}

	/**
	 * 登记「内容定稿（公式替换 / 代码块高亮）后需重测尺寸」的 holder。
	 *
	 * 背景：引擎的内容测量是**同步**的（构建时按字面占位量高），而 MathJax 替换 /
	 * Prism 高亮都是**异步**的——不重测就会出现「块级公式只占一行高度、内容溢出」
	 * /「代码块按字面尺寸定框、替换后被裁」。定稿后重建该节点内容：此时产物缓存
	 * 已命中（同步放置产物），引擎量到的是**真实宽高**。
	 *
	 * 同帧多段定稿合并为一次批量重排（不变式 ①）；首次调用时惰性装配字体监听。
	 */
	schedule(holder: HTMLElement): void {
		if (!this.pending) {
			this.pending = new Set<HTMLElement>();
			// window 计时器（obsidianmd/prefer-window-timers）：弹窗内视图的批次
			// 随弹窗窗口回收；node 单测由 tests/setup.ts 把 window 桩到 globalThis，
			// 照常被 vi.useFakeTimers() 拦截
			this.pendingTimer = window.setTimeout(() => {
				this.pendingTimer = null;
				const holders = this.pending;
				this.pending = null;
				this.flush(holders ? Array.from(holders) : []);
			}, 0);
		}
		this.pending.add(holder);
		this.installFontsHook();
	}

	/**
	 * 渲染完成后重试「渲染窗口内未解析的 holder」（`node_tree_render_end` 时调用）。
	 *
	 * 此刻 `renderer.root` 已回填，holder 与产物两条解析路径恢复可用；只重试
	 * **一次**——仍失败由 `flush` 告警，避免「重排 → 渲染 → 再重排」的循环。
	 */
	retryDeferred(): void {
		// 渲染轮次结束的**顺带修复**：节点可能刚被重新挂载（剪枝复挂不重建
		// 内容），被放弃的未定稿段此时才重新满足修复条件（见 repairUnsettled）。
		// 放在早退之前——本修复与 deferred 状态无关，deferred 为空同样可能需要修。
		this.repairUnsettled();
		const pending = this.deferred;
		if (!pending || pending.size === 0 || !this.host.getMindMap()) {
			return;
		}
		// 隐藏态同样不重试（不变式 ④）：此刻 root 已回填，但量测仍恒 0×0；
		// **不置 `deferredRetried`**，等可见后由 syncVisibility → flush 重试，
		// 否则这次「只重试一次」的额度会被白耗、问题永久静默
		if (!this.host.isVisible()) {
			this.wasHidden = true;
			return;
		}
		this.deferred = null;
		this.deferredRetried = true;
		this.flush(Array.from(pending));
	}

	/**
	 * 「被放弃的未定稿数学段」症状修复（2026-10-14 实机缺陷收口，见文件头 ⑤）。
	 *
	 * 成因与修法在 `platform/math-jax.repairUnsettledMath` 的 JSDoc；此处只做
	 * 宿主侧装配：作用域 = 本宿主的画布根（`getContentRoot`），纪律与既有路径
	 * 一致——隐藏态不动作（`wasHidden` 记脏，可见后由 `recoverHidden` 补做：
	 * 修复的定稿一步会触发尺寸同步，隐藏态下那步仍会挂起，统一纪律避免两条
	 * 时序分叉）。成本 O(未定稿段数)（稳态零），可在高频钩子上无脑调用。
	 */
	private repairUnsettled(): void {
		// 刻意**不做可见性守卫**（与其他三条路径不同）：① 修复在隐藏态无害——
		// 缓存命中只换子节点（不量测），未命中路径的下游（异步定稿 → 尺寸同步
		// → flush）各自持有可见性守卫；② `isVisible()`（官方 `Element.isShown()`）
		// 是宿主面最薄的一环（无头探针页靠 `verify:visual` 的垫片补），而本函数
		// 的调用频率是「每轮渲染」——把宿主面依赖压上热路径，会让
		// `node_tree_render_end` 处理器在缺垫片时抛错、中断渲染收尾（2026-10-14
		// 探针实测：嵌入几何断言整片转红，逐层二分定位到本守卫；垫片是补丁、
		// 不是契约）。高频路径不得依赖宿主面缺口；可见性纪律由下游既有守卫承担。
		const root = this.host.getContentRoot();
		if (root) {
			repairUnsettledMath(root);
		}
	}

	/**
	 * 采样宿主可见性（隐藏转变与自愈的**唯一入口**）：不可见 → 记脏；
	 * 由隐藏转可见 → 自愈（挂起的 holders 重新入批 + 字体批次补做 + 症状重测）。
	 *
	 * 幂等且**无脏时零成本**（首行即返回），故可挂在每次 resize / 叶子激活上。
	 * 挂点见文件头 ④（`View.onResize` / `active-leaf-change`）。
	 */
	syncVisibility(): void {
		if (!this.host.isVisible()) {
			this.wasHidden = true;
			return;
		}
		if (!this.wasHidden || this.recoverTimer !== null) {
			return; // 无脏 / 已有在途自愈：零成本
		}
		// 与批次语义一致（不变式 ①）：自愈落在一拍**宏任务**，不在 resize /
		// 标签切换回调里同步重建内容（那等于在回调内写布局，RO 教训见
		// mindmap-codeblock 的 deferFit）；用 setTimeout(0) 而非 rAF——
		// 后台窗口会被 rAF 节流
		this.recoverTimer = window.setTimeout(() => {
			this.recoverTimer = null;
			this.recoverHidden();
		}, 0);
	}

	/**
	 * 清空「已同步节点」集合（引擎重建 / 换文件 / 视图关闭时调用）。
	 *
	 * 引擎（重）建后节点对象全部是新实例，旧引用已随上一个引擎销毁而失效——
	 * 不清则 ① 旧节点被长期持有（换文件/设置刷新累积成内存泄漏）；② 字体钩子
	 * 会对**已销毁**的节点调重测（2026-09-28 复核修复）。只清集合、不触发任何
	 * 重排（K88 禁止全树重排的约束不变）。
	 *
	 * ⚠ **不动未定稿登记面**（2026-10-14 实机定案）：本函数在「新引擎就绪、
	 * 首帧渲染之前」被调用，此刻新引擎刚由预测量构建的 holder **本体从不挂载**
	 * （vendor 补丁 5 A2）——任何按 DOM 连接状态的清理都会把它们误删，登记面
	 * 一空 `repairUnsettledMath` 便再无从修复（实机：500 节点图视口外 76 段
	 * 永久字面、进视口也无人修）。登记面的清理只属于「该引擎已销毁」
	 * （`forgetEngine`）与「视图已卸载」（`dispose`）。
	 */
	resetNodes(): void {
		this.settledNodes.clear();
		// 引擎换代：挂起的 holders 属旧树（引用已失效），settled 集合也空了 ⇒
		// 字体补做无意义。`wasHidden` **保留**——可见性是宿主的属性、与引擎无关；
		// 保留它，「隐藏期间重建了引擎」的场景才能在可见时由症状重测兜住（不变式 ④）。
		this.hiddenPending = null;
		this.settledDirty = false;
	}

	/**
	 * 「引擎已销毁」：清掉该引擎归属的未定稿登记（`resetNodes` 的姊妹动作，
	 * 由宿主在 `destroyInstance` 的 `onEngineDisposed` 回调里调用）。
	 *
	 * 为什么按引擎身份清而非 DOM 状态：首帧前预测量构建的 holder 本体从不挂载
	 * （vendor 补丁 5 A2），与「旧引擎已脱离的残留」在连接状态上不可区分——
	 * 按 `!isConnected` 清会误删**新引擎**的全部懒加载段（2026-10-14 实机定案，
	 * 完整论证见 platform/math-jax 的 `unsettledMath`）。引擎销毁是唯一无歧义
	 * 的时机：该引擎的条目必然作废，其他引擎（多视图 / 嵌入）的条目原样保留。
	 */
	forgetEngine(owner: object | null): void {
		if (!owner) {
			return;
		}
		pruneUnsettledMathOwnedBy(owner);
	}

	/**
	 * 视图关闭：取消未决批次并清空全部状态（幂等）。
	 *
	 * 未决 flush 在关闭后本会因引擎为 null 静默结束；显式取消让「关闭后有宏任务
	 * 在跑」这件事本身不发生（与 teardown 会话收尾同一纪律）。字体监听的摘除仍走
	 * `host.register`（Component 生命周期，与抽取前一致）。
	 */
	dispose(): void {
		if (this.pendingTimer !== null) {
			window.clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
		}
		if (this.recoverTimer !== null) {
			window.clearTimeout(this.recoverTimer);
			this.recoverTimer = null;
		}
		this.pending = null;
		this.deferred = null;
		this.deferredRetried = false;
		this.settledNodes.clear();
		// 可见性状态随视图一并作废（dispose 之后不存在「再变可见」）
		this.hiddenPending = null;
		this.wasHidden = false;
		this.settledDirty = false;
		// 未定稿登记面必须随视图清（⑤）：holder 属本视图 DOM，视图销毁后
		// 永远 isConnected=false，而登记面是 platform 的模块级单例（跨视图
		// 存活），GC 兜不住——不清则开关视图逐次累积强引用。
		const root = this.host.getContentRoot();
		if (root) {
			clearUnsettledMath(root);
		}
	}

	/**
	 * 批次执行：holder → 真实 MindMapNode（`resolveNodesByDoms` 批量反查）→ 批量重排。
	 *
	 * 解析失败（holder 已脱离 / 引擎重建中）走两条回退：产物元素反查
	 * （`findNodesByContentProducts`，K100/K104）→ 渲染窗口暂存重试；重试后仍全空
	 * 才**告警一次**——静默跳过会让「尺寸不同步」以无痕方式退化（K85 ① 教训）。
	 */
	private flush(holders: readonly HTMLElement[]): void {
		const mindMap = this.host.getMindMap();
		// 批量窗口（setTimeout）内视图可能已关闭、引擎已销毁：此时既无重测目标，
		// 也不该再走回退并打「未命中」告警（关闭视图时刷误导日志）——静默结束。
		if (!mindMap) {
			return;
		}
		// 隐藏态不测量（不变式 ④）：量测容器在 display:none 子树内恒得 0×0，
		// 落到节点上就是「公式节点连线收束」。本批 holders 原样挂起，
		// 等可见后由 syncVisibility 重新入批（同一套回退链，不重复实现）。
		if (!this.host.isVisible()) {
			this.hiddenPending ??= new Set<HTMLElement>();
			for (const holder of holders) {
				this.hiddenPending.add(holder);
			}
			this.wasHidden = true;
			return;
		}
		const nodes: MindMapNode[] = [];
		const unresolvedHolders: HTMLElement[] = [];
		// 批量反查：一次遍历建「group → 节点」表 + 逐 holder 沿祖先链查表，取代
		// 逐 holder 全树 walkTree（O(holder 数 × 节点数)）。逐位置对应，故「未命中」
		// 语义与逐个反查完全一致（落空的 holder 仍进 unresolvedHolders，走下面
		// 「产物元素反查 / 延后重试」两条回退）。
		const resolved = resolveNodesByDoms(mindMap, holders);
		for (const [i, holder] of holders.entries()) {
			const node = resolved[i] ?? null;
			if (!node) {
				unresolvedHolders.push(holder);
				continue;
			}
			nodes.push(node);
			this.settledNodes.add(node);
		}
		if (unresolvedHolders.length > 0) {
			// 反查一（K100/K104）：holder 可能已随引擎重渲染脱离（图片回灌 K96 的
			// 补灌触发全树重建），改按**产物元素**反查——选择器三通道覆盖我方数学
			// holder 类、CHTML 容器与**代码块高亮 holder**（2026-10-07 审查修复：
			// 此前缺代码块通道，且兜底「捞到别的数学节点」会让本批代码块静默跳过、
			// 不重测也不告警）。⚠ 兜底是**过包含**的（返回全部产物所在节点）⇒ 若
			// 本批 holder 彻底消失且其产物也不在活 DOM 里，仍会被静默跳过
			//（K100 既有边界，未改设计）。
			// 去重改用 Set：nodes 随循环增长，`includes` 会让本轮退化为 O(n²)
			const seen = new Set(nodes);
			for (const node of findNodesByContentProducts(mindMap)) {
				if (seen.has(node)) {
					continue;
				}
				seen.add(node);
				nodes.push(node);
				this.settledNodes.add(node);
			}
			if (nodes.length === 0) {
				if (!this.deferredRetried) {
					// 全部落空且尚未重试：**大概率是引擎渲染窗口**——`Renderer._render`
					// 期间 `renderer.root` 为 null（K67），两条解析路径必然全空。
					// 暂存 holders，等 node_tree_render_end（root 回填）重试，不告警。
					this.deferred = new Set(unresolvedHolders);
					return;
				}
				// 重试后仍全空：真的定位不到 → 告警一次（静默跳过会让问题无痕退化）
				this.warnUnresolved(
					'自绘内容节点（公式/代码块）尺寸同步未能定位归属节点，内容可能被裁剪',
				);
			}
		}
		// 本轮有命中（或无需重试）：清暂存与重试标记
		this.deferred = null;
		this.deferredRetried = false;
		if (nodes.length > 0) {
			refreshNodesCustomContent(mindMap, nodes);
		}
	}

	/**
	 * 字体每就绪一批就把已同步的数学节点**再同步一次**：字体数据到位后同一
	 * TeX 的产物会更高（多行内容尤甚），首批测量可能偏小。
	 *
	 * 隐藏态**只记脏不测量**（不变式 ④；`loadingdone` 是进程级的，后台叶子也会
	 * 被通知）：不能在隐藏态静默丢弃——`core/measure-cache.ts` 的字体 epoch 修复
	 * 明确依赖这条钩子（钩子若退化为 no-op，字体到位后尺寸不再同步），故可见后补做。
	 */
	private remeasureSettled(): void {
		if (!this.host.isVisible()) {
			this.wasHidden = true;
			this.settledDirty = true;
			return;
		}
		// 字体批次就绪是未定稿修复的天然时机（⑤）：产物缓存与字体无关，
		// 命中即同步修好；未命中且已挂载的重新入队（此刻正式就绪窗口）。
		this.repairUnsettled();
		const nodes = Array.from(this.settledNodes);
		if (nodes.length > 0) {
			refreshNodesCustomContent(this.host.getMindMap(), nodes);
		}
	}

	/**
	 * 「由隐藏转可见」的自愈（`syncVisibility` 的唯一实现；无脏时零成本）。
	 *
	 * 四条动作，覆盖 0 的全部来源：
	 * ① 挂起的 holders 重新入批 —— 我们自己在隐藏态收到、被跳过的那批；
	 * ② 渲染窗口暂存补重试 —— 隐藏态被跳过的 `retryDeferred`（当次不置
	 *    `deferredRetried`，额度未被白耗）；
	 * ③ 字体批次补做 —— 隐藏期间被跳过的 `remeasureSettled`；
	 * ④ 症状重测 —— **引擎内部**在隐藏态的重渲染（引用更新 / 启动恢复 /
	 *    预测量）产生的 0 不经过本会话，只能按「尺寸塌陷」反查后重测。
	 */
	private recoverHidden(): void {
		if (!this.wasHidden) {
			return; // 无脏：不查 DOM、不重排
		}
		// 自愈同样只在**可见态**落地（与其余三条路径同一纪律，2026-10-14 自查补）：
		// 采样到「可见」与自愈拍到期之间宿主可能又被切走（快速切标签、正在关闭的
		// 叶子）——那时的症状重测会把 0×0 写回节点，而 `wasHidden` 已被清 ⇒
		// 下一次可见不再自愈、塌陷永久。保留脏标记直接返回：可见后的下一次采样
		// 会重排一拍（syncVisibility 的幂等前提正是脏标记未被白清）。
		if (!this.host.isVisible()) {
			return;
		}
		this.wasHidden = false;
		const holders = this.hiddenPending ? Array.from(this.hiddenPending) : [];
		this.hiddenPending = null;
		for (const holder of holders) {
			this.schedule(holder);
		}
		this.retryDeferred();
		if (this.settledDirty) {
			this.settledDirty = false;
			this.remeasureSettled();
		}
		const mindMap = this.host.getMindMap();
		if (!mindMap) {
			return; // 引擎已销毁：脏标记随之作废
		}
		const collapsed = findNodesByContentProducts(mindMap).filter(
			isNodeCollapsed,
		);
		if (collapsed.length > 0) {
			refreshNodesCustomContent(mindMap, collapsed);
		}
	}

	/** 一次性装配字体就绪监听（`loadingdone` 会随字体分批多次触发） */
	private installFontsHook(): void {
		if (this.fontsHookInstalled) {
			return;
		}
		this.fontsHookInstalled = true;
		const fonts = this.getFontSet();
		if (!fonts?.addEventListener) {
			return;
		}
		const onFontsLoaded = (): void => this.remeasureSettled();
		fonts.addEventListener('loadingdone', onFontsLoaded);
		this.host.register(() => {
			fonts.removeEventListener?.('loadingdone', onFontsLoaded);
		});
	}
}
