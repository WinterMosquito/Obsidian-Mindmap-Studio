/**
 * token 颜色的**真探测**：在 holder 的父节点里放一个浅克隆，连读两次
 * `getComputedStyle().color`（裸态 / 带 token 类）以取「该类在当前主题下的实际颜色」。
 *
 * 从 `platform/prism-code.ts` 拆出（2026-10-22，纯搬移，零行为改动）。
 *
 * 为什么单独成文件：这一族只做「读 CSS 算颜色」，不碰 token 结构、不碰缓存策略；
 * 它的失败面（样式面缺失、形态不符）与 `prism-code` 的其它部分完全不同，且
 * 每次调用都要挂/摘探针，属**有副作用的 DOM 操作**——与纯拼装逻辑分开后，
 * 「谁在动宿主 DOM」一眼可见。
 */

/** 一次探测的结果：颜色 + 是否可进共享缓存 */
export interface TokenColorProbe {
	color: string | null;
	cacheable: boolean;
}

/**
 * 真探测：**在 holder 的父节点里**放一个浅克隆，连读两次计算色。
 *
 * 挂载宿主 = `context.parentElement`（`pre.tmm-codeblock`）——与真实元素**同一继承链**，
 * 故 `.token.x` 的规则解析、`.markdown-*` 类作用域、自定义 CSS 片段全部生效。
 * 挂 `document.body` 会丢掉这些作用域（见上方警告）。
 *
 * ⚠ 宿主必须**已挂载**：脱离文档时 `getComputedStyle` 一律返回空串。引擎预测量
 * 副本未挂载 ⇒ 回落 `document.body` 并**标记低置信**（`cacheable: false`，不污染
 * 共享缓存）。挂载在前、颜色不参与布局宽度，故低置信结果对测量无影响。
 *
 * 同步挂→读→移除（同一 task 内完成，中间不发生绘制 ⇒ 无闪烁）；vendor 无
 * `MutationObserver`，引擎不会因这次临时子节点触发额外重排。读取本身强制一次样式
 * 计算，但按「token 类型 × 主题」缓存，实际每主题仅十余次。
 */
export function probeTokenColor(
	tokenClass: string,
	context: HTMLElement | null,
): TokenColorProbe {
	const doc = context?.ownerDocument;
	const win = doc?.defaultView;
	// getComputedStyle 面缺失（测试桩 / 极端环境）→ 不探测
	if (!context || !doc?.body || !win || typeof win.getComputedStyle !== 'function') {
		return { color: null, cacheable: false };
	}
	let probe: HTMLElement | null = null;
	try {
		// 父链在且已挂载 → 精确路径；否则回落 body（低置信）
		const parent = context.parentElement;
		const host = parent && context.isConnected ? parent : doc.body;
		const cacheable = host === parent && !!parent;
		probe = context.cloneNode(false) as HTMLElement;
		probe.className = '';
		host.appendChild(probe);
		const base = win.getComputedStyle(probe).color;
		probe.className = tokenClass;
		const color = win.getComputedStyle(probe).color;
		return { color: color && color !== base ? color : null, cacheable };
	} catch {
		// 形态不符 / 样式面抛错 → 不写内联色（屏上仍由宿主主题着色）
		return { color: null, cacheable: false };
	} finally {
		probe?.remove?.();
	}
}
