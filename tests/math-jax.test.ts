/**
 * 行内数学渲染（platform/math-jax）单元回归。
 *
 * 背景（2026-09-27 实机取证 + S0.5 双环境实测）：Obsidian 1.13.7 经 loadMathJax
 * 注入的 MathJax 3.2.2 是 CHTML 组件——只有 `tex2chtml`、**没有 `tex2svg`**；
 * 且逐字符规则只在样式表 **flush** 时写入：未 flush 的产物「非零但塌缩」
 * （`mjx-c` 全 0 宽），「容器宽高 > 0」无法识别（实测 14×20 vs 130×20）。
 * 本套件锁定：
 * - 通道优先级（`tex2chtml` → `tex2svg`）与替换语义（内容替换 + 类名）；
 * - **就绪判据**（2026-10-15 v4 修正）：**本段字符的逐字符规则已落盘 +
 *   （可见字符）宽度 > 0**。旧口径「全部 `mjx-c` 宽 > 0」在 v4 下恒假阳
 *   （字符改为真实文本节点，字体回退宽度非零 ⇒ 从不驱动 flush ⇒ 官方样式表
 *   永不落盘）；样式表元素**不存在** = 明确未 flush ⇒ 判未就绪 + 驱动 flush；
 *   索引不可用（异常宿主）才退回旧宽度判据。未就绪 → **同步撤回字面**
 *   （无中间态）+ 待定重试；预算耗尽保留字面并告警；无 `mjx-c` 退回
 *   「宽高皆 > 0」保守判定；
 * - **零宽豁免双形态**：MathJax ≤3.x 的空 `content` 规则／**MathJax 4.x 的
 *   零 `padding` 规则**（K113：v4 的 `addCharStyles` 只写 padding、不再写 content，
 *   `::before` 计算值为 `none`——只认空串会让含 U+2061/U+2062 的公式全量退字面）；
 *   规则缺失 / padding 非全零 → 仍判未就绪（塌缩态不放行）；
 * - **flush 生命周期**：按批合并调用官方 `finishRenderMath`，完成后放行重试；
 *   就绪路径不驱动 flush；
 * - 失败面：API 面全缺时**告警一次**（跨节点去重）、渲染抛错不上抛、
 *   holder 未连接不替换（挂载预算内等待）、loadMathJax 拒绝不致命；
 * - P4 面：塌缩产物不入缓存、定稿回调恰好一次（仅成功放置时）。
 *
 * 隔离策略：obsidian 的 loadMathJax / finishRenderMath 与 window.MathJax 均为
 * 本文件可控假件；模块级状态经 `vi.resetModules()` + 动态 import 逐例重置。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadMathJaxMock = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));
/** 官方样式表 flush（B′ 自驱生命周期）：断言合并调用次数与放行重试时机 */
const finishRenderMathMock = vi.hoisted(() =>
	vi.fn(async (): Promise<void> => {}),
);

/**
 * 字体预取走官方 `requestUrl`（math-jax → math-jax-export → math-jax-fonts）；
 * 只有「字体快照」那一例真的发请求，故默认 404、由该例改实现。
 */
const requestUrlMock = vi.hoisted(() =>
	vi.fn(
		async (
			_request: { url: string },
		): Promise<{ status: number; arrayBuffer: ArrayBuffer }> => ({
			status: 404,
			arrayBuffer: new ArrayBuffer(0),
		}),
	),
);

vi.mock('obsidian', () => ({
	loadMathJax: loadMathJaxMock,
	finishRenderMath: finishRenderMathMock,
	requestUrl: requestUrlMock,
}));

/**
 * 产物内 `mjx-c` 桩：就绪判据读取其宽度与**规则键**（v4 下缺一不可）。
 *
 * `textContent` 是 **MathJax 判据面**（v4 就绪判据与零宽豁免都按字符码查
 * 样式表规则；生产实现的键另含类名通道，桩以文本表达即可）；缺省即
 * 「无码点」→ 索引可用时保守判未就绪。默认桩（样式表元素无 `sheet` →
 * 索引不可用）只走宽度，故既有只关心宽度的用例无需改动。
 */
interface FakeChar {
	getBoundingClientRect(): { width: number };
	textContent?: string;
}

function fakeChar(width: number, textContent?: string): FakeChar {
	return {
		getBoundingClientRect: () => ({ width }),
		...(textContent === undefined ? {} : { textContent }),
	};
}

/**
 * CHTML 样式表桩：按 CSSOM 规则文本提供逐字符规则（MathJax 4 判据读取面）。
 *
 * 传入**活数组**时可在测试中途 push，模拟「flush 后逐字符规则才落盘」。
 */
function stubChtmlStylesheet(rules: string[]): void {
	vi.stubGlobal('document', {
		getElementById: (id: string) =>
			id === 'MJX-CHTML-styles'
				? { id, sheet: { cssRules: rules.map((cssText) => ({ cssText })) } }
				: null,
		fonts: [],
	});
}

/** 最小 holder 桩：只实现替换、待定调度与就绪判定实际访问的面 */
interface FakeHolder {
	isConnected: boolean;
	textContent: string;
	classList: {
		added: string[];
		removed: string[];
		add(token: string): void;
		remove(token: string): void;
	};
	children: unknown[];
	replaceChildren(...nodes: unknown[]): void;
	/** 就绪判定读取的 `mjx-c` 列表：空数组 → 退回容器盒判定（兼容箱型用例） */
	querySelectorAll(selector: string): unknown[];
	/**
	 * 运行中改字符宽度：模拟「flush 后逐字符规则到位」。
	 *
	 * ⚠ 在 `stubChtmlStylesheet` 桩（索引可用）下做**清理放行**时必须同时给
	 * `texts`（规则键）：v4 判据的就绪条件是「宽度 > 0 + 规则键命中」，只改
	 * 宽度不会放行——段会继续烧 flush 重试预算并把耗尽告警泄漏到后续用例。
	 */
	setChars(widths: number[], texts?: (string | undefined)[]): void;
	/** 就绪判定回退路径读取：宽高**任一为 0** 视为不可见 */
	getBoundingClientRect(): { width: number; height: number };
	/** 运行中改尺寸：模拟「容器盒尺寸恢复/塌缩」 */
	setBox(width: number, height: number): void;
	/** 待定泵与 flush 调度的定时器来源（生产：holder 属主窗口） */
	ownerDocument: {
		defaultView: {
			setTimeout: (fn: () => void, ms: number) => unknown;
		};
	};
}

function fakeHolder(
	isConnected = true,
	boxWidth = 10,
	boxHeight = 10,
): FakeHolder {
	let box = { width: boxWidth, height: boxHeight };
	let text = '$x$';
	let chars: FakeChar[] = [];
	return {
		isConnected,
		get textContent(): string {
			return text;
		},
		// DOM 语义：写 textContent 会清空子节点（回退字面占位即依赖该语义）
		set textContent(value: string) {
			text = value;
			this.children = [];
		},
		classList: {
			added: [],
			removed: [],
			add(token: string): void {
				this.added.push(token);
			},
			remove(token: string): void {
				this.removed.push(token);
			},
		},
		children: [],
		replaceChildren(...nodes: unknown[]): void {
			this.children = nodes;
		},
		querySelectorAll(selector: string): unknown[] {
			return selector === 'mjx-c' ? chars : [];
		},
		setChars(widths: number[], texts?: (string | undefined)[]): void {
			chars = widths.map((w, i) => fakeChar(w, texts?.[i]));
		},
		getBoundingClientRect(): { width: number; height: number } {
			return { ...box };
		},
		setBox(width: number, height: number): void {
			box = { width, height };
		},
		ownerDocument: {
			defaultView: {
				setTimeout: (fn: () => void, ms: number) =>
					globalThis.setTimeout(fn, ms),
			},
		},
	};
}

/**
 * 渲染产物桩（代表 mjx-container）；cloneNode 支撑产物缓存复用（P4）。
 *
 * `style` 可选：块级公式的节点内边距收敛（`placeProduct`）会写 `style.margin`，
 * 传入对象即可断言写入结果（不传 = 无 `style`，生产侧有守卫、跳过）。
 */
function fakeRendered(name: string, style?: Record<string, string>): Node {
	const node: {
		nodeName: string;
		cloneNode: () => Node;
		style?: Record<string, string>;
	} = {
		nodeName: name,
		cloneNode: (): Node => fakeRendered(`${name}#clone`, style),
	};
	if (style) {
		node.style = style;
	}
	return node as unknown as Node;
}

/** 逐例重新加载模块：重置「告警去重」模块级状态 */
async function loadModule(): Promise<typeof import('../src/platform/math-jax')> {
	vi.resetModules();
	return await import('../src/platform/math-jax');
}

/**
 * 冲刷 fire-and-forget 的异步替换（await loadMathJax 之后的微任务链）。
 * 经 `globalThis.setTimeout` 取宏任务边界：Node 测试环境无 `window`
 * （popout 定时器规则的适用面是生产代码，见 obsidianmd/prefer-window-timers）。
 */
async function flush(): Promise<void> {
	await new Promise<void>((resolve) =>
		globalThis.setTimeout(() => resolve(), 0),
	);
}

/** 等待定时器链落定（flush 合并窗口 / 待定泵 / 重试预算轮次按需给足时间） */
async function wait(ms: number): Promise<void> {
	await new Promise<void>((resolve) =>
		globalThis.setTimeout(() => resolve(), ms),
	);
}

const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('renderMathWithMathJax（实机 API 面回归）', () => {
	beforeEach(() => {
		loadMathJaxMock.mockClear();
		finishRenderMathMock.mockClear();
		consoleWarnSpy.mockClear();
		// 默认：CHTML 样式表已注入（导出注入与调试查询需要；渲染就绪判定不依赖它）
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles' ? { id } : null,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('实机通道：MathJax 仅 tex2chtml 时替换成功（原故障面）；就绪路径不触发 flush', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		expect(loadMathJaxMock).toHaveBeenCalledTimes(1);
		expect(tex2chtml).toHaveBeenCalledWith('E=mc^2', { display: false });
		expect(holder.children).toHaveLength(1);
		expect(holder.classList.added).toContain('mindmap-inline-math');
		// 就绪（默认容器盒 ≥ 1）→ 直接定稿，无需驱动 flush
		expect(finishRenderMathMock).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('通道优先级：tex2chtml 与 tex2svg 并存时用 tex2chtml', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('CHTML'));
		const tex2svg = vi.fn(() => fakeRendered('SVG'));
		vi.stubGlobal('window', { MathJax: { tex2chtml, tex2svg } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(tex2chtml).toHaveBeenCalledTimes(1);
		expect(tex2svg).not.toHaveBeenCalled();
		expect(holder.children).toHaveLength(1);
	});

	it('display 透传：单行 `$$…$$` 以 { display: true } 调用（块级通道）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement, true);
		await flush();

		expect(tex2chtml).toHaveBeenCalledWith('E=mc^2', { display: true });
		expect(holder.children).toHaveLength(1);
	});

	it('块级公式：产物上下外边距收敛为 0.2em 0（节点内不额外撑高）；行内不写 margin', async () => {
		// 阅读视图的 `mjx-container[display]` 规则给 0.7em 上下外边距，节点内会把
		// 单公式节点撑高近一倍（实机 44px → 88px）；收敛在放置产物时写入，且必须
		// 内联（导出 SVG 不注入插件 styles.css）。
		const blockStyle: Record<string, string> = {};
		const inlineStyle: Record<string, string> = {};
		const tex2chtml = vi.fn((_tex: string, options?: { display?: boolean }) =>
			options?.display
				? fakeRendered('BLOCK', blockStyle)
				: fakeRendered('INLINE', inlineStyle),
		);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const blockHolder = fakeHolder();
		const inlineHolder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'a^2',
			blockHolder as unknown as HTMLElement,
			true,
		);
		renderMathWithMathJax(
			'b^2',
			inlineHolder as unknown as HTMLElement,
			false,
		);
		await flush();

		expect(blockStyle.margin).toBe('0.2em 0');
		expect(inlineStyle.margin).toBeUndefined();
	});

	it('兼容回退：仅 tex2svg 时仍可替换', async () => {
		const tex2svg = vi.fn(() => fakeRendered('SVG'));
		vi.stubGlobal('window', { MathJax: { tex2svg } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(tex2svg).toHaveBeenCalledWith('x', { display: false });
		expect(holder.children).toHaveLength(1);
	});

	it('返回 null 回退：tex2chtml 返回 null 时使用 tex2svg 产物', async () => {
		const tex2chtml = vi.fn(() => null);
		const tex2svg = vi.fn(() => fakeRendered('SVG'));
		vi.stubGlobal('window', { MathJax: { tex2chtml, tex2svg } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(1);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('API 面全缺：占位保留 + 告警仅一次（跨节点去重）', async () => {
		vi.stubGlobal('window', { MathJax: {} });
		const first = fakeHolder();
		const second = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('a', first as unknown as HTMLElement);
		renderMathWithMathJax('b', second as unknown as HTMLElement);
		await flush();

		expect(first.children).toHaveLength(0);
		expect(first.textContent).toBe('$x$');
		expect(second.children).toHaveLength(0);
		expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
	});

	it('渲染抛错：占位保留、异常不上抛（仅 catch 告警）', async () => {
		const tex2chtml = vi.fn(() => {
			throw new Error('bad tex');
		});
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		expect(() =>
			renderMathWithMathJax('\\bad', holder as unknown as HTMLElement),
		).not.toThrow();
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
	});

	it('holder 未挂载：暂不替换；挂载预算内保持字面（导出快照安全回退，不重渲染不误告警）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(false);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(tex2chtml).toHaveBeenCalledTimes(1);
		expect(holder.children).toHaveLength(0);
		expect(holder.classList.added).toHaveLength(0);
		// 挂载预算（PENDING_MAX_PUMPS × 16ms ≈ 3s）内保持字面占位，且产物不重复渲染
		await wait(80);
		expect(holder.children).toHaveLength(0);
		expect(tex2chtml).toHaveBeenCalledTimes(1);
		// 未挂载只等待、不驱动 flush（flush 由"规则未就绪"触发）
		expect(finishRenderMathMock).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();

		holder.isConnected = true; // 清理：放行待定段，避免轮询跨用例残留
		await wait(40);
	});

	it('挂载后补替换：构建时未挂载、随后挂载 → 泵重试命中（K85 第二层根因锁定）', async () => {
		// 引擎「首帧前预测量 + 元素复用」路径：构建发生在未挂载状态；
		// MathJax 热加载时 await 立即返回 → 若只替换一次就放弃，节点永久字面
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(false);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();
		expect(holder.children).toHaveLength(0);

		holder.isConnected = true; // 模拟首帧把复用元素挂进 foreignObject
		await wait(40); // 泵间隔 16ms：下一泵即命中

		expect(holder.children).toHaveLength(1);
		expect(holder.classList.added).toContain('mindmap-inline-math');
		expect(tex2chtml).toHaveBeenCalledTimes(1);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('loadMathJax 失败：占位保留、经 catch 告警（不上抛）', async () => {
		loadMathJaxMock.mockRejectedValueOnce(new Error('load failed'));
		vi.stubGlobal('window', { MathJax: { tex2chtml: vi.fn() } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
	});

	it('规则未就绪（mjx-c 全 0 宽）：同步撤回到可见字面（无中间态）+ 合并调度一次 flush', async () => {
		// 段内字符全 0 宽 = 逐字符规则尚未 flush（实测：未 flush 11/11 为 0）
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0, 0]);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		// 同步撤回：提交后即刻就是可见字面——浏览器不绘制任何中间态
		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$E=mc^2$');
		expect(holder.classList.removed).toContain('mindmap-inline-math');
		expect(consoleWarnSpy).not.toHaveBeenCalled(); // 预算未耗尽，不告警

		await wait(160); // flush 合并窗口 100ms → 触发一次（下一次在 ~216ms）
		expect(finishRenderMathMock).toHaveBeenCalledTimes(1);

		holder.setChars([5]); // 清理：放行待定段，避免定时器跨用例残留
		await wait(150);
	});

	it('MathJax 4 未 flush（样式表元素不存在）：宽 > 0 也判未就绪 + 驱动 flush（2026-10-15 实机缺陷回归）', async () => {
		// v4 把字符改为真实文本节点 ⇒ 字体回退下宽度恒非零：旧判据「全部 mjx-c
		// 宽 > 0」恒假阳 ⇒ 从不定稿前驱动 flush ⇒ 官方样式表永不落盘（实机：
		// 8/8 字符宽 6.19–7.42px，而 #MJX-CHTML-styles inDoc:false）。本用例锁定
		// 「元素不存在 = 明确未 flush ⇒ 撤字面 + 合并调度一次 flush」。
		vi.stubGlobal('document', { getElementById: () => null });
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([6.93, 7.42], ['\u{1D465}', '2']); // 回退字体下宽度亦非零
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x^2', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0); // 未就绪 → 同步撤回字面
		expect(holder.textContent).toBe('$x^2$');
		expect(consoleWarnSpy).not.toHaveBeenCalled(); // 预算未耗尽，不告警

		await wait(160); // flush 合并窗口 100ms
		expect(finishRenderMathMock).toHaveBeenCalledTimes(1); // 旧实现此处为 0

		// 清理：换「样式表已挂载 + 规则落盘」桩放行待定段（避免后续 flush 轮次残留）。
		// 等待窗口须覆盖下一轮 flush（100ms 合并）与泵：放行后不得再有耗尽告警。
		stubChtmlStylesheet([
			'mjx-c.mjx-c1D465 { padding: 0.6em 0.7em 0px 0px; }',
		]);
		holder.setChars([7.43], ['\u{1D465}']);
		await wait(550);
		expect(holder.children).toHaveLength(1); // 已放行定稿
		expect(consoleWarnSpy).not.toHaveBeenCalled(); // 预算未耗尽（无跨用例泄漏）
	});

	it('性能契约：可见字符（规则在 + 宽 > 0）不查 ::before 样式（getComputedStyle 零调用）', async () => {
		// 判定序 =「规则落盘（免布局）→ 宽度 → 仅零宽字符才做伪元素查询」：
		// rect 读取与样式查询是就绪判定里最贵的两项，恒为 0 次是本用例锁定的
		// 开销面（旧写法对每个字符先调 isInvisibleCharByDesign，可见字符也白付
		// 一次 getComputedStyle）。
		let computedCalls = 0;
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) => {
			computedCalls += 1;
			return pseudo === '::before' ? { content: 'none' } : {};
		});
		stubChtmlStylesheet([
			'mjx-c.mjx-c1D438 { padding: 0.68em 0.764em 0px 0px; }',
			'mjx-c.mjx-c1D465 { padding: 0.6em 0.7em 0px 0px; }',
		]);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([5, 6], ['\u{1D438}', '\u{1D465}']); // 两个可见字符
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('Ex', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(1); // 就绪（规则在 + 宽 > 0）
		expect(computedCalls).toBe(0); // 可见字符路径零样式查询
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('flush 后规则到位：自动换回产物并通知定稿（恰好一次）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]);
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'E=mc^2',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();
		expect(onSettled).not.toHaveBeenCalled(); // 未就绪不提前定稿
		expect(holder.children).toHaveLength(0);

		holder.setChars([5, 6]); // 模拟 flush 写入逐字符规则后字符宽度恢复
		await wait(250); // flush（100ms）+ 泵（16ms）

		expect(holder.children).toHaveLength(1);
		expect(holder.classList.added).toContain('mindmap-inline-math');
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('flush 合并：同批两段未就绪 → finishRenderMath 恰好一次', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const first = fakeHolder();
		const second = fakeHolder();
		first.setChars([0]);
		second.setChars([0]);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('a', first as unknown as HTMLElement);
		renderMathWithMathJax('b', second as unknown as HTMLElement);
		await flush();
		await wait(160);

		expect(finishRenderMathMock).toHaveBeenCalledTimes(1);

		first.setChars([5]); // 清理：放行两个待定段，避免定时器跨用例残留
		second.setChars([5]);
		await wait(150);
	});

	it('重试预算耗尽：保留可见字面 + 告警一次（不做重试风暴）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]); // 永远不就绪
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await wait(700); // 初试 + 3 轮 flush 重试后耗尽（≈430ms）

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$x$');
		expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
	});

	it('字体等待：替换前加载 MJX 字体（一次会话只一轮，非 MJX face 不动）', async () => {
		const mjxLoad = vi.fn(async () => undefined);
		const otherLoad = vi.fn(async () => undefined);
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles' ? { id } : null,
			fonts: [
				{ family: 'MJXTEX-I', load: mjxLoad },
				{ family: 'Inter', load: otherLoad },
			],
		});
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', fakeHolder() as unknown as HTMLElement);
		await flush();
		renderMathWithMathJax('y', fakeHolder() as unknown as HTMLElement);
		await flush();

		// memo：同一会话只等一轮字体
		expect(mjxLoad).toHaveBeenCalledTimes(1);
		expect(otherLoad).not.toHaveBeenCalled();
	});

	it('字体加载拒绝：不阻塞替换（失败由可见性自检兜底）', async () => {
		const mjxLoad = vi.fn(async () => {
			throw new Error('font failed');
		});
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles' ? { id } : null,
			fonts: [{ family: 'MJXTEX-I', load: mjxLoad }],
		});
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(mjxLoad).toHaveBeenCalledTimes(1);
		expect(holder.children).toHaveLength(1);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('容器盒判定（无 mjx-c）：宽度为 0 → 同步撤回到字面（提交即字面，无中间态）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(true, 0); // 无 mjx-c → 退回容器盒判定，宽为 0
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$E=mc^2$');
		expect(holder.classList.removed).toContain('mindmap-inline-math');

		holder.setBox(10, 10); // 清理：放行待定段，避免定时器跨用例残留
		await wait(150);
	});

	it('容器盒判定（无 mjx-c）：宽高皆 > 0 → 保持替换、不回退不告警', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(true, 42);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(1);
		expect(holder.classList.removed).toHaveLength(0);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('容器盒判定加严：宽度有值但高度为 0 → 同步撤回到字面（任一为 0 即不可见）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(true, 42, 0); // 宽 42 但高 0
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$x$');
		expect(holder.classList.removed).toContain('mindmap-inline-math');

		holder.setBox(42, 10); // 清理：放行待定段，避免定时器跨用例残留
		await wait(150);
	});

	it('不可见操作符（零宽 + ::before content 为空串）→ 视为就绪（U+2061 一族回归）', async () => {
		// MathJax 在 \sin 与参数间插入 U+2061 函数应用符：content 为 ""、宽度
		// 设计上恒为 0（无头 MathJax 3.2.2 取证）——旧判据永久误判 → 3 轮
		// flush 重试耗尽退字面（用户实机 `\sin x` 一族公式全部失败的根因）
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: '""' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([5, 0, 6]); // 中间一个零宽字符（模拟 \sin x 的 U+2061）
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'\\sin x',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();

		expect(holder.children).toHaveLength(1);
		expect(holder.classList.added).toContain('mindmap-inline-math');
		expect(onSettled).toHaveBeenCalledTimes(1);
		// 就绪路径不驱动 flush（与其他就绪用例同口径）
		expect(finishRenderMathMock).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('MathJax 4 形态：零宽字符规则 padding 全为 0 → 视为就绪（U+2061 一族，K113）', async () => {
		// K113 根因回归：MathJax 4 的 `addCharStyles` **只写 padding、不再写 content**
		// ⇒ `::before` 计算值为 `none`（旧判据恒 false）⇒ 含 U+2061/U+2062 的公式
		// 3 轮 flush 重试耗尽 → 全量退字面 `$…$`。
		stubChtmlStylesheet([
			'mjx-c.mjx-c1D438 { padding: 0.68em 0.764em 0px 0px; }',
			'mjx-c.mjx-c2061 { padding: 0px; }',
		]);
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: 'none' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([5, 0], ['\u{1D438}', '\u2061']); // 末位零宽 = \sin 的函数应用符
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'\\sin x',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();

		expect(holder.children).toHaveLength(1);
		expect(holder.classList.added).toContain('mindmap-inline-math');
		expect(onSettled).toHaveBeenCalledTimes(1);
		// 就绪路径不驱动 flush（与其他就绪用例同口径）
		expect(finishRenderMathMock).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('MathJax 4 形态：选择器带字体类后缀（mjx-cXXXX.TEX-N）同样识别', async () => {
		// MathJax `addCharStyles` 的选择器为 `"mjx-c"+charSelector+(o?"."+o:"")`，
		// 字体类后缀可能出现——不得因后缀而漏判
		stubChtmlStylesheet(['mjx-c.mjx-c2062.TEX-N { padding: 0px; }']);
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: 'none' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0], ['\u2062']); // 隐式乘号
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('ab', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(1);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('MathJax 4 形态：零宽字符规则 padding 非全零（可见字符塌缩）→ 仍判未就绪', async () => {
		// 规则在、但声明了非零横向内边距 = 可见字符被塌缩 → 不得借豁免混入缓存
		stubChtmlStylesheet([
			'mjx-c.mjx-c1D438 { padding: 0.68em 0.764em 0px 0px; }',
		]);
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: 'none' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0], ['\u{1D438}']);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$E=mc^2$');
		expect(holder.classList.removed).toContain('mindmap-inline-math');

		holder.setChars([5], ['\u{1D438}']); // 清理：放行待定段（索引可用桩须同时给规则键）
		await wait(150);
	});

	it('MathJax 4 形态：零宽字符规则缺失（尚未 typeset/未 flush）→ 仍判未就绪', async () => {
		// 规则缺失是「塌缩」信号，绝不能当不可见豁免放行
		stubChtmlStylesheet(['mjx-c.mjx-c1D438 { padding: 0.68em 0.764em 0px 0px; }']);
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: 'none' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0], ['\u2061']); // 无对应规则
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('\\sin x', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$\\sin x$');

		holder.setChars([5], ['\u{1D438}']); // 清理：放行待定段（索引可用桩须同时给规则键）
		await wait(150);
	});

	it('规则索引随样式表内容失效（缓存键非 flush 代际）：flush 后落盘规则可放行', async () => {
		// 2026-10-15：缓存键从 flush 代际改为（样式表元素, 规则条数）——外部通道
		// （阅读视图等）补齐样式表时本模块代际不前进，旧键会把空索引钉住。
		const rules: string[] = [];
		stubChtmlStylesheet(rules); // 初始无逐字符规则
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: 'none' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([5, 0], ['\u{1D438}', '\u2061']);
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'\\sin x',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();
		// 规则缺失 → 未就绪：同步撤回到可见字面（无中间态）
		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$\\sin x$');
		expect(onSettled).not.toHaveBeenCalled();

		rules.push(
			'mjx-c.mjx-c1D438 { padding: 0.68em 0.764em 0px 0px; }', // 可见字符（宽 5）
			'mjx-c.mjx-c2061 { padding: 0px; }', // 零宽豁免（K113）
		); // 模拟 flush 写入逐字符规则——可见字符的规则同样是在就绪必要条件（v4 判据）
		await wait(250); // flush 合并窗口 100ms + 泵 16ms

		expect(holder.children).toHaveLength(1);
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('零宽 + content 为 none（规则未落盘）→ 仍判未就绪，同步撤回（塌缩态不放行）', async () => {
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: 'none' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$E=mc^2$');
		expect(holder.classList.removed).toContain('mindmap-inline-math');

		holder.setChars([5]); // 清理：放行待定段，避免定时器跨用例残留
		await wait(150);
	});

	it('零宽 + content 为已落盘字形（"E"）→ 不是不可见字符，仍判未就绪', async () => {
		// 字形规则在而宽度为 0 的异常态 ≠ 设计零宽：不得借不可见豁免混入缓存
		vi.stubGlobal('getComputedStyle', (_el: unknown, pseudo: string) =>
			pseudo === '::before' ? { content: '"E"' } : {},
		);
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$E=mc^2$');

		holder.setChars([5]); // 清理：放行待定段，避免定时器跨用例残留
		await wait(150);
	});

	it('就绪判定环境无 getComputedStyle（单测桩/异常宿主）→ 维持旧的保守判定', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]); // 零宽字符存在，且无法读 ::before → 不就绪
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();

		expect(holder.children).toHaveLength(0);
		expect(holder.textContent).toBe('$E=mc^2$');

		holder.setChars([5]); // 清理：放行待定段，避免定时器跨用例残留
		await wait(150);
	});

	it('未就绪段不重复渲染：重试只做"放置与判定"，产物保持同一实例', async () => {
		// 旧实现的字体重试会**重新调用 tex2chtml**；新实现复用首渲染产物
		// （规则到位后即放置）——渲染调用恒为一次，不存在重试风暴面
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]);
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();
		holder.setChars([5]); // 放行
		await wait(250);

		expect(tex2chtml).toHaveBeenCalledTimes(1); // 恒为一次
		expect(holder.children).toHaveLength(1);
	});
});

describe('injectMathStylesIntoExportSvg（导出 SVG 后处理 · 方案 B）', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stripFontFaceRules：剥离 @font-face、保留逐字符与间距规则', async () => {
		const { stripFontFaceRules } = await loadModule();
		const css =
			'@font-face { font-family: MJXTEX; src: url("app://obsidian.md/x.woff"); }\nmjx-container[jax="CHTML"] { line-height: 0; }\n.TEX-I { font-family: MJXZERO, MJXTEX-I; }';
		const out = stripFontFaceRules(css);
		expect(out).not.toContain('@font-face');
		expect(out).not.toContain('app://obsidian.md');
		expect(out).toContain('mjx-container[jax="CHTML"]');
		expect(out).toContain('.TEX-I');
	});

	it('relaxMathGlyphClipPaths：mjx-c 纵向裁切窗放宽到 ±0.6em，横向与其他规则不动', async () => {
		// 2026-10-23 实机取证：MathJax 4.1.3 给 mjx-c 的纵向余量只有 ±2px；导出
		// 上下文加载不了 app:// 字体、字形走 fallback（更高且基线更低）⇒ 公式下半
		// 被这条 clip-path 裁掉（PNG / SVG 同因）。放宽纵向后与"完全移除"同效。
		const { relaxMathGlyphClipPaths } = await loadModule();
		const css =
			'mjx-c, mjx-mi > mjx-c { clip-path: polygon(-1em -2px, calc(100% + 1em) -2px, calc(100% + 1em) calc(100% + 2px), -1em calc(100% + 2px)) padding-box; }\nmjx-container[jax="CHTML"] { white-space: nowrap; }';
		const out = relaxMathGlyphClipPaths(css);
		expect(out).toContain(
			'polygon(-1em -0.6em, calc(100% + 1em) -0.6em, calc(100% + 1em) calc(100% + 0.6em), -1em calc(100% + 0.6em))',
		);
		expect(out).not.toContain('-2px');
		expect(out, '非 mjx-c 规则不得改写').toContain(
			'mjx-container[jax="CHTML"] { white-space: nowrap; }',
		);
	});

	it('relaxMathGlyphClipPaths：形态不符（点数≠4 / 非 padding-box）原样返回', async () => {
		const { relaxMathGlyphClipPaths } = await loadModule();
		const tri =
			'mjx-c { clip-path: polygon(0 0, 100% 0, 100% 100%) padding-box; }';
		expect(relaxMathGlyphClipPaths(tri)).toBe(tri);
		const borderBox =
			'mjx-c { clip-path: polygon(-1em -2px, calc(100% + 1em) -2px, calc(100% + 1em) calc(100% + 2px), -1em calc(100% + 2px)) border-box; }';
		expect(relaxMathGlyphClipPaths(borderBox)).toBe(borderBox);
	});

	it('注入链同时放宽字形裁切窗（导出 style 内不再有 ±2px 纵向窗）', async () => {
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles'
					? {
							textContent:
								'mjx-c { clip-path: polygon(-1em -2px, calc(100% + 1em) -2px, calc(100% + 1em) calc(100% + 2px), -1em calc(100% + 2px)) padding-box; }',
						}
					: null,
		});
		const appended: Array<{ tagName: string; textContent: string }> = [];
		const svg = {
			node: {
				ownerDocument: {
					win: {
						createSvg: (tag: string) => ({ tagName: tag, textContent: '' }),
					},
				},
				appendChild: (el: { tagName: string; textContent: string }) => {
					appended.push(el);
				},
			},
		};
		const { injectMathStylesIntoExportSvg } = await loadModule();
		injectMathStylesIntoExportSvg(svg);
		expect(appended[0]?.textContent).toContain('calc(100% + 0.6em)');
		expect(appended[0]?.textContent).not.toContain('-2px');
	});

	it('字体快照就绪：导出 style 内联 data URI 字体，未用到的族被剥离', async () => {
		// 2026-10-23 A 方案：stretchy（矩阵竖线 / 根号 / 分式）只能用 MJX 字体，
		// 导出上下文禁 app:// ⇒ 按需内联 data URI。裁剪依据 = 克隆里的 class token。
		// 走**真实预取**（requestUrl 返回 3 字节 ⇒ base64 `QUFB`），不靠测试专用注入口。
		vi.resetModules();
		const mathJaxCss =
			'@font-face { font-family: MJX-TEX-N; src: url("/lib/n.woff2"); }\n@font-face { font-family: MJX-TEX-SO; src: url("/lib/so.woff2"); }';
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles' ? { textContent: mathJaxCss } : null,
		});
		requestUrlMock.mockImplementation(async (request) => {
			const hit = request.url.includes('/lib/n.woff2');
			return {
				status: hit ? 200 : 404,
				// 65,65,65 = 'AAA' ⇒ btoa 得 `QUFB`
				arrayBuffer: hit
					? new Uint8Array([65, 65, 65]).buffer
					: new ArrayBuffer(0),
			};
		});
		const { injectMathStylesIntoExportSvg, primeExportMathFonts } = await import(
			'../src/platform/math-jax'
		);
		expect(await primeExportMathFonts()).toBe(true);

		const appended: Array<{ tagName: string; textContent: string }> = [];
		const svg = {
			node: {
				ownerDocument: {
					win: {
						createSvg: (tag: string) => ({ tagName: tag, textContent: '' }),
					},
				},
				appendChild: (el: { tagName: string; textContent: string }) => {
					appended.push(el);
				},
				querySelectorAll: () => [{ getAttribute: () => 'TEX-N' }],
			},
		};
		injectMathStylesIntoExportSvg(svg);
		expect(appended[0]?.textContent).toContain('data:font/woff2;base64,QUFB');
		expect(appended[0]?.textContent).not.toContain('/lib/so.woff2');
	});

	it('样式表存在：把剥离后的 CSS 追加为导出 SVG 的 style（原样返回入参）', async () => {
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles'
					? {
							textContent:
								'@font-face { font-family: MJXTEX; src: url("app://obsidian.md/x.woff"); }\nmjx-c.mjx-c37::before { content: "7"; }',
						}
					: null,
		});
		const appended: Array<{ tagName: string; textContent: string }> = [];
		const root = {
			ownerDocument: {
				// 生产走 obsidian 的 Document 扩展 `win.createSvg`（prefer-create-el）
				win: {
					createSvg: (tag: string) => ({ tagName: tag, textContent: '' }),
				},
			},
			appendChild: (el: { tagName: string; textContent: string }) => {
				appended.push(el);
			},
		};
		const svg = { node: root };
		const { injectMathStylesIntoExportSvg } = await loadModule();
		const returned = injectMathStylesIntoExportSvg(svg);
		expect(returned).toBe(svg);
		expect(appended).toHaveLength(1);
		const appendedStyle = appended[0];
		expect(appendedStyle?.tagName).toBe('style');
		expect(appendedStyle?.textContent).toContain('mjx-c.mjx-c37');
		expect(appendedStyle?.textContent).not.toContain('@font-face');
	});

	it('样式表元素存在但 sheet 不可读：退回 textContent 并告警一次（导出图可能丢逐字符规则）', async () => {
		// 元素在、CSSOM 不可读 ⇒ 只能退回 textContent；而 MathJax 的逐字符字形规则
		// 是渲染期 insertRule 动态插入的、**不在 textContent 里** ⇒ 导出 SVG 丢规则
		// （屏上正常、导出图数学不可见）⇒ 该失效只能靠日志发现（K85 ① 教训）。
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles' ? { textContent: 'mjx-container{}' } : null,
		});
		consoleWarnSpy.mockClear();
		const appended: Array<{ tagName: string; textContent: string }> = [];
		const svg = {
			node: {
				ownerDocument: {
					win: {
						createSvg: (tag: string) => ({ tagName: tag, textContent: '' }),
					},
				},
				appendChild: (el: { tagName: string; textContent: string }) => {
					appended.push(el);
				},
			},
		};
		const { injectMathStylesIntoExportSvg } = await loadModule();
		expect(injectMathStylesIntoExportSvg(svg)).toBe(svg);

		expect(appended).toHaveLength(1);
		expect(appended[0]?.textContent).toContain('mjx-container');
		expect(consoleWarnSpy, '回退必须留痕').toHaveBeenCalledTimes(1);
		expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain('CSSOM');
	});

	it('样式表缺失：安全 no-op（原样返回、不追加节点）', async () => {
		vi.stubGlobal('document', { getElementById: () => null });
		let appended = 0;
		const svg = {
			node: {
				ownerDocument: {
					win: { createSvg: () => ({ textContent: '' }) },
				},
				appendChild: () => {
					appended += 1;
				},
			},
		};
		const { injectMathStylesIntoExportSvg } = await loadModule();
		expect(injectMathStylesIntoExportSvg(svg)).toBe(svg);
		expect(appended).toBe(0);
	});

	it('属主文档无 createSvg（异常形态）：安全 no-op', async () => {
		vi.stubGlobal('document', {
			getElementById: () => ({ textContent: 'mjx-container{}' }),
		});
		let appended = 0;
		const svg = {
			node: {
				ownerDocument: {},
				appendChild: () => {
					appended += 1;
				},
			},
		};
		const { injectMathStylesIntoExportSvg } = await loadModule();
		expect(injectMathStylesIntoExportSvg(svg)).toBe(svg);
		expect(appended).toBe(0);
	});

	it('对象形态不符（无 .node）：安全 no-op', async () => {
		vi.stubGlobal('document', {
			getElementById: () => ({ textContent: 'mjx-container{}' }),
		});
		const weird = {};
		const { injectMathStylesIntoExportSvg } = await loadModule();
		expect(injectMathStylesIntoExportSvg(weird)).toBe(weird);
	});
});

describe('产物缓存与定稿回调（P4 尺寸同步）', () => {
	beforeEach(() => {
		loadMathJaxMock.mockClear();
		finishRenderMathMock.mockClear();
		consoleWarnSpy.mockClear();
		vi.stubGlobal('document', {
			getElementById: (id: string) =>
				id === 'MJX-CHTML-styles' ? { id } : null,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('getRenderedMathNode：未渲染过返回 null（调用方回落占位 + 异步路径）', async () => {
		const { getRenderedMathNode } = await loadModule();
		expect(getRenderedMathNode('E=mc^2', false)).toBeNull();
	});

	it('getRenderedMathNode：定稿入缓存后返回克隆；行内/块级键相互独立', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { getRenderedMathNode, renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush(); // 就绪路径同步定稿 → 入缓存

		expect(holder.children).toHaveLength(1);
		const cached = getRenderedMathNode('E=mc^2', false);
		expect(cached).not.toBeNull();
		// 是克隆而非同一节点（同一节点不能同时挂两处）
		expect(cached).not.toBe(holder.children[0]);
		// 块级是独立键：未渲染过仍为 null
		expect(getRenderedMathNode('E=mc^2', true)).toBeNull();
	});

	it('缓存门禁：未就绪（塌缩）产物不入缓存；就绪后才可复用', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]); // 未 flush → 塌缩态
		const { getRenderedMathNode, renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax('E=mc^2', holder as unknown as HTMLElement);
		await flush();
		expect(getRenderedMathNode('E=mc^2', false)).toBeNull(); // 塌缩产物不入缓存

		holder.setChars([5, 6]); // flush 后规则到位
		await wait(250);

		expect(getRenderedMathNode('E=mc^2', false)).not.toBeNull();
	});

	it('定稿回调：替换成功时恰好一次且**携带 holder**（视图层据此反查真实节点，K88）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'x',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();

		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith(holder);
	});

	it('定稿回调：未就绪段不提前通知；flush 后就绪 → 恰好一次', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		holder.setChars([0]); // 未就绪 → 同步撤回字面、不通知
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'x',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();
		expect(holder.textContent).toBe('$x$');
		expect(onSettled).not.toHaveBeenCalled();

		holder.setChars([5]); // flush 后规则到位 → 定稿
		await wait(250);
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it('定稿回调：未挂载（等待补替换）不提前通知，挂载后恰好一次', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(false);
		const onSettled = vi.fn();
		const { renderMathWithMathJax } = await loadModule();

		renderMathWithMathJax(
			'x',
			holder as unknown as HTMLElement,
			false,
			onSettled,
		);
		await flush();
		expect(onSettled).not.toHaveBeenCalled();

		holder.isConnected = true; // 首帧挂载 → 泵重试命中
		await wait(40);
		expect(onSettled).toHaveBeenCalledTimes(1);
	});
});

/** 画布根桩：只实现作用域判定 `contains`（repair / clear 的唯一消费面） */
const fakeRoot = (members: unknown[] = []): Node =>
	({
		contains: (node: unknown): boolean => members.includes(node),
	}) as unknown as Node;

/**
 * 未定稿修复（2026-10-14 实机缺陷收口）：`repairUnsettledMath` / `clearUnsettledMath`。
 *
 * 锁定契约：
 * - 缓存命中 → **同步修复**（替换 + 标记 + 通知，不依赖挂载、不重渲染）；
 * - 未命中 + 已挂载 + 无在途 → 重新入异步通道（`tex2chtml` 恰好 +1 次）；
 * - 未命中 + 未挂载 → 不动作（等下次触发，防空转）；
 * - 定稿即注销（已定稿段永不入 repair）；root 作用域隔离；
 * - `clearUnsettledMath` 只清 **root 内**的段（视图卸载专用；root 外的残留含
 *   已脱离，一律留给按引擎归属清的 `pruneUnsettledMathOwnedBy`——按 DOM 连接
 *   状态判归属会把其他宿主的未挂载段误清，见后者用例）。
 */
describe('repairUnsettledMath / clearUnsettledMath（未定稿段症状修复）', () => {
	it('缓存命中 → 同步修复：出视口的字面段就地换成产物（不重渲染、不依赖挂载）', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const settled = fakeHolder();
		const detached = fakeHolder(false); // 出视口（被剪枝摘除）的段
		const { renderMathWithMathJax, repairUnsettledMath } =
			await loadModule();

		// 同 TeX 先在屏内渲染成功 → 产物入缓存
		renderMathWithMathJax('E=mc^2', settled as unknown as HTMLElement);
		await flush();
		expect(settled.classList.added).toContain('mindmap-inline-math');

		// 第二个 holder 未挂载：保持字面 + 留在未定稿登记面
		renderMathWithMathJax('E=mc^2', detached as unknown as HTMLElement);
		await flush();
		expect(detached.children).toHaveLength(0);

		const renderedCalls = tex2chtml.mock.calls.length;
		const repaired = repairUnsettledMath(fakeRoot([settled, detached]));

		expect(repaired).toBe(1);
		expect(detached.children).toHaveLength(1); // 产物克隆
		expect(detached.classList.added).toContain('mindmap-inline-math');
		// 同步修复不重渲染（缓存复用）；已定稿段不在册、不重复处理
		expect(tex2chtml).toHaveBeenCalledTimes(renderedCalls);
	});

	it('未命中 + 已挂载 + 无在途 → 重新入队（tex2chtml 恰好再调一次并定稿）', async () => {
		const tex2chtml = vi.fn((): Node | null => null); // 首次：API 面缺失 → 保持字面
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax, repairUnsettledMath } =
			await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();
		expect(holder.children).toHaveLength(0);
		expect(tex2chtml).toHaveBeenCalledTimes(1);

		tex2chtml.mockImplementation(() => fakeRendered('MJX-CONTAINER'));
		const repaired = repairUnsettledMath(fakeRoot([holder]));
		await flush();

		expect(repaired).toBe(1);
		expect(tex2chtml).toHaveBeenCalledTimes(2);
		expect(holder.children).toHaveLength(1);
		expect(holder.classList.added).toContain('mindmap-inline-math');
	});

	it('未命中 + 未挂载 → 不动作（留待重新挂载后的下一次触发，不空转）', async () => {
		const tex2chtml = vi.fn((): Node | null => null);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder(false);
		const { renderMathWithMathJax, repairUnsettledMath } =
			await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		const repaired = repairUnsettledMath(fakeRoot([holder]));

		expect(repaired).toBe(0);
		expect(tex2chtml).toHaveBeenCalledTimes(1);
	});

	it('定稿即注销：成功渲染过的段不再进入修复面', async () => {
		const tex2chtml = vi.fn(() => fakeRendered('MJX-CONTAINER'));
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax, repairUnsettledMath } =
			await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();
		expect(holder.classList.added).toContain('mindmap-inline-math');

		expect(repairUnsettledMath(fakeRoot([holder]))).toBe(0);
	});

	it('作用域隔离：root 不含的段不动（多视图/嵌入并存各修各的）', async () => {
		const tex2chtml = vi.fn((): Node | null => null);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const other = fakeHolder();
		const { renderMathWithMathJax, repairUnsettledMath } =
			await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		expect(repairUnsettledMath(fakeRoot([other]))).toBe(0);
		expect(tex2chtml).toHaveBeenCalledTimes(1); // 未重入
	});

	it('clearUnsettledMath：清 root 内的段（注销后 repair 不再处理）', async () => {
		const tex2chtml = vi.fn((): Node | null => null);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const holder = fakeHolder();
		const { renderMathWithMathJax, repairUnsettledMath, clearUnsettledMath } =
			await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		clearUnsettledMath(fakeRoot([holder]));

		expect(repairUnsettledMath(fakeRoot([holder]))).toBe(0);
	});

	it('clearUnsettledMath：root 外的段一律不动（含已脱离）——不得误清其他宿主的未挂载段', async () => {
		const tex2chtml = vi.fn((): Node | null => null);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		// 另一个宿主（多视图 / 嵌入）首帧前预测量构建的懒加载段：本体从不挂载
		const holder = fakeHolder(false);
		const { renderMathWithMathJax, repairUnsettledMath, clearUnsettledMath } =
			await loadModule();

		renderMathWithMathJax('x', holder as unknown as HTMLElement);
		await flush();

		// 另一个 root（不含本 holder）销毁：不得按「已脱离文档」把它清掉
		//（旧口径在此误删 ⇒ 该段随宿主重新挂载后无人修，永久字面）
		clearUnsettledMath(fakeRoot([{}]));

		holder.isConnected = true; // 该段随宿主重新挂载
		expect(repairUnsettledMath(fakeRoot([holder]))).toBe(1);
	});
});

/**
 * 引擎归属清理（2026-10-14 实机定案）：`pruneUnsettledMathOwnedBy`。
 *
 * 锁定契约：
 * - **按引擎身份清**：只删 `owner` 相同的条目（无论连接状态），返回清理数；
 * - **关键回归**：首帧前预测量构建的 holder **本体从不挂载**（vendor 补丁 5
 *   A2）——「其他引擎的销毁清理」**不得**碰它们。旧口按 `!isConnected` 清，
 *   实机（500 节点图、公式缓存冷）把视口外 76 段全部误清 ⇒ 泵预算（3.2s）
 *   耗尽后进视口也无人修、永久字面；
 * - repair 重入（不传 owner）**保留既有归属**——不得记为「无主」而漏清；
 * - 清理即出册：被清的段不再进入 repair 面。
 */
describe('pruneUnsettledMathOwnedBy（按引擎归属清理）', () => {
	it('关键回归：未挂载 holder 在「其他引擎的销毁清理」下必须保留', async () => {
		const tex2chtml = vi.fn((): Node | null => null); // API 面缺失 → 保持未定稿
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const engineA = { engine: 'A' };
		const engineB = { engine: 'B' };
		const mounted = fakeHolder(); // 已在视口内挂载
		const pending = fakeHolder(false); // 预测量式懒加载段：本体从不挂载
		const { renderMathWithMathJax, pruneUnsettledMathOwnedBy } =
			await loadModule();

		renderMathWithMathJax(
			'x',
			mounted as unknown as HTMLElement,
			false,
			undefined,
			engineA,
		);
		renderMathWithMathJax(
			'y',
			pending as unknown as HTMLElement,
			false,
			undefined,
			engineA,
		);
		await flush();

		// 其他引擎销毁：一条都不能清（旧口径会把未挂载的 pending 误清）
		expect(pruneUnsettledMathOwnedBy(engineB)).toBe(0);
		// 归属引擎销毁：两条都清；再清幂等
		expect(pruneUnsettledMathOwnedBy(engineA)).toBe(2);
		expect(pruneUnsettledMathOwnedBy(engineA)).toBe(0);
	});

	it('清理即出册：被清的段不再进入 repair 面', async () => {
		const tex2chtml = vi.fn((): Node | null => null);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const engineA = { engine: 'A' };
		const holder = fakeHolder();
		const {
			renderMathWithMathJax,
			repairUnsettledMath,
			pruneUnsettledMathOwnedBy,
		} = await loadModule();

		renderMathWithMathJax(
			'x',
			holder as unknown as HTMLElement,
			false,
			undefined,
			engineA,
		);
		await flush();
		expect(pruneUnsettledMathOwnedBy(engineA)).toBe(1);

		expect(repairUnsettledMath(fakeRoot([holder]))).toBe(0);
	});

	it('repair 重入保留既有归属：不因「重入未传 owner」而记为无主', async () => {
		const tex2chtml = vi.fn((): Node | null => null);
		vi.stubGlobal('window', { MathJax: { tex2chtml } });
		const engineA = { engine: 'A' };
		const holder = fakeHolder();
		const {
			renderMathWithMathJax,
			repairUnsettledMath,
			pruneUnsettledMathOwnedBy,
		} = await loadModule();

		renderMathWithMathJax(
			'x',
			holder as unknown as HTMLElement,
			false,
			undefined,
			engineA,
		);
		await flush();
		// 已挂载 + 无在途 → repair 重新入队（重入不传 owner；tex2chtml 仍缺 →
		// 再次未定稿）
		expect(repairUnsettledMath(fakeRoot([holder]))).toBe(1);
		await flush();

		// 归属仍是 engineA：按 A 清恰好命中（若重入被记为 null 则为 0）
		expect(pruneUnsettledMathOwnedBy(engineA)).toBe(1);
	});
});
