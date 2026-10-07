/**
 * 代码块语法高亮（官方 `loadPrism()` 通道，生产实现的唯一落点）。
 *
 * 职责：把 `features/node-inline-content` 生成的**字面代码块**（`<pre><code>` 内已剥
 * 信息行的原文，见 `buildCodeBlockElement`）异步替换为 Prism token 元素。
 *
 * ## 为什么官方 Prism 就够了（Phase 1 调研结论）
 * Obsidian 帮助「Basic formatting syntax §Code blocks」明写：阅读视图用 **Prism**
 * 做高亮，Source / Live Preview 不用。思维导图节点是**阅读视图同级的展示面**，故
 * `await loadPrism()` + `Prism.tokenize` 正是官方口径的正路，无需自研词法器，也
 * 不必把整段交回 `MarkdownRenderer.render`（那条路只在阅读视图管线内生效，且导出
 * 离屏克隆里没有宿主管线）。
 *
 * ## 与 `platform/math-jax` 的差异（照抄其架构前必读）
 * 数学通道需要「字体就绪 + 样式 flush + 就绪判据 + 挂载后补替换队列」四件重活，
 * 本模块**一件都不需要**：`Prism.tokenize` 是**同步纯函数**，产物就是 token 元素
 * 树，不依赖挂载、不依赖字体表、不塌缩。照搬那套重机会是纯负担，故本模块只保留
 * 两件真正必要的东西，与数学通道同款纪律：
 * - **产物缓存**（`getRenderedCodeNodes`）：引擎的离屏测量是同步的、缓存键是
 *   `outerHTML`；重建时命中即**同步**放入 token（消除「按字面测量 → 替换后溢出」
 *   的窗口，且不触发重排循环）。见`InlineContentOptions.getCachedCode`；
 * - **定稿回调**：高亮替换改变自然宽高，定稿后由视图层触发重测（同
 *   `scheduleMathRemeasure`）。本模块**不自己找节点**（引擎预测量路径会给代理对象）。
 *
 * ## 为什么 token 颜色要「探测 + 内联」
 * token 的配色来自宿主 `app.css` 的 `.token.<类型>` 规则（与阅读视图同源），而：
 * - 插件 `styles.css` **不进导出 SVG**（K91/K99），导出图里 `.token.keyword` 无规则
 *   ⇒ 高亮变成「有token、无颜色」，是本项目反复踩过的导出失真面；
 * - 直接内联计算色则屏上与导出**同一份样式来源**（本项目外观一贯的内联口径）。
 * 探测在**真实 `<code>` 上下文**里做（把 holder 的内联样式抄到探针上），故拿到的
 * 就是本元素将会算出的颜色。
 *
 * ## 已知边界
 * - **主题切换**：`workspace.on('css-change')` → 视图层调`refreshPrismTokenColors`
 *   清缓存 + 就地改写屏上 token 的内联色（不必重建节点，见该函数注释）；
 * - **未登记语言**：Prism 未加载该语法（或加载抛错）时**整段跳过高亮、保留字面**，
 *   不报错、不留半个token（同「占位即回退」口径）；
 * - **第三方语言处理器**（`registerMarkdownCodeBlockProcessor`，如 dataviewjs）
 *   **不生效**：官方无「已注册处理器」的读取/枚举接口（`MarkdownPreviewRenderer`
 *   只有 register / unregister），要让它们生效只能把整段交回阅读视图管线——已与
 *   用户确认本批不做。
 *
 * **产物形态**：`<span class="token <类型>">…</span>`（可含别名类），文本走
 * `createTextNode` 逐字插入——**不经 innerHTML**，故无 HTML 注入面（Prism 的
 * `highlight()` 本要先 encode 再拼字符串，这里直接用 `tokenize` 的原始 token 流）。
 */
import { loadPrism } from 'obsidian';
import { CODE_RENDERED_CLASS, PRISM_TOKEN_CLASS } from '../core/constants';

/**
 * 本模块实际消费的 Prism 面（窄化，避免 any）。
 *
 * 只用 `tokenize`（同步纯函数）而**不用** `highlight()`：后者返回 HTML 字符串、
 * 需要 `innerHTML` 回读（注入面 + 需 DOM 解析），`tokenize` 直接给 token 流，
 * 能逐字走 `createTextNode`。
 */
interface PrismLike {
	languages?: Record<string, unknown>;
	tokenize?: (code: string, grammar: unknown) => PrismTokenStream;
}

/** Prism token（`Prism.tokenize` 的产物节点；内容可再嵌套） */
interface PrismToken {
	type: string;
	content: string | PrismTokenStream;
	alias?: string | string[];
}

/** token 流：字符串（字面片段）与 token 混排的数组 */
type PrismTokenStream = Array<string | PrismToken>;

/** 构建 token 元素所需的 document 最小面（与 features 侧 `InlineContentDocument` 同款窄接口） */
interface CodeRenderDocument {
	createElement(tag: string): HTMLElement;
	createTextNode(text: string): Node;
}

/** 可追加子节点的容器（`HTMLElement` 满足；holder 与中间 span 共用） */
interface CodeAppendTarget {
	appendChild(node: Node): unknown;
}

/**
 * 已高亮产物缓存：`lang \0 code` → token 子节点模板。
 *
 * 键含语言：同一段文本在高亮与否之间语义不同（Prism 的 tokenize 按语法分派）。
 * FIFO 淘汰，容量同数学通道量级（代码块节点远少于公式）。
 */
const renderedCodeCache = new Map<string, readonly Node[]>();

/** 产物缓存上限（简单 FIFO 淘汰；超限只影响复用率，不影响正确性） */
const RENDERED_CACHE_MAX = 200;

/**
 * token 类型 → 内联颜色缓存（探测结果；主题切换时整表清空，见 refreshPrismTokenColors）。
 *
 * **含负缓存**（值为 `null`）：「主题未给该类型着色」是常态结论，缓存它避免每次
 * 高亮都重探针（探针会强制样式计算，按节点数放大）。
 */
const tokenColorCache = new Map<string, string | null>();

/** 「语法面缺失/高亮抛错」告警去重标记（跨节点只提醒一次，避免刷屏） */
let renderWarned = false;

function warnOnce(message: string, error?: unknown): void {
	if (renderWarned) {
		return;
	}
	renderWarned = true;
	console.warn(`MindMap Studio：${message}`, error ?? '');
}

/** 缓存键（语言在前：`` `js\0code` `` 与 `` `\0code` `` 是不同条目） */
function codeCacheKey(lang: string, code: string): string {
	return `${lang}\0${code}`;
}

/**
 * 取**已高亮产物**的克隆节点数组；未命中返回 null（调用方回落到「字面 + 异步
 * 高亮」路径）。
 *
 * 注入面：`features/node-inline-content` 经 `InlineContentOptions.getCachedCode`
 * 消费（本模块不反向依赖 features，保持分层单向）。
 */
export function getRenderedCodeNodes(
	code: string,
	lang: string,
): readonly Node[] | null {
	const template = renderedCodeCache.get(codeCacheKey(lang, code));
	if (!template) {
		return null;
	}
	return template.map((node) => node.cloneNode(true));
}

/** 仅供测试：两张缓存的现状（生产代码不读） */
export function prismCodeCacheStats(): {
	products: number;
	productMax: number;
	tokenColors: number;
} {
	return {
		products: renderedCodeCache.size,
		productMax: RENDERED_CACHE_MAX,
		tokenColors: tokenColorCache.size,
	};
}

/**
 * 查 Prism 语法对象：语言为空、未登记、或登记值不是对象 → null（不高亮）。
 *
 * **必须用 `hasOwnProperty` 守卫**：`Prism.languages` 是普通对象，字面量
 * `__proto__` / `constructor` / `toString` 会在其原型链上取到值——`normalizeFenceLanguage`
 * 的白名单虽已挡掉这些名字，这里仍独立守卫（纵深防御，且语法表可能是无原型对象）。
 */
function resolveGrammar(lang: string, prism: PrismLike | null): object | null {
	if (!lang || !prism) {
		return null;
	}
	const languages = prism.languages;
	if (!languages || !Object.prototype.hasOwnProperty.call(languages, lang)) {
		return null;
	}
	const grammar = languages[lang];
	return typeof grammar === 'object' && grammar !== null ? grammar : null;
}

/**
 * 取 Prism 面：**优先 holder 属主窗口**，回落到全局。
 *
 * 官方 `loadPrism` 的 doc 措辞是「resolve 后也能用 `window.Prism`」——它只保证
 * **主窗口**有该全局。导图视图可以被拖进 popout 窗口（节点挂副窗口文档），此时
 * 裸读全局会拿到 undefined ⇒ 高亮静默不生效。故按holder 反查属主窗口。
 * （与 `platform/math-jax` 的主窗口 MathJax 边界同款，但这里可零成本修掉。）
 */
function readPrismSurface(context: HTMLElement | null): PrismLike | null {
	const owner = context?.ownerDocument?.defaultView as
		| (Window & { Prism?: PrismLike })
		| undefined;
	return owner?.Prism ?? (window as unknown as { Prism?: PrismLike }).Prism ?? null;
}

/**
 * token 流的类名：`token` + 类型 + 别名（Prism 标准形态，宿主 `.token.x` 规则命中）。
 *
 * 类型/别名来自 Prism 自身（静态串），**不是**用户文本；语言 id 已由
 * `normalizeFenceLanguage` 白名单校验，故这里无需再过滤。
 */
function tokenClassName(token: PrismToken): string {
	const aliases =
		typeof token.alias === 'string'
			? [token.alias]
			: (token.alias ?? []).filter((name) => typeof name === 'string');
	return [PRISM_TOKEN_CLASS, token.type, ...aliases].join(' ');
}

/** token 流 → DOM（递归；字符串片段走 `createTextNode`，逐字不经HTML 解析） */
function appendTokenStream(
	doc: CodeRenderDocument,
	target: CodeAppendTarget,
	stream: PrismTokenStream,
	lang: string,
	context: HTMLElement | null,
): void {
	for (const item of stream) {
		if (typeof item === 'string') {
			target.appendChild(doc.createTextNode(item));
			continue;
		}
		const span = doc.createElement('span');
		span.className = tokenClassName(item);
		// 颜色内联：探测宿主 `.token.x` 的计算色（导出 SVG 无 app.css，见文件头）
		applyTokenColor(span, item, lang, context);
		const nested: PrismTokenStream = Array.isArray(item.content)
			? item.content
			: [item.content];
		appendTokenStream(doc, span, nested, lang, context);
		target.appendChild(span);
	}
}

/**
 * 给 token 元素写**内联颜色**；探测不到（无 DOM / 无计算样式面）时**不写**——
 * 此时屏上仍由宿主 `app.css` 着色，功能不受影响（导出图里无色，属既有边界）。
 */
function applyTokenColor(
	span: HTMLElement,
	token: PrismToken,
	lang: string,
	context: HTMLElement | null,
): void {
	const color = resolveTokenColor(tokenClassName(token), context);
	if (color) {
		Object.assign(span.style, { color });
	}
}

/**
 * 探测 `.token.<类型>` 在**本元素上下文**下的计算色（缓存命中即零成本）。
 *
 * 探针= **holder 自身的浅克隆**（同标签、同内联样式），挂到 `document.body` 短暂存在：
 * - 用克隆而非 `createElement`新造：既避免逐处createEl 助手（见
 *   `InlineContentDocument` 的窄接口理由），也保证 font-family / color 继承链同源；
 * - 必须挂文档：脱离文档的元素 `getComputedStyle` 一律返回空串。
 *
 * **两次读数的差值才是 token 色**：先以空类名读「未着色的继承色」（本块的颜色），
 * 再以 token 类名读；**相等即表示主题没有为该类型定义颜色** → 返回 null（不内联）。
 * 否则会把「继承来的正文色」冻进内联 style：屏上看不出问题，但用户改主题后
 * token 不再跟随（而阅读视图会跟随），且导出图把该色固化了。
 *
 * ⚠ **两次读数必须在同一继承链上**（审查发现并修复，2026-10-07）：基线取自
 * `holder` 的**真实**颜色（`--code-normal`，由 `.tmm-codeblock` 的内联 color 给出），
 * 而候选色取自 `pre > code` 内的探针——两者必须同源。若把探针挂到 `document.body`
 * （基线取到 `--text-normal`），则在「`--code-normal ≠ --text-normal` 且该token 类型
 * 未被主题着色」的主题上**两次读数不等** → 把正文色误内联。实测默认主题两者同为
 * `#222222`，故该缺陷在默认主题下不可见，属**主题相关的潜伏缺陷**。
 *
 * ⚠ **同源的第二条约束：探针必须挂进「已挂载」的宿主**（实机取证：引擎**预测量**
 * 路径先在离屏容器里构建并高亮，那份 DOM 尚未 `isConnected` ⇒ 挂进去仍读不到计算
 * 色，实测「本修复一度让内联色从 14/14 掉到 0/14」）。故宿主取 `context.isConnected`
 * 的父节点；未挂载时回落 `document.body` 并标记**低置信**（不写共享缓存，避免近似色
 * 污染精确路径的结果）。
 */
function resolveTokenColor(tokenClass: string, context: HTMLElement | null): string | null {
	const cached = tokenColorCache.get(tokenClass);
	if (cached !== undefined) {
		// 含**负缓存**（null）：未着色类型每次都重探针会按节点数放大样式重算，
		// 且tokenColorCache 只在主题刷新时清空（换主题会自动重探）。
		return cached;
	}
	const probed = probeTokenColor(tokenClass, context);
	if (probed.cacheable) {
		tokenColorCache.set(tokenClass, probed.color);
	}
	return probed.color;
}

/** 一次探测的结果：颜色 + 是否可进共享缓存 */
interface TokenColorProbe {
	color: string | null;
	cacheable: boolean;
}

/**
 * 真探测：**在 holder 的父节点里**放一个浅克隆，连读两次计算色。
 *
 * 挂载宿主 = `context.parentElement`（`pre.tmm-codeblock`）——与真实元素**同一继承链**，
 * 故 `.token.x` 的规则解析、`.markdown-*` 类作用域、自定义 CSS 片段全部生效。
 * 挂 `document.body` 会丢掉这些作用域（见上方警告）。
 *
 * ⚠ 宿主必须**已挂载**：脱离文档时 `getComputedStyle` 一律返回空串。引擎预测量
 * 副本未挂载 ⇒ 回落 `document.body` 并**标记低置信**（`cacheable: false`，不污染
 * 共享缓存）。挂载在前、颜色不参与布局宽度，故低置信结果对测量无影响。
 *
 * 同步挂→读→移除（同一 task 内完成，中间不发生绘制 ⇒ 无闪烁）；vendor 无
 * `MutationObserver`，引擎不会因这次临时子节点触发额外重排。读取本身强制一次样式
 * 计算，但按「token 类型 × 主题」缓存，实际每主题仅十余次。
 */
function probeTokenColor(
	tokenClass: string,
	context: HTMLElement | null,
): TokenColorProbe {
	const doc = context?.ownerDocument;
	const win = doc?.defaultView;
	// getComputedStyle 面缺失（测试桩 / 极端环境）→ 不探测
	if (!context || !doc?.body || !win || typeof win.getComputedStyle !== 'function') {
		return { color: null, cacheable: false };
	}
	let probe: HTMLElement | null = null;
	try {
		// 父链在且已挂载 → 精确路径；否则回落 body（低置信）
		const parent = context.parentElement;
		const host = parent && context.isConnected ? parent : doc.body;
		const cacheable = host === parent && !!parent;
		probe = context.cloneNode(false) as HTMLElement;
		probe.className = '';
		host.appendChild(probe);
		const base = win.getComputedStyle(probe).color;
		probe.className = tokenClass;
		const color = win.getComputedStyle(probe).color;
		return { color: color && color !== base ? color : null, cacheable };
	} catch {
		// 形态不符 / 样式面抛错 → 不写内联色（屏上仍由宿主主题着色）
		return { color: null, cacheable: false };
	} finally {
		probe?.remove?.();
	}
}

/**
 * 主题切换（`css-change`）后刷新 token 颜色。
 *
 * **为什么不就地重建节点**：内联色写在每个 token 上，主题换了只需按新调色板改写
 * `style.color`——比重建节点（引擎逐节点测宽、代价与节点数线性）便宜两个数量级，
 * 且不必依赖「谁触发了重建」的时序。
 *
 * 两张缓存一并清空：① token 色缓存（否则后续新建的块仍是旧色）；② 产物缓存
 * （否则重建时命中旧色的克隆，且此时上面的就地改写已经跑完、救不回来）。
 *
 * **语言从类名反解、不另设`data-lang`**：`<code class="language-js">` 已由构建期
 * 写入（`node-inline-content`），语言是**唯一权威来源**；本函数只需要元素上下文
 * （探针要复刻它的内联样式），故不引入第二个数据源，也不给每个块多加一份
 * `outerHTML` 字节（K114：`outerHTML` 是引擎测量缓存键）。
 *
 * `root` 为视图根元素；查不到任何高亮块时直接返回（无 token 面 = 无需改写）。
 */
export function refreshPrismTokenColors(root: ParentNode): void {
	renderedCodeCache.clear();
	tokenColorCache.clear();
	let holders: Element[];
	try {
		// 直接调用 + try/catch：形态不符时安全no-op（勿改成方法引用判定，
		// 那会命中 DOM lib 的 deprecated 重载签名，见 features/node-codeblock）
		holders = Array.from(
			root.querySelectorAll(`.${CODE_RENDERED_CLASS}`),
		);
	} catch {
		return;
	}
	for (const holder of holders) {
		repaintTokenChildren(holder as HTMLElement);
	}
}

/** 就地改写一个 `<code class="tmm-code-hl">` 下所有 token 的内联色（递归） */
function repaintTokenChildren(codeEl: HTMLElement): void {
	for (const child of Array.from(codeEl.children)) {
		const span = child as HTMLElement;
		const className = span.className;
		// 只下探**token 元素**（有 className）：`children` 在真实 DOM 里虽只含元素，
		// 但本函数也接收桩/异常形态——非元素节点没有 children，递归下去会抛并
		// 连带打断整个 css-change 处理器。token 元素恒有类名，故以此为守卫。
		if (typeof className !== 'string' || className.length === 0) {
			continue;
		}
		const color = resolveTokenColor(className, codeEl);
		if (color) {
			Object.assign(span.style, { color });
		}
		repaintTokenChildren(span);
	}
}

/**
 * 高亮一段代码到 holder（异步，fire-and-forget；调用方无需等待）。
 *
 * 成功：holder 子节点换成 token 元素 + 加`CODE_RENDERED_CLASS` + 入缓存 +
 * 通知 `onSettled`（视图层据此重测尺寸）。失败（`loadPrism` 拒绝 / 语法未登记 /
 * tokenize 抛错）：**保留字面**并最多告警一次。
 *
 * 多节点并发安全：`loadPrism()` 内部对加载去重，`tokenize` 为纯函数。
 */
export function renderCodeWithPrism(
	code: string,
	lang: string,
	holder: HTMLElement,
	onSettled?: (holder: HTMLElement) => void,
): void {
	void (async () => {
		try {
			await loadPrism();
			const prism = readPrismSurface(holder);
			const grammar = resolveGrammar(lang, prism);
			if (!grammar) {
				// 语言未登记 = 常态（用户可写任意语言码）→ 不告警，静默保留字面
				return;
			}
			const stream = prism?.tokenize?.(code, grammar);
			if (!stream || stream.length === 0) {
				// 空产物而代码非空 = 语法异常 → 保留字面（不渲染空白块）
				return;
			}
			const doc = holder.ownerDocument ?? document;
			const nodes: Node[] = [];
			const collector: CodeAppendTarget = {
				appendChild: (node: Node) => {
					nodes.push(node);
					return node;
				},
			};
			appendTokenStream(doc, collector, stream, lang, holder);
			if (nodes.length === 0) {
				return;
			}
			holder.replaceChildren(...nodes);
			holder.classList.add(CODE_RENDERED_CLASS);
			rememberProduct(lang, code, nodes);
			onSettled?.(holder);
		} catch (error) {
			warnOnce('代码块高亮失败，保留字面显示', error);
		}
	})();
}

/** 记入产物缓存（重复键不覆盖：先到先得，且避免克隆覆盖正在使用的节点） */
function rememberProduct(lang: string, code: string, nodes: readonly Node[]): void {
	const key = codeCacheKey(lang, code);
	if (renderedCodeCache.has(key)) {
		return;
	}
	if (renderedCodeCache.size >= RENDERED_CACHE_MAX) {
		const oldest = renderedCodeCache.keys().next().value;
		if (oldest !== undefined) {
			renderedCodeCache.delete(oldest);
		}
	}
	renderedCodeCache.set(key, nodes);
}