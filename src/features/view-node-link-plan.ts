/**
 * 「把节点变成链接」的**规划**（纯计算）：目标名 → 链接串 → 载荷 / 提示文案。
 *
 * 从 `features/view-node-actions.ts` 拆出（2026-10-22，纯搬移，零行为改动）。
 *
 * 与 `view-node-actions` 里 `apply*` 族的分界：本文件只**算**（返回 `{ target, link,
 * data, notice }`），不碰节点、不发 Notice、不碰引擎；`apply*` 负责把计划落到
 * 节点上并通知视图。这条界分得开，是因为「按官方设置决定链接形态」这件事有唯一
 * 判定（`prefersMarkdownLinks`），把判定与副作用混在一起时，新增一条拖入路径
 * 极易漏查设置（2026-10-15 复核踩过，硬规则 5）。
 */

/**
 * 拖入**文档链接**的计划：目标名 → 链接串 → 载荷 / 提示（形态跟随官方
 * 「使用 \[\[Wikilinks\]\]」，与 `applyDocWikiLink` 同一判定 `prefersMarkdownLinks`）。
 *
 * 为什么是一个 plan 而不是两个函数：一次拖入同时需要载荷（新建子节点）与提示
 * （Notice），分成两个出口会把链接串算两遍，且「提示与实际写法一致」退化为约定；
 * 合成一次判定后两处产物**结构上**同源。
 *
 * 为什么必须收口在此：拖入库内文档的三条路径（选中 → `applyDocWikiLink`；
 * **未选中**、**文件夹拖入**）此前各写一份硬编码 wikilink 载荷，后两条**不查
 * 官方设置**，与「选中拖入」跟随设置的行为分叉（2026-10-15 复核发现，违反
 * 硬规则 5）。载荷构造只此一处，勿在别处另判。
 */
export function planDocLink(
	view: MindMapViewContext,
	file: TFile,
): DocLinkPlan {
	// `.md` 可省略扩展名，canvas/base 等必须带（与解析侧同口径；勿统一用 basename）
	const target =
		file.extension.toLowerCase() === 'md' ? file.basename : file.name;
	// 路径形态跟随官方「New link format」（默认 shortest ＝ 上面的 basename 口径；
	// 存在同名文件时退化为完整路径，见 newDocLinkFor / newDocLinkpath）
	const link = newDocLinkFor(view, file, formatWikilink(target));
	if (prefersMarkdownLinks(view.app)) {
		// 官方关闭 Wikilinks：写 `[显示名](路径.md)`，走引擎 hyperlink 通道
		// （与 `applyMdLink` 的子节点载荷同形）；代价是显示引擎原生链接图标
		const dest = markdownDocTarget(link);
		return {
			target,
			link,
			data: {
				text: target,
				hyperlink: dest,
				mdLinkStyle: 'md',
				mdLinkText: target,
				hyperlinkTitle: dest,
			},
			notice: `[${target}](${dest})`,
		};
	}
	return {
		target,
		link,
		data: {
			text: target,
			mdWikiLinkpath: link,
			mdLinkStyle: 'wiki',
			mdLinkText: target,
		},
		notice: link,
	};
}

/**
 * 新建文档链接的**路径形态**：跟随官方「New link format」（默认最短路径）。
 *
 * 只影响**新建**——既有链接改写沿用原始前缀（links-tree 的引用更新口径）。
 * 读设置 / 同名消歧 / 三档拼接的唯一实现在 `links/file-lookup.newReferencePath`
 * （与图片引用共用，那里有完整的官方口径注释）；本处只声明文档链接可省 `.md`。
 */
function newDocLinkpath(file: TFile, sourcePath: string, app: App): string {
	return newReferencePath(app, file, sourcePath, preferredLinkPathFormat(app), {
		omitMarkdownExtension: true,
	});
}

/**
 * 把链接改写为**新路径**，保留用户写下的 `#区块` 与 `|别名`
 * （新建链接时由官方「New link format」决定路径，别名/区块是用户意图，不动）。
 */
function withLinkPath(link: string, linkpath: string): string {
	const parsed = parseWikilink(link);
	if (!parsed) {
		return linkpath;
	}
	// `#区块` 已由 parseWikilink 给出（parsed.block 不含 #）：勿在调用方另写切分
	const block = parsed.block ? `#${parsed.block}` : '';
	return formatWikilink(`${linkpath}${block}`, parsed.alias || undefined);
}

/**
 * 新建/拖入**文档**时的链接串：路径形态跟随官方「New link format」，
 * 别名与 `#区块` 保留（`link` 缺省时按文件路径构造）。
 * **模块内唯一换算**：添加链接弹窗的提交路径与拖入文档的计划（`planDocLink`）
 * 共用（口径必须一致，否则同一操作两种写法），故不再对外导出。
 */
export function newDocLinkFor(
	view: MindMapViewContext,
	file: TFile,
	link = file.path,
): string {
	return withLinkPath(
		link,
		newDocLinkpath(file, view.file?.path ?? '', view.app),
	);
}

/**
 * 双链目标 → md 链接的目标（补 `.md`；官方 md 链接需要完整路径+扩展名）。
 * `[[笔记]]` → `笔记.md`；`[[目录/笔记]]` → `目录/笔记.md`；已带扩展名的原样返回。
 */
export function markdownDocTarget(link: string): string {
	const target = parseWikilink(link)?.target ?? link.replace(/^\[\[|\]\]$/g, '');
	if (!target) {
		return link;
	}
	return /\.[^./]+$/.test(target) ? target : `${target}.md`;
}

/**
 * 附件链接的**字段集**（不含节点文本）：`mdEmbed` 按扩展名（可嵌入类型写嵌入
 * 语法，与 Obsidian 拖放一致），回写用**完整库内路径**（basename 会被 Obsidian
 * 去掉扩展名，无法定位附件）。
 *
 * 收口理由：这几个字段此前在 `applyNodeAttachment` 的子节点分支、覆盖分支与
 * `view-dnd.handleDroppedAttachment` 里各写一份——与文档链接同一类分叉风险
 *（2026-10-15 复核，违反硬规则 5）。字段集只此一处。
 */
export function attachmentFields(
	view: MindMapViewContext,
	file: TFile,
	embed: boolean,
): Record<string, unknown> {
	return {
		attachmentUrl: view.app.vault.getResourcePath(file),
		attachmentName: file.name,
		mdAttachmentLinkpath: file.path,
		mdLinkStyle: 'wiki',
		...(embed ? { mdEmbed: true } : {}),
	};
}

/**
 * 拖入**附件**的计划：载荷 + 提示写法（与 `planDocLink` 同构——一次判定，
 * 两处产物同源）。提示里的 `!` 与 `mdEmbed` 出自同一个 `embed`，故提示与文件
 * 内容永不分叉（此前提示恒写 `[[名]]`，可嵌入附件的提示与内容差一个 `!`；
 * 2026-10-15 复核）。
 */
export function planAttachmentLink(
	view: MindMapViewContext,
	file: TFile,
): { data: Record<string, unknown>; notice: string } {
	const embed = isEmbeddableAttachmentExtension(file.extension);
	return {
		data: { text: file.name, ...attachmentFields(view, file, embed) },
		notice: `${embed ? '!' : ''}[[${file.name}]]`,
	};
}

import type { App, TFile } from 'obsidian';
import { isEmbeddableAttachmentExtension } from '../core/constants';
import { formatWikilink, parseWikilink } from '../domain/wikilink';
import { newReferencePath } from '../links/file-lookup';
import {
	preferredLinkPathFormat,
	prefersMarkdownLinks,
} from '../platform/vault-prefs';
import type { DocLinkPlan } from './view-node-actions';
import type { MindMapViewContext } from './view-context';
