/**
 * 任务列表行（GFM task list item）的**唯一**解析 / 合成实现。
 *
 * ## 语义与保真的分界
 * `- [ ] 写周报` 的 `[ ]` 在 Markdown 里是**列表项正文的前缀**（`- ` 之后的内容），
 * 不是列表标记的一部分（列表标记是 `-`）。因此：
 * - `mdRaw` **保留**原文（含 `[ ]`），未编辑行才能逐字回写；
 * - `text` / `mdDerivedText` **剥掉** token（显示文本 = `写周报`），两者必须**一起**
 *   剥——只剥其一会让每个任务节点在加载时就被判成「已编辑」，保存时整行被合成
 *   （`md-serialize.rawOk` 的唯一判据是 `text === mdDerivedText`）；
 * - `mdTaskToken` 记**原样** token（大小写不归一：`[X]` 写回仍是 `[X]`）。
 *
 * ## 识别口径
 * - 只认**行首** `[ ]` / `[x]` / `[X]`，且其后必须是空白或行尾（GFM 要求，
 *   `[ ]foo` 不是任务）；
 * - 调用方**必须**先确认该行是列表项（`mdType === 'list'`）：标题/段落行里
 *   同样形态的 `[ ]` 是普通文字，不参与本模块。
 *
 * ## 为什么单独成文件
 * 解析侧（`markdown/md-outline`）、原文写回侧（`markdown/md-line-write`）、
 * 拆分回写侧（`markdown/links-split`）与交互侧（`features/view-node-task`）都要
 * 用同一套判定与合成；散落在四处必然漂移（硬规则 5）。
 */

/** 任务状态（勾选与否） */
export type TaskState = 'todo' | 'done';

/** 行首任务前缀：状态 + **原样** token（合成时逐字还原） */
export interface TaskPrefix {
	state: TaskState;
	token: string;
}

/** 行首 token（不消费后续空白；lookahead 要求其后是空白或行尾） */
const TASK_PREFIX_RE = /^\[([ xX])\](?=[ \t]|$)/;

/** 派生显示文本里的前缀（空白可能已被归一，故这里吞掉紧随的空白） */
const TASK_DISPLAY_PREFIX_RE = /^\[[ xX]\][ \t]*/;

/**
 * 读出行首任务前缀；不是任务行返回 null。
 *
 * @param rawLine 原始行（**含** token；调用方已确认是列表项）
 */
export function parseTaskPrefix(rawLine: string): TaskPrefix | null {
	const match = TASK_PREFIX_RE.exec(rawLine);
	if (!match) {
		return null;
	}
	const mark = match[1]!;
	return { state: mark === ' ' ? 'todo' : 'done', token: `[${mark}]` };
}

/**
 * 从**派生显示文本**里剥掉任务前缀。
 *
 * 只应在 `parseTaskPrefix(rawLine)` 已命中的前提下调用：它按文本形态剥离，
 * 不重新判定（`\[ ]` 这类转义形态在 raw 侧就不会命中）。
 */
export function stripTaskPrefix(displayText: string): string {
	return displayText.replace(TASK_DISPLAY_PREFIX_RE, '');
}

/**
 * 切换 token：未完成 ↔ 完成。
 *
 * `[x]` 与 `[X]` 都算完成；切回未完成统一写 `[ ]`（CommonMark 只定义空格形态）。
 */
export function toggleTaskToken(token: string): string {
	return token === '[ ]' ? '[x]' : '[ ]';
}

/** 合成首行：`[ ]` + 空格 + 正文；正文为空时不留尾随空格 */
export function withTaskPrefix(token: string, body: string): string {
	if (!body) {
		return token;
	}
	return `${token} ${body}`;
}

/** 只替换**一行**的行首 token（不是任务行则原样返回；外部请用 setTaskTokenInRaw） */
function replaceTaskToken(line: string, token: string): string {
	const match = TASK_PREFIX_RE.exec(line);
	if (!match) {
		return line;
	}
	return token + line.slice(match[0].length);
}

/** 多行原文：只替换**首行**的行首 token（续行原样） */
export function setTaskTokenInRaw(raw: string, token: string): string {
	const newline = raw.indexOf('\n');
	if (newline < 0) {
		return replaceTaskToken(raw, token);
	}
	return replaceTaskToken(raw.slice(0, newline), token) + raw.slice(newline);
}
