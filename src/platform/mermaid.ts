/**
 * mermaid 图渲染（**内嵌 Pele**，生产实现的唯一落点）。
 *
 * ## 为什么内嵌而不是用宿主的 `loadMermaid()`
 * Obsidian 1.15 起阅读视图的 mermaid 由 Pele 渲染（`Obsidian/Credits.md` 记
 * Pele 1.12.0），公开 API `loadMermaid()` 返回的是**Pele 的 mermaid 兼容层**。
 * 走宿主有两条硬伤，内嵌都解决了：
 * - **同步性**：兼容层的 `render` 是 `async`（源码含 `$$` 时还要等 MathJax），
 *   而节点自绘内容在 `customCreateNodeContent` 里**同步**构建、引擎随即同步
 *   离屏测宽——异步就只能先占位再替换，要多养一套「定稿 → 重排」会话。
 *   Pele 本身是**纯字符串同步渲染**，首帧即最终形态，测宽窗口里量到的就是真尺寸。
 * - **跨窗口**：`window.pele` 是**按窗口懒加载**的（实测 popout 里为 undefined），
 *   内嵌版不依赖任何全局，popout 天然可用。
 *
 * 版本钉死 `pele@1.13.0`：实测与宿主 1.12.0 对 16 种图类型（flowchart/sequence/
 * class/state/er/mindmap/timeline/pie/gantt/journey/gitGraph/sankey/xychart/
 * kanban/block…）输出**逐字节相同**，故节点里的图与阅读视图观感一致。升级本依赖
 * 时同步核对宿主的 Pele 版本（`Obsidian/Credits.md`），避免「阅读视图能画、节点
 * 画得不一样」。
 *
 * ## 配色
 * SVG 里的颜色全是 `var(--pele-*, 字面兜底)`，而 Obsidian 在 `body` 上定义了
 * 整套 `--pele-*`（映射 `--mermaid-*`）——**同一份 SVG 随主题即时变色**，不需要
 * 重渲染，缓存键也因此**不含主题**。导出图丢掉了宿主 CSS，由
 * `platform/export-svg-postprocess` 把 `--pele-*` 注入克隆 SVG 根（白名单同文件）。
 *
 * ## 缓存
 * 内容寻址（源码 → SVG 字符串），FIFO 淘汰。命中路径是纯同步零计算：节点重建
 * （拖宽 / 重排 / 多视图）不会重复渲染，代价只有一次 XML 解析。
 *
 * ## 为什么不走 innerHTML
 * 项目禁用 `innerHTML`（`no-unsanitized` / `@microsoft/sdl` 双规则，且不允许
 * eslint-disable；同 `prism-code` 的「不经 innerHTML」口径）。这里用
 * `DOMParser` 以 `image/svg+xml` 解析 Pele 的良构 XML，取根元素交调用方 append
 * ——跨文档 append 由 DOM 自动 adopt（popout 场景同样成立）。
 *
 * ## 交互面（P2 / P3，2026-11-09）
 * 图**本身**不参与命中（`<svg>` 是 `pointer-events: none`，拖拽 / 双击 / 选中仍交回
 * 引擎），只有两处子元素显式放行：
 * - **复制源码按钮**（`node-inline-html` 的 `.tmm-code-copy`）：复用代码块按钮的
 *   类名与 `data-code` 契约，点击委托零改动命中；
 * - **图内链接**（Pele 把 mermaid 的 `click A "…"` 渲染成 SVG `<a href>`）：点击由
 *   `features/view-wikilink` 接管（左键 / 修饰键 / 中键三条通道），普通锚点通道的
 *   `instanceof HTMLAnchorElement` 认不出 SVG `<a>`，故单列一条分支。
 *
 * 缩放 / 拖拽**不启用**（`pele.enableZoom` 依赖独立容器，foreignObject 内不适用）。
 *
 * ## 已知边界
 * - **失败即回退**：语法错误 / 未注册类型 / 超限一律返回 null，调用方回落普通
 *   代码块（与 Prism 未登记语言同一条「占位即回退」口径），并 `createWarnOnce`
 *   留一次痕（K85 ①：静默降级会让失效无痕退化）；
 * - **不接管数学**：图内的 `$$…$$` 由 Pele 按普通文本处理，与阅读视图一致。
 */
import { PeleError, render as renderPele } from 'pele';
import { createWarnOnce } from '../core/errors';
import { isSafeAnchorHref } from '../domain/url';

/**
 * 源码长度上限（字符）：超过即**不渲染**、回落代码块。
 *
 * 实测 800 节点链 44 ms / 368 KB SVG，20k 字符留足余量；封顶只为拦住「整篇文档
 * 粘进节点」这类误用，避免每帧重排都要付几十到几百毫秒。Pele 自身另有
 * `limit` / `outputLimit` 的语法与产物体积上限，两者互补。
 */
export const MERMAID_SOURCE_MAX_CHARS = 20000;

/** 产物缓存上限（简单 FIFO 淘汰；超限只影响复用率，不影响正确性） */
const MERMAID_CACHE_MAX = 64;

/** 源码 → SVG 字符串（内容寻址：同一段源码在任何主题下都是同一份 SVG） */
const svgCache = new Map<string, string>();

/**
 * 各失败原因**各一条**留痕（每类跨节点只提醒一次，避免一张坏图刷满控制台）。
 *
 * 逐个原因一份而不是共用一个实例：`createWarnOnce` 是「整实例只输出一次」，
 * 共用会让先发生的那类永久吞掉其它根因（超长 → 语法错误 → 产物非 SVG 全哑）。
 */
const warnTooLong = createWarnOnce();
const warnNotSvg = createWarnOnce();
const warnNotWellFormed = createWarnOnce();
const warnParseFailed = createWarnOnce();
const warnRenderFailed = createWarnOnce();

/**
 * 源码 → SVG 字符串；`null` = **不接管**（调用方回落块级代码块）。
 *
 * 同步、纯函数式（只写本模块缓存）：调用点在节点内容的同步构建路径上，返回值
 * 直接进 DOM，引擎随后的离屏测量量到的就是图的真实宽高。
 */
export function renderMermaidSvg(source: string): string | null {
	if (source.length > MERMAID_SOURCE_MAX_CHARS) {
		warnTooLong(
			`mermaid 源码超过 ${MERMAID_SOURCE_MAX_CHARS} 字符，已回落为代码块`,
		);
		return null;
	}
	const cached = svgCache.get(source);
	if (cached !== undefined) {
		return cached;
	}
	try {
		const { svg } = renderPele(source);
		// 形态守卫：解析器成功但产物不是 SVG 根时按失败处理（不把半截 HTML 塞进节点）。
		// 允许前导 `<?xml …?>` / BOM / 空白：合法 SVG 文档常带它们，旧判据会把
		// 合法产物误判失败、整张图回落成代码块。
		const normalized = svg
			.replace(/^\uFEFF/, '')
			.trimStart()
			.replace(/^<\?xml[^>]*\?>\s*/i, '');
		if (!normalized.startsWith('<svg')) {
			warnNotSvg('mermaid 渲染产物不是 SVG，已回落为代码块', svg.slice(0, 80));
			return null;
		}
		rememberSvg(source, svg);
		return svg;
	} catch (error) {
		if (error instanceof PeleError) {
			// 带位置信息的语法错误：行列对排查有价值的才写进告警
			const at = error.line > 0 ? ` @${error.line}:${error.column}` : '';
			warnRenderFailed(
				`mermaid 渲染失败（${error.code}${at}），已回落为代码块`,
				error.message,
			);
		} else {
			warnRenderFailed('mermaid 渲染失败，已回落为代码块', error);
		}
		return null;
	}
}

/**
 * 源码 → **SVG 根元素**（调用方直接 append）；失败返回 null。
 *
 * 与 `renderMermaidSvg` 的分工：字符串面供单测与调试（无 DOM 依赖），元素面供
 * 节点构建（免 `innerHTML`）。两次调用共享同一份缓存——元素不缓存（每次都从
 * 字符串解析出**新的**节点树），因为 DOM 节点带状态且会被引擎克隆测量，复用同一
 * 实例会让多视图 / 导出克隆互相污染。
 *
 * 解析失败（Pele 产物不是良构 XML）按渲染失败处理：告警一次 + 回落代码块。
 */
export function renderMermaidNode(source: string): Node | null {
	const svg = renderMermaidSvg(source);
	if (svg === null) {
		return null;
	}
	try {
		const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
		const root = parsed.documentElement;
		// `image/svg+xml` 的解析错误会产出 <parsererror> 根（各引擎形态不一），
		// 故只认根元素就是 svg 的结果
		if (root?.localName !== 'svg') {
			warnNotWellFormed('mermaid 产物不是良构 SVG，已回落为代码块');
			return null;
		}
		sanitizeSvg(root);
		return root;
	} catch (error) {
		warnParseFailed('mermaid 产物解析失败，已回落为代码块', error);
		return null;
	}
}

/**
 * 产物里**一律移除**的元素：SVG 图里它们没有语义，只会执行脚本或加载外部资源。
 *
 * `foreignObject` 不在其中：它是 mermaid `htmlLabels` 的正常载体（标签文字），
 * 里面的活动元素同样在本表覆盖范围内（消毒遍历所有后代）。
 */
const FORBIDDEN_SVG_TAGS: ReadonlySet<string> = new Set([
	'script',
	'iframe',
	'object',
	'embed',
	'audio',
	'video',
	'form',
	'input',
	'button',
	'select',
	'textarea',
	'meta',
	'base',
	'link',
]);

/**
 * 挂载前的 SVG 消毒（防御纵深，K101）：Pele 的产物来自用户 mermaid 源码，
 * 项目又禁用 `innerHTML`、以 `DOMParser` 解析后整棵 append——不清洗就会把
 * `<script>` / `on*` / `javascript:` href 一起带进文档。
 *
 * 两条规则（**黑名单**，不是「只留白名单元素」）：活动元素整棵移除
 * （`FORBIDDEN_SVG_TAGS`）、事件属性与不安全 href 逐个摘除；其余元素、文本与
 * 样式原样保留（图的形状与配色不受影响）。
 *
 * 黑名单的固有边界：**未登记的**活动形态（例如 `style` 里的
 * `url(javascript:…)`、未来的新标签）不在此拦截。宿主侧另有一道闸——
 * `DOMParser` 以 `image/svg+xml` 解析、`<script>` 在 SVG 里本就不执行；本函数
 * 只是把明显不该出现的节点挡在文档外。
 */
function sanitizeSvg(root: Element): void {
	const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
	for (const el of all) {
		if (FORBIDDEN_SVG_TAGS.has(el.localName.toLowerCase())) {
			el.remove();
			continue;
		}
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			if (name.startsWith('on')) {
				el.removeAttributeNode(attr);
				continue;
			}
			if (
				(name === 'href' || name === 'xlink:href') &&
				!isSafeAnchorHref(attr.value)
			) {
				el.removeAttributeNode(attr);
			}
		}
	}
}

/** 写入缓存并维持上限（FIFO：Map 的插入序即淘汰序） */
function rememberSvg(source: string, svg: string): void {
	if (svgCache.size >= MERMAID_CACHE_MAX) {
		const oldest = svgCache.keys().next().value;
		if (oldest !== undefined) {
			svgCache.delete(oldest);
		}
	}
	svgCache.set(source, svg);
}

/**
 * 清空产物缓存。
 *
 * 主题切换**不需要**调用它（颜色住在 CSS 变量里，同一份 SVG 自动变色）；只有
 * 单测与被放弃的引擎实例回收场景会用到。
 */
export function clearMermaidCache(): void {
	svgCache.clear();
}

/** 当前缓存条目数（单测断言复用行为用） */
export function mermaidCacheSize(): number {
	return svgCache.size;
}
