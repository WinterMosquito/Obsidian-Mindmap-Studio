/** 真实时钟 Chrome 页面探针：CDP pipe 不依赖 WebSocket 包或 Node 的实验性全局对象。 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function dumpChromePage(chromePath, pagePath, profile, probeId) {
	const chrome = spawn(chromePath, [
		'--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions', '--disable-dev-shm-usage',
		'--allow-file-access-from-files', '--remote-debugging-pipe',
		'--window-size=1200,1400', '--force-device-scale-factor=1',
		`--user-data-dir=${profile}`, 'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
	const calls = new Map();
	let sequence = 0;
	let buffer = Buffer.alloc(0);
	let stderr = '';
	let finish;
	let rejectProbe;
	const complete = new Promise((resolve, reject) => { finish = resolve; rejectProbe = reject; });
	const timer = setTimeout(() => fail(new Error('Chrome page probe timeout: ' + stderr.slice(-1000))), 30000);
	const fail = error => {
		rejectProbe(error);
		for (const waiting of calls.values()) waiting.reject(error);
		calls.clear();
	};
	chrome.once('error', fail);
	chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });
	chrome.once('exit', (code, signal) => fail(new Error(`Chrome exited ${code}/${signal}: ${stderr.slice(-1000)}`)));
	chrome.stdio[4].on('data', chunk => {
		buffer = Buffer.concat([buffer, chunk]);
		let end;
		while ((end = buffer.indexOf(0)) >= 0) {
			const text = buffer.subarray(0, end).toString('utf8');
			buffer = buffer.subarray(end + 1);
			if (!text) continue;
			const message = JSON.parse(text);
			if (message.method === 'Runtime.exceptionThrown') {
				stderr += '\n' + JSON.stringify(message.params.exceptionDetails);
			}
			const waiting = calls.get(message.id);
			if (waiting) {
				calls.delete(message.id);
				if (message.error) waiting.reject(new Error(JSON.stringify(message.error)));
				else waiting.resolve(message.result);
			}
			if (message.method === 'Runtime.bindingCalled' && message.params.name === '__pageProbeDone') finish();
		}
	});
	const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
		const id = ++sequence;
		calls.set(id, { resolve, reject });
		chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
	});
	// complete 也处理启动/连接错误；立即登记 catch，避免先于 await 的拒绝成为未处理异常。
	complete.catch(() => {});
	try {
		const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
		const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
		await call('Runtime.enable', {}, sessionId);
		await call('Page.enable', {}, sessionId);
		await call('Runtime.addBinding', { name: '__pageProbeDone' }, sessionId);
		await call('Page.addScriptToEvaluateOnNewDocument', { source: `
(() => {
	let sent = false;
	const check = () => {
		if (sent) return;
		const text = document.getElementById(${JSON.stringify(probeId)})?.textContent;
		if (!text) return;
		try { if (typeof JSON.parse(text).ok === 'boolean') { sent = true; __pageProbeDone(text); } } catch {}
	};
	new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
	document.addEventListener('DOMContentLoaded', check);
})();` }, sessionId);
		await call('Page.navigate', { url: pathToFileURL(pagePath).href }, sessionId);
		await complete;
		const { result } = await call('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, sessionId);
		return result.value;
	} finally {
		clearTimeout(timer);
		if (chrome.exitCode === null) chrome.kill('SIGTERM');
	}
}
