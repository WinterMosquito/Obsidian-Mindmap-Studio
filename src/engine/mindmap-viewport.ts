/**
 * 画布几何与视口的防腐收口（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 覆盖：实时容器几何同步、数据层/DOM 两种内容包围盒测量、适应画布（fit）、
 * 居中与「渲染落地后居中补正」、缩放/平移、以及视口状态读写与签名。
 * 依赖 `mindmap-timers` 的 `scheduleEngineTimer`（补正兜底定时器）。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import { HEAVY_FIT_NODE_THRESHOLD } from '../core/constants';
import { countMindMapNodes } from './mindmap-nodes';
import { scheduleEngineTimer } from './mindmap-timers';
import {
	getCanvasOrigin,
	getCanvasSize,
	syncCanvasGeometry,
} from './mindmap-viewport-canvas';

/**
 * 大图 fit 的**最小可读比例**（产品裁决 2026-10-17）。
 *
 * 起因：`适应画布` 的目标是「整树可见」，而剪枝在全部可见时必然解除 ⇒ 数千节点
 * 一次装配（补丁 12 之前实测 5000 节点 20–38s；补丁 12 后仍需约 1s，且 DOM 会
 * 涨到全树）。而 5000 节点的真 fit 比例约 **0.03**——文字 < 1px，看到等于没看到。
 * 故节点数 > `HEAVY_FIT_NODE_THRESHOLD` 时把比例抬到可读下限、视口只覆盖内容
 * 中心：既保留「一键回到全局视野」的作用，又不为一张看不清的图付全树装配。
 * 阈值以下不受影响（1–2k 的 fit 亚秒级，全览仍有意义）。
 */
const LARGE_MAP_MIN_FIT_SCALE = 0.1;

/**
 * `fitMindMap` 的结果。
 *
 * `clamped` = **本次真的抬了可读下限**（因而是「没显示全部节点」的唯一判据）。
 * 调用方据此决定要不要解释——**不要**在 UI 侧按节点数另算一遍阈值：那会在
 * 「节点很多但内容本来就适配」（比例 ≥ 下限、未钳制）时说出与事实相反的提示。
 */
type FitOutcome = 'fit' | 'clamped' | 'skipped';

/**
 * 适应画布（性能模式适配）。
 *
 * 引擎 view.fit() 基于可见节点的 SVG 包围盒（rbox）计算缩放；性能模式下
 * 视口外节点已被引擎移除出 DOM（removeNodeWhenOutCanvas），直接 fit 只会
 * 适配「可见子集」。旧实现先 forceLoadNode 强制渲染全部节点（5000 节点
 * ≈1.1s **同步**装配，K70 实测）再 fit——「自动整理 / 切布局」可重复触发，
 * 是大图上的 1s 级冻结。
 *
 * 现改为**数据层 fit**（2026-10-02，K70 残留消除；与 `centerContentAtFullScale`
 * 同族）：用渲染树布局几何并集算目标缩放与居中平移，零 DOM 装配。语义与 vendor
 * `View.fit` 对齐：`fitPadding`（默认 50）、缩放上限 1、**三种 flag 下内容中心
 * 均落在画布中心**（推导：flag1/2/3 的最终中心均为 `p + (E-2p)/2 = E/2`——故
 * 复刻按中心对齐即可，无需分支）；差异仅在于用**实时容器**而非缓存 `elRect`
 * 换算（方向为「更正确」，同 K64 既有修订）。
 *
 * 数据层几何不可得（渲染树未就绪）时回退旧路径（forceLoadNode + fit）。
 * 常规模式行为不变（DOM 全量在，vendor fit 的 rbox 口径含描边，更精确）。
 *
 * fit 之后**一律**登记一次「渲染落地后居中补正」：居中几何可能有两类滞后——
 * 尺寸刚变化（布局切基准是异步的，见 flushPendingLayoutRender）与首帧几何
 * 未收敛（fit 触发的重渲染会按稳定态尺寸重跑布局）——不补正都会留下残差、
 * 被 resetZoom 按 1/scale 放大（见 scheduleCenteringCorrection）。
 *
 * 大图（> `HEAVY_FIT_NODE_THRESHOLD`）有**比例下限** `LARGE_MAP_MIN_FIT_SCALE`
 * （2026-10-17 产品裁决）：真 fit 比例会落到 0.03 量级（文字不可读），且「整树
 * 可见」会强制解除剪枝、把数千节点一次装配进 DOM（补丁 12 前 20–38s）。抬高
 * 下限后视口只覆盖内容中心，用户拿到的是可读的一屏。
 *
 * @returns `clamped` = 本次真的抬了下限（调用方据此解释「没显示全部节点」）；
 *   `skipped` = 引擎缺失或 fit 抛错（已记日志）；`fit` = 正常适应。
 */
export function fitMindMap(mindMap: MindMap | null): FitOutcome {
	if (!mindMap) {
		return 'skipped';
	}
	try {
		// 引擎 fit 用缓存的 elRect 换算，先同步到实时容器（首帧窗口内
		// onResize 尚未触发，不同步会按旧画布尺寸适配）
		syncCanvasGeometry(mindMap);
		// 见 JSDoc：只补平移（缩放由内容尺寸决定、与布局基准无关，无需重算）
		scheduleCenteringCorrection(mindMap);
		if (mindMap.opt?.openPerformance) {
			const dataOutcome = fitPerformanceMindMapFromData(mindMap);
			if (dataOutcome) {
				return dataOutcome;
			}
			// 数据层几何不可得：回退全量装配（旧路径）
			mindMap.renderer.forceLoadNode?.();
		}
		mindMap.view?.fit();
		return 'fit';
	} catch (error) {
		console.error('适应画布失败', error);
		return 'skipped';
	}
}

/**
 * 数据层 fit（性能模式专用）：返回本次结果，`null` = 数据层几何不可得、
 * 由调用方回退旧路径（forceLoadNode + vendor fit）。
 *
 * - 目标缩放 = `min(1, 可用宽/盒宽, 可用高/盒高)`（等价 vendor fit 的 flag 1/2/3）；
 * - 平移 = 内容中心 → 画布中心（见 fitMindMap 的中心推导）；
 * - `setScale` **不传锚点**（vendor fit 同款：只改 scale、位移不变），随之读新
 *   变换再算平移；
 * - **零调用短路**：缩放已对齐时不发 `setScale`、中心已在 ε 内时不发
 *   `translateXY`（居中走共享实现 centerContentByDataBox）——两者都无条件
 *   emit `view_data_change`，性能模式下每次都是一轮分片整树渲染（K70）。
 */
function fitPerformanceMindMapFromData(
	mindMap: MindMap,
): Exclude<FitOutcome, 'skipped'> | null {
	const size = getCanvasSize(mindMap);
	const box = measureContentBoxFromData(mindMap);
	const current = readDrawTransform(mindMap);
	if (!size || !box || !current || box.width <= 0 || box.height <= 0) {
		return null;
	}
	const padding = Number(mindMap.opt?.fitPadding ?? 0) || 0;
	const availableWidth = Math.max(1, size.width - padding * 2);
	const availableHeight = Math.max(1, size.height - padding * 2);
	const fitScale = Math.min(
		1,
		availableWidth / box.width,
		availableHeight / box.height,
	);
	// 大图给可读下限（见 LARGE_MAP_MIN_FIT_SCALE）：比例被抬起后内容超出视口，
	// 但居中仍按数据层内容中心算，用户看到的是一屏可读的中心区域。
	// 小图（fit 比例本就 ≥ 下限）由 `&&` 短路，**不做** O(n) 的节点计数。
	const clamped =
		fitScale < LARGE_MAP_MIN_FIT_SCALE &&
		countMindMapNodes(mindMap) > HEAVY_FIT_NODE_THRESHOLD;
	const targetScale = clamped ? LARGE_MAP_MIN_FIT_SCALE : fitScale;
	const scaleAligned = Math.abs(current.scaleX - targetScale) < 1e-6;
	if (!scaleAligned) {
		mindMap.view?.setScale(targetScale);
	}
	const after = scaleAligned ? current : readDrawTransform(mindMap);
	if (!after) {
		return null; // 变换读取异常：交给调用方回退（旧路径会重新装配，至少功能可用）
	}
	// 居中复用共享实现（含 ε 零调用短路；读数现取，即 setScale 之后的变换）
	centerContentByDataBox(mindMap);
	return clamped ? 'clamped' : 'fit';
}

/**
 * 视口已在目标位置的判定容差（px，亚像素）：平移量小于它时视为「已居中」，
 * 完全不动 view。为什么必须显式短路（K70）：vendor 的 `setScale` **无条件**
 * emit `view_data_change`（`scaleInCenter` 在 Δ=0 时也 `transform() + emit`），
 * 性能模式下该事件经 200ms 节流器触发**分片整树渲染**；而本函数在打开窗口内
 * 被多次调用（首帧渲染结束 / 150ms 兜底 / 图片回灌补居中），几何未变时的
 * 重复调用若不短路就是白渲染一轮（500 节点 ≈ 2495 条属性空写，见 K58）。
 */
const VIEW_CENTER_EPSILON = 0.5;

/**
 * 「渲染落地后居中补正」的观察窗口（ms）：窗口内每次渲染落地都补正，直到
 * 几何指纹连续两轮不变（布局收敛）或轮次/窗口用尽。
 *
 * 为什么是窗口而不是一次性：实机（1000 节点测试图、全新打开）实测布局的
 * **稳定态晚于**打开窗口的既有自愈（`initialViewportRecalcBudget` 2 次 +
 * 200ms recenter）——8s 采样点仍在偏移（dx=-24.97），20s 才自愈；一次性
 * 补正命中不了这类晚到收敛（首帧几何 vs 稳定几何的数据盒中心实测差
 * 24.97px，同族于 500 节点图的 15.9px）。
 */
const CENTER_CORRECTION_WINDOW_MS = 3000;
/** 窗口内最多补正轮次（防病态渲染风暴；正常 ≤2 轮：收敛后再无渲染） */
const CENTER_CORRECTION_MAX_ROUNDS = 6;

/** 居中相关的一次几何采样：画布尺寸 + 数据层内容盒（一起取，避免重复全树遍历） */
interface CenteringGeometry {
	size: { width: number; height: number };
	box: { x: number; y: number; width: number; height: number };
}

/** 采样居中几何；任一不可得返回 null（调用方自行回退） */
function measureCenteringGeometry(mindMap: MindMap): CenteringGeometry | null {
	const size = getCanvasSize(mindMap);
	const box = measureContentBoxFromData(mindMap);
	return size && box ? { size, box } : null;
}

/**
 * 居中几何的指纹（画布尺寸 + 数据盒中心）——「布局是否已收敛」的断言依据：
 * 补正只改平移、不改这些量，故指纹相同 ⇒ 可停手。
 *
 * 入参是**已测得**的几何：`getCanvasSize` 是实时 DOM 读取、
 * `measureContentBoxFromData` 是全树遍历，补正每轮各调一次就是两次全树 walk
 * （见 measureCenteringGeometry）。
 */
function geometrySignature(geometry: CenteringGeometry): string {
	const { size, box } = geometry;
	return `${size.width}x${size.height}|${box.x + box.width / 2}|${box.y + box.height / 2}`;
}

/**
 * 把内容中心对到画布中心（**数据层几何**口径；含 ε 零调用短路）。
 *
 * 自 `fitPerformanceMindMapFromData` 与 `centerContentAtScale` 的同款居中段
 * 抽出（同一判定只留一份），供「落地后补正」（scheduleCenteringCorrection）
 * 复用。**变换一律调用时现取**：调用方若刚改过缩放（`setScale`），本函数
 * 读到的是改后的变换。
 *
 * @param measured 调用方已测得的几何（补正每轮只采样一次，见
 *                 measureCenteringGeometry）；省略则现取
 * @returns 是否已处理：几何不可得（渲染树未就绪）时 false，调用方自行回退；
 *          ε 内为 true 且零调用（不发 `translateXY`——它无条件 emit
 *          `view_data_change`，性能模式下 = 一轮分片整树渲染，K70）
 */
function centerContentByDataBox(
	mindMap: MindMap,
	measured?: CenteringGeometry,
): boolean {
	const geometry = measured ?? measureCenteringGeometry(mindMap);
	const transform = readDrawTransform(mindMap);
	if (!geometry || !transform) {
		return false;
	}
	const { size, box } = geometry;
	const centerX = (box.x + box.width / 2) * transform.scaleX + transform.translateX;
	const centerY = (box.y + box.height / 2) * transform.scaleY + transform.translateY;
	const dx = size.width / 2 - centerX;
	const dy = size.height / 2 - centerY;
	if (
		Math.abs(dx) < VIEW_CENTER_EPSILON &&
		Math.abs(dy) < VIEW_CENTER_EPSILON
	) {
		// 已在目标态：零调用（见 @returns）
		return true;
	}
	mindMap.view?.translateXY(dx, dy);
	return true;
}

/**
 * 登记一次「渲染落地后居中补正」（一次性 + 超时兜底）。
 *
 * 为什么视口操作要在渲染落地后补一次居中——**两类触发**（实机实测）：
 * ① **尺寸刚变化**：`syncCanvasGeometry` 里 `resize()` 触发的重渲染要等
 *    `layout.doLayout` 的**异步回调**才把布局切到新基准（见
 *    flushPendingLayoutRender），同步算出的居中基于旧布局，残差
 *    `(W新−W旧)/2`（实机错配注入复现：fit 后 10.75px ⇒ reset 后 153.67px）；
 * ② **首帧几何未收敛**：打开窗口的布局用首帧节点尺寸，而 fit 自身触发的
 *    重渲染（`view_data_change` → 性能模式节流）会用**稳定态**尺寸重跑布局
 *    ——实机 500 节点：数据盒中心从 1566.4 变到 1550.5（Δ = 15.9 布局坐标），
 *    首次 fit 的残差 = Δ×scale（0.0699 ⇒ 1.11px 屏幕、肉眼难辨），
 *    `resetZoom` 随即按 `1/scale` 放大回 15.91px（实测）。
 * 两类残差都会被 resetZoom 放大，故 fit / 打开视口**一律**登记本补正。
 * 零额外渲染：fit / 居中的 `setScale`/`translateXY`/`setTransformData` 本就
 * 各自触发一轮渲染，补正搭它的车（`node_tree_render_end` 时执行）。
 *
 * 只补「平移」——缩放由内容尺寸决定、与布局基准无关；补正幂等（已居中时
 * ε 短路零调用）。**窗口内跟随**（见 CENTER_CORRECTION_WINDOW_MS）：布局的
 * 晚到收敛（实机 1000 节点图 8s 采样点仍在变、20s 才稳）由多轮补正覆盖，
 * 直到几何指纹连续两轮一致（收敛）或轮次/窗口用尽；视图销毁/引擎缺失时
 * `centerContentByDataBox` 静默返回 false，监听随窗口兜底解除。
 *
 * 两条**生命周期**纪律（否则会叠加监听/悬挂引用）：
 * - **同实例只保留最后一份**：打开流程里 fit 与「居中到全尺度」各自登记一次，
 *   `registerActive` 前先取消上一份——不去重则每次渲染落地都会补正多次、各自
 *   做全树采样，还要多留一份兜底定时器；
 * - **兜底定时器走 `engineTimers`**（`scheduleEngineTimer`）：视图销毁时
 *   `cancelEngineTimers` 一并取消，不留悬挂监听、也不让已销毁的引擎（含历史
 *   记录）被闭包多留一个窗口。
 */
const activeCenteringCorrections = new WeakMap<MindMap, () => void>();

function scheduleCenteringCorrection(mindMap: MindMap): void {
	// 重复登记：先停上一份（含它的监听与指纹状态），避免叠加
	activeCenteringCorrections.get(mindMap)?.();
	const events = mindMap as unknown as {
		on?: (event: string, handler: () => void) => void;
		off?: (event: string, handler: () => void) => void;
	};
	const deadline = Date.now() + CENTER_CORRECTION_WINDOW_MS;
	let rounds = 0;
	let lastSignature: string | null = null;
	let finished = false;
	const stop = (): void => {
		if (finished) {
			return;
		}
		finished = true;
		if (activeCenteringCorrections.get(mindMap) === stop) {
			activeCenteringCorrections.delete(mindMap);
		}
		try {
			events.off?.('node_tree_render_end', onEnd);
		} catch (error) {
			console.warn('解除居中补正监听失败', error);
		}
	};
	function onEnd(): void {
		if (finished) {
			return;
		}
		// 每轮只采样一次：居中与收敛指纹共用（各测一次 = 两次全树遍历 + 两次
		// 实时矩形读取，见 measureCenteringGeometry）
		const geometry = measureCenteringGeometry(mindMap);
		try {
			centerContentByDataBox(mindMap, geometry ?? undefined);
		} catch (error) {
			console.warn('视口居中补正失败', error);
		}
		// 布局指纹连续两轮一致 ⇒ 已收敛，停手；否则继续跟随（覆盖晚到收敛）
		const signature = geometry ? geometrySignature(geometry) : null;
		if (signature !== null && signature === lastSignature) {
			stop();
			return;
		}
		// **轮次只对「布局真的变了」计费**（2026-10-15）：`node_tree_render_end`
		// 在单节点 reRender、分片渲染等**不改内容盒**的局部渲染上同样派发；
		// 无条件计数会让预算被无关渲染吃光、晚到的布局收敛再也补不上
		//（本预算的语义就是「最多跟随几次布局变化」；几何始终不可得的情形
		// 由窗口兜底定时器收尾）
		if (signature !== lastSignature) {
			rounds++;
		}
		lastSignature = signature;
		if (rounds >= CENTER_CORRECTION_MAX_ROUNDS || Date.now() > deadline) {
			stop();
		}
	}
	try {
		events.on?.('node_tree_render_end', onEnd);
		activeCenteringCorrections.set(mindMap, stop);
		// 窗口兜底：窗口内没有渲染落地（或几何始终不可得）时也要停手，不留悬挂监听
		scheduleEngineTimer(mindMap, stop, CENTER_CORRECTION_WINDOW_MS + 50);
	} catch (error) {
		console.warn('登记视口居中补正失败', error);
	}
}

/** 引擎根组（draw）的当前变换；不可得或含非有限值返回 null（调用方回退 DOM 路径） */
function readDrawTransform(mindMap: MindMap): {
	scaleX: number;
	scaleY: number;
	translateX: number;
	translateY: number;
} | null {
	const transform = (
		mindMap as unknown as {
			draw?: {
				transform?: () => {
					scaleX?: unknown;
					scaleY?: unknown;
					translateX?: unknown;
					translateY?: unknown;
				};
			};
		}
	).draw?.transform?.();
	if (!transform) {
		return null;
	}
	const scaleX = Number(transform.scaleX);
	const scaleY = Number(transform.scaleY);
	const translateX = Number(transform.translateX);
	const translateY = Number(transform.translateY);
	if (
		!Number.isFinite(scaleX) ||
		!Number.isFinite(scaleY) ||
		!Number.isFinite(translateX) ||
		!Number.isFinite(translateY)
	) {
		return null;
	}
	return { scaleX, scaleY, translateX, translateY };
}

/**
 * 打开时的默认视口：100% 缩放 + **整体内容居中**（按渲染内容包围盒居中，
 * 不按根节点——根节点居中会让偏心的树偏向一侧）。
 *
 * 语义（含幂等契约、两条测量口径）全在 `centerContentAtScale`，本函数只是
 * `scale = 1` 的具名入口——**视图侧只用它**，勿直接调泛化版（视图的默认视口
 * 恒为 100%，那是产品口径，不是实现细节）。
 */
export function centerContentAtFullScale(mindMap: MindMap | null): void {
	centerContentAtScale(mindMap, 1);
}

/**
 * 按给定比例把**整体内容**居中（`centerContentAtFullScale` 的泛化；供代码块嵌入
 * 的「按宽度适配」复用）。
 *
 * 除比例取值外语义完全一致（含幂等短路的零调用契约、性能模式的数据层几何口径）
 * ——**勿**另写第二份：视图与嵌入的居中判据必须只有一处。
 *
 * 与 `fitMindMap` 的差异：本函数只负责比例与居中，**不做双轴适配**——嵌入的高度
 * 由 `measureContentFitToWidth` 按（比例 × 原高）反算，交本函数对齐即可。
 */
export function centerContentAtScale(
	mindMap: MindMap | null,
	scale: number,
): void {
	if (!mindMap || !(scale > 0)) {
		return;
	}
	try {
		// 先同步引擎几何（SVG 尺寸与缓存矩形），再取**实时容器**做换算：
		// 首帧后容器尺寸/位置可能已变（布局 settle、工具栏重建），沿用
		// 缓存值会把内容按旧画布中心摆放 → 打开即偏移。
		syncCanvasGeometry(mindMap);
		// 一律登记「渲染落地后居中补正」：居中几何可能滞后（尺寸刚变化 / 首帧
		// 未收敛，见 scheduleCenteringCorrection）——先按现有几何走正常流程
		//（即时反馈不变差），渲染落地后补正居中
		scheduleCenteringCorrection(mindMap);
		const size = getCanvasSize(mindMap);
		if (!size) {
			return;
		}
		const transform = readDrawTransform(mindMap);
		const scaleAligned =
			transform !== null &&
			Math.abs(transform.scaleX - scale) < 1e-6 &&
			Math.abs(transform.scaleY - scale) < 1e-6;
		/** 比例未对齐时才 setScale（已对齐时 vendor 也会无条件 emit，属白渲染） */
		const applyScale = (): void => {
			if (!scaleAligned) {
				mindMap.view?.setScale(scale, size.width / 2, size.height / 2);
			}
		};
		// 包围盒口径分两路（性能轮，见 K70）：
		// - 性能模式：**数据层几何并集**（全树、零 DOM）——旧实现先 forceLoadNode
		//   把整树**同步**装配进 DOM 再测 rbox，且打开窗口内被多轮触发（首帧/
		//   重入/兜底/图片回灌），是用户实测「多节点打开卡顿严重」的主因；
		// - 常规模式：DOM 全树在，rbox 精确（含形状描边），行为与旧版一致。
		const dataBox =
			mindMap.opt?.openPerformance && transform !== null
				? measureContentBoxFromData(mindMap)
				: null;
		if (dataBox && transform) {
			// 数据层盒是布局坐标（不含视口变换）：内容中心屏幕位置 =
			// 布局坐标 × scale + translate（引擎 getNodePosInClient 同口径），
			// 平移增量 = 画布中心 - 当前屏幕位置。
			applyScale();
			// 居中复用共享实现：读数在 applyScale 之后现取——setScale 会改变换
			//（scale-in-center 同时移动内容），平移量必须按**改后**的变换算，
			// 否则应用比例那次会少居中一次（同一契约见 fitPerformanceMindMapFromData）
			centerContentByDataBox(mindMap);
			return;
		}
		// 回退：DOM 测量（性能模式下渲染树几何不可得，或常规模式）。
		// rbox 含当前变换（画布内坐标），故本路径与比例无关：先按目标比例
		// setScale，再测「当前变换下的画面盒」，最后把该盒对齐画布中心。
		applyScale();
		const box = measureContentBox(mindMap);
		if (!box) {
			return;
		}
		const dx = (size.width - box.width) / 2 - box.x;
		const dy = (size.height - box.height) / 2 - box.y;
		if (
			Math.abs(dx) < VIEW_CENTER_EPSILON &&
			Math.abs(dy) < VIEW_CENTER_EPSILON
		) {
			// translateXY(0,0) 引擎自身 no-op；显式返回保持「已在目标态零调用」契约
			return;
		}
		mindMap.view?.translateXY(dx, dy);
	} catch (error) {
		// 引擎尚未就绪等边角情况：回退 fit（至少让内容可见）
		console.error('设置默认视口失败', error);
		fitMindMap(mindMap);
	}
}

/**
 * 「按宽度适配」量测（Markdown 代码块嵌入**专用**）：给出容器应有的高度与目标比例。
 *
 * 语义对齐 Obsidian 里 Mermaid 的默认口径（`useMaxWidth` 缺省 true ⇒ SVG
 * `width: 100%` + `max-width: 原宽`）：**只缩不放**（scale ≤ 1），容器高度 =
 * 原高 × scale + 上下留白 ⇒ 内容完整可见且不留空白框（Mermaid 的 mindmap
 * 类型即此口径；Obsidian 只把 flowchart/sequence/git/er 覆盖为绝对尺寸）。
 *
 * ⚠ 与 `fitMindMap` 的差异**必须保留**：vendor fit 是**双轴**适配（宽度与高度
 * 同时塞进画布），而嵌入的高度是由比例**反算**出来的——用双轴适配会自相矛盾
 * （fit 把高度当输入，这里把高度当输出）。
 *
 * @param availableWidth 容器可用宽度（CSS 像素；通常取挂载点的 `clientWidth`）
 * @param padding 四周留白（px）：既进高度，也从可用宽度里扣除
 * @returns `null` = 几何不可得（引擎未就绪 / 渲染树为空），调用方保持现状；
 *          否则给出「挂载点应有的高度 + 与之配套的比例」——不要再回吐输入宽度
 *          （挂载点宽度由 CSS 的 `width: 100%` 决定，回吐属无人消费的第二份真值）
 */
export function measureContentFitToWidth(
	mindMap: MindMap | null,
	availableWidth: number,
	padding = 0,
): { height: number; scale: number } | null {
	if (!mindMap || !(availableWidth > 0)) {
		return null;
	}
	syncCanvasGeometry(mindMap);
	const transform = readDrawTransform(mindMap);
	// **原尺寸**（布局像素）双路：性能模式用数据层并集（零装配），常规模式用
	// DOM rbox 除以当前比例还原（rbox 含当前变换，不还原会把旧缩放当内容尺寸）。
	let natural: { width: number; height: number } | null = null;
	const dataBox = mindMap.opt?.openPerformance
		? measureContentBoxFromData(mindMap)
		: null;
	if (dataBox) {
		natural = { width: dataBox.width, height: dataBox.height };
	} else {
		const box = measureContentBox(mindMap);
		const scaleX = transform?.scaleX ?? 1;
		if (box && scaleX > 0) {
			natural = { width: box.width / scaleX, height: box.height / scaleX };
		}
	}
	if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
		return null;
	}
	const usable = Math.max(1, availableWidth - padding * 2);
	const scale = Math.min(1, usable / natural.width);
	return {
		height: Math.ceil(natural.height * scale + padding * 2),
		scale,
	};
}

/**
 * 渲染内容的包围盒（画布坐标系，左上为原点）。
 * `draw.rbox()` 返回页面坐标（SVG.js 语义，含当前变换），减去容器原点得到
 * 画布内坐标（与引擎 fit 同口径；引擎自身减的是缓存 `elRect`，容器移动过后
 * 会差一个位移量，故这里优先减实时值）。
 */
function measureContentBox(
	mindMap: MindMap,
	origin: { left: number; top: number } | null = getCanvasOrigin(mindMap),
): { x: number; y: number; width: number; height: number } | null {
	const draw = (
		mindMap as unknown as {
			draw?: {
				rbox(): {
					x: number;
					y: number;
					width: number;
					height: number;
				};
			};
		}
	).draw;
	if (!draw?.rbox || !origin) {
		return null;
	}
	const box = draw.rbox();
	return {
		x: box.x - origin.left,
		y: box.y - origin.top,
		width: box.width,
		height: box.height,
	};
}

/** 渲染树节点的数据层几何面（仅取计算所需字段，缺省时调用方回退 DOM 测量） */
interface DataLayerNode {
	readonly left?: unknown;
	readonly top?: unknown;
	readonly width?: unknown;
	readonly height?: unknown;
	readonly children?: readonly DataLayerNode[];
}

/**
 * 可见性判定用的**画布坐标**内容盒。
 *
 * - 普通模式：`measureContentBox`（rbox / 渲染盒，函数内部已换算到画布坐标）；
 * - **性能模式**：视口外节点被引擎回收 ⇒ rbox 只覆盖已加载子集，判定不可靠，
 *   改用 `measureContentBoxFromData`（全树、零 DOM）——它给的是**布局坐标**，
 *   须按 draw 变换换算到画布坐标（与 `centerContentByDataBox` 同一换算）。
 *   大图（≥500 节点必开性能模式）正是「保存视口落界」这条护栏最需要的场景，
 *   此前直接 `return null`（fail-open）等于**护栏不可达**（2026-10-15 审计）。
 *
 * 任一环不可得返回 null：调用方按「无法判定」处理，不误伤合法视口恢复。
 */
function contentBoxForVisibility(
	mindMap: MindMap,
): { x: number; y: number; width: number; height: number } | null {
	if (!mindMap.opt?.openPerformance) {
		return measureContentBox(mindMap);
	}
	const raw = measureContentBoxFromData(mindMap);
	const transform = readDrawTransform(mindMap);
	if (!raw || !transform) {
		return null;
	}
	return {
		x: raw.x * transform.scaleX + transform.translateX,
		y: raw.y * transform.scaleY + transform.translateY,
		width: raw.width * transform.scaleX,
		height: raw.height * transform.scaleY,
	};
}

/**
 * 内容包围盒（**数据层**：渲染树全树节点的布局几何并集，布局坐标系）。
 *
 * 存在理由（K70，用户实测「多节点打开卡顿严重、加载很久」）：
 * 性能模式下视口外节点被引擎回收出 DOM，`draw.rbox()` 只覆盖可见子集 ⇒
 * 旧实现必须 `forceLoadNode()` 把整树**同步**装配进 DOM 再测量（vendor 的
 * forceLoadNode 是同步递归 render），且打开窗口内被多轮触发（首帧渲染结束、
 * 其自身 emit 重入、150ms 兜底、图片回灌补居中）。而布局阶段已为全树写入
 * `left/top/width/height`（引擎裁剪判定 `checkIsInClient` 同源字段），
 * 直接求并集即可——零 DOM 装配、O(n) 纯计算。
 *
 * 字段语义（vendor 实读）：`get left() { return this.customLeft || this._left }`
 * ——拖拽调整过位置的节点用 customLeft/customTop，渲染与判定同样读它，故一致。
 *
 * @returns 全树几何并集；渲染树不可得或几何全不可用时返回 null（调用方回退）
 */
function measureContentBoxFromData(
	mindMap: MindMap,
): { x: number; y: number; width: number; height: number } | null {
	const root = (
		mindMap as unknown as {
			renderer?: { root?: DataLayerNode | null };
		}
	).renderer?.root;
	if (!root) {
		return null;
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const walk = (node: DataLayerNode): void => {
		const left = Number(node.left);
		const top = Number(node.top);
		const width = Number(node.width);
		const height = Number(node.height);
		if (
			Number.isFinite(left) &&
			Number.isFinite(top) &&
			Number.isFinite(width) &&
			Number.isFinite(height)
		) {
			if (left < minX) minX = left;
			if (top < minY) minY = top;
			if (left + width > maxX) maxX = left + width;
			if (top + height > maxY) maxY = top + height;
		}
		const children = node.children;
		if (children) {
			for (const child of children) {
				walk(child);
			}
		}
	};
	walk(root);
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		return null;
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 内容是否还在画布视口内（保存视口恢复后的落界校验）。
 *
 * 保存的变换按「当时的容器尺寸 + 当时的内容布局」记录，容器尺寸大改或内容
 * 布局变化后恢复它，可能把内容推出画布（打开即空白、只剩一角）。
 *
 * @returns `true` 可见；`false` **明确判定**不可见（调用方回退默认居中）；
 *   `null` 无法判定——性能模式下 rbox 只覆盖已加载节点子集，或引擎结构
 *   不可得。调用方对 `null` 应保持原状：fail-open，不误伤合法视口恢复。
 */
export function isContentVisibleInCanvas(
	mindMap: MindMap | null,
): boolean | null {
	if (!mindMap) {
		return null;
	}
	try {
		const size = getCanvasSize(mindMap);
		const box = contentBoxForVisibility(mindMap);
		if (!size || !box) {
			return null;
		}
		// NaN/零尺寸（保存视口损坏）按不可见处理
		if (!(box.width > 0) || !(box.height > 0)) {
			return false;
		}
		const overlapW =
			Math.min(box.x + box.width, size.width) - Math.max(box.x, 0);
		const overlapH =
			Math.min(box.y + box.height, size.height) - Math.max(box.y, 0);
		// 重叠阈值（8px，实现细节不做对外可配置）：内容与画布至少交叠这么多才算「可见」
		const minOverlapPx = 8;
		return (
			overlapW >= Math.min(minOverlapPx, box.width) &&
			overlapH >= Math.min(minOverlapPx, box.height)
		);
	} catch (error) {
		console.warn('检测内容可见性失败', error);
		return null;
	}
}

/**
 * 重置缩放：回到 100%，**以画布中心为锚点**——屏幕上当前可见的导图内容
 * 保持原位（不漂移、不居中、不改平移基准）。
 *
 * 为什么不能只 `setScale(1)`：引擎的平移量是相对画布原点的，只改比例会让
 * 内容绕原点跳动（表现为「视图乱飘」）。引擎的 `scaleInCenter` 会按新比例
 * 反推平移，使锚点处的画面不动；`setScale(scale, cx, cy)` 即该路径。
 *
 * 锚点取**实时容器中心**（经 syncCanvasGeometry 先同步引擎几何；尺寸刚变化时
 * 渲染被提前启动，但不登记居中补正——本操作只改比例、以画布中心为锚，居中
 * 目标由 fit / 打开视口（centerContentAtScale）的补正承担）：容器变化后
 * （`onResize` 节流窗口内）直接读 `mindMap.width/2` 会用陈旧宽度，把内容按
 * 旧中心定位到屏幕上（实机：性能模式大图表现为明显偏右/偏左，见
 * flushPendingLayoutRender）。
 *
 * 边界（已知且可恢复）：若「容器刚变化、布局尚未落地」时直接点重置缩放
 * （未经过 fit），布局落地会把内容整体平移 (W新−W旧)/2——再点一次「适应画布」
 * 即恢复。fit → resetZoom 的主链路不受影响（fit 的补正在前，reset 随后在
 * 稳定几何上执行）。
 */
export function resetZoom(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		syncCanvasGeometry(mindMap);
		const size = getCanvasSize(mindMap);
		const centerX = (size?.width ?? mindMap.width) / 2;
		const centerY = (size?.height ?? mindMap.height) / 2;
		mindMap.view?.setScale(1, centerX, centerY);
	} catch (error) {
		console.error('重置缩放失败', error);
	}
}

// ---------------------------------------------------------------------------
// 画布缩放 / 平移（工具栏与手势入口；层纪律见 engine/mindmap.ts 文件头）
// ---------------------------------------------------------------------------

/** 放大画布（工具栏缩放） */
export function zoomInMindMap(mindMap: MindMap | null): void {
	mindMap?.view.enlarge();
}

/** 缩小画布（工具栏缩放） */
export function zoomOutMindMap(mindMap: MindMap | null): void {
	mindMap?.view.narrow();
}

/**
 * 手势缩放的上下限（仅兜底夹紧，正常滚轮/点击缩放不会触边）。
 * 引擎 enlarge/narrow 自带步进与限制，这里只拦住「滚到 0 或无限大」的极端值。
 */
const MIN_GESTURE_SCALE = 0.1;
const MAX_GESTURE_SCALE = 4;

/** 平移画布（相对位移，屏幕像素） */
export function panMindMap(
	mindMap: MindMap | null,
	dx: number,
	dy: number,
): void {
	if (!mindMap?.view) {
		return;
	}
	try {
		mindMap.view.translateXY(dx, dy);
	} catch (error) {
		console.error('平移画布失败', error);
	}
}

/**
 * 以画布内某点为**锚点缩放**（锚点处画面不动）——对齐 Obsidian Canvas 的
 * `Ctrl/Cmd + 滚轮`缩放（官方帮助 `Plugins/Canvas.md`：press Ctrl or Cmd and
 * scroll using the mouse wheel）。锚点走引擎 `setScale(scale, cx, cy)` 的
 * scaleInCenter 路径（与 resetZoom 同一路径）。
 *
 * @param factor  缩放倍率（>1 放大）
 * @param anchorX 锚点 X（画布内坐标，非屏幕坐标）
 */
export function zoomMindMapAt(
	mindMap: MindMap | null,
	factor: number,
	anchorX: number,
	anchorY: number,
): void {
	if (!mindMap?.view) {
		return;
	}
	try {
		const current = getDrawTransform(mindMap).scaleX;
		const next = Math.min(
			MAX_GESTURE_SCALE,
			Math.max(MIN_GESTURE_SCALE, current * factor),
		);
		mindMap.view.setScale(next, anchorX, anchorY);
	} catch (error) {
		console.error('缩放画布失败', error);
	}
}

/** 当前画布变换（content ↔ 画布视口坐标换算用；异常时回退恒等） */
export interface DrawTransform {
	scaleX: number;
	scaleY: number;
	translateX: number;
	translateY: number;
}

export function getDrawTransform(mindMap: MindMap | null): DrawTransform {
	try {
		const t = mindMap?.view.getTransformData().transform as
			| Partial<DrawTransform>
			| undefined;
		return {
			scaleX: typeof t?.scaleX === 'number' && t.scaleX > 0 ? t.scaleX : 1,
			scaleY: typeof t?.scaleY === 'number' && t.scaleY > 0 ? t.scaleY : 1,
			translateX: typeof t?.translateX === 'number' ? t.translateX : 0,
			translateY: typeof t?.translateY === 'number' ? t.translateY : 0,
		};
	} catch {
		return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
	}
}

/**
 * 视口状态：`view.getTransformData()` 的原始输出（`{ transform, state }`）。
 *
 * **不解释结构**——形状由引擎定义（`state` 是持久化的 `{scale,x,y}`、
 * `transform` 是实时画布变换）。需要具体数值时用 `getDrawTransform`
 * （transform 四分量）或 `getViewportSignature`（state 三分量）。
 */
export type ViewportState = unknown;

/** 读当前视口状态（持久化用）；引擎不可得/读取异常返回 null（已留痕） */
export function readViewportState(mindMap: MindMap | null): ViewportState {
	try {
		return mindMap?.view.getTransformData() ?? null;
	} catch (error) {
		console.warn('读取视口状态失败', error);
		return null;
	}
}

/**
 * 应用保存的视口状态（`setTransformData`）。**不吞异常**：引擎对畸形 state 会抛
 * （`Object.keys(undefined)`，见 vendor View.setTransformData），调用方按
 * 「恢复失败」回退 fit——那条 catch 是既有契约（restoreOrFitViewport）。
 */
export function applyViewportState(
	mindMap: MindMap | null,
	state: ViewportState,
): void {
	if (!mindMap?.view || !state) {
		return;
	}
	mindMap.view.setTransformData(state);
}

/**
 * 视口签名（`scale|x|y`）：**当前视口**的唯一读取面（引擎内部形态收口于此）。
 *
 * 数据源是 `view.getTransformData().state`——与 `readViewportState` 写进
 * data.json 的那份**同源**（幂等短路必须比同一坐标系下的量）；形态异常/读取
 * 失败返回 null，调用方按「无法判定」处理（宁可多渲染一轮，不做错误跳过）。
 *
 * 与 `getDrawTransform` 的关系：后者读 `transform`（实时画布变换，用于坐标
 * 换算），本函数读 `state`（用于「是否已在目标视口」）——**两处不合并**，
 * 合并等于更换幂等判定的比较基准。
 */
export function getViewportSignature(mindMap: MindMap | null): string | null {
	const state = (
		readViewportState(mindMap) as { state?: unknown } | null
	)?.state;
	return viewStateSignature(state);
}

/**
 * 视口状态 → 签名（非对象 / 非有限值 → null）。持久化值（data.json 里的
 * `savedView.state`）与实时值共用本口径——此前该比较实现在 engine-controller
 * 内（`transformSignatureOf`），现由引擎层承担。
 */
export function viewStateSignature(state: unknown): string | null {
	if (!state || typeof state !== 'object') {
		return null;
	}
	const s = state as { scale?: unknown; x?: unknown; y?: unknown };
	const scale = Number(s.scale);
	const x = Number(s.x);
	const y = Number(s.y);
	if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	return `${scale}|${x}|${y}`;
}
