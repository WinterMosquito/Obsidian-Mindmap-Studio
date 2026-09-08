/**
 * URL 谓词单元测试（domain/url.ts）。
 *
 * 这些谓词是 images-path、modal-image、md-serialize、view-wikilink、
 * view 的共同依赖；此前 5 处调用点 3 种语义的分歧即审查报告定位的
 * 「单一真相缺失」——这里锁定每种语义的边界，防止回退漂移。
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

describe('isUrlLikeText', () => {
	it('http/https/ftp/obsidian 独立 URL 命中', () => {
		expect(isUrlLikeText('https://example.com/a/very/long/path')).toBe(true);
		expect(isUrlLikeText('http://example.com')).toBe(true);
		expect(isUrlLikeText('ftp://files.example.com/a.zip')).toBe(true);
		expect(isUrlLikeText('obsidian://open?vault=v&file=f')).toBe(true);
	});

	it('含空格的混合文本 / 普通词语 / 相对路径不命中', () => {
		expect(isUrlLikeText('see https://example.com here')).toBe(false);
		expect(isUrlLikeText('https:// example.com')).toBe(false);
		expect(isUrlLikeText('普通文本')).toBe(false);
		expect(isUrlLikeText('images/pic.png')).toBe(false);
		expect(isUrlLikeText('')).toBe(false);
	});
});

describe('isHttpUrl', () => {
	it('只认 http:// 与 https://', () => {
		expect(isHttpUrl('http://example.com')).toBe(true);
		expect(isHttpUrl('https://example.com/a?b=1')).toBe(true);
	});

	it('其他协议与相对路径不算', () => {
		expect(isHttpUrl('obsidian://open')).toBe(false);
		expect(isHttpUrl('file:///C:/a.png')).toBe(false);
		expect(isHttpUrl('app://abc/icon.png')).toBe(false);
		expect(isHttpUrl('images/pic.png')).toBe(false);
		expect(isHttpUrl('data:image/png;base64,AAAA')).toBe(false);
	});
});

describe('isRemoteOrDataUrl', () => {
	it('http/https/data/blob 均视为远程/数据地址', () => {
		expect(isRemoteOrDataUrl('https://cdn.example.com/a.png')).toBe(true);
		expect(isRemoteOrDataUrl('data:image/png;base64,AAAA')).toBe(true);
		expect(isRemoteOrDataUrl('blob:https://example.com/uuid')).toBe(true);
	});

	it('file:// 与 app:// 不属于远程/数据地址', () => {
		expect(isRemoteOrDataUrl('file:///C:/a.png')).toBe(false);
		expect(isRemoteOrDataUrl('app://abc/icon.png')).toBe(false);
	});

	it('库内相对路径不算', () => {
		expect(isRemoteOrDataUrl('attachments/a.png')).toBe(false);
	});
});

describe('isExternalImageRef', () => {
	it('远程/数据地址或 file:// 都是外部图片引用', () => {
		expect(isExternalImageRef('https://cdn.example.com/a.png')).toBe(true);
		expect(isExternalImageRef('data:image/png;base64,AAAA')).toBe(true);
		expect(isExternalImageRef('file:///C:/a.png')).toBe(true);
	});

	it('app:// 是库内资源地址而非外部引用', () => {
		expect(isExternalImageRef('app://abc/icon.png')).toBe(false);
	});

	it('库内相对路径不算', () => {
		expect(isExternalImageRef('attachments/a.png')).toBe(false);
	});
});

describe('isAppResourceUrl', () => {
	it('识别 getResourcePath 输出的 app:// 形态', () => {
		expect(isAppResourceUrl('app://abc/attachments/a.png')).toBe(true);
		expect(isAppResourceUrl('app://unc/有中文.png?v=1')).toBe(true);
	});

	it('非 app:// 一律否', () => {
		expect(isAppResourceUrl('https://example.com')).toBe(false);
		expect(isAppResourceUrl('attachments/a.png')).toBe(false);
	});
});

describe('isHyperlinkProtocolUrl', () => {
	it('http/https/obsidian:///file:// 均可作为超链接打开', () => {
		expect(isHyperlinkProtocolUrl('https://example.com')).toBe(true);
		expect(isHyperlinkProtocolUrl('http://localhost:3000')).toBe(true);
		expect(isHyperlinkProtocolUrl('obsidian://open?vault=v&file=a')).toBe(true);
		expect(isHyperlinkProtocolUrl('file:///C:/doc.pdf')).toBe(true);
	});

	it('库内路径 / data: / app: 不走浏览器打开', () => {
		expect(isHyperlinkProtocolUrl('folder/note.md')).toBe(false);
		expect(isHyperlinkProtocolUrl('data:text/plain,hi')).toBe(false);
		expect(isHyperlinkProtocolUrl('app://abc/icon.png')).toBe(false);
	});
});

describe('isSchemeUrl', () => {
	it('任意 scheme:// 形态（含自定义协议）', () => {
		expect(isSchemeUrl('obsidian://open')).toBe(true);
		expect(isSchemeUrl('mailto:someone@example.com')).toBe(false); // 无 //
		expect(isSchemeUrl('zotero://select/library/items/ABC')).toBe(true);
		expect(isSchemeUrl('x-cocoa-12345://run')).toBe(true);
	});

	it('scheme 必须以字母开头', () => {
		expect(isSchemeUrl('1abc://x')).toBe(false);
	});

	it('相对路径与 Windows 盘符不算', () => {
		expect(isSchemeUrl('folder/note.md')).toBe(false);
		expect(isSchemeUrl('C:/notes/note.md')).toBe(false);
	});
});
