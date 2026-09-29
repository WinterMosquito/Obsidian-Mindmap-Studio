#!/usr/bin/env node
/**
 * 发布元数据护栏（CI：`.github/workflows/lint.yml` 与 `release.yml` 都调用）。
 *
 * **为什么需要它**：本仓库的 eslint 配置把 `versions.json` 放进 `globalIgnores`，
 * 而官方 `obsidianmd/obsidian-workflows` 对它有形状校验（JSON 非法 / 非对象 =
 * **error**，会阻断其 release 流程）⇒ 这条检查在本仓库此前**没有任何替代**。
 * README 同理（官方 repo-checks 对缺失或空 README 报 error）。
 *
 * 检查项：
 * 1. `versions.json` 存在、为合法 JSON **对象**、键与值均为 semver `x.y.z`；
 * 2. `manifest.json` 的 `version` 必须出现在 `versions.json` 中；
 * 3. **当前**版本的值必须等于 `manifest.json` 的 `minAppVersion`
 *    （历史版本的值可以合法地更低，故**不**要求全表一致）；
 * 4. `README.md` 存在且非空；
 * 5. **License**：缺失/空 = error、识别不出 OSI 许可 = warning
 *    （分级对齐官方 `obsidian-workflows` 的 repo-checks：
 *    "error if missing, warn if non-OSI"，见其 README「What It Checks」）。
 *
 * 退出码：0 = 全部通过（warning 不阻断）；1 = 任一 error（打印 `::error::`
 * 供 Actions 标注；warning 打印 `::warning::`）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * License 文件的候选文件名（按优先级）。
 * 官方 repo-checks 只在仓库根找 license 文件；常见命名都接受（含 `.md`/`.txt`
 * 与 `COPYING`——GNU 系项目的传统命名）。
 */
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];

/**
 * OSI 许可关键词（宽松识别：命中任一即视为 OSI 许可）。
 * 只做「是不是 OSI 许可」的粗判（官方该检查也只是 warn 级），不做全文比对——
 * 逐字比对会随各项目措辞差异大量误报。
 */
const OSI_LICENSE_HINT =
	/\b(MIT|Apache|BSD|GPL|LGPL|AGPL|MPL|ISC|Unlicense|Zlib|EPL|Artistic|0BSD|MS-PL|BSL)\b/i;

/** @type {string[]} */
const errors = [];

/** @type {string[]} */
const warnings = [];

/** 读取并解析仓库根下的 JSON；失败时记录错误并返回 null */
function readJson(relativePath) {
	try {
		return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
	} catch (error) {
		errors.push(`${relativePath} 读取或解析失败：${error.message}`);
		return null;
	}
}

const manifest = readJson('manifest.json');
const versions = readJson('versions.json');

if (versions !== null) {
	if (typeof versions !== 'object' || Array.isArray(versions)) {
		errors.push('versions.json 必须是 JSON 对象（version → minAppVersion）');
	} else {
		for (const [version, minAppVersion] of Object.entries(versions)) {
			if (!SEMVER.test(version)) {
				errors.push(`versions.json 的键不是 semver x.y.z：${version}`);
			}
			if (typeof minAppVersion !== 'string' || !SEMVER.test(minAppVersion)) {
				errors.push(
					`versions.json[${version}] 的值不是 semver x.y.z：${String(minAppVersion)}`,
				);
			}
		}
		if (
			manifest !== null &&
			typeof manifest.version === 'string' &&
			!(manifest.version in versions)
		) {
			errors.push(
				`manifest.json 的 version（${manifest.version}）不在 versions.json 中` +
					'——Obsidian 依该表决定用户升级时要求的最低 app 版本',
			);
		}
		if (
			manifest !== null &&
			typeof manifest.version === 'string' &&
			typeof manifest.minAppVersion === 'string'
		) {
			const current = versions[manifest.version];
			if (current !== undefined && current !== manifest.minAppVersion) {
				errors.push(
					`versions.json["${manifest.version}"] = ${String(current)}，` +
						`与 manifest.json 的 minAppVersion（${manifest.minAppVersion}）不一致`,
				);
			}
		}
	}
}

try {
	// 用「有无非空白内容」而非文件大小：`size === 0` 会被只有一个换行符的
	// 空文件绕过（`Set-Content -Value ''` 就会产生这种文件）。
	if (readFileSync(join(ROOT, 'README.md'), 'utf8').trim().length === 0) {
		errors.push('README.md 没有有效内容（空文件或只有空白字符）');
	}
} catch {
	errors.push('README.md 不存在或不可读');
}

// ---- License（对齐官方 repo-checks：缺失 = error，非 OSI = warn）----
// 为什么必须有：发布资产里带 LICENSE（见 release.yml），缺了它既不满足官方
// 校验，也让 vendored 代码（simple-mind-map 及其依赖）的分发许可声明无处可依。
const licenseFile = LICENSE_FILES.find((name) => {
	try {
		return readFileSync(join(ROOT, name), 'utf8').trim().length > 0;
	} catch {
		return false;
	}
});

if (licenseFile === undefined) {
	errors.push(
		`未找到 License 文件（根目录需有其一：${LICENSE_FILES.join(' / ')}，且内容非空）`,
	);
} else {
	try {
		const text = readFileSync(join(ROOT, licenseFile), 'utf8');
		// 只看前若干行：许可名通常出现在文件头（正文里出现关键词不足以证明）
		const head = text.slice(0, 2000);
		if (!OSI_LICENSE_HINT.test(head)) {
			warnings.push(
				`${licenseFile} 未识别出 OSI 许可（社区目录对非 OSI 许可会告警）；` +
					'如确为 OSI 许可，请确认文件头含许可名称',
			);
		}
	} catch (error) {
		errors.push(`${licenseFile} 读取失败：${error.message}`);
	}
}

for (const message of warnings) {
	console.warn(`::warning::${message}`);
}

if (errors.length > 0) {
	for (const message of errors) {
		console.error(`::error::${message}`);
	}
	process.exit(1);
}

console.log(
	`release metadata OK：versions.json ${String(Object.keys(versions ?? {}).length)} 条，` +
		`manifest.version ${String(manifest?.version)}（minAppVersion ${String(manifest?.minAppVersion)}），` +
		`License ${licenseFile ?? '缺失'}${warnings.length > 0 ? `（${String(warnings.length)} 条告警）` : ''}`,
);
