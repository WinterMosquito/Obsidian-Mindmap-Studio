/**
 * 跨特性共用的公共 helpers。
 * 从 view-node-actions.ts 迁出 requireActiveNode——view-image-actions 也依赖它，
 * 原先双向依赖形成运行时循环（view-node-actions re-export view-image-actions
 * 的函数，而 view-image-actions import view-node-actions 的 requireActiveNode）。
 * 迁出后两侧都依赖本文件，消除循环。
 */
import { Notice } from 'obsidian';
import { ENGINE_COMMANDS, getActiveNode } from '../engine/mindmap';
import { t } from '../core/i18n';
import { composeNodeContent } from '../markdown/md-serialize';
import { formatWikilink, linkDisplayText } from '../domain/wikilink';
import type { MdNodeData } from '../core/node-data';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext, ViewNodeEditContext } from './view-context';

/**
 * 取当前激活节点；无则提示「请先选择一个节点」并返回 null。
 * 工具栏/右键各入口共用的前置守卫。
 */
export function requireActiveNode(view: ViewNodeEditContext): MindMapNode | null {
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
	}
	return node;
}

/**
 * 补齐**新建 / 改写链接节点**的行级元数据（`mdRaw` / `mdDerivedText`）。
 *
 * 背景（2026-10-02 实机复现）：自绘渲染（`node-inline-content.resolveSelfDrawSource`）
 * 与序列化「未编辑」判定（`md-serialize.rawOk`）都以 `mdRaw` 为源；插入 / 覆盖路径
 * 只写链接通道字段时，`mdDerivedText` 缺失会被判「已编辑」→ 渲染源回落 `data.text`
 * （纯文本）→ 不生成锚点——节点不显示超链接字体、普通点击无效，直到重解析才恢复。
 *
 * 合成用 `composeNodeContent`——「保存将写出的那一行」的**唯一来源**。补齐后节点
 * 与「写盘再重解析」所得形态一致：渲染立即出锚点，`rawOk` 命中逐字回写（往返零漂移）。
 *
 * @param data      节点数据（**就地**补写 `mdRaw` / `mdDerivedText`）
 * @param text      节点最终文本（覆盖分支在 `setNodeText` 之前调用，`data.text` 尚未更新）
 * @param overwrite 覆盖分支（节点被改写为某链接的纯承载）传 true：无视已有 `mdRaw`
 *                  强制重算（旧原文已不代表节点内容）；插入路径缺省 false，已带
 *                  `mdRaw` 的数据（粘贴 / Alt 拖复制 / 拆分子节点）原样保留。
 */
export function applyInlineRawMeta(
	data: Record<string, unknown>,
	text: string,
	overwrite = false,
): void {
	if (!overwrite && typeof data['mdRaw'] === 'string' && data['mdRaw']) {
		return;
	}
	// 图片节点走引擎图片通道（含图节点本就不自绘，渲染/回写由图片路径负责；
	// compose 的图片反查需要 app，此处统一不碰图片形态）
	if (typeof data['image'] === 'string' && data['image']) {
		return;
	}
	const wikiLink =
		typeof data['mdWikiLinkpath'] === 'string' ? data['mdWikiLinkpath'] : '';
	const attachmentUrl =
		typeof data['attachmentUrl'] === 'string' ? data['attachmentUrl'] : '';
	const hyperlink = typeof data['hyperlink'] === 'string' ? data['hyperlink'] : '';
	if (!wikiLink && !attachmentUrl && !hyperlink) {
		return;
	}
	const source = { ...data, text } as MdNodeData;
	// 覆盖分支的旧原文不代表新内容：从临时视图剥掉，强制按当前字段重新合成
	if (overwrite) {
		delete source['mdRaw'];
	}
	if (wikiLink && text) {
		// 显式别名（节点文本 ≠ 链接自带显示名）：按「纯双链被编辑」形态借给合成器
		//（mdLinkText / mdDerivedText 置为链接自带显示名）——compose 的别名改写
		//（editedWikilinkAlias 闸门）才能产出 `[[目标|文本]]`；闸门自身拒绝的形态
		//（含方括号别名 / 多行）自会回落「文本 + 尾链」，与序列化行为一致。
		const defaultDisplay = linkDisplayText(wikiLink);
		if (text !== defaultDisplay) {
			source['mdDerivedText'] = defaultDisplay;
			source['mdLinkText'] = defaultDisplay;
		}
	} else if (attachmentUrl && !wikiLink && data['mdEmbed'] === true) {
		// 附件嵌入（attachmentUrl + mdEmbed）：nodeLinkDisplay 的附件显示名分支对
		// mdEmbed 不认（`mdEmbed !== true` 闸门），直接 compose 会退化为
		// 「文本 + 尾链」——保存即写出重复文本（实机复现 2026-10-02：
		// `测试附件.pdf ![[测试附件.pdf]]`）。临时视图补上**解析侧同款**双链通道
		// （`![[附件]]` 解析即 mdWikiLinkpath + mdEmbed）让显示名判定走文档通道 →
		// 纯 token；产出仍是 attachmentUrl 分支渲染的 `![[路径]]`，节点数据通道不变
		//（不写回 mdWikiLinkpath，回写特征 rawHasLinkFeature 对两种通道同样命中）。
		const linkpath =
			typeof data['mdAttachmentLinkpath'] === 'string' &&
			data['mdAttachmentLinkpath']
				? data['mdAttachmentLinkpath']
				: attachmentUrl;
		source['mdWikiLinkpath'] = formatWikilink(linkpath);
	}
	data['mdRaw'] = composeNodeContent(source, null);
	data['mdDerivedText'] = text;
}

/**
 * 在指定父节点下插入子节点并携带初始数据（拖入/粘贴/新建承载节点的唯一入口）。
 *
 * 引擎没有「按插入结果取回新节点」的公开途径，初始数据必须一次给全；
 * 统一约定 `appointNodes = [parent]`（不依赖激活列表——引擎在 appointNodes 与
 * 激活列表均为空时直接 return，空数组会静默失效）与 `isActive: false`
 * （新节点不抢激活态）。父节点/引擎缺失时返回 false（调用方据此决定是否提示）。
 *
 * `options.openEdit = true`（**新建节点**场景，2026-09-28 方案 B / K93）：引擎按
 * `inserting` 路径处理——渲染后**强制激活**新节点并打开引擎编辑框（编辑框对空
 * 文本同样可用，新建即可直接输入）。其余调用方（拖入/粘贴/拆分/Alt 拖复制）
 * 保持缺省 false：不抢激活态、不打断当前操作。
 */
export function insertChildNodeWithData(
	view: MindMapViewContext,
	parent: MindMapNode | null,
	data: Record<string, unknown>,
	options: { openEdit?: boolean } = {},
): boolean {
	if (!parent) {
		return false;
	}
	const engine = view.mindMap;
	if (!engine) {
		return false;
	}
	// 新建节点补行级元数据：链接节点立即按原文渲染出锚点、保存 rawOk 逐字回写
	//（粘贴 / Alt 拖复制 / 拆分子节点已带 mdRaw 的原样保留，见 applyInlineRawMeta）
	const initial: Record<string, unknown> = { ...data };
	applyInlineRawMeta(
		initial,
		typeof data['text'] === 'string' ? data['text'] : '',
	);
	engine.execCommand(
		ENGINE_COMMANDS.INSERT_CHILD_NODE,
		options.openEdit === true,
		[parent],
		{
			...initial,
			isActive: false,
		},
	);
	return true;
}
