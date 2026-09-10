/**
 * 三个输入弹窗的回归测试：命名（modal-name）/ 链接（modal-link）/ 图片（modal-image）。
 *
 * 覆盖点（逐条对应当前 src 实现）：
 * - 预填与焦点：defaultName / current 写入输入框并 focus（名称弹窗额外全选）；
 *   标题 / 占位符 / 标签 / 文件夹提示 / 按钮文案全部走 t(lang, key)；
 * - 空白输入确认行为：名称弹窗「拒绝 + 重新聚焦」（且确认按钮随输入置灰），
 *   链接弹窗「当作取消 → null」，图片弹窗「settle 空串 → 清空语义」；
 * - settle 幂等：二次确认 / 关闭兜底（Esc、点遮罩）都不改变首次结果，
 *   并把「兜底经官方 setCloseCallback 注册、未覆写 onClose」作为断言；
 * - 联想接线：VaultFileSuggest 拿到真实输入元素与按弹窗语义过滤的候选，
 *   选中后写入输入框/提交结果的具体文本（链接走 wikilink + label）；
 * - 图片弹窗额外覆盖：app:// 解码与畸形 % 回退、外链预览与地址截断、
 *   库内路径经统一解析入口预览、加载失败降级、本地选择与剪贴板粘贴两条入库通道。
 *
 * 为什么自建 obsidian 桩：仓库 mock（tests/mocks/obsidian.ts）的 Modal 没有
 * contentEl/titleEl，ButtonComponent / AbstractInputSuggest 也不记录调用，而本文件的
 * 断言全部落在「按钮文本与禁用序列、点击处理器、关闭回调、联想构造参数」上。
 * 故用 vi.mock 覆盖 Modal / ButtonComponent / AbstractInputSuggest / setIcon，
 * 其余导出沿用仓库 mock。VaultFileSuggest 仍是真实实现（行为断言不落在 mock 上）。
 *
 * 为什么自建 DOM 桩：vitest 环境固定 node（配置不可改），弹窗要往 contentEl 里建元素、
 * 要能派发 keydown / input / change 与读回 value，故把 globalThis.document 指向最小
 * 实现（createDiv/createEl/createSpan 等 Obsidian 的 HTMLElement 原型扩展都在其上），
 * afterEach 还原——不引入 jsdom。
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { MAX_IMAGE_SIZE_MB } from '../src/constants';
import { t, type Language } from '../src/i18n';
import { fileLookupIndex } from '../src/file-lookup';
import { openImageEditorModal } from '../src/modal-image';
import { openLinkEditorModal, type LinkPickResult } from '../src/modal-link';
import { openNameInputModal } from '../src/modal-name';

/* ===== 伪 DOM（node 环境无 document；afterEach 还原） ===== */

/** 伪键盘事件（keydown 分流所需最小面） */
interface FakeKeyEvent {
	readonly key: string;
	preventDefault(): void;
}

type KeydownListener = (event: FakeKeyEvent) => void;
type InputListener = (event: unknown) => void;

/** createEl / createDiv / createSpan 的初始化参数（对齐官方 DomElementInfo 子集） */
interface StubElInit {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
}

/** 伪元素对测试暴露的读面（写面是 src 在用的那部分 DOM 助手） */
interface StubElNode {
	readonly tagName: string;
	readonly children: StubElNode[];
	readonly classes: string[];
	readonly attrs: Record<string, string>;
	readonly keydownListeners: KeydownListener[];
	readonly inputListeners: InputListener[];
	value: string;
	text: string;
	src: string;
	title: string;
	files: unknown[] | null;
	onchange: (() => Promise<void>) | null;
	onerror: (() => void) | null;
	focusCount: number;
	selectCount: number;
	clickCount: number;
	createDiv(cls?: string): StubElNode;
	createEl(tag: string, init?: StubElInit): StubElNode;
	createSpan(init?: StubElInit | string): StubElNode;
	addClass(...cls: string[]): void;
	removeClass(...cls: string[]): void;
	toggleClass(cls: string, on: boolean): void;
	hasClass(cls: string): boolean;
	setText(text: string): void;
	empty(): void;
	focus(): void;
	select(): void;
	click(): void;
	addEventListener(type: string, listener: unknown): void;
	asHTMLElement(): HTMLElement;
}

/** 伪 document：弹窗链路只用到 createElement */
interface FakeDocument {
	createElement: (tagName: string) => StubElNode;
}

type GlobalWithDocument = { document?: FakeDocument };

/** 取最近创建的弹窗（一个 it 内可能开多个） */
interface ModalStub {
	readonly contentEl: StubElNode;
	readonly titleEl: StubElNode;
	readonly openCalls: number;
	readonly closeCalls: number;
	/** onClose 被赋值的次数（正确实现恒为 0：兜底走 setCloseCallback） */
	readonly onCloseWrites: number;
	readonly closeCallbacks: (() => unknown)[];
	onClose: () => void;
	open(): void;
	close(): void;
	setCloseCallback(callback: () => unknown): unknown;
	/** 模拟 Esc / 点遮罩：库层关闭弹窗（不经插件代码调用的 close） */
	fireClose(): void;
}

/** ButtonComponent 记录（每次 new 追加一条） */
interface ButtonRecord {
	/** 承载按钮的容器：按「容器 + 文案」定位，多弹窗场景不串台 */
	readonly container: StubElNode;
	readonly texts: string[];
	readonly clickHandlers: (() => void)[];
	readonly buttonEl: StubElNode;
	/**
	 * setCta 调用计数。
	 *
	 * 这里**不能**标 `readonly`：其余字段是就地 push 的数组（`readonly` 只挡重新绑定，
	 * 挡不住 push），而计数是数字，桩里必须重新赋值才能累加。
	 */
	ctaCalls: number;
	/** setDisabled 调用序列（末项即当前禁用状态） */
	readonly disabledStates: boolean[];
}

/** 真实 VaultFileSuggest 实例的窄访问面（基类构造时把实例交给测试） */
interface SuggestHandle {
	getSuggestions(query: string): TFile[];
	renderSuggestion(file: TFile, el: HTMLElement): void;
	selectSuggestion(file: TFile, evt: MouseEvent): void;
}

interface SuggestRecord {
	readonly app: unknown;
	readonly inputEl: unknown;
	readonly instance: SuggestHandle;
}

/**
 * 伪元素与各记录表必须由 vi.hoisted 创建：vi.mock 工厂被提升到文件顶部，
 * 工厂内引用普通顶层变量会触发「Cannot access before initialization」。
 */
const {
	createStub: createStubElement,
	installDocument,
	restoreDocument,
	modalStubs,
	buttonRecords,
	suggestRecords,
	setIconMock,
} = vi.hoisted(() => {
	class StubElementClass implements StubElNode {
		readonly tagName: string;
		readonly children: StubElementClass[] = [];
		readonly classes: string[] = [];
		readonly attrs: Record<string, string> = {};
		readonly keydownListeners: KeydownListener[] = [];
		readonly inputListeners: InputListener[] = [];
		text = '';
		value = '';
		src = '';
		title = '';
		files: unknown[] | null = null;
		onchange: (() => Promise<void>) | null = null;
		onerror: (() => void) | null = null;
		focusCount = 0;
		selectCount = 0;
		clickCount = 0;

		constructor(tagName: string) {
			this.tagName = tagName;
		}

		/** Obsidian 的 HTMLElement.createDiv 原型扩展 */
		createDiv(cls?: string): StubElementClass {
			return this.append(
				cls === undefined ? createStub('div') : createStub('div', { cls }),
			);
		}

		/** Obsidian 的 HTMLElement.createEl 原型扩展（attr.value 同步到 value） */
		createEl(tag: string, init: StubElInit = {}): StubElementClass {
			return this.append(createStub(tag, init));
		}

		/** Obsidian 的 HTMLElement.createSpan 原型扩展（cls 支持空格分隔多类名） */
		createSpan(init: StubElInit | string = {}): StubElementClass {
			const resolved: StubElInit =
				typeof init === 'string' ? { cls: init } : init;
			return this.append(createStub('span', resolved));
		}

		addClass(...cls: string[]): void {
			this.classes.push(...cls);
		}

		removeClass(...cls: string[]): void {
			for (const name of cls) {
				const index = this.classes.indexOf(name);
				if (index !== -1) {
					this.classes.splice(index, 1);
				}
			}
		}

		toggleClass(cls: string, on: boolean): void {
			if (on) {
				if (!this.classes.includes(cls)) {
					this.classes.push(cls);
				}
			} else {
				this.removeClass(cls);
			}
		}

		hasClass(cls: string): boolean {
			return this.classes.includes(cls);
		}

		setText(text: string): void {
			this.text = text;
		}

		empty(): void {
			this.children.length = 0;
			this.text = '';
		}

		focus(): void {
			this.focusCount += 1;
		}

		select(): void {
			this.selectCount += 1;
		}

		click(): void {
			this.clickCount += 1;
		}

		addEventListener(type: string, listener: unknown): void {
			if (type === 'keydown') {
				this.keydownListeners.push(listener as KeydownListener);
			} else if (type === 'input') {
				this.inputListeners.push(listener as InputListener);
			}
		}

		asHTMLElement(): HTMLElement {
			return this as unknown as HTMLElement;
		}

		private append(child: StubElementClass): StubElementClass {
			this.children.push(child);
			return child;
		}
	}

	/** 经 document 桩造元素——弹窗在真实 Obsidian 里也走这条路径 */
	function createStub(tagName: string, init: StubElInit = {}): StubElementClass {
		const doc = (globalThis as GlobalWithDocument).document;
		if (doc === undefined) {
			throw new Error('document 桩未安装');
		}
		const el = doc.createElement(tagName) as StubElementClass;
		if (init.cls !== undefined) {
			el.addClass(
				...init.cls.split(/\s+/).filter((part) => part !== ''),
			);
		}
		if (init.text !== undefined) {
			el.text = init.text;
		}
		if (init.attr !== undefined) {
			Object.assign(el.attrs, init.attr);
			if (init.attr['value'] !== undefined) {
				el.value = init.attr['value'];
			}
		}
		return el;
	}

	function installDocument(): void {
		(globalThis as GlobalWithDocument).document = {
			createElement: (tagName: string): StubElementClass =>
				new StubElementClass(tagName),
		};
	}

	function restoreDocument(original: FakeDocument | undefined): void {
		if (original === undefined) {
			delete (globalThis as GlobalWithDocument).document;
		} else {
			(globalThis as GlobalWithDocument).document = original;
		}
	}

	const modalStubs: ModalStub[] = [];
	const buttonRecords: ButtonRecord[] = [];
	const suggestRecords: SuggestRecord[] = [];

	return {
		createStub,
		installDocument,
		restoreDocument,
		modalStubs,
		buttonRecords,
		suggestRecords,
		setIconMock: vi.fn<(parent: unknown, iconId: string) => void>(),
	};
});

const originalDocument = (globalThis as GlobalWithDocument).document;

beforeEach(() => {
	installDocument();
	modalStubs.length = 0;
	buttonRecords.length = 0;
	suggestRecords.length = 0;
	setIconMock.mockClear();
	// 全库查找索引是 src 侧模块级单例（跨用例复用）：不清会让上一个用例的
	// 库文件在本用例「未命中」场景里被索引兜底命中，断言随之失真。
	fileLookupIndex.invalidate();
});

afterEach(() => {
	restoreDocument(originalDocument);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();

	/** 记录文案 / CTA / 禁用序列 / 点击处理器，便于「按文案点真实处理器」 */
	class MockButtonComponent {
		readonly record: ButtonRecord;
		readonly buttonEl: StubElNode;

		constructor(containerEl: unknown) {
			this.buttonEl = createStubElement('button');
			const record: ButtonRecord = {
				container: containerEl as StubElNode,
				texts: [],
				clickHandlers: [],
				buttonEl: this.buttonEl,
				ctaCalls: 0,
				disabledStates: [],
			};
			buttonRecords.push(record);
			this.record = record;
		}

		setButtonText(text: string): this {
			this.record.texts.push(text);
			return this;
		}

		setCta(): this {
			this.record.ctaCalls += 1;
			return this;
		}

		onClick(handler: () => void): this {
			this.record.clickHandlers.push(handler);
			return this;
		}

		setDisabled(disabled: boolean): this {
			this.record.disabledStates.push(disabled);
			return this;
		}
	}

	/**
	 * Modal 桩：contentEl / titleEl 是伪元素，供弹窗正常装配；
	 * onClose 用访问器实现——赋值次数即「是否被覆写」的断言依据。
	 */
	class MockModal implements ModalStub {
		readonly contentEl: StubElNode;
		readonly titleEl: StubElNode;
		openCalls = 0;
		closeCalls = 0;
		onCloseWrites = 0;
		readonly closeCallbacks: (() => unknown)[] = [];
		private closeHandler: () => void = () => {};

		get onClose(): () => void {
			return this.closeHandler;
		}

		set onClose(handler: () => void) {
			this.onCloseWrites += 1;
			this.closeHandler = handler;
		}

		constructor(_app: unknown) {
			this.contentEl = createStubElement('div');
			this.titleEl = createStubElement('h2');
			modalStubs.push(this);
		}

		open(): void {
			this.openCalls += 1;
		}

		setCloseCallback(callback: () => unknown): this {
			this.closeCallbacks.push(callback);
			return this;
		}

		/** 真实 Obsidian：close() 先触发关闭回调，再调用 onClose */
		close(): void {
			this.closeCalls += 1;
			this.fireClose();
			this.closeHandler();
		}

		fireClose(): void {
			for (const callback of [...this.closeCallbacks]) {
				callback();
			}
		}
	}

	/** 只记录构造参数；VaultFileSuggest 是真实子类，行为仍走真实实现 */
	class MockAbstractInputSuggest {
		constructor(app: unknown, inputEl: unknown) {
			suggestRecords.push({
				app,
				inputEl,
				instance: this as unknown as SuggestHandle,
			});
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

/* ===== 伪 App / 伪库内文件 ===== */

interface FakeAppOptions {
	readonly markdownFiles?: TFile[];
	readonly files?: TFile[];
}

/**
 * 伪 App：三个弹窗只用到文件列表、路径直查与资源地址。
 * getFirstLinkpathDest 恒返回 null —— 用例要验证的是弹窗自身的接线，
 * 不是官方同名消歧规则（那属 links-resolve 的覆盖范围）。
 */
function fakeApp(options: FakeAppOptions = {}): App {
	const markdownFiles = options.markdownFiles ?? [];
	const files = options.files ?? [];
	return {
		vault: {
			getMarkdownFiles: () => markdownFiles,
			getFiles: () => files,
			getFileByPath: (path: string): TFile | null =>
				files.find((file) => file.path === path) ?? null,
			getResourcePath: (file: TFile): string => `app://local/${file.path}`,
		},
		metadataCache: {
			getFirstLinkpathDest: (): TFile | null => null,
		},
	} as unknown as App;
}

/** 伪库内文件：basename / extension / path / parent.path 参与过滤、渲染与结果构造 */
function fakeFile(
	basename: string,
	extension: string,
	folderPath: string,
): TFile {
	const name = `${basename}.${extension}`;
	const path = folderPath === '' ? name : `${folderPath}/${name}`;
	const parent = Object.assign(new TFolder(), { path: folderPath });
	return Object.assign(new TFile(), { basename, name, path, extension, parent });
}

/* ===== 通用小工具 ===== */

/** 取第 index 个子元素（noUncheckedIndexedAccess 下显式收窄，缺失即失败） */
function childAt(parent: StubElNode, index: number): StubElNode {
	const child = parent.children[index];
	if (child === undefined) {
		throw new Error(`伪元素缺少第 ${String(index)} 个子节点`);
	}
	return child;
}

/** 取最近创建的弹窗 */
function lastModal(): ModalStub {
	const modal = modalStubs[modalStubs.length - 1];
	if (modal === undefined) {
		throw new Error('未创建任何弹窗');
	}
	return modal;
}

/** 取最近创建的联想实例 */
function lastSuggest(): SuggestRecord {
	const record = suggestRecords[suggestRecords.length - 1];
	if (record === undefined) {
		throw new Error('未创建任何联想实例');
	}
	return record;
}

/** 按容器 + 文案定位按钮记录（不存在直接抛错，避免静默通过） */
function buttonIn(container: StubElNode, text: string): ButtonRecord {
	const record = buttonRecords.find(
		(entry) => entry.container === container && entry.texts.includes(text),
	);
	if (record === undefined) {
		throw new Error(`容器内未找到按钮：${text}`);
	}
	return record;
}

/** 点击容器内文案匹配的按钮（走真实 onClick 处理器） */
function clickButton(container: StubElNode, text: string): void {
	const handler = buttonIn(container, text).clickHandlers[0];
	if (handler === undefined) {
		throw new Error(`按钮无点击处理器：${text}`);
	}
	handler();
}

/** 容器内按钮文案序列（按创建顺序） */
function buttonTexts(container: StubElNode): string[] {
	return buttonRecords
		.filter((record) => record.container === container)
		.map((record) => record.texts.join(''));
}

/** 触发伪元素的 keydown 监听，返回 preventDefault 调用次数供断言 */
function pressKey(el: StubElNode, key: string): { preventDefaultCount: number } {
	let preventDefaultCount = 0;
	const event: FakeKeyEvent = {
		key,
		preventDefault: (): void => {
			preventDefaultCount += 1;
		},
	};
	for (const listener of el.keydownListeners) {
		listener(event);
	}
	return { preventDefaultCount };
}

/** 触发伪元素的 input 监听（绑定按钮禁用态 / 预览联动） */
function fireInput(el: StubElNode): void {
	for (const listener of el.inputListeners) {
		listener({ type: 'input' });
	}
}

/** 伪鼠标事件（selectSuggestion 只用第一个参数） */
function fakeMouseEvent(): MouseEvent {
	return { type: 'click' } as unknown as MouseEvent;
}

/** 伪元素 → HTMLElement（renderSuggestion 的入参形态） */
function asHTMLElement(el: StubElNode): HTMLElement {
	return el.asHTMLElement();
}

/** 取非 null 结果（null 直接抛错，避免可选链静默通过） */
function requireResult<T>(value: T | null): T {
	if (value === null) {
		throw new Error('弹窗结果意外为 null');
	}
	return value;
}

/**
 * 收尾：以「库层关闭」（Esc / 点遮罩）结束弹窗并确认 resolve(null)。
 * 每个用例都走一次，避免残留悬挂 Promise 拖慢测试。
 */
async function finishAsClosed(target: {
	readonly modal: ModalStub;
	readonly promise: Promise<unknown>;
}): Promise<void> {
	target.modal.fireClose();
	await expect(target.promise).resolves.toBeNull();
}

/**
 * 让被 `void` 掉的内部 async 链跑完（粘贴按钮的处理器不返回 Promise，
 * 测试无法直接 await）。一个宏任务足以：微任务队列会在定时器回调前排空。
 */
async function flushAsync(): Promise<void> {
	await new Promise<void>((resolve) => {
		window.setTimeout(resolve, 0);
	});
}

/* ===== 命名弹窗 ===== */

interface NameHarness {
	readonly promise: Promise<string | null>;
	readonly modal: ModalStub;
	readonly root: StubElNode;
	readonly hint: StubElNode;
	readonly input: StubElNode;
	readonly buttons: StubElNode;
}

/** 打开名称弹窗（结构：root → [hint, input, buttons]） */
function openName(
	defaultName = '思维导图2026-08-21',
	folderPath = '笔记',
	lang: Language = 'zh',
): NameHarness {
	const promise = openNameInputModal(fakeApp(), defaultName, folderPath, lang);
	const modal = lastModal();
	const root = childAt(modal.contentEl, 0);
	return {
		promise,
		modal,
		root,
		hint: childAt(root, 0),
		input: childAt(root, 1),
		buttons: childAt(root, 2),
	};
}

describe('openNameInputModal（新建文件名称输入弹窗）', () => {
	it('预填与焦点：defaultName 写入并全选，标题/文件夹提示/按钮文案走 i18n', async () => {
		const harness = openName('思维导图2026-08-21', '笔记/子目录');

		expect(harness.modal.openCalls).toBe(1);
		expect(harness.modal.titleEl.text).toBe(t('zh', 'command.createMindMap'));
		expect(harness.root.classes).toEqual(['mindmap-name-editor']);

		expect(harness.hint.text).toBe(
			`${t('zh', 'modal.name.folder')}笔记/子目录`,
		);
		expect(harness.hint.classes).toEqual(['mindmap-modal-muted-hint']);

		expect(harness.input.tagName).toBe('input');
		expect(harness.input.classes).toEqual(['mindmap-modal-input']);
		expect(harness.input.attrs).toEqual({
			type: 'text',
			value: '思维导图2026-08-21',
			spellcheck: 'false',
		});
		expect(harness.input.value).toBe('思维导图2026-08-21');
		expect(harness.input.focusCount).toBe(1);
		// 全选：让用户直接输入新名称即可覆盖默认名
		expect(harness.input.selectCount).toBe(1);

		expect(buttonTexts(harness.buttons)).toEqual([
			t('zh', 'modal.cancel'),
			t('zh', 'modal.create'),
		]);
		expect(buttonIn(harness.buttons, t('zh', 'modal.create')).ctaCalls).toBe(1);

		await finishAsClosed(harness);
	});

	it('文件夹为空串时提示回退 "/"（不留下半截提示）', async () => {
		const harness = openName('默认名', '');

		expect(harness.hint.text).toBe(`${t('zh', 'modal.name.folder')}/`);

		await finishAsClosed(harness);
	});

	it('英文界面：文案取 EN 字典（lang 一路贯穿到标题与提示）', async () => {
		const harness = openName('MindMap 2026-08-21', 'Notes', 'en');

		expect(harness.modal.titleEl.text).toBe('Create new mind map');
		expect(harness.hint.text).toBe('Folder: Notes');
		expect(buttonTexts(harness.buttons)).toEqual(['Cancel', 'Create']);

		await finishAsClosed(harness);
	});

	it('确认按钮 → 去掉首尾空白的名称，并关闭弹窗', async () => {
		const harness = openName();
		harness.input.value = '  项目计划  ';

		clickButton(harness.buttons, t('zh', 'modal.create'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBe('项目计划');
	});

	it('Enter 提交：与确认按钮同一路径（去空白 + 关闭 + 阻止默认行为）', async () => {
		const harness = openName();
		harness.input.value = '  回车命名  ';

		expect(pressKey(harness.input, 'Enter').preventDefaultCount).toBe(1);

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBe('回车命名');
	});

	it('取消按钮 → resolve(null)，已输入内容被丢弃', async () => {
		const harness = openName();
		harness.input.value = '不会被采用';

		clickButton(harness.buttons, t('zh', 'modal.cancel'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBeNull();
	});

	it('空白名称确认 → 拒绝：不 settle、不关闭，只重新聚焦（Enter 同守卫）', async () => {
		for (const raw of ['', '   ', '\t\n ']) {
			const harness = openName();
			harness.input.value = raw;

			clickButton(harness.buttons, t('zh', 'modal.create'));
			// 空白名称无意义：弹窗必须留着，而不是关掉并返回空名
			expect(harness.modal.closeCalls).toBe(0);
			expect(harness.input.focusCount).toBe(2); // 打开时 1 次 + 被拒后 1 次

			expect(pressKey(harness.input, 'Enter').preventDefaultCount).toBe(1);
			expect(harness.modal.closeCalls).toBe(0);
			expect(harness.input.focusCount).toBe(3);

			// 关闭兜底后必须是 null：若空白确认曾 settle('')，首值优先会得到 ''
			harness.modal.fireClose();
			await expect(harness.promise).resolves.toBeNull();
		}
	});

	it('空白名称时确认按钮置灰，输入后即时恢复（取消按钮不受联动影响）', async () => {
		const harness = openName('思维导图2026-08-21');
		const confirm = buttonIn(harness.buttons, t('zh', 'modal.create'));
		// 预填非空 → 打开时即可点
		expect(confirm.disabledStates).toEqual([false]);

		harness.input.value = '';
		fireInput(harness.input);
		expect(confirm.disabledStates).toEqual([false, true]);

		harness.input.value = '   ';
		fireInput(harness.input);
		expect(confirm.disabledStates.at(-1)).toBe(true);

		harness.input.value = '新名称';
		fireInput(harness.input);
		expect(confirm.disabledStates.at(-1)).toBe(false);

		// 只有确认按钮随输入联动
		expect(
			buttonIn(harness.buttons, t('zh', 'modal.cancel')).disabledStates,
		).toEqual([]);

		clickButton(harness.buttons, t('zh', 'modal.cancel'));
		await expect(harness.promise).resolves.toBeNull();
	});

	it('Esc 与遮罩关闭都 resolve(null)；兜底经 setCloseCallback 且未覆写 onClose', async () => {
		// 路径一：输入框 Esc → 主动 settle(null) 并 close()
		const escape = openName();
		expect(pressKey(escape.input, 'Escape').preventDefaultCount).toBe(0);
		expect(escape.modal.closeCalls).toBe(1);
		await expect(escape.promise).resolves.toBeNull();

		// 路径二：点遮罩 / 外部关闭 → 只触发关闭回调（不经插件代码的 close）
		const backdrop = openName();
		expect(backdrop.modal.closeCallbacks).toHaveLength(1);
		expect(backdrop.modal.onCloseWrites).toBe(0);
		backdrop.modal.fireClose();
		await expect(backdrop.promise).resolves.toBeNull();
		expect(backdrop.modal.closeCalls).toBe(0);
	});

	it('确认幂等：二次确认与关闭兜底都不改变首次结果', async () => {
		const harness = openName();

		harness.input.value = '第一次输入';
		clickButton(harness.buttons, t('zh', 'modal.create'));
		harness.input.value = '第二次输入';
		clickButton(harness.buttons, t('zh', 'modal.create'));
		harness.modal.fireClose();

		expect(harness.modal.closeCalls).toBe(2);
		await expect(harness.promise).resolves.toBe('第一次输入');
	});
});

/* ===== 链接弹窗 ===== */

interface LinkHarness {
	readonly promise: Promise<LinkPickResult | null>;
	readonly modal: ModalStub;
	readonly root: StubElNode;
	readonly input: StubElNode;
	readonly buttons: StubElNode;
	readonly suggest: SuggestHandle;
}

/** 打开链接弹窗（结构：root → [input, buttons]） */
function openLink(
	current: string,
	app: App = fakeApp(),
	lang: Language = 'zh',
): LinkHarness {
	const promise = openLinkEditorModal(app, current, lang);
	const modal = lastModal();
	const root = childAt(modal.contentEl, 0);
	return {
		promise,
		modal,
		root,
		input: childAt(root, 0),
		buttons: childAt(root, 1),
		suggest: lastSuggest().instance,
	};
}

describe('openLinkEditorModal（节点链接编辑弹窗）', () => {
	it('预填与焦点：current 写入输入框，标题/占位符/按钮变体走 i18n', async () => {
		const harness = openLink('[[已有笔记]]');

		expect(harness.modal.openCalls).toBe(1);
		expect(harness.modal.titleEl.text).toBe(t('zh', 'modal.link.title'));
		expect(harness.root.classes).toEqual(['mindmap-link-editor']);

		expect(harness.input.tagName).toBe('input');
		expect(harness.input.classes).toEqual([
			'mindmap-link-input',
			'mindmap-modal-input',
		]);
		expect(harness.input.attrs).toEqual({
			type: 'text',
			placeholder: t('zh', 'modal.link.placeholder'),
			value: '[[已有笔记]]',
		});
		expect(harness.input.value).toBe('[[已有笔记]]');
		expect(harness.input.focusCount).toBe(1);

		expect(harness.buttons.classes).toEqual([
			'mindmap-modal-action-row',
			'mindmap-modal-action-row--mt',
		]);
		expect(buttonTexts(harness.buttons)).toEqual([
			t('zh', 'modal.link.clear'),
			t('zh', 'modal.cancel'),
			t('zh', 'modal.apply'),
		]);
		// 清除是弱化操作（muted），取消为普通按钮，应用才是 CTA
		expect(
			buttonIn(harness.buttons, t('zh', 'modal.link.clear')).buttonEl.classes,
		).toEqual(['is-muted']);
		expect(buttonIn(harness.buttons, t('zh', 'modal.apply')).ctaCalls).toBe(1);

		await finishAsClosed(harness);
	});

	it('外部 URL → { link }（保持裸文本、无 label），兜底关闭不覆盖结果', async () => {
		const harness = openLink('');
		harness.input.value = '  https://example.com/a?b=1  ';

		clickButton(harness.buttons, t('zh', 'modal.apply'));
		// close() 之外的关闭路径（Esc / 遮罩）不得到此改写结果
		harness.modal.fireClose();

		const result = requireResult(await harness.promise);
		expect(result).toEqual({ link: 'https://example.com/a?b=1' });
		// 是否包裹为 [[..]] 由序列化统一决定，弹窗只交回原始文本
		expect('label' in result).toBe(false);
		expect(harness.modal.closeCalls).toBe(1);
	});

	it('obsidian:// 协议链接原样透传（不解析、不虚构 label）', async () => {
		const harness = openLink('');
		const url = 'obsidian://open?vault=仓库&file=笔记';
		harness.input.value = url;

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		const result = requireResult(await harness.promise);
		expect(result).toEqual({ link: url });
		expect('label' in result).toBe(false);
	});

	it('手输别名 [[笔记|别名]] → 解析出 label（与联想选择同契约）', async () => {
		const harness = openLink('');
		harness.input.value = '[[笔记|别名]]';

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		// link 原样交回（包裹由序列化决定），label = 别名 → 节点可见文本同步
		expect(requireResult(await harness.promise)).toEqual({
			link: '[[笔记|别名]]',
			label: '别名',
		});
	});

	it('无别名的双链 → 无 label 字段（不虚构可见文本）', async () => {
		const harness = openLink('');
		harness.input.value = '[[笔记]]';

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		const result = requireResult(await harness.promise);
		expect(result).toEqual({ link: '[[笔记]]' });
		expect('label' in result).toBe(false);
	});

	it('附件别名 [[附件/报告.pdf|说明]] → label = 说明', async () => {
		const harness = openLink('');
		harness.input.value = '[[附件/报告.pdf|说明]]';

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		expect(requireResult(await harness.promise)).toEqual({
			link: '[[附件/报告.pdf|说明]]',
			label: '说明',
		});
	});

	it('回车提交：联想浮层未打开时直接提交原始输入（走同一 commit 路径）', async () => {
		const harness = openLink('');

		harness.input.value = '  [[笔记|别名]]  ';
		expect(pressKey(harness.input, 'Enter').preventDefaultCount).toBe(1);

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toEqual({
			link: '[[笔记|别名]]',
			label: '别名',
		});
	});

	it('空白输入：确认按钮与回车都 resolve(null)（与名称弹窗不同，不重新聚焦）', async () => {
		// 确认按钮路径：commitRaw 遇空值即取消（不是清空）
		const blank = openLink('');
		blank.input.value = '   ';
		clickButton(blank.buttons, t('zh', 'modal.apply'));

		expect(blank.modal.closeCalls).toBe(1);
		await expect(blank.promise).resolves.toBeNull();
		expect(blank.input.focusCount).toBe(1); // 没有第二次聚焦

		// 回车路径：空输入同样 resolve(null)
		const empty = openLink('');
		expect(pressKey(empty.input, 'Enter').preventDefaultCount).toBe(1);
		expect(empty.modal.closeCalls).toBe(1);
		await expect(empty.promise).resolves.toBeNull();
	});

	it('清除链接按钮（muted）→ { link: "" }（清空通道，区别于取消 null）', async () => {
		const harness = openLink('[[已有笔记]]');

		clickButton(harness.buttons, t('zh', 'modal.link.clear'));

		const result = requireResult(await harness.promise);
		expect(result).toEqual({ link: '' });
		expect('label' in result).toBe(false);
		expect(harness.modal.closeCalls).toBe(1);
	});

	it('取消按钮 → resolve(null)', async () => {
		const harness = openLink('[[已有笔记]]');

		clickButton(harness.buttons, t('zh', 'modal.cancel'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBeNull();
	});

	it('确认幂等：二次确认与关闭兜底都不改变首次结果', async () => {
		const harness = openLink('');

		harness.input.value = '第一条链接';
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		harness.input.value = '第二条链接';
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		harness.modal.fireClose();

		expect(harness.modal.closeCalls).toBe(2);
		await expect(harness.promise).resolves.toEqual({ link: '第一条链接' });
	});

	it('关闭兜底经 setCloseCallback 注册，且未覆写 onClose', async () => {
		const harness = openLink('');

		expect(harness.modal.closeCallbacks).toHaveLength(1);
		expect(harness.modal.onCloseWrites).toBe(0);

		harness.modal.fireClose();

		await expect(harness.promise).resolves.toBeNull();
		expect(harness.modal.closeCalls).toBe(0);
	});

	it('联想接线：候选为「md 笔记在前 + 可链接附件在后」，挂真实输入元素', () => {
		const noteA = fakeFile('笔记甲', 'md', '目录');
		const noteB = fakeFile('笔记乙', 'md', '目录');
		const audio = fakeFile('笔记录音', 'mp3', '附件');
		const pdfFile = fakeFile('扫描件', 'pdf', '附件');
		const pngFile = fakeFile('插画', 'png', '附件');
		const app = fakeApp({
			markdownFiles: [noteA, noteB],
			files: [noteA, noteB, audio, pdfFile, pngFile],
		});
		const harness = openLink('', app);

		// 基类拿到 (app, 弹窗的输入元素)：联想确实挂在用户正在输入的那个框上
		expect(suggestRecords).toHaveLength(1);
		expect(suggestRecords[0]?.app).toBe(app);
		expect(suggestRecords[0]?.inputEl).toBe(harness.input);

		// 候选顺序：md 笔记（库内原序）在前，可链接附件在后；png 不是可链接附件
		expect(
			harness.suggest.getSuggestions('笔记').map((file) => file.basename),
		).toEqual(['笔记甲', '笔记乙', '笔记录音']);
		expect(
			harness.suggest.getSuggestions('扫描').map((file) => file.name),
		).toEqual(['扫描件.pdf']);
		expect(harness.suggest.getSuggestions('插画')).toEqual([]);

		// 展示描述由弹窗注入：笔记用 file-text + basename，附件用 file + 完整文件名
		const noteEl = createStubElement('div');
		harness.suggest.renderSuggestion(noteA, asHTMLElement(noteEl));
		expect(noteEl.children.map((child) => child.text)).toEqual([
			'',
			'笔记甲',
			'目录',
		]);
		expect(setIconMock).toHaveBeenLastCalledWith(childAt(noteEl, 0), 'file-text');

		const audioEl = createStubElement('div');
		harness.suggest.renderSuggestion(audio, asHTMLElement(audioEl));
		expect(audioEl.children.map((child) => child.text)).toEqual([
			'',
			'笔记录音.mp3',
			'附件',
		]);
		expect(setIconMock).toHaveBeenLastCalledWith(childAt(audioEl, 0), 'file');

		// 本用例只验证接线：收尾关闭，避免悬挂 Promise
		harness.modal.fireClose();
	});

	it('联想选择：唯一笔记 / 重名笔记（路径消歧）/ 附件三种结果', async () => {
		// 唯一同名笔记 → [[名称]] + label = 名称
		const uniqueApp = fakeApp({
			markdownFiles: [fakeFile('笔记甲', 'md', '目录')],
			files: [fakeFile('笔记甲', 'md', '目录')],
		});
		const unique = openLink('', uniqueApp);
		unique.suggest.selectSuggestion(
			requireResult(unique.suggest.getSuggestions('笔记甲')[0] ?? null),
			fakeMouseEvent(),
		);
		expect(unique.modal.closeCalls).toBe(1);
		await expect(unique.promise).resolves.toEqual({
			link: '[[笔记甲]]',
			label: '笔记甲',
		});

		// 同名笔记（两处）→ 用库内路径消歧（Obsidian 双链 [[路径/名|名]] 语义）
		const dupFiles = [
			fakeFile('重名笔记', 'md', '目录A'),
			fakeFile('重名笔记', 'md', '目录B'),
		];
		const dup = openLink('', fakeApp({ markdownFiles: dupFiles, files: dupFiles }));
		dup.suggest.selectSuggestion(
			requireResult(dup.suggest.getSuggestions('重名笔记')[1] ?? null),
			fakeMouseEvent(),
		);
		await expect(dup.promise).resolves.toEqual({
			link: '[[目录B/重名笔记.md|重名笔记]]',
			label: '重名笔记',
		});

		// 附件 → 完整库内路径链接，label 为含扩展名的文件名
		const audio = fakeFile('音频素材', 'mp3', '附件');
		const attach = openLink('', fakeApp({ files: [audio] }));
		attach.suggest.selectSuggestion(
			requireResult(attach.suggest.getSuggestions('音频素材')[0] ?? null),
			fakeMouseEvent(),
		);
		expect(attach.modal.closeCalls).toBe(1);
		await expect(attach.promise).resolves.toEqual({
			link: '[[附件/音频素材.mp3]]',
			label: '音频素材.mp3',
		});
	});

	it('联想选择的 settle 幂等：close 触发的兜底不改写已选结果', async () => {
		const note = fakeFile('唯一笔记', 'md', '目录');
		const harness = openLink('', fakeApp({ markdownFiles: [note], files: [note] }));

		harness.suggest.selectSuggestion(
			requireResult(harness.suggest.getSuggestions('唯一笔记')[0] ?? null),
			fakeMouseEvent(),
		);
		// 选择后弹窗会 close()（同步触发关闭回调），兜底不得把结果变成 null
		harness.modal.fireClose();

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toEqual({
			link: '[[唯一笔记]]',
			label: '唯一笔记',
		});
	});

	it('英文界面：标题/占位符/按钮文案取 EN 字典', async () => {
		const harness = openLink('', fakeApp(), 'en');

		expect(harness.modal.titleEl.text).toBe('Set node link');
		expect(harness.input.attrs['placeholder']).toBe(
			'Enter a URL or search notes/attachments…',
		);
		expect(buttonTexts(harness.buttons)).toEqual([
			'Clear link',
			'Cancel',
			'Apply',
		]);

		await finishAsClosed(harness);
	});
});

/* ===== 图片弹窗 ===== */

type SaveImage = (
	file: File,
	maxSizeMB?: number,
	nameOverride?: string,
) => Promise<TFile | null>;

interface ImageHarness {
	readonly promise: Promise<string | null>;
	readonly modal: ModalStub;
	readonly root: StubElNode;
	readonly status: StubElNode;
	readonly label: StubElNode;
	readonly input: StubElNode;
	readonly fileInput: StubElNode;
	readonly actions: StubElNode;
	readonly fileStatus: StubElNode;
	readonly preview: StubElNode;
	readonly buttons: StubElNode;
	readonly suggest: SuggestHandle;
	readonly saveImage: Mock<SaveImage>;
}

interface OpenImageOptions {
	readonly files?: TFile[];
	readonly lang?: Language;
	/** saveImage 成功时返回的库内文件；null 表示保存失败 */
	readonly saved?: TFile | null;
	/** saveImage 直接抛错（保存异常路径） */
	readonly reject?: boolean;
}

/**
 * 打开图片弹窗。结构（与 src 中的创建顺序一致）：
 * root → [status, label, input, fileInput, actions, preview, buttons]
 */
function openImage(
	current: string,
	options: OpenImageOptions = {},
): ImageHarness {
	const saved = options.saved ?? null;
	const saveImage = vi.fn<SaveImage>(() =>
		options.reject === true
			? Promise.reject(new Error('保存失败'))
			: Promise.resolve(saved),
	);
	const promise = openImageEditorModal(
		fakeApp({ files: options.files ?? [] }),
		current,
		saveImage,
		options.lang ?? 'zh',
	);
	const modal = lastModal();
	const root = childAt(modal.contentEl, 0);
	const actions = childAt(root, 4);
	return {
		promise,
		modal,
		root,
		status: childAt(root, 0),
		label: childAt(root, 1),
		input: childAt(root, 2),
		fileInput: childAt(root, 3),
		actions,
		fileStatus: childAt(actions, 0),
		preview: childAt(root, 5),
		buttons: childAt(root, 6),
		suggest: lastSuggest().instance,
		saveImage,
	};
}

/** 伪造用户从本地选中的图片（saveImage 是注入的，故只需满足签名） */
function fakePickedFile(name: string): File {
	return {
		name,
		type: 'image/png',
		size: 1024,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
	} as unknown as File;
}

/** 触发 <input type="file"> 的 change（走 src 的真实 onchange 处理器） */
async function fireFileChange(
	fileInput: StubElNode,
	file: File,
): Promise<void> {
	fileInput.files = [file];
	const handler = fileInput.onchange;
	if (handler === null) {
		throw new Error('fileInput.onchange 未接线');
	}
	await handler();
}

/** 取保存调用参数（未调用直接抛错，避免可选链静默通过） */
function firstSaveCall(
	saveImage: Mock<SaveImage>,
): [file: File, maxSizeMB?: number, nameOverride?: string] {
	const call = saveImage.mock.calls[0];
	if (call === undefined) {
		throw new Error('saveImage 未被调用');
	}
	return call;
}

describe('openImageEditorModal（节点图片编辑弹窗）', () => {
	it('预填与焦点：库内路径原样填入，标题/标签/占位符/按钮文案走 i18n', async () => {
		const png = fakeFile('照片', 'png', '附件');
		const harness = openImage(png.path, { files: [png] });

		expect(harness.modal.openCalls).toBe(1);
		expect(harness.modal.titleEl.text).toBe(t('zh', 'modal.image.title'));
		expect(harness.root.classes).toEqual(['mindmap-image-editor']);

		expect(harness.status.classes).toEqual(['mindmap-modal-muted-hint']);
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.internalPath')}${png.path}`,
		);
		expect(harness.label.text).toBe(t('zh', 'modal.image.urlLabel'));
		expect(harness.label.classes).toEqual(['mindmap-modal-label']);

		expect(harness.input.tagName).toBe('input');
		expect(harness.input.classes).toEqual(['mindmap-modal-input']);
		expect(harness.input.attrs).toEqual({
			type: 'text',
			placeholder: t('zh', 'modal.image.hint'),
			value: png.path,
		});
		expect(harness.input.value).toBe(png.path);
		expect(harness.input.focusCount).toBe(1);

		// 隐藏的文件选择器只接受图片
		expect(harness.fileInput.tagName).toBe('input');
		expect(harness.fileInput.attrs).toEqual({
			type: 'file',
			accept: 'image/*',
		});
		expect(harness.fileInput.classes).toEqual(['mindmap-modal-hidden']);

		expect(harness.actions.classes).toEqual([
			'mindmap-modal-action-row',
			'mindmap-modal-action-row--inline',
		]);
		expect(buttonTexts(harness.actions)).toEqual([
			t('zh', 'modal.image.chooseLocal'),
			t('zh', 'modal.image.paste'),
		]);
		expect(buttonTexts(harness.buttons)).toEqual([
			t('zh', 'modal.image.clear'),
			t('zh', 'modal.cancel'),
			t('zh', 'modal.apply'),
		]);
		expect(
			buttonIn(harness.buttons, t('zh', 'modal.image.clear')).buttonEl.classes,
		).toEqual(['is-muted']);
		expect(buttonIn(harness.buttons, t('zh', 'modal.apply')).ctaCalls).toBe(
			1,
		);
		// 悬停提示说明「会自动保存到附件目录」
		expect(
			buttonIn(harness.actions, t('zh', 'modal.image.chooseLocal')).buttonEl
				.title,
		).toBe(t('zh', 'modal.image.localHint'));

		// 打开即预览：库内路径经统一解析入口 → 资源地址
		expect(childAt(harness.preview, 0).src).toBe(`app://local/${png.path}`);

		await finishAsClosed(harness);
	});

	it('current 为空：预览与状态都是「无图片」空态', async () => {
		const harness = openImage('');

		expect(harness.input.value).toBe('');
		expect(harness.status.text).toBe(t('zh', 'modal.image.none'));
		expect(harness.preview.children).toHaveLength(0);
		expect(harness.preview.text).toBe(t('zh', 'modal.image.none'));
		expect(harness.preview.classes).toContain('is-empty');

		await finishAsClosed(harness);
	});

	it('app:// 资源地址：解码并剥离主机前缀后填入输入框', async () => {
		const png = fakeFile('资源图', 'png', '附件');
		const resource = `app://local/${encodeURIComponent(png.path)}`;
		const harness = openImage(resource, { files: [png] });

		// 用户可编辑的是库内路径，不是资源地址
		expect(harness.input.value).toBe(png.path);
		expect(harness.input.attrs['value']).toBe(png.path);
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.internalPath')}${png.path}`,
		);
		expect(childAt(harness.preview, 0).src).toBe(`app://local/${png.path}`);

		await finishAsClosed(harness);
	});

	it('畸形 % 序列（app:// 解码失败）不抛错：回退原值，弹窗照常可用', async () => {
		// decodeURIComponent('%E9%99') 会抛 URIError；抛出去整个弹窗就打不开了
		const malformed = 'app://local/%E9%99';
		const harness = openImage(malformed);

		expect(harness.input.value).toBe(malformed);
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.internalPath')}${malformed}`,
		);
		// 解析不到库内文件 → 无预览（不崩）
		expect(harness.preview.text).toBe(t('zh', 'modal.image.none'));
		expect(harness.preview.classes).toContain('is-empty');

		await finishAsClosed(harness);
	});

	it('obsidian:// 引用不进输入框，但预览仍能解析到库内文件', async () => {
		const png = fakeFile('协议图', 'png', '附件');
		const harness = openImage(
			`obsidian://open?vault=仓库&file=${png.path}`,
			{ files: [png] },
		);

		// 现状：协议串不适合当路径编辑，输入框留空；预览经统一解析入口命中
		expect(harness.input.value).toBe('');
		expect(childAt(harness.preview, 0).src).toBe(`app://local/${png.path}`);

		// 因此「应用」交回空串（= 清空引用），而不是原协议串
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		await expect(harness.promise).resolves.toBe('');
	});

	it('外链：预览直接用 URL（不查库），过长地址在状态栏截断', async () => {
		const harness = openImage('');
		const short = 'https://cdn.example.com/a.png';
		harness.input.value = short;
		fireInput(harness.input);

		expect(childAt(harness.preview, 0).src).toBe(short);
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.address')}${short}`,
		);

		// 超过 60 字符 → 截断 + 省略号（状态栏不被长 URL 撑爆）
		const long = `https://cdn.example.com/${'a'.repeat(60)}.png`;
		harness.input.value = long;
		fireInput(harness.input);

		expect(childAt(harness.preview, 0).src).toBe(long);
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.address')}${long.slice(0, 60)}…`,
		);

		await finishAsClosed(harness);
	});

	it('file:// 视为外部引用：预览原样使用，不做库内解析', async () => {
		const harness = openImage('');
		const local = 'file:///D:/图片/本地图.png';
		harness.input.value = local;
		fireInput(harness.input);

		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.address')}${local}`,
		);
		expect(childAt(harness.preview, 0).src).toBe(local);

		await finishAsClosed(harness);
	});

	it('库内路径：命中文件用 getResourcePath 预览，未命中回落到空态', async () => {
		const png = fakeFile('本地照片', 'png', '附件');
		const harness = openImage('', { files: [png] });

		harness.input.value = png.path;
		fireInput(harness.input);
		expect(childAt(harness.preview, 0).src).toBe(`app://local/${png.path}`);
		expect(harness.preview.classes).not.toContain('is-empty');
		expect(harness.preview.classes).not.toContain('is-error');

		// 库里不存在的路径 → 无预览（不是加载失败）
		harness.input.value = '不存在/幽灵图.png';
		fireInput(harness.input);
		expect(harness.preview.children).toHaveLength(0);
		expect(harness.preview.text).toBe(t('zh', 'modal.image.none'));
		expect(harness.preview.classes).toContain('is-empty');
		expect(harness.preview.classes).not.toContain('is-error');

		await finishAsClosed(harness);
	});

	it('图片加载失败：onerror 把预览替换为失败文案并标记 is-error', async () => {
		const png = fakeFile('损坏图', 'png', '附件');
		const harness = openImage(png.path, { files: [png] });
		const img = childAt(harness.preview, 0);

		expect(img.tagName).toBe('img');
		const onerror = img.onerror;
		if (onerror === null) {
			throw new Error('img.onerror 未接线');
		}
		onerror();

		expect(harness.preview.children).toHaveLength(0);
		expect(harness.preview.text).toBe(t('zh', 'modal.image.loadFailed'));
		expect(harness.preview.classes).toContain('is-error');
		expect(harness.preview.classes).not.toContain('is-empty');

		await finishAsClosed(harness);
	});

	it('联想接线：候选只有图片扩展名；选中后把库内路径写入输入框并同步预览', async () => {
		const png = fakeFile('联想图', 'png', '附件');
		const note = fakeFile('联想笔记', 'md', '目录');
		const pdfFile = fakeFile('联想报告', 'pdf', '附件');
		const harness = openImage('', { files: [png, note, pdfFile] });

		expect(harness.suggest.getSuggestions('联想图')).toEqual([png]);
		// 笔记与 PDF 不是图片：不进图片联想
		expect(harness.suggest.getSuggestions('联想笔记')).toEqual([]);
		expect(harness.suggest.getSuggestions('联想报告')).toEqual([]);

		// 展示：image 图标 + 含扩展名的文件名 + 所在目录
		const el = createStubElement('div');
		harness.suggest.renderSuggestion(png, asHTMLElement(el));
		expect(el.children.map((child) => child.text)).toEqual([
			'',
			'联想图.png',
			'附件',
		]);
		expect(setIconMock).toHaveBeenLastCalledWith(childAt(el, 0), 'image');

		// 选中 → 写入输入框的具体文本（库内相对路径），预览与状态同步
		harness.suggest.selectSuggestion(png, fakeMouseEvent());
		expect(harness.input.value).toBe('附件/联想图.png');
		expect(childAt(harness.preview, 0).src).toBe('app://local/附件/联想图.png');
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.internalPath')}附件/联想图.png`,
		);

		// 确认交回的就是规范引用（库内相对路径）
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		await expect(harness.promise).resolves.toBe('附件/联想图.png');
	});

	it('应用：settle 去空白后的输入值；二次点击与兜底关闭都不改变首次结果', async () => {
		const harness = openImage('');

		harness.input.value = '  附件/图.png  ';
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		harness.input.value = '附件/另一张.png';
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		harness.modal.fireClose();

		expect(harness.modal.closeCalls).toBe(2);
		await expect(harness.promise).resolves.toBe('附件/图.png');
	});

	it('空输入点应用 → 空串（清空引用语义，不是取消 null）', async () => {
		const harness = openImage('');

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBe('');
	});

	it('取消 → null；清除图片（muted）→ 空串', async () => {
		const cancel = openImage('附件/图.png');
		clickButton(cancel.buttons, t('zh', 'modal.cancel'));
		expect(cancel.modal.closeCalls).toBe(1);
		await expect(cancel.promise).resolves.toBeNull();

		const clear = openImage('附件/图.png');
		clickButton(clear.buttons, t('zh', 'modal.image.clear'));
		expect(clear.modal.closeCalls).toBe(1);
		await expect(clear.promise).resolves.toBe('');
	});

	it('关闭兜底经 setCloseCallback（未覆写 onClose）→ resolve(null)', async () => {
		const harness = openImage('附件/图.png');

		expect(harness.modal.closeCallbacks).toHaveLength(1);
		expect(harness.modal.onCloseWrites).toBe(0);

		harness.modal.fireClose();

		await expect(harness.promise).resolves.toBeNull();
		expect(harness.modal.closeCalls).toBe(0);
	});

	it('选择本地图片：先 click 隐藏的文件选择器，选中后保存并把库内路径写回输入框', async () => {
		const saved = fakeFile('新入库图', 'png', '附件');
		const harness = openImage('', { files: [saved], saved });

		// 「选择本地图片」只是转发到隐藏的 file input
		clickButton(harness.actions, t('zh', 'modal.image.chooseLocal'));
		expect(harness.fileInput.clickCount).toBe(1);
		expect(harness.saveImage).not.toHaveBeenCalled();

		const picked = fakePickedFile('本地图片.png');
		await fireFileChange(harness.fileInput, picked);

		const call = firstSaveCall(harness.saveImage);
		expect(call[0]).toBe(picked);
		// 大小上限来自 constants（与 images-save 的入库路径同一来源）
		expect(call[1]).toBe(MAX_IMAGE_SIZE_MB);
		// 本地选择不指定名字 → 用文件原名（undefined 表示走 saveImage 默认策略）
		expect(call[2]).toBeUndefined();

		expect(harness.input.value).toBe(saved.path);
		expect(harness.fileStatus.text).toBe(
			`${t('zh', 'modal.image.saved')}${saved.path}`,
		);
		expect(harness.fileStatus.classes).not.toContain('is-error');
		expect(harness.status.text).toBe(
			`${t('zh', 'modal.image.internalPath')}${saved.path}`,
		);
		expect(childAt(harness.preview, 0).src).toBe(`app://local/${saved.path}`);

		await finishAsClosed(harness);
	});

	it('本地保存失败（saveImage 返回 null）→ 提示保存失败并标记 is-error，不写入路径', async () => {
		const harness = openImage('', { saved: null });

		await fireFileChange(harness.fileInput, fakePickedFile('失败图.png'));

		expect(harness.saveImage).toHaveBeenCalledTimes(1);
		expect(harness.fileStatus.text).toBe(t('zh', 'modal.image.saveFailed'));
		// 状态行是「基类 + is-error 修饰类」两个类（src 里 addClass 基类、
		// toggleClass 切修饰类），故这里断言完整类表而不是只有修饰类
		expect(harness.fileStatus.classes).toEqual([
			'mindmap-modal-file-status',
			'is-error',
		]);
		// 输入框保持原值（没有假装成功）
		expect(harness.input.value).toBe('');

		await finishAsClosed(harness);
	});

	it('本地保存抛错 → 被捕获并提示保存失败（不产生未处理的拒绝）', async () => {
		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		const harness = openImage('', { reject: true });

		await fireFileChange(harness.fileInput, fakePickedFile('异常图.png'));

		expect(harness.fileStatus.text).toBe(t('zh', 'modal.image.saveFailed'));
		expect(harness.fileStatus.classes).toEqual([
			'mindmap-modal-file-status',
			'is-error',
		]);
		expect(errorSpy).toHaveBeenCalled();

		await finishAsClosed(harness);
	});

	it('粘贴图片：按 Obsidian 核心约定命名（Pasted image …）保存并回填库内路径', async () => {
		const saved = fakeFile('粘贴入库图', 'png', '附件');
		const harness = openImage('', { files: [saved], saved });
		const blob = new Blob(['image-bytes'], { type: 'image/png' });
		vi.stubGlobal('navigator', {
			clipboard: {
				read: () =>
					Promise.resolve([
						{
							types: ['text/plain', 'image/png'],
							getType: () => Promise.resolve(blob),
						},
					]),
			},
		});

		clickButton(harness.actions, t('zh', 'modal.image.paste'));
		// 处理器内部是 `void pasteFromClipboard()`：等微任务链跑完
		await flushAsync();

		const call = firstSaveCall(harness.saveImage);
		expect(call[0].name).toBe('clipboard.png');
		expect(call[0].type).toBe('image/png');
		expect(call[1]).toBe(MAX_IMAGE_SIZE_MB);
		// 命名走 Obsidian 核心约定：不本地化、不含扩展名
		expect(call[2]).toMatch(/^Pasted image \d{14}$/);

		expect(harness.input.value).toBe(saved.path);
		expect(harness.fileStatus.text).toBe(
			`${t('zh', 'modal.image.saved')}${saved.path}`,
		);

		await finishAsClosed(harness);
	});

	it('剪贴板无图片 → 提示「剪贴板中没有图片」；读取被拒 → 提示无法访问剪贴板', async () => {
		const noImage = openImage('');
		vi.stubGlobal('navigator', {
			clipboard: {
				read: () =>
					Promise.resolve([
						{
							types: ['text/plain'],
							getType: () => Promise.resolve(new Blob(['纯文本'])),
						},
					]),
			},
		});

		clickButton(noImage.actions, t('zh', 'modal.image.paste'));
		await flushAsync();

		expect(noImage.saveImage).not.toHaveBeenCalled();
		expect(noImage.fileStatus.text).toBe(
			t('zh', 'modal.image.noClipboardImage'),
		);
		expect(noImage.fileStatus.classes).toEqual([
			'mindmap-modal-file-status',
			'is-error',
		]);
		await finishAsClosed(noImage);

		// 剪贴板 API 被拒（权限 / 非安全上下文）→ 另一条提示文案
		const denied = openImage('');
		vi.stubGlobal('navigator', {
			clipboard: { read: () => Promise.reject(new Error('denied')) },
		});

		clickButton(denied.actions, t('zh', 'modal.image.paste'));
		await flushAsync();

		expect(denied.saveImage).not.toHaveBeenCalled();
		expect(denied.fileStatus.text).toBe(t('zh', 'modal.image.clipboardError'));
		expect(denied.fileStatus.classes).toEqual([
			'mindmap-modal-file-status',
			'is-error',
		]);
		await finishAsClosed(denied);
	});

	it('英文界面：标题/标签/占位符/状态/按钮文案取 EN 字典', async () => {
		const harness = openImage('附件/图.png', { lang: 'en' });

		expect(harness.modal.titleEl.text).toBe('Set node image');
		expect(harness.label.text).toBe('Image URL or vault path: ');
		expect(harness.input.attrs['placeholder']).toBe(
			'Enter URL, or choose a local image below (auto-saved to attachments)',
		);
		expect(harness.status.text).toBe('Vault path: 附件/图.png');
		expect(buttonTexts(harness.buttons)).toEqual([
			'Clear image',
			'Cancel',
			'Apply',
		]);
		expect(buttonTexts(harness.actions)).toEqual([
			'Choose local image',
			'Paste image',
		]);

		await finishAsClosed(harness);
	});
});
