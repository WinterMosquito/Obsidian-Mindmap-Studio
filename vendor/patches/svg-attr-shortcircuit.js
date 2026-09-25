/**
 * 自有补丁 · svg.js 属性写「同值短路」（2026-09-25，性能轮实测立项）
 *
 * 背景：引擎整树渲染对每个节点与连线**无条件重写全部属性**（无脏值比对）——
 * 500 节点空 render 实测 2495 次 setAttribute 全部为同值写（真变化 0，K58）。
 * 浏览器对同值 setAttribute 仍产生 mutation 记录 → style/layout invalidation，
 * `verify:visual --perf --perf-ops=rendertick` 实测「一次空 render 落地」的真实
 * 墙钟 = 27.5ms（500 节点 / 非性能模式），是编辑帧成本的最大单项
 * （edit 47.6ms 中占 58%；引擎 JS 侧深拷贝+序列化+比对合计仅 0.8ms）。
 *
 * 修法：包装 svg.js 挂在 Dom 原型上的 attr()——在「单属性、原始值」的直接写
 * 路径上先读后写，值相同则短路整条写入（连同 attr.js 尾部的 rebuild 分支）。
 * 保守边界（零语义风险的来源）：
 *   - 只短路「字符串级相等」：不做 Color / 数值规范化推断 ⇒ 任何规范化差异
 *     都会走原实现（最坏只是漏掉一次短路机会）；
 *   - 对象 / 数组 / getter（仅一个参数）/ remove（value === null）/ 命名空间
 *     （ns 为字符串）路径一律交还原实现；
 *   - 属性当前不存在（getAttribute 返回 null）不短路。
 *
 * 作用域：本补丁经 esbuild 打进 vendor/simple-mind-map.cjs 的**私有模块图**，
 * 只影响该 bundle 内的 svg.js 实例——不触碰宿主页面或其它插件的全局原型。
 *
 * 维护：svg.js 升级、或引擎改走非 attr 的属性写路径时，随 vendor/BUILD.md
 * 「补丁清单」复核本文件（覆盖率判据：rendertick 探针应回落到 JS 比较量级）。
 */
import { G } from '@svgdotjs/svg.js';

/** 沿原型链找到定义 attr 的原型对象（svg.js 经 extend(Dom, { attr }) 挂载） */
function findAttrOwner(ctor) {
	let proto = ctor && ctor.prototype;
	while (proto && !Object.prototype.hasOwnProperty.call(proto, 'attr')) {
		proto = Object.getPrototypeOf(proto);
	}
	return proto || null;
}

const attrOwner = findAttrOwner(G);

if (attrOwner && typeof attrOwner.attr === 'function') {
	const originalAttr = attrOwner.attr;
	attrOwner.attr = function attrWithSameValueShortcircuit(name, value, ns) {
		if (
			typeof name === 'string' &&
			(typeof value === 'string' || typeof value === 'number') &&
			ns === undefined
		) {
			const current = this.node.getAttribute(name);
			if (current !== null && current === String(value)) {
				return this;
			}
		}
		return originalAttr.call(this, name, value, ns);
	};
}
