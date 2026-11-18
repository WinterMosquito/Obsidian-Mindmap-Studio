/** 在隔离包中执行真实版本脚本，验证路径迁移不会写错位置或重复写盘。 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const VERSION_FILES = ['manifest.json', 'versions.json', 'package-lock.json'] as const;

function fixture(version: string): string {
	const root = mkdtempSync(join(tmpdir(), 'mindmap-version-path-'));
	mkdirSync(join(root, 'scripts'));
	mkdirSync(join(root, 'elsewhere'));
	writeFileSync(join(root, 'scripts/version-bump.mjs'), readFileSync(
		new URL('../../scripts/version-bump.mjs', import.meta.url), 'utf8',
	));
	writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
	writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: '0.3.3', minAppVersion: '1.13.0' }));
	writeFileSync(join(root, 'versions.json'), JSON.stringify({ '0.3.3': '1.12.0' }));
	writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: '0.3.3', packages: { '': { version: '0.3.3' } } }));
	return root;
}

function run(root: string) {
	return spawnSync(process.execPath, [join(root, 'scripts/version-bump.mjs')], {
		cwd: join(root, 'elsewhere'), encoding: 'utf8',
	});
}

function readJson(root: string, name: string): unknown {
	return JSON.parse(readFileSync(join(root, name), 'utf8'));
}

describe('版本同步脚本的迁移契约', () => {
	it('从其它工作目录运行，更新包根版本与锁文件并保留历史版本', () => {
		const root = fixture('0.3.4');
		try {
			const result = run(root);
			expect(result.status, result.stderr).toBe(0);
			expect(readJson(root, 'manifest.json')).toEqual({ version: '0.3.4', minAppVersion: '1.13.0' });
			expect(readJson(root, 'versions.json')).toEqual({ '0.3.3': '1.12.0', '0.3.4': '1.13.0' });
			expect(readJson(root, 'package-lock.json')).toEqual({ version: '0.3.4', packages: { '': { version: '0.3.4' } } });
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it('重复执行保持文件内容和修改时间不变', () => {
		const root = fixture('0.3.4');
		try {
			expect(run(root).status).toBe(0);
			const before = VERSION_FILES.map(name => ({
				raw: readFileSync(join(root, name), 'utf8'),
				mtime: statSync(join(root, name), { bigint: true }).mtimeNs,
			}));
			const result = run(root);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain('三个文件均已是最新');
			expect(VERSION_FILES.map(name => ({
				raw: readFileSync(join(root, name), 'utf8'),
				mtime: statSync(join(root, name), { bigint: true }).mtimeNs,
			}))).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it('非法版本失败时不修改任何版本文件', () => {
		const root = fixture('invalid');
		try {
			const before = VERSION_FILES.map(name => readFileSync(join(root, name), 'utf8'));
			const result = run(root);
			expect(result.status).toBe(1);
			expect(VERSION_FILES.map(name => readFileSync(join(root, name), 'utf8'))).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});
