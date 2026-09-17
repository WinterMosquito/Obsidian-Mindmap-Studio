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
 * 4. `README.md` 存在且非空。
 *
 * 退出码：0 = 全部通过；1 = 任一检查失败（打印 `::error::` 供 Actions 标注）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

/** @type {string[]} */
const errors = [];

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

if (errors.length > 0) {
	for (const message of errors) {
		console.error(`::error::${message}`);
	}
	process.exit(1);
}

console.log(
	`release metadata OK：versions.json ${String(Object.keys(versions ?? {}).length)} 条，` +
		`manifest.version ${String(manifest?.version)}（minAppVersion ${String(manifest?.minAppVersion)}）`,
);
