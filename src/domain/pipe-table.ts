/**
 * GFM 管道表（pipe table）的**识别与切分**：纯字符串逻辑，零依赖。
 *
 * ## 为什么在 domain
 * 本模块只回答两件事：「从第 N 行起是不是一张表」与「表长什么样」（列数 / 对齐 /
 * 单元格显示文本）。DOM 装配与内联样式在 `features/node-inline-content`；**围栏
 * 代码块的排除也在那一侧**——围栏判定的唯一来源是显示层的 `MARKUP_RE`（AGENTS.md
 * 硬规则 5：不造第二份判定），本模块不重复实现。
 *
 * ## 口径（官方帮助「Advanced formatting syntax §Tables」+ GFM 管道表）
 * - **表头行 + 分隔行**构成一张表，两行列数必须相等；
 * - 分隔行必须含**至少一个未转义的 `|`**：这一条同时把 `标题\n---`（setext H2）
 *   与 `---` 分隔线排除在外——它们归属解析层既有语义（`markdown/md-outline` 的
 *   `isDashLine`），绝不会被当成「单列表」；
 * - 外框管道可有可无（帮助明写 "the vertical bars on either side of the table are
 *   optional"）；
 * - 单元格内的 `|` 必须写 `\|`（帮助「Vertical bars in tables」：别名与图片缩放
 *   场景都如此），故**切分只发生在未转义的 `|` 上**，并把 `\|` 还原为字面 `|`
 *   ——这是**显示口径**，回写仍由 `mdRaw` 逐字保真（AGENTS.md 硬规则 4）；
 * - 数据行在**空行**或**不含未转义 `|` 的行**处结束（比 GFM 严的收敛口径：无管道
 *   的续行不并进表格，避免把随后段落吃成一行）；列数不足补空、超出截断（GFM 同）。
 *
 * ## 已知边界（有意，勿当缺陷）
 * - 单元格内不支持块级内容（表格嵌表格 / 多行单元格）——GFM 同样不支持；
 * - 只还原 `\|`：其余转义（`\*` 等）原样留在单元格文本里，由行内管线解释
 *   （那是 `MARKUP_RE` 的职责，此处再解一次即第二份判定）；
 * - 不识别「无表头」形态（`|---|` 起首）：GFM 亦要求表头行在前。
 */

/**
 * 列对齐（`null` = 分隔行未指定）。
 *
 * `null` 的含义是「用户没指定」⇒ 渲染层**不写** `text-align`，交给宿主与浏览器
 * 默认（表头居中、单元格左对齐）。这不是自创口径：官方样式包里没有
 * `th { text-align }` 规则（`resources/*.asar` 实测零命中），阅读视图同一个默认。
 */
export type PipeTableAlign = 'left' | 'center' | 'right' | null;

/** 一张管道表的**显示模型**（单元格文本已 trim、`\|` 已还原为 `|`） */
export interface PipeTable {
	/** 表头单元格（长度 = 列数） */
	header: readonly string[];
	/** 数据行（每行长度已按列数归一：不足补空串、超出截断） */
	rows: readonly (readonly string[])[];
	/** 每列对齐（长度 = 列数） */
	align: readonly PipeTableAlign[];
}

/** `matchPipeTable` 的命中结果：模型 + 该表占用的行数（供块扫描推进游标） */
export interface PipeTableMatch {
	table: PipeTable;
	lineCount: number;
}

/**
 * 分隔行单元格：1 个以上 `-`，两侧可有 `:`（`:---` / `---:` / `:---:`）。
 * 反引号/字母/空格都不合法——`|---|` 之外的任何形态都不构成分隔行。
 */
const DELIMITER_CELL_RE = /^:?-+:?$/;

/**
 * 从 `lines[start]` 起识别一张管道表；不是表返回 null。
 *
 * 判据见文件头。`lineCount` 含表头行与分隔行（= 2 + 数据行数），供块扫描一次性
 * 推进——调用方不得只推进 1 行，否则数据行会被当成新的表头重复扫描。
 */
export function matchPipeTable(
	lines: readonly string[],
	start: number,
): PipeTableMatch | null {
	const header = splitPipeRow(lines[start] ?? '');
	const delimiter = splitPipeRow(lines[start + 1] ?? '');
	// `splitPipeRow` 返回 null = 该行不含未转义管道。对**分隔行**而言这就是
	// 「不是表」的判据（`标题\n---` 的 `---`、`***`、`___` 一律走这里返回 null）
	if (!header || !delimiter) {
		return null;
	}
	if (header.length !== delimiter.length) {
		return null;
	}
	// 全空表头（`| | |` + `| --- | --- |`）不算表：没有可显示的列名，
	// 只会在节点里凭空多出一个空表格
	if (header.every((cell) => cell === '')) {
		return null;
	}
	const align: PipeTableAlign[] = [];
	for (const cell of delimiter) {
		const column = delimiterAlignOf(cell);
		if (column === undefined) {
			return null;
		}
		align.push(column);
	}
	const rows: string[][] = [];
	for (let index = start + 2; index < lines.length; index++) {
		const line = lines[index] ?? '';
		if (line.trim() === '') {
			break;
		}
		const cells = splitPipeRow(line);
		if (!cells) {
			break;
		}
		rows.push(normalizeRow(cells, header.length));
	}
	return { table: { header, rows, align }, lineCount: 2 + rows.length };
}

/**
 * 一行 → 单元格数组（未转义 `|` 处切分；外框管道丢弃；每格 trim）。
 * 不含未转义 `|` 时返回 null（= 不是表格行）。
 */
function splitPipeRow(line: string): string[] | null {
	const cells: string[] = [];
	let current = '';
	let sawPipe = false;
	for (let index = 0; index < line.length; index++) {
		const char = line[index] ?? '';
		if (char === '\\') {
			const next = line[index + 1] ?? '';
			// `\|` → 字面 `|`：帮助的写法（别名 `[[X\|别名]]`、图片缩放 `![[x.png\|200]]`）
			if (next === '|') {
				current += '|';
				index += 1;
				continue;
			}
			// `\\` 成对跳过：否则 `a\\|b` 里的 `\\` 会被读成转义、其后的 `|` 不再切分。
			// 两字符原样保留——`\\` → `\` 是行内管线（MARKUP_RE 的 escaped 分支）的事
			if (next === '\\') {
				current += '\\\\';
				index += 1;
				continue;
			}
			current += char;
			continue;
		}
		if (char === '|') {
			sawPipe = true;
			cells.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	if (!sawPipe) {
		return null;
	}
	cells.push(current);
	// 外框管道（帮助：可有可无）：只在原文确实以该管道起止时丢弃切出来的空串，
	// 否则 `| a | | b |` 这类「空格单元格」会被误删
	if (line.trimStart().startsWith('|') && (cells[0] ?? '').trim() === '') {
		cells.shift();
	}
	const last = cells[cells.length - 1];
	if (line.trimEnd().endsWith('|') && last !== undefined && last.trim() === '') {
		cells.pop();
	}
	return cells.map((cell) => cell.trim());
}

/**
 * 分隔行单元格 → 列对齐；**不是**合法分隔单元格时返回 undefined
 *（= 整行不是分隔行 ⇒ 上层直接判定「不是表」）。
 */
function delimiterAlignOf(cell: string): PipeTableAlign | undefined {
	if (!DELIMITER_CELL_RE.test(cell)) {
		return undefined;
	}
	const left = cell.startsWith(':');
	const right = cell.endsWith(':');
	if (left && right) {
		return 'center';
	}
	if (left) {
		return 'left';
	}
	if (right) {
		return 'right';
	}
	return null;
}

/** 数据行 → 列数归一（不足补空串、超出截断；GFM：数据行不必写满列数） */
function normalizeRow(cells: readonly string[], columns: number): string[] {
	const row = cells.slice(0, columns);
	while (row.length < columns) {
		row.push('');
	}
	return row;
}
