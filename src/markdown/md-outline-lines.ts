/**
 * 正文**逐行分类**：把 Markdown 正文切成「标题 / 列表 / 段落」三类带缩进的
 * 行序列，围栏代码块整体原样保留。
 *
 * 从 `md-outline.ts` 拆出（2026-10-22，纯搬移，零行为改动）：
 * 本模块只做「行 → 分类」这一件事，零依赖；行内 token 切分、树形装配仍在
 * `md-outline.ts`。分类规则（含围栏自闭合、setext 与分隔线之分、空列表项）
 * 是往返保真的第一道闸，独立成文件后与 `md-serialize` 的块级规则对照更直接。
 */

/** 标题行：#~###### + 空白 + 文本（`#标题` 无空白不算标题，与 CommonMark/Obsidian 一致；`#` 单独成行亦匹配） */
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
/** 列表项：缩进 + 标记（- * + 或 数字.） + 内容 */
const LIST_RE = /^(\s*)([-*+]|\d+\.)[ \t]+(.*)$/;

interface ParsedLine {
	kind: 'heading' | 'list' | 'plain';
	indent: number;
	text: string;
	/**
	 * 原始行（未 trim）——**仅 plain 行需要**。缩进代码块的前导缩进、行尾两个
	 * 空格的硬换行都是 Markdown 语义，`mdRaw` 必须逐字保存原文才能逐字回写；
	 * `text` 仍是 trim 后的显示文本（行首缩进不该出现在节点文本里）。
	 */
	raw?: string;
	/**
	 * 标题/列表行 **marker 之后**的原文（含行尾空白、不含前导缩进与 marker）。
	 *
	 * `raw` 只对 plain 行有意义（plain 要整行原文）；标题与列表的 `mdRaw` 是
	 * 「标记后的内容」，序列化时前缀由树深度现拼。行尾两空格的硬换行必须
	 * 留在这里，否则第一次编辑就会把它 trim 掉（2026-11-11 实机）。
	 */
	rawContent?: string;
	level?: number;
	marker?: string;
	/** 有序列表项的原编号（`5.` → 5；仅 `marker === 'ordered'` 时有值） */
	orderedNumber?: number;
	/**
	 * 列表项**内容起始列**（缩进 + 标记 + 标记后空白）：项内续行的缩进基准。
	 *
	 * 续行被并入 `mdRaw` 时会 `trimStart`（行首缩进由序列化器按树深度重补），
	 * 绝对缩进就此丢失；而「这一行是不是上一段的续行」在 Markdown 里是**相对**
	 * 内容列判定的（脚注定义的续行、段落懒续行同理）。解析层把相对缩进记进
	 * `MdNodeMeta.mdContinuationIndents`，供渲染层（脚注剥行）复现宿主口径。
	 */
	contentColumn?: number;
	/**
	 * 围栏内（含定界符与相邻空行）：行内容按**代码**处理。
	 *
	 * 围栏里的 `%%rel:…%%` / `%%#hex%%` 是代码，不是指令——解析层据此跳过
	 * 「指令行归属上一节点」的两条分支，否则代码块里的一行会被抽走。
	 */
	fenced?: boolean;
}

/**
 * 围栏分隔行：≤3 空格缩进 + 3+ 个 ` 或 ~（后可接语言信息）；返回分隔符，否则 null。
 *
 * 模块级导出（2026-10-27）：写入侧 `setColorDirective` 也要认「哪一行是围栏定界行」
 * （决定指令能否尾插在同一行）。围栏口径只此一份（硬规则 5），故从 `classifyLines`
 * 的闭包里提出来。
 */
export function fenceMarker(
	raw: string,
): { char: string; length: number } | null {
	const m = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
	if (!m) {
		return null;
	}
	return { char: m[1]![0]!, length: m[1]!.length };
}

/**
 * 缩进单位是否合法：1–8 个空格 / 制表符的任意组合（`'  '` / `'\t'` / `' \t'`）。
 *
 * 解析侧（`noteIndent`）与写入侧（`readIndentUnit`）共用这一份判据：前者过滤
 * 行首空白，后者拒绝脏值。**必须保留混合形态**——`' \t'` 被折成 `'\t'` 会少
 * 一个字符宽，重写后整层左移（2026-11-06）。长度上限 8：更长的前缀多半来自
 * 粘贴或异常文件，不当作层级单位。
 */
export function isValidIndentUnit(value: unknown): value is string {
	return typeof value === 'string' && /^[ \t]{1,8}$/.test(value);
}

/**
 * 有序标记 → 可原样写回的编号（`5.` → 5）。
 *
 * 只收**安全整数**：写入侧按原编号逐字回写（`md-serialize` 的 `mdOrderedNumber`
 * 分支），超出 `Number.MAX_SAFE_INTEGER` 的编号会被 `String(n)` 写成指数形式
 * （`1e+21.`）——那不是列表项，重开时整行退化成段落。这类极端编号（≥ 16 位，
 * 手写文件才会出现）不保真，交回序列化按「前一项 + 1」现算。
 * `0` 是合法起始编号（`0. 甲`），故不排除。
 */
function orderedNumberOf(
	marker: string,
): { orderedNumber: number } | Record<string, never> {
	const value = Number.parseInt(marker, 10);
	return Number.isSafeInteger(value) && value >= 0 ? { orderedNumber: value } : {};
}

/** `classifyLines` 的产物：分类后的行 + 文档自己的列表缩进单位 */
export interface ClassifiedLines {
	lines: ParsedLine[];
	/**
	 * 文档列表层级的**缩进单位**（实测；`null` = 全文没有缩进列表，无可测信息）。
	 *
	 * 取**第一处有缩进的列表行**的前导空白**原样**（合法形态见
	 * `isValidIndentUnit`）：它只描述「一层有多宽」，供序列化按原文风格重写
	 * 缩进。两层写法不一致（2 空格 + 4 空格）时按第一层归一。
	 */
	indentUnit: string | null;
}

/** 围栏状态：分隔符字符 / 长度 / **定界符所在列**（闭合按相对列判定） */
export interface FenceBoundary {
	char: string;
	length: number;
	column: number;
}

/**
 * 围栏闭合行判定（**唯一实现**：`classifyLines` / `node-inline-tokenize` /
 * `md-footnote` 共用）。
 *
 * CommonMark 的相对口径：闭合串同字符、长度不小于开串，缩进**不超过**定界符
 * 所在列 3 列以上（可以更少），且行尾只剩空白。列表项内的定界符本就在第 4 列，
 * 用绝对 ≤3 空格判定会永远认不出闭合（2026-11-09 实机：后续节点被吞进代码）。
 *
 * **闭合行允许比开栏缩进更少**（2026-11-12 修正）：`  ```js` 开在第 2 列、
 * 闭合行顶格是手写文件的常见排法，此前要求 `closeIndent >= fence.column` 会
 * 认不出闭合，围栏状态永不退出、其后兄弟节点 / 标题整段被吞进代码内容
 * （与 2026-11-09 同类，只是触发形态换成「闭合比开栏浅」）。
 */
export function isFenceCloseLine(
	rawLine: string,
	fence: FenceBoundary,
): boolean {
	const closeIndent = leadingIndent(rawLine);
	const closeMarker = rawLine.slice(closeIndent).match(/^(`{3,}|~{3,})/);
	if (!closeMarker) {
		return false;
	}
	const marker = closeMarker[1]!;
	return (
		marker[0] === fence.char &&
		marker.length >= fence.length &&
		closeIndent <= fence.column + 3 &&
		/^[ \t]*$/.test(rawLine.slice(closeIndent + marker.length))
	);
}

/**
 * 开围栏行是否在**同一行内自闭合**（```` ```code``` ````）：
 * 去掉开围栏后的余文以同字符、不小于开围栏长度的连续串结尾。
 *
 * 此类行是「一行的围栏」，**不进入围栏状态**——否则围栏永不闭合，后续行被
 * 整段吞进代码内容（2026-09-28 修）。**唯一实现**：`classifyLines` 与
 * `md-footnote` 的索引/剥离共用（渲染侧 `node-inline-tokenize` 亦调本函数）。
 */
export function isSelfClosedFenceLine(
	restAfterMarker: string,
	char: string,
	length: number,
): boolean {
	const run = char === '~' ? '~' : '`';
	// 纯字符串扫描，等价于 `${run}{${length},}[ \t]*$`：run 只有两个取值、
	// length 取值域很小，而本函数**每个围栏行**都会调用——为它每行新建并
	// 编译一个正则不值得。先剥行尾空白，再数行尾连续同字符的个数
	let end = restAfterMarker.length;
	while (end > 0) {
		const code = restAfterMarker.charCodeAt(end - 1);
		if (code !== 0x20 /* 空格 */ && code !== 0x09 /* 制表符 */) {
			break;
		}
		end -= 1;
	}
	let count = 0;
	while (end > 0 && restAfterMarker[end - 1] === run) {
		count += 1;
		end -= 1;
	}
	return count >= length;
}

/** 逐行分类（围栏整体原样保留；围栏外空行与分隔线忽略） */
export function classifyLines(body: string): ClassifiedLines {
	const out: ParsedLine[] = [];
	const rawLines = body.split(/\r?\n/);
	/**
	 * 当前围栏：分隔符字符 / 长度 / **定界符所在列**（`column`）。null = 不在围栏内。
	 *
	 * `column` 是闭合判据的基准（2026-11-09 修）：列表项内的围栏（`  - ```js`）
	 * 其定界符在**第 4 列**，内容与闭合行同样缩进 4 列；而 `fenceMarker` 只认
	 * ≤3 空格（CommonMark 的「相对定界符 ≤3」被误读成绝对值）⇒ 闭合行永远认不出、
	 * 围栏状态永不退出，**其后的兄弟节点 / 标题整段被吞进代码内容**。闭合行改为
	 * 按「开列 −0/+3」（CommonMark 的相对口径，闭合行可以更浅）。
	 */
	let fence: { char: string; length: number; column: number } | null = null;
	/** 上一条输出行是否属于围栏块（决定后续空行是否保留为分隔） */
	let lastLineIsFence = false;
	/** 围栏外暂存的连续空行：仅当与围栏相邻时才写入（保证围栏仍可识别） */
	let pendingBlank = 0;
	/** 缩进单位（见 ClassifiedLines.indentUnit）：只认第一处有缩进的列表行 */
	let indentUnit: string | null = null;
	/** 记录第一处合法缩进（一旦测到就不再改：混用缩进按第一层归一） */
	const noteIndent = (prefix: string): void => {
		if (indentUnit === null && isValidIndentUnit(prefix)) {
			indentUnit = prefix;
		}
	};

	const pushRaw = (raw: string, indent = leadingIndent(raw)): void => {
		// 与 plain 分支同口径（Tab 计 1）：围栏块要按缩进并入所属列表项。
		// `fenced` 标记供解析层区分「代码内容」与真正的指令行（见 ParsedLine）。
		out.push({
			kind: 'plain',
			indent,
			text: raw,
			raw,
			fenced: true,
		});
	};

	for (let i = 0; i < rawLines.length; i++) {
		const rawLine = rawLines[i]!;

		// —— 围栏内：内容逐行原样保留（空行/缩进/类标题列表行都是代码内容）——
		if (fence) {
			// **按定界符所在列计入缩进**（不是本行自己的缩进）：围栏块是一个整体，
			// 闭合行/内容行可以比定界符更浅（CommonMark 只限定「不超过 +3」）。
			// 用本行缩进会让顶格闭合行掉出所属列表项、单独变成一个节点
			// （2026-11-12：`  ```js` + 顶格 ` ```` ` 的文件因此多出一个 ` ``` ` 节点）。
			pushRaw(rawLine, fence.column);
			lastLineIsFence = true;
			// 闭合判定只此一份（`isFenceCloseLine`，md-footnote 共用）
			if (isFenceCloseLine(rawLine, fence)) {
				fence = null;
			}
			continue;
		}

		if (!rawLine.trim()) {
			// 空行暂存：是围栏相邻分隔时才保留，段落间仍忽略（维持既有规范化）
			pendingBlank++;
			continue;
		}

		// —— 围栏开始（``` / ~~~ 行；含语言信息的 ```js 亦为开始）——
		const open = fenceMarker(rawLine);
		if (open) {
			// 围栏前空行属于围栏块：写入后围栏仍可被识别
			while (pendingBlank > 0) {
				pushRaw('');
				pendingBlank--;
			}
			// 同行自闭合（```code```）不进入围栏状态（见 isSelfClosedFenceLine）
			const restAfterMarker = rawLine.slice(
				rawLine.indexOf(open.char) + open.length,
			);
			if (!isSelfClosedFenceLine(restAfterMarker, open.char, open.length)) {
				fence = {
					...open,
					// 定界符所在列（本路径下 ≤3）：闭合行按它 ±3 判定
					column: Math.max(0, rawLine.indexOf(open.char)),
				};
			}
			pushRaw(rawLine);
			lastLineIsFence = true;
			continue;
		}

		const line = rawLine.trimEnd();
		// 围栏闭合后的空行保留（避免围栏块与下文粘连成同一多行文本）
		if (lastLineIsFence && pendingBlank > 0) {
			while (pendingBlank > 0) {
				pushRaw('');
				pendingBlank--;
			}
		}
		lastLineIsFence = false;
		// 段落/标题/列表前的空行一律丢弃（维持既有规范化）——
		// 不能留到后续围栏处再 flush，否则空行会累积、每次往返多一行
		pendingBlank = 0;
		// 纯短横线行（`---` / `-----`）的两种身份必须分开：
		// - **空行之后** → 结构分隔信号（thematic break），按既定行为整行丢弃；
		// - **紧跟非空行之后** → CommonMark 的 **setext H2 下划线**（`标题\n---` 是二级
		//   标题），丢弃会静默把标题降级为段落 → 必须保留该行（见 docs/markdown-mindmap-standard §2.1）。
		// 注：`=====`（setext H1）从不匹配本分支，一直保留；两条 setext 形态由此对齐。
		const isDashLine = /^\s*---+\s*$/.test(line);
		if (isDashLine && !(i > 0 && rawLines[i - 1]!.trim() !== '')) {
			continue;
		}
		const h = line.match(HEADING_RE);
		if (h) {
			const text = (h[2] ?? '').trim();
			// 空标题（`#` / `# `）保留为空文本节点（2026-09-25，零丢失口径；空列表项
			// 自 2026-09-28 起同样保留为空 list 节点，见下方 emptyList 分支）：此前
			// 丢弃会让该行在保存后消失。引擎对空文本节点有既有先例（图片独占 /
			// URL icon-only 子节点），序列化经前缀 `#×N ` 合成输出 `## `
			//（尾随空格由前缀携带），往返为不动点。
			out.push({
				kind: 'heading',
				indent: 0,
				text,
				level: h[1]!.length,
				// 取 marker 后的原文：`line` 已 trimEnd，行尾空格要从 rawLine 补回
				rawContent:
					h[2] === undefined ? '' : rawLine.slice(line.length - h[2].length),
			});
			continue;
		}
		const l = line.match(LIST_RE);
		if (l) {
			const text = l[3]!.trim();
			noteIndent(l[1]!);
			if (text) {
				const ordered = /^\d+\.$/.test(l[2]!);
				out.push({
					kind: 'list',
					indent: l[1]!.length,
					text,
					marker: ordered ? 'ordered' : l[2],
					// marker 后的原文（含行尾空白）：`line` 已 trimEnd，从 rawLine 补回
					rawContent: rawLine.slice(line.length - (l[3]?.length ?? 0)),
					// 内容起始列（相对缩进的基准，见 ParsedLine.contentColumn）
					contentColumn: line.length - (l[3]?.length ?? 0),
					// 原编号随行保留：序列化优先用它（否则 `5.` 会被重排成 `1.`）
					...(ordered ? orderedNumberOf(l[2]!) : {}),
				});
				// 列表项文本以围栏开始（```js）：项内即围栏——置围栏状态，让续行
				// 走「围栏内容」分支逐字保留、闭合行正确**闭合**。此前围栏状态不
				// 感知列表项，闭合行（缩进 ≤3 仍匹配 fenceMarker）被误判为**新
				// 围栏的开始**，后续标题/节点被整段吞进代码内容（2026-09-28 修）。
				// 同行自闭合（```code```）不置状态。
				const openInList = text.match(/^(`{3,}|~{3,})/);
				if (openInList) {
					const marker = openInList[1]!;
					const rest = text.slice(marker.length);
					if (!isSelfClosedFenceLine(rest, marker[0]!, marker.length)) {
						fence = {
							char: marker[0]!,
							length: marker.length,
							// 列表项内的定界符在第 indent + marker + 空格 列：闭合行
							// （与内容同列）必须能认出来，见 fence 变量注释
							column: Math.max(0, rawLine.indexOf(marker[0]!)),
						};
					}
				}
			}
			continue;
		}
		// 空列表项（marker 后有空白、无内容：`- ` / `1. `）：保留为**空 list 节点**
		// （2026-09-28 方案 B，K93）。判据必须用 **trimEnd 前的 rawLine**：上方
		// `const line = rawLine.trimEnd()` 已去掉行尾空白，`line` 里的 `- ` 只剩裸
		// `-`（CommonMark 口径「marker 后无空白不是列表项」，裸 `-` 仍落 plain）；
		// 不看 rawLine 就无法与裸 marker 区分（LIST_RE 也因此匹配不到空项）。
		// 空文本节点在链路上有既有先例（空标题 / 图片独占 / URL icon-only）；
		// 序列化按 marker + 空内容输出 `- ` ⇒ 往返为不动点
		//（docs/markdown-mindmap-standard.md §3.6 白名单 #6）。
		const emptyList = rawLine.match(/^(\s*)([-*+]|\d+\.)[ \t]+$/);
		if (emptyList) {
			noteIndent(emptyList[1]!);
			const ordered = /^\d+\.$/.test(emptyList[2]!);
			out.push({
				kind: 'list',
				indent: emptyList[1]!.length,
				text: '',
				marker: ordered ? 'ordered' : emptyList[2],
				...(ordered ? orderedNumberOf(emptyList[2]!) : {}),
			});
			continue;
		}
		out.push({
			kind: 'plain',
			// **缩进必须与列表项同口径**（空格 / 制表符各计 1 字符）：`LIST_RE` 的
			// 缩进捕获是 `(\s*)`（Tab 计 1），此处若只数空格，Tab 缩进文件的列表项
			// indent ≥ 1、其续行与围栏块 indent 恒为 0 ⇒「续行缩进大于列表项」永不
			// 成立 ⇒ 项内围栏被拆成同级节点、后续兄弟整层错位（2026-11-04 实机：
			// Tab 缩进的 `07 富内容.md` 加载即被拆平，保存后 4 个分支错位）。
			indent: leadingIndent(line),
			text: line.trim(),
			// 原文（含前导缩进与行尾空格）供 mdRaw 逐字回写：缩进代码块的前导缩进、
			// 「行尾两空格 = 硬换行」都是 Markdown 语义，trim 掉就等于改动文件
			raw: rawLine,
		});
	}
	return { lines: out, indentUnit };
}

/**
 * 行首缩进**字符数**（空格与制表符各计 1）——与 `LIST_RE` 的 `(\s*)` 捕获同口径。
 *
 * 只用于**续行 / 围栏块归层**判定（`plain.indent`）：这些行要与列表项 indent
 * 比较大小，两者必须同一把尺子。`leadingSpaces` 另有用途（frontmatter 块标量
 * 的缩进判定只认空格），不要合并。
 *
 * 不导出：唯一消费者是本文件的 `classifyLines`（`check:dead-code` 会把无主导出
 * 当失败）。行为由 `md-roundtrip.test.ts` 的 Tab 缩进用例覆盖。
 */
function leadingIndent(line: string): number {
	let n = 0;
	while (n < line.length && (line[n] === ' ' || line[n] === '\t')) {
		n++;
	}
	return n;
}

/**
 * 行首**空格**数（制表符不计——它不是列表缩进的尺子，而是 YAML 块标量的尺子）。
 *
 * 唯一消费者是 `splitFrontmatter` 的块标量缩进判定：YAML 的块标量缩进必须是
 * 空格，Tab 在那里本就不合法。**列表归层请用 `leadingIndent`**（Tab 计 1，
 * 与 `LIST_RE` 的 `\s*` 同口径），两者不可互换。
 */
export function leadingSpaces(line: string): number {
	let n = 0;
	while (n < line.length && line[n] === ' ') {
		n++;
	}
	return n;
}
