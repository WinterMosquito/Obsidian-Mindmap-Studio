#!/usr/bin/env node
/**
 * 社区目录 scanner ESLint 的**对照通道**（`npm run lint:scanner`）。
 *
 * 定位（2026-09-25，社区目录工作流优化轮）：
 * 本仓库的 ESLint 体系（`eslint.config.mts`：eslint-plugin-obsidianmd ^0.4.2 的
 * recommended + 项目自建边界，`--max-warnings 0`）实测**完全覆盖且严于**官方
 * `obsidianmd/obsidian-workflows` release 模式强制跑的 scanner ESLint 规则面
 * （`src/lint.ts:331-483`；探针双向对照：同一违规样本两侧问题集完全一致，
 * scanner 经 `toWarns` 把 recommended 降级而本地保持 error）。本脚本的价值
 * 因此**不是「补本地缺的检查」**，而是把这条对照关系**机械化**：
 * 1. 每次运行输出「**假如现在提交社区目录，JS/TS 面会扫出什么**」——
 *    有 error 级问题即非 0 退出（可直接作发布门禁）；
 * 2. **防收窄护栏**：若未来本地配置被无意改窄（规则关闭/ignores 扩大），
 *    本地 lint 仍可能全绿，但本通道会暴露差异——「本地绿 + 本通道红」
 *    即代表出现了真实缺口。
 *
 * 设计（逐条对齐官方 src/lint.ts）：
 * - **固定版本集**（官方 `SCANNER_ESLINT_DEPS`）：eslint 9.37.0 +
 *   eslint-plugin-obsidianmd 0.4.1 + typescript-eslint 8.61.1——刻意**不用**
 *   项目依赖版本（本地 0.4.2 比 scanner 固定 0.4.1 新；对照须用对侧版本）；
 * - **隔离安装**（官方 `createScannerDepsDir` 模式）：依赖装在本脚本专属的
 *   缓存目录（不触碰项目 package.json / node_modules），目录复用即跳过安装；
 * - **配置逐字照抄**官方 `buildScannerEslintConfig(true)`（hasTsconfig 分支，
 *   本仓库有 tsconfig.json ⇒ type-aware 规则启用）；唯一差异 = `IGNORES`
 *   追加 `vendor/**`——见下方「本项目特有适配」；
 * - 退出码：eslint 0 → 0；有 error 级问题 → 非 0（可直接作为门禁用）。
 *
 * 本项目特有适配（有意差异，登记于 AGENTS.md）：
 * - `vendor/**` 为**第三方源码入仓**（fix.3 + 自有补丁，见 vendor/BUILD.md），
 *   不是插件作者代码：其 .js 不入本仓库 tsconfig，官方配置的 projectService
 *   会对它们全部报「not found by the project service」解析错误（实测 78 条
 *   fatal），淹没真实结论。故本通道跳过 vendor——**边界**：若社区目录服务端
 *   确实扫描 vendored 源码，需以服务端报告为准（本地无法复刻，应对预案见
 *   AGENTS.md K81）。
 * - 官方配置显式声明的 `obsidianmd/regex-lookbehind` 在固定版本 0.4.1 上
 *   实测未触发（探针 `/(?<=a)b/` 两侧均不报）——照抄配置、以服务端为准。
 *
 * 用法：
 *   node scripts/scanner-lint.mjs          跑对照（有 error 级问题则退出码 1）
 *   node scripts/scanner-lint.mjs --stats  额外打印按规则聚合的统计表
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 官方 SCANNER_ESLINT_DEPS（src/lint.ts:176-180）——固定版本集，勿改 */
const SCANNER_DEPS = {
	eslint: '9.37.0',
	'eslint-plugin-obsidianmd': '0.4.1',
	'typescript-eslint': '8.61.1',
};

/**
 * 缓存目录：以固定版本集的哈希命名（版本变化即新目录，旧目录可由系统清理）。
 * 复用条件：node_modules/.package-lock.json 存在（npm 安装完成的标志）。
 */
const DEPS_DIR = join(
	tmpdir(),
	`obsidian-scanner-lint-${createHash('sha256').update(JSON.stringify(SCANNER_DEPS)).digest('hex').slice(0, 12)}`,
);

/** 官方 IGNORES（src/lint.ts:336 的 SCANNER_STYLELINT_CONFIG.ignoreFiles） */
const OFFICIAL_IGNORES = [
	'node_modules',
	'dist',
	'build',
	'pkg',
	'test-vault',
	'.obsidian',
	'**/.obsidian/**',
	'esbuild.config.mjs',
	'version-bump.mjs',
	'**/*.test.*',
	'**/*.tests.*',
	'**/*.spec.*',
	'**/*.specs.*',
	'**/test/**',
	'**/tests/**',
	'**/__tests__/**',
	'**/mocks/**',
	'**/__mocks__/**',
	'**/*.cjs',
	'**/*.mjs',
	'**/*.cts',
	'**/*.mts',
	'**/vite*',
	'**/scripts/**',
	'**/docs/**',
	'**/i18n/**',
	'**/i18next/**',
	'**/locale/**',
	'**/locales/**',
	'**/translations/**',
	'**/l10n/**',
	'.pnpm-store',
	'**/*.spec.ts',
	'**/testUtils**',
	'automation/**',
	'e2e-tests/**',
	// —— 本项目特有适配区（官方列表不含以下目录，理由各见注释）——
	// vendored 第三方源码（理由见文件头）
	'vendor/**',
	// vitest coverage 的生成物：lcov-report 含 6 个自带 JS（prettify / sorter /
	// block-navigation 等），官方场景不先生成 coverage 故其列表无此项；本仓库
	// lint.yml 在 lint:scanner **之前**跑 test:coverage（24.x 矩阵）⇒ 生成物被
	// type-aware 扫描、报「not found by the project service」——CI #57/#58 红的
	// 根因（本地按同序列 test:coverage → lint:scanner 已复现 6 errors）。
	'coverage',
	// verify:visual 的 --log-dir 产物（CI 在 lint:scanner 之后生成；此处防御性
	// 排除，避免本地工作区留存日志时的同型假红）
	'verify-visual-logs',
];

/** scanner ESLint 配置——逐字照抄官方 buildScannerEslintConfig(true)（IGNORES 除外） */
function buildScannerConfig() {
	return `import { cwd } from "node:process";
import { globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const IGNORES = ${JSON.stringify(OFFICIAL_IGNORES)};

function toWarns(config) {
  if (!config) return config;
  if (!Array.isArray(config) && typeof config[Symbol.iterator] === "function") {
    return [...config].map(toWarns);
  }
  if (Array.isArray(config)) return config.map(toWarns);
  const result = { ...config };
  if (result.extends) result.extends = toWarns(result.extends);
  if (result.rules) {
    result.rules = Object.fromEntries(
      Object.entries(result.rules).map(([key, value]) => {
        if (key.startsWith("eslint-comments/")) return [key, value];
        if (value === "error" || value === 2) return [key, "warn"];
        if (Array.isArray(value) && (value[0] === "error" || value[0] === 2)) return [key, ["warn", ...value.slice(1)]];
        return [key, value];
      })
    );
  }
  return result;
}

export default [
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "eslint.config.mjs",
            "eslint.config.mts",
          ]
        },
        tsconfigRootDir: cwd(),
        extraFileExtensions: [".json"]
      },
    },
  },
  ...toWarns(obsidianmd.configs.recommended),
  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
  },
  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",

      "no-undef": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",

      "obsidianmd/validate-manifest": "off",
      "obsidianmd/validate-license": "off",

      "obsidianmd/commands/no-command-in-command-id": "off",
      "obsidianmd/commands/no-plugin-id-in-command-id": "off",
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "eslint-comments/require-description": "error",
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "obsidianmd": obsidianmd,
    },
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      "obsidianmd/commands/no-command-in-command-id": "warn",
      "obsidianmd/commands/no-plugin-id-in-command-id": "warn",

      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": "error",
    }
  },
  globalIgnores(IGNORES),
  { ignores: ["eslint.config.scanner.mjs", "main.js", "styles.css", "manifest.json"] },
];
`;
}

/**
 * 定位 npm/npx 的 CLI 入口。
 *
 * 为什么不用裸 `npm`/`npx` 命令：
 * - Windows 上它们是 `.cmd` shim，Node 直接 spawn 报 EINVAL，经 `shell: true`
 *   又会触发 DEP0190（args 未转义）警告；
 * - 某些开发环境会注入用户级 npm 配置（实测：沙箱的 `allow-scripts` 白名单），
 *   经 shell 的调用会撞上 `EALLOWSCRIPTS` 策略错误。
 * 直接以 `process.execPath` 运行 CLI 入口即可同时绕开两者。候选按平台布局：
 * - Windows / 官方安装：`<node>/node_modules/npm/bin/*-cli.js`；
 * - Linux 发行版 / actions runner（hostedtoolcache）：`<node>/../lib/node_modules/npm/bin/*-cli.js`。
 * 全部缺失（版本管理器 fnm/volta 等）才回退 shell 模式（并以空 userconfig
 * 隔离用户级配置）。
 */
function npmCliCommand(tool) {
	const cli = `${tool}-cli.js`;
	const candidates = [
		join(dirname(process.execPath), 'node_modules', 'npm', 'bin', cli),
		join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', cli),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return { bin: process.execPath, prefixArgs: [candidate] };
		}
	}
	return null;
}

function runTool(tool, args, options) {
	const cli = npmCliCommand(tool);
	if (cli) {
		return exec(cli.bin, [...cli.prefixArgs, ...args], options);
	}
	return exec(tool, args, { ...options, shell: process.platform === 'win32' });
}

async function ensureScannerDeps() {
	const ready = join(DEPS_DIR, 'node_modules', '.package-lock.json');
	if (existsSync(ready)) {
		console.log(`[scanner-lint] 复用依赖缓存：${DEPS_DIR}`);
		return;
	}
	console.log(`[scanner-lint] 安装 scanner 依赖（固定版本集，隔离于项目）：${DEPS_DIR}`);
	mkdirSync(DEPS_DIR, { recursive: true });
	writeFileSync(
		join(DEPS_DIR, 'package.json'),
		JSON.stringify({ name: 'obsidian-scanner-lint', private: true, dependencies: SCANNER_DEPS }),
		'utf8',
	);
	// 空 userconfig：隔离开发机的用户级 npm 配置（勿依赖本机配置的具体内容）。
	// --ignore-scripts：三个依赖均为纯 JS（无原生构建步骤），跳过更稳。
	const emptyUserConfig = join(DEPS_DIR, '.npmrc');
	writeFileSync(emptyUserConfig, '', 'utf8');
	// 安装重试（CI 网络抖动防护，2026-09-25）：registry 请求偶发失败会让本脚本
	// 以非 0 退出、把 lint.yml 的 Node 24 矩阵整条拉红（release.yml 同步骤同提交
	// 却通过 = 瞬时性失败的实证）。最多 3 次、指数退避；npm install 幂等，
	// 半装状态在重试时自动补全。
	const maxAttempts = 3;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await runTool(
				'npm',
				['install', '--prefix', DEPS_DIR, '--userconfig', emptyUserConfig, '--no-fund', '--no-audit', '--ignore-scripts'],
				{ cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
			);
			return;
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error;
			}
			const waitMs = 2000 * attempt;
			console.warn(
				`[scanner-lint] 依赖安装第 ${attempt} 次失败，${waitMs}ms 后重试：${error instanceof Error ? error.message : String(error)}`,
			);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}
}

async function main() {
	const stats = process.argv.includes('--stats');

	await ensureScannerDeps();

	const configPath = join(DEPS_DIR, 'eslint.config.scanner.mjs');
	writeFileSync(configPath, buildScannerConfig(), 'utf8');

	const nodePath = [join(DEPS_DIR, 'node_modules'), join(ROOT, 'node_modules')].join(
		process.platform === 'win32' ? ';' : ':',
	);

	const eslintArgs = [
		'--config',
		configPath,
		'--no-error-on-unmatched-pattern',
		...(stats ? ['--format', 'json'] : []),
		'.',
	];

	console.log('[scanner-lint] 运行 scanner ESLint（官方规则面，type-aware）...');
	let stdout = '';
	let exitCode = 0;
	// 直连 eslint 的 CLI 入口（node + <DEPS_DIR>/node_modules/eslint/bin/eslint.js）：
	// 不经 npx 的「bin 解析 → 项目 node_modules 优先？」歧义（npx 可能解析到项目
	// 自带的 eslint 9.x 而非 scanner 固定版本；这也是本地（node+cli 路径）与 CI
	// （曾走 npx 回退路径）行为可能不一致的根源）。入口缺失时回退 npx。
	const eslintJs = join(DEPS_DIR, 'node_modules', 'eslint', 'bin', 'eslint.js');
	const launcher = existsSync(eslintJs)
		? exec(process.execPath, [eslintJs, ...eslintArgs], {
				cwd: ROOT,
				maxBuffer: 128 * 1024 * 1024,
				env: { ...process.env, NODE_PATH: nodePath },
			})
		: runTool('npx', ['--prefix', DEPS_DIR, 'eslint', ...eslintArgs], {
				cwd: ROOT,
				maxBuffer: 128 * 1024 * 1024,
				env: { ...process.env, NODE_PATH: nodePath },
			});
	try {
		const result = await launcher;
		stdout = result.stdout;
	} catch (error) {
		// eslint 有 error 级问题时以非 0 退出——stderr/stdout 都可能带报告
		stdout = `${error.stdout ?? ''}`;
		process.stderr.write(`${error.stderr ?? ''}`);
		exitCode = typeof error.code === 'number' ? error.code : 1;
	}

	if (stats && stdout.trim()) {
		try {
			const report = JSON.parse(stdout);
			const byRule = new Map();
			let errors = 0;
			let warnings = 0;
			for (const file of report) {
				for (const message of file.messages) {
					const key = `${message.ruleId ?? '(fatal)'} [${message.severity === 2 ? 'error' : 'warning'}]`;
					byRule.set(key, (byRule.get(key) ?? 0) + 1);
					if (message.severity === 2) errors++;
					else warnings++;
				}
			}
			console.log(`[scanner-lint] 文件 ${report.length} 个｜error ${errors}｜warning ${warnings}`);
			for (const [key, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
				console.log(`  ${String(count).padStart(5)}  ${key}`);
			}
		} catch {
			process.stdout.write(stdout);
		}
	} else if (stdout) {
		process.stdout.write(stdout);
	}

	if (exitCode === 0) {
		console.log('[scanner-lint] ✅ 通过：项目源码满足社区目录 scanner 的 ESLint 规则面');
	} else {
		console.error('[scanner-lint] ❌ 未通过：见上方报告（error 级问题会阻断社区目录校验）');
	}
	process.exitCode = exitCode;
}

await main();
