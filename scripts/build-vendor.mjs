#!/usr/bin/env node
/**
 * vendor/simple-mind-map.cjs 重打包脚本（配方与维护流程见 vendor/BUILD.md）。
 *
 * 配方（与 2026-09-25 手工重打包一致）：
 *   esbuild <entry> --bundle --format=cjs --minify --target=es2021 --legal-comments=inline
 *
 * 与手工打包的唯一区别：源码固定取自 **vendor/upstream/**（fix.3 原样入仓 +
 * 自有补丁），不依赖 node_modules 里临时安装的 simple-mind-map——重打包因此
 * 在本仓库内完全可复现（前提：打包面依赖已安装，见 BUILD.md 依赖清单）。
 *
 * 用法：
 *   node scripts/build-vendor.mjs          打包并写入 vendor/simple-mind-map.cjs
 *   node scripts/build-vendor.mjs --check  只打包到内存，与现有产物比对（不写入，
 *                                          不一致时退出码 1 并打印差异摘要）
 *
 * 打包后须人工同步两处 sha256 常量（脚本会打印实际值供核对）：
 *   - vendor/BUILD.md「产物字节级身份」；
 *   - tests/vendor-contract.test.ts 的 EXPECTED_SHA256。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const ROOT = join(import.meta.dirname, '..');
const BUNDLE_PATH = join(ROOT, 'vendor', 'simple-mind-map.cjs');

/**
 * 打包入口：8 个具名导出（顺序与 vendor/BUILD.md「入口仅导出 8 个符号」
 * 登记一致；`Export.js` 的默认导出类真实名是 `Export`，此处按出口名
 * `DoExport` 重命名——与 d.cts 声明面一致）。
 */
const ENTRY = [
	// 自有补丁（副作用 import，须位于引擎模块声明之前）：svg.js 属性写同值短路，
	// 见 vendor/patches/svg-attr-shortcircuit.js 与 vendor/BUILD.md「补丁清单」。
	// ESM 求值按 import 声明顺序深度优先；引擎模块顶层只定义类，元素创建在运行时，
	// 故此处只需保证 patch 在 bundle 任何求值之前完成原型包装。
	"import './vendor/patches/svg-attr-shortcircuit.js';",
	"export { default as MindMap } from './vendor/upstream/index.js';",
	"export { default as DoExport } from './vendor/upstream/src/plugins/Export.js';",
	"export { default as Select } from './vendor/upstream/src/plugins/Select.js';",
	"export { default as TouchEvent } from './vendor/upstream/src/plugins/TouchEvent.js';",
	"export { default as AssociativeLine } from './vendor/upstream/src/plugins/AssociativeLine.js';",
	"export { default as KeyboardNavigation } from './vendor/upstream/src/plugins/KeyboardNavigation.js';",
	"export { default as Search } from './vendor/upstream/src/plugins/Search.js';",
	"export { default as Drag } from './vendor/upstream/src/plugins/Drag.js';",
	'',
].join('\n');

/** LF 归一（跨平台字节可比；理由见 vendor/BUILD.md 哈希口径说明）。 */
const lfNormalize = (text) => text.replace(/\r\n/g, '\n');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const result = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: ROOT,
		sourcefile: 'vendor-entry.mjs',
		loader: 'js',
	},
	bundle: true,
	format: 'cjs',
	minify: true,
	target: 'es2021',
	legalComments: 'inline',
	write: false,
});

const next = lfNormalize(result.outputFiles[0].text);
const nextSha = sha256(next);
const nextBytes = Buffer.byteLength(next, 'utf8');

const checkOnly = process.argv.includes('--check');
const prevExists = existsSync(BUNDLE_PATH);
const prev = prevExists ? lfNormalize(readFileSync(BUNDLE_PATH, 'utf8')) : null;
const prevSha = prev ? sha256(prev) : null;

console.log(`[build-vendor] 新产物  sha256=${nextSha}  ${nextBytes} B`);

if (checkOnly) {
	if (!prevExists) {
		console.error('[build-vendor] --check：现有产物不存在，无法比对');
		process.exit(1);
	}
	console.log(`[build-vendor] 现有产物 sha256=${prevSha}  ${Buffer.byteLength(prev, 'utf8')} B`);
	if (prevSha === nextSha) {
		console.log('[build-vendor] ✅ --check 通过：重打包与现有产物字节一致（LF 归一）');
		process.exit(0);
	}
	console.error(
		`[build-vendor] ❌ --check 失败：字节不一致（差 ${nextBytes - Buffer.byteLength(prev, 'utf8')} B）`,
	);
	console.error('[build-vendor] 请排查：① vendor/upstream 是否含预期外修改；② esbuild 版本；');
	console.error('[build-vendor] ③ 若为预期补丁改动，去掉 --check 正常打包并同步两处 sha256 常量。');
	process.exit(1);
}

writeFileSync(BUNDLE_PATH, next, 'utf8');
console.log(`[build-vendor] 已写入 ${BUNDLE_PATH}`);
if (prevSha === nextSha) {
	console.log('[build-vendor] ℹ️ 与写入前字节一致（幂等重打包）');
} else if (prevSha) {
	console.warn(
		`[build-vendor] ⚠️ 字节已变化（写入前 sha256=${prevSha}）——若含补丁改动属预期，` +
			'请同步 vendor/BUILD.md 与 tests/vendor-contract.test.ts 的 sha256 常量。',
	);
}
