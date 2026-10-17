/**
 * 引擎类型出口（防腐面的**类型侧**）：`src/engine/` 之外唯一允许出现 vendor
 * 引擎类型的导入来源。
 *
 * 背景（2026-10-17 审计）：engine 之外曾有 29 个文件直接
 * `import ... from '../../vendor/simple-mind-map.cjs'`——全部 type-only、零运行时
 * 耦合，但引擎换版/替换时改动面散落在 core / links / markdown / media /
 * services / features 六组。收口后 vendor 形态只在本文件声明一次，各层仍只
 * 依赖 core（依赖矩阵不变，未新增组间边）。
 *
 * 边界：本文件**只转出类型**（`export type`），不持有任何运行时代码；core 不
 * 因此依赖 engine 组——vendor 是外部包，不在组间矩阵内。
 *
 * 新增引擎类型：只在此处追加，勿在调用方重新直连 vendor（否则本收口失效）。
 */
export type {
	MindMap,
	MindMapNode,
	MindMapNodeData,
	MindMapTreeNode,
	SetNodeImageOptions,
} from '../../vendor/simple-mind-map.cjs';
