/**
 * 节点行内容**原文写入**（节点编辑弹窗「原文模式」的写回入口）。
 *
 * ## 为什么需要它（用户实测反馈）
 * 弹窗此前编辑的是 `data.text`（**显示文本**）：双链只剩剥壳名、外链（icon-only）
 * 连影子都没有——用户看不到语法，也就改不了链接。原文模式把编辑对象换成
 * **文件里的那一行**：
 * - 预填：`md-serialize.composeNodeContent`（下次写盘会写出的内容，含 `[[ ]]` / URL / 续行）；
 * - 提交：本模块——**重解析**首行 → 清空并回填全部行内字段 → 三个文本字段由解析
 *   结果写就，于是 `text === mdDerivedText`（**未编辑**状态）⇒ 保存时逐字写回
 *   用户输入，与「从文件重新加载这一行」等价。
 *
 * ## 为什么必须整体重建字段（先清后填）
 * 解析侧是这些字段的**唯一作者**：残留旧值会写出错行——例如原文里已删掉附件嵌入，
 * 残留的 `attachmentUrl` 会让回形针图标与新内容一起写出（旧链接复活）。
 * 清单直接用解析侧的常量（`md-outline.INLINE_LINK_FIELDS` / `PLAIN_IMAGE_FIELDS`），
 * 不在这里另抄一份。
 */
import {
	buildInlineData,
	INLINE_LINK_FIELDS,
	PLAIN_IMAGE_FIELDS,
} from './md-outline';
import type { MdNodeData } from '../core/node-data';

/**
 * 解析可写、需要「先清后填」的全部行内字段：链接通道 + 图片通道 + 台账 + 尺寸标记。
 *
 * - `mdImageAutoSize` 不是解析产物（加载期按原始比例校正时写），但新图不能沿用
 *   旧图的「自动尺寸」标记，故一并清；
 * - `mdSegments`（行内 token 台账）由新解析结果整体替换（无 token 时不写字段）。
 */
const REBUILT_FIELDS = [
	...INLINE_LINK_FIELDS,
	...PLAIN_IMAGE_FIELDS,
	'mdImageAutoSize',
	'mdSegments',
] as const;

/**
 * 把「行内容原文」写入节点数据（原文模式提交）。
 *
 * 多行（列表续行 / 段落）：**首行**进解析，其余行按**纯文本**接在 `text` 之后
 * （与解析侧「续行并入文本」同口径：续行不承载链接字段）。`mdRaw` 存**完整原文**
 * （含续行），序列化时按树深度补续行缩进。续行行首空白按解析侧口径 `trimStart`
 * ——缩进由序列化器补，留两份会写出双缩进。
 *
 * 结构字段（`mdType` / `mdLevel`）不动：行类型与层级由树决定，不因改文本而变化。
 */
export function applyRawToNode(data: MdNodeData, raw: string): void {
	const lines = raw.split('\n');
	const parsed = buildInlineData(lines[0] ?? '');
	for (const key of REBUILT_FIELDS) {
		delete data[key];
	}
	Object.assign(data, parsed);
	const rest = lines.slice(1).map((line) => line.trimStart());
	const text = rest.length > 0 ? [parsed.text, ...rest].join('\n') : parsed.text;
	data.text = text;
	data.mdDerivedText = text;
	data.mdRaw = [lines[0] ?? '', ...rest].join('\n');
}
