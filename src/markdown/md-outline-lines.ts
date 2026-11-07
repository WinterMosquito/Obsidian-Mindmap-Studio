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
	level?: number;
	marker?: string;
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

/** 逐行分类（围栏整体原样保留；围栏外空行与分隔线忽略） */
export function classifyLines(body: string): ClassifiedLines {
	const out: ParsedLine[] = [];
	const rawLines = body.split(/\r?\n/);
	/** 当前围栏（分隔符字符与长度）；null = 不在围栏内 */
	let fence: { char: string; length: number } | null = null;
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

	/**
	 * 开围栏行是否在**同一行内自闭合**（```` ```code``` ````）：
	 * 去掉开围栏后的余文以同字符、不小于开围栏长度的连续串结尾。
	 * 此类行是「一行的围栏」，**不进入围栏状态**——否则围栏永不闭合，
	 * 后续行被整段吞进代码内容（2026-09-28 修）。
	 */
	const selfClosed = (
		restAfterMarker: string,
		char: string,
		length: number,
	): boolean => {
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
	};

	const pushRaw = (raw: string): void => {
		// 与 plain 分支同口径（Tab 计 1）：围栏块要按缩进并入所属列表项
		out.push({ kind: 'plain', indent: leadingIndent(raw), text: raw, raw });
	};

	for (let i = 0; i < rawLines.length; i++) {
		const rawLine = rawLines[i]!;

		// —— 围栏内：内容逐行原样保留（空行/缩进/类标题列表行都是代码内容）——
		if (fence) {
			pushRaw(rawLine);
			lastLineIsFence = true;
			// 闭合：同字符、长度 ≥ 起始，行尾无其他内容
			const close = fenceMarker(rawLine);
			if (
				close &&
				close.char === fence.char &&
				close.length >= fence.length &&
				/^[ \t]*$/.test(rawLine.slice(rawLine.indexOf(close.char) + close.length))
			) {
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
			// 同行自闭合（```code```）不进入围栏状态（见 selfClosed）
			const restAfterMarker = rawLine.slice(
				rawLine.indexOf(open.char) + open.length,
			);
			if (!selfClosed(restAfterMarker, open.char, open.length)) {
				fence = open;
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
			out.push({ kind: 'heading', indent: 0, text, level: h[1]!.length });
			continue;
		}
		const l = line.match(LIST_RE);
		if (l) {
			const text = l[3]!.trim();
			noteIndent(l[1]!);
			if (text) {
				out.push({
					kind: 'list',
					indent: l[1]!.length,
					text,
					marker: /^\d+\.$/.test(l[2]!) ? 'ordered' : l[2],
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
					if (!selfClosed(rest, marker[0]!, marker.length)) {
						fence = { char: marker[0]!, length: marker.length };
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
			out.push({
				kind: 'list',
				indent: emptyList[1]!.length,
				text: '',
				marker: /^\d+\.$/.test(emptyList[2]!) ? 'ordered' : emptyList[2],
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
