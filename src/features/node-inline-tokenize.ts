/**
 * 节点内联内容的**段序列切分**（纯逻辑，2026-10-16 自 `node-inline-content.ts` 拆出）。
 *
 * 覆盖：行内 token → 段序列（轻标记 / 代码块 / 数学 / 链接 / **表格块**）、
 * 段缓存（`segmentEntryOf` / `segmentCacheStats`）、接管判定（`resolveSelfDrawSource`）、
 * 展示截断（`clampSegments`）与显示文本预览（`inlineContentPreview`）。
 * **不触碰 DOM**——DOM 装配见 `node-inline-html`（本模块是它的依赖，反向不成立）。
 */
import {
	isIndentedCodeLine,
	isRenderableImageTarget,
	normalizeFenceLanguage,
} from '../core/constants';
import { readNodeDataString } from '../core/node-data';
import { matchPipeTable, type PipeTable } from '../domain/pipe-table';
import { isSchemeUrl, isUrlLikeText } from '../domain/url';
import { isNodeTextEdited } from '../domain/md-meta';
import { tokenDisplay, tokenizeInline, type InlineToken } from '../markdown/md-outline';
import type { MindMapNode } from '../core/engine-types';

export interface InlineContentDocument {
	createElement(tag: string): HTMLElement;
	createTextNode(text: string): Node;
}

/** 行内轻标记（渲染期识别，**不改动 `data.text`**：原文仍由 mdRaw 逐字保真） */
export type InlineTextStyle =
	| 'bold'
	| 'boldItalic'
	| 'italic'
	| 'code'
	| 'strike'
	| 'highlight'
	| 'math';

/**
 * 自绘内容的**外部解析依赖**（注入式：本模块不接触 Obsidian API，
 * 以便在无运行时环境打包/单测，见 InlineContentDocument 的说明）。
 */
export interface InlineContentOptions {
	/**
	 * 库内 linkpath 是否**已解析**到文件（缺省视为已解析）。
	 *
	 * 未解析 → 锚点带 `is-unresolved` 类 + 弱化配色：对齐 Obsidian 阅读视图
	 * 「指向尚不存在的笔记的链接显示为更弱的颜色」。解析发生在**每次构建**时
	 * （不进段序列缓存——缓存按原文内容寻址，与库状态无关）。
	 */
	isResolvedLink?: (linkpath: string) => boolean;
	/**
	 * 数学（行内 `$…$` / 单行块级 `$$…$$`）的**异步渲染**注入
	 * （生产实现 = `platform/math-jax`）。
	 *
	 * 本模块保持零 Obsidian 依赖（`loadMathJax` 不可在无运行时打包），故数学
	 * 渲染作为能力注入：`buildMathElement` 先写**字面占位**（行内 `$…$` /
	 * 块级 `$$…$$`，即回退态），实现方在 MathJax 就绪后把 `holder` 内容替换为
	 * 渲染产物。失败/未注入时占位原样保留——与「未闭合标记按字面」同一条安全口径。
	 *
	 * `display` = 段模型的 display 标记（true → `tex2chtml` 的 `{ display: true }`，
	 * 渲染为独立居中公式；实现方需原样透传给 MathJax 通道）。
	 *
	 * `owner` = 构建该段的**引擎实例**（不透明 token，由 `engine/mindmap` 注入，
	 * 本模块原样透传）——平台侧据此登记归属，引擎销毁时精确清理未定稿段
	 * （`platform/math-jax` 的 `pruneUnsettledMathOwnedBy`，语义见那里的
	 * `unsettledMath`）。
	 */
	renderMath?: (
		doc: InlineContentDocument,
		tex: string,
		holder: HTMLElement,
		display: boolean,
		owner?: object | null,
	) => void;
	/**
	 * **产物缓存查询**（可选，P4 尺寸同步）：返回已渲染产物的**克隆**，未命中 null。
	 *
	 * 命中时 `buildMathElement` **同步**放置产物、**不走** `renderMath`——引擎随后
	 * 的离屏测量直接量到**真实宽高**，消除「按字面占位测量 → 替换后溢出」的窗口；
	 * 且重建路径不再触发异步替换（无重排循环）。注入实现见
	 * `platform/math-jax.getRenderedMathNode`（本模块不 import 该层）。
	 */
	getCachedMath?: (tex: string, display: boolean) => Node | null;
	/**
	 * **代码块 Prism 高亮**的注入（同 `renderMath` 的注入式纪律：生产实现 =
	 * `platform/prism-code`，那里是唯一 import `obsidian` 的代码高亮实现）。
	 *
	 * 本模块先写**字面代码**（信息行已剥、缩进/空行逐字），实现方在`loadPrism()`
	 * 就绪后把 holder 的子节点换成 token 元素。`lang` 已规范化为语言 id（空串 =
	 * 无语言/未登记 → 实现方**跳过**并保留字面）。
	 *
	 * `onSettled`（定稿回调）由**组合根注入时绑定**（视图层拿它触发节点尺寸重测，
	 * 同 `renderMath` 的注入形态），故本形参表里不出现——避免第二条回调通道。
	 * 本模块**不自己找节点**：引擎预测量路径会给代理对象（见 math-jax 文件头）。
	 */
	renderCode?: (
		doc: InlineContentDocument,
		code: string,
		lang: string,
		holder: HTMLElement,
	) => void;
	/**
	 * **已高亮产物查询**（可选，尺寸同步）：返回 token 子节点的克隆数组，未命中 null。
	 *
	 * 命中时 `buildCodeBlockElement` **同步**放置 token、不走 `renderCode`——引擎随后的
	 * 离屏测量直接量到真实宽高（消除「按字面测量 → 替换后溢出」的窗口），且重建
	 * 路径不再触发异步替换（无重排循环）。注入实现见
	 * `platform/prism-code.getRenderedCodeNodes`（本模块不 import 该层）。
	 */
	getCachedCode?: (code: string, lang: string) => readonly Node[] | null;
}

/** 行内段：渲染节点内联内容的最小单元（纯数据，可单测） */
export interface InlineSegment {
	kind: 'text' | 'link' | 'table';
	/**
	 * 纯文本原样 / 链接段的**剥壳显示名**（`tokenDisplay` 口径，与节点文本一致）
	 * / 表格段的**原文块文本**（逐字：含外框管道、`\|` 转义与边界换行）。截断上限
	 * 与编辑弹窗预览都按它计量（见 `clampSegments` / `inlineContentPreview`）。
	 *
	 * ⚠ 段序列 `text` 拼接 **≈ 原文、非逐字相等**：文本段经空格归一
	 * （`normalizeSpaces`）与首尾空白剔除（`trimEdges`），`%%注释%%` 整段不进段
	 * 序列——只有**表格段**的 `text` 是逐字切片。需要逐字原文请用 `mdRaw` /
	 * `data.text`（回写侧同款口径）。
	 */
	text: string;
	/** 链接段跳转目标：wiki = 原始 linkpath；md 链接 / URL = 地址原文 */
	link?: string;
	/** true = 库内目标（`a.internal-link[data-href]`）；false = 外部地址（`a.external-link[href]`） */
	internal?: boolean;
	/** 文本段的轻标记（仅 kind = 'text'；无标记的纯文本省略） */
	style?: InlineTextStyle;
	/**
	 * 轻标记体的**一层嵌套**（仅 kind = 'text' 且 style 存在；官方「combine
	 * them」，如 `**粗 _斜_**`）。子段不会再有 children（深度上限见
	 * MAX_MARKUP_DEPTH）；无样式子段（纯文本/转义结果）不进 children——
	 * 那种情形下标记体的字面就是显示文本（text 字段已承载）。
	 */
	children?: InlineSegment[];
	/**
	 * 数学段的显示模式（仅 style === 'math'）：true = 单行 `$$…$$`（display /
	 * 块级，渲染为独立居中公式），缺省 = 行内 `$…$`。该标记同时决定占位形态
	 * 与 `renderMath` 注入面的 `display` 形参（见 buildMathElement）。
	 */
	display?: boolean;
	/**
	 * **围栏代码块**标记（仅 style === 'code' 且来自 fence 分支）：true = 块级
	 * 代码块（buildCodeBlockElement：底色盒 + 复制按钮 + Prism 高亮），缺省 =
	 * 行内码（`` ` `` 单反引号）。与 `display` 同款纪律：**重建段对象时必须保留**，
	 * 否则块级渲染会静默退化回行内码。
	 */
	block?: true;
	/**
	 * 围栏**信息行给出的语言 id**（仅 style === 'code' 且 block 标记）：已按
	 * `core/constants.normalizeFenceLanguage` 白名单规范化（小写；不合规为空串）。
	 *
	 * 空串有两种含义，**都不高亮**、都保留字面：① 无信息行（``` ``` ``` /缩进式
	 * 代码块）；② 信息行给了 Prism 未登记的语言码（用户可写任意语言码）。
	 * 该字段进 `<code class="language-…">`（宿主/主题选择器口径）并传给
	 * `platform/prism-code` 查语法。
	 */
	lang?: string;
	/**
	 * **表格段**的模型（仅 kind = 'table'）：解析在 `domain/pipe-table`（纯逻辑），
	 * DOM 装配与内联样式在 `node-inline-html`（`buildTableElement`）。
	 *
	 * 与 `block` / `display` 同款纪律：**重建或拷贝段对象时必须带上**，否则表格段
	 * 会退化成空元素（而 `clampSegments` 的就地切短路径会丢字段——它已排除表格段）。
	 */
	table?: PipeTable;
}

/**
 * 可被反斜杠转义的字符类（**正则源码片段**，两处共用：下面的转义分支与
 * `ESCAPED_MARKUP_RE` 的接管判据——分开写会出现「解释了这组、却按另一组触发接管」）。
 *
 * 依据官方帮助「Basic formatting syntax / Escaping Markdown Syntax」列的
 * `\*` `\_` `\#` `` \` `` `\|` `\~`，外加本模块额外解释的**高亮定界符** `=`、
 * **数学定界符** `$`（`\$x\$` 在 Obsidian 里显示字面 `$x$`、不触发数学渲染）
 * 与反斜杠自身（CommonMark 允许转义任意 ASCII 标点，`\\` → `\`）。
 */
const ESCAPABLE_CLASS = /[*_~=`#|\\$]/.source;

/**
 * 数学定界符的匹配源（**单一来源**：MARKUP_RE 的数学备选分支与接管判据
 * `INLINE_MATH_RE` 共用同一字符串——分成两处维护会漂移，本文件注释曾自认该风险）。
 *
 * 两支形态（**顺序即优先级：双美元写在单美元之前**，更长定界符优先）：
 * - `mathBlock`：`$$…$$`（display / 块级数学）——内容**可跨行、可含单个 `$`**
 *   （开 `$$` 找**最近**的 `$$` 闭合，对齐 Obsidian 阅读视图实测口径，见 K89：
 *   `$$` 独占行的三行块 / 多行 vmatrix / `$$$x$$$`（tex = `$x`）都按此解析）；
 *   开定界符后的空格/制表/换行**不阻断**配对（B1：Obsidian 对
 *   `$$ x=1 $$` 照常渲染为公式，去掉此前的「紧跟空格按字面」守卫——用户实测
 *   该守卫让 `$$ f(x)=…` 整段不进数学通道，块内 `\\` 还被转义分支吃成单 `\`）；
 * - `math`：行内 `$…$`——内容不跨行、不含 `$`，开侧仍拒绝紧空白（价签口径）。
 * 两支同口径：闭后不得是数字（防 `$5 与 $6` 类价签误判）。转义 `\$` 由
 * ESCAPABLE_CLASS 先行消费（escaped 分支排在数学之前），故 `\$x\$` 显示
 * 字面 `$x$`、不触发数学。
 */
const MATH_SOURCE =
	'\\$\\$(?<mathBlock>[\\s\\S]*?\\S[\\s\\S]*?)\\$\\$(?!\\d)' +
	'|' +
	'\\$(?!\\s)(?<math>[^$\\n]*?\\S)\\$(?!\\d)';

/**
 * 行内语法的统一扫描正则（命名分组；备选顺序即优先级）。
 *
 * 1. `%%…%%` —— 注释（可跨行；未闭合不匹配 → 按字面显示）；
 * 2. 围栏代码块 —— 定界符 **3 个以上**的反引号**或波浪号**、**同字符同长度闭合**
 *    （CommonMark + Obsidian 帮助：两种定界符皆可，4+ 反引号可嵌套代码块）；
 *    排在行内码之前，否则 `` ```js `` 的首行会被行内码分支切碎。
 *    ⚠ **口径必须与解析层一致**（`markdown/md-outline.classifyLines` 的
 *    `^[ \t]{0,3}(`{3,}|~{3,})`）：此前本正则只认反引号，`~~~` 围栏的节点虽然
 *    被正确解析成"围栏整体"，渲染时却退化成普通文本（解析/渲染两侧口径裂缝）；
 * 3. 行内代码 —— 定界符为 1..n 个反引号、**同长度闭合**（CommonMark 语义：
 *    `` ``a`b`` `` 允许内容含更短的反引号串）；内容按字面，内部不解释标记/转义；
 * 4. 转义 `\<可转义字符>` —— 消费反斜杠、按字面显示该字符（字符集见 ESCAPABLE_CLASS）；
 * 5. 数学（`MATH_SOURCE`，**双美元写在单美元之前**——更长定界符优先）：
 *    5a. `$$…$$`（display / 块级，`mathBlock` 组；内容可跨行、可含单个 `$`——
 *    开 `$$` 找最近 `$$` 闭合，对齐 Obsidian 实测口径）；
 *    5b. 行内 `$…$`（`math` 组）。两支同口径：闭 `$` 前
 *    不得是空白、后不得是数字（Obsidian 数学扩展口径，防止 `$5 与 $6` 价签误判）；
 *    排在标记类之前，`$a*b*c$` 内的 `*` 不会被当斜体；
 * 6. `***粗斜***` / `___粗斜___`（组合字形，单独一支）；
 * 7. `**粗**` / `__粗__`、`~~删~~`、`==高亮==`、`*斜*` / `_斜_`。
 *
 * 两条与 CommonMark 对齐的取舍：
 * - 粗/斜/删/高亮要求定界符内首尾**非空白**（flanking 规则的最简形态）：
 *   `a * b * c` 不是斜体，按字面保留；行内代码不设此限；
 * - `_` 系列额外要求内外侧不是字母/数字（`snake_case` 里的 `_x_` 不误判为斜体）。
 *
 * **嵌套（Obsidian 帮助「combine them」）**：`**粗 _斜_ 粗**` 与 `**粗 *斜* 粗**`
 * 都要能渲染（官方示例即用星号）。此前 `bold` 的标记体写死 `[^*\n]*`（排除 `*`），
 * 而 `boldU` 的 `[^_\n]*` 不排除 `_` —— 两条分支不对称，导致星号版整段退化为
 * 字面、屏幕上露出裸 `**`（2026-10-11 实机实测）。现改为 **允许标记体内出现单个
 * `*`、仅禁止 `**`**：既放行内层斜体，又不会让外层粗体越过下一对 `**` 乱配对。
 *
 * `*斜 **粗** 尾*`（斜体包粗体）**刻意不支持**：星号同时作两侧定界符，单遍正则
 * 无法判定哪个 `*` 属于哪一层（CommonMark 靠定界符栈，本模块是单遍扫描 + 递归）。
 * 与其拆错，不如**整段按字面**：为此 ital 分支加了「不与 `*` 相邻」的双向守卫
 * （`(?<!\*)\*(?!\*)` … `(?!\*)`），否则正则会在 `**粗**` 内部凑出假的 `<em>粗</em>`、
 * 把一行切碎。下划线版（`_斜 **粗** 尾_`）无此歧义，照常支持。
 *
 * 正则整体带 `u` 标志（`\p{L}` 需要）；标记体一律 `[^…\n]` 不跨行（见模块头边界）。
 */
const MARKUP_RE = new RegExp(
	[
		'(?<comment>%%[\\s\\S]*?%%)',
		'(?<fence>(?:`{3,}|~{3,}))(?<fenceCode>[\\s\\S]*?)\\k<fence>',
		'(?<ticks>`+)(?<code>(?:[^`\\n]|`(?!\\k<ticks>))+?)\\k<ticks>',
		'\\\\(?<escaped>' + ESCAPABLE_CLASS + ')',
		MATH_SOURCE,
		'\\*\\*\\*(?<boldItal>\\S(?:[^*\\n]*\\S)?)\\*\\*\\*',
		'(?<![\\p{L}\\p{N}])___(?<boldItalU>\\S(?:[^_\\n]*\\S)?)___(?![\\p{L}\\p{N}])',
		'\\*\\*(?<bold>\\S(?:(?!\\*\\*)[^\\n]*\\S)?)\\*\\*',
		'(?<![\\p{L}\\p{N}])__(?<boldU>\\S(?:[^_\\n]*\\S)?)__(?![\\p{L}\\p{N}])',
		'~~(?<strike>\\S(?:[^~\\n]*\\S)?)~~',
		'==(?<mark>\\S(?:[^=\\n]*\\S)?)==',
		'(?<!\\*)\\*(?!\\*)(?<ital>[^*\\s](?:(?:[^*\\n]|\\*\\*[^*\\n]*?\\*\\*)*[^*\\s])?)\\*(?!\\*)',
		'(?<![\\p{L}\\p{N}])_(?<italU>\\S(?:[^_\\n]*\\S)?)_(?![\\p{L}\\p{N}])',
	].join('|'),
	'gu',
);

/**
 * 轻标记的**嵌套深度上限**：深度 0 = 顶层、1 = 标记体内再套一层标记
 * （官方「combine them」：`**粗 _斜_**`）。再深的嵌套（`**_==x==_**` 的最内层）
 * 按字面显示——渲染收益趋零，扫描/建树成本与回归面线性涨。
 */
const MAX_MARKUP_DEPTH = 2;

/**
 * 轻标记/隐藏语法的**单遍扫描**（顺序即优先级，见 MARKUP_RE）。
 *
 * 覆盖 Obsidian 帮助「Basic formatting syntax」的行内格式：
 * - `**粗**` / `__粗__`、`*斜*` / `_斜_`、`` `码` ``、`~~删~~`、`==高亮==`、
 *   `***粗斜***`；
 * - `%%注释%%` → **渲染期整段隐藏**（阅读视图口径：注释只在编辑视图可见）；
 * - 反斜杠转义（官方清单 `\*` `\_` `\#` `` \` `` `\|` `\~`，另有 `\=` 与本模块
 *   解释的标记定界符；`\\` → `\`）→ 消费反斜杠、按字面显示该字符
 *   （`\*a\*` 在 Obsidian 里显示 `*a*`，此前本模块会误渲染成斜体）。
 *
 * 边界（有意，与阅读视图的差异）：**不跨行、嵌套至多一层**（见 MAX_MARKUP_DEPTH，
 * `**_==x==_**` 的最内层按字面）；未闭合的标记/注释按字面保留。解析/回写层始终把
 * 标记当普通文本（无损往返），此处只做显示层处理。
 */
function splitMarkedText(text: string, depth = 0): InlineSegment[] {
	const out: InlineSegment[] = [];
	/**
	 * 无样式片段入队（**与上一段合并**）：「转义 / 隐藏注释」会在同一段文本里
	 * 反复切断扫描（`\*a\*` → `*`、`a`、`*`），逐片入队会产出多个相邻文本节点。
	 */
	const pushPlain = (value: string): void => {
		// prose 连续空格归一在此落地（代码/数学段不走本函数，见各分支）
		const text = normalizeSpaces(value);
		const last = out[out.length - 1];
		if (last && last.style === undefined) {
			out[out.length - 1] = { kind: 'text', text: last.text + text };
			return;
		}
		out.push({ kind: 'text', text });
	};
	let cursor = 0;
	// **按位置驱动**（每轮把 lastIndex 显式设为 cursor）：MARKUP_RE 是模块级共享
	// 正则，嵌套扫描的**子调用**会重置它的 lastIndex——若父循环依赖 lastIndex 续扫，
	// 子调用返回后父循环会从 0 重扫并再次命中同一标记 → 死循环 + 段数组无限增长
	// （**a** 在引入嵌套后即触发，见 probe 复现）。
	let match: RegExpExecArray | null;
	for (;;) {
		MARKUP_RE.lastIndex = cursor;
		match = MARKUP_RE.exec(text);
		if (match === null) {
			break;
		}
		// 防御空匹配导致的死循环（所有分支都要求至少一个字符，理论上不可达）
		if (match[0].length === 0) {
			cursor++;
			continue;
		}
		if (match.index > cursor) {
			pushPlain(text.slice(cursor, match.index));
		}
		const groups = match.groups ?? {};
		if (groups.comment !== undefined) {
			// 注释：整段不进显示（连定界符一起吞掉）
		} else if (groups.fenceCode !== undefined) {
			// 多行围栏代码块（``` *或* ~~~ 起止、3 个以上、同长度闭合，可跨行）：
			// **块级代码段**（block 标记 → buildCodeBlockElement：底色盒 + 复制按钮
			// + Prism 高亮）。首行信息行（```js）在段内剥掉——它不进显示与复制
			//（splitFenceInfo），但**语言码要留下来**（`lang` 段字段 → language-xxx
			// 类 → Prism 语法查找），否则高亮无从下手。
			// 代码原文（缩进/空行）逐字保留（归一化不作用于本分支）。
			// 同时使围栏内的 `$$` 被本分支先行消费、不被块级数学误配对（K89）
			const { lang, code } = splitFenceInfo(groups.fenceCode);
			const language = normalizeFenceLanguage(lang);
			out.push({
				kind: 'text',
				text: code,
				style: 'code',
				block: true,
				...(language ? { lang: language } : {}),
			});
		} else if (groups.code !== undefined) {
			// 行内码：逐字保留（连续空格是内容；阅读视图同为字面）
			out.push({ kind: 'text', text: groups.code, style: 'code' });
		} else if (groups.escaped !== undefined) {
			// 转义：消费反斜杠，按字面显示该字符（无样式）
			pushPlain(groups.escaped);
		} else if (groups.mathBlock !== undefined) {
			// 单行 `$$…$$`（display / 块级）：定界符不进显示文本；display 标记
			// 决定占位形态（`$$…$$`）与渲染通道（tex2chtml 的 display 选项）
			out.push({
				kind: 'text',
				text: groups.mathBlock,
				style: 'math',
				display: true,
			});
		} else if (groups.math !== undefined) {
			// 行内数学：定界符不进显示文本（buildMathElement 的回退态自行补回）
			out.push({ kind: 'text', text: groups.math, style: 'math' });
		} else {
			const style: InlineTextStyle =
				groups.boldItal !== undefined || groups.boldItalU !== undefined
					? 'boldItalic'
					: groups.bold !== undefined || groups.boldU !== undefined
						? 'bold'
						: groups.strike !== undefined
							? 'strike'
							: groups.mark !== undefined
								? 'highlight'
								: 'italic';
			// 标记体是 prose：先归一（children 在归一后的文本上递归，与旧口径
			// 一致；体**内**的代码/数学子段仍各自保原文）
			const body = normalizeSpaces(
				groups.boldItal ??
					groups.boldItalU ??
					groups.bold ??
					groups.boldU ??
					groups.strike ??
					groups.mark ??
					groups.ital ??
					groups.italU ??
					'',
			);
			// 官方「combine them」：标记体内再扫一层（代码内不进来——code 分支
			// 先行；转义/注释在子层照常生效）。子层全部无样式时不挂 children
			// ——那种情形标记体的字面就是显示文本，挂了徒增遍历。
			const children =
				depth + 1 < MAX_MARKUP_DEPTH ? splitMarkedText(body, depth + 1) : undefined;
			const nested =
				children !== undefined &&
				children.some((child) => child.style !== undefined);
			out.push({
				kind: 'text',
				text: body,
				style,
				...(nested && children ? { children } : {}),
			});
		}
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) {
		pushPlain(text.slice(cursor));
	}
	return out;
}

/**
 * prose 的连续空格归一（HTML 折叠空白语义，原文由 mdRaw 保真）。
 *
 * **只作用于散文文本**：代码块 / 数学段的空白是内容（缩进、对齐），必须原文
 * 保留——故本归一化**下沉到 splitMarkedText 的各分支**（空白 prose 与标记体），
 * 而不是切分前对全文预归一（那是 旧序，会把代码缩进压扁）。
 */
function normalizeSpaces(value: string): string {
	return value.replace(/[ \t]{2,}/g, ' ');
}

/**
 * 围栏内容 → `{ lang, code }`：剥离首行**信息行**（```` ```js ```` 的 `js`）。
 *
 * CommonMark 口径：开围栏所在行的行终止符不属于内容——即有 `\n` 时内容一律从
 * 其**之后**开始；首个 `\n` 之前的内容是信息行（无 lang 时为空串）。两种形态
 * （**不改 fence 正则**，零回归面）：
 * - 含 `\n` → `lang = 首行 trim`（容忍 ```` ``` js ```` 写法）、`code = 余下原文`
 *   （缩进/空行原样；首尾空行由 trimEdges 裁）；
 * - 不含 `\n`（单行 ```` ```code``` ````）→ 整体即代码、无 lang（既有行为）。
 */
function splitFenceInfo(fenceCode: string): { lang: string; code: string } {
	const nl = fenceCode.indexOf('\n');
	if (nl < 0) {
		return { lang: '', code: fenceCode };
	}
	return {
		lang: fenceCode.slice(0, nl).trim(),
		code: fenceCode.slice(nl + 1),
	};
}

/**
 * 缩进式代码块的**显示文本**；不是缩进代码块则返回 null。
 *
 * 官方帮助「Basic formatting syntax §Code blocks」把Tab / 4 空格缩进块与围栏块
 * 并列为代码块，但此前只有围栏块有视觉通道：缩进块在显示层被`trimEdges` /
 * 派生 `text`剥掉前导缩进，渲染成一段普通文字（往返仍逐字正确，见
 * `docs/markdown-mindmap-standard.md` 的缩进代码块条目）。
 *
 * 判据（CommonMark）：**首个非空行起**每行都是 `constants.isIndentedCodeLine`
 * （≥4 空格或制表符）或空行，且至少有一行缩进。「首行必须缩进」对应
 * 「缩进代码块不能中断段落」——否则正文里恰好每行都缩进的段落会被误判成代码。
 *
 * 显示文本按 CommonMark **剥离每行 4 空格 / 1 个制表符**（与阅读视图一致）：
 * 只影响显示，回写仍走 `mdRaw`（AGENTS.md 硬规则 4）。
 *
 * 已知边界（**实机取证，勿当 bug 修**）：判据是**节点级**的——解析层
 * `md-outline.classifyLines` **忽略围栏外空行**，故文档里连续的段落/围栏会被合并成
 * **同一个 plain 节点**（实测：一个「标题 + 三段代码块」的文档 = 标题节点 + 一个
 * 含全部内容的 plain 子节点）。于是「正文里夹一段缩进代码」的节点**不会**被整段判为
 * 代码块，仍走普通文本渲染。要在这种情况下也支持，就得在渲染层重跑一遍围栏状态机
 * 来保护围栏内缩进行 —— 那是第二份判定（AGENTS.md 硬规则 5），代价与漂移风险都高于
 * 收益，故**明确不做**。实际覆盖到的是：**整个节点就是一段缩进代码**（把代码块粘进
 * 一个空节点、或整个文件就是一段代码），这正是缩进式代码块在本插件树模型里的常见形态。
 */
function indentedCodeText(raw: string): string | null {
	const lines = raw.split('\n');
	let seenIndented = false;
	for (const line of lines) {
		if (line.trim() === '') {
			continue;
		}
		if (!isIndentedCodeLine(line)) {
			// 首个非空行不缩进 → 段落（可能后续行缩进，但那是段落内的续行）
			return null;
		}
		seenIndented = true;
	}
	if (!seenIndented) {
		return null;
	}
	// 首尾**换行**裁掉（与围栏块 `trimEdges` 的代码块分支同口径：只裁换行、
	// 不裁行内空白——缩进是代码内容）。尾随空行来自原末尾的空行 split 产物。
	return lines
		.map(stripIndentedCodePrefix)
		.join('\n')
		.replace(/^\n+/, '')
		.replace(/\n+$/, '');
}

/** 剥掉一行缩进代码的 4 空格 / 1 制表符前缀（CommonMark 缩进代码块规则） */
function stripIndentedCodePrefix(line: string): string {
	if (line.startsWith('\t')) {
		return line.slice(1);
	}
	return line.startsWith('    ') ? line.slice(4) : line;
}

/**
 * 段序列缓存（**按原文内容寻址**，与节点/引擎实例无关）。
 *
 * 引擎在节点**内容重建**时会为每个自绘节点调用构建器（编辑提交 / 拖宽收尾 /
 * 性能模式强制加载等；纯拖动与缩放**不**重建内容——K58 的 perf 探针实测空
 * render 构建器调用 0 次），而「原文 → 段序列」是纯函数：同一行反复 tokenize
 * + 轻标记切分纯属浪费。
 *
 * 缓存里**只有段序列**（2026-10-09 减法）：接管判定曾附带缓存 `rich` / `hidden`
 * 两个布尔（依赖 `hasRichSegments` / `needsHiddenSyntax` 两个额外正则），现已收敛
 * 为「段序列非空」——判据不再需要额外扫描，两个布尔与那两个函数一并删除。
 * 内容寻址天然避免跨导图实例串味（同一 uid 在不同文件里也不会命中彼此的段）。
 *
 * 淘汰策略是 **LRU**（命中即提升；超限淘汰最旧的一条，而非整表清空）：
 * Map 迭代顺序即插入顺序，最近命中的键被删后重插即回到队尾。
 * 为什么不能整表清空：编辑弹窗的**实时预览**（`inlineContentPreview`）每个
 * 键入都产生一个新键（"a"、"ab"、"abc"…），几十次敲键就能把整张表连同
 * 正在渲染的热点节点一起刷掉——此后每次渲染全部重 tokenize（缓存命中率归零）。
 * 上限用于防御极端输入（大文件里大量互不相同的长行）导致无界增长。
 */
const segmentCache = new Map<string, readonly InlineSegment[]>();
/** 条目数上限（防无界增长；与字符预算双重约束） */
const SEGMENT_CACHE_MAX = 512;
/**
 * 总字符预算（2026-10-02）：条目数上限对「长行键」失效——512 条 × 20k 字符
 * 最坏 ≈20MB（UTF-16）常驻，而数千节点的**顺序全量重建**让 LRU 命中率≈0
 * （--perf 实测 512/512 满仓）。加字符维度后：短行仍按条目数正常复用，
 * 长行由总预算封顶。
 */
const SEGMENT_CACHE_MAX_CHARS = 1_000_000;
/**
 * 单条缓存上限（字符）：超过不缓存——超长行的复用场景（同一行反复重建）
 * 罕见，且一条就会挤掉大量短行热点。
 */
const SEGMENT_CACHE_SINGLE_MAX_CHARS = 32_000;
/** 当前缓存键的字符总量（与 segmentCache 同步增量维护） */
let segmentCacheChars = 0;

/**
 * 取（或构建）该原文的段序列（带 LRU + 双维度预算）。
 * `buildInlineSegments`（渲染）与 `resolveSelfDrawSource`（接管判定）都经此入口。
 */
function segmentEntryOf(raw: string): readonly InlineSegment[] {
	const cached = segmentCache.get(raw);
	if (cached) {
		// LRU 提升：删后重插 → 回到队尾（Map 迭代顺序 = 插入顺序）
		segmentCache.delete(raw);
		segmentCache.set(raw, cached);
		return cached;
	}
	const segments = buildInlineSegmentsUncached(raw);
	// 超长单条不入缓存（预算守卫：一条就会挤掉大量短行热点，且复用场景罕见）
	if (raw.length <= SEGMENT_CACHE_SINGLE_MAX_CHARS) {
		// 淘汰最旧的一条（而非整表清空）：热点条目已由上方命中路径持续刷新到队尾，
		// 被淘汰的只会是长期未命中的键。双重约束：条目数 + 字符总预算。
		while (
			segmentCache.size >= SEGMENT_CACHE_MAX ||
			segmentCacheChars + raw.length > SEGMENT_CACHE_MAX_CHARS
		) {
			// `IteratorResult` 已把 `.next().value` 定到 `string | undefined`，无需断言。
			const oldest = segmentCache.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			segmentCache.delete(oldest);
			segmentCacheChars -= oldest.length;
		}
		segmentCache.set(raw, segments);
		segmentCacheChars += raw.length;
	}
	return segments;
}

/**
 * ## 为什么长文本**绝不能**回落引擎默认 SVG 文本（2026-09-15 实测修订）
 * 引擎 `createTextNode` 的换行是**逐字符**迭代：每加一个字就重新拼接整行
 * （`[...line, ch].join('')`）并**重新测量一次**——单行开销随字数**二次增长**。
 * 无头 Chrome 同机实测：20k 字单行节点走引擎 ≈ **+2.8s**（整轮 1.1s → 3.9s），
 * 同内容走自绘 HTML ≈ **0**（浏览器原生排版，O(n)）。用户实测反馈的「白屏 /
 * 卡死后关闭」正是这条路径（原实现的「超长回落」把最长的行送进最贵的通道）。
 *
 * 故本模块改为：**长文本一并接管 + 截断展示**——超出部分不渲染，但文件与
 * `data.text` 一字不动（双击弹窗看/改全文）。渲染成本由此与文本长度**脱钩**
 * （每节点上界 = 本常量）。截断只影响显示：写回仍走 mdRaw / `data.text`。
 */
export const MAX_INLINE_CONTENT_CHARS = 2000;

/**
 * 行内原文 → 段序列（纯函数，带内容寻址缓存）。
 *
 * 与解析侧同一套 token 口径（`tokenizeInline` + `tokenDisplay`），故链接显示名不会
 * 与节点文本漂移；连续空格折叠为单个（HTML 折叠空白语义，原文由 `mdRaw` 保真），
 * 首尾空白段剔除（plain 行的 `mdRaw` 含前导缩进与行尾空格，不进节点显示）。
 *
 * 返回值**只读**（缓存共享同一数组）：调用方不得就地修改。
 */
export function buildInlineSegments(raw: string): readonly InlineSegment[] {
	return segmentEntryOf(raw);
}

/**
 * 段序列缓存现状（条目数 + 字符总量双维度）。
 *
 * 存在的理由：缓存是**长会话内存**的一个观测点——编辑弹窗的实时预览会以
 * 「每个键入一个新键」冲刷它（见上方 LRU 注释），结构不变式是
 * 「条目数 ≤ `SEGMENT_CACHE_MAX` 且键字符总量 ≤ `SEGMENT_CACHE_MAX_CHARS`」。
 * 该不变式原本只能靠代码审查，现由单测（`tests/node-inline-content.test.ts`
 * 的「规模封顶」「字符预算封顶」例）与 `verify:visual --perf` 的负载块在
 * **真实渲染路径**上直接读。生产代码不读它。
 */
export function segmentCacheStats(): {
	size: number;
	max: number;
	chars: number;
	maxChars: number;
} {
	return {
		size: segmentCache.size,
		max: SEGMENT_CACHE_MAX,
		chars: segmentCacheChars,
		maxChars: SEGMENT_CACHE_MAX_CHARS,
	};
}

/** 段序列构建本体（无缓存；缓存包装见 buildInlineSegments） */
function buildInlineSegmentsUncached(raw: string): InlineSegment[] {
	// 缩进式代码块（CommonMark：≥4 空格 / 制表符起首）：整节点都是代码时走
	// **与围栏块同一个**块级通道（buildCodeBlockElement：底色盒 + 复制按钮 +
	// Prism 高亮——无语言码，故不高亮）。**必须在 token 化与 trimEdges 之前
	// 判定**：那两步都会剥掉前导缩进（显示文本不带缩进），而缩进恰是代码内容。
	const indented = indentedCodeText(raw);
	if (indented !== null) {
		return [{ kind: 'text', text: indented, style: 'code', block: true }];
	}
	const segments: InlineSegment[] = [];
	// 表格块先切出来（见 scanTableBlocks）：无表时这里只有**一个**文本块 ⇒ 与
	// 「直接 tokenize 整段」逐字等价（零成本快路径，既有契约不受影响）
	for (const block of scanTableBlocks(raw)) {
		const table = block.table;
		if (table) {
			segments.push({ kind: 'table', text: block.text, table });
			continue;
		}
		pushInlineText(block.text, segments);
	}
	return trimEdges(segments);
}

/**
 * 一段**不含表格块**的原文 → 行内段（token 循环本体，自 buildInlineSegmentsUncached
 * 逐字搬入）。
 *
 * 快路径（原文无表）＝整段一次调用，与引入表格前的实现完全一致；有表时按块调用
 * （表前 / 表后各一段），链接、轻标记、代码块、数学的切分口径一概不变。
 */
function pushInlineText(raw: string, segments: InlineSegment[]): void {
	let cursor = 0;
	const pushText = (text: string): void => {
		if (!text) {
			return;
		}
		// 轻标记在文本段内部切分（标记符不进显示文本，原文由 mdRaw 保真）。
		// ⚠ 这里**不做**连续空格归一：归一化已下沉到 splitMarkedText 的 prose
		// 分支——预归一化会波及其中的代码块/数学段（缩进被压扁，已修）
		for (const piece of splitMarkedText(text)) {
			segments.push({
				kind: 'text',
				text: piece.text,
				...(piece.style ? { style: piece.style } : {}),
				// display/block 只在对应段型上出现（重建段对象时必须保留，
				// 否则 buildMathElement 拿到"行内形态"、块级代码退化为行内码）
				...(piece.display ? { display: true } : {}),
				...(piece.block ? { block: true } : {}),
				...(piece.lang ? { lang: piece.lang } : {}),
				...(piece.children ? { children: piece.children } : {}),
			});
		}
	};
	for (const tok of tokenizeInline(raw)) {
		pushText(raw.slice(cursor, tok.start));
		cursor = tok.end;
		const segment = linkSegmentOf(tok);
		if (segment) {
			segments.push(segment);
		} else {
			// 图片 token：图片本体走引擎图片通道，段序列只保留剥壳显示名
			pushText(tokenDisplay(tok));
		}
	}
	pushText(raw.slice(cursor));
}

/** 原文的**行切片**（字符区间）：start 含、end 不含（不含行尾 `\n`） */
interface LineSpan {
	start: number;
	end: number;
}

/** 按 `\n` 切行并记录字符区间（末尾换行只产生一个空行切片，不额外加行） */
function splitLineSpans(raw: string): LineSpan[] {
	const spans: LineSpan[] = [];
	let start = 0;
	for (;;) {
		const newline = raw.indexOf('\n', start);
		if (newline < 0) {
			spans.push({ start, end: raw.length });
			return spans;
		}
		spans.push({ start, end: newline });
		start = newline + 1;
	}
}

/**
 * 受**保护区间**：围栏代码块（``` / ~~~）、块级数学（`$$…$$`，可跨行）与
 * `%%…%%` 注释块。
 *
 * 表格识别必须整体绕开它们——文档里作为**示例**的表格行（围栏内）不能被渲染成
 * 真表格，`$$` 块内的 `|` 同理；**注释块同理**（2026-10-15 补：注释在渲染期整段
 * 吞掉，若此处被切成表格段，块内表格会真渲染出来，且两侧 `%%` 因跨块无法配对、
 * 退化成字面文本留在屏上）。
 *
 * 判定**复用 `MARKUP_RE` 源码**（围栏/数学的单一来源，AGENTS.md 硬规则 5）：这里
 * 新建**独立实例**并显式归零 `lastIndex`——`MARKUP_RE` 是模块级共享正则，
 * `splitMarkedText` 的子调用会改写它的 `lastIndex`，直接复用（含 `matchAll` 对
 * 原正则 `lastIndex` 的隐式读取）会从错误位置起扫。
 */
function protectedRanges(raw: string): LineSpan[] {
	const ranges: LineSpan[] = [];
	const scanner = new RegExp(MARKUP_RE.source, MARKUP_RE.flags);
	scanner.lastIndex = 0;
	for (const match of raw.matchAll(scanner)) {
		const groups = match.groups ?? {};
		if (
			groups.fenceCode !== undefined ||
			groups.mathBlock !== undefined ||
			groups.comment !== undefined
		) {
			ranges.push({ start: match.index, end: match.index + match[0].length });
		}
	}
	return ranges;
}

/** 节点内容的块级切片：文本块（原文切片）或表格块（模型 + 原文切片） */
interface ContentBlock {
	kind: 'text' | 'table';
	/**
	 * 源码切片（逐字，含 `\|` 转义与外框管道）。**换行归属**：表格块吃掉与它
	 * 相邻的边界换行（有则吃），文本块不含那个换行 ⇒ 全部块按序拼接仍等于原文
	 * （编辑弹窗预览里表格独占行、不与段落粘连），而渲染侧文本块不带多余换行
	 * （表格是块级元素，换行由它自己承担；渲染不看表格块的 text，DOM 用模型）。
	 */
	text: string;
	table?: PipeTable;
}

/**
 * 原文 → 「文本块 / 表格块」序列（表格之外的原文逐字保留，含换行）。
 *
 * 两条切分纪律：
 * - **换行归属**：表格块吃掉与它相邻的边界换行（见 ContentBlock.text）⇒ 文本块
 *   不带多余换行（多行文本仍靠 `white-space: pre-wrap` 呈现，与引入表格前一致），
 *   而全部块的 text 拼接仍等于原文（编辑弹窗预览里表格独占行）；
 * - 三类行**不参与**表格识别：① 落在 `protectedRanges` 内的行（围栏代码块 /
 *   块级数学）；② 缩进代码行（`isIndentedCodeLine`，对齐解析层「缩进块是代码」
 *   的既有判定）；③ 其余行交给 `domain/pipe-table.matchPipeTable` 判定
 *   （表头行 + 分隔行成对才算表）。
 *
 * 无表时返回**单个文本块 = 整段原文** ⇒ 上层走与引入表格前逐字等价的快路径。
 */
function scanTableBlocks(raw: string): ContentBlock[] {
	// 快路径：整段没有任何管道字符 ⇒ 不可能有表。这一步把「按行切片 + 保护区
	// 扫描（含新建 MARKUP 扫描正则）+ 逐行 `matchPipeTable`」全部省掉——无表
	// 节点是绝大多数（纯文本 / 链接 / 标记），上面「无表时与直接 tokenize 逐字
	// 等价」的零成本承诺至此才是**真的**零成本
	if (!raw.includes('|')) {
		return [{ kind: 'text', text: raw }];
	}
	const lines = splitLineSpans(raw);
	const texts = lines.map((span) => raw.slice(span.start, span.end));
	const protectedSpans = protectedRanges(raw);
	const blocks: ContentBlock[] = [];
	let cursor = 0;
	let protectedIndex = 0;
	for (let index = 0; index < lines.length; ) {
		const line = lines[index];
		if (line === undefined) {
			break;
		}
		// 保护区按起点升序（matchAll 顺序），游标只前进
		let guarded = protectedSpans[protectedIndex];
		while (guarded !== undefined && guarded.end <= line.start) {
			protectedIndex += 1;
			guarded = protectedSpans[protectedIndex];
		}
		if (guarded !== undefined && guarded.start <= line.start) {
			index += 1;
			continue;
		}
		if (isIndentedCodeLine(texts[index] ?? '')) {
			index += 1;
			continue;
		}
		const match = matchPipeTable(texts, index);
		const last = match ? lines[index + match.lineCount - 1] : undefined;
		if (!match || last === undefined) {
			index += 1;
			continue;
		}
		// 表前的文本（**不含**边界换行——那个换行归表格段，见 ContentBlock.text）
		const textEnd = index > 0 ? line.start - 1 : 0;
		if (textEnd > cursor) {
			blocks.push({ kind: 'text', text: raw.slice(cursor, textEnd) });
		}
		// 表格段的切片**含前后边界换行**（有则含）：段序列 text 拼接 = 原文，
		// 预览里表格独占行。渲染不看它（DOM 用模型），故不会多出空行
		// `Math.max(cursor, …)`：边界换行**不得**与前一段重叠——相邻两张表
		//（中间无文本行）时 `line.start - 1` 会落进上一表格段已吃掉的那个换行，
		// 破坏「段序列 text 拼接 == 原文」的不变量（当前不可达：无管道行才断表，
		// 第二张表头会被当数据行吞掉；此处按不变量写死，防将来放宽切分规则）
		const blockStart = Math.max(
			cursor,
			index > 0 ? line.start - 1 : line.start,
		);
		const blockEnd = Math.min(last.end + 1, raw.length);
		blocks.push({
			kind: 'table',
			text: raw.slice(blockStart, blockEnd),
			table: match.table,
		});
		cursor = blockEnd;
		index += match.lineCount;
	}
	if (raw.length > cursor) {
		blocks.push({ kind: 'text', text: raw.slice(cursor) });
	}
	return blocks.length > 0 ? blocks : [{ kind: 'text', text: raw }];
}

/** 链接类 token → 链接段；图片/无链接 token 返回 null */
function linkSegmentOf(tok: InlineToken): InlineSegment | null {
	if (tok.kind === 'wiki' || isLinkEmbed(tok)) {
		// 双链（含指向附件）与**非图片**嵌入（文档 `![[笔记]]` / 附件 `![[报告.pdf]]`）
		// 都是库内链接：target 是**原始 linkpath**（无 [[ ]] 包裹），交给
		// view-wikilink 的 resolveAnchorLink 包回 wikilink 形态。
		// 图片嵌入不进这里（含图节点整体不接管；非首图按显示名占位为文本）
		return {
			kind: 'link',
			text: tokenDisplay(tok),
			link: tok.target,
			internal: true,
		};
	}
	if (tok.kind === 'mdLink') {
		return {
			kind: 'link',
			// 显示名：常规走 tokenDisplay（label 优先，否则目标末段）；label 本身是
			// URL 的形态（`[https://…](https://…)`，复制粘贴常见）显示整个地址
			// ——它在节点文本里本是 icon-only（不显示），方案 B 下还原为可点文本
			text: isUrlLikeText(tok.label) ? tok.label : tokenDisplay(tok),
			link: tok.target,
			// scheme:// 形态（http/obsidian/file/自定义协议）→ 外部锚点；其余按库内
			// 路径处理——与 openHyperlink 的路由口径一致（无 scheme 即走库内解析）
			internal: !isSchemeUrl(tok.target),
		};
	}
	if (tok.kind === 'autolink' || tok.kind === 'bareUrl') {
		// 尖括号 URL / 裸 URL：一律外部地址，显示名即 URL 本体。注意**不能**用
		// tokenDisplay——它对裸 URL 走「目标末段」分支（`https://a.com/x` → `x`），
		// 那是 icon-only 时代「URL 不进节点文本」的剥离口径，不是可读显示名；
		// 还原为可点文本正是方案 B 的目标（长 URL 由 CSS max-width 折行兜底）
		return {
			kind: 'link',
			text: tok.target,
			link: tok.target,
			internal: false,
		};
	}
	return null;
}

/**
 * 嵌入 token 是否为**链接**（而非图片）：`![[…]]` 的目标不是可渲染图片——
 * 文档嵌入 `![[笔记]]` 与附件嵌入 `![[报告.pdf]]` 都按链接处理（与解析侧
 * 「文档/附件嵌入走链接通道、图片嵌入走 image 字段」同口径）。
 */
function isLinkEmbed(tok: InlineToken): boolean {
	return tok.kind === 'wikiImg' && !isRenderableImageTarget(tok.target);
}

/**
 * 剔除首尾空白段（并 trim 首尾文本段的边缘空白），不修改中间内容。
 *
 * **代码块段（block）例外**：只裁边缘**空行**（`\n`），不裁空格/制表——首行前
 * 的缩进与行内对齐是代码内容（```` ```js ```` 块首行常以缩进开头；`^\s+` 会
 * 把 4 空格缩进连同换行一起吞掉，已修）。
 */
function trimEdges(segments: InlineSegment[]): InlineSegment[] {
	const leadingPattern = (segment: InlineSegment): RegExp =>
		segment.style === 'code' && segment.block === true ? /^\n+/ : /^\s+/;
	const trailingPattern = (segment: InlineSegment): RegExp =>
		segment.style === 'code' && segment.block === true ? /\n+$/ : /\s+$/;
	while (segments.length > 0) {
		const first = segments[0]!;
		if (first.kind !== 'text') {
			break;
		}
		const trimmed = first.text.replace(leadingPattern(first), '');
		if (trimmed) {
			segments[0] = { ...first, text: trimmed };
			break;
		}
		segments.shift();
	}
	while (segments.length > 0) {
		const last = segments[segments.length - 1]!;
		if (last.kind !== 'text') {
			break;
		}
		const trimmed = last.text.replace(trailingPattern(last), '');
		if (trimmed) {
			segments[segments.length - 1] = { ...last, text: trimmed };
			break;
		}
		segments.pop();
	}
	return segments;
}

/** 自绘接管的判定输入（`resolveSelfDrawSource` 的内部形态，判定与渲染源同源） */
interface SelfDrawSource {
	segments: readonly InlineSegment[];
	/** 超过展示上限（必须接管，见 MAX_INLINE_CONTENT_CHARS） */
	overlong: boolean;
}

/**
 * 解析节点的**接管判定与渲染源**：返回 null = 不接管（走引擎默认渲染）。
 *
 * 判定的**单一实现**（本函数）：`buildInlineNodeContent`（真的建元素）与
 * 引擎侧「宽度手柄只在能生效的节点上显示」的门禁（`view-node-width`）消费的
 * 都是它的**结果**——后者读运行时事实 `engine.isCustomNodeContent`（节点是否
 * 真的有自绘内容），故两侧天然同源，不会各写一份判定而漂移（手柄留在不接管的
 * 节点上＝死手柄，用户实测 2026-09-16）。
 */
export function resolveSelfDrawSource(node: MindMapNode): SelfDrawSource | null {
	const data = node.getData?.() as Record<string, unknown> | null | undefined;
	if (!data) {
		return null;
	}
	// 含图节点不接管：图片由引擎图片通道渲染，自绘会丢图
	if (readNodeDataString(data, 'image')) {
		return null;
	}
	// 渲染源：未编辑 → mdRaw（含链接语法）；**已编辑 → data.text**——mdRaw 是解析期
	// 快照，用户编辑（引擎编辑框或插件弹窗）后已过期，再按它渲染会显示旧内容
	//（与回写侧 rawOk 的「未编辑」判据同源：text === mdDerivedText）
	const text = readNodeDataString(data, 'text');
	// 「未编辑」判据与回写侧同一实现（domain/md-meta.isNodeTextEdited）
	const edited = isNodeTextEdited(data.text, data.mdDerivedText);
	const raw = edited ? text : readNodeDataString(data, 'mdRaw') || text;
	if (!raw) {
		return null;
	}
	// 注意：**没有**「超长就不接管」这条——超长必须接管（见 MAX_INLINE_CONTENT_CHARS：
	// 引擎逐字符换行是二次复杂度，长行交给它正是白屏/卡死的成因）
	const segments = segmentEntryOf(raw);
	const overlong = raw.length > MAX_INLINE_CONTENT_CHARS;
	// 接管判据（满足其一）：
	// ① **段序列非空**——链接 / 轻标记 / 代码块 / 数学 / **纯文本**全部接管。
	//    为什么纯文本也接管（2026-10-09 起常开；原设置 `selfDrawPlainNodes` 已移除）：
	//    引擎对**不自绘**节点做逐字符文本测宽（`nodeCreateContents.createTextNode`
	//    的逐字符循环 + 每字符一次强制 `getBBox`，实测 ~0.13ms/字符），这是**打开
	//    大图的成本绝对主体**；自绘接管后引擎在 `createNodeData` 提前 return，
	//    测量全部跳过（5000 节点实测：引擎文本 8.6s → 全自绘 1.36s，6.3 倍）。
	//    代价：这类节点失去引擎内联编辑框（引擎对自绘节点静默 no-op），编辑入口
	//    统一走 `features/view-node-actions`（内联编辑器 / 弹窗）。
	// ② **超长**（`overlong`，绝不能交给引擎）：其换行是逐字符二次复杂度，见
	//    MAX_INLINE_CONTENT_CHARS 的实测。
	// 两者都不满足 = **渲染后没有任何可见内容**（空文本 / 纯空白 / 整行只有
	// `%%注释%%`——注释段被整段吞掉、段序列为空）⇒ 交给引擎按字面显示，
	// 避免渲染出一个空节点。
	const takeOver = overlong || segments.length > 0;
	if (!takeOver) {
		return null;
	}
	return { segments, overlong };
}

// 注：曾导出 `shouldSelfDrawNode`（静态判定「将被自绘接管」）供
// 宽度手柄门禁消费；门禁已改用更直接的运行时事实
// （`engine/mindmap.isCustomNodeContent` = 节点是否真的有自绘内容），该静态判定
// 不再有生产消费方，已删除。自绘/不接管的判据单一来源仍是
// `resolveSelfDrawSource`（本文件内部，判定输入只剩节点数据本身）。

/**
 * 展示截断：按段累加到上限即停（超出部分不渲染）。
 *
 * 三条口径：
 * - **链接段要么整枚显示、要么整枚不显示**——半个 `[[目标` 比不显示更糟
 *   （会误导用户以为文件里就是这么写的）；
 * - **表格段「自身超预算」时整张保留**（其余情况仍按预算省略）：老口径「同链接段
 *   ——整张要么显示要么不显示」会让**纯表格**节点在超限时屏上只剩一个 `…`
 *   （1999 字显示整表、2000 字什么都不显示，观感突变且用户会以为内容丢了，
 *   2026-10-15 裁决）。判据取「表格自身的长度 > max」而非「放不下剩余预算」：
 *   后者是正常截断点（前面的文本 + `…` 已是可读的产出），预算约束仍要生效；
 * - 命中上限的文本段**就地切短**（文本本身无语法，切一半是安全的）——该分支会
 *   丢嵌套子段、只保留外层样式，故**不适用于表格段**（切短分支已限定
 *   `kind === 'text'`）。
 *
 * `…` 由本函数在尾部追加，且**只在真的丢过内容时**追加——调用方的超限判定按
 * 「原文长度」（`MAX_INLINE_CONTENT_CHARS`），而可见文本可能并未超限（空格
 * 归一、`%%注释%%` 整段不进段序列、链接段只计显示名），照判据标记截断会让用户
 * 以为内容被裁（假截断）。故 `truncated` 是唯一的标记依据。
 */
interface ClampedSegments {
	segments: readonly InlineSegment[];
	/** 确有内容被丢弃（尾部 `…` / `data-truncated` / 悬停提示都以此为准） */
	truncated: boolean;
}

export function clampSegments(
	segments: readonly InlineSegment[],
	max: number,
): ClampedSegments {
	const out: InlineSegment[] = [];
	let used = 0;
	for (const segment of segments) {
		const length = segment.text.length;
		if (used + length <= max) {
			out.push(segment);
			used += length;
			continue;
		}
		if (segment.kind === 'table' && length > max) {
			// **表格自身**超预算：整张保留（见函数说明）——此后不再渲染任何段，
			// 仍算「被截断」（`…` + 悬停提示照挂）。表格自身在预算内、只是被
			// 前面的内容挤掉时**不走本支**：那属正常截断点，保留预算约束
			out.push(segment);
			out.push({ kind: 'text', text: '…' });
			return { segments: out, truncated: true };
		}
		if (segment.kind === 'text') {
			const keep = max - used;
			if (keep > 0) {
				// 就地切短的段丢掉嵌套子段（children 的文本 ⊆ text，截尾后子段
				// 定位失真）——截断视图退化为外层样式的平文本，可接受
				const { children: _children, ...rest } = segment;
				out.push({ ...rest, text: segment.text.slice(0, keep) });
			}
		}
		// 走到这里必然有内容被丢（整段放不下，或文本段只留下前 keep 个字符）
		// 尾部省略标记：显示为「…」，不参与回写（写回只读 mdRaw / data.text）
		out.push({ kind: 'text', text: '…' });
		return { segments: out, truncated: true };
	}
	// 全部段都放下 ⇒ 没有丢任何内容，不追加标记
	return { segments: out, truncated: false };
}

/**
 * 节点内联内容的**显示文本**（编辑弹窗的「节点将显示为」预览用）。
 *
 * 与自绘渲染同一口径：URL 显示为地址、轻标记剥壳、超长按展示上限截断（含尾部
 * `…`），多行照原样保留。**不要**改用 `buildInlineData(...).text`——那是引擎侧
 * 口径（URL icon-only 不进文本），用它做预览会让用户以为「URL 又消失了」。
 *
 * **表格段**贡献的是**整块原文**（`segment.text`）：表格没有能用一行代表的显示
 * 文本，给原文最诚实，也与此前「未识别表格时」的观感一致（`|` 形态即用户所写）。
 */
export function inlineContentPreview(raw: string): string {
	const segments = buildInlineSegments(raw);
	// 与自绘同一口径：`…` 只在真的丢过内容时出现（见 clampSegments）
	const shown =
		raw.length > MAX_INLINE_CONTENT_CHARS
			? clampSegments(segments, MAX_INLINE_CONTENT_CHARS).segments
			: segments;
	return shown.map((segment) => segment.text).join('');
}

// 注：节点 data 的字符串字段读取已收口到 `core/node-data.readNodeDataString`
// （拆分前的 `node-inline-content.ts` 曾自带 `readString`，是同款第三份实现，
// 2026-10-15 删除；该语句随 `resolveSelfDrawSource` 迁入本模块）。
