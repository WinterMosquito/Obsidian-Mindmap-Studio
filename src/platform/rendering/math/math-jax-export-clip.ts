/**
 * 导出 SVG 的**字形裁切放宽**（2026-10-23 自 `math-jax-export.ts` 拆出）。
 *
 * 为什么单独成文：这是「MathJax 4 的逐字符 clip-path × 导出侧 fallback 字体」
 * 这一条缺陷的**唯一处理点**，与主链（读样式表 / 注入 `<style>`）没有共享状态；
 * 拆开后主链文件回到规模线内，本文件也只做纯字符串改写、可直测。
 */
/**
 * 导出专用：字形纵向裁切余量（`mjx-c` 的 clip-path 上下各放宽到此值）。
 *
 * 0.6em 取自 2026-10-23 的对照实测：**完全移除** clip-path 与**仅放宽纵向到
 * ±0.6em** 光栅化结果逐字节相同（md5 `4c4e4f…`），而 ±2px（MathJax 原值）
 * 会把 fallback 字形裁掉下半。横向仍保留 1em 余量（防斜体字符左右悬垂）。
 */
const EXPORT_GLYPH_CLIP_Y = '0.6em';

/**
 * 拆一个 polygon 点为 x / y 两段。
 *
 * 必须**按括号深度**找分隔空格：x 与 y 都可能是 `calc(100% + 1em)`（自身含空格），
 * 按最后一个空格硬切会把 `calc(…) -2px` 这类点切错（首版踩过：hit 恒 0 → 整条
 * 规则被原样保留、修复静默失效）。
 */
function splitPolygonPoint(point: string): { x: string; y: string } | null {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of point.trim()) {
		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth -= 1;
		}
		if (ch === ' ' && depth === 0) {
			if (current) {
				parts.push(current);
				current = '';
			}
			continue;
		}
		current += ch;
	}
	if (current) {
		parts.push(current);
	}
	if (parts.length !== 2) {
		return null;
	}
	return { x: parts[0] ?? '', y: parts[1] ?? '' };
}

/**
 * 把 `mjx-c` 的 4 点 clip 多边形纵向窗放宽到 ±`EXPORT_GLYPH_CLIP_Y`。
 *
 * 形态不符（点数≠4 / 上下边不是 MathJax 4 的 `-2px` 与 `calc(100% + 2px)`）
 * → 返回 null，调用方原样保留（不猜数值，避免误改未来的新规则）。
 */
function relaxPolygonPoints(points: string): string | null {
	const list = points.split(',');
	if (list.length !== 4) {
		return null;
	}
	let hit = 0;
	const out = list.map((raw) => {
		const point = splitPolygonPoint(raw);
		if (!point) {
			return raw;
		}
		let y = point.y;
		if (y === '-2px') {
			y = `-${EXPORT_GLYPH_CLIP_Y}`;
			hit += 1;
		} else if (y === 'calc(100% + 2px)') {
			y = `calc(100% + ${EXPORT_GLYPH_CLIP_Y})`;
			hit += 1;
		}
		return `${point.x} ${y}`;
	});
	return hit === 4 ? out.join(', ') : null;
}

/**
 * 导出 SVG 专用：放宽 MathJax 逐字符字形（`mjx-c`）的**纵向**裁切窗。
 *
 * 背景（2026-10-23 实机取证）：宿主 MathJax 4.1.3 给 `mjx-c` 加了
 * `clip-path: polygon(-1em -2px, calc(100% + 1em) -2px, calc(100% + 1em)
 * calc(100% + 2px), -1em calc(100% + 2px)) padding-box`——屏上 MJX 字体就位，
 * 字形落在 ±2px 余量内；导出上下文（`<img>` 解码）加载不了 `app://` 字体，
 * fallback 字形更高且基线更低，**下半被该规则裁掉**（用户实测：PNG / SVG
 * 公式都只剩上半）。把纵向窗放宽到 ±0.6em 后公式完整（对照见常量注释）。
 *
 * 只处理选择器含 `mjx-c` 且带 `polygon(…) padding-box` 的规则；其余原样。
 */
export function relaxMathGlyphClipPaths(css: string): string {
	return css.replace(
		/([^{}]+)\{([^{}]*)\}/g,
		(whole: string, selector: string, body: string) => {
			if (!selector.includes('mjx-c')) {
				return whole;
			}
			// 参数内层还有 `calc(…)`（自带括号），故不能用 `[^)]*`——那样会在
			// 第一个 `calc(...)` 的右括号处截断、整条规则匹配失败（首版踩过）。
			const match =
				/clip-path:\s*polygon\(((?:[^()]|\([^()]*\))*)\)\s*padding-box/.exec(
					body,
				);
			if (!match) {
				return whole;
			}
			const relaxed = relaxPolygonPoints(match[1] ?? '');
			if (!relaxed) {
				return whole;
			}
			return `${selector}{${body.replace(
				/clip-path:\s*polygon\((?:[^()]|\([^()]*\))*\)\s*padding-box/,
				`clip-path: polygon(${relaxed}) padding-box`,
			)}}`;
		},
	);
}
