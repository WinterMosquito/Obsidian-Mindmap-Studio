/**
 * 模块边界静态校验：把 K51 里「只写在文档里、或只能靠说明符字面量匹配」的
 * 约束变成可断言的**依赖图性质**。
 *
 * 为什么需要它（补齐三处结构性盲区）：
 * 1. **组内成环**——`eslint` 的 `no-restricted-imports` 只看跨组说明符，
 *    `features/view.ts ↔ features/view-node-actions.ts` 这类同组环永远绿。
 *    K51 明文要求「组内不得成环」，此前无人执行。
 * 2. **深层路径绕过**——边界模式按其字面量形态匹配（`../engine`）。若某组
 *    新增子目录（`src/a/sub/x.ts` 写作 `../../engine/x`），说明符形态变了，
 *    规则可能整体失效而无人察觉。本测试按**解析后的真实文件路径**判层，
 *    与写法深浅无关。
 * 3. **新组静默出现**——`src/` 下多出一级目录时，没有任何块覆盖它，lint 全绿。
 *    本测试要求一级目录与 `MODULE_GROUPS` 一一对应。
 *
 * 单一来源：矩阵与正则都从 `scripts/module-boundaries.mjs` 读取——与 lint 同源，
 * 不在测试里另抄一份（硬规则 5）。这样矩阵改动只可能「同时生效」。
 *
 * 环检测只走**值依赖**（`import type` 除外）：类型边在编译期擦除，eslint 的
 * `allowTypeImports` 同样把组合根的类型引用视为豁免，两处口径保持一致。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
	COMBO_ROOT_MODULES,
	COMBO_ROOT_SPECIFIER_PATTERN,
	MODULE_DEPENDENCIES,
	MODULE_GROUPS,
	allowedTargets,
	forbiddenSpecifierPatterns,
} from '../scripts/module-boundaries.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * 相对说明符的解析后缀（顺序即优先级）。
 *
 * 空串在首位：`../../vendor/simple-mind-map.cjs` 这类带扩展名的目标必须原样命中；
 * 目录由 `isRegularFile` 排除，故空串不会把 `../engine` 误判成文件。
 */
const RESOLVE_SUFFIXES = ['', '.ts', '.cts', '.mts', '.d.cts', '.json'];

/** 诊断信息一律用相对 ROOT 的 posix 路径（跨平台可读、与仓库书写一致） */
function relPath(absPath: string): string {
	return path.relative(ROOT, absPath).split(path.sep).join('/');
}

/** 递归收集目录下全部 `.ts`（绝对路径） */
function collectTsFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsFiles(abs));
		} else if (entry.name.endsWith('.ts')) {
			files.push(abs);
		}
	}
	return files;
}

/** 是否为**普通文件**（`existsSync` 对目录同样为真，会把目录误当已解析目标） */
function isRegularFile(candidate: string): boolean {
	try {
		return statSync(candidate).isFile();
	} catch {
		return false;
	}
}

/**
 * 一条相对说明符的三种归宿。
 *
 * 用具名判别式而非 `string | null | undefined` 三态：后者在调用处极易漏判
 * 其中一支（`null` 与 `undefined` 语义相反，却共用同一处类型收窄）。
 */
type SpecifierResolution =
	| { readonly kind: 'external' }
	| { readonly kind: 'missing' }
	| { readonly kind: 'file'; readonly file: string };

/** 解析相对说明符；裸说明符（`obsidian` / npm 包）归为 `external`，不参与图校验 */
function resolveSpecifier(
	fromFile: string,
	specifier: string,
): SpecifierResolution {
	if (!specifier.startsWith('.')) {
		return { kind: 'external' };
	}
	const base = path.resolve(path.dirname(fromFile), specifier);
	for (const suffix of RESOLVE_SUFFIXES) {
		const candidate = `${base}${suffix}`;
		if (isRegularFile(candidate)) {
			return { kind: 'file', file: candidate };
		}
	}
	const indexFile = path.join(base, 'index.ts');
	return isRegularFile(indexFile)
		? { kind: 'file', file: indexFile }
		: { kind: 'missing' };
}

/** 源码里出现的一条说明符及其强弱（是否只有类型绑定） */
interface SpecifierRef {
	readonly specifier: string;
	readonly typeOnly: boolean;
}

/**
 * `import ... from 'x'` 是否只有类型绑定。
 *
 * 口径：`import type` 声明、或**全部具名绑定**都带 `type` 修饰符且无默认导入
 * /命名空间导入（这两个绑定会引入值）。无子句的副作用 import 一律算值依赖。
 */
function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
	const clause = node.importClause;
	if (clause === undefined) {
		return false;
	}
	// `ImportClause.isTypeOnly` 自 TS 5.9 起标记弃用，改读 `phaseModifier`
	// （`import type` 与 `import defer` 共用该字段，故须比对 `type` 关键字）。
	if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
		return true;
	}
	if (clause.name !== undefined) {
		return false;
	}
	const bindings = clause.namedBindings;
	if (bindings === undefined) {
		return true;
	}
	if (ts.isNamespaceImport(bindings)) {
		return false;
	}
	return (
		bindings.elements.length > 0 &&
		bindings.elements.every((element) => element.isTypeOnly)
	);
}

/** `export ... from 'x'` 是否只有类型导出（判定口径同上） */
function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
	if (node.isTypeOnly) {
		return true;
	}
	const clause = node.exportClause;
	if (clause === undefined || ts.isNamespaceExport(clause)) {
		return false;
	}
	return (
		clause.elements.length > 0 &&
		clause.elements.every((element) => element.isTypeOnly)
	);
}

/**
 * 用 TypeScript 官方 AST 抽取说明符（不手写 import 正则）。
 *
 * 覆盖静态 import/export、`import x = require()`、动态 `import('…')`——
 * 手写正则会漏动态导入，而那正是绕过图校验最省事的路子。
 */
function collectSpecifiers(file: string): SpecifierRef[] {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const found: SpecifierRef[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push({
				specifier: node.moduleSpecifier.text,
				typeOnly: importDeclarationIsTypeOnly(node),
			});
		} else if (
			ts.isExportDeclaration(node) &&
			node.moduleSpecifier !== undefined &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push({
				specifier: node.moduleSpecifier.text,
				typeOnly: exportDeclarationIsTypeOnly(node),
			});
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference) &&
			ts.isStringLiteral(node.moduleReference.expression)
		) {
			found.push({
				specifier: node.moduleReference.expression.text,
				typeOnly: node.isTypeOnly,
			});
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			const [argument] = node.arguments;
			if (
				argument !== undefined &&
				(ts.isStringLiteral(argument) ||
					ts.isNoSubstitutionTemplateLiteral(argument))
			) {
				found.push({ specifier: argument.text, typeOnly: false });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** 一条已解析的依赖边（图的基本单位；只保留消费方真正用到的字段） */
interface ImportEdge {
	readonly from: string;
	readonly to: string;
	readonly typeOnly: boolean;
}

/**
 * 解析出的依赖图：可用的边 + 相对说明符里**解析不到**的（陈旧 import / 非 TS 资源）。
 *
 * 单遍完成：此前每条边在「建图」与「陈旧检查」两处各解析一次，等于每份源码
 * 读两次盘、建两棵 AST。
 */
function buildImportGraph(files: readonly string[]): {
	edges: ImportEdge[];
	unresolved: string[];
} {
	const edges: ImportEdge[] = [];
	const unresolved: string[] = [];
	for (const from of files) {
		for (const { specifier, typeOnly } of collectSpecifiers(from)) {
			const resolution = resolveSpecifier(from, specifier);
			if (resolution.kind === 'external') {
				continue;
			}
			if (resolution.kind === 'missing') {
				unresolved.push(`${relPath(from)} → ${specifier}`);
				continue;
			}
			edges.push({ from, to: resolution.file, typeOnly });
		}
	}
	return { edges, unresolved };
}

/** `src/` 根层的组合根文件绝对路径集合 */
const COMBO_ROOT_FILES = new Set(
	COMBO_ROOT_MODULES.map((name) => path.join(SRC, `${name}.ts`)),
);

/** 由矩阵定义推导的组名联合（不另写一份字面量） */
type ModuleGroup = (typeof MODULE_GROUPS)[number];

/** 是否已登记的模块组（`src/` 下新目录在登记前不参与层校验，由第一个测试报错） */
function isModuleGroup(name: string): name is ModuleGroup {
	return (MODULE_GROUPS as readonly string[]).includes(name);
}

/**
 * 文件所属模块组；`src/` 根层文件返回 null（组合根 / 未分组）。
 * `src/` 之外的目标也返回 null，由调用方按「外部目标」跳过层校验。
 */
function moduleGroupOf(absFile: string): ModuleGroup | null {
	const segments = path.relative(SRC, absFile).split(path.sep);
	const [head] = segments;
	if (head === undefined || head === '..' || segments.length < 2) {
		return null;
	}
	return isModuleGroup(head) ? head : null;
}

/** 是否位于 `src/` 内 */
function isInsideSrc(absFile: string): boolean {
	return !path.relative(SRC, absFile).startsWith('..');
}

const SRC_FILES = collectTsFiles(SRC);
const GRAPH = buildImportGraph(SRC_FILES);
const IMPORT_EDGES = GRAPH.edges;

/** 判环时的访问状态：`active`＝在当前 DFS 栈上（回边即成环） */
type VisitState = 'active' | 'done';

/**
 * 在邻接表上找环（DFS 三色标记的两种状态版），返回环路径（首尾同名）。
 *
 * 图是通用的 `Map<节点, 依赖列表>`，模块组矩阵也复用它做 DAG 断言。
 */
function findCycles(graph: ReadonlyMap<string, string[]>): string[][] {
	const state = new Map<string, VisitState>();
	const stack: string[] = [];
	const cycles: string[][] = [];
	const visit = (node: string): void => {
		const seen = state.get(node);
		if (seen === 'done') {
			return;
		}
		if (seen === 'active') {
			const start = stack.indexOf(node);
			cycles.push([...stack.slice(start), node]);
			return;
		}
		state.set(node, 'active');
		stack.push(node);
		for (const next of graph.get(node) ?? []) {
			visit(next);
		}
		stack.pop();
		state.set(node, 'done');
	};
	for (const node of graph.keys()) {
		visit(node);
	}
	return cycles;
}

describe('矩阵定义（scripts/module-boundaries.mjs）', () => {
	it('跨组禁令正则覆盖任意深度，且不误伤许可集与组内引用', () => {
		const patterns = forbiddenSpecifierPatterns('core').map(
			({ regex }) => new RegExp(regex),
		);
		const forbiddenFromCore = (specifier: string): boolean =>
			patterns.some((pattern) => pattern.test(specifier));

		expect(forbiddenFromCore('../features/view')).toBe(true);
		expect(forbiddenFromCore('../../features/view')).toBe(true);
		expect(forbiddenFromCore('../../../ui/modal-common')).toBe(true);
		// 许可集内与组内相对引用不得被拦
		expect(forbiddenFromCore('../domain/md-meta')).toBe(false);
		expect(forbiddenFromCore('./md-meta')).toBe(false);
		// 组名前缀相同的**非**该组路径不得被误命中（`(?:/|$)` 的边界作用）
		expect(forbiddenFromCore('../core-utils/x')).toBe(false);

		// 组内相对引用永不命中（文件名里含组名也不行）
		const enginePatterns = forbiddenSpecifierPatterns('engine').map(
			({ regex }) => new RegExp(regex),
		);
		expect(
			enginePatterns.some((pattern) => pattern.test('./mindmap-commands')),
		).toBe(false);
	});

	it('组合根模式：交替式整体成组，`./xxx` 与深层同目录引用不得命中', () => {
		const combo = new RegExp(COMBO_ROOT_SPECIFIER_PATTERN.regex);

		expect(combo.test('../settings')).toBe(true);
		expect(combo.test('../../settings')).toBe(true);
		expect(combo.test('../commands/panel')).toBe(true);
		// 回归（2026-10-17）：交替式漏掉 `(?:…)` 时 `commands` 会成为顶层分支，
		// 于是 `./commands`、`./mindmap-commands` 都被误判为「引用组合根」。
		expect(combo.test('./commands')).toBe(false);
		expect(combo.test('./mindmap-commands')).toBe(false);
		expect(combo.test('../engine/mindmap-commands')).toBe(false);
	});

	it('许可集形状：恒含 domain、不含自身、组成员全部合法', () => {
		for (const group of MODULE_GROUPS) {
			const allowed = allowedTargets(group);
			// domain 是最底层，故恒为许可集首项；domain 自身没有可依赖的组。
			expect(allowed[0]).toBe('domain');
			if (group !== 'domain') {
				expect(allowed).not.toContain(group);
			}
			for (const target of allowed) {
				expect(MODULE_GROUPS).toContain(target);
			}
		}
		expect(allowedTargets('core')).toEqual(['domain']);
		expect(allowedTargets('ui')).not.toContain('features');
	});
});

describe('模块边界（K51）：依赖图性质', () => {
	it('依赖图采集非空（防止解析器失效后全部断言空转）', () => {
		// 采集为空时，下面每条「无违规」都会假绿——宁可在此红灯。
		expect(SRC_FILES.length).toBeGreaterThan(50);
		expect(IMPORT_EDGES.length).toBeGreaterThan(100);
	});

	it('环检测器自检（合成图：有环必报、无环不误报）', () => {
		const cyclic = new Map<string, string[]>([
			['a', ['b']],
			['b', ['c']],
			['c', ['a']],
		]);
		const acyclic = new Map<string, string[]>([
			['a', ['b', 'c']],
			['b', ['c']],
			['c', []],
		]);
		expect(findCycles(cyclic)).toEqual([['a', 'b', 'c', 'a']]);
		expect(findCycles(acyclic)).toEqual([]);
	});

	it('src 的一级目录与根层文件都与矩阵登记一致（新模块必须先定层）', () => {
		const directories = readdirSync(SRC, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		const rootFiles = readdirSync(SRC, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
			.map((entry) => entry.name.replace(/\.ts$/, ''))
			.sort();

		expect(
			directories,
			'src/ 下出现未在 scripts/module-boundaries.mjs 登记的一级目录：' +
				'新模块必须先定层（MODULE_GROUPS）再导代码',
		).toEqual([...MODULE_GROUPS].sort());
		expect(
			rootFiles,
			'src/ 根层文件即「组合根」，新增/改名必须同步 COMBO_ROOT_MODULES（K51）',
		).toEqual([...COMBO_ROOT_MODULES].sort());
	});

	it('每条相对 import 都能解析到真实文件（无陈旧路径）', () => {
		expect(GRAPH.unresolved).toEqual([]);
	});

	it('跨组 import 落在矩阵许可集内（按解析后的真实路径判层，与写法深浅无关）', () => {
		const violations = IMPORT_EDGES.flatMap((edge) => {
			const fromGroup = moduleGroupOf(edge.from);
			const toGroup = moduleGroupOf(edge.to);
			if (fromGroup === null || toGroup === null || fromGroup === toGroup) {
				return [];
			}
			return allowedTargets(fromGroup).includes(toGroup)
				? []
				: [
						`${relPath(edge.from)} → ${relPath(edge.to)}` +
							`（${fromGroup} 不得依赖 ${toGroup}）`,
					];
		});
		expect(
			violations,
			'以下跨组依赖不在 K51 许可集内（矩阵见 scripts/module-boundaries.mjs）：\n' +
				violations.join('\n'),
		).toEqual([]);
	});

	it('组合根只被组合根引用（值依赖；类型引用按 K51 豁免）', () => {
		const violations = IMPORT_EDGES.filter(
			(edge) =>
				COMBO_ROOT_FILES.has(edge.to) &&
				!COMBO_ROOT_FILES.has(edge.from) &&
				!edge.typeOnly,
		).map((edge) => `${relPath(edge.from)} → ${relPath(edge.to)}（值导入）`);
		expect(
			violations,
			'组合根（main/commands/settings/creation）只能被组合根本身引用：\n' +
				violations.join('\n'),
		).toEqual([]);
	});

	it('值依赖图无环（含组内成环——eslint 的说明符匹配看不见这类环）', () => {
		const graph = new Map<string, string[]>(
			SRC_FILES.map((file) => [file, [] as string[]]),
		);
		for (const edge of IMPORT_EDGES) {
			if (edge.typeOnly || !isInsideSrc(edge.to)) {
				continue;
			}
			graph.get(edge.from)?.push(edge.to);
		}
		const cycles = findCycles(graph).map((cycle) =>
			cycle.map(relPath).join(' → '),
		);
		expect(
			cycles,
			'以下依赖环破坏了「单向」——组内环请拆到更下层或抽出公共模块：\n' +
				cycles.join('\n'),
		).toEqual([]);
	});

	it('矩阵自身是 DAG（新增反向边会同时被 lint 与测试拦下）', () => {
		const graph = new Map<string, string[]>(
			MODULE_GROUPS.map((group) => [group, [...MODULE_DEPENDENCIES[group]]]),
		);
		expect(findCycles(graph)).toEqual([]);
	});

	it('domain 零外部依赖（裸说明符一个都不允许）', () => {
		const violations = SRC_FILES.filter(
			(file) => moduleGroupOf(file) === 'domain',
		).flatMap((file) =>
			collectSpecifiers(file)
				.filter(({ specifier }) => !specifier.startsWith('.'))
				.map(({ specifier }) => `${relPath(file)} → ${specifier}`),
		);
		expect(violations).toEqual([]);
	});
});
