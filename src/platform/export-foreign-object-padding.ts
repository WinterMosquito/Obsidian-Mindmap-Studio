/**
 * 导出 SVG 的 **foreignObject 几何余量**（K106）。
 *
 * 背景：`<img>` 解码的 SVG 独立文档与主文档对**同一内容、同一 CSS 变量、
 * 同一字体**的文本度量存在约 2px 级偏差（2026-09-29 CLI 实机定位，K105
 * 之后的残余边界）——对照实验：同内容在主文档真实 foreignObject 里渲染
 * 1 行（高 26），在 `<img>` 解码路径里换行为 2 行，第二行超出 foreignObject
 * 的固定高度被裁（用户实拍导出图）。根因**不在变量注入**（K105 已实证注入
 * 生效）也**不在字体缺失**（`'??'` 是空壳 @font-face、屏上实际命中系统
 * 字体 Cascadia Mono）——变量注入无法消除该环境级渲染差异，故在导出侧
 * 加几何余量兜底（方案经实机扫描验证：FO 宽 +2px 即恢复单行；2026-09-29
 * 二次实机发现偏差随内容而异——标点/特殊字符密集的长文本行可达 ~12px，
 * 表现为"末字符贴右线"，故余量按分布上界取 {@link PAD_WIDTH}）。
 *
 * 口径：
 * - **宽度 + {@link PAD_WIDTH}**：覆盖实测最大 ~12px 宽度偏差，
 *   把"临界换行"节点救回单行、为长文本行留出视觉右 padding；
 * - **高度 + {@link PAD_HEIGHT}**：兜底——万一某节点仍换行，第二行
 *   **完整可见**而非被裁（保"内容不丢"底线）。
 *
 * 取舍（2026-09-29 实测与推演）：
 * - 加宽后内容右端最大 ≈ 左 padding + 新可用宽 < 节点形状右缘
 *   （形状总宽 = 原 FO 宽，余量在形状内部消耗）→ **不溢出节点形状**；
 * - 不换行时**零视觉差异**（内容够不到新增余量）；
 * - 屏上恰好临界换行的极少数节点，导出可能少一行（罕见，且优于缺字）；
 *   极端节点导出"多一行但完整"（优于"缺半行"）。
 *
 * 接线：组合根 `exportSvgTransforms` 链首（几何校正最先落地，后续
 * transform 在最终几何上工作）。
 */

/**
 * 宽度余量（px）：覆盖实测导出环境文本度量偏差（2026-09-29 实机分布：
 * 轻量节点 ~2px、标点/特殊字符密集的长文本行可达 ~12px——"）"贴右线即其形态）。
 * 安全性：内容右端 ≤ 左 padding + (原可用宽 + 12) < 形状右缘（余量在形状内部
 * 消耗），任何已知节点至少保留 ~4px 视觉右 padding，不溢出形状。
 */
const PAD_WIDTH = 12;

/**
 * 高度余量（px）：≈1 行自绘行高（13px × 1.2 = 15.6，取整留裕）——
 * 仅作"换行也不裁"的兜底，不参与横向布局。
 */
const PAD_HEIGHT = 20;

/**
 * 给克隆 SVG 的每个 foreignObject 增加几何余量。
 *
 * @returns 原样返回传入的 svg.js 元素对象（引擎要求）；对象形态不符、
 *   无 foreignObject 或尺寸属性非法时**原样返回/跳过，不做修改**（安全 no-op）。
 */
export function padForeignObjectsForExport(svgElement: unknown): unknown {
	const root = (svgElement as { node?: Element } | null)?.node;
	if (!root) {
		return svgElement;
	}
	// 直接调用 + 异常兜底（形态不符 → TypeError → 原样返回）。勿改回
	// `typeof root.querySelectorAll !== 'function'` 这类**方法引用**形态：
	// 它会命中 DOM lib 的 deprecated 重载签名（HTMLElementDeprecatedTagNameMap），
	// 触发 no-deprecated 告警；try/catch 写法与 platform/math-jax /
	// features/node-codeblock 的查询形态同款（lib 无 DOM.Iterable，须 Array.from）。
	let list: Element[];
	try {
		list = Array.from(root.querySelectorAll('foreignObject'));
	} catch {
		return svgElement;
	}
	for (const fo of list) {
		const width = Number.parseFloat(fo.getAttribute('width') ?? '');
		const height = Number.parseFloat(fo.getAttribute('height') ?? '');
		if (!Number.isFinite(width) || !Number.isFinite(height)) {
			continue; // 非法尺寸：跳过该 FO（保持原状）
		}
		// 只改尺寸、不动 x/y：可用文本区向右/下扩展，与形状左缘保持对齐
		fo.setAttribute('width', String(width + PAD_WIDTH));
		fo.setAttribute('height', String(height + PAD_HEIGHT));
	}
	return svgElement;
}
