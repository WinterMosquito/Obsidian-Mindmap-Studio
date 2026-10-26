/**
 * 小地图（F12-M）：左下角的自动浮层——俯瞰全图 + 当前视口方框。
 *
 * 三条产品口径（2026-10-24 用户裁决，实现即此）：
 * 1. **无入口**：100% 缩放下内容装不进画布时自动出现，装得下立即消失；
 *    不设按钮 / 命令 / 设置项，也不写 `data.json`；
 * 2. **省**：**启用瞬间就画**（首屏不等节拍），之后每 30s 最多换一次且只在
 *    有改动时换；动图后 30s 无操作即淡出，淡出期间**零重绘、零定时器**；
 * 3. **跟手**：视口框不走重绘，而是用当前变换本地投影（`projectViewportBox`），
 *    平移/缩放每帧更新——图可以慢，框不能迟。
 *
 * 2026-10-25 追加两条（用户裁决）：**悬停不淡出**（指针在面板上时到点也不藏，
 * 离开后重新给满一个空闲窗口）、**滚轮转发给画布**（面板不在画布内，不转发就
 * 「指针压在小地图上缩放失灵」）。连线画不画由**节点数**决定，见 engine 侧
 * `MINIMAP_LINK_NODE_LIMIT`。
 *
 * 2026-10-26 补一条口径：**渲染落地不算用户手势**——淡出后只有用户动作
 * （编辑 / 平移缩放 / 窗口改尺寸 / 四项外观偏好）会把它叫回来；后台重渲染
 * （图片回灌、字体加载、内容重测）只续期已显示的面板，不会重新点亮。
 *
 * 时序状态机（`enabled / ready / visible / dirty / hovering` 五个布尔 + 两个
 * 时间戳）的判定全在 `core/minimap-geometry.nextMiniMapDeadline`，本文件只做
 * 副作用：起停定时器、换图、淡入淡出、悬停保活、滚轮转发、拖拽导航。
 */
import { createThrottler, type Throttler } from '../core/concurrency';
import {
	MINIMAP_IDLE_FADE_MS,
	MINIMAP_MIN_CANVAS_WIDTH_PX,
	MINIMAP_REFRESH_CHECK_MS,
	MINIMAP_REFRESH_INTERVAL_MS,
} from '../core/constants';
import {
	miniMapScale,
	nextMiniMapDeadline,
	projectViewportBox,
	sameMiniMapFrame,
	type MiniMapFrameGeometry,
	type MiniMapMeasure,
	type MiniMapSize,
} from '../core/minimap-geometry';
import {
	captureMiniMap,
	contentExceedsCanvasAtFullScale,
	getCanvasSize,
	getDrawTransform,
	measureMiniMapContent,
	panMindMap,
	type MiniMapFrame,
} from '../engine/mindmap';
import { startWindowDragSession, type WindowDragSession } from './drag-session';
import type { MindMapViewContext } from './view-context';

/**
 * 小地图所需的视图面（引擎实例 + 事件绑定 + 两块 DOM）。
 *
 * **刻意不含 `lang`**：面板不设可访问名、淡出与换图都不提示（见 `setupMiniMap`
 * 的 `role="group"` 说明），取语言进来只会是多一条无人读的装配依赖。
 */
export type MiniMapContext = Pick<
	MindMapViewContext,
	'mindMap' | 'engineEvents' | 'canvasEl' | 'containerEl'
>;

/**
 * 面板/徽标之外的几何缓存（`draw` 时更新）。
 *
 * **视口框投影只读 `content` / `panel`**；`canvas` 仅作 `updateBox` 的兜底
 * （实时量测取不到时）——窗口缩放后它到下一次 `draw` 之前都是旧值（K140）。
 *
 * 直接**继承** `core` 的帧等价口径（`MiniMapFrameGeometry` = 内容盒 + 面板 +
 * 标记指纹），只补视图侧多要的画布尺寸：`sameMiniMapFrame` 判的就是这三项，
 * 若在此另写一份同构接口，改字段时会与判等函数静默脱节。
 */
interface MiniMapGeometry extends MiniMapFrameGeometry {
	canvas: MiniMapSize;
}

interface MiniMapSession {
	/** 所属视图（取当前 mindMap 用；引擎换代后旧会话已置 disposed） */
	view: MiniMapContext;
	win: Window;
	panel: HTMLElement;
	image: HTMLImageElement;
	viewBox: HTMLElement;
	geometry: MiniMapGeometry | null;
	enabled: boolean;
	ready: boolean;
	visible: boolean;
	dirty: boolean;
	lastDrawAt: number;
	lastActivityAt: number;
	timer: number | null;
	timerAt: number;
	boxFrame: number | null;
	drag: WindowDragSession | null;
	/**
	 * 指针是否压在小地图上（2026-10-25 裁决：悬停不淡出）。
	 *
	 * 用户进入面板通常是要拖视口框/读图，30s 到点就藏会打断操作；
	 * 离开时重新起算空闲窗口（见 `setHovering`）。
	 */
	hovering: boolean;
	/**
	 * 「等渲染落地再补画」标记（切布局专用，见 `refreshMiniMapAfterRender`）。
	 *
	 * 布局切换的引擎重排是**异步分片**的：`setLayout` → `RESET_LAYOUT` → 80ms 后
	 * fit，期间渲染树仍是旧几何。此刻强制取样只会把上一套布局画上去，并且把
	 * 30s 刷新窗口一并消耗掉（等真正落地时 `node_tree_render_end` 只置脏，
	 * 不立刻重画）⇒ 实测「切了布局，小地图最长 30s 还是旧图」。
	 */
	drawAfterRender: boolean;
	/**
	 * 启用条件的重判节流：`node_tree_render_end` 在性能模式下按分片连发，
	 * 而判据要读实时容器矩形（强制布局）并遍历全树几何——不能每次渲染都付。
	 * 1s 窗口足够「窗口拉宽/换布局后立刻反应」，又不至于让渲染被拖慢。
	 */
	refreshThrottler: Throttler;
	disposed: boolean;
}

/** 每个视图一份会话（避免给 view.ts 再加字段；引擎换代时整体重建） */
const sessions = new WeakMap<object, MiniMapSession>();

/**
 * 装配小地图（`setupFeatures` 里每代引擎调用一次）。
 *
 * 幂等：先拆旧会话再建新的——引擎重建时旧面板的闭包会持有旧引擎引用。
 */
export function setupMiniMap(view: MiniMapContext): void {
	teardownMiniMap(view);
	if (!view.mindMap || !view.canvasEl) {
		return;
	}
	const win = view.containerEl.win;
	const panel = view.containerEl.createDiv({ cls: 'mindmap-minimap' });
	// **刻意不设 `aria-label`**：Obsidian 核心在 `body` 上委托 `pointerover` + 选择器
	// `[aria-label]`，任何带该属性（哪怕不是 `setTooltip` 写的）的元素都会被弹成可见
	// 的 `div.tooltip`（默认延迟 1s）。面板要「无提示无弹窗」，故只留 `role="group"`
	// 作无名分组，不写可访问名（理由与取证见 K139）。
	panel.setAttribute('role', 'group');
	const image = panel.createEl('img', { cls: 'mindmap-minimap-img' });
	image.setAttribute('draggable', 'false');
	const viewBox = panel.createDiv('mindmap-minimap-view');
	viewBox.addClass('is-hidden');

	const session: MiniMapSession = {
		view,
		win,
		panel,
		image,
		viewBox,
		geometry: null,
		enabled: false,
		ready: false,
		visible: false,
		dirty: false,
		lastDrawAt: 0,
		lastActivityAt: 0,
		timer: null,
		timerAt: 0,
		boxFrame: null,
		drag: null,
		hovering: false,
		drawAfterRender: false,
		refreshThrottler: createThrottler(MINIMAP_REFRESH_CHECK_MS),
		disposed: false,
	};
	sessions.set(view, session);

	const mindMap = view.mindMap;
	const binder = view.engineEvents;
	// 内容/几何变化：重判是否需要小地图，并置脏（下个节拍换图）；
	// 若是「切布局」挂下的补画，则在此刻（几何已落地）立刻重画。
	binder.onEngine(mindMap, 'node_tree_render_end', () => {
		noteChange(session);
		drawWhenLanded(session);
	});
	binder.onEngine(mindMap, 'resize', () => {
		noteChange(session);
		// 窗口尺寸变化是**用户手势**：与渲染落地分流，淡出后也应重新亮起
		// （画布变窄后「100% 下装不下」往往才成立，用户需要它）
		wake(session);
	});
	// 编辑/增删节点：置脏 + 唤醒（图本身晚一步换，30s 节拍）
	binder.onEngine(mindMap, 'data_change', () => {
		session.dirty = true;
		wake(session);
	});
	// **四项外观偏好不走引擎事件**：实测 `setThemeConfig` 既不发 `theme_change`
	// 也不发 `node_tree_render_end`（各 0 次），靠事件会永远等不到——正是
	// 「点了连线按钮小图不动」的根因。改由 `commitPreference` 按各 `apply*` 声明的
	// `miniMap` 调用本文件两个导出：连线/配色/边框立即画、布局等渲染落地。
	// 平移/缩放：唤醒 + 视口框本地投影（不重绘缩略图）
	binder.onEngine(mindMap, 'view_data_change', () => wake(session));
	binder.onDom(panel, 'mousedown', (event) => beginDrag(session, event));
	// 滚轮转发给画布：面板是画布的兄弟节点，不转发就「指针压在小地图上缩放失灵」
	binder.onDom(panel, 'wheel', (event) => forwardWheel(session, event), {
		passive: false,
	});
	// 悬停不淡出（指针在面板上时 30s 到点也不藏）
	binder.onDom(panel, 'mouseenter', () => setHovering(session, true));
	binder.onDom(panel, 'mouseleave', () => setHovering(session, false));

	refresh(session);
}

/**
 * 外观偏好（连线 / 配色 / 边框）改动的**即时重画**入口。
 *
 * 这三项都是「点一下就要看到结果」的同步动作（引擎侧 `setThemeConfig` 还静默、
 * 不发任何事件），等 30s 节拍会被当成「小图没跟着切」；几何不变，故可直接取样。
 *
 * 布局**不走这里**——它的重排是异步分片的，见 `refreshMiniMapAfterRender`。
 */
export function refreshMiniMap(view: MiniMapContext): void {
	const session = sessions.get(view);
	if (!session) {
		return;
	}
	session.dirty = true;
	wake(session, { forceDraw: true });
}

/**
 * 布局切换的刷新入口：**等引擎重排落地**再取样。
 *
 * `setLayout` → `RESET_LAYOUT` → 80ms 后 fit 全是异步的（分片渲染），此刻取样
 * 只能拿到**上一套布局**的几何，还会把 30s 刷新窗口一并消耗掉——实机症状
 * 「切了布局，小地图最长 30s 还是旧图」。故只挂标记，由 `node_tree_render_end`
 * 的 `drawWhenLanded` 补画。
 */
export function refreshMiniMapAfterRender(view: MiniMapContext): void {
	const session = sessions.get(view);
	if (!session) {
		return;
	}
	session.dirty = true;
	session.drawAfterRender = true;
	// 只续期可见性（淡出倒计时），不在这里取样
	wake(session);
}

/** 拆卸（`onClose` 与引擎换代前调用；幂等） */
export function teardownMiniMap(view: MiniMapContext): void {
	const session = sessions.get(view);
	if (!session) {
		return;
	}
	sessions.delete(view);
	session.disposed = true;
	session.refreshThrottler.cancel();
	clearTimer(session);
	session.drag?.end();
	session.drag = null;
	if (session.boxFrame !== null) {
		session.win.cancelAnimationFrame(session.boxFrame);
		session.boxFrame = null;
	}
	session.image.removeAttribute('src');
	session.panel.remove();
}

// ---------------------------------------------------------------------------
// 状态推进
// ---------------------------------------------------------------------------

/**
 * 内容或画布几何变了：置脏 + 节流重判启用条件（已显示则续期 + 重投影视口框）。
 *
 * **不点亮已淡出的面板**（2026-10-26）：渲染落地不是用户手势，后台重渲染
 * （图片回灌 / 字体加载 / 内容重测）不该把用户刚放下的缩略图又叫回来。
 * 用户手势各有入口：`data_change` / `view_data_change` / `resize` 直接 `wake`，
 * 四项外观偏好走 `refreshMiniMap*`；「首次出现」由 `refresh` 的 `reveal` 负责。
 */
function noteChange(session: MiniMapSession): void {
	if (session.disposed) {
		return;
	}
	session.dirty = true;
	session.refreshThrottler.run(() => refresh(session));
	if (session.visible) {
		wake(session);
	}
}

/**
 * 重判启用条件（唯一入口）。
 *
 * 通过即**立刻画第一帧并显示**（2026-10-24 修订：首屏不等 30s 节拍）。
 * 判据本身就是「几何已可取」的证据（画布尺寸 + 内容盒都拿到了），故首帧
 * 通常一次成功；万一失败（渲染树刚好在换代的中间态），保持隐藏，由下一次
 * 渲染落地事件补画。
 */
function refresh(session: MiniMapSession): void {
	if (session.disposed) {
		return;
	}
	const mindMap = session.view.mindMap;
	if (!mindMap) {
		disable(session);
		return;
	}
	// 画布尺寸只有一个来源（`getCanvasSize`：实时矩形 → 引擎缓存 → elRect 兜底）：
	// 此前这里读 `canvasEl.clientWidth`、判据那边另读引擎尺寸，窄画布时两者会差一帧。
	// 取不到就必须早退：下面的全树测量与判据都依赖它，先测一遍等于白遍历。
	const canvasSize = getCanvasSize(mindMap);
	if (!canvasSize || canvasSize.width < MINIMAP_MIN_CANVAS_WIDTH_PX) {
		disable(session);
		return;
	}
	// 判据与首帧取图共用**同一份**全树测量：同一时刻、同一口径，且省一遍遍历
	// （此前判据 1 次 + `buildMiniMapMarks` 内部 1 次 + 取图 1 次）。
	const measured = measureMiniMapContent(mindMap);
	if (contentExceedsCanvasAtFullScale(mindMap, measured, canvasSize) !== true) {
		disable(session);
		return;
	}
	if (!session.enabled) {
		session.enabled = true;
		session.ready = false;
		session.visible = false;
		session.lastDrawAt = 0;
		session.lastActivityAt = Date.now();
	}
	if (!session.ready) {
		// 启用瞬间就画（2026-10-24 修订：首屏不再等 30s 节拍）。
		// 几何未就绪时保持隐藏，等下一次渲染落地事件触发重试（见 wake）。
		reveal(session, measured, canvasSize);
	}
	schedule(session);
}

/**
 * 判据失效：立即消失并清缓存（下次满足时重新按节拍出现）。
 *
 * 早退：「`enabled=false` ∧ `geometry=null`」＝已停用的完整状态——`applyFrame` 是
 * 唯一的写方、本函数是唯一的清方，两者共同维持这个不变量。装得下的导图每次渲染
 * （经 1s 节流后的重判）都会走到这里，没必要重复清四遍样式。
 */
function disable(session: MiniMapSession): void {
	if (!session.enabled && session.geometry === null) {
		return;
	}
	session.enabled = false;
	session.ready = false;
	session.dirty = false;
	session.drawAfterRender = false;
	session.geometry = null;
	session.lastDrawAt = 0;
	// 悬停态必须复位：面板一隐藏（`visibility: hidden` + `pointer-events: none`）
	// 就收不到 `mouseleave`，残留的 `hovering=true` 会让重新启用后的会话永不淡出
	// （`nextMiniMapDeadline` 把隐藏截止时间算成 Infinity），直到用户再划过一次面板。
	session.hovering = false;
	clearTimer(session);
	hide(session);
	// 面板尺寸与视口框坐标都是 `applyFrame` 的产物，不是状态：一并清掉，
	// 否则下次启用若首帧取样失败，会带着**上一套布局的尺寸**显示一块空白面板。
	session.panel.style.removeProperty('width');
	session.panel.style.removeProperty('height');
	session.viewBox.removeAttribute('style');
	session.viewBox.addClass('is-hidden');
	session.image.removeAttribute('src');
}

/**
 * 用户动了图：立刻回来（不等节拍），并重算淡出倒计时。
 *
 * @param options.forceDraw 无视 30s 节拍立刻重画——只给「用户点出来的样式
 *   切换」用（连线形状 / 配色 / 边框），否则点完按钮要等半分钟才看到变化。
 */
function wake(
	session: MiniMapSession,
	options: { forceDraw?: boolean } = {},
): void {
	if (session.disposed || !session.enabled) {
		return;
	}
	// 启用瞬间因几何未就绪没画成：这次事件往往正是「几何落地」的信号，补画
	if (!session.ready) {
		reveal(session);
		schedule(session);
		return;
	}
	const now = Date.now();
	session.lastActivityAt = now;
	if (options.forceDraw === true) {
		// draw 成功即经 applyFrame 排了视口框那一帧；失败则几何未变，重投影是空转
		draw(session);
		show(session);
		schedule(session);
		return;
	}
	if (!session.visible) {
		// 过期图先补一次（间隔已够），避免「先露旧图、下个节拍再跳变」
		if (session.dirty && now - session.lastDrawAt >= MINIMAP_REFRESH_INTERVAL_MS) {
			draw(session);
		}
		show(session);
	}
	// 到这里必然可见（上面刚 show，或本来就可见）
	scheduleBoxUpdate(session);
	schedule(session);
}

/** 起停定时器：只保留**更早**的那个排期（早到的 tick 会自行重算） */
function schedule(session: MiniMapSession): void {
	if (session.disposed) {
		return;
	}
	const now = Date.now();
	const deadline = nextMiniMapDeadline(
		{
			enabled: session.enabled,
			ready: session.ready,
			visible: session.visible,
			dirty: session.dirty,
			lastDrawAt: session.lastDrawAt,
			lastActivityAt: session.lastActivityAt,
			hovering: session.hovering,
		},
		now,
		MINIMAP_REFRESH_INTERVAL_MS,
		MINIMAP_IDLE_FADE_MS,
	);
	if (deadline === null) {
		clearTimer(session);
		return;
	}
	if (session.timer !== null && session.timerAt <= deadline) {
		return;
	}
	clearTimer(session);
	session.timerAt = deadline;
	session.timer = session.win.setTimeout(() => {
		session.timer = null;
		tick(session);
	}, Math.max(0, deadline - now));
}

function clearTimer(session: MiniMapSession): void {
	if (session.timer === null) {
		return;
	}
	session.win.clearTimeout(session.timer);
	session.timer = null;
}

/** 节拍点：到期换图 / 空闲淡出（首次绘制已在启用瞬间完成，不在此列） */
function tick(session: MiniMapSession): void {
	if (session.disposed || !session.enabled) {
		return;
	}
	const now = Date.now();
	// `!ready`：启用瞬间那次绘制因几何未就绪失败，重试交给渲染落地事件
	if (!session.ready || !session.visible) {
		clearTimer(session);
		return;
	}
	// 淡出优先：同一时刻既该换图又该淡出时**先藏**（脏标记保留，等用户动图
	// 回来时再补画）——否则会为一张立刻要藏起来的图白跑一次取样
	if (now - session.lastActivityAt >= MINIMAP_IDLE_FADE_MS) {
		hide(session);
		clearTimer(session);
		return;
	}
	if (session.dirty && now - session.lastDrawAt >= MINIMAP_REFRESH_INTERVAL_MS) {
		draw(session);
	}
	schedule(session);
}

/**
 * 重画缩略图（唯一的重活；每 30s 至多一次，且仅在可见时）。
 *
 * @param measured 同一次 `refresh` 里刚测好的全树几何（省一遍遍历）；节拍与
 *   唤醒路径不传，取图时自测。
 * @param canvasSize 同一次 `refresh` 里刚读到的画布尺寸（省一次实时矩形读取）；
 *   其余路径不传，取图时自测。
 */
function draw(
	session: MiniMapSession,
	measured?: MiniMapMeasure | null,
	canvasSize?: MiniMapSize | null,
): void {
	if (session.disposed) {
		return;
	}
	const mindMap = session.view.mindMap;
	// 注意：这是**尝试**时刻，不是「上一次成功」——失败时也必须推进，否则
	// `nextMiniMapDeadline` 会算出「立刻到期」，tick 与 draw 互相唤醒成自旋。
	session.lastDrawAt = Date.now();
	if (!mindMap) {
		return;
	}
	// 不传测量/画布亦可：`captureMiniMap` 自己会测（两个入参只用来省那两遍读取）
	const frame = captureMiniMap(mindMap, measured, canvasSize);
	if (!frame) {
		// 取样失败（渲染树正处在换代窗口）：把补画挂到下一次渲染落地，
		// 不再等 30s 节拍——否则这次失败会白吃一整个刷新窗口。
		session.drawAfterRender = true;
		return;
	}
	applyFrame(session, frame);
}

/** 把一帧落到面板上（唯一的写入点；**已含**视口框那一帧的排期，调用方勿重复排） */
function applyFrame(session: MiniMapSession, frame: MiniMapFrame): void {
	session.geometry = {
		content: frame.content,
		panel: frame.panel,
		canvas: frame.canvas,
		signature: frame.signature,
	};
	session.panel.style.width = `${frame.panel.width}px`;
	session.panel.style.height = `${frame.panel.height}px`;
	session.image.src = frame.image;
	session.ready = true;
	session.dirty = false;
	// 成功落地即消费「等渲染落地再画」标记（失败路径会重新挂上）
	session.drawAfterRender = false;
	scheduleBoxUpdate(session);
}

/**
 * 切布局的补画（`drawAfterRender` 的唯一消费点，由渲染落地事件驱动）。
 *
 * 四条守卫缺一就会退回「画了旧图」或「把淡出的面板叫回来」：
 * - 取样失败（渲染树又进了换代窗口）→ 保留标记，等下一次渲染落地；
 * - 结果与当前显示的**同一几何** → 这次落地仍早于位置回填（重排是分片的），
 *   保留标记再等一轮；否则会把旧图重画一遍、还白消耗刷新窗口；
 * - 会话已停用（新布局在 100% 下装得下画布）→ 丢弃标记，交给 `refresh` 收尾；
 * - 面板**已淡出** → 照常换图（标记要消费）但不再 `show`（2026-10-26，与
 *   `noteChange` 同口径：渲染落地不是用户手势）。切布局的唤醒在
 *   `refreshMiniMapAfterRender` 里已经发生过，到这一步通常本来就可见。
 */
function drawWhenLanded(session: MiniMapSession): void {
	if (session.disposed || !session.drawAfterRender) {
		return;
	}
	if (!session.enabled) {
		session.drawAfterRender = false;
		return;
	}
	const mindMap = session.view.mindMap;
	// 同一份测量既给取图、也给下面的帧判等（不可在两次取样之间变）
	const measured = mindMap ? measureMiniMapContent(mindMap) : null;
	const frame = mindMap ? captureMiniMap(mindMap, measured) : null;
	if (!frame) {
		return;
	}
	if (session.geometry && sameMiniMapFrame(session.geometry, frame)) {
		return;
	}
	// 渲染落地本身不算用户手势（K137）：只在**原本可见**时续期并保活，
	// 淡出态只换图、不 show——否则后台重渲染会把刚藏起来的面板叫回来
	const wasVisible = session.visible;
	const now = Date.now();
	session.lastDrawAt = now;
	if (wasVisible) {
		session.lastActivityAt = now;
	}
	// applyFrame 内清 dirty / drawAfterRender（唯一消费点，勿在此重复置位）
	applyFrame(session, frame);
	if (wasVisible) {
		show(session);
	}
	schedule(session);
}

function show(session: MiniMapSession): void {
	session.visible = true;
	session.panel.addClass('is-visible');
}

function hide(session: MiniMapSession): void {
	session.visible = false;
	session.panel.removeClass('is-visible');
}

/**
 * 画一帧并显示（启用瞬间 / 唤醒时若尚未就绪）。
 *
 * 失败时保持隐藏且**不排定时器**：重试由下一次渲染落地事件驱动，避免「几何没好
 * 就每 30s 空转一次」——调用方随后一律调 `schedule`（未就绪时它自行返回）。
 *
 * @param measured 同一次 `refresh` 里刚测好的全树几何（可选，省一遍遍历）。
 * @param canvasSize 同一次 `refresh` 里刚读到的画布尺寸（可选，省一次实时矩形读取）。
 */
function reveal(
	session: MiniMapSession,
	measured?: MiniMapMeasure | null,
	canvasSize?: MiniMapSize | null,
): void {
	draw(session, measured, canvasSize);
	if (!session.ready) {
		return;
	}
	show(session);
	// 从**显示时刻**起算淡出倒计时（不是启用时刻：中间可能有失败重试）
	session.lastActivityAt = Date.now();
	// 视口框那一帧已由 applyFrame 排过，这里不重复排
}

// ---------------------------------------------------------------------------
// 视口框（本地投影，每帧至多一次）
// ---------------------------------------------------------------------------

/**
 * 面板像素 → 百分比（一位小数）。
 *
 * 写**百分比**而不是像素：面板宽高带 150ms 过渡（用户要求保留动画），过渡期间
 * 面板实际尺寸 ≠ `geometry.panel`，像素坐标会短暂错位；百分比随面板一起缩放，
 * 与 `img` 的 100%×100% 同步，动画期间也严丝合缝。
 */
function toPercent(value: number, total: number): string {
	return `${Math.round((value / total) * 1000) / 10}%`;
}

function scheduleBoxUpdate(session: MiniMapSession): void {
	if (session.boxFrame !== null) {
		return;
	}
	session.boxFrame = session.win.requestAnimationFrame(() => {
		session.boxFrame = null;
		updateBox(session);
	});
}

function updateBox(session: MiniMapSession): void {
	const geometry = session.geometry;
	const mindMap = session.view.mindMap;
	if (session.disposed || !geometry || !mindMap || !session.visible) {
		session.viewBox.addClass('is-hidden');
		return;
	}
	const box = projectViewportBox({
		content: geometry.content,
		panel: geometry.panel,
		// 画布尺寸读**实时**量测：`geometry.canvas` 只是上次绘制时的快照，窗口
		// 缩放后到下一次 `draw`（最长 30s 刷新窗口）之前都是旧的 ⇒ 框会按旧画布
		// 投影，大小与位置双错（2026-10-26 实机：6× 下宽度停在 14.5%，正确
		// 20.7%；延迟 29.7s）。面板尺寸仍用快照——它必须与面板 DOM 当前值一致
		// （`applyFrame` 写入；CSS 过渡期间百分比随面板同步缩放）。
		canvas: getCanvasSize(mindMap) ?? geometry.canvas,
		transform: getDrawTransform(mindMap),
	});
	if (!box) {
		session.viewBox.addClass('is-hidden');
		return;
	}
	session.viewBox.removeClass('is-hidden');
	const { panel } = geometry;
	session.viewBox.style.left = toPercent(box.x, panel.width);
	session.viewBox.style.top = toPercent(box.y, panel.height);
	session.viewBox.style.width = toPercent(box.width, panel.width);
	session.viewBox.style.height = toPercent(box.height, panel.height);
}

// ---------------------------------------------------------------------------
// 悬停与滚轮（2026-10-25 两条用户裁决）
// ---------------------------------------------------------------------------

/**
 * 指针进入/离开面板：**悬停不淡出**。
 *
 * 离开时把 `lastActivityAt` 重置为现在——否则「空闲 29s 才进入、停 5 分钟再离开」
 * 会在指针一离开就立刻淡出（倒计时起点还是很久以前）。语义是「离开后重新给满
 * 一个空闲窗口」。
 */
function setHovering(session: MiniMapSession, hovering: boolean): void {
	if (session.disposed || session.hovering === hovering) {
		return;
	}
	session.hovering = hovering;
	if (!hovering) {
		session.lastActivityAt = Date.now();
	}
	schedule(session);
}

/**
 * 把滚轮转发给画布。
 *
 * 面板挂在 `containerEl` 下、是画布的**兄弟节点**，而引擎的滚轮处理绑在画布上
 * ⇒ 不转发就「指针压在小地图上缩放失灵」（实机同一 `Ctrl+滚轮`：画布 0.0861→
 * 0.2861，面板完全不动）。
 *
 * 用**重派发**而不是直接调引擎缩放：`Ctrl/Cmd + 滚轮` 的锚点、步进与夹紧都在
 * 引擎里，重派发天然同源；自己算 factor 会与画布上的手感分叉。构造器取自面板
 * 所属窗口（popout 跨 realm），缺失时静默跳过（不阻断，也不抛）。
 */
function forwardWheel(session: MiniMapSession, event: WheelEvent): void {
	const canvas = session.view.canvasEl;
	if (session.disposed || !canvas || !session.visible) {
		return;
	}
	const Ctor = (session.win as unknown as { WheelEvent?: typeof WheelEvent })
		.WheelEvent;
	if (!Ctor) {
		return;
	}
	// 先掐掉自身默认行为：不掐会让页面跟着滚
	event.preventDefault();
	event.stopPropagation();
	canvas.dispatchEvent(
		new Ctor('wheel', {
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			deltaMode: event.deltaMode,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			metaKey: event.metaKey,
			clientX: event.clientX,
			clientY: event.clientY,
			bubbles: true,
			cancelable: true,
		}),
	);
}

// ---------------------------------------------------------------------------
// 拖拽导航
// ---------------------------------------------------------------------------

/**
 * 按下即开始拖拽会话：
 * - 在**方框**上拖：视口跟着指针走（内容反向移动）；
 * - 在**面板空白**拖：内容跟着指针走（等同拖动画布）。
 *
 * 两种方向都来自同一换算式 `k = 当前缩放 / 缩略比例`：面板 1px 对应内容
 * `1/缩略比例`、屏幕 `k` px。
 */
function beginDrag(session: MiniMapSession, event: MouseEvent): void {
	const mindMap = session.view.mindMap;
	const geometry = session.geometry;
	if (event.button !== 0 || !mindMap || !geometry || !session.visible) {
		return;
	}
	const onBox = session.viewBox.contains(event.target as Node | null);
	const scale = getDrawTransform(mindMap).scaleX;
	// 与画框、拼图共用同一比例（`core/minimap-geometry.miniMapScale`），自算会漂移
	const miniScale = miniMapScale(geometry.content, geometry.panel);
	if (!(scale > 0) || !(miniScale > 0)) {
		return;
	}
	const factor = scale / miniScale;
	const direction = onBox ? -1 : 1;
	let lastX = event.clientX;
	let lastY = event.clientY;
	event.preventDefault();
	session.drag?.end();
	session.panel.addClass('is-dragging');
	session.drag = startWindowDragSession({
		win: session.win,
		onMove: (move) => {
			const dx = move.clientX - lastX;
			const dy = move.clientY - lastY;
			lastX = move.clientX;
			lastY = move.clientY;
			panMindMap(mindMap, direction * dx * factor, direction * dy * factor);
			// 拖小地图走的是程序化平移：引擎只发 `translate`、不发 `view_data_change`，
			// 靠事件的话框不会动。这里按帧自己重投影（rAF 合帧由 drag-session 提供）。
			session.drag?.scheduleFrame();
		},
		onUp: () => {
			session.drag = null;
			session.panel.removeClass('is-dragging');
		},
		onFrame: () => updateBox(session),
	});
}
