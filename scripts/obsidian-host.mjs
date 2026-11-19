/** 独立 Obsidian 验证库；仅复制运行时更新包和指定插件，不触碰用户的日常库。 */
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

export async function launchObsidianHost(markdown, plugins) {
	const executable = process.env.MINDMAP_OBSIDIAN_BIN || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
	await access(executable);
	const directory = await mkdtemp(join(tmpdir(), 'mindmap-plugin-e2e-'));
	const profile = join(directory, 'profile'); const vault = join(directory, 'vault');
	await mkdir(profile); await mkdir(join(vault, '.obsidian/plugins'), { recursive: true });
	const data = process.env.MINDMAP_OBSIDIAN_DATA || join(homedir(), 'Library/Application Support/obsidian');
	for (const name of (await readdir(data)).filter(name => /^obsidian-[\d.]+\.asar$/.test(name))) {
		await copyFile(join(data, name), join(profile, name));
	}
	for (const plugin of plugins) {
		const target = join(vault, '.obsidian/plugins', plugin.id); await mkdir(target);
		for (const name of ['main.js', 'styles.css', 'manifest.json']) await copyFile(join(plugin.path, name), join(target, name));
	}
	await writeFile(join(profile, 'obsidian.json'), JSON.stringify({ vaults: { mindmape2e0000001: { path: vault, ts: Date.now(), open: true } } }));
	await writeFile(join(vault, '.obsidian/app.json'), JSON.stringify({ defaultViewMode: 'preview', livePreview: true }));
	await writeFile(join(vault, '.obsidian/community-plugins.json'), JSON.stringify(plugins.map(plugin => plugin.id)));
	await writeFile(join(vault, 'Test.mindmap.md'), markdown);
	const log = await open(join(directory, 'obsidian.log'), 'w');
	const child = spawn(executable, ['--user-data-dir=' + profile, '--remote-debugging-port=0'], { stdio: ['ignore', log.fd, log.fd] });
	let browser; let launchError;
	child.on('error', error => { launchError = error; });
	const close = async () => { try { await browser?.close(); } finally { child.kill('SIGTERM'); await log.close(); } };
	try {
		let port;
		for (let attempt = 0; attempt < 120; attempt++) {
			if (launchError) throw launchError;
			if (child.exitCode !== null) throw new Error('Obsidian exited: ' + directory);
			const active = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
			if (active) { port = Number(active.split('\n')[0]); break; }
			await delay(250);
		}
		if (!port) throw new Error('Obsidian debug endpoint unavailable: ' + directory);
		browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
		const context = browser.contexts()[0]; const page = context.pages()[0] || await context.waitForEvent('page');
		page.setDefaultTimeout(60000);
		await page.waitForFunction(() => window.app?.vault?.adapter?.basePath);
		if (await page.evaluate(() => app.vault.adapter.basePath) !== vault) throw new Error('Unexpected vault; test aborted');
		await page.getByText(/^(信任仓库作者并启用插件|Trust author and enable plugins)$/).click();
		await page.waitForFunction(ids => ids.every(id => app.plugins.plugins[id]) && app.workspace.layoutReady, plugins.map(plugin => plugin.id));
		await page.evaluate(() => {
			const win = require('@electron/remote').getCurrentWindow();
			win.webContents.setBackgroundThrottling(false); win.showInactive();
		});
		return { page, directory, vault, close };
	} catch (error) { await close(); throw error; }
}
