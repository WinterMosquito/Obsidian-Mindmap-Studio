/**
 * 行内数学渲染（platform/math-jax）单元回归。
 *
 * 背景（2026-09-27 实机取证 + S0.5 双环境实测）：Obsidian 1.13.7 经 loadMathJax
 * 注入的 MathJax 3.2.2 是 CHTML 组件——只有 `tex2chtml`、**没有 `tex2svg`**；
 * 且逐字符规则只在样式表 **flush** 时写入：未 flush 的产物「非零但塌缩」
 * （`mjx-c` 全 0 宽），「容器宽高 > 0」无法识别（实测 14×20 vs 130×20）。
 * 本套件锁定：
 * - 通道优先级（`tex2chtml` → `tex2svg`）与替换语义（内容替换 + 类名）；
 * - **就绪判据**：产物内全部 `mjx-c` 宽 > 0（无 `mjx-c` 退回「宽高皆 > 0」）；
 *   未就绪 → **同步撤回字面**（无中间态）+ 待定重试；预算耗尽保留字面并告警；
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

vi.mock('obsidian', () => ({
	loadMathJax: loadMathJaxMock,
	finishRenderMath: finishRenderMathMock,
}));

/** 产物内 `mjx-c` 桩：就绪判据读取其宽度（全 > 0 = 逐字符规则已 flush） */
interface FakeChar {
	getBoundingClientRect(): { width: number };
}

function fakeChar(width: number): FakeChar {
	return { getBoundingClientRect: () => ({ width }) };
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
	/** 运行中改字符宽度：模拟「flush 后逐字符规则到位」 */
	setChars(widths: number[]): void;
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
		setChars(widths: number[]): void {
			chars = widths.map(fakeChar);
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

/** 渲染产物桩（代表 mjx-container）；cloneNode 支撑产物缓存复用（P4） */
function fakeRendered(name: string): Node {
	const node = {
		nodeName: name,
		cloneNode: (): Node => fakeRendered(`${name}#clone`),
	};
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
