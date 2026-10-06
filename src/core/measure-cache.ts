/**
 * 自绘内容的**离屏测量缓存键**：把字体状态编进元素 `outerHTML`（K114）。
 *
 * 背景（2026-10-06 实机取证，Obsidian 1.14.4 / MathJax 4.1.3，测试库 `Mindmap`）：
 * 引擎 `measureCustomNodeContentSize`（vendor `simple-mind-map.cjs` 的 `$l`）把
 * 测量结果按**元素 `outerHTML`** 缓存进 vendor **模块级** `St` Map（键不含字体
 * 状态、不含引擎代际）。而 MathJax 的 CHTML 字体是**渐进加载**的：字体到位后
 * 同一段公式的自然宽会变，`outerHTML` 却不变 ⇒ 重测命中偏小的旧宽度 ⇒
 * `foreignObject` 宽度小于内容自然宽 ⇒ 内容被迫换行（高度需求翻倍）而
 * `foreignObject` 高度不变 ⇒ `overflow:hidden` 裁掉底部。
 *
 * 实机量化：裁切的**充要条件**是 `foreignObject` 宽度 < 内容自然宽——宽度只差
 * **4px** 即触发（自然宽 119 / foW 115 ⇒ 内容高 28→45、垂直溢出 17px）。
 * 反向验证：`width: max-content` 只是把垂直裁切换成水平裁切，**不是修复**；
 * `ignoreUpdateCustomTextWidth: false` 会破坏 K26d 的「拖左右边框改宽」
 * （用户设定的 `customTextWidth` 会被内容自然宽覆盖）。
 *
 * 修法（不碰 vendor、不改布局语义、无调用时机依赖）：**每次字体加载完成就递增
 * 一个 epoch，并把 epoch 写进自绘内容根元素的 `data-*`**。于是：
 * - 同一 epoch 内重建 → `outerHTML` 相同 → 仍命中缓存（**零额外测量**）；
 * - 字体状态变化后重建 → `outerHTML` 不同 → 必然 cache miss ⇒ 引擎真实重测。
 *
 * ⚠ **耦合契约（改动本文件时必读）**：本模块**只负责让缓存键变，它自己不重建任何
 * 元素、也不触发任何重排**。「键变了」到「节点真的被重新测量」之间还差一步
 * **重建时机**，由既有链路提供：`features/view.ts` 的 `installMathFontsHook` 在
 * `document.fonts` 的 `loadingdone` 上调`remeasureSettledMathNodes` →
 * `engine/mindmap.refreshNodesCustomContent` → `customCreateNodeContent` 重建
 * 元素 → 此时读到新 epoch ⇒ cache miss ⇒ 重测。
 *
 * **因此：若那条 `loadingdone` 钩子被移除/改名，本修复会静默退化为 no-op**
 * （键虽变但无人重建，节点仍保留旧宽度 ⇒ 裁切复现）。这正是本修复第一版踩过的坑
 * —— 当时把标记挂在 `refreshNodesCustomContent` 上，而该入口在复现场景根本不
 * 执行，实测 `renderedWithMark:0`（静默失效，K85① 教训的又一次复现）。改挂元素
 * 构建入口后，`Vr` 预测量与 `reRender` **两条重建路径**都能带上正确 epoch，才
 * 有了「键随字体状态自动分区」的效果。
 *
 * 实机观测（Obsidian 1.14.4/ MathJax 4.1.3）：epoch 由 0 → 2（`fonts.ready` 与
 * `loadingdone` 各一次），5/5 渲染节点带最新值；唯一停留在旧值的元素是引擎离屏
 * 测量容器里的残留克隆（不参与渲染，无害）。
 *
 * **为什么不需要额外调用点**：引擎的预测量补丁（`Vr`）与数学定稿后的 `reRender`
 * 都经由 `customCreateNodeContent` 重建元素。
 *
 * **落在 core**：唯一消费方是 `features/node-inline-content` 的元素构建入口，
 * 但它需要 `document.fonts`（features 层的单测是 node 环境），故把「读字体状态
 * + 装监听」这两件与 DOM 相关的重活收在 core，由 features 只调一个纯函数。
 *
 * ⚠ **已知边界：读的是全局 `document`，非 per-window**（K115 审查记录）。元素由
 * `InlineContentDocument`（= **画布所在** document，popout 下由引擎层传
 * `el.ownerDocument`，见 `node-inline-content.buildInlineNodeContent` 的契约）创建，
 * 而本模块的 `readFontsStatus` / `installFontHook` 固定用全局 `document`——popout
 * 窗口内二者是不同`FontFaceSet`。**影响很低**：字体是系统级共享，两个 document 的
 * `status` 通常同步；且 popout 内数学渲染本就受限（`platform/math-jax` 绑主窗口的
 * `window.MathJax`）。**未按per-window 修**是刻意的：core 不能依赖 features 的
 * `InlineContentDocument` 类型，要 per-window 需把 doc 一路传下来，收益不抵签名
 * 复杂度。改动此处前请先确认这条前提仍成立。
 */

/** 字体代际：每次「一批字体加载完成」或「字体整体就绪」时递增 */
let fontEpoch = 0;

/** 字体监听是否已装配（避免重复 addEventListener） */
let hookInstalled = false;

/**
 * 读取 `document.fonts.status`。
 *
 * 读面防御（AGENTS.md 硬规则 9）：无 `document`、无 `document.fonts` 一律返回
 * `'none'`——此时字体不可能再变，epoch 恒定，缓存键稳定（退化为「不参与区分」，
 * 与 K114 之前的行为一致）。
 */
function readFontsStatus(): string {
	if (typeof document === 'undefined') {
		return 'none';
	}
	const fonts = (document as unknown as { fonts?: { status?: unknown } })
		.fonts;
	const status = fonts?.status;
	return typeof status === 'string' ? status : 'none';
}

/**
 * 装配字体监听（首次调用时 lazily 装配）。
 *
 * `loadingdone` 会在字体**分批**加载时多次触发（MathJax 有 24 条 `@font-face`），
 * 每次都递增 epoch；`fonts.ready` 再兜一次「整体就绪」——两者都对应「自然宽可能
 * 已变」的时刻。任何异常都静默吞掉（epoch 少递增 ⇒ 退回旧行为，不制造故障）。
 */
function installFontHook(): void {
	if (hookInstalled || typeof document === 'undefined') {
		return;
	}
	const fonts = (
		document as unknown as {
			fonts?: {
				addEventListener?: (type: string, listener: () => void) => void;
				ready?: Promise<unknown>;
			};
		}
	).fonts;
	if (!fonts || typeof fonts.addEventListener !== 'function') {
		return;
	}
	hookInstalled = true;
	const bump = (): void => {
		fontEpoch += 1;
	};
	try {
		fonts.addEventListener('loadingdone', bump);
	} catch {
		/* 监听面不可用：epoch 不再随批次递增 */
	}
	try {
		void fonts.ready
			?.then(() => {
				bump();
			})
			?.catch?.(() => {
				/* ready 拒绝：忽略（字体面不可用已由 readFontsStatus 兜底） */
			});
	} catch {
		/* ready 面不可用 */
	}
}

/**
 * 当前字体代际的**缓存键片段**（写入元素 `data-*`）。
 *
 * 同一字体状态下恒定 ⇒ `outerHTML` 稳定 ⇒ 引擎测量缓存照常命中（无性能代价）；
 * 字体状态变化后必然改变 ⇒ 缓存 miss ⇒ 引擎按当前真实字体重新测宽测高。
 *
 * 副作用（有意）：会**惰性装配**一次字体监听。测试环境无 `document` 时直接返回
 * `'none'`，不触碰任何全局。
 */
export function fontMeasureKey(): string {
	installFontHook();
	return `${readFontsStatus()}:${fontEpoch}`;
}

/** 仅供测试：当前字体代际计数（不参与任何产物路径的行为决策） */
export function currentFontEpoch(): number {
	return fontEpoch;
}