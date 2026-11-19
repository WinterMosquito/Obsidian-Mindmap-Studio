/** 执行真实构建配置，锁住发布文件名、CSS import 汇总和开发监听。 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), 'mindmap-css-build-'));
	mkdirSync(join(root, 'src/ui/styles'), { recursive: true });
	mkdirSync(join(root, 'config'));
	writeFileSync(join(root, 'src/main.ts'), 'export const value = 1;');
	writeFileSync(join(root, 'src/ui/styles/index.css'), '@import "./component.css";\n.after { color: blue; }');
	writeFileSync(join(root, 'src/ui/styles/component.css'), '.component { width: 32px; }');
	writeFileSync(join(root, 'config/esbuild.config.mjs'), readFileSync(new URL('../../config/esbuild.config.mjs', import.meta.url)));
	symlinkSync(new URL('../../node_modules', import.meta.url), join(root, 'node_modules'), 'dir');
	return root;
}

/** 文件系统通知后读取完整输出；不轮询构建子进程。 */
function waitForCss(root: string, text: string): { done: Promise<void>; cancel: () => void } {
	let watcher: ReturnType<typeof watch>;
	let timer: ReturnType<typeof setNodeTimeout>;
	const cancel = (): void => { watcher.close(); clearNodeTimeout(timer); };
	const done = new Promise<void>((resolve, reject) => {
		watcher = watch(root, (_event, filename) => {
			if (filename !== 'styles.css') return;
			try {
				if (readFileSync(join(root, 'styles.css'), 'utf8').includes(text)) {
					cancel();
					resolve();
				}
			} catch { /* esbuild 可能尚未结束写入，等下一条 fs 通知 */ }
		});
		timer = setNodeTimeout(() => { cancel(); reject(new Error('CSS watch 未产出预期内容')); }, 5000);
	});
	return { done, cancel };
}

describe('CSS 发布与开发构建', () => {
	it('迁移后的 Stylelint 配置继续忽略仓库根目录的覆盖率 CSS', async () => {
		const result = await stylelint.lint({
			configFile: fileURLToPath(new URL('../../config/stylelint.config.mjs', import.meta.url)),
			codeFilename: fileURLToPath(new URL('../../coverage/config-migration.css', import.meta.url)),
			code: 'a { background: url("https://example.com/image.png"); }',
		});
		expect(result.results[0]?.ignored).toBe(true);
		expect(result.errored).toBe(false);
	});
	it('生产构建只产出 main.js / styles.css，展开 imports 且保持级联顺序', () => {
		const root = fixture();
		try {
			const result = spawnSync(process.execPath, [join(root, 'config/esbuild.config.mjs'), 'production'], { cwd: join(root, 'config'), encoding: 'utf8' });
			expect(result.status, result.stderr).toBe(0);
			const css = readFileSync(join(root, 'styles.css'), 'utf8');
			expect(css).not.toContain('@import');
			expect(css).toContain('width: 32px');
			expect(css.indexOf('.component')).toBeLessThan(css.indexOf('.after'));
			expect(readdirSync(root).filter((file) => /\.(js|css)$/.test(file)).sort()).toEqual(['main.js', 'styles.css']);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it('npm run dev 所用配置监听组件 CSS，修改后更新发布资产', async () => {
		const root = fixture();
		const first = waitForCss(root, 'width: 32px');
		const child = spawn(process.execPath, ['config/esbuild.config.mjs'], { cwd: root, stdio: 'ignore' });
		let update: ReturnType<typeof waitForCss> | undefined;
		try {
			await first.done;
			update = waitForCss(root, 'width: 47px');
			writeFileSync(join(root, 'src/ui/styles/component.css'), '.component { width: 47px; }');
			await update.done;
			expect(readFileSync(join(root, 'styles.css'), 'utf8')).not.toContain('@import');
		} finally {
			first.cancel();
			update?.cancel();
			if (child.exitCode === null && child.signalCode === null) {
				const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
				child.kill();
				await stopped;
			}
			rmSync(root, { recursive: true, force: true });
		}
	}, 12_000);
});
