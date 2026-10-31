/**
 * 版本号同步（`npm version patch|minor|major` 的 `version` 生命周期脚本）。
 *
 * 职责只有三件：把新版本写进 `manifest.json`、在 `versions.json` 里登记该版本对应的
 * `minAppVersion`（Obsidian 依该表判断升级时要求的最低 app 版本）、补齐 `package-lock.json`
 * 根版本（手工改版本号时漏它不会报错，只是 lock 与 `package.json` 不一致——2026-10-13 发
 * 0.2.1 时实际漏过一次，见 docs/agents/process.md「发布流程」）。
 *
 * 三条实现约束：
 * - **版本号以 `package.json` 为准**：`npm version` 先改 package.json 再跑本脚本，而
 *   `npm_package_version` 只在生命周期里存在——单跑 `node version-bump.mjs` 时它是
 *   undefined，直接赋给 `manifest.version` 会让 `JSON.stringify` **静默丢掉**该键。
 * - **路径锚定脚本自身**：不依赖 cwd（npm 保证 cwd = 包根，手工运行不一定）。
 * - **幂等**：`versions.json` 里已登记也按当前 `minAppVersion` 重算（改过 minAppVersion
 *   后旧值会滞留）；内容无变化则不写盘，不制造只剩 mtime 差异的改动。
 *
 * 需要人工补的两步（本脚本刻意不代劳）：`docs/release-notes-<版本>.md`（release.yml 的
 * tag 门禁硬校验其存在）与 `docs/markdown-mindmap-standard.md` 附录的 manifest 版本指针
 * （`tests/docs-standard.test.ts` 硬校验其等于 `manifest.version`）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
/** 与 scripts/check-release-metadata.mjs 同口径：只接受 x.y.z */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** 读 JSON 并保留原文（写回前做等值比较，避免无变化也重写） */
function readJsonWithRaw(name) {
	const raw = readFileSync(path.join(ROOT, name), 'utf8');
	return { value: JSON.parse(raw), raw };
}

/** 按仓库风格（制表符缩进 + 末尾换行）写回；内容一致则返回 false 且不碰文件 */
function writeJsonIfChanged(name, value, before) {
	const after = `${JSON.stringify(value, null, '\t')}\n`;
	// 换行符归一后比较：Windows 上 git 会把检出文件转成 CRLF，直接比原文会让
	// 「内容没变」误判成「变过」——每次发版都白改一次 mtime（git 里看不到差异，
	// 更容易让人以为脚本没生效）
	if (before.replace(/\r\n/g, '\n') === after) {
		return false;
	}
	writeFileSync(path.join(ROOT, name), after);
	return true;
}

const pkg = readJsonWithRaw('package.json').value;
const targetVersion = pkg.version ?? process.env.npm_package_version;
if (typeof targetVersion !== 'string' || !SEMVER.test(targetVersion)) {
	console.error(
		`version-bump：package.json 的 version 不是 x.y.z（读到 ${String(targetVersion)}），未做任何修改`,
	);
	process.exit(1);
}

const manifestFile = readJsonWithRaw('manifest.json');
const manifest = manifestFile.value;
const { minAppVersion } = manifest;
manifest.version = targetVersion;

const versionsFile = readJsonWithRaw('versions.json');
const versions = versionsFile.value;
versions[targetVersion] = minAppVersion;

const lockFile = readJsonWithRaw('package-lock.json');
const lock = lockFile.value;
lock.version = targetVersion;
const lockRoot = lock.packages?.[''];
if (lockRoot) {
	lockRoot.version = targetVersion;
}

const wrote = [
	['manifest.json', writeJsonIfChanged('manifest.json', manifest, manifestFile.raw)],
	['versions.json', writeJsonIfChanged('versions.json', versions, versionsFile.raw)],
	['package-lock.json', writeJsonIfChanged('package-lock.json', lock, lockFile.raw)],
];
const changed = wrote.filter(([, touched]) => touched).map(([name]) => name);

console.log(
	`version-bump：${targetVersion}（minAppVersion ${String(minAppVersion)}）——` +
		(changed.length > 0 ? `已更新 ${changed.join(' / ')}` : '三个文件均已是最新'),
);
console.log(
	`  待办：docs/release-notes-${targetVersion}.md；` +
		'docs/markdown-mindmap-standard.md 附录的 manifest 版本指针',
);
