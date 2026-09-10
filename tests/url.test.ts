/**
 * URL / 地址形态谓词单元测试（domain/url.ts）。
 *
 * 为什么需要这一层密集覆盖：这些谓词是 images-path、modal-image、md-serialize、
 * view-wikilink、view（系统打开/外跳）的共同依赖；此前同一问题（「这是外部地址吗」）
 * 散落 5 处、3 种互不一致的语义，app:// / file:// / obsidian:// 是否算「外部」各处
 * 不一 —— 本模块按语义命名收敛后，这里把每种语义的**命中集**与**否决集**
 * 逐条锁定，并额外用「同一地址 × 全部谓词」的语义矩阵锁死它们之间的差异
 * （file:// 是外部图片与超链接、却不是远程/数据地址；app:// 只算库内资源）。
 *
 * 断言原则：全部对齐当前 src/domain/url.ts 实现（含协议大小写敏感、前缀判定
 * 不做 URL 合法性校验、空白/换行拦截等真实边界），不使用恒真断言。
 */
import { describe, expect, it } from 'vitest';
import {
	isAppResourceUrl,
	isExternalImageRef,
	isHttpUrl,
	isHyperlinkProtocolUrl,
	isRemoteOrDataUrl,
	isSchemeUrl,
	isUrlLikeText,
} from '../src/domain/url';

describe('isHttpUrl', () => {
	it.each([
		{ value: 'http://example.com', expected: true, why: 'http 明文' },
		{ value: 'https://example.com/a?b=1#c', expected: true, why: 'https + 查询串 + 锚点' },
		{ value: 'https://', expected: true, why: '纯前缀（只做 startsWith，不校验主机名）' },
		{ value: 'http://localhost:3000/x', expected: true, why: '本地端口' },
		{ value: 'HTTP://example.com', expected: false, why: '协议大小写敏感' },
		{ value: 'Https://example.com', expected: false, why: '混合大小写同样否决' },
		{ value: 'httpx://example.com', expected: false, why: '前缀更长也算否决（须紧跟 ://）' },
		{ value: 'http:/example.com', expected: false, why: '单斜杠' },
		{ value: '//example.com', expected: false, why: '协议相对地址' },
		{ value: 'ftp://files.example.com/a.zip', expected: false, why: 'ftp 属外部但非 http' },
		{ value: 'obsidian://open', expected: false, why: '自定义协议' },
		{ value: 'file:///C:/a.png', expected: false, why: '本地文件' },
		{ value: 'app://abc/icon.png', expected: false, why: '库内资源地址' },
		{ value: 'data:image/png;base64,AAAA', expected: false, why: '数据地址' },
		{ value: 'images/pic.png', expected: false, why: '库内相对路径' },
		{ value: '', expected: false, why: '空串' },
	])('isHttpUrl($value) === $expected（$why）', ({ value, expected }) => {
		expect(isHttpUrl(value)).toBe(expected);
	});
});

describe('isRemoteOrDataUrl', () => {
	it.each([
		{ value: 'https://cdn.example.com/a.png', expected: true, why: 'https 远程' },
		{ value: 'http://cdn.example.com/a.png', expected: true, why: 'http 远程' },
		{ value: 'data:image/png;base64,AAAA', expected: true, why: '内联数据地址' },
		{ value: 'data:', expected: true, why: '前缀即命中（不校验 media type）' },
		{ value: 'blob:https://example.com/uuid', expected: true, why: 'blob 对象地址' },
		{ value: 'blob:', expected: true, why: 'blob 前缀' },
		{ value: 'file:///C:/a.png', expected: false, why: '本地文件可映射到库内，不属远程/数据' },
		{ value: 'app://abc/icon.png', expected: false, why: '库内资源地址' },
		{ value: 'DATA:image/png;base64,AAAA', expected: false, why: '协议大小写敏感' },
		{ value: 'Blob:x', expected: false, why: '协议大小写敏感' },
		{ value: 'data', expected: false, why: '无冒号' },
		{ value: 'attachments/a.png', expected: false, why: '库内相对路径' },
		{ value: '', expected: false, why: '空串' },
	])('isRemoteOrDataUrl($value) === $expected（$why）', ({ value, expected }) => {
		expect(isRemoteOrDataUrl(value)).toBe(expected);
	});
});

describe('isExternalImageRef', () => {
	it.each([
		{ value: 'https://cdn.example.com/a.png', expected: true, why: '远程图片' },
		{ value: 'http://cdn.example.com/a.png', expected: true, why: 'http 图片' },
		{ value: 'data:image/png;base64,AAAA', expected: true, why: 'data 图片' },
		{ value: 'blob:https://example.com/uuid', expected: true, why: 'blob 图片' },
		{ value: 'file:///C:/a.png', expected: true, why: 'file:// 无需库内解析，直接作 img src' },
		{ value: 'file://', expected: true, why: '前缀即命中' },
		{ value: 'file:/C:/a.png', expected: false, why: '单斜杠不是 file:// 形态' },
		{ value: 'FILE:///C:/a.png', expected: false, why: '协议大小写敏感' },
		{ value: 'app://abc/attachments/a.png', expected: false, why: '库内资源地址（走 getResourcePath 通道）' },
		{ value: 'C:/Users/me/a.png', expected: false, why: 'Windows 绝对路径不是 file:// 形态' },
		{ value: 'attachments/a.png', expected: false, why: '库内相对路径' },
		{ value: '', expected: false, why: '空串' },
	])('isExternalImageRef($value) === $expected（$why）', ({ value, expected }) => {
		expect(isExternalImageRef(value)).toBe(expected);
	});

	it('严格蕴含 isRemoteOrDataUrl 的命中集（data/blob/http 全在外部图片集内）', () => {
		// 为什么这样断言：images-path 用本谓词决定「跳过库内解析」，
		// 若它漏掉任一远程形态，图片会被错误送进库内查找并静默失败。
		for (const value of [
			'https://cdn.example.com/a.png',
			'http://x',
			'data:image/png;base64,AA',
			'blob:https://e/u',
		]) {
			expect(isRemoteOrDataUrl(value)).toBe(true);
			expect(isExternalImageRef(value)).toBe(true);
		}
	});
});

describe('isAppResourceUrl', () => {
	it.each([
		{ value: 'app://abc/attachments/a.png', expected: true, why: 'getResourcePath 输出形态' },
		{ value: 'app://unc/有中文.png?v=1', expected: true, why: 'Unicode 路径与查询串' },
		{ value: 'app://', expected: true, why: '前缀即命中' },
		{ value: 'app:/abc/a.png', expected: false, why: '单斜杠' },
		{ value: 'APP://abc/a.png', expected: false, why: '协议大小写敏感' },
		{ value: 'https://example.com', expected: false, why: '远程地址' },
		{ value: 'attachments/a.png', expected: false, why: '库内相对路径' },
		{ value: '', expected: false, why: '空串' },
	])('isAppResourceUrl($value) === $expected（$why）', ({ value, expected }) => {
		expect(isAppResourceUrl(value)).toBe(expected);
	});

	it('库内资源地址与外部图片引用互斥（app:// 不得进外部图片通道）', () => {
		expect(isAppResourceUrl('app://abc/a.png')).toBe(true);
		expect(isExternalImageRef('app://abc/a.png')).toBe(false);
		expect(isRemoteOrDataUrl('app://abc/a.png')).toBe(false);
	});
});

describe('isHyperlinkProtocolUrl', () => {
	it.each([
		{ value: 'https://example.com', expected: true, why: '网页超链接' },
		{ value: 'http://localhost:3000', expected: true, why: '本地 http' },
		{ value: 'obsidian://open?vault=v&file=a', expected: true, why: '库内 URI 跳转' },
		{ value: 'file:///C:/doc.pdf', expected: true, why: '本地文件交系统/浏览器打开' },
		{ value: 'file://', expected: true, why: '前缀即命中' },
		{ value: 'obsidian:open', expected: false, why: '缺 // 的 URI 形态否决' },
		{ value: 'folder/note.md', expected: false, why: '库内路径' },
		{ value: 'data:text/plain,hi', expected: false, why: 'data 不走浏览器打开' },
		{ value: 'blob:https://example.com/u', expected: false, why: 'blob 同上' },
		{ value: 'app://abc/icon.png', expected: false, why: '库内资源地址' },
		{ value: 'mailto:someone@example.com', expected: false, why: '无 //（与 isSchemeUrl 判定一致）' },
		{ value: 'ftp://files.example.com/a.zip', expected: false, why: 'ftp 不在白名单内' },
		{ value: 'C:/notes/note.md', expected: false, why: 'Windows 盘符否决' },
		{ value: '', expected: false, why: '空串' },
	])('isHyperlinkProtocolUrl($value) === $expected（$why）', ({ value, expected }) => {
		expect(isHyperlinkProtocolUrl(value)).toBe(expected);
	});
});

describe('isSchemeUrl', () => {
	it.each([
		{ value: 'obsidian://open', expected: true, why: '标准自定义协议' },
		{ value: 'zotero://select/library/items/ABC', expected: true, why: '第三方应用协议' },
		{ value: 'x-cocoa-12345://run', expected: true, why: 'scheme 允许字母/数字/+-.' },
		{ value: 'a+b.c-d://x', expected: true, why: '全部合法符号组合' },
		{ value: 'a://', expected: true, why: '最短合法 scheme' },
		{ value: 'HTTP://EXAMPLE.COM', expected: true, why: 'scheme 大小写不敏感（与 http 前缀谓词不同）' },
		{ value: 'file:///C:/a.png', expected: true, why: 'file 也是 scheme' },
		{ value: 'app://abc', expected: true, why: 'app 也是 scheme' },
		{ value: 'mailto:someone@example.com', expected: false, why: '无 // 的 URI 不算 scheme://' },
		{ value: '1abc://x', expected: false, why: 'scheme 必须以字母开头' },
		{ value: '-abc://x', expected: false, why: '首字符非字母' },
		{ value: 'a_b://x', expected: false, why: '下划线不属 scheme 合法字符' },
		{ value: '://x', expected: false, why: '空 scheme' },
		{ value: 'a:/x', expected: false, why: '单斜杠' },
		{ value: 'folder/note.md', expected: false, why: '相对路径' },
		{ value: 'C:/notes/note.md', expected: false, why: 'Windows 盘符（单斜杠形态）否决' },
		{ value: '', expected: false, why: '空串' },
	])('isSchemeUrl($value) === $expected（$why）', ({ value, expected }) => {
		expect(isSchemeUrl(value)).toBe(expected);
	});
});

describe('isUrlLikeText', () => {
	it.each([
		{ value: 'https://example.com/a/very/long/path', expected: true, why: '长路径独立 URL' },
		{ value: 'http://example.com', expected: true, why: '最简 http' },
		{ value: 'ftp://files.example.com/a.zip', expected: true, why: 'ftp 在白名单内' },
		{ value: 'obsidian://open?vault=v&file=f', expected: true, why: '库内 URI' },
		{ value: 'obsidian://', expected: false, why: ':// 之后无非空白字符（\\S+ 至少一个）' },
		{ value: 'https://example.com/a.png?w=1#f', expected: true, why: '查询串与锚点均非空白' },
		{ value: 'https://例子.测试/路径', expected: true, why: 'Unicode 非空白字符合法' },
		{ value: 'see https://example.com here', expected: false, why: '混在词语中：整串须是一个地址' },
		{ value: ' https://example.com', expected: false, why: '前导空格' },
		{ value: 'https://example.com ', expected: false, why: '尾随空格' },
		{ value: 'https:// example.com', expected: false, why: 'scheme 后紧跟空格' },
		{ value: 'https://example.com/a b', expected: false, why: '内部空格' },
		{ value: 'https://a\nhttps://b', expected: false, why: '换行阻断 \\S+（$ 非多行模式）' },
		{ value: 'https://example.com/a\tb', expected: false, why: '制表符亦属空白' },
		{ value: 'https://', expected: false, why: 'scheme 后无非空白字符（\\S+ 至少一个）' },
		{ value: 'HTTPS://example.com', expected: false, why: '白名单大小写敏感' },
		{ value: 'file:///C:/a.png', expected: false, why: 'file:// 不在白名单' },
		{ value: 'app://abc/icon.png', expected: false, why: 'app:// 不在白名单' },
		{ value: 'blob:https://example.com/uuid', expected: false, why: '不以白名单 scheme 开头' },
		{ value: 'zotero://select/x', expected: false, why: '任意 scheme 但非白名单（与 isSchemeUrl 的差异点）' },
		{ value: 'obsidian:open', expected: false, why: '缺 //' },
		{ value: 'mailto:a@b.c', expected: false, why: '非 :// 形态' },
		{ value: '普通文本', expected: false, why: '中文普通词语' },
		{ value: 'images/pic.png', expected: false, why: '库内相对路径' },
		{ value: '', expected: false, why: '空串' },
	])('isUrlLikeText($value) === $expected（$why）', ({ value, expected }) => {
		expect(isUrlLikeText(value)).toBe(expected);
	});

	it('与 isSchemeUrl 的语义差：本谓词是白名单，scheme 谓词是任意协议', () => {
		// 为什么这样断言：md 链接的「label 本身是 URL」判定必须与 md-outline
		// 的行内裸 URL 分支（同一白名单）保持一致，若误用 isSchemeUrl，
		// zotero:// 之类会被误判为 URL 而从节点文本中抹掉。
		expect(isSchemeUrl('zotero://select/x')).toBe(true);
		expect(isUrlLikeText('zotero://select/x')).toBe(false);
		expect(isUrlLikeText('ftp://a/b')).toBe(true);
		expect(isSchemeUrl('ftp://a/b')).toBe(true);
	});
});

/** 同一地址在六种语义下的分流；why 说明该行的差异要害 */
interface SemanticsRow {
	value: string;
	why: string;
	http: boolean;
	remoteOrData: boolean;
	externalImage: boolean;
	appResource: boolean;
	hyperlink: boolean;
	scheme: boolean;
}

describe('谓词语义矩阵（同一地址 × 全部谓词，锁定彼此的差异）', () => {
	it.each<SemanticsRow>([
		{
			value: 'https://example.com/a.png',
			why: '远程图片：http/远程/外部图片/超链接/scheme 全真，仅库内资源为假',
			http: true,
			remoteOrData: true,
			externalImage: true,
			appResource: false,
			hyperlink: true,
			scheme: true,
		},
		{
			value: 'data:image/png;base64,AAAA',
			why: '内联数据：算远程/外部图片，但不是 http 也不是可打开的超链接，且无 ://',
			http: false,
			remoteOrData: true,
			externalImage: true,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
		{
			value: 'blob:https://example.com/uuid',
			why: 'blob 同 data（内部含 :// 也不改变判定——整串前缀决定）',
			http: false,
			remoteOrData: true,
			externalImage: true,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
		{
			value: 'file:///C:/a.png',
			why: 'file:// 的分歧点：外部图片 + 超链接，但**不**算远程/数据地址',
			http: false,
			remoteOrData: false,
			externalImage: true,
			appResource: false,
			hyperlink: true,
			scheme: true,
		},
		{
			value: 'app://abc/attachments/a.png',
			why: '库内资源：只命中 app 谓词（是 scheme:// 但不是外部图片）',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: true,
			hyperlink: false,
			scheme: true,
		},
		{
			value: 'obsidian://open?vault=v&file=f',
			why: '库内 URI：超链接语义成立，但非远程/图片',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: true,
			scheme: true,
		},
		{
			value: 'ftp://files.example.com/a.zip',
			why: '仅 scheme 命中：既非 http、也非超链接白名单',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: true,
		},
		{
			value: 'zotero://select/library/items/ABC',
			why: '任意自定义协议：只由 isSchemeUrl 兜住',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: true,
		},
		{
			value: 'mailto:someone@example.com',
			why: '无 // 的 URI：六谓词全否（须走普通路径处理）',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
		{
			value: 'attachments/a.png',
			why: '库内相对路径：六谓词全否（唯一正确去向是 resolvePathToFile）',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
		{
			value: 'folder/note.md',
			why: '库内笔记路径：六谓词全否',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
		{
			value: 'C:/notes/note.md',
			why: 'Windows 盘符：形似 scheme 但为单斜杠，全否',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
		{
			value: 'https://',
			why: '纯协议前缀：五个前缀谓词均真（不做 URL 合法性校验），仅 app 为假',
			http: true,
			remoteOrData: true,
			externalImage: true,
			appResource: false,
			hyperlink: true,
			scheme: true,
		},
		{
			value: '',
			why: '空串：六谓词全否（不得抛错）',
			http: false,
			remoteOrData: false,
			externalImage: false,
			appResource: false,
			hyperlink: false,
			scheme: false,
		},
	])('$value（$why）', (row) => {
		expect(isHttpUrl(row.value)).toBe(row.http);
		expect(isRemoteOrDataUrl(row.value)).toBe(row.remoteOrData);
		expect(isExternalImageRef(row.value)).toBe(row.externalImage);
		expect(isAppResourceUrl(row.value)).toBe(row.appResource);
		expect(isHyperlinkProtocolUrl(row.value)).toBe(row.hyperlink);
		expect(isSchemeUrl(row.value)).toBe(row.scheme);
	});
});

describe('谓词间的蕴含关系（防止子集链被打破）', () => {
	/** 代表性地址样本：覆盖各语义的边界形态 */
	const CORPUS = [
		'https://example.com/a.png',
		'http://x',
		'https://',
		'data:image/png;base64,AA',
		'blob:https://e/u',
		'file:///C:/a.png',
		'app://abc/a.png',
		'obsidian://open?vault=v',
		'ftp://files.example.com/a.zip',
		'zotero://select/x',
		'mailto:a@b.c',
		'attachments/a.png',
		'folder/note.md',
		'C:/notes/note.md',
		'',
	] as const;

	it('http ⊂ 远程/数据 ⊂ 外部图片引用（逐样本蕴含，不抽样）', () => {
		for (const value of CORPUS) {
			if (isHttpUrl(value)) {
				expect(isRemoteOrDataUrl(value)).toBe(true);
			}
			if (isRemoteOrDataUrl(value)) {
				expect(isExternalImageRef(value)).toBe(true);
			}
		}
		// 严格包含：file:// 是外部图片引用但不属远程/数据，子集链不得变成等价
		expect(isExternalImageRef('file:///C:/a.png')).toBe(true);
		expect(isRemoteOrDataUrl('file:///C:/a.png')).toBe(false);
	});

	it('http ⊂ 超链接协议（http(s) 恒可浏览器打开）', () => {
		for (const value of CORPUS) {
			if (isHttpUrl(value)) {
				expect(isHyperlinkProtocolUrl(value)).toBe(true);
			}
		}
	});

	it('app:// 与外部图片引用互斥；超链接集合与外部图片集合的差集只有 file://', () => {
		for (const value of CORPUS) {
			if (isAppResourceUrl(value)) {
				expect(isExternalImageRef(value)).toBe(false);
				expect(isHyperlinkProtocolUrl(value)).toBe(false);
			}
		}
		// obsidian:// 只在超链接集合中（不是图片、不是资源地址）
		expect(isHyperlinkProtocolUrl('obsidian://open')).toBe(true);
		expect(isExternalImageRef('obsidian://open')).toBe(false);
	});
});
