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

export function isHyperlinkProtocolUrl(value: string): boolean {
	return (
		isHttpUrl(value) || value.startsWith('obsidian://') || value.startsWith('file://')
	);
}

export function isSchemeUrl(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}
