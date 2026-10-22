/**
 * 合成路径的**行内锚点定位**：把「无显示名 token」插回原文位置所需的三件套。
 *
 * 从 `md-serialize.ts` 拆出（2026-10-22，纯搬移，零行为改动）：
 * - `inLinkSyntax`：命中位置是否落在用户手输的链接语法内部（⇒ 退化为尾插）；
 * - `anchorInsertPoint`：按解析期记下的左右邻文字反查插入点（邻接一致性三约束）；
 * - `insertionForm`：按 `padLead` / `padTrail` 补回原文的分隔空白。
 *
 * 三者是**同一条判定链**：`anchorInsertPoint` 产出的 `padLead/padTrail` 只有
 * `insertionForm` 消费，任一处单独改动都会让占用区间与空白补回失配，故必须同文件。
 * 依赖只有 `MdTokenSegment` 类型（`domain/md-meta`），无运行时依赖。
 */
import type { MdTokenSegment } from '../domain/md-meta';

/**
 * 命中的显示名是否落在**用户手输的链接语法内部**（`[[…]]` / `[text](…)`）。
 *
 * 这种文本语义上更接近「换链」而非「原位保留」：原位替换会写出
 * `[[新[[目标]]]]` 这类畸形嵌套（用户手输 `[[新目标]]` + 节点自身链接 ⇒ 期望
 * `[[新目标]] [[目标]]`），故退化为尾插（旧行为）。
 */
export function inLinkSyntax(text: string, start: number, length: number): boolean {
	const before = start > 0 ? text[start - 1] ?? '' : '';
	const after = text[start + length] ?? '';
	return /[[\]()]/.test(before) || /[[\]()]/.test(after);
}

/**
 * 无显示名段的**插入点**（见 `domain/md-meta` 「无显示名段的锚点」）：在编辑后的
 * 文本里反查解析期记下的左邻（`before`，贪心只向后找）或右邻（`after`）文字，
 * 返回该插 token 的下标。返回 -1 表示反查失败（调用方回落尾插）。
 *
 * **邻接一致性校验是这套锚点能否信任的关键**：原文里 token 与锚点之间是什么形态
 * （空白分隔 / 紧贴），新文本里必须仍然成立——否则说明用户把锚点那段改写了，
 * 位置已不可考。少了这一步，`对比 https://a.com` 被改成 `对比结果` 后，短锚点
 * `对比` 仍能在 `对比结果` 里命中 → token 被塞进「对比|结果」中间。
 *
 * 三处保守约束，宁可退化成尾插也不产出错位：
 * ① **邻接一致性**（见上）；
 * ② 占位区间不得落在已占用区间**内部**（正好压在边界上合法——插在替换前后皆可）；
 * ③ 占位起点不得早于 `from`（段序单调，保证输出顺序稳定）。
 *
 * 返回的 `start` / `end` 即该 token 应占的区间：`start === end` 是**纯插入**
 * （不改动文本）；`end = start + 1` 是**吃掉一个分隔空白**（见 after 分支）。
 * `padLead` / `padTrail` 表示 token 形态前后各需不需要补一个空格（原文的分隔
 * 空白在新文本里被折叠掉了就要补，见 `insertionForm`）。
 */
export function anchorInsertPoint(
	text: string,
	segment: MdTokenSegment,
	from: number,
	occupied: readonly { start: number; end: number }[],
): { start: number; end: number; padLead: boolean; padTrail: boolean } | null {
	const before = typeof segment.before === 'string' ? segment.before : '';
	const after = typeof segment.after === 'string' ? segment.after : '';
	const isBlank = (ch: string | undefined): boolean =>
		ch === undefined || /\s/.test(ch);
	let start = -1;
	let end = -1;
	let padLead = false;
	let padTrail = false;
	if (before) {
		const found = text.indexOf(before, from);
		// 原文右侧有空白 → 新文本里锚点末尾也必须仍是空白/行尾（分隔还在，
		// token 才仍能插在这里）；原文紧贴 → 该位置必须已到行尾
		if (found !== -1) {
			const tail = found + before.length;
			if (segment.sepBefore ? isBlank(text[tail]) : tail >= text.length) {
				start = tail;
				end = tail;
				// 原文 token 前有空白 ⇒ 补一个前导空格（插在此处会顶掉那个空白）
				padLead = segment.sepBefore === true;
			}
		}
	}
	// before 不可用（原文里 token 紧贴行首，或锚点被改写）时改用右邻：插在它**前面**
	if (start === -1 && after) {
		const found = text.indexOf(after, from);
		if (found !== -1 && (!segment.sepAfter || isBlank(text[found - 1]))) {
			// 让 token **接手**它右邻的那个分隔空白：`双图：![[a]] 与…` 编辑后
			// 文本是 `双图： 与 …`（token 两侧的空白被折叠成同一个），插在 `与`
			// 前会写成 `双图： ![[a]]与`——改为**吃掉**那个空白（占位区间含它），
			// token 自己补一个尾随空格，才回到用户原本的 `双图：![[a]] 与`。
			if (found > 0 && isBlank(text[found - 1])) {
				start = found - 1;
				end = found;
				padTrail = true;
			} else {
				start = found;
				end = found;
				// 插到行首时前面无处放分隔空白，只能落到 token 之后
				padTrail = segment.sepAfter === true;
			}
		}
	}
	if (start === -1 || end === -1 || start < from) {
		return null;
	}
	const blocked = occupied.some((s) => start > s.start && start < s.end);
	return blocked ? null : { start, end, padLead, padTrail };
}

/**
 * 插入形态按 `padLead` / `padTrail` 补回原文的分隔空白。
 *
 * 为什么必须补：首图不占显示文本，原文 token 两侧的空白在 `data.text` 里被
 * **折叠成同一个**（`标注 ![[图|200]]` 的 text 只有 `标注`），不补就会写出
 * `标注![[图|250]]`。各分支该不该补由 `anchorInsertPoint` 判定（它同时知道
 * 占位区间落在哪个位置、那里有没有空白可复用），本函数只负责拼装。
 */
export function insertionForm(
	form: string,
	padLead: boolean,
	padTrail: boolean,
): string {
	return `${padLead ? ' ' : ''}${form}${padTrail ? ' ' : ''}`;
}
