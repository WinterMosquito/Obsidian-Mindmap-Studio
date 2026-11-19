/** 真实已安装 TikZJax + 配套 CodeTab 的交互、正文、撤销和导出回归。 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchObsidianHost } from './obsidian-host.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const codeTab = process.env.CODE_TAB_PLUGIN;
const tikz = process.env.TIKZJAX_PLUGIN;
if (!codeTab || !tikz) throw new Error('Set CODE_TAB_PLUGIN and TIKZJAX_PLUGIN to the plugin artifact directories');
const tex = process.env.TIKZ_SOURCE ? await readFile(process.env.TIKZ_SOURCE, 'utf8')
	: '\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0) rectangle (3,2);\n\\node at (1.5,1) {Diagram};\n\\end{tikzpicture}\n\\end{document}';
const tab = 'tab: Short\n```shell\necho short\n```\n\ntab: Tall\n' + Array.from({ length: 25 }, (_, i) => 'line ' + i).join('\n');
const initial = '---\nMindmap: Mindmap\nMindmap Layout: logical\n---\n\n## Diagram\n```tikz\n' + tex + '\n```\n\n## Tabs\n````tab\n' + tab + '\n````\n';
const host = await launchObsidianHost(initial, [
	{ id: 'obsidian-code-tab', path: codeTab }, { id: 'obsidian-tikzjax', path: tikz }, { id: 'mindmap-studio', path: root },
]);
const { page, vault, directory } = host;
const results = []; const errors = []; const diagnostics = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
	if (message.type() === 'error') errors.push(message.text());
	else if (['warning', 'warn'].includes(message.type())) diagnostics.push(message.text());
});
const fileContent = () => readFile(join(vault, 'Test.mindmap.md'), 'utf8');
try {
	if (process.env.NATIVE_TIKZ_BASELINE) {
		await page.evaluate(async source => {
			const file = await app.vault.create('Plain.md', '```tikz\n' + source + '\n```');
			const leaf = app.workspace.getLeaf(true); await leaf.openFile(file);
		}, tex);
		await page.waitForFunction(() => [...document.querySelectorAll('.block-language-tikz svg')].some(svg => svg.querySelector('path,use') && !svg.querySelector('animate')));
		console.log('NATIVE BASELINE TIKZ OK');
	}
	await page.evaluate(async () => {
		const file = app.vault.getFileByPath('Test.mindmap.md'); const leaf = app.workspace.getLeaf(true);
		await leaf.openFile(file); await leaf.setViewState({ type: 'mindmap-view', state: { file: file.path } });
		window.testMindMapView = leaf.view;
		const registry = app.embedRegistry; const original = registry.getEmbedCreator;
		registry.getEmbedCreator = function (...args) {
			const create = original.apply(this, args);
			return (...params) => (window.testCodeTabEditor = create(...params));
		};
	});
	await page.waitForFunction(() => document.querySelector('.mindmap-plugin-live.code-tab'));
	await page.waitForFunction(() => [...document.querySelectorAll('.mindmap-plugin-block svg')].some(svg => svg.querySelectorAll('path,use,text').length > 0 && !svg.querySelector('animate')));
	await page.evaluate(() => window.testMindMapView.mindMap.view.fit());
	assert.equal(await fileContent(), initial); results.push('Opening plugins does not rewrite Markdown');
	const group = page.locator('.mindmap-canvas-container .mindmap-plugin-live.code-tab').first();
	await group.getByRole('tab', { name: 'Tall', exact: true }).click();
	await page.waitForFunction(() => {
		const group = document.querySelector('.mindmap-plugin-live.code-tab');
		const slot = group?.closest('.mindmap-plugin-block'); const fo = slot?.closest('foreignObject');
		return group?.textContent.includes('line 24') && fo?.height.baseVal.value >= group.offsetHeight;
	});
	assert.equal(await fileContent(), initial); results.push('Tab switch grows node without editing the file');
	await group.getByRole('tab', { name: 'Short', exact: true }).click();
	await group.locator('pre code').filter({ visible: true }).first().click();
	await group.locator('.code-tab__native-editor .cm-content').waitFor();
	await group.locator('.code-tab__native-editor .cm-content').focus();
	await page.evaluate(() => window.testCodeTabEditor.editor.setValue('```shell\n' + Array.from({ length: 35 }, (_, i) => 'echo ' + i).join('\n') + '\n```'));
	await page.waitForTimeout(250);
	assert(await page.evaluate(() => !!document.activeElement.closest('.mindmap-plugin-live')), 'Node re-layout retains editor focus');
	results.push('Editor growth preserves the live component and keyboard focus');
	await page.evaluate(() => window.testCodeTabEditor.editor.setValue('```shell\necho edited\n```'));
	await group.locator('.code-tab__native-editor .cm-content').press('Meta+Enter');
	await page.waitForFunction(async () => (await app.vault.read(app.vault.getFileByPath('Test.mindmap.md'))).includes('echo edited'));
	const edited = await fileContent(); assert(edited.includes(tex)); assert(edited.includes('````tab'));
	results.push('CodeTab edits save through the document session with TikZ source unchanged');
	await page.evaluate(async () => { window.testMindMapView.undo(); await window.testMindMapView.session.flush(); });
	await page.waitForFunction(async original => (await app.vault.read(app.vault.getFileByPath('Test.mindmap.md'))) === original, initial);
	results.push('Shared undo restores the original Markdown');
	await page.waitForFunction(() => document.querySelector('.mindmap-canvas-container .mindmap-plugin-live.code-tab'));
	await page.waitForTimeout(300);
	await group.getByTestId('code-tab-add').click();
	await page.waitForFunction(async () => (await app.vault.read(app.vault.getFileByPath('Test.mindmap.md'))).includes('tab: 标签3'));
	await group.getByRole('tab', { name: '标签3', exact: true }).dblclick();
	const rename = group.getByTestId('code-tab-rename');
	await rename.fill('Hosted title'); await rename.press('Enter');
	await page.waitForFunction(async () => (await app.vault.read(app.vault.getFileByPath('Test.mindmap.md'))).includes('tab: Hosted title'));
	await page.evaluate(async () => { window.testMindMapView.undo(); await window.testMindMapView.session.flush(); });
	await group.getByRole('tab', { name: '标签3', exact: true }).waitFor();
	await page.evaluate(async () => { window.testMindMapView.undo(); await window.testMindMapView.session.flush(); });
	await page.waitForFunction(async original => (await app.vault.read(app.vault.getFileByPath('Test.mindmap.md'))) === original, initial);
	results.push('Adding and renaming tabs use the shared document undo timeline');
	await group.getByRole('tab', { name: 'Short', exact: true }).click();
	await page.evaluate(async () => {
		const original = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function () {
			if (this.download) { window.testSVG = fetch(this.href).then(r => r.text()); return; }
			return original.call(this);
		};
		const exporter = window.testMindMapView.mindMap.doExport;
		const originalExport = exporter.export.bind(exporter);
		exporter.export = async (...args) => {
			const result = await originalExport(...args);
			if (typeof result === 'string') window.testSVG = result.startsWith('<') ? Promise.resolve(result) : fetch(result).then(r => r.text());
			else if (result?.text) window.testSVG = result.text();
			return result;
		};
		window.testMindMapView.plugin.settings.exportImageFormat = 'svg';
		await window.testMindMapView.exportImage();
	});
	const svg = await page.evaluate(async () => await window.testSVG);
	assert(svg && svg.includes('code-tab') && svg.includes('mindmap-plugin-block'));
	assert(await page.evaluate(source => {
		const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
		return !doc.querySelector('parsererror') && !doc.querySelector('.mindmap-plugin-block script') &&
			!!doc.querySelector('.mindmap-plugin-block svg path') &&
			!!doc.querySelector('.mindmap-plugin-block .code-tab [role="tab"]') &&
			!!doc.querySelector('.mindmap-plugin-block .code-tab pre code');
	}, svg), 'Export contains final TikZ geometry and frozen tab content');
	await writeFile(join(directory, 'export.svg'), svg); results.push('SVG export includes frozen CodeTab and TikZ content');
	await page.screenshot({ path: join(directory, 'diagram.png'), fullPage: true });
	await page.evaluate(async tabSource => {
		const file = await app.vault.create('ReadOnly.md', '`````mindmap\n## Tabs\n````tab\n' + tabSource + '\n````\n`````\n');
		await app.workspace.getLeaf(true).openFile(file);
	}, tab);
	const readOnly = page.locator('.block-language-mindmap .mindmap-plugin-live.code-tab').first();
	await readOnly.getByRole('tab', { name: 'Tall', exact: true }).click();
	await readOnly.getByTestId('code-tab-panel').filter({ visible: true }).getByText('line 24', { exact: false }).waitFor();
	assert.equal(await readOnly.getByTestId('code-tab-add').count(), 0);
	await readOnly.getByRole('tab', { name: 'Short', exact: true }).dblclick();
	await readOnly.locator('pre code').filter({ visible: true }).first().click();
	assert.equal(await readOnly.getByTestId('code-tab-editor').count(), 0);
	assert.equal(await readOnly.getByTestId('code-tab-rename').count(), 0);
	assert.equal(await fileContent(), initial);
	results.push('Read-only embeds allow tab switching without editing controls or writes');
	assert.deepEqual(errors, [], 'No runtime errors in the actual Obsidian host');
	await writeFile(join(directory, 'report.json'), JSON.stringify({ ok: true, results, errors, diagnostics }, null, 2));
	console.log('PASS:',results.length,'checks; artifacts:',directory);
} catch (error) {
	await writeFile(join(directory, 'failure.html'), await page.content()).catch(() => undefined);
	await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined);
	await writeFile(join(directory, 'report.json'), JSON.stringify({ ok: false, results, errors, diagnostics, error: String(error) }, null, 2));
	console.error('FAILED; artifacts:',directory); throw error;
} finally { await host.close(); }
