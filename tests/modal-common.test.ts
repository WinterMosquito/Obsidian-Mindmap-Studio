/**
 * modal-common 回归测试：弹窗共享件的当前实现契约（src/modal-common.ts）。
 *
 * 覆盖三件事：
 * - createModalSettle：settle 幂等（首值胜出、后到者被忽略）、关闭兜底经官方
 *   setCloseCallback 注册（Esc / 点遮罩关闭时 Promise 必然 settle，调用方 await
 *   不会永久挂起）、且**不覆写** modal.onClose（覆写会盖掉调用方/子类已有的实现）；
 * - createButton：variant → setCta() / buttonEl.is-muted / 两者皆无，文本与
 *   onClick 原样转发到官方 ButtonComponent；
 * - VaultFileSuggest：空查询返回空、大小写不敏感子串过滤、20 条上限、
 *   renderSuggestion 的三段结构（图标 / 显示名 / 所在目录）、selectSuggestion 回调。
 *
 * 为什么自建 obsidian 桩：仓库 mock（tests/mocks/obsidian.ts）里的
 * Modal / ButtonComponent / AbstractInputSuggest 只是「可 new、可链式调用」的空壳，
 * 不记录任何调用；而本文件的断言（setCloseCallback 是否被调用、onClose 是否被写、
 * 按钮变体如何落地、联想拿到什么构造参数）全部落在调用痕迹上。故用 vi.mock 覆盖这
 * 三个类，其余导出（App / TFile / TFolder / normalizePath）沿用仓库 mock。
 *
 * 为什么自建 DOM 桩：vitest environment 固定为 node（配置不可改），
 * renderSuggestion 需要真实可查的元素树；这里把 globalThis.document 指向最小实现
 * 并在 afterEach 还原——不引入 jsdom 依赖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, ButtonComponent, Modal, TFile, TFolder } from 'obsidian';
import type { FileSuggestAppearance } from '../src/modal-common';
import {
	createButton,
	createModalSettle,
	VaultFileSuggest,
} from '../src/modal-common';

/* ===== 最小 DOM 桩（node 环境没有 document；afterEach 还原） ===== */

/** createEl / createSpan 的初始化参数（对齐官方 DomElementInfo 的子集） */
interface FakeElInit {
	cls?: string;
	text?: string;
}

/** Obsidian 的 cls 支持空格分隔多类名 */
function splitClasses(cls: string): string[] {
	return cls.split(/\s+/).filter((part) => part !== '');
}

/**
 * 最小伪元素：记录子节点 / 类名 / 文本。
 * VaultFileSuggest.renderSuggestion 只用 createSpan + addClass，故不实现事件面。
 */
class FakeEl {
	readonly tagName: string;
	readonly children: FakeEl[] = [];
	readonly classes: string[] = [];
	text = '';

	constructor(tagName: string, init: FakeElInit = {}) {
		this.tagName = tagName;
		if (init.cls !== undefined) {
			this.classes.push(...splitClasses(init.cls));
		}
		if (init.text !== undefined) {
			this.text = init.text;
		}
	}

	/** Obsidian 的 HTMLElement.createSpan 原型扩展（经 document 桩建元素） */
	createSpan(init: FakeElInit | string = {}): FakeEl {
		const resolved: FakeElInit =
			typeof init === 'string' ? { cls: init } : init;
		const child = createStubElement('span', resolved);
		this.children.push(child);
		return child;
	}

	/** Obsidian 的 HTMLElement.addClass 原型扩展 */
	addClass(...cls: string[]): void {
		this.classes.push(...cls);
	}

	/** 转成 HTMLElement 入参形态（renderSuggestion 的签名要求） */
	asHTMLElement(): HTMLElement {
		return this as unknown as HTMLElement;
	}
}

/** 伪 document：只提供弹窗链路用到的 createElement */
interface FakeDocument {
	createElement: (tagName: string) => FakeEl;
}

type GlobalWithDocument = { document?: FakeDocument };

const originalDocument = (globalThis as GlobalWithDocument).document;

beforeEach(() => {
	(globalThis as GlobalWithDocument).document = {
		createElement: (tagName: string): FakeEl => new FakeEl(tagName),
	};
});

afterEach(() => {
	// 还原全局：避免把 document 桩泄漏给同进程内的其他测试文件
	if (originalDocument === undefined) {
		delete (globalThis as GlobalWithDocument).document;
	} else {
		(globalThis as GlobalWithDocument).document = originalDocument;
	}
});

/** 经 document 桩造元素并应用初始化参数（模拟 Obsidian 的 createEl 行为） */
function createStubElement(tagName: string, init: FakeElInit = {}): FakeEl {
	const doc = (globalThis as GlobalWithDocument).document;
	if (doc === undefined) {
		throw new Error('document 桩未安装');
	}
	const el = doc.createElement(tagName);
	if (init.cls !== undefined) {
		el.addClass(...splitClasses(init.cls));
	}
	if (init.text !== undefined) {
		el.text = init.text;
	}
	return el;
}

/* ===== 可断言的 obsidian 桩 ===== */

/** createButton 记录（每次 new ButtonComponent 追加一条） */
interface ButtonRecord {
	texts: string[];
	ctaCalls: number;
	clickHandlers: (() => void)[];
	/** 真实按钮元素：is-muted 这类类名断言直接读它（落在 src 真正触碰的对象上） */
	buttonEl: FakeEl;
}

/**
 * vi.mock 工厂被提升到文件顶部，工厂内引用的变量必须由 vi.hoisted 提前创建
 * （直接引用普通顶层变量会报「Cannot access before initialization」）。
 */
const { setIconMock, buttonRecords, suggestRecords } = vi.hoisted(() => ({
	setIconMock: vi.fn<(parent: unknown, iconId: string) => void>(),
	buttonRecords: [] as ButtonRecord[],
	suggestRecords: [] as { app: unknown; inputEl: unknown }[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();

	/** 记录按钮文本 / CTA / is-muted / onClick，便于断言变体落地方式 */
	class MockButtonComponent {
		readonly record: ButtonRecord;
		readonly buttonEl: FakeEl;

		constructor(_containerEl: unknown) {
			this.buttonEl = createStubElement('button');
			const record: ButtonRecord = {
				texts: [],
				ctaCalls: 0,
				clickHandlers: [],
				buttonEl: this.buttonEl,
			};
			buttonRecords.push(record);
			this.record = record;
		}

		setButtonText(text: string): MockButtonComponent {
			this.record.texts.push(text);
			return this;
		}

		setCta(): MockButtonComponent {
			this.record.ctaCalls += 1;
			return this;
		}

		onClick(handler: () => void): MockButtonComponent {
			this.record.clickHandlers.push(handler);
			return this;
		}
	}

	/**
	 * Modal 桩：onClose 用访问器实现——「写入次数」即断言依据
	 * （createModalSettle 正确实现时写入次数恒为 0，覆写则 +1）。
	 */
	class MockModal {
		private closeHandler: () => void = () => {};
		onCloseWrites = 0;
		closeCalls = 0;
		readonly closeCallbacks: (() => unknown)[] = [];

		get onClose(): () => void {
			return this.closeHandler;
		}

		set onClose(handler: () => void) {
			this.onCloseWrites += 1;
			this.closeHandler = handler;
		}

		constructor(_app: unknown) {}

		open(): void {}

		setCloseCallback(callback: () => unknown): this {
			this.closeCallbacks.push(callback);
			return this;
		}

		/** 真实实现：close() 触发关闭回调，随后调用 onClose */
		close(): void {
			this.closeCalls += 1;
			this.fireClose();
			this.closeHandler();
		}

		/** 模拟 Esc / 点遮罩：库层关闭弹窗（不经本插件代码调用的 close） */
		fireClose(): void {
			for (const callback of [...this.closeCallbacks]) {
				callback();
			}
		}
	}

	/** 只记录构造参数；VaultFileSuggest 是真实子类，行为仍走真实实现 */
	class MockAbstractInputSuggest {
		constructor(app: unknown, inputEl: unknown) {
			suggestRecords.push({ app, inputEl });
		}
	}

	return {
		...actual,
		ButtonComponent: MockButtonComponent,
		Modal: MockModal,
		AbstractInputSuggest: MockAbstractInputSuggest,
		setIcon: setIconMock,
	};
});

/**
 * 测试可见的 Modal 桩面：与官方 Modal 相交——桩在运行时是 MockModal（只实现
 * 本文件用到的成员），相交类型让 createModalSettle 这类要求真实 Modal 的调用点
 * 无需逐个补齐官方 Modal 的 DOM 成员（app/scope/containerEl/…）。
 */
type ModalStub = Modal & {
	readonly closeCalls: number;
	readonly onCloseWrites: number;
	readonly closeCallbacks: (() => unknown)[];
	onClose: () => void;
	/** 库层关闭（Esc / 点遮罩）：只触发关闭回调 */
	fireClose(): void;
};

function fakeModal(): ModalStub {
	return new Modal(new App()) as unknown as ModalStub;
}

/** 取第 index 个子元素（noUncheckedIndexedAccess 下显式收窄，缺失即失败） */
function childAt(parent: FakeEl, index: number): FakeEl {
	const child = parent.children[index];
	if (child === undefined) {
		throw new Error(`伪元素缺少第 ${String(index)} 个子节点`);
	}
	return child;
}

/** 伪库内文件：basename 参与过滤，parent.path 参与渲染 */
function fakeFile(basename: string, folderPath: string): TFile {
	const parent = Object.assign(new TFolder(), { path: folderPath });
	return Object.assign(new TFile(), {
		basename,
		name: `${basename}.md`,
		path: `${folderPath}/${basename}.md`,
		extension: 'md',
		parent,
	});
}

/** 输入元素在测试里只作为「同一引用」被断言，不需要真实行为 */
function fakeInputEl(): HTMLInputElement {
	return createStubElement('input') as unknown as HTMLInputElement;
}

function fakeContainer(): HTMLElement {
	return createStubElement('div') as unknown as HTMLElement;
}

describe('createModalSettle（弹窗 Promise settle 守卫）', () => {
	it('settle 幂等：首次值胜出，后到的 settle 全部被忽略', () => {
		const resolve = vi.fn<(value: string | null) => void>();
		const settle = createModalSettle<string>(fakeModal(), resolve);

		settle('第一个');
		settle('第二个');
		settle(null);

		// 只有第一次生效：Promise 契约是「只 resolve 一次」
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith('第一个');
	});

	it('对象结果原样透传（不包装、不克隆）', () => {
		const resolve = vi.fn<(value: { link: string } | null) => void>();
		const settle = createModalSettle<{ link: string }>(fakeModal(), resolve);
		const result = { link: '[[笔记]]' };

		settle(result);

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(result);
	});

	it('关闭兜底经官方 setCloseCallback 注册（不是覆写 onClose）', () => {
		const modal = fakeModal();
		createModalSettle<string>(modal, vi.fn());

		// 兜底必须挂在官方关闭回调上
		expect(modal.closeCallbacks).toHaveLength(1);
		expect(typeof modal.closeCallbacks[0]).toBe('function');
		// 没有任何一处给 onClose 赋值 → 未覆写（覆写会盖掉调用方已有的 onClose）
		expect(modal.onCloseWrites).toBe(0);
	});

	it('调用方已有的 onClose 仍被调用（setCloseCallback 与 onClose 并存）', () => {
		const modal = fakeModal();
		const onClose = vi.fn();
		modal.onClose = onClose;
		const resolve = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(modal, resolve);

		// 写入次数 1 只来自测试自己；createModalSettle 没有再写一次
		expect(modal.onCloseWrites).toBe(1);

		modal.close();

		// 调用方那个 onClose 仍在生效（并存语义），兜底不改写它
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(null);
	});

	it('未 settle 就关闭（Esc / 点遮罩）→ resolve(null)，await 不永久挂起', () => {
		const modal = fakeModal();
		const resolve = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(modal, resolve);

		expect(resolve).not.toHaveBeenCalled();

		// Esc / 点遮罩不经过插件代码的 settle，只触发关闭回调
		modal.fireClose();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(null);
	});

	it('先 settle 再 close：关闭兜底成为 no-op，结果保持首次值', () => {
		const modal = fakeModal();
		const resolve = vi.fn<(value: string | null) => void>();
		const settle = createModalSettle<string>(modal, resolve);

		settle('确认');
		// close() 同步触发关闭回调（兜底的 settle(null)）——正是这里会覆盖结果
		modal.close();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith('确认');
	});

	it('关闭之后迟到的 settle 同样无效（幂等跨关闭路径）', () => {
		const modal = fakeModal();
		const resolve = vi.fn<(value: string | null) => void>();
		const settle = createModalSettle<string>(modal, resolve);

		modal.close();
		settle('晚到');

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(null);
	});

	it('重复关闭不会重复 resolve', () => {
		const modal = fakeModal();
		const resolve = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(modal, resolve);

		modal.fireClose();
		modal.fireClose();
		modal.close();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(null);
	});

	it("假值语义：settle(null) 与 settle('') 都算已 settle，且互不混淆", () => {
		const resolveNull = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(fakeModal(), resolveNull)(null);
		expect(resolveNull).toHaveBeenCalledTimes(1);
		expect(resolveNull).toHaveBeenCalledWith(null);

		// '' 是「清空」通道（modal-link / modal-image 的清除按钮），不能被兜底吞成 null
		const resolveEmpty = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(fakeModal(), resolveEmpty)('');
		expect(resolveEmpty).toHaveBeenCalledTimes(1);
		expect(resolveEmpty).toHaveBeenCalledWith('');
		expect(resolveEmpty).not.toHaveBeenCalledWith(null);
	});
});

describe('createButton（官方按钮组件封装）', () => {
	beforeEach(() => {
		buttonRecords.length = 0;
	});

	it('返回官方 ButtonComponent：写入文案并转发 onClick', () => {
		const onClick = vi.fn();
		const button = createButton(fakeContainer(), '确定', 'primary', onClick);

		expect(button).toBeInstanceOf(ButtonComponent);
		expect(buttonRecords).toHaveLength(1);
		expect(buttonRecords[0]?.texts).toEqual(['确定']);
		expect(buttonRecords[0]?.clickHandlers).toEqual([onClick]);

		// 点击走的是原样转发的处理器（不是包一层）
		const handler = buttonRecords[0]?.clickHandlers[0];
		if (handler === undefined) {
			throw new Error('按钮未接线 onClick');
		}
		handler();
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('variant primary：调 setCta()，不加 is-muted', () => {
		createButton(fakeContainer(), '应用', 'primary', vi.fn());

		expect(buttonRecords[0]?.ctaCalls).toBe(1);
		expect(buttonRecords[0]?.buttonEl.classes).toEqual([]);
	});

	it('variant secondary：既不调 setCta() 也不加 is-muted', () => {
		createButton(fakeContainer(), '取消', 'secondary', vi.fn());

		expect(buttonRecords[0]?.ctaCalls).toBe(0);
		expect(buttonRecords[0]?.buttonEl.classes).toEqual([]);
	});

	it('variant muted：buttonEl 加 is-muted，且不调 setCta()', () => {
		createButton(fakeContainer(), '清除链接', 'muted', vi.fn());

		expect(buttonRecords[0]?.buttonEl.classes).toEqual(['is-muted']);
		expect(buttonRecords[0]?.ctaCalls).toBe(0);
	});
});

describe('VaultFileSuggest（库内文件联想）', () => {
	const describeFile = vi.fn<(file: TFile) => FileSuggestAppearance>();
	const onChoose = vi.fn<(file: TFile) => void>();

	beforeEach(() => {
		setIconMock.mockClear();
		suggestRecords.length = 0;
		describeFile.mockReset();
		describeFile.mockReturnValue({ icon: 'file', label: '默认' });
		onChoose.mockReset();
	});

	function makeSuggest(candidates: TFile[]): VaultFileSuggest {
		return new VaultFileSuggest(
			new App(),
			fakeInputEl(),
			candidates,
			describeFile,
			onChoose,
		);
	}

	it('构造参数原样交给基类 AbstractInputSuggest（app 与输入元素同源引用）', () => {
		const app = new App();
		const inputEl = fakeInputEl();

		new VaultFileSuggest(app, inputEl, [], describeFile, onChoose);

		expect(suggestRecords).toHaveLength(1);
		expect(suggestRecords[0]?.app).toBe(app);
		expect(suggestRecords[0]?.inputEl).toBe(inputEl);
	});

	it('空查询与纯空白查询 → []（不返回全量候选）', () => {
		const suggest = makeSuggest([fakeFile('报告甲', '笔记')]);

		expect(suggest.getSuggestions('')).toEqual([]);
		expect(suggest.getSuggestions('   ')).toEqual([]);
		expect(suggest.getSuggestions('\t\n')).toEqual([]);
	});

	it('basename 大小写不敏感子串匹配，且保持候选原序', () => {
		const suggest = makeSuggest([
			fakeFile('Report-One', '笔记'),
			fakeFile('其他', '笔记'),
			fakeFile('report-Two', '附件'),
			fakeFile('报告甲', '笔记'),
		]);

		expect(
			suggest.getSuggestions('REPORT').map((file) => file.basename),
		).toEqual(['Report-One', 'report-Two']);
		// 查询两端空白先被裁剪，再做子串匹配
		expect(
			suggest.getSuggestions(' 报告 ').map((file) => file.basename),
		).toEqual(['报告甲']);
	});

	it('候选超过 20 条时截断为前 20 条（按候选顺序）', () => {
		const candidates = Array.from({ length: 25 }, (_value, index) =>
			fakeFile(`报告${String(index + 1).padStart(2, '0')}`, '笔记'),
		);
		const suggest = makeSuggest(candidates);

		const result = suggest.getSuggestions('报告');

		expect(result).toHaveLength(20);
		expect(result.map((file) => file.basename)).toEqual(
			candidates.slice(0, 20).map((file) => file.basename),
		);
		expect(result[0]).toBe(candidates[0]);
		expect(result[19]).toBe(candidates[19]);
		// 第 21 条起不在结果里（上限是硬截断，不是优先级排序）
		expect(result).not.toContain(candidates[20]);
	});

	it('renderSuggestion：图标 span + 显示名 span + 所在目录 span（用 describe 的返回值）', () => {
		const file = fakeFile('照片', '附件/图片');
		describeFile.mockReturnValue({ icon: 'image', label: '照片.png' });
		const suggest = makeSuggest([file]);
		const el = createStubElement('div');

		suggest.renderSuggestion(file, el.asHTMLElement());

		// describe 由调用方注入：弹窗按文件类型决定图标与显示名
		expect(describeFile).toHaveBeenCalledTimes(1);
		expect(describeFile).toHaveBeenCalledWith(file);
		expect(el.children).toHaveLength(3);

		const iconEl = childAt(el, 0);
		expect(iconEl.tagName).toBe('span');
		expect(iconEl.classes).toEqual(['mindmap-link-suggest-icon']);
		expect(iconEl.text).toBe('');
		// 图标内容由官方 setIcon 注入（本桩记录调用）
		expect(setIconMock).toHaveBeenCalledTimes(1);
		expect(setIconMock).toHaveBeenCalledWith(iconEl, 'image');

		const labelEl = childAt(el, 1);
		expect(labelEl.tagName).toBe('span');
		expect(labelEl.classes).toEqual([]);
		expect(labelEl.text).toBe('照片.png');

		const pathEl = childAt(el, 2);
		expect(pathEl.tagName).toBe('span');
		expect(pathEl.text).toBe('附件/图片');
		// 目录 span 先带 note-path（沿用既有样式钩子）再追加联想专用类
		expect(pathEl.classes).toEqual([
			'note-path',
			'mindmap-link-suggest-path',
		]);
	});

	it('renderSuggestion：文件无父目录时路径段为空串（不抛错）', () => {
		const file = Object.assign(new TFile(), {
			basename: '根目录笔记',
			name: '根目录笔记.md',
			path: '根目录笔记.md',
			extension: 'md',
			parent: undefined,
		});
		describeFile.mockReturnValue({ icon: 'file-text', label: '根目录笔记' });
		const suggest = makeSuggest([file]);
		const el = createStubElement('div');

		suggest.renderSuggestion(file, el.asHTMLElement());

		expect(childAt(el, 2).text).toBe('');
		expect(setIconMock).toHaveBeenCalledWith(childAt(el, 0), 'file-text');
	});

	it('selectSuggestion：以所选文件调用 onChoose，忽略事件参数且不重新 describe', () => {
		const file = fakeFile('笔记', '目录');
		const suggest = makeSuggest([file]);

		suggest.selectSuggestion(file, {
			type: 'click',
		} as unknown as MouseEvent);

		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose).toHaveBeenCalledWith(file);
		// 选择路径只负责回调（写入输入框 / 构造链接由弹窗的 onChoose 决定）
		expect(describeFile).not.toHaveBeenCalled();
	});
});
