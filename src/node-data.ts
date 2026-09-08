/**
 * 引擎节点 data（渲染字段）与渲染层 md 元数据的合并视图。
 *
 * 放在 src 根层而非 domain/：它同时引用引擎 vendor 类型与 domain 元数据
 * 契约，属于"黏合类型"——domain 保持纯领域逻辑（零引擎/Obsidian/上层
 * 依赖），由 eslint 的 no-restricted-imports 边界规则强制。
 */
import type { MindMapNodeData } from '../vendor/simple-mind-map.cjs';
import type { MdNodeMeta } from './domain/md-meta';

/** 引擎节点 data + md 元数据的合并视图 */
export type MdNodeData = MindMapNodeData & MdNodeMeta;

/**
 * 节点 data 上可能承载「库内文件引用」的字段（引擎字段 + 插件回写字段）。
 * 引用更新（改名/删除，links-tree）与引用预检（engine-controller）**共用此清单**——
 * 新增引用字段只改这一处，避免两处清单漂移导致预检静默失效（漏改即整段更新被跳过）。
 */
export const NODE_REFERENCE_FIELDS = [
	'image',
	'attachmentUrl',
	'hyperlink',
	'mdWikiLinkpath',
] as const;

/** 节点 data 是否含任一引用字段（预检短路用） */
export function hasNodeReference(
	data: Record<string, unknown> | null | undefined,
): boolean {
	return !!data && NODE_REFERENCE_FIELDS.some((key) => Boolean(data[key]));
}

/** 引用字段的比对串（`值|值|…`，引用更新预检用） */
export function nodeReferenceHaystack(
	data: Record<string, unknown> | null | undefined,
): string {
	if (!data) {
		return '';
	}
	return NODE_REFERENCE_FIELDS.map((key) => {
		const value = data[key];
		return typeof value === 'string' ? value : '';
	}).join('|');
}
