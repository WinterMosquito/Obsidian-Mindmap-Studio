/**
 * 链接「生效显示名」的纯判定：单一入口，零外部依赖。
 *
 * 为什么单独成模块：同一份判定有**两个消费方**——
 * - `md-serialize`（回写合成 `renderHyperlink` + 节点可见名 `nodeLinkDisplay`）；
 * - `mindmap.ts`（文档页图标的 tooltip）。
 *
 * 而 `mindmap.ts` 必须保持**可脱离 obsidian 打包**（`scripts/verify-visual.mjs`
 * 把它 esbuild 成浏览器 IIFE），故它不能 import `md-serialize`（后者依赖
 * obsidian）。把纯判定下沉到 domain，两个消费方共用同一实现，避免口径漂移——
 * 历史上回写与可见名口径不一致时，合成会写出「新文本 + 链接」重复一次。
 *
 * 反例（不要这么做）：在 `mindmap.ts` 里就地重写一遍「文本是否被编辑」的判断。
 * 那样 tooltip 与节点可见名会成为两套独立实现，任一侧调整闸门（如新增某种
 * 不适用形态）都会让另一侧静默失配。改这里，不要改调用方。
 */

import type { MdNodeMeta } from './md-meta';
import { linkDisplayText, withWikilinkAlias } from './wikilink';

/**
 * 判定所需的最小数据面：md 元数据 + 引擎侧字段（`text` / 附件名）。
 * 引擎字段在此按**结构**声明——domain 不得 import vendor（ESLint
 * `no-restricted-imports` 拦截 `../*`），而 `MdNodeData`（= MindMapNodeData
 * & MdNodeMeta）天然满足本接口，调用方可直接传入。
 */
export interface WikiAliasSource extends MdNodeMeta {
	/** 节点文本（引擎字段）：与 `mdDerivedText` 不等即「被用户编辑过」 */
	text?: string;
	/** 附件通道（引擎字段） */
	attachmentUrl?: string;
	attachmentName?: string;
}

/**
 * 「纯双链节点被编辑」→ 新别名（回写 `[[目标|新别名]]` 的依据）。
 *
 * 语义：纯双链节点（整行只有一个双链，节点内显示的就是该链接的可见名＝别名
 * 优先）里，节点内容**等价于**别名——因此编辑节点就是在改别名，而不是给节点
 * 追加一段文本。非纯节点（`说明 [[链接]]`）仍走「文本 + 行尾链接」，否则把整段
 * 文本当别名会静默吞掉 `说明`。
 *
 * 逐条闸门（全部满足才改写）：
 * 1. wiki 双链（`mdLinkStyle === 'wiki'`，URL/md 链接无别名概念，不适用）；
 * 2. 文本已被编辑（`text !== mdDerivedText`；未编辑整行逐字回写，本就不需要改写）；
 * 3. 单行文本（多行没有「唯一别名」的语义，回落旧的合成行为，不丢数据）；
 * 4. 纯双链：通道自带的可见名与 `mdDerivedText` 相等，即原文除该链接外别无内容
 *    （文档双链看 `mdLinkText`，附件双链看 `attachmentName`）；
 * 5. 排除嵌入语法 `![[附件]]`（`mdEmbed`）：其管道位是尺寸参数，不承载别名；
 * 6. 别名不含 `[` / `]`：Obsidian 的 wikilink 不允许方括号出现在 `[[..]]` 内，
 *    写进别名位会把链接写坏（`[[目标|[[新目标]]]]` 不再被识别为链接）——
 *    用户手输 `[[新目标]]` 这类内容回落旧合成（语义上更接近「换链」而非「改别名」）。
 *
 * @returns 新别名（已 trim；`''` 表示清除别名段）；不适用时返回 null
 */
export function editedWikilinkAlias(data: WikiAliasSource): string | null {
	if (data.mdLinkStyle !== 'wiki') {
		return null;
	}
	const text = data.text;
	const derived = data.mdDerivedText;
	if (typeof text !== 'string' || typeof derived !== 'string' || !derived) {
		return null;
	}
	if (text === derived || text.includes('\n')) {
		return null;
	}
	const alias = text.trim();
	if (/[[\]]/.test(alias)) {
		return null;
	}
	if (typeof data.mdWikiLinkpath === 'string' && data.mdWikiLinkpath) {
		return typeof data.mdLinkText === 'string' && data.mdLinkText === derived
			? alias
			: null;
	}
	if (
		data.mdEmbed !== true &&
		typeof data.attachmentUrl === 'string' &&
		data.attachmentUrl &&
		typeof data.attachmentName === 'string' &&
		data.attachmentName === derived
	) {
		return alias;
	}
	return null;
}

/**
 * 生效的文档双链：纯双链节点被编辑 → 别名取自节点文本；否则原样返回
 * `mdWikiLinkpath`。回写（`renderHyperlink`）与可见名（`nodeLinkDisplay` /
 * `docWikiLinkDisplay`）必须走同一入口——两条路径口径不一致时合成会写出
 * 「新文本 + 链接」重复一次。
 *
 * 新文本与「无别名时的默认显示名」相同（或清空）→ 不写别名段，避免产出
 * `[[目标|目标]]` 这类冗余（与附件通道同口径）。
 */
export function effectiveDocWikiLink(
	data: WikiAliasSource,
	wikiLink: string,
): string {
	const alias = editedWikilinkAlias(data);
	if (alias === null) {
		return wikiLink;
	}
	const bare = withWikilinkAlias(wikiLink, '');
	const redundant = alias === '' || alias === linkDisplayText(bare);
	return withWikilinkAlias(wikiLink, redundant ? '' : alias);
}

/**
 * 文档双链的**可见文本**＝节点内显示的名字（也是文档页图标 tooltip 的来源）。
 *
 * 未编辑时＝原显示名（与解析侧 `tokenDisplay` 同口径：别名优先，否则去 `.md`
 * 的目标名）；节点被编辑改别名后＝新别名（节点文本）。故图标 tooltip 不会
 * 停留在旧别名上（保存后即生效，无需重载）。
 *
 * @returns 非文档双链（无 `mdWikiLinkpath`）返回 null
 */
export function docWikiLinkDisplay(data: WikiAliasSource): string | null {
	const wikiLink = data.mdWikiLinkpath;
	if (typeof wikiLink !== 'string' || !wikiLink) {
		return null;
	}
	return linkDisplayText(effectiveDocWikiLink(data, wikiLink));
}
