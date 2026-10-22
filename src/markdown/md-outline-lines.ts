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

/** 逐行分类（围栏整体原样保留；围栏外空行与分隔线忽略） */
export function classifyLines(body: string): ParsedLine[] {
	const out: ParsedLine[] = [];
	const rawLines = body.split(/\r?\n/);
	/** 当前围栏（分隔符字符与长度）；null = 不在围栏内 */
	let fence: { char: string; length: number } | null = null;
	/** 上一条输出行是否属于围栏块（决定后续空行是否保留为分隔） */
	let lastLineIsFence = false;
	/** 围栏外暂存的连续空行：仅当与围栏相邻时才写入（保证围栏仍可识别） */
	let pendingBlank = 0;

	/**
	 * 围栏分隔行：≤3 空格缩进 + 3+ 个 ` 或 ~（后可接语言信息）。
	 * 返回分隔符；不匹配返回 null。
	 */
	const fenceMarker = (raw: string): { char: string; length: number } | null => {
		const m = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
		if (!m) {
			return null;
		}
		return { char: m[1]![0]!, length: m[1]!.length };
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
		out.push({ kind: 'plain', indent: leadingSpaces(raw), text: raw, raw });
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
			indent: leadingSpaces(line),
			text: line.trim(),
			// 原文（含前导缩进与行尾空格）供 mdRaw 逐字回写：缩进代码块的前导缩进、
			// 「行尾两空格 = 硬换行」都是 Markdown 语义，trim 掉就等于改动文件
			raw: rawLine,
		});
	}
	return out;
}

/**
 * 行首空格数（制表符不计，与 `LIST_RE` 的 `\s*` 缩进口径分开表达）。
 *
 * 与 `splitFrontmatter` 的块标量缩进判定共用，故随分类逻辑一并搬出并导出。
 */
export function leadingSpaces(line: string): number {
	let n = 0;
	while (n < line.length && line[n] === ' ') {
		n++;
	}
	return n;
}
