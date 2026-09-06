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
