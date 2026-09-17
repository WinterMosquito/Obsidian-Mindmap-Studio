/**
 * 节点宽度（引擎「拖左右边框改宽」）的插件侧收尾。
 *
 * 背景（vendor `simple-mind-map.cjs` 实测）：引擎只对 `isUseCustomNodeContent`
 * 节点给出左右边框的 `ew-resize` 手柄（`checkEnableDragModifyNodeWidth`）＝本插件
 * 的**自绘（富）节点**都能拖宽，拖完引擎做两件事：
 * 1. 每帧写节点字段 `node.customTextWidth` → `reRender([], …)`（**不重建**自绘内容）；
 * 2. 松手 `setData({ customTextWidth })` + `render()`，并派发 `dragModifyNodeWidthEnd`。
 *
 * 而自绘节点的宽高**全部来自内容元素的离屏测宽**，引擎不会替我们把宽度传进去：
 * - 自绘内容读 `customTextWidth` 落到元素样式上（见 `node-inline-content.ts`）；
 * - 松手后显式重建内容（`engine/mindmap.refreshNodeCustomContent`）→ 在新宽度下
 *   重新测宽 → **节点高度随宽度变化**。
 *
 * 缺了第 2 步就是用户报的缺陷：「拖边框改宽后，节点上下高度不会随宽度变化」
 * （2026-09-16）。
 *
 * 已知边界（引擎行为，非缺陷）：**拖拽过程中**高度滞后一拍——引擎每帧的
 * `reRender([])` 不重建自绘内容，故松手时才校正；宽度本身是实时跟随的。
 */
import { refreshNodeCustomContent } from '../engine/mindmap';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';
import { shouldSelfDrawNode } from './node-inline-content';

/**
 * 安装**每节点**的宽度手柄门禁（幂等；在首个节点内容回调里调用即可装上）。
 *
 * 引擎的 `checkEnableDragModifyNodeWidth()` 只看**全局开关**
 * （`enableDragModifyNodeWidth && (richText || isUseCustomNodeContent)`），
 * 而本插件 `isUseCustomNodeContent` 恒为真（自绘通道开着）⇒ **每个节点**都拿到
 * 左右边框手柄；可宽度只有**自绘节点**认（纯文本走 `textAutoWrapWidth` 的 SVG
 * 文本路径，不认 `customTextWidth`）⇒ 纯文本 / 含图节点上的手柄是**死手柄**
 * （拖动毫无反应，用户实测 2026-09-16）。
 *
 * 修法：给 Node 原型的方法加一层「且会被自绘接管」的判定——判据与
 * `buildInlineNodeContent` 同一来源（`shouldSelfDrawNode`），手柄只留在拖动
 * 真正生效的节点上。初始节点也在门禁之内：补丁在**首个内容回调**时装上，而
 * 回调发生在 `createNodeData` 内、早于同一节点的 `initDragHandle`；手柄本身
 * 又是「节点激活时懒创建」（`updateDragHandle` 同样先过这个判定），故不存在
 * 漏网手柄。原型是引擎模块级共享的 Node 类，装一次即覆盖所有节点与后续引擎实例
 * （判定只看节点数据，与实例无关）。
 */
export function gateNodeWidthHandles(node: MindMapNode): void {
	const proto = Object.getPrototypeOf(node) as {
		checkEnableDragModifyNodeWidth?: () => boolean;
		__mindmapStudioWidthGate?: boolean;
	};
	const original = proto?.checkEnableDragModifyNodeWidth;
	if (typeof original !== 'function' || proto.__mindmapStudioWidthGate) {
		return;
	}
	try {
		proto.checkEnableDragModifyNodeWidth = function (
			this: MindMapNode,
		): boolean {
			// 注意：引擎原门禁返回的是 `... && customCreateNodeContent`——即**函数本身**
			// （真值但非布尔 true），故此处只能按真值判断，不能写 `=== true`
			// （写严了会让所有节点都被判为「无手柄」，拖宽整体失效）。
			return Boolean(original.call(this)) && shouldSelfDrawNode(this);
		};
		proto.__mindmapStudioWidthGate = true;
	} catch (error) {
		// 原型冻结等异常：退回「手柄照旧显示」的旧行为，不影响其余功能
		console.error('安装节点宽度手柄门禁失败', error);
	}
}

/**
 * 订阅「拖宽结束」：重建该节点的自绘内容，使节点高度跟随新宽度。
 * 随引擎重建注册/清理（在 setupFeatures 调用，事件绑定器随引擎销毁）。
 */
export function setupNodeWidthRefresh(view: MindMapViewContext): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	// 引擎事件参数：[node]（拖宽结束的那个节点）
	view.engineEvents.onEngine(mindMap, 'dragModifyNodeWidthEnd', (...args: unknown[]) => {
		const node = args[0] as MindMapNode | undefined;
		if (!node) {
			return;
		}
		refreshNodeCustomContent(mindMap, node);
	});
}
