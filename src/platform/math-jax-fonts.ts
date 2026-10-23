/**
 * MathJax 字体在**导出 SVG 内的内联**（2026-10-23 立；A 方案）。
 *
 * ## 为什么必须内联字体
 * MathJax 的排版靠自制字体：普通字符之外，矩阵竖线 / 根号横线 / 分式线 /
 * 大括号 / `Σ` `∫` 的延伸部都由 `MJX-TEX-SO` / `MJX-TEX-S3` 等字体里的字形
 * 拼装（stretchy）。导出 SVG 在 `<img>` 解码的独立文档里渲染，**外部资源
 * （`app://` 字体）被禁**，只剩系统 fallback ⇒ 这些结构整片消失（用户实测：
 * 行列式竖线、分式线、cases 大括号全无）。屏上正常，因为字体就位。
 *
 * ## 为什么可行
 * `data:` URI 属内联资源，SVG-as-image 的 secure static mode **允许**加载；
 * 实测同一份导出图注入内联字体后，stretchy 全部恢复、与屏上同形（PNG/SVG
 * 两条导出路径都验过）。
 *
 * ## 按需裁剪
 * 全量 24 个 woff2 ≈ 295 KB（base64 405 KB）。实测只内联克隆里**实际出现**
 * 的字体族（`TEX-N` / `TEX-SO` / `TEX-S3` + `TEX-ZERO` + `BRK`）即可完整，
 * 探针图 42.8 KB → 289.6 KB（+247 KB）；单行公式通常只 +10 KB 量级。
 *
 * ## 私有触点（AGENTS 规则 9）
 * 字体路径从 `@font-face` 的 `src: url(…)` **现取**（不硬编码），并用
 * `app://obsidian.md` 前缀取字节。任何一步失败 → 返回 null / false，导出链
 * 回退到「剥离 @font-face + 放宽字形裁切」的旧行为（不比现状差）。
 */
import { requestUrl } from 'obsidian';
import { createWarnOnce } from '../core/errors';

/** 一条 `@font-face` 的来源（`family` 为 MathJax 的 `MJX-*` 名） */
export interface MathFontFace {
	readonly family: string;
	readonly url: string;
}

/** 预取结果快照（未就绪时为 null，导出链据此回退） */
export interface MathJaxFontSnapshot {
	readonly faces: readonly MathFontFace[];
	readonly base64ByUrl: ReadonlyMap<string, string>;
}

/** 恒需的字体族：`ZERO` 是所有规则的兜底族，`BRK` 承载换行占位 */
const ALWAYS_INLINE_FAMILIES: readonly string[] = ['MJX-TEX-ZERO', 'MJX-BRK'];

/** `@font-face` 整块（MathJax 的声明带序号注释，大括号前须容忍任意字符） */
const FONT_FACE_BLOCK_RE = /@font-face[^{]*\{[^}]*\}/g;

const FAMILY_RE = /font-family:\s*["']?([^;"'}]+)["']?/;
const URL_RE = /url\((["']?)([^"')]+)\1\)/;

/** 从 CSS 中解析全部 `@font-face`（解析不出 family/url 的块直接忽略） */
export function parseFontFaceSources(css: string): MathFontFace[] {
	const faces: MathFontFace[] = [];
	for (const match of css.matchAll(FONT_FACE_BLOCK_RE)) {
		const family = FAMILY_RE.exec(match[0]);
		const url = URL_RE.exec(match[0]);
		if (family && url) {
			faces.push({ family: family[1]?.trim() ?? '', url: url[2] ?? '' });
		}
	}
	return faces.filter((face) => face.family && face.url);
}

/**
 * 收集克隆 SVG 里出现的 class token（只取 `class` 属性，按空白切分）。
 *
 * 形态异常（宿主查询不可用）→ 空集合，调用方据此回退到旧行为。
 */
export function collectClassTokens(root: Element): Set<string> {
	const tokens = new Set<string>();
	try {
		for (const el of Array.from(root.querySelectorAll('[class]'))) {
			const value = el.getAttribute('class') ?? '';
			for (const token of value.split(/\s+/)) {
				if (token) {
					tokens.add(token);
				}
			}
		}
	} catch {
		return new Set();
	}
	return tokens;
}

/**
 * 由 class token 推出**需要内联**的字体族。
 *
 * MathJax 给公式根与部分字形标了字体类（`mjx-math class="TEX-N"`、
 * `mjx-c class="mjx-c7B TEX-S3"`），去掉 `MJX-` 前缀即 token；再恒加
 * `ZERO` / `BRK`（每族 CSS 都以 `MJX-TEX-ZERO, …` 开头）。
 */
export function collectUsedMathFontFamilies(
	tokens: ReadonlySet<string>,
	faces: readonly MathFontFace[],
): Set<string> {
	const used = new Set<string>();
	for (const face of faces) {
		if (ALWAYS_INLINE_FAMILIES.includes(face.family)) {
			used.add(face.family);
			continue;
		}
		const token = face.family.startsWith('MJX-')
			? face.family.slice('MJX-'.length)
			: face.family;
		if (tokens.has(token)) {
			used.add(face.family);
		}
	}
	return used;
}

/** 字体 URL → `data:` 的 MIME（MathJax 4 用 woff2，兼容 woff/ttf） */
function fontMimeOf(url: string): string {
	const path = url.split('?')[0] ?? url;
	if (path.endsWith('.woff2')) {
		return 'font/woff2';
	}
	if (path.endsWith('.woff')) {
		return 'font/woff';
	}
	if (path.endsWith('.ttf')) {
		return 'font/ttf';
	}
	return 'application/octet-stream';
}

/**
 * 生成注入用的 CSS：**只保留用到**的 `@font-face`，并把它们的 `url(…)` 换成
 * `data:`；未用到的整块删除（原 URL 在导出上下文必然失败）。
 *
 * 用到的族若缺 base64 → 该块同样删除（宁可 fallback，不留失败请求）。
 */
export function inlineMathFontFaces(
	css: string,
	base64ByUrl: ReadonlyMap<string, string>,
	usedFamilies: ReadonlySet<string>,
): string {
	return css.replace(FONT_FACE_BLOCK_RE, (block) => {
		const family = FAMILY_RE.exec(block);
		const url = URL_RE.exec(block);
		if (!family || !url) {
			return '';
		}
		const name = family[1]?.trim() ?? '';
		const src = url[2] ?? '';
		if (!usedFamilies.has(name)) {
			return '';
		}
		const base64 = base64ByUrl.get(src);
		if (!base64) {
			return '';
		}
		return block.replace(
			URL_RE,
			`url("data:${fontMimeOf(src)};base64,${base64}")`,
		);
	});
}

const warnFontsOnce = createWarnOnce();

/** 会话级快照（预取完成后非 null） */
let snapshot: MathJaxFontSnapshot | null = null;
/** 进行中的预取（并发去重） */
let priming: Promise<boolean> | null = null;
/**
 * 已失败过的**样式表内容**：同内容再问就直接 `false`，不再发请求。
 *
 * 按**内容判等**而不是「失败过一次即一票否决」：首次导出常发生在 MathJax 尚未
 * 挂载时（`readMathJaxCss()` 为空 ⇒ 本轮注定失败），若记成会话级不可用，等样式表
 * 挂上后也永远不会再试；内容一变（首次挂载 / 版本切换）说明前提已变，应当重试。
 */
let failedCss: string | null = null;

/** 字节 → base64（分块，避免 `fromCharCode` 参数过多爆栈） */
function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x2000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * 读一个字体文件的字节（候选：`app://obsidian.md` + 裸相对路径）。
 *
 * 每候选先官方 `requestUrl`（lint 口径）、再渲染进程 `fetch`：`app://` 是
 * Obsidian 自定义协议，Electron net 是否解析随版本而异（2026-10-23 实测
 * `fetch` 24/24 成功）。
 */
async function readFontBytes(url: string): Promise<Uint8Array | null> {
	for (const candidate of [`app://obsidian.md${url}`, url]) {
		try {
			const response = await requestUrl({ url: candidate, throw: false });
			if (
				response.status >= 200 &&
				response.status < 300 &&
				response.arrayBuffer.byteLength > 0
			) {
				return new Uint8Array(response.arrayBuffer);
			}
		} catch {
			// 试 fetch
		}
		try {
			// 用 `window.fetch` 而非裸 `fetch`：后者被 no-restricted-globals 禁（要求
			// requestUrl），但 app:// 是自定义协议、requestUrl 不解析（见上），故走
			// 渲染进程的 fetch。语义与裸 fetch 一致（本模块无 popout 窗口上下文）。
			const response = await window.fetch(candidate);
			const buffer = response.ok ? await response.arrayBuffer() : null;
			if (buffer && buffer.byteLength > 0) {
				return new Uint8Array(buffer);
			}
		} catch {
			// 换下一个候选
		}
	}
	return null;
}

/**
 * 预取 MathJax 字体（幂等、并发去重）。全部字体一次性取回：**用哪几个**要等
 * 导出时才知道（取决于该图包含哪些结构），提前按需反而会漏字。
 *
 * @param css 当前 CHTML 样式表（含 `@font-face`），由调用方读取
 * @returns 是否可用（false ＝ 导出链回退旧行为）
 */
export function primeMathJaxFonts(css: string): Promise<boolean> {
	if (snapshot) {
		return Promise.resolve(true);
	}
	if (priming) {
		return priming;
	}
	// 同一份样式表已经失败过 ⇒ 直接 false（否则每次导出都要重发 2×N 个请求）
	if (failedCss === css) {
		return Promise.resolve(false);
	}
	priming = (async (): Promise<boolean> => {
		const faces = parseFontFaceSources(css);
		if (faces.length === 0) {
			warnFontsOnce(
				'MathJax 样式表里没有 @font-face，导出图将退回无字体渲染（stretchy 结构可能缺失）',
			);
			failedCss = css;
			return false;
		}
		const base64ByUrl = new Map<string, string>();
		let failed = 0;
		await Promise.all(
			faces.map(async (face) => {
				const bytes = await readFontBytes(face.url);
				if (bytes) {
					base64ByUrl.set(face.url, toBase64(bytes));
				} else {
					failed += 1;
				}
			}),
		);
		if (base64ByUrl.size === 0) {
			warnFontsOnce(
				'MathJax 字体全部读取失败（app:// 协议不可用？），导出图退回无字体渲染',
			);
			failedCss = css;
			return false;
		}
		if (failed > 0) {
			warnFontsOnce(
				`MathJax 字体有 ${failed} 个读取失败，导出图中对应字形可能缺失`,
			);
		}
		snapshot = { faces, base64ByUrl };
		failedCss = null;
		return true;
	})().finally(() => {
		priming = null;
	});
	return priming;
}

/**
 * 在已就绪的前提下，把 CSS 处理成「仅内联实际用到字体」的版本。
 *
 * @returns 处理后的 CSS；快照缺失/收集失败/无可用族 → null（调用方回退）
 */
export function withInlinedMathFonts(
	css: string,
	root: Element,
	current: MathJaxFontSnapshot | null = snapshot,
): string | null {
	if (!current) {
		return null;
	}
	const used = collectUsedMathFontFamilies(collectClassTokens(root), current.faces);
	if (used.size === 0) {
		return null;
	}
	return inlineMathFontFaces(css, current.base64ByUrl, used);
}
