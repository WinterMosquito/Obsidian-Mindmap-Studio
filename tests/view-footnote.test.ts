/**
 * 脚注交互的**悬停调度**回归（K197 附）。
 *
 * 2026-11-11 实机抓到三个「静默没反应」，全部落在这一个事件委托模块里，
 * 故用最小 DOM / 事件桩把它们钉死（纯逻辑直测；画布外观另由实机验收覆盖）：
 * ① 鼠标落在**外层 `<sup>`**（上标盒子的行高 / padding 区域）而不是内层 `<a>`
 *    时，`closest('[data-footnote-id]')` 恒落空 ⇒ 悬停和点击都失效；
 * ② **同一 id 的多枚徽标**间移动：旧实现用 `id === visibleId` 短路，
 *    `mouseout` 排的 hide 没被撤销 ⇒ 浮层消失且停在上一个坐标；
 * ③ 悬停 140ms 延迟窗口内发生 `node_tree_render_end`（单节点 reRender /
 *    分片渲染同样派发），旧实现无条件 `hide()` 清掉未决的 showTimer ⇒ 浮层不弹。
 *
 * 另锁两条伴生契约：移出又移回**同一枚**徽标要撤销未决的 hide；未定义引用悬停
 * 也要有可见反馈（不能只有点击才提示）。
 *
 * vendor bundle 不在 Node 下加载，故 `engine/mindmap` 整体 mock（与
 * engine-controller.test.ts 同款）；`obsidian` 由 vitest 全局 alias 到桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 直接取桩模块（vitest 把 'obsidian' 别名到同一文件）：只有它带 `instances`
import { Notice } from './mocks/obsidian';
import {
	FOOTNOTE_ID_ATTR,
	FOOTNOTE_IDS_ATTR,
	FOOTNOTE_REF_CLASS,
	FOOTNOTE_SUMMARY_CLASS,
} from '../src/features/node-inline-content';
import {
	collectFootnoteReferenceIds,
	setupFootnoteInteractions,
	type FootnoteInteractionDeps,
} from '../src/features/view-footnote';

const engine = vi.hoisted(() => ({
	collectRenderNodeData: vi.fn(),
	revealNodeByUid: vi.fn(() => true),
}));

vi.mock('../src/engine/mindmap', () => ({
	collectRenderNodeData: engine.collectRenderNodeData,
	revealNodeByUid: engine.revealNodeByUid,
}));

/** 最小元素桩：只实现本模块真正碰到的 DOM 面 */
class StubEl {
	className = '';
	style: Record<string, string> = {};
	children: unknown[] = [];
	attributes = new Map<string, string>();
	isConnected = true;
	offsetWidth = 120;
	offsetHeight = 40;
	rect = { left: 0, top: 100, right: 20, bottom: 112, width: 20, height: 12 };
	/** 本元素上注册的监听（测试手动派发） */
	readonly listeners = new Map<string, (event: unknown) => void>();
	readonly classes = new Set<string>();
	readonly classList = {
		add: (token: string): void => {
			this.classes.add(token);
		},
		remove: (token: string): void => {
			this.classes.delete(token);
		},
		contains: (token: string): boolean => this.classes.has(token),
	};
	private text = '';

	constructor(readonly tagName = 'div') {}

	addEventListener(type: string, handler: (event: unknown) => void): void {
		this.listeners.set(type, handler);
	}

	removeEventListener(): void {
		// 桩不维护多重监听；销毁路径不测
	}

	/** 测试派发：触发本元素上注册的某类监听（模拟用户操作） */
	fire(type: string, event: unknown = {}): void {
		this.listeners.get(type)?.(event);
	}

	get textContent(): string {
		return this.text;
	}

	set textContent(value: string) {
		this.text = value;
		// 真实 DOM 的 textContent='' 会清空子节点（`show()` 用它复用浮层）
		if (value === '') {
			this.children.length = 0;
		}
	}

	appendChild(child: unknown): unknown {
		this.children.push(child);
		return child;
	}

	createDiv(o?: { cls?: string }): StubEl {
		const el = new StubEl('div');
		if (o?.cls) {
			el.className = o.cls;
		}
		this.appendChild(el);
		return el;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	getBoundingClientRect(): typeof this.rect {
		return this.rect;
	}

	/** 默认按自己的 className 命中类选择器（浮层桩靠它被 `inPopover` 认出来） */
	closest(selector: string): StubEl | null {
		if (selector.startsWith('.') && this.className === selector.slice(1)) {
			return this;
		}
		return null;
	}

	querySelector(_selector: string): StubEl | null {
		return null;
	}

	querySelectorAll(_selector: string): StubEl[] {
		return [];
	}

	contains(other: unknown): boolean {
		return other === this;
	}

	/** 递归收集可见文本（含 createTextNode 桩） */
	collectText(): string {
		const childText = this.children
			.map((child) =>
				child instanceof StubEl
					? child.collectText()
					: ((child as { text?: string }).text ?? ''),
			)
			.join('');
		return this.text + childText;
	}
}

/** 一枚徽标：`sup.mindmap-node-footnote-ref > a[data-footnote-id]` */
function refStub(id: string, left: number): StubEl {
	const sup = new StubEl('sup');
	sup.className = FOOTNOTE_REF_CLASS;
	sup.rect = { left, top: 100, right: left + 20, bottom: 112, width: 20, height: 12 };
	const anchor = new StubEl('a');
	anchor.setAttribute(FOOTNOTE_ID_ATTR, id);
	sup.appendChild(anchor);
	sup.querySelector = (selector: string): StubEl | null =>
		selector === `[${FOOTNOTE_ID_ATTR}]` ? anchor : null;
	sup.closest = (selector: string): StubEl | null =>
		selector === `.${FOOTNOTE_REF_CLASS}` ? sup : null;
	anchor.closest = (selector: string): StubEl | null =>
		selector === `.${FOOTNOTE_REF_CLASS}` ? sup : null;
	sup.contains = (other: unknown): boolean => other === sup || other === anchor;
	return sup;
}

interface Harness {
	dom: Map<string, (event: unknown) => void>;
	renderEnd: () => void;
	popover: () => StubEl | undefined;
	/** 具名元组：两枚同 id 徽标（复现 A1）+ 一枚未定义（复现 C1） */
	refs: { one: [StubEl, StubEl]; missing: [StubEl] };
	/** 纯定义节点的汇总 chip（第 6 条） */
	summary: StubEl;
	openLink: ReturnType<typeof vi.fn>;
}

/** 汇总 chip 桩：`span.mindmap-node-footnote-summary[data-footnote-ids]` */
function summaryStub(ids: string[]): StubEl {
	const chip = new StubEl('span');
	chip.className = FOOTNOTE_SUMMARY_CLASS;
	chip.setAttribute(FOOTNOTE_IDS_ATTR, ids.join(','));
	chip.textContent = `脚注 ${ids.length}`;
	chip.closest = (selector: string): StubEl | null =>
		selector === `.${FOOTNOTE_SUMMARY_CLASS}` ? chip : null;
	chip.contains = (other: unknown): boolean => other === chip;
	return chip;
}

function harness(): Harness {
	const canvas = new StubEl('div') as StubEl & {
		win: unknown;
		ownerDocument: unknown;
	};
	canvas.rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
	// `window` 由 tests/setup.ts 桩到 globalThis；与插件运行时同一计时器源
	// （也满足 obsidianmd/prefer-window-timers）
	canvas.win = {
		setTimeout: (fn: () => void, ms: number): number => window.setTimeout(fn, ms),
		clearTimeout: (id: number): void => window.clearTimeout(id),
	};
	canvas.ownerDocument = {
		createElement: (tag = 'div'): StubEl => new StubEl(tag),
		createTextNode: (text: string): unknown => ({ text }),
	};
	const dom = new Map<string, (event: unknown) => void>();
	const engineEvents = new Map<string, (...args: unknown[]) => void>();
	const events = {
		onDom: (
			_target: unknown,
			type: string,
			handler: (event: unknown) => void,
		): void => {
			dom.set(type, handler);
		},
		onEngine: (
			_target: unknown,
			name: string,
			handler: (...args: unknown[]) => void,
		): void => {
			engineEvents.set(name, handler);
		},
	};
	engine.collectRenderNodeData.mockReturnValue([
		{
			uid: 'n1',
			text: '- 见[^1] 与 [^missing]\n[^1]: 定义正文',
			mdRaw: '- 见[^1] 与 [^missing]\n[^1]: 定义正文',
			mdDerivedText: '- 见[^1] 与 [^missing]\n[^1]: 定义正文',
		},
	]);
	engine.revealNodeByUid.mockReturnValue(true);
	const openLink = vi.fn();
	const deps: FootnoteInteractionDeps = {
		events: events as never,
		canvasEl: canvas as never,
		lang: 'zh',
		getMindMap: () => ({}) as never,
		openLink,
	};
	const refs: Harness['refs'] = {
		one: [refStub('1', 100), refStub('1', 500)],
		missing: [refStub('missing', 300)],
	};
	const summary = summaryStub(['1']);
	// 后置编号会 `canvasEl.querySelectorAll` 扫全部徽标：桩按选择器返回
	canvas.querySelectorAll = (selector: string): StubEl[] =>
		selector.includes(FOOTNOTE_REF_CLASS)
			? [...refs.one, ...refs.missing]
			: [];
	setupFootnoteInteractions(deps);
	return {
		dom,
		renderEnd: () => engineEvents.get('node_tree_render_end')?.(),
		popover: () =>
			canvas.children.find(
				(child): child is StubEl =>
					child instanceof StubEl &&
					child.className === 'mindmap-footnote-preview',
			),
		refs,
		summary,
		openLink,
	};
}

/** 造一个 capture 阶段能收到的事件对象 */
function event(target: StubEl, relatedTarget: StubEl | null = null): unknown {
	return {
		target,
		relatedTarget,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
}

function hover(h: Harness, target: StubEl): void {
	h.dom.get('mouseover')?.(event(target));
}

function leave(h: Harness, target: StubEl, related: StubEl | null = null): void {
	h.dom.get('mouseout')?.(event(target, related));
}

beforeEach(() => {
	vi.useFakeTimers();
	Notice.instances.length = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('collectFootnoteReferenceIds（轻标记 / 定义续行，2026-11-12 回归）', () => {
	it('**粗[^1]** 计入；定义行与续行里的 [^2] 不计入', () => {
		const data = [
			{
				text: '**粗体引用[^1]** 与 普通[^2]',
				mdRaw: '**粗体引用[^1]** 与 普通[^2]',
			},
			{
				// 续行**必须带缩进**（相对内容起始列，2026-11-12 实机口径）：
				// 同列的非空行在阅读视图里是另一段正文，里面的 `[^2]` 是真引用
				text: '定义区\n[^1]: 定义一\n  续行里有 [^2] 但不是引用\n[^2]: 定义二',
				mdRaw: '定义区\n[^1]: 定义一\n  续行里有 [^2] 但不是引用\n[^2]: 定义二',
			},
		];
		expect(collectFootnoteReferenceIds(data)).toEqual(['1', '2']);
	});
});

describe('脚注悬停调度（实机缺陷回归）', () => {
	it('① 目标是外层 sup 也能弹出浮层，且正文取自索引', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(200);
		expect(h.popover()?.style.display).toBe('block');
		expect(h.popover()?.collectText()).toContain('定义正文');
	});

	it('② 同一 id 的两枚徽标间移动：浮层不消失且重新定位到新坐标', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(200);
		const firstLeft = h.popover()?.style.left;
		leave(h, h.refs.one[0], h.refs.one[1]);
		hover(h, h.refs.one[1]);
		vi.advanceTimersByTime(300);
		expect(h.popover()?.style.display).toBe('block');
		expect(h.popover()?.style.left).not.toBe(firstLeft);
		expect(h.popover()?.style.left).toBe('500px');
	});

	it('③ 悬停延迟窗口内发生 node_tree_render_end：show 不被吞掉', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		h.renderEnd();
		vi.advanceTimersByTime(200);
		expect(h.popover()?.style.display).toBe('block');
	});

	it('移出又移回同一枚徽标：撤销未决的 hide（浮层留在屏上）', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(200);
		leave(h, h.refs.one[0]);
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(300);
		expect(h.popover()?.style.display).toBe('block');
	});

	it('未定义引用：悬停给可见提示，点击给一次 Notice', () => {
		const h = harness();
		hover(h, h.refs.missing[0]);
		vi.advanceTimersByTime(200);
		expect(h.popover()?.style.display).toBe('block');
		expect(h.popover()?.collectText()).toContain('未找到脚注定义');
		h.dom.get('click')?.(event(h.refs.missing[0]));
		expect(Notice.instances).toHaveLength(1);
		expect(Notice.instances[0]?.message).toContain('[^missing]');
	});

	it('点击落在 sup 上：仍然拦下并按 id 定位（无 Notice）', () => {
		const h = harness();
		h.dom.get('click')?.(event(h.refs.one[0]));
		expect(engine.revealNodeByUid).toHaveBeenCalledWith(expect.anything(), 'n1');
		expect(Notice.instances).toHaveLength(0);
	});

	it('编号后置：徽标显示编号，且不写 title（避免原生 tooltip）', () => {
		const h = harness();
		h.renderEnd();
		const anchor = h.refs.one[0].children[0] as StubEl;
		expect(anchor.textContent).toBe('1');
		expect(anchor.getAttribute('title')).toBeNull();
	});

	it('未定义引用后置：弱化 class + 截断 id（同样不写 title）', () => {
		const h = harness();
		h.renderEnd();
		const sup = h.refs.missing[0];
		expect(sup.classList.contains('is-unresolved')).toBe(true);
		const anchor = sup.children[0] as StubEl;
		expect(anchor.textContent).toBe('missing');
		expect(anchor.getAttribute('title')).toBeNull();
	});

	it('浮层内滚轮 / 按下不收起（能滚长文、能选字）', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(200);
		const popover = h.popover()!;
		h.dom.get('wheel')?.({ target: popover });
		expect(popover.style.display).toBe('block');
		h.dom.get('mousedown')?.({ target: popover });
		expect(popover.style.display).toBe('block');
		// 画布其它位置的滚轮照旧收起
		h.dom.get('wheel')?.({ target: null });
		expect(popover.style.display).toBe('none');
	});

	it('浮层内链接点击交给宿主 openLink（浮层不在节点里，node_click 收不到）', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(200);
		const popover = h.popover()!;
		const anchor = new StubEl('a');
		anchor.setAttribute('data-href', '笔记A');
		anchor.closest = (selector: string): StubEl | null =>
			selector === 'a' ? anchor : null;
		popover.fire('click', event(anchor));
		expect(h.openLink).toHaveBeenCalledWith('笔记A');
	});

	it('浮层标签用编号（与徽标一致），不再是 [^id]', () => {
		const h = harness();
		hover(h, h.refs.one[0]);
		vi.advanceTimersByTime(200);
		// 徽标显示 1 ⇒ 浮层顶上也是 1，后接定义正文
		expect(h.popover()?.collectText()).toBe('1定义正文');
	});

	it('汇总 chip：悬停与点击都展开该节点全部定义', () => {
		const h = harness();
		hover(h, h.summary);
		vi.advanceTimersByTime(200);
		expect(h.popover()?.style.display).toBe('block');
		expect(h.popover()?.collectText()).toContain('定义正文');
		// 点击立即展开（不依赖 140ms 延迟）
		h.dom.get('click')?.(event(h.summary));
		expect(h.popover()?.style.display).toBe('block');
	});
});
