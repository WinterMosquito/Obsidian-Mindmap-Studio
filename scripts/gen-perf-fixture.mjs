#!/usr/bin/env node
/**
 * 性能基准 fixture 生成器（Stage 0 · 方案 C）
 *
 * 动机：`perf-500/5000/10000.mindmap.md` 是**退化形态**——10 分支、深度 5、
 * 树高 147,817px、节点文本全是 `P5000 0-0` 这类定长短串。它对「布局遍历」
 * 与「子树剪枝」类优化是最坏输入（纵向极深 ⇒ 剪枝边界节点占比高），
 * 且完全不含长文本换行、wikilink 锚点等真实节点形态。
 *
 * 本脚本产出**非退化形态**：混合分支（3–8）、深度 ≤8、约 15% 长文本节点、
 * 约 5% wikilink 节点。用于复核优化收益在真实形态下是否成立（不只对
 * 合成形态成立）。
 *
 * 确定性：LCG 种子固定 ⇒ 同参数逐字节可复现，A/B 对照才有意义。
 *
 * 用法：
 *   node scripts/gen-perf-fixture.mjs --out <path.md> [--nodes 5000] [--seed 20261005]
 *   node scripts/gen-perf-fixture.mjs --out <path.md> --shape degenerate   # 复现旧形态
 *
 * 输出格式与既有 `perf-*.mindmap.md` 一致：无 frontmatter、纯列表、
 * 根节点后跟一个空行、每层缩进 2 空格（插件按文件名派生根标题）。
 */

import { writeFileSync } from 'node:fs'

/** 命令行参数 */
function parseArgs(argv) {
	const out = { out: '', nodes: 5000, seed: 20261005, shape: 'realistic' }
	for (let i = 2; i < argv.length; i++) {
		const key = argv[i]
		const next = argv[i + 1]
		if (key === '--out') {
			out.out = next
			i++
		} else if (key === '--nodes') {
			out.nodes = Number.parseInt(next, 10)
			i++
		} else if (key === '--seed') {
			out.seed = Number.parseInt(next, 10)
			i++
		} else if (key === '--shape') {
			out.shape = next
			i++
		}
	}
	if (!out.out) {
		throw new Error('缺少 --out <path.md>')
	}
	if (!Number.isFinite(out.nodes) || out.nodes < 2) {
		throw new Error(`--nodes 非法：${out.nodes}`)
	}
	return out
}

/** 线性同余发生器（数值参数取自 Numerical Recipes；固定种子 ⇒ 可复现） */
function createRng(seed) {
	let s = seed >>> 0
	return function next() {
		// s = (1664525 * s + 1013904223) mod 2^32
		s = (Math.imul(1664525, s) + 1013904223) >>> 0
		return s / 4294967296
	}
}

/** 真实感长文本语料（覆盖中英混排、标点、括号——影响换行与测宽） */
const LONG_TEXTS = [
	'在设计渲染管线时，需要把「布局计算」与「DOM 物化」两个阶段的成本分别量化，否则很容易把优化收益记在错误的环节上。',
	'Performance mode culls off-screen nodes, so the number of nodes that actually materialise in the viewport stays small even for very large documents.',
	'关键结论：视口剔除在叶子层生效，遍历成本无法被视口规模摊薄，因此每次结构性编辑仍要付一遍全树的判定代价（约 5–6μs/节点）。',
	'注意 subtree extent 不能用 node.height 近似——实测仅约 33% 的节点其自身盒子能容纳整棵子树，最大溢出可达七万像素。',
	'另一个容易踩的坑是 childrenAreaHeight2：它是「直接子节点区域」的高度，不是整棵子树的纵向跨度，直接拿它做剪枝判据会产生假阴性。',
	'A/B/B/A 交替对照取最小值，是为了压制运行间噪声（GC 抖动、系统调度）带来的假收益。'
]

/** wikilink 目标名（指向库内不存在的文件亦可——只测渲染路径，不测解析） */
const WIKI_TARGETS = ['性能优化方案', '渲染管线笔记', 'K75 分片渲染', '子树剪枝判据', '实测账本']

/**
 * 生成树。
 * @param {number} targetNodes 目标节点数（根除外）
 * @param {number} seed
 * @param {'realistic'|'degenerate'} shape
 */
function buildTree(targetNodes, seed, shape) {
	const rng = createRng(seed)
	/** @type {{text:string, children:any[]}[]} */
	const root = { text: '真实形态基准', children: [] }
	let count = 0

	/**
	 * @param {any[]} siblings 父节点的 children 数组
	 * @param {number} depth 当前将创建的节点所在深度（1 = 根的子节点）
	 */
	function grow(siblings, depth) {
		// 分支因子：realistic 混合 3–8（按深度轻微收敛）；degenerate 固定 10
		let fanout
		if (shape === 'degenerate') {
			fanout = 10
		} else {
			const base = depth <= 1 ? 8 : depth >= 6 ? 3 : 6
			fanout = base + Math.floor(rng() * 3) - 1 // base-1 .. base+1
			fanout = Math.max(2, Math.min(8, fanout))
		}
		for (let i = 0; i < fanout && count < targetNodes; i++) {
			const node = { text: '', children: [] }
			count++
			// 文本形态分布
			const roll = rng()
			if (roll < 0.05) {
				// wikilink 节点（渲染锚点/图标路径）
				const t = WIKI_TARGETS[Math.floor(rng() * WIKI_TARGETS.length)]
				node.text = `参见 [[${t}]] 的第 ${i + 1} 项`
			} else if (roll < 0.2) {
				// 长文本节点（换行 + 测宽路径）
				node.text = LONG_TEXTS[Math.floor(rng() * LONG_TEXTS.length)]
			} else {
				node.text = `D${depth}-${i}`
			}
			siblings.push(node)
			// 深度上限：realistic 8 层 / degenerate 5 层
			const maxDepth = shape === 'degenerate' ? 5 : 8
			if (depth < maxDepth) {
				grow(node.children, depth + 1)
			}
		}
	}
	grow(root.children, 1)
	return root
}

/** 序列化为插件可解析的 markdown 列表（根后跟一空行，2 空格/层） */
function serialize(root) {
	const lines = []
	/**
	 * @param {any[]} nodes
	 * @param {number} depth
	 */
	function emit(nodes, depth) {
		const indent = '  '.repeat(depth)
		for (const node of nodes) {
			// 文本内不含换行（长文本语料是单行），故无需转义；空行仅出现在根之后
			lines.push(`${indent}- ${node.text}`)
			if (node.children.length) {
				emit(node.children, depth + 1)
			}
		}
	}
	lines.push(`- ${root.text}`, '')
	emit(root.children, 1)
	return `${lines.join('\n')}\n`
}

const args = parseArgs(process.argv)
const tree = buildTree(args.nodes, args.seed, args.shape)
const markdown = serialize(tree)
writeFileSync(args.out, markdown, 'utf8')

// 结构统计（写入 stderr 便于 shell 捕获，不污染 fixture 正文）
let total = 0
let maxDepth = 0
let longCount = 0
let wikiCount = 0
;(function walk(nodes, depth) {
	for (const node of nodes) {
		total++
		if (depth > maxDepth) maxDepth = depth
		if (node.text.includes('[[')) wikiCount++
		else if (node.text.length > 40) longCount++
		walk(node.children, depth + 1)
	}
})(tree.children, 1)

process.stderr.write(
	[
		`已生成 ${args.out}`,
		`  shape=${args.shape} seed=${args.seed} 节点数=${total} 最大深度=${maxDepth}`,
		`  长文本节点=${longCount} wikilink 节点=${wikiCount} 字节=${Buffer.byteLength(markdown, 'utf8')}`
	].join('\n') + '\n'
)
