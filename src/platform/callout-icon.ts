/**
 * 标注图标的**宿主解析**（2026-11-11）：`getIcon` 的唯一收口。
 *
 * ## 为什么单独一层
 * `features/node-inline-*` 必须保持零 Obsidian 依赖（可在无运行时的页面里打包 /
 * 单测，见 `node-inline-tokenize` 文件头），图标只能**注入**——注入面是
 * `InlineContentOptions.resolveCalloutIcon(iconId)`，本文件是它的生产实现，
 * 与 `platform/mermaid` / `platform/prism-code` 同一形态。
 *
 * ## 为什么用 `getIcon` 而不是自带一份 SVG 路径
 * 官方帮助自己就写明「Lucide 图标会定期更新」，抄一份 24×24 路径等于把一份会漂移
 * 的几何固化进插件（`engine/mindmap-icons` 的文档页图标是**本插件自绘**的语义图标，
 * 与这里不同：那是我们的图形，这里必须是宿主的图形）。`getIcon` 未登记时返回
 * null ⇒ 调用方省略图标、保留标题与类型色（装饰缺失不影响可读性）。
 *
 * ## 尺寸与配色（两处都刻意内联）
 * - **尺寸**：宿主 `.svg-icon` 的 `width/height` 取自 `--icon-size` 变量，节点内
 *   需要与标题行文字对齐的确定值 ⇒ 写死 14px（属性 + 内联样式各一份：属性给导出
 *   序列化，样式压过 `.svg-icon` 的类规则）；
 * - **配色**：lucide 的 `stroke="currentColor"`，故颜色由父链决定；这里显式写
 *   `color: inherit`，压掉任何给 `.svg-icon` 上 `--icon-color` 的规则——标注图标的
 *   颜色必须等于类型色（与宿主 `.callout-icon .svg-icon { color: var(--callout-color) }`
 *   同一条语义），否则屏上是灰图标、与标题不同色。
 *
 * ## 缓存
 * 按 id 缓存**模板**（`getIcon` 每次都会从注册表克隆，缓存省的是查表 + 解析）；
 * 每次调用返回 `cloneNode(true)`——同一个节点被多个标注复用会让 DOM 出现"元素
 * 只有最后一个父节点"的静默丢失（appendChild 会搬走前一个）。
 */
import { getIcon } from 'obsidian';

/** 图标显示边长（px）：与 14px 正文的字形高度对齐，不顶高标题行 */
const CALLOUT_ICON_SIZE = 14;

/**
 * 图标的内联样式（**模块级一次**）：尺寸写死 + `color: inherit`。
 *
 * `color` 必须显式压掉：宿主 `.svg-icon { color: var(--icon-color) }` 会把图标
 * 涂成图标灰，而官方语义是「图标 = 类型色」（`.callout-icon .svg-icon` 取
 * `--callout-color`）；继承标题行的类型色才与阅读视图一致。
 */
const ICON_STYLE: Partial<CSSStyleDeclaration> = {
	width: `${CALLOUT_ICON_SIZE}px`,
	height: `${CALLOUT_ICON_SIZE}px`,
	color: 'inherit',
};

/**
 * id → 宿主图标模板（**只缓存命中**）。
 *
 * 否定结果不缓存：`getIcon` 读的是**可被其它插件 / 图标包扩充**的全局注册表，
 * 把「此刻没有」钉死会让晚注册的图标在整个会话里永久缺失，且告警已被
 * `warnOnce` 吞掉（2026-11-12 审核：只剩「标题少一枚图标」这一处可见退化）。
 * 未命中时每次渲染重查一次 Map，代价可忽略。
 */
const iconTemplates = new Map<string, SVGSVGElement>();

/** 已告警的键（`icon-api` = getIcon 面缺失；其余为具体图标 id）：同一件事只报一次 */
const warned = new Set<string>();

/** 一次性 warn（同 `math-jax` 的 API 面缺失口径：可见降级必须留痕，但不刷屏） */
function warnOnce(key: string, message: string): void {
	if (warned.has(key)) {
		return;
	}
	warned.add(key);
	console.warn(message);
}

/**
 * 图标 id → **可挂载的 `<svg>` 节点**；宿主没有该 id 时返回 null。
 *
 * 幂等、无副作用（只读宿主注册表 + 克隆），可对同一 id 反复调用。
 */
export function resolveCalloutIcon(iconId: string): Node | null {
	if (!iconId) {
		return null;
	}
	let template = iconTemplates.get(iconId);
	if (template === undefined) {
		let resolved: SVGSVGElement | null = null;
		try {
			resolved = getIcon(iconId);
		} catch {
			// 宿主图标面异常（老版本 / 插件冲突）：按"没有这个图标"处理，
			// 不把异常抛进节点渲染（那会让整块内容建不出来）
			resolved = null;
			warnOnce(
				'icon-api',
				'[Mindmap-Studio] 宿主 getIcon 不可用（版本或环境异常），标注只显示类型色、不显示图标。',
			);
		}
		if (resolved) {
			// 只缓存命中（见 iconTemplates 说明）：否定结果随注册表变化即时重查
			iconTemplates.set(iconId, resolved);
			template = resolved;
		} else {
			// 与 `math-jax` 的「API 面缺失告警一次」同口径：图标缺失是**可见降级**
			// （标题行少一枚图标），留一条痕便于实机定位，且每个 id 只报一次
			warnOnce(
				iconId,
				`[Mindmap-Studio] 宿主未登记标注图标 id「${iconId}」，该类型只显示类型色。`,
			);
		}
	}
	if (!template) {
		return null;
	}
	const icon = template.cloneNode(true);
	const styled = icon as unknown as SVGElement;
	styled.setAttribute('width', String(CALLOUT_ICON_SIZE));
	styled.setAttribute('height', String(CALLOUT_ICON_SIZE));
	// 内联样式（属性给导出序列化，样式压过 `.svg-icon` 的类规则）；经
	// `Object.assign` 写表而不是逐条直赋字面量（`obsidianmd/no-static-styles-assignment`
	// 按 AST 拦「赋值右侧直接是字面量」，与 `node-inline-html` 同一手法，K91 ⑩）。
	// 表在模块级构造一次——每次调用现造一个对象只是白给 GC 添活
	Object.assign(styled.style, ICON_STYLE);
	return icon;
}
