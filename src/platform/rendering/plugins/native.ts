/** 官方 Markdown 渲染入口与可选宿主协议；不访问 app.plugins 或复制第三方运行时。 */
import { Component, MarkdownRenderer } from 'obsidian';
import type { App } from 'obsidian';

const CODEBLOCK_HOST_EVENT = 'obsidian-codeblock-render';

export interface CodeBlockHostRequest {
	version: 1;
	language: string;
	source: string;
	sourcePath: string;
	id: string;
	container: HTMLElement;
	component: Component;
	readOnly: boolean;
	onChange?: (expected: string, source: string | null) => Promise<void>;
	onEditingChange?: (editing: boolean) => void;
	handled: boolean;
	completion?: Promise<void>;
}

export interface PluginAdapter {
	language: string;
	mode: 'static' | 'live';
	host?: boolean;
	finishedEvent?: string;
}

/** 适配器只定义各插件的完成/交互特性，其余挂载、测量和导出由桥共享。 */
export const DEFAULT_PLUGIN_ADAPTERS: readonly PluginAdapter[] = [
	{ language: 'tikz', mode: 'static', finishedEvent: 'tikzjax-load-finished' },
	{ language: 'tab', mode: 'live', host: true },
];

export async function renderNativePlugin(
	app: App, request: CodeBlockHostRequest, adapter: PluginAdapter, signal: AbortSignal, attach?: () => void,
): Promise<void> {
	const root = request.container;
	const doc = root.ownerDocument;
	const win = doc.defaultView;
	if (!win) throw new Error('渲染窗口已关闭');
	let finish: (() => void) | null = null;
	let fail: (error: Error) => void = () => undefined;
	const stopped = new Promise<void>((_resolve, reject) => { fail = reject; });
	stopped.catch(() => undefined);
	const completed = adapter.finishedEvent ? new Promise<void>(resolve => {
		finish = resolve;
	}) : null;
	completed?.catch(() => undefined);
	const onFinished = (): void => {
		// TikZJax 在 document 的同一事件里优化并替换 SVG；下一微任务才取最终产物。
		queueMicrotask(() => finish?.());
	};
	const onAbort = (): void => fail?.(new Error('渲染已取消'));
	if (adapter.finishedEvent) root.addEventListener(adapter.finishedEvent, onFinished);
	signal.addEventListener('abort', onAbort, { once: true });
	const timeout = win.setTimeout(() => fail?.(new Error('插件渲染超时')), 60000);
	try {
		if (signal.aborted) throw new Error('渲染已取消');
		if (adapter.host) {
			const event = new win.CustomEvent(CODEBLOCK_HOST_EVENT, { detail: request });
			doc.dispatchEvent(event);
			if (!request.handled || !request.completion) throw new Error('CodeTab 尚未提供宿主渲染接口');
			await Promise.race([request.completion, stopped]);
		} else {
			const longest = Math.max(3, ...Array.from(request.source.matchAll(/`+/g), m => m[0].length));
			const fence = '`'.repeat(longest + 1);
			const markdown = `${fence}${request.language}\n${request.source}\n${fence}`;
			await Promise.race([MarkdownRenderer.render(app, markdown, root, request.sourcePath, request.component), stopped]);
			// 原子挂载：TikZJax 的观察器不去重新增脚本，避免同时观察祖先和脚本两次。
			attach?.();
			if (completed) await Promise.race([completed, stopped]);
			const svg = root.querySelector('svg');
			if (!svg && completed) throw new Error('插件未生成最终 SVG');
			if (svg && !svg.hasAttribute('viewBox') && svg.width.baseVal.value > 0 && svg.height.baseVal.value > 0) {
				svg.setAttribute('viewBox', `0 0 ${svg.width.baseVal.value} ${svg.height.baseVal.value}`);
			}
			if (svg) Object.assign(svg.style, { maxWidth: '100%', height: 'auto', display: 'block', pointerEvents: adapter.mode === 'static' ? 'none' : 'auto' });
		}
		if (signal.aborted) throw new Error('渲染已取消');
	} finally {
		win.clearTimeout(timeout);
		if (adapter.finishedEvent) root.removeEventListener(adapter.finishedEvent, onFinished);
		signal.removeEventListener('abort', onAbort);
	}
}
