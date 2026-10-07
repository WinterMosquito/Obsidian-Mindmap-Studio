/**
 * 代码块 Prism 高亮（platform/prism-code）单元回归。
 *
 * 官方口径依据（Phase 1 调研）：Obsidian 帮助「Basic formatting syntax §Code blocks」
 * 明写阅读视图用 **Prism**、Source / Live Preview 不用⇒ 导图节点（阅读视图同级展示面）
 * 走 `loadPrism()` 是正路。本套件锁定这条通道的**契约与失败面**：
 * - 语法查找：`hasOwnProperty` 守卫（`constructor` / `toString` 这类原型链名字**不得**
 *   被当成语法）、语言为空直接跳过；
 * - 替换语义：token 元素入 holder + `CODE_RENDERED_CLASS` + `data-lang` + 定稿回调
 *   **恰好一次**；**失败一律保留字面**（占位即回退：loadPrism 拒绝 / 语法未登记 /
 *   tokenize 抛错 / 空产物四种情形都不渲染空白块）；
 * - token 树：嵌套 `content` 递归、别名类名拼接；
 * - 颜色内联：探测宿主 `.token.x` 计算色（导出 SVG 无 app.css，见文件头）；缓存命中
 *   不再探测；无 `getComputedStyle` 面时**不写色但不崩**；
 * - 产物缓存：命中返回**克隆**（不共享活节点）、FIFO 封顶；
 * - 主题切换（`refreshPrismTokenColors`）：两张缓存清空 + 屏上 token 就地改色。
 *
 * 隔离策略：`loadPrism` 为本文件可控假件；模块级状态（两张缓存 + 告警去重标记）
 * 经 `vi.resetModules()` + 动态 import 逐例重置。Node 环境无 DOM：本文件自建最小
 * document/element 桩，真实渲染装配由 verify:visual 的 codeblock 探针覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadPrismMock = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));

vi.mock('obsidian', () => ({
	loadPrism: loadPrismMock,
}));

/** 最小 element 桩（只需本模块用到的面） */
class FakeEl {
	tagName = '';
	className = '';
	textContent = '';
	readonly style: Record<string, string> = {};
	readonly children: unknown[] = [];
	readonly attributes = new Map<string, string>();
	readonly classTokens = new Set<string>();
	/** 父指针：仅支撑 remove() 的真实语义 */
	parent?: FakeEl;
	/** 生产链路读取的 ownerDocument 面（由 fakeHolder 注入；clone 刻意不带走） */
	ownerDocument?: unknown;
	/** 真实 DOM 语义：是否已挂载。颜色探测的**精确路径要求为 true**（见 probeTokenColor） */
	isConnected = false;
	readonly classList = {
		add: (token: string): void => {
			this.classTokens.add(token);
		},
		remove: (token: string): void => {
			this.classTokens.delete(token);
		},
		contains: (token: string): boolean => this.classTokens.has(token),
	};
	appendChild(child: unknown): unknown {
		this.children.push(child);
		if (child instanceof FakeEl) {
			child.parent = this;
		}
		return child;
	}
	replaceChildren(...nodes: unknown[]): void {
		this.children.length = 0;
		this.children.push(...nodes);
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
	/** 真实 DOM语义：从父节点摘除自身（颜色探针靠它不留脏节点） */
	remove(): void {
		const parent = this.parent;
		if (!parent) {
			return;
		}
		const index = parent.children.indexOf(this);
		if (index >= 0) {
			parent.children.splice(index, 1);
		}
		this.parent = undefined;
	}
	/** 深克隆（产物缓存命中的断言依赖「返回克隆而非同一实例」；浅克隆供颜色探针用） */
	cloneNode(deep = true): FakeEl {
		const copy = new FakeEl();
		copy.tagName = this.tagName;
		copy.className = this.className;
		Object.assign(copy.style, this.style);
		copy.attributes.set('style', this.attributes.get('style') ?? '');
		if (deep) {
			copy.children.push(...this.children.map((child) => deepClone(child)));
		}
		return copy;
	}
}

function deepClone(node: unknown): unknown {
	return node instanceof FakeEl ? node.cloneNode(true) : node;
}

/**
 * 最小 document 桩：**body 元素本身**兼作 document（测试按 `doc.body` 取挂载宿主、
 * 按 `doc.defaultView` 取样式面，故把两者挂在同一个对象上）。
 */
interface FakeDocument extends FakeEl {
	body: FakeEl;
	createElement: (tag?: string) => FakeEl;
	createTextNode: (text: string) => unknown;
	defaultView: {
		getComputedStyle: (el: FakeEl) => { color: string };
		/** popout 场景：全局无 Prism、属主窗口有 */
		Prism?: unknown;
	};
}

/** 最小 document 桩：createElement / createTextNode / body / getComputedStyle */
function fakeDocument(getColor?: (className: string) => string): FakeDocument {
	const body = new FakeEl();
	const doc = {
		body,
		createElement: (tag = ''): FakeEl => {
			const el = new FakeEl();
			el.tagName = tag;
			return el;
		},
		createTextNode: (text: string): unknown => ({ text }),
		defaultView: {
			getComputedStyle: (el: FakeEl): { color: string } => ({
				color: getColor ? getColor(el.className) : '',
			}),
		},
	};
	return Object.assign(body, doc);
}

/** 造一个 holder（`<code>`）：带 ownerDocument + 构建期写入的字面文本子节点 */
function fakeHolder(getColor?: (className: string) => string): FakeEl {
	const holder = new FakeEl();
	holder.tagName = 'code';
	Object.assign(holder.style, { color: 'rgb(1, 2, 3)' });
	const doc = fakeDocument(getColor);
	Object.assign(holder, { ownerDocument: doc });
	// 生产链路由 node-inline-content 写入字面占位（占位即回退态），此处复刻
	holder.appendChild({ text: '' });
	return holder;
}

/**
 * **已挂载**的 holder：`body > pre.tmm-codeblock > code`（生产形态）。
 *
 * 颜色探测的**精确路径**要求父链已挂载（`isConnected`）——否则回落 body 且结果
 * 不进共享缓存。依赖缓存的用例必须用本helper。
 */
function mountedHolder(getColor?: (className: string) => string): FakeEl {
	const doc = fakeDocument(getColor);
	doc.body.isConnected = true;
	const parent = new FakeEl();
	parent.tagName = 'pre';
	parent.isConnected = true;
	Object.assign(parent, { ownerDocument: doc });
	const holder = new FakeEl();
	holder.tagName = 'code';
	holder.isConnected = true;
	Object.assign(holder, { ownerDocument: doc, parentElement: parent });
	holder.appendChild({ text: '' });
	parent.appendChild(holder);
	doc.body.appendChild(parent);
	return holder;
}

/** token 桩（Prism tokenize 产物形态） */
function token(type: string, content: unknown, alias?: string | string[]) {
	return { type, content, alias, length: 0 };
}

/** 逐例重置模块级状态（两张缓存 + 告警去重标记） */
async function freshModule() {
	vi.resetModules();
	return import('../src/platform/prism-code');
}

/**
 * 生产函数（holder 形参是 HTMLElement）→ 本文件的element 桩面。
 * Node 环境没有 DOM，跨这层只能断言一次（放在调用点会散成20 处 `as unknown as`）。
 */
function asRenderFn(fn: unknown): (
	code: string,
	lang: string,
	holder: FakeEl,
	onSettled?: (holder: FakeEl) => void,
) => void {
	return fn as (
		code: string,
		lang: string,
		holder: FakeEl,
		onSettled?: (holder: FakeEl) => void,
	) => void;
}

/** 挂 Prism 假件到 window（生产代码从 window.Prism 取面） */
function stubPrism(prism: unknown): void {
	(window as unknown as { Prism?: unknown }).Prism = prism;
}

/** 让fire-and-forget 的异步通道跑完（微任务 + 宏任务各让一轮） */
async function settle(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
	loadPrismMock.mockClear();
	loadPrismMock.mockResolvedValue(undefined);
	stubPrism(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('语法查找（hasOwnProperty 守卫）', () => {
	it('语言未登记：保留字面、不替换、不告警（用户可写任意语言码）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({
			languages: { js: {} },
			tokenize: vi.fn(() => ['never']),
		});
		const holder = fakeHolder();
		renderCodeWithPrism('x = 1', 'python', holder);
		await settle();
		// 未替换：仍是构建期写入的字面文本节点
		expect(holder.children).toEqual([{ text: '' }]);
		expect(holder.classTokens.has('tmm-code-hl')).toBe(false);
	});

	it('原型链上的名字（constructor）不算语法 —— 不被当语言查出对象', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const tokenize = vi.fn(() => ['never']);
		// `{}` 的原型链上确有 `constructor` / `toString`
		stubPrism({ languages: {}, tokenize });
		const holder = fakeHolder();
		renderCodeWithPrism('x', 'constructor', holder);
		await settle();
		expect(tokenize).not.toHaveBeenCalled();
		expect(holder.classTokens.has('tmm-code-hl')).toBe(false);
	});

	it('语言为空串：无语法可查，直接跳过（缩进式代码块 / 无信息行围栏）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const tokenize = vi.fn(() => ['never']);
		stubPrism({ languages: { js: {} }, tokenize });
		const holder = fakeHolder();
		renderCodeWithPrism('x = 1', '', holder);
		await settle();
		expect(tokenize).not.toHaveBeenCalled();
	});

	it('登记值不是对象（字符串/ null）：同样视为未登记', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const tokenize = vi.fn(() => ['never']);
		stubPrism({ languages: { js: 'not-a-grammar', py: null }, tokenize });
		const holder = fakeHolder();
		renderCodeWithPrism('x', 'js', holder);
		await settle();
		expect(tokenize).not.toHaveBeenCalled();
		expect(holder.classTokens.has('tmm-code-hl')).toBe(false);
	});
});

describe('替换语义与失败面', () => {
	it('高亮成功：token 元素入 holder + 已高亮类 + 定稿回调恰好一次', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('keyword', 'const'), ' '],
		});
		const holder = fakeHolder();
		const settled: unknown[] = [];
		renderCodeWithPrism('const a', 'js', holder, (h) => settled.push(h));
		await settle();
		expect(holder.children).toHaveLength(2);
		const span = holder.children[0] as FakeEl;
		expect(span.tagName).toBe('span');
		expect(span.className).toBe('token keyword');
		expect(holder.children[1]).toEqual({ text: ' ' });
		expect(holder.classTokens.has('tmm-code-hl')).toBe(true);
		expect(settled).toEqual([holder]);
	});

	it('嵌套 token：content 为数组时递归建子 span（不丢层级）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('function', [token('keyword', 'const'), ' a'])],
		});
		const holder = fakeHolder();
		renderCodeWithPrism('const a', 'js', holder);
		await settle();
		const outer = holder.children[0] as FakeEl;
		expect(outer.className).toBe('token function');
		const inner = outer.children[0] as FakeEl;
		expect(inner.className).toBe('token keyword');
		expect(outer.children[1]).toEqual({ text: ' a' });
	});

	it('别名：token 的 alias（串或数组）并入类名（宿主 .token.x 选择器口径）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({
			languages: { js: {} },
			tokenize: () => [
				token('keyword', 'const', 'reserved'),
				token('string', 's', ['a', 'b']),
				token('plain', 'p', 'single'),
			],
		});
		const holder = fakeHolder();
		renderCodeWithPrism('x', 'js', holder);
		await settle();
		const classes = holder.children.map((child) => (child as FakeEl).className);
		expect(classes).toEqual([
			'token keyword reserved',
			'token string a b',
			'token plain single',
		]);
	});

	it('tokenize 抛错 / loadPrism 拒绝 / 空产物：一律保留字面、不抛穿', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const holderThrow = fakeHolder();
		const holderReject = fakeHolder();
		const holderEmpty = fakeHolder();

		// ① tokenize 抛错
		stubPrism({
			languages: { js: {} },
			tokenize: () => {
				throw new Error('boom');
			},
		});
		renderCodeWithPrism('x', 'js', holderThrow);
		await settle();
		expect(holderThrow.classTokens.has('tmm-code-hl')).toBe(false);

		// ② loadPrism 拒绝
		loadPrismMock.mockRejectedValueOnce(new Error('offline'));
		stubPrism({ languages: { js: {} }, tokenize: () => ['never'] });
		renderCodeWithPrism('x', 'js', holderReject);
		await settle();
		expect(holderReject.classTokens.has('tmm-code-hl')).toBe(false);

		// ③ 空产物而代码非空 = 语法异常 → 不渲染空白块
		stubPrism({ languages: { js: {} }, tokenize: () => [] });
		renderCodeWithPrism('x', 'js', holderEmpty);
		await settle();
		expect(holderEmpty.classTokens.has('tmm-code-hl')).toBe(false);
		expect(holderEmpty.children).toEqual([{ text: '' }]);
	});

	it('失败告警跨节点只提醒一次（不刷屏）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubPrism({
			languages: { js: {} },
			tokenize: () => {
				throw new Error('boom');
			},
		});
		renderCodeWithPrism('x', 'js', fakeHolder());
		await settle();
		renderCodeWithPrism('y', 'js', fakeHolder());
		await settle();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain('代码块高亮失败');
	});
});

describe('token 颜色内联（导出 SVG 无 app.css，样式必须内联）', () => {
	it('探测宿主计算色并内联到每个 token；同类型第二次不再探测', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const probes: string[] = [];
		// 空类名 = 「未着色的继承色」基线；token 类名 = 主题给的真实色
		const getColor = (className: string): string => {
			probes.push(className);
			if (className.includes('keyword')) {
				return 'rgb(255, 0, 0)';
			}
			if (className.includes('string')) {
				return 'rgb(0, 0, 255)';
			}
			return 'rgb(10, 10, 10)';
		};
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('keyword', 'const'), ' ', token('string', 's')],
		});

		const first = mountedHolder(getColor);
		renderCodeWithPrism('const s', 'js', first);
		await settle();
		const kw = first.children[0] as FakeEl;
		const str = first.children[2] as FakeEl;
		expect(kw.style.color).toBe('rgb(255, 0, 0)');
		expect(str.style.color).toBe('rgb(0, 0, 255)');
		expect(probes.length).toBeGreaterThanOrEqual(4);

		// 缓存命中：不再探测（主题未变时零成本）
		const probesBefore = probes.length;
		const second = mountedHolder(getColor);
		renderCodeWithPrism('const s', 'js', second);
		await settle();
		expect((second.children[0] as FakeEl).style.color).toBe('rgb(255, 0, 0)');
		expect(probes).toHaveLength(probesBefore);
	});

	it('主题未给该token 类型定义颜色（探测值= 继承色）→ **不内联**', async () => {
		// 否则会把继承色冻进内联 style：屏上看着对，但换主题后不再跟随
		// （阅读视图会跟随），且导出图把该色固化了
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('prolog', 'x')],
		});
		const holder = mountedHolder(() => 'rgb(10, 10, 10)');
		renderCodeWithPrism('x', 'js', holder);
		await settle();
		const span = holder.children[0] as FakeEl;
		expect(span.className).toBe('token prolog');
		expect(span.style.color).toBeUndefined();
	});

	it('无 getComputedStyle 面（极端环境 / 测试桩）：不写色、但不崩', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({ languages: { js: {} }, tokenize: () => [token('keyword', 'const')] });
		// getColor 缺省 → 探针返回空串（等价于「探测不到颜色」）
		const holder = fakeHolder();
		renderCodeWithPrism('const', 'js', holder);
		await settle();
		const kw = holder.children[0] as FakeEl;
		expect(kw.style.color).toBeUndefined();
		expect(kw.className).toBe('token keyword');
	});

	it('探针挂在 holder 的**父节点**（同一继承链），而非 document.body', async () => {
		// 审查修复（Major）：基线色必须取自 holder 的真实继承链（.tmm-codeblock 的
		// 内联 color → --code-normal）。挂 body 会让基线变成 --text-normal，在
		// 「--code-normal ≠ --text-normal 且该token 类型未被主题着色」的主题上
		// 两次读数不等 → 把正文色误内联。
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		const doc = fakeDocument(() => 'rgb(1, 1, 1)');
		// 生产形态：pre.tmm-codeblock > code（holder），holder 有父节点
		const parent = new FakeEl();
		parent.tagName = 'pre';
		// 已挂载：颜色探测的精确路径要求 isConnected（否则回落 body）
		parent.isConnected = true;
		Object.assign(parent, { ownerDocument: doc });
		const holder = new FakeEl();
		holder.tagName = 'code';
		holder.isConnected = true;
		Object.assign(holder, { ownerDocument: doc, parentElement: parent });
		holder.appendChild({ text: '' });
		parent.appendChild(holder);

		const parentCalls: unknown[] = [];
		const bodyCalls: unknown[] = [];
		const origParent = parent.appendChild.bind(parent);
		parent.appendChild = ((child: unknown) => {
			parentCalls.push(child);
			return origParent(child);
		});
		const origBody = doc.body.appendChild.bind(doc.body);
		doc.body.appendChild = ((child: unknown) => {
			bodyCalls.push(child);
			return origBody(child);
		});

		stubPrism({ languages: { js: {} }, tokenize: () => [token('keyword', 'const')] });
		renderCodeWithPrism('const', 'js', holder);
		await settle();

		// 探针进了 holder 的父节点（继承链同源），**没有**落到 body
		expect(parentCalls.length).toBeGreaterThan(0);
		expect(bodyCalls).toHaveLength(0);
		// 且读色后已摘除，父节点只剩 holder
		expect(parent.children).toEqual([holder]);
	});

	it('离屏未挂载副本：回落 document.body 探测，且结果**不进共享缓存**', async () => {
		// 实机回归（2026-10-07）：引擎**预测量**路径先在离屏容器里构建并高亮，
		// 那份 DOM 尚未 isConnected ⇒ 挂进父节点仍读不到计算色（一度让内联色
		// 从 14/14 掉到 0/14）。此时回落 body 读到色，但**低置信**、不写缓存，
		// 免得近似色污染挂载路径的精确读数。
		const { renderCodeWithPrism: rawRender, prismCodeCacheStats } =
			await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('keyword', 'const')],
		});
		const holder = fakeHolder((cn) =>
			cn.includes('keyword') ? 'rgb(1, 1, 1)' : 'rgb(9, 9, 9)'
		);
		expect(holder.isConnected, '本用例前提：holder 未挂载').toBe(false);
		renderCodeWithPrism('const', 'js', holder);
		await settle();
		// 仍然拿到了颜色（回落 body 生效）
		expect((holder.children[0] as FakeEl).style.color).toBe('rgb(1, 1, 1)');
		// 但缓存保持为空（低置信不共享）
		expect(prismCodeCacheStats().tokenColors).toBe(0);
	});

	it('负缓存：未着色类型只探一次（后续命中缓存，不再触发样式计算）', async () => {
		const { renderCodeWithPrism: rawRender, prismCodeCacheStats } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		let probes = 0;
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('prolog', 'x')],
		});
		// getComputedStyle 每次被调用即计数：颜色恒等于基线 ⇒ 主题未着色
		const holderFor = (): FakeEl => {
			const doc = fakeDocument(() => {
				probes += 1;
				return 'rgb(9, 9, 9)';
			});
			const el = mountedHolder(() => {
				probes += 1;
				return 'rgb(9, 9, 9)';
			});
			Object.assign(el, { ownerDocument: doc });
			el.appendChild({ text: '' });
			return el;
		};
		renderCodeWithPrism('x', 'js', holderFor());
		await settle();
		const afterFirst = probes;
		expect(afterFirst).toBeGreaterThan(0);
		expect(prismCodeCacheStats().tokenColors).toBe(1);

		renderCodeWithPrism('x', 'js', holderFor());
		await settle();
		// 第二次同类型：颜色已缓存（含 null 负缓存）→ 零探测
		expect(probes).toBe(afterFirst);
	});

	it('popout：Prism 只在**holder 属主窗口**时也能取到（不绑死全局 window）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		// 全局无 Prism（模拟副窗口），但 holder 属主窗口有
		stubPrism(undefined);
		const holder = fakeHolder();
		const ownerWindow = (holder.ownerDocument as FakeDocument).defaultView;
		ownerWindow.Prism = {
			languages: { js: {} },
			tokenize: () => [token('keyword', 'const')],
		};
		renderCodeWithPrism('const', 'js', holder);
		await settle();
		expect(holder.classTokens.has('tmm-code-hl')).toBe(true);
	});

	it('探针挂载后被移除（不留脏节点进文档）', async () => {
		const { renderCodeWithPrism: rawRender } = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({ languages: { js: {} }, tokenize: () => [token('keyword', 'const')] });
		const holder = fakeHolder(() => 'rgb(1, 2, 3)');
		const body = (holder.ownerDocument as { body: FakeEl }).body;
		renderCodeWithPrism('const', 'js', holder);
		await settle();
		// 探针 = holder的浅克隆，挂文档读色后整体 remove；body 上不应留下节点
		expect(body.children).toHaveLength(0);
	});
});

describe('产物缓存（尺寸同步的同步命中路径）', () => {
	it('命中返回**克隆**（不共享活节点）+ 语言参与键', async () => {
		const {
			renderCodeWithPrism: rawRender,
			getRenderedCodeNodes,
		} = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({ languages: { js: {} }, tokenize: () => [token('keyword', 'const')] });
		renderCodeWithPrism('const', 'js', fakeHolder());
		await settle();

		const hit = getRenderedCodeNodes('const', 'js');
		expect(hit).not.toBeNull();
		expect(hit).toHaveLength(1);
		expect((hit as unknown as FakeEl[])[0]?.className).toBe('token keyword');

		// 再次命中返回的是新克隆（改克隆不影响缓存模板）
		const again = getRenderedCodeNodes('const', 'js');
		expect(again![0]).not.toBe(hit![0]);

		// 语言不同 → 不同条目（未命中）
		expect(getRenderedCodeNodes('const', 'ts')).toBeNull();
	});

	it('FIFO 封顶：超上限的写入淘汰最旧条目且不超过 max', async () => {
		const {
			renderCodeWithPrism: rawRender,
			getRenderedCodeNodes,
			prismCodeCacheStats,
		} = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		stubPrism({ languages: { js: {} }, tokenize: (code: string) => [token('keyword', code)] });
		const max = prismCodeCacheStats().productMax;
		for (let i = 0; i < max + 5; i += 1) {
			renderCodeWithPrism(`code-${i}`, 'js', fakeHolder());
			// 逐条串行，避免同tick 内并发写入顺序不确定
			await settle();
		}
		const stats = prismCodeCacheStats();
		expect(stats.products).toBeLessThanOrEqual(max);
		expect(stats.products).toBe(max);
		expect(getRenderedCodeNodes('code-0', 'js')).toBeNull();
		expect(getRenderedCodeNodes(`code-${max + 4}`, 'js')).not.toBeNull();
	});
});

describe('主题切换（refreshPrismTokenColors）', () => {
	it('清空两张缓存 + 就地改写屏上 token 的内联色（不重建节点）', async () => {
		const {
			renderCodeWithPrism: rawRender,
			refreshPrismTokenColors,
			prismCodeCacheStats,
		} = await freshModule();
		const renderCodeWithPrism = asRenderFn(rawRender);
		let keywordColor = 'rgb(1, 1, 1)';
		const getColor = (className: string): string =>
			className.includes('keyword') ? keywordColor : 'rgb(10, 10, 10)';
		stubPrism({
			languages: { js: {} },
			tokenize: () => [token('keyword', 'const')],
		});
		const holder = mountedHolder(getColor);
		renderCodeWithPrism('const', 'js', holder);
		await settle();
		const kw = holder.children[0] as FakeEl;
		expect(kw.style.color).toBe('rgb(1, 1, 1)');
		expect(prismCodeCacheStats().products).toBe(1);
		expect(prismCodeCacheStats().tokenColors).toBeGreaterThan(0);

		// 换主题：探针面换成新调色板，并返回「屏上 holder 列表」
		keywordColor = 'rgb(9, 9, 9)';
		refreshPrismTokenColors({
			querySelectorAll: (selector: string) =>
				selector === '.tmm-code-hl' ? [holder] : [],
		} as unknown as ParentNode);

		expect((holder.children[0] as FakeEl).style.color).toBe('rgb(9, 9, 9)');
		// 产物缓存必须清空：否则重建命中的是**旧色克隆**，而就地改写此时已跑完、
		// 救不回来（颜色缓存则相反：就地改写会按新调色板重新探测并缓存，
		// 后续新建的块直接命中新色）
		expect(prismCodeCacheStats().products).toBe(0);
		expect(prismCodeCacheStats().tokenColors).toBeGreaterThan(0);
	});

	it('宿主查询面缺失 / 形态不符：安全 no-op（不清缓存也不抛）', async () => {
		const { refreshPrismTokenColors, prismCodeCacheStats } = await freshModule();
		expect(() =>
			refreshPrismTokenColors({
				querySelectorAll: () => {
					throw new Error('no such api');
				},
			} as unknown as ParentNode),
		).not.toThrow();
		expect(prismCodeCacheStats().products).toBe(0);
	});
});