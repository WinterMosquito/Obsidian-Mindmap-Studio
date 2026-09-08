/**
 * modal-common 回归测试：三件共享件的行为契约。
 * - createModalSettle：settle 幂等（先 settle 再 close 时关闭兜底为 no-op）、
 *   关闭兜底经官方 setCloseCallback 注册（Esc / 点遮罩关闭时 Promise 必然
 *   resolve，await 不挂起；不覆写调用方的 modal.onClose）；
 * - createButton：官方 ButtonComponent 封装（variant → CTA / .is-muted / 回调转发）；
 * - VaultFileSuggest：库内文件联想（空查询、大小写不敏感过滤、20 条上限、渲染、选择）。
 *
 * obsidian 模块被 vi.mock 替换为可断言的最小实现：仓库 mock（tests/mocks/obsidian.ts）
 * 里的 Modal / ButtonComponent / AbstractInputSuggest 只是可链接的空桩（方法无行为、
 * 不记录调用），故此处重定义——Modal 记录 setCloseCallback 并可经 fireClose 模拟
 * 关闭、ButtonComponent 记录 setButtonText/setCta/onClick 与 buttonEl 的加类、
 * AbstractInputSuggest 记录构造参数；setIcon 用 spy。
 * Node 环境无真实 DOM：元素用 FakeEl 记录创建出的子节点与类名。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, ButtonComponent, Modal, TFile, TFolder } from 'obsidian';
import type { FileSuggestAppearance } from '../src/modal-common';
import {
	createButton,
	createModalSettle,
	VaultFileSuggest,
} from '../src/modal-common';

/** createButton 记录（每次 new ButtonComponent 追加一条） */
interface ButtonRecord {
	texts: string[];
	ctaCalls: number;
	clickHandlers: (() => void)[];
	classes: string[];
}

const { setIconMock, buttonRecords, suggestRecords } = vi.hoisted(() => ({
	setIconMock: vi.fn<(parent: unknown, iconId: string) => void>(),
	buttonRecords: [] as ButtonRecord[],
	suggestRecords: [] as { app: unknown; inputEl: unknown }[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();

	class MockButtonComponent {
		readonly record: ButtonRecord;
		readonly buttonEl: { addClass: (cls: string) => void };

		constructor(_containerEl: unknown) {
			const record: ButtonRecord = {
				texts: [],
				ctaCalls: 0,
				clickHandlers: [],
				classes: [],
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
	}

	class MockModal {
		onClose: () => void = () => {};
		/** createModalSettle 经官方 setCloseCallback 注册的关闭回调 */
		private closeCallback: (() => unknown) | null = null;

		constructor(_app: unknown) {}

		open(): void {}

		setCloseCallback(callback: () => unknown): this {
			this.closeCallback = callback;
			return this;
		}

		/** 真实实现：close() 触发关闭回调，并调用 onClose */
		close(): void {
			this.closeCallback?.();
			this.onClose();
		}

		/** 模拟 Esc / 点遮罩：Obsidian 关闭弹窗（不经过本插件代码调用的 close） */
		fireClose(): void {
			this.closeCallback?.();
		}
	}

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

/** 最小伪元素：记录 createSpan 出来的子节点、类名与文本 */
interface FakeSpanOptions {
	cls?: string;
	text?: string;
}

class FakeEl {
	readonly tag: string;
	readonly children: FakeEl[] = [];
	readonly classes: string[] = [];
	text = '';

	constructor(tag: string) {
		this.tag = tag;
	}

	createSpan(options?: FakeSpanOptions): FakeEl {
		const child = new FakeEl('span');
		if (options?.cls !== undefined) {
			child.classes.push(options.cls);
		}
		if (options?.text !== undefined) {
			child.text = options.text;
		}
		this.children.push(child);
		return child;
	}

	addClass(cls: string): void {
		this.classes.push(cls);
	}

	/** 图标注入由 obsidian 的 setIcon 承担（此处仅保持接口形态） */
	setIcon(_iconId: string): void {}

	asHTMLElement(): HTMLElement {
		return this as unknown as HTMLElement;
	}
}

/** 取第 index 个子元素（noUncheckedIndexedAccess 下显式收窄） */
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

function fakeInputEl(): HTMLInputElement {
	return {} as HTMLInputElement;
}

function fakeContainer(): HTMLElement {
	return {} as HTMLElement;
}

/** 测试用 Modal 形态：MockModal 提供 fireClose 模拟 Esc / 点遮罩关闭 */
interface ModalStub extends Modal {
	fireClose(): void;
}

function fakeModal(): ModalStub {
	return new Modal(new App()) as ModalStub;
}

describe('createModalSettle（settle 幂等 + onClose 兜底）', () => {
	it('settle 一次即 resolve 该值；再次 settle 为 no-op（首值优先）', () => {
		const resolve = vi.fn<(value: string | null) => void>();
		const settle = createModalSettle<string>(fakeModal(), resolve);

		settle('第一个');
		settle('第二个');

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith('第一个');
	});

	it('未 settle 时关闭（Esc / 点遮罩）→ resolve(null)（await 不挂起）', () => {
		const modal = fakeModal();
		const resolve = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(modal, resolve);

		expect(resolve).not.toHaveBeenCalled();
		modal.fireClose();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(null);
	});

	it('不覆写 modal.onClose：调用方已有的 onClose 仍被 close() 调用', () => {
		const modal = fakeModal();
		const onClose = vi.fn();
		modal.onClose = onClose;
		const resolve = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(modal, resolve);

		// 兜底经官方 setCloseCallback 注册：若仍覆写 onClose，下面的 onClose 永不会被调用
		modal.close();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith(null);
	});

	it('先 settle 再关闭：不重复 resolve，仍是首次值（顺序守卫）', () => {
		const modal = fakeModal();
		const resolve = vi.fn<(value: string | null) => void>();
		const settle = createModalSettle<string>(modal, resolve);

		settle('确认');
		modal.close();

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve).toHaveBeenCalledWith('确认');
	});

	it('settle(null) 与 settle(\'\') 区分：假值语义不被兜底吞掉', () => {
		const resolveNull = vi.fn<(value: string | null) => void>();
		createModalSettle<string>(fakeModal(), resolveNull)(null);
		expect(resolveNull).toHaveBeenCalledTimes(1);
		expect(resolveNull).toHaveBeenCalledWith(null);

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

	it('返回 ButtonComponent：写入按钮文本并转发 onClick', () => {
		const onClick = vi.fn();
		const button = createButton(fakeContainer(), '确定', 'primary', onClick);

		expect(button).toBeInstanceOf(ButtonComponent);
		expect(buttonRecords).toHaveLength(1);
		expect(buttonRecords[0]?.texts).toEqual(['确定']);
		expect(buttonRecords[0]?.clickHandlers).toHaveLength(1);
		expect(buttonRecords[0]?.clickHandlers[0]).toBe(onClick);
	});

	it("variant primary：调用 setCta()，不走 muted 分支", () => {
		createButton(fakeContainer(), '确定', 'primary', vi.fn());

		expect(buttonRecords[0]?.ctaCalls).toBe(1);
		expect(buttonRecords[0]?.classes).toEqual([]);
	});

	it('variant secondary：既无 setCta() 也不加 is-muted', () => {
		createButton(fakeContainer(), '取消', 'secondary', vi.fn());

		expect(buttonRecords[0]?.ctaCalls).toBe(0);
		expect(buttonRecords[0]?.classes).toEqual([]);
	});

	it('variant muted：buttonEl 加 is-muted 且不调 setCta()', () => {
		createButton(fakeContainer(), '删除', 'muted', vi.fn());

		expect(buttonRecords[0]?.classes).toEqual(['is-muted']);
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

	it('空查询与纯空白查询 → []（不返回全量候选）', () => {
		const app = new App();
		const inputEl = fakeInputEl();
		const suggest = new VaultFileSuggest(
			app,
			inputEl,
			[fakeFile('报告甲', '笔记')],
			describeFile,
			onChoose,
		);

		// 构造参数原样透传给 AbstractInputSuggest 基类（mock 记录，同源引用）
		expect(suggestRecords).toHaveLength(1);
		expect(suggestRecords[0]?.app).toBe(app);
		expect(suggestRecords[0]?.inputEl).toBe(inputEl);

		expect(suggest.getSuggestions('')).toEqual([]);
		expect(suggest.getSuggestions('   ')).toEqual([]);
		expect(suggest.getSuggestions('\t\n')).toEqual([]);
	});

	it('basename 大小写不敏感子串匹配，且保持候选顺序', () => {
		const suggest = makeSuggest([
			fakeFile('Report-One', '笔记'),
			fakeFile('其他', '笔记'),
			fakeFile('report-Two', '附件'),
			fakeFile('报告甲', '笔记'),
		]);

		expect(suggest.getSuggestions('REPORT').map((file) => file.basename)).toEqual([
			'Report-One',
			'report-Two',
		]);
		// 查询两端空白被裁剪后按子串匹配
		expect(suggest.getSuggestions(' 报告 ').map((file) => file.basename)).toEqual([
			'报告甲',
		]);
	});

	it('超过 20 条候选时截断为候选顺序的前 20 条', () => {
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
		expect(result).not.toContain(candidates[20]);
	});

	it('renderSuggestion：图标 span + 标签 span + 路径 span（用 describe 返回的图标/名）', () => {
		const file = fakeFile('照片', '附件/图片');
		describeFile.mockReturnValue({ icon: 'image', label: '照片.png' });
		const suggest = makeSuggest([file]);
		const el = new FakeEl('div');

		suggest.renderSuggestion(file, el.asHTMLElement());

		expect(describeFile).toHaveBeenCalledTimes(1);
		expect(describeFile).toHaveBeenCalledWith(file);
		expect(el.children).toHaveLength(3);

		const iconEl = childAt(el, 0);
		expect(iconEl.tag).toBe('span');
		expect(iconEl.classes).toEqual(['mindmap-link-suggest-icon']);
		expect(iconEl.text).toBe('');
		expect(setIconMock).toHaveBeenCalledTimes(1);
		expect(setIconMock).toHaveBeenCalledWith(iconEl, 'image');

		const labelEl = childAt(el, 1);
		expect(labelEl.tag).toBe('span');
		expect(labelEl.classes).toEqual([]);
		expect(labelEl.text).toBe('照片.png');

		const pathEl = childAt(el, 2);
		expect(pathEl.tag).toBe('span');
		expect(pathEl.text).toBe('附件/图片');
		expect(pathEl.classes).toEqual(['note-path', 'mindmap-link-suggest-path']);
	});

	it('selectSuggestion：以所选文件调用 onChoose（忽略事件参数）', () => {
		const file = fakeFile('笔记', '目录');
		const suggest = makeSuggest([file]);

		suggest.selectSuggestion(file, { type: 'click' } as unknown as MouseEvent);

		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose).toHaveBeenCalledWith(file);
		expect(describeFile).not.toHaveBeenCalled();
	});
});
