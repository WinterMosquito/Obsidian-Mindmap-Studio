/**
 * URL / 地址形态谓词的单一权威实现。
 *
 * 此前「这是外部地址吗」散落 5 处、共 3 种不一致的语义
 * （constants.URL_PREFIXES / isExternalOrProtocolUrl / modal 内联判断 /
 * normalizeImageReference 手写前缀链 / md-serialize 的 scheme 正则），
 * app://、file://、obsidian:// 是否算「外部」各处不一。
 * 本模块按语义命名收敛，全部调用方只允许引用这里的谓词：
 *
 * - isHttpUrl               http(s) 网页链接（window.open 场景）
 * - isRemoteOrDataUrl       无法映射到库内文件的远程/数据地址（http/https/data/blob）
 * - isExternalImageRef      外部图片引用（远程/数据地址或 file://，无需库内解析）
 * - isAppResourceUrl        Obsidian 库内资源地址（app://，getResourcePath 输出）
 * - isHyperlinkProtocolUrl  超链接语义的外部/协议地址（http/https/obsidian:///file://）
 * - isSchemeUrl             任意 scheme:// 形态（含自定义协议）
 */

export function isHttpUrl(value: string): boolean {
	return value.startsWith('http://') || value.startsWith('https://');
}

export function isRemoteOrDataUrl(value: string): boolean {
	return (
		isHttpUrl(value) || value.startsWith('data:') || value.startsWith('blob:')
	);
}

export function isExternalImageRef(value: string): boolean {
	return isRemoteOrDataUrl(value) || value.startsWith('file://');
}

export function isAppResourceUrl(value: string): boolean {
	return value.startsWith('app://');
}

/**
 * 资源地址（`app://`）的**库内路径候选**（只提取、不保证存在）。
 *
 * 用途：`links-resolve` 的「资源地址直解」——按路径直查文件、再校验其资源
 * 地址与查询全等，从而**免去为解析一个地址而构建全库索引**（10 万文件的库
 * 实测同步构建 300ms+；直解 ~1µs）。索引仍保留为兜底（历史/非标准形态）。
 *
 * 解析口径（不依赖 Obsidian 的 host 语义，多库前缀 `app://local/`、
 * `app://<id>/` 一律覆盖）：取 `://` 后**第一个 `/` 之后的全部内容**，
 * 截到 `?`/`#` 之前；返回 `[原样串, decodeURIComponent 串]`（相同则去重，
 * decode 失败仅保留原样）。无路径段 / 空路径返回空数组。
 */
export function resourceUrlPathCandidates(url: string): string[] {
	if (!isAppResourceUrl(url)) {
		return [];
	}
	const rest = url.slice('app://'.length);
	const slash = rest.indexOf('/');
	if (slash === -1) {
		return [];
	}
	let path = rest.slice(slash + 1);
	const cut = path.search(/[?#]/);
	if (cut !== -1) {
		path = path.slice(0, cut);
	}
	if (!path) {
		return [];
	}
	const candidates = [path];
	try {
		const decoded = decodeURIComponent(path);
		if (decoded !== path) {
			candidates.push(decoded);
		}
	} catch {
		// 含未编码 % 等字符：仅用原样候选
	}
	return candidates;
}

export function isHyperlinkProtocolUrl(value: string): boolean {
	return (
		isHttpUrl(value) || value.startsWith('obsidian://') || value.startsWith('file://')
	);
}

export function isSchemeUrl(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

/**
 * 可写进 `<a href>` 的**安全协议**白名单（防御纵深，K101）。
 *
 * 节点文本来自 Markdown，形如 `[点我](javascript:alert(1))` 会被解析成外部链接
 * 段；把原文直接写进 `href` 后，一旦宿主按链接打开（中键、右键新标签、Obsidian
 * 的外链委托）即成**脚本执行面**——Obsidian 运行在 Electron 上，`javascript:` /
 * `data:` 这类协议并非只会「打不开」。故此处按白名单收敛，只放行无副作用的协议。
 *
 * 非安全协议**仍按外链样式呈现**，只是不设 `href`：点击由 `view-wikilink` 经
 * `data-href` 分流，插件侧已有 `isHttpUrl` / `isHyperlinkProtocolUrl` 过滤，
 * 功能不受影响（这只是第二道闸）。
 */
const SAFE_ANCHOR_PROTOCOLS = new Set([
	'http:',
	'https:',
	'mailto:',
	'ftp:',
	'ftps:',
	'obsidian:',
	'file:',
]);

export function isSafeAnchorHref(value: string): boolean {
	// 无 scheme（相对地址 / 库内路径 / 纯锚点）视为安全
	const colon = value.indexOf(':');
	if (colon <= 0) {
		return true;
	}
	// 含 scheme：大小写不敏感比对白名单（`JavaScript:` 同拒）
	return SAFE_ANCHOR_PROTOCOLS.has(value.slice(0, colon + 1).toLowerCase());
}

/**
 * 本地绝对路径 → `file:///` URL。
 *
 * 用途：Obsidian 拖入系统文件时，按住 `Ctrl`（Win/Linux）/`Option`（mac）会
 * **不复制进库**、直接写一条指向原位置的绝对链接（官方帮助「Drag and drop」）。
 * 三个分支（形态由路径本身决定，勿统一套 `file:///`）：
 * - 盘符路径 `C:\a\b.pdf` → `file:///C:/a/b.pdf`；
 * - POSIX 绝对路径 `/home/a.pdf` → `file:///home/a.pdf`；
 * - UNC/网络路径 `//server/share/a.pdf` → `file://server/share/a.pdf`。
 *
 * 空格等字符经 `encodeURI` 转义（`%20`）：与 Obsidian/浏览器同口径，也让链接
 * 落在 `(…)` 里不破坏 Markdown 语法。
 */
export function fileUrlFromAbsolutePath(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	const encoded = encodeURI(normalized);
	if (normalized.startsWith('//')) {
		return `file:${encoded}`;
	}
	if (normalized.startsWith('/')) {
		return `file://${encoded}`;
	}
	return `file:///${encoded}`;
}

/**
 * `file:///` URL → 本地绝对路径（交给系统默认应用打开时用）；非 `file://` 返回 null。
 *
 * 与 `fileUrlFromAbsolutePath` 互逆（含 Windows 盘符前导斜杠的还原：`/C:/a` → `C:/a`）。
 * URL 解码失败（含未编码的 `%`）时按原样返回——路径里带 `%` 是常见的真实文件名。
 */
export function absolutePathFromFileUrl(url: string): string | null {
	if (!url.startsWith('file://')) {
		return null;
	}
	let path = url.slice('file://'.length);
	try {
		path = decodeURIComponent(path);
	} catch {
		// 含未编码 % 的路径：按原样
	}
	if (!path) {
		return null;
	}
	if (/^\/[a-zA-Z]:/.test(path)) {
		return path.slice(1);
	}
	if (path.startsWith('/')) {
		return path;
	}
	// `file://server/share` → UNC `//server/share`
	return `//${path}`;
}

/**
 * 独立成串的 URL 文本（scheme:// + 非空白，整串即一个地址，无其他词语）。
 * 语义与 md-outline INLINE_RE 的裸 URL 分支一致（scheme 白名单同步），
 * 用于识别「label 本身是 URL」的 md 链接：节点显示遵循 icon-only 规范，
 * URL 本体不进节点文本。
 */
export function isUrlLikeText(value: string): boolean {
	return /^(?:https?:\/\/|ftp:\/\/|obsidian:\/\/)\S+$/.test(value);
}
