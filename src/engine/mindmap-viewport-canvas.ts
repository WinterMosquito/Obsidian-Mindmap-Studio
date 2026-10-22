/**
 * 画布几何：实时容器矩形、画布尺寸/原点、几何同步与「落地渲染」提前。
 *
 * 从 `engine/mindmap-viewport.ts` 拆出（2026-10-22，纯搬移，零行为改动）。
 * 这一族只回答一个问题——**画布现在在哪、多大**；居中的缩放锚点、内容包围盒
 * 的换算基准、fit 的换算基准都取它，故必须与读它的那几族分开也要保持同源：
 * 拆开后 `syncCanvasGeometry` 仍是引擎几何与实时容器的**唯一**同步点。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';

/**
 * 容器的实时矩形（left/top/width/height，CSS 像素；不可得返回 null）。
 *
 * 引擎只在创建与 `resize()` 时把容器矩形缓存进 `elRect`/`width`/`height`
 * （vendor `getElRectInfo`）；首帧之后工作区布局 settle、md 模式工具栏
 * 重建都会改容器尺寸/位置，缓存随即失真。而首帧居中的缩放锚点与内容
 * 包围盒的换算基准都取容器几何——一旦陈旧，内容就按「旧画布中心 + 旧容器
 * 原点」摆放，表现为打开即偏移（点「适应画布」才拉回）。
 */
function getLiveCanvasRect(
	mindMap: MindMap,
): { left: number; top: number; width: number; height: number } | null {
	const el = (mindMap as unknown as { el?: HTMLElement | null }).el;
	if (!el || typeof el.getBoundingClientRect !== 'function') {
		return null;
	}
	const rect = el.getBoundingClientRect();
	if (!(rect.width > 0) || !(rect.height > 0)) {
		return null;
	}
	return {
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height,
	};
}

/**
 * 画布尺寸（居中锚点与平移目标）：优先实时容器，回退引擎缓存
 * `width`/`height`——容器不可得（隐藏叶、引擎中间态）时至少保住比例设置，
 * 与既有语义一致（elRect 缺失也先 setScale，只跳过平移）。
 */
export function getCanvasSize(
	mindMap: MindMap,
): { width: number; height: number } | null {
	const live = getLiveCanvasRect(mindMap);
	if (live) {
		return { width: live.width, height: live.height };
	}
	const { width, height } = mindMap;
	if (width > 0 && height > 0) {
		return { width, height };
	}
	const cached = (
		mindMap as unknown as {
			elRect?: { width?: unknown; height?: unknown };
		}
	).elRect;
	const cachedWidth = cached?.width;
	const cachedHeight = cached?.height;
	if (
		typeof cachedWidth === 'number' &&
		typeof cachedHeight === 'number' &&
		cachedWidth > 0 &&
		cachedHeight > 0
	) {
		return { width: cachedWidth, height: cachedHeight };
	}
	return null;
}

/**
 * 页面坐标 → 画布坐标的换算原点：优先实时容器，回退引擎缓存 `elRect`
 * （容器不可得时沿用引擎自身口径，保持既有行为）。
 */
export function getCanvasOrigin(
	mindMap: MindMap,
): { left: number; top: number } | null {
	const live = getLiveCanvasRect(mindMap);
	if (live) {
		return { left: live.left, top: live.top };
	}
	const cached = (
		mindMap as unknown as { elRect?: { left?: unknown; top?: unknown } }
	).elRect;
	const { left, top } = cached ?? {};
	if (typeof left === 'number' && typeof top === 'number') {
		return { left, top };
	}
	return null;
}

/**
 * 把引擎缓存的画布几何同步到实时容器（重读矩形、更新 SVG 尺寸，尺寸变化时
 * 重渲染）。与 `view.onResize` 同一路径——首帧窗口内布局 settle 不触发
 * `onResize`，故取视口前必须主动同步，否则 fit/居中都按旧几何换算。
 * 容器不可得（隐藏叶、引擎中间态）时静默跳过，交调用方回退路径。
 *
 * 尺寸**真的变化**时还须把 `resize()` 编排的那次渲染的**启动**提前
 * （`flushPendingLayoutRender`，缩短错配窗口）；调用方（fit / 居中）一律登记
 * 「渲染落地后居中补正」（`scheduleCenteringCorrection`）——布局落地是
 * **异步**的（见 flushPendingLayoutRender 的实测结论），同步块内拿不到新几何。
 */
export function syncCanvasGeometry(mindMap: MindMap): void {
	if (!getLiveCanvasRect(mindMap)) {
		return;
	}
	const widthBefore = mindMap.width;
	const heightBefore = mindMap.height;
	try {
		(mindMap as unknown as { resize?: () => void }).resize?.();
	} catch (error) {
		console.warn('同步画布几何失败', error);
	}
	if (mindMap.width !== widthBefore || mindMap.height !== heightBefore) {
		flushPendingLayoutRender(mindMap);
	}
}

/**
 * 把 `resize()` 刚编排、尚未执行的那次渲染的**启动**提前到本次同步块。
 *
 * 存在理由（实机复现的「适应画布 → 重置缩放偏右」）：`resize()` 在「尺寸变化」
 * 分支只调一次 `render()`——而 vendor 的 `Renderer.render()` 是
 * `clearTimeout(renderTimer); renderTimer = setTimeout(() => this._render(), 0)`，
 * 真正的 `_render()` 被推迟到下一个宏任务。于是存在窗口：`mindMap.width/height`
 * 已是实时容器尺寸，渲染树节点的 left/top 仍是上一尺寸基准。性能模式的
 * 「适应画布」用**数据层几何**求内容盒，在该窗口内测量就是旧布局中心，而目标
 * 画布中心是新值——平移残差 `(W新−W旧)/2`（屏幕上被 ×scale 压小、肉眼难辨）；
 * `resetZoom` 随后按 `1/scale` 缩放回 100%，把同一残差**放大**回屏幕（实机
 * 500 节点：容器 1357.33↔1050 变化 ⇒ 重置缩放后偏 153.67px = 变化量的一半），
 * 表现为「视图偏右/偏左」。打开时的默认视口（centerContentAtScale）走同一
 * 入口，同样受影响（实机实测打开即偏 ~16px）。
 *
 * 为什么只是「提前启动」而非「同步落地」：实测（verify:visual 的
 * viewport-geometry 探针）`_render()` 内部的 `layout.doLayout(callback)` 回调
 * 是**异步**触发的——`_render()` 返回后 `renderer.root` 仍为 null、布局几何
 * 尚不可读。故同步块内拿不到新几何，只能把渲染的**启动**提前（`renderTimer`
 * 的宏任务提前到本次同步块；**正常路径零额外渲染**：那次渲染本来就会跑
 *〔若那次渲染因异常未被编排，实现处有一次防御性强制渲染，见下方注释〕），几何补正由
 * `scheduleCenteringCorrection` 在渲染落地后完成。
 *
 * `_render()` 自带重入守卫（渲染在途时只置 `hasWaitRendering` 并返回）——那种
 * 情况下在途渲染的布局已按它启动时的宽度落地，最终一致由引擎自己的补跑保证，
 * 不额外干预。
 *
 * 防御：`_render` / `renderTimer` 是 vendor 私有面（未入 d.cts），缺失时静默
 * 跳过（行为退回「不落地」，不崩）。
 */
function flushPendingLayoutRender(mindMap: MindMap): void {
	const renderer = (
		mindMap as unknown as {
			renderer?: { renderTimer?: unknown; _render?: () => void };
		}
	).renderer;
	if (!renderer || typeof renderer._render !== 'function') {
		return;
	}
	const timer = renderer.renderTimer;
	if (typeof timer === 'number') {
		// 与 vendor 的 `setTimeout` 同一 window（引擎模块在插件上下文求值），
		// 用裸 clearTimeout 会被 obsidianmd/prefer-window-timers 拦下
		window.clearTimeout(timer);
	}
	renderer.renderTimer = null;
	// 正常路径是「**提前**」而非「新增」：唯一调用方 `syncCanvasGeometry` 只在
	// `resize()` 真把尺寸改掉时进来，而 vendor `render()` 的尺寸变化分支必然
	// 同步排过一次渲染（先 clearTimeout 再 setTimeout）⇒ 那次渲染本来就会跑。
	// **防御兜底**：若那次渲染因异常未被编排（timer 非 number），此处强制一次
	// ——宁可多一次渲染，也不要几何停在旧基准（随后的 fit / 居中补正都按新几何算）。
	try {
		renderer._render();
	} catch (error) {
		console.warn('同步落地画布渲染失败', error);
	}
}
