/**
 * 补丁 18：结构拖动的落点判定与预览（K205）。
 * 原生布局/命令不变：判定统一到导图坐标，修复缩放后内部 1/4 分区失配；
 * 精确命中优先，未命中时给最近的可见节点 12px 屏幕容差，退出容差 16px。
 * 检测每帧合并，松手按最终指针同步确认；拖动途中只预览，仍由原 mouseup 提交。
 * 只作用于本 bundle 的 Drag 原型，不向 features 暴露引擎私有状态。
 */
import Drag from '../upstream/src/plugins/Drag';

const ENTER_RADIUS = 12;
const EXIT_RADIUS = 16;
const frames = new WeakMap();
const nearbyChecks = new WeakSet();
const originalCheck = Drag.prototype.checkOverlapNode;
const originalBind = Drag.prototype.bindEvent;
const originalUp = Drag.prototype.onMouseup;

function cancelCheck(drag) {
	frames.get(drag)?.();
	frames.delete(drag);
}

function scheduleCheck(drag) {
	if (frames.has(drag)) return;
	const win = drag.mindMap.opt.el?.ownerDocument?.defaultView;
	const run = () => {
		if (!frames.has(drag)) return;
		cancelCheck(drag);
		if (drag.isDragging && drag.isMousedown) checkNow(drag);
	};
	if (win?.requestAnimationFrame) {
		const id = win.requestAnimationFrame(run);
		// 遮挡/无头显示环境可能不派发帧回调；最迟 32ms 检测，谁先执行谁取消另一条。
		const timeout = win.setTimeout(run, 32);
		frames.set(drag, () => { win.cancelAnimationFrame(id); win.clearTimeout(timeout); });
	} else {
		const id = setTimeout(run, 16);
		frames.set(drag, () => clearTimeout(id));
	}
}

/** 原生 Drag 已排除被拖分支；额外排除离屏未挂载和折叠分支，避免吸附隐藏节点。 */
const originalList = Drag.prototype.nodeTreeToList;
Drag.prototype.nodeTreeToList = function () {
	originalList.call(this);
	this.nodeList = this.nodeList.filter(node => {
		if (!node.group?.node?.isConnected) return false;
		for (let parent = node.parent; parent; parent = parent.parent) {
			if (parent.getData('expand') === false) return false;
		}
		return true;
	});
};

function distanceToRect(drag, node, scaleX, scaleY) {
	const rect = drag.getNodeRect(node);
	const dx = Math.max(rect.left - drag.mouseMoveX, 0, drag.mouseMoveX - rect.right) * scaleX;
	const dy = Math.max(rect.top - drag.mouseMoveY, 0, drag.mouseMoveY - rect.bottom) * scaleY;
	return Math.hypot(dx, dy);
}

/** 容差只用于原生未命中的情况；相邻候选等距时保持上帧目标，减少边缘闪烁。 */
function nearbyNode(drag, previous, scaleX, scaleY) {
	let closest = null;
	let distance = ENTER_RADIUS;
	for (const node of drag.nodeList) {
		const next = distanceToRect(drag, node, scaleX, scaleY);
		if (next <= distance) {
			if (next < distance || !closest) closest = node;
			distance = next;
		}
	}
	if (previous && drag.nodeList.includes(previous)) {
		const prior = distanceToRect(drag, previous, scaleX, scaleY);
		if (prior <= EXIT_RADIUS && (!closest || prior <= distance + 3)) return previous;
	}
	return closest;
}

function checkNow(drag) {
	if (!drag.drawTransform || !drag.placeholder) return;
	// 画布边缘自动平移也可能改变变换，检测时读取实时值。
	const transform = drag.mindMap.draw.transform();
	const { scaleX, scaleY, translateX, translateY } = transform;
	if (!(scaleX > 0) || !(scaleY > 0)) return;
	const x = drag.mouseMoveX;
	const y = drag.mouseMoveY;
	const nodes = drag.nodeList;
	const previous = drag.overlapNode || drag.prevNode || drag.nextNode;
	// 原生判断的尺寸/间距与预览坐标全是导图单位；这里只投影指针，不动节点。
	drag.mouseMoveX = (x - translateX) / scaleX;
	drag.mouseMoveY = (y - translateY) / scaleY;
	drag.drawTransform = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
	try {
		originalCheck.call(drag);
		if (!drag.overlapNode && !drag.prevNode && !drag.nextNode) {
			const closest = nearbyNode(drag, previous, scaleX, scaleY);
			if (closest) {
				drag.nodeList = [closest];
				nearbyChecks.add(drag);
				try { originalCheck.call(drag); }
				finally { nearbyChecks.delete(drag); }
			}
		}
		// 明确标出将成为父节点的目标；连线/插入槽仍由引擎原样绘制。
		if (drag.overlapNode) drag.mindMap.execCommand('SET_NODE_ACTIVE', drag.overlapNode, true);
	} finally {
		drag.mouseMoveX = x;
		drag.mouseMoveY = y;
		drag.drawTransform = transform;
		drag.nodeList = nodes;
	}
}

// 只扩展兄弟排列轴的横向命中宽度；上下/左右插入槽仍由原生分区判断。
for (const [key, cross, main, low, high] of [
	['handleVerticalCheck', 'mouseMoveX', 'mouseMoveY', 'left', 'right'],
	['handleHorizontalCheck', 'mouseMoveY', 'mouseMoveX', 'top', 'bottom'],
]) {
	const original = Drag.prototype[key];
	Drag.prototype[key] = function (node, ...args) {
		if (!nearbyChecks.has(this)) return original.call(this, node, ...args);
		const rect = this.getNodeRect(node);
		const crossPos = this[cross];
		const mainPos = this[main];
		this[cross] = Math.max(rect[low], Math.min(rect[high], crossPos));
		// 根节点不参与同级排序，四周容差都表达「挂为子节点」。
		if (node.isRoot) {
			const [start, end] = main === 'mouseMoveY' ? ['top', 'bottom'] : ['left', 'right'];
			this[main] = Math.max(rect[start], Math.min(rect[end], mainPos));
		}
		try { return original.call(this, node, ...args); }
		finally { this[cross] = crossPos; this[main] = mainPos; }
	};
}

Drag.prototype.bindEvent = function () {
	originalBind.call(this);
	// 替换本实例原生 300ms 节流包装，不改共用 throttle 或引擎其它插件。
	this.checkOverlapNode = () => scheduleCheck(this);
};

Drag.prototype.onMouseup = function (event) {
	cancelCheck(this);
	if (this.isMousedown && this.isDragging) {
		if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
			const point = this.mindMap.toPos(event.clientX, event.clientY);
			this.mouseMoveX = point.x;
			this.mouseMoveY = point.y;
		}
		this.drawTransform = this.mindMap.draw.transform();
		checkNow(this);
	}
	return originalUp.call(this, event);
};

for (const key of ['reset', 'unBindEvent']) {
	const original = Drag.prototype[key];
	Drag.prototype[key] = function (...args) {
		cancelCheck(this);
		return original.apply(this, args);
	};
}
