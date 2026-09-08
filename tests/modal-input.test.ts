/**
 * modal-name / modal-link 弹窗回归测试：两个输入弹窗的 Promise 契约、
 * 按钮分流与库内文件联想接线。
 *
 * 覆盖点：
 * - openNameInputModal：未点按钮关闭（onClose 兜底）/ Esc → null；确认 → 去首尾
 *   空白的名称；取消 → null；空白确认被拒（不 settle、重新聚焦，关闭后才兜底
 *   resolve(null)）；defaultName 预填 + focus/select + i18n 标题与文件夹提示；
 *   确认幂等（settle 首值优先）。
 * - openLinkEditorModal：取消 → null；普通输入 → { link }（保持裸文本、无 label）；
 *   别名语法原样透传（弹窗不解析别名）；current 预填；清除链接 → { link: '' }
 *   （view-node-actions 的清空通道）；空白确认 / 回车 → null；库内文件联想接线
 *   （候选顺序与三种选择结果）；确认后 onClose 不覆盖结果。
 *
 * obsidian 模块被 vi.mock 替换为可断言的最小实现（tests/mocks/obsidian.ts 的
 * Modal 是空类、ButtonComponent / AbstractInputSuggest 只是可链接空桩）：
 * - Modal：contentEl / titleEl 为伪元素，open() 记录调用，close() 同步触发 onClose
 *   （对齐真实 Obsidian 的 Esc / 点遮罩路径），onClose 也可由测试直接触发；
 * - ButtonComponent：记录按钮文本 / CTA / is-muted / 所属容器与点击处理器，
 *   便于「按文案点击真实处理器」；
 * - AbstractInputSuggest：记录 (app, inputEl) 并把实例交给测试——VaultFileSuggest
 *   是真实实现，故候选过滤、渲染与选择结果都按真实行为断言。
 * Node 环境无真实 DOM：伪元素记录子节点 / 类名 / 文本 / 监听器与输入框状态，
 * 断言落在真实调用痕迹上（非 mock 行为）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { t, type Language } from '../src/i18n';
import { openLinkEditorModal, type LinkPickResult } from '../src/modal-link';
import { openNameInputModal } from '../src/modal-name';

/** 伪键盘事件（keydown 分流所需最小面） */
interface FakeKeyEvent {
	readonly key: string;
	readonly preventDefault: () => void;
}

/** createEl / createDiv / createSpan 的初始化参数（对齐 Obsidian 的 DomElementInfo 子集） */
interface FakeElInit {
	readonly cls?: string;
	readonly text?: string;
	readonly attr?: Record<string, string>;
}

/**
 * 伪 DOM 元素最小面：记录子节点、类名、文本、监听器与输入框状态。
 * 只实现两个弹窗真正用到的成员（createDiv / createEl / createSpan / addClass /
 * setText / empty / focus / select / addEventListener / value）。
 */
interface FakeElNode {
	readonly tag: string;
	readonly children: FakeElNode[];
	readonly classes: string[];
	readonly attrs: Record<string, string>;
	readonly keydownListeners: ((event: FakeKeyEvent) => void)[];
	value: string;
	text: string;
	focusCount: number;
	selectCount: number;
	createDiv(cls?: string): FakeElNode;
	createEl(tag: string, init?: FakeElInit): FakeElNode;
	createSpan(init?: FakeElInit | string): FakeElNode;
	addClass(...cls: string[]): void;
	setText(text: string): void;
	empty(): void;
	focus(): void;
	select(): void;
	addEventListener(type: string, listener: (event: FakeKeyEvent) => void): void;
	/** input 事件监听（空白名称禁用确认按钮用） */
	readonly inputListeners: ((event: unknown) => void)[];
}

/** ButtonComponent 记录（每次 new ButtonComponent 追加一条） */
interface ButtonRecord {
	/** 承载按钮的容器（按容器 + 文案定位按钮，多弹窗场景不串台） */
	container: unknown;
	texts: string[];
	ctaCalls: number;
	clickHandlers: (() => void)[];
	classes: string[];
	/** setDisabled 调用序列（末项即当前禁用状态） */
	disabledStates: boolean[];
}

/** 伪 Modal 记录（contentEl / titleEl 为伪元素，关闭回调经 setCloseCallback 注册） */
interface ModalStub {
	onClose: () => void;
	/** 模拟 Esc / 点遮罩：触发 createModalSettle 注册的关闭回调（不计入 closeCalls） */
	fireClose(): void;
	readonly contentEl: FakeElNode;
	readonly titleEl: FakeElNode;
	readonly openCalls: number;
	readonly closeCalls: number;
}

/** VaultFileSuggest 实例的窄访问面（真实实现，基类构造时交给测试） */
interface SuggestHandle {
	getSuggestions(query: string): TFile[];
	renderSuggestion(file: TFile, el: HTMLElement): void;
	selectSuggestion(file: TFile, evt: MouseEvent): void;
}

/** AbstractInputSuggest 构造记录（真实类由 VaultFileSuggest 继承，实例即子类实例） */
interface SuggestRecord {
	readonly app: unknown;
	readonly inputEl: unknown;
	readonly instance: SuggestHandle;
}

/**
 * 伪元素与记录表必须在 vi.hoisted 内定义：vi.mock 工厂被提升到文件顶部，
 * 引用普通顶层变量会触发「Cannot access before initialization」。
 */
const { FakeEl, modalStubs, buttonRecords, suggestRecords, setIconMock } =
	vi.hoisted(() => {
		class FakeElClass implements FakeElNode {
			readonly tag: string;
			readonly children: FakeElClass[] = [];
			readonly classes: string[] = [];
			readonly attrs: Record<string, string>;
			readonly keydownListeners: ((event: FakeKeyEvent) => void)[] = [];
			readonly inputListeners: ((event: unknown) => void)[] = [];
			value: string;
			text = '';
			focusCount = 0;
			selectCount = 0;

			constructor(tag: string, init: FakeElInit = {}) {
				this.tag = tag;
				this.attrs = init.attr ?? {};
				this.value = init.attr?.value ?? '';
				if (init.cls !== undefined) {
					// Obsidian 的 cls 支持空格分隔多类名
					this.classes.push(
						...init.cls.split(/\s+/).filter((part) => part !== ''),
					);
				}
				if (init.text !== undefined) {
					this.text = init.text;
				}
			}

			createDiv(cls?: string): FakeElClass {
				const child = new FakeElClass('div');
				if (cls !== undefined) {
					child.classes.push(cls);
				}
				this.children.push(child);
				return child;
			}

			createEl(tag: string, init: FakeElInit = {}): FakeElClass {
				const child = new FakeElClass(tag, init);
				this.children.push(child);
				return child;
			}

			createSpan(init: FakeElInit | string = {}): FakeElClass {
				const resolved: FakeElInit =
					typeof init === 'string' ? { cls: init } : init;
				const child = new FakeElClass('span', resolved);
				this.children.push(child);
				return child;
			}

			addClass(...cls: string[]): void {
				this.classes.push(...cls);
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

			addEventListener(
				type: string,
				listener: (event: FakeKeyEvent) => void,
			): void {
				if (type === 'keydown') {
					this.keydownListeners.push(listener);
				} else if (type === 'input') {
					this.inputListeners.push(listener as (event: unknown) => void);
				}
			}
		}

		return {
			FakeEl: FakeElClass,
			modalStubs: [] as ModalStub[],
			buttonRecords: [] as ButtonRecord[],
			suggestRecords: [] as SuggestRecord[],
			setIconMock: vi.fn<(parent: unknown, iconId: string) => void>(),
		};
	});

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();

	class MockButtonComponent {
		readonly record: ButtonRecord;
		readonly buttonEl: { addClass: (cls: string) => void };

		constructor(containerEl: unknown) {
			const record: ButtonRecord = {
				container: containerEl,
				texts: [],
				ctaCalls: 0,
				clickHandlers: [],
				classes: [],
				disabledStates: [],
			};
			buttonRecords.push(record);
			this.record = record;
			this.buttonEl = {
				addClass: (cls: string): void => {
					record.classes.push(cls);
				},
			};
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

		setDisabled(disabled: boolean): MockButtonComponent {
			this.record.disabledStates.push(disabled);
			return this;
		}
	}

	class MockModal implements ModalStub {
		onClose: () => void = () => {};
		readonly contentEl: FakeElNode = new FakeEl('div');
		readonly titleEl: FakeElNode = new FakeEl('h2');
		openCalls = 0;
		closeCalls = 0;
		/** createModalSettle 经官方 setCloseCallback 注册的兜底 */
		private closeCallback: (() => unknown) | null = null;

		constructor(_app: unknown) {
			modalStubs.push(this);
		}

		open(): void {
			this.openCalls += 1;
		}

		setCloseCallback(callback: () => unknown): this {
			this.closeCallback = callback;
			return this;
		}

		/** 真实 Obsidian：close() 触发关闭回调，并调用 onClose */
		close(): void {
			this.closeCalls += 1;
			this.closeCallback?.();
			this.onClose();
		}

		/** 模拟 Esc / 点遮罩：Obsidian 关闭弹窗（不经本插件代码调用的 close） */
		fireClose(): void {
			this.closeCallback?.();
		}
	}

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

/** 伪 App：两个弹窗只用到 app.vault 的两个文件列表接口 */
interface FakeAppOptions {
	readonly markdownFiles?: TFile[];
	readonly files?: TFile[];
}

function fakeApp(options: FakeAppOptions = {}): App {
	const markdownFiles = options.markdownFiles ?? [];
	const files = options.files ?? [];
	return {
		vault: {
			getMarkdownFiles: () => markdownFiles,
			getFiles: () => files,
		},
	} as unknown as App;
}

/** 伪库内文件：basename / extension / path / parent.path 参与候选过滤与结果构造 */
function fakeFile(basename: string, extension: string, folderPath: string): TFile {
	const name = `${basename}.${extension}`;
	const path = folderPath === '' ? name : `${folderPath}/${name}`;
	const parent = Object.assign(new TFolder(), { path: folderPath });
	return Object.assign(new TFile(), { basename, name, path, extension, parent });
}

/** 取第 index 个子元素（noUncheckedIndexedAccess 下显式收窄） */
function childAt(parent: FakeElNode, index: number): FakeElNode {
	const child = parent.children[index];
	if (child === undefined) {
		throw new Error(`伪元素缺少第 ${String(index)} 个子节点`);
	}
	return child;
}

/** 取最近创建的弹窗（一个 it 内可能开多个弹窗） */
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
function buttonIn(container: FakeElNode, text: string): ButtonRecord {
	const record = buttonRecords.find(
		(entry) => entry.container === container && entry.texts.includes(text),
	);
	if (record === undefined) {
		throw new Error(`容器内未找到按钮：${text}`);
	}
	return record;
}

/** 点击容器内文案匹配的按钮（走真实 onClick 处理器） */
function clickButton(container: FakeElNode, text: string): void {
	const handler = buttonIn(container, text).clickHandlers[0];
	if (handler === undefined) {
		throw new Error(`按钮无点击处理器：${text}`);
	}
	handler();
}

/** 容器内按钮文案序列（按创建顺序） */
function buttonTexts(container: FakeElNode): string[] {
	return buttonRecords
		.filter((record) => record.container === container)
		.map((record) => record.texts.join(''));
}

/** 触发伪元素的 keydown 监听，返回 preventDefault 调用次数供断言 */
function pressKey(
	el: FakeElNode,
	key: string,
): { readonly key: string; readonly preventDefaultCount: number } {
	const record = { key, preventDefaultCount: 0 };
	const event: FakeKeyEvent = {
		key,
		preventDefault: (): void => {
			record.preventDefaultCount += 1;
		},
	};
	for (const listener of el.keydownListeners) {
		listener(event);
	}
	return record;
}

/** 触发伪元素的 input 监听（空白名称禁用确认按钮用） */
function fireInput(el: FakeElNode): void {
	for (const listener of el.inputListeners) {
		listener({ type: 'input' });
	}
}

/** 伪鼠标事件（selectSuggestion 只用第一个参数，此处仅满足签名） */
function fakeMouseEvent(): MouseEvent {
	return { type: 'click' } as unknown as MouseEvent;
}

/** 伪元素 → HTMLElement（renderSuggestion 的入参形态） */
function asHTMLElement(el: FakeElNode): HTMLElement {
	return el as unknown as HTMLElement;
}

/** 取非 null 结果（null 直接抛错，避免可选链静默通过） */
function requireResult<T>(value: T | null): T {
	if (value === null) {
		throw new Error('弹窗结果意外为 null');
	}
	return value;
}

interface NameHarness {
	readonly promise: Promise<string | null>;
	readonly modal: ModalStub;
	readonly root: FakeElNode;
	readonly hint: FakeElNode;
	readonly input: FakeElNode;
	readonly buttons: FakeElNode;
}

/** 打开名称弹窗并取回 Promise / 伪元素（结构：root → [hint, input, buttons]） */
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

interface LinkHarness {
	readonly promise: Promise<LinkPickResult | null>;
	readonly modal: ModalStub;
	readonly root: FakeElNode;
	readonly input: FakeElNode;
	readonly buttons: FakeElNode;
	readonly suggest: SuggestHandle;
}

/** 打开链接弹窗并取回 Promise / 伪元素 / 联想实例（结构：root → [input, buttons]） */
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

beforeEach(() => {
	modalStubs.length = 0;
	buttonRecords.length = 0;
	suggestRecords.length = 0;
	setIconMock.mockClear();
});

describe('openNameInputModal（新建名称输入弹窗）', () => {
	it('未点按钮关闭（onClose 兜底）与输入框 Esc 都 resolve(null)', async () => {
		// 路径一：点遮罩 / 外部关闭 → onClose 兜底 settle(null)，不主动 close
		const backdrop = openName();
		expect(backdrop.modal.openCalls).toBe(1);
		expect(backdrop.input.value).toBe('思维导图2026-08-21');
		backdrop.modal.fireClose();
		await expect(backdrop.promise).resolves.toBeNull();
		expect(backdrop.modal.closeCalls).toBe(0);

		// 路径二：输入框 Esc → settle(null) 并主动 close（close 同步触发 onClose 兜底）
		const esc = openName();
		expect(pressKey(esc.input, 'Escape').preventDefaultCount).toBe(0);
		expect(esc.modal.closeCalls).toBe(1);
		await expect(esc.promise).resolves.toBeNull();
	});

	it('确认按钮 → 去掉首尾空白后的名称（primary 走 setCta）', async () => {
		const harness = openName();
		harness.input.value = '  项目计划  ';

		expect(buttonIn(harness.buttons, t('zh', 'modal.create')).ctaCalls).toBe(1);
		clickButton(harness.buttons, t('zh', 'modal.create'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBe('项目计划');
	});

	it('取消按钮 → resolve(null)，输入内容被丢弃', async () => {
		const harness = openName();
		harness.input.value = '不会被采用';

		clickButton(harness.buttons, t('zh', 'modal.cancel'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBeNull();
	});

	it('确认时输入为空/纯空白 → 不 settle（重新聚焦），关闭后才兜底 null', async () => {
		for (const raw of ['', '   ', '\t\n ']) {
			const harness = openName();
			harness.input.value = raw;
			clickButton(harness.buttons, t('zh', 'modal.create'));

			// 空白被拒：弹窗不关闭、Promise 未 settle，输入框重新获得焦点
			expect(harness.modal.closeCalls).toBe(0);
			expect(harness.input.focusCount).toBe(2); // 创建时 1 次 + 拒绝时 1 次

			harness.modal.fireClose();
			// 若空白确认曾 settle('')，settle 首值优先会让此处得到 '' 而非 null
			await expect(harness.promise).resolves.toBeNull();
		}
	});

	it('空白名称禁用确认按钮（避免「点击无反应」的死按钮），输入后即时恢复', () => {
		const harness = openName('思维导图2026-08-21');
		const confirm = buttonIn(harness.buttons, t('zh', 'modal.create'));
		// 创建时预填非空 → 未禁用
		expect(confirm.disabledStates).toEqual([false]);

		// 清空输入 → 禁用
		harness.input.value = '';
		fireInput(harness.input);
		expect(confirm.disabledStates).toEqual([false, true]);

		// 纯空白同样禁用
		harness.input.value = '   ';
		fireInput(harness.input);
		expect(confirm.disabledStates.at(-1)).toBe(true);

		// 重新输入 → 恢复可点
		harness.input.value = '新名称';
		fireInput(harness.input);
		expect(confirm.disabledStates.at(-1)).toBe(false);

		// 取消按钮不参与禁用（仅确认按钮随输入联动）
		expect(buttonIn(harness.buttons, t('zh', 'modal.cancel')).disabledStates).toEqual(
			[],
		);
	});

	it('空白确认时确认按钮处于禁用态（UI 上点不到，Enter 由 confirm 守卫兜住）', () => {
		const harness = openName();
		harness.input.value = '   ';
		fireInput(harness.input);
		const confirm = buttonIn(harness.buttons, t('zh', 'modal.create'));
		expect(confirm.disabledStates.at(-1)).toBe(true);

		// Enter 路径仍会走到 confirm：只重新聚焦、不 settle、不关闭
		expect(pressKey(harness.input, 'Enter').preventDefaultCount).toBe(1);
		expect(harness.modal.closeCalls).toBe(0);
		expect(harness.input.focusCount).toBe(2);
	});

	it('defaultName 预填 + focus/select；标题与文件夹提示用传入语言的文案', () => {
		const harness = openName('思维导图2026-08-21', '笔记/子目录');

		expect(harness.modal.titleEl.text).toBe(t('zh', 'command.createMindMap'));
		expect(harness.hint.text).toBe(`${t('zh', 'modal.name.folder')}笔记/子目录`);
		expect(harness.hint.classes).toEqual(['mindmap-modal-muted-hint']);
		expect(harness.root.classes).toEqual(['mindmap-name-editor']);
		expect(harness.buttons.classes).toEqual([
			'mindmap-modal-action-row',
			'mindmap-modal-action-row--mt',
		]);
		expect(buttonTexts(harness.buttons)).toEqual([
			t('zh', 'modal.cancel'),
			t('zh', 'modal.create'),
		]);

		expect(harness.input.tag).toBe('input');
		expect(harness.input.classes).toEqual(['mindmap-modal-input']);
		expect(harness.input.attrs).toEqual({
			type: 'text',
			value: '思维导图2026-08-21',
			spellcheck: 'false',
		});
		expect(harness.input.value).toBe('思维导图2026-08-21');
		expect(harness.input.focusCount).toBe(1);
		expect(harness.input.selectCount).toBe(1);
		expect(harness.modal.openCalls).toBe(1);

		// 文件夹为空时提示回退 '/'
		const fallback = openName('默认名', '');
		expect(fallback.hint.text).toBe(`${t('zh', 'modal.name.folder')}/`);

		// lang 贯穿到文案：英文界面取 EN 字典
		const english = openName('MindMap 2026-08-21', 'Notes', 'en');
		expect(english.modal.titleEl.text).toBe(t('en', 'command.createMindMap'));
		expect(english.hint.text).toBe(`${t('en', 'modal.name.folder')}Notes`);
	});

	it('确认幂等：二次点击不再改变结果（settle 首值优先），onClose 也不覆盖', async () => {
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

describe('openLinkEditorModal（节点链接编辑弹窗）', () => {
	it('取消按钮 → resolve(null)', async () => {
		const harness = openLink('[[已有笔记]]');

		clickButton(harness.buttons, t('zh', 'modal.cancel'));

		expect(harness.modal.closeCalls).toBe(1);
		await expect(harness.promise).resolves.toBeNull();
	});

	it('普通链接 → { link }（保持裸文本、无 label）；确认后 onClose 不覆盖', async () => {
		const harness = openLink('');
		harness.input.value = '  https://example.com/a?b=1  ';

		expect(buttonIn(harness.buttons, t('zh', 'modal.apply')).ctaCalls).toBe(1);
		clickButton(harness.buttons, t('zh', 'modal.apply'));
		harness.modal.fireClose(); // 兜底不得覆盖已 settle 的结果

		const result = requireResult(await harness.promise);
		expect(result).toEqual({ link: 'https://example.com/a?b=1' });
		// URL 输入不产生 label（modal-link 只在联想选择时给出 label）
		expect('label' in result).toBe(false);
		expect(harness.modal.closeCalls).toBe(1);
	});

	it('别名语法 [[笔记|别名]] → 解析出 label（与联想选择同契约）', async () => {
		const harness = openLink('');
		harness.input.value = '[[笔记|别名]]';

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		// link 原样透传（由序列化统一决定包裹），label = 别名 → 节点文本同步为别名
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

	it('附件别名 [[路径/报告.pdf|说明]] → label = 说明', async () => {
		const harness = openLink('');
		harness.input.value = '[[附件/报告.pdf|说明]]';

		clickButton(harness.buttons, t('zh', 'modal.apply'));

		expect(requireResult(await harness.promise)).toEqual({
			link: '[[附件/报告.pdf|说明]]',
			label: '说明',
		});
	});

	it('current 预填到输入框并 focus；标题/占位符/按钮文案用 i18n', () => {
		const harness = openLink('[[已有笔记]]');

		expect(harness.modal.titleEl.text).toBe(t('zh', 'modal.link.title'));
		expect(harness.root.classes).toEqual(['mindmap-link-editor']);
		expect(harness.buttons.classes).toEqual([
			'mindmap-modal-action-row',
			'mindmap-modal-action-row--mt',
		]);
		expect(buttonTexts(harness.buttons)).toEqual([
			t('zh', 'modal.link.clear'),
			t('zh', 'modal.cancel'),
			t('zh', 'modal.apply'),
		]);

		expect(harness.input.tag).toBe('input');
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
		expect(harness.modal.openCalls).toBe(1);
	});

	it('清除链接按钮（muted）→ { link: \'\' }（view-node-actions 的清空通道）', async () => {
		const harness = openLink('[[已有笔记]]');

		expect(buttonIn(harness.buttons, t('zh', 'modal.link.clear')).classes).toEqual([
			'is-muted',
		]);
		clickButton(harness.buttons, t('zh', 'modal.link.clear'));

		const result = requireResult(await harness.promise);
		expect(result).toEqual({ link: '' });
		expect('label' in result).toBe(false);
		expect(harness.modal.closeCalls).toBe(1);
	});

	it('输入为空/纯空白时确认或回车 → resolve(null)（与名称弹窗不同，不重新聚焦）', async () => {
		// 确认按钮路径：commitRaw 空值即取消
		const blank = openLink('');
		blank.input.value = '   ';
		clickButton(blank.buttons, t('zh', 'modal.apply'));
		expect(blank.modal.closeCalls).toBe(1);
		await expect(blank.promise).resolves.toBeNull();

		// 回车路径：联想浮层未打开时直接提交原始输入
		const empty = openLink('');
		expect(pressKey(empty.input, 'Enter').preventDefaultCount).toBe(1);
		expect(empty.modal.closeCalls).toBe(1);
		await expect(empty.promise).resolves.toBeNull();
	});

	it('联想接线：VaultFileSuggest 收到输入元素与「笔记在前、可链接附件在后」候选', () => {
		const noteA = fakeFile('笔记甲', 'md', '目录');
		const noteB = fakeFile('笔记乙', 'md', '目录');
		const audio = fakeFile('笔记录音', 'mp3', '附件');
		const pdfFile = fakeFile('扫描件', 'pdf', '附件');
		const pngFile = fakeFile('图片', 'png', '附件');
		const app = fakeApp({
			markdownFiles: [noteA, noteB],
			files: [noteA, noteB, audio, pdfFile, pngFile],
		});
		const harness = openLink('', app);

		// 基类 AbstractInputSuggest 收到 (app, 弹窗的输入元素) —— 联想挂在真实输入框上
		expect(suggestRecords).toHaveLength(1);
		expect(suggestRecords[0]?.app).toBe(app);
		expect(suggestRecords[0]?.inputEl).toBe(harness.input);

		// 候选 = md 笔记（库内原序）在前 + 可链接附件在后（png 不是可链接附件）
		expect(
			harness.suggest.getSuggestions('笔记').map((file) => file.basename),
		).toEqual(['笔记甲', '笔记乙', '笔记录音']);
		expect(
			harness.suggest.getSuggestions('扫描').map((file) => file.name),
		).toEqual(['扫描件.pdf']);
		expect(harness.suggest.getSuggestions('图片')).toEqual([]);

		// describe 回调：笔记用 file-text 图标 + basename；附件用 file 图标 + 完整文件名
		const noteEl = new FakeEl('div');
		harness.suggest.renderSuggestion(noteA, asHTMLElement(noteEl));
		expect(noteEl.children.map((child) => child.text)).toEqual([
			'',
			'笔记甲',
			'目录',
		]);
		expect(setIconMock).toHaveBeenLastCalledWith(childAt(noteEl, 0), 'file-text');

		const audioEl = new FakeEl('div');
		harness.suggest.renderSuggestion(audio, asHTMLElement(audioEl));
		expect(audioEl.children.map((child) => child.text)).toEqual([
			'',
			'笔记录音.mp3',
			'附件',
		]);
		expect(setIconMock).toHaveBeenLastCalledWith(childAt(audioEl, 0), 'file');
	});

	it('选择联想条目 → 唯一笔记 / 重名笔记 / 附件三种结果', async () => {
		// 唯一同名笔记：[[名称]] + label = 名称
		const uniqueApp = fakeApp({
			markdownFiles: [fakeFile('笔记甲', 'md', '目录')],
			files: [fakeFile('笔记甲', 'md', '目录')],
		});
		const unique = openLink('', uniqueApp);
		const uniqueFile = requireResult(
			unique.suggest.getSuggestions('笔记甲')[0] ?? null,
		);
		unique.suggest.selectSuggestion(uniqueFile, fakeMouseEvent());
		expect(await unique.promise).toEqual({ link: '[[笔记甲]]', label: '笔记甲' });
		expect(unique.modal.closeCalls).toBe(1);

		// 同名笔记（两处）：用库内路径消歧
		const dupFiles = [
			fakeFile('笔记甲', 'md', '目录A'),
			fakeFile('笔记甲', 'md', '目录B'),
		];
		const dup = openLink('', fakeApp({ markdownFiles: dupFiles, files: dupFiles }));
		const dupFile = requireResult(dup.suggest.getSuggestions('笔记甲')[1] ?? null);
		dup.suggest.selectSuggestion(dupFile, fakeMouseEvent());
		expect(await dup.promise).toEqual({
			link: '[[目录B/笔记甲.md|笔记甲]]',
			label: '笔记甲',
		});

		// 附件：完整库内路径链接，label 为含扩展名的文件名
		const audio = fakeFile('笔记录音', 'mp3', '附件');
		const attach = openLink('', fakeApp({ files: [audio] }));
		const audioFile = requireResult(
			attach.suggest.getSuggestions('录音')[0] ?? null,
		);
		attach.suggest.selectSuggestion(audioFile, fakeMouseEvent());
		expect(await attach.promise).toEqual({
			link: '[[附件/笔记录音.mp3]]',
			label: '笔记录音.mp3',
		});
		expect(attach.modal.closeCalls).toBe(1);
	});
});