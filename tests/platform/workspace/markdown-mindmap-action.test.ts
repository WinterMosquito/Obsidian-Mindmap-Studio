/** 标题栏动作归属具体 MarkdownView，重复布局/文件事件不重复注册，卸载可清理。 */
import { describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import type { Language } from '../../../src/core/i18n';
import { MarkdownMindMapAction } from '../../../src/platform/workspace/markdown-mindmap-action';
import { openAsMindMap } from '../../../src/markdown/md-open';

vi.mock('../../../src/markdown/md-open', () => ({ openAsMindMap: vi.fn() }));

function view(path: string | null) {
	const file = path === null ? null : Object.assign(new TFile(), { path, extension: 'md' });
	const leaf = {};
	const elements: { isConnected: boolean; attrs: Record<string, string>; remove: () => void }[] = [];
	const callbacks: (() => void)[] = [];
	const addAction = vi.fn((_icon: string, _title: string, click: () => void) => {
		const element = {
			isConnected: true, attrs: {} as Record<string, string>, addClass: vi.fn(),
			setAttribute(key: string, value: string) { this.attrs[key] = value; },
			remove() { this.isConnected = false; },
		};
		elements.push(element); callbacks.push(click);
		return element as unknown as HTMLElement;
	});
	const v = Object.assign(new MarkdownView(null as never), { file, leaf, addAction });
	return { v, elements, callbacks, leaf, addAction };
}

function harness() {
	const a = view('A.md'); const b = view('B.md');
	let leaves = [{ view: a.v }, { view: b.v }];
	let language: Language = 'zh';
	const events = new Map<string, () => void>();
	const cleanups: (() => void)[] = [];
	const workspace = {
		getLeavesOfType: () => leaves,
		on(name: string, callback: () => void) { events.set(name, callback); return { name }; },
		onLayoutReady(callback: () => void) { callback(); },
	};
	const actions = new MarkdownMindMapAction(workspace as never, () => language);
	actions.register({ register: (cb: () => void) => cleanups.push(cb), registerEvent: vi.fn() } as never);
	return { a, b, actions, events, cleanups, setLanguage: (lang: Language) => { language = lang; }, setLeaves: (items: typeof leaves) => { leaves = items; } };
}

describe('Markdown 标题栏导图入口', () => {
	it('标题栏早于 file 绑定时仍注册入口，文件就位后无需重建按钮', () => {
		vi.mocked(openAsMindMap).mockClear();
		const h = view(null);
		const actions = new MarkdownMindMapAction({ getLeavesOfType: () => [{ view: h.v }] } as never, () => 'zh');
		actions.refresh();
		h.callbacks[0]!();
		expect(openAsMindMap).not.toHaveBeenCalled();
		h.v.file = Object.assign(new TFile(), { path: 'OS.md', extension: 'md' });
		h.callbacks[0]!();
		expect(openAsMindMap).toHaveBeenCalledWith(h.leaf, h.v.file);
		expect(h.addAction).toHaveBeenCalledOnce();
	});

	it('点击来源视图，读取该视图的当前文件；不借用其它分屏文件', () => {
		vi.mocked(openAsMindMap).mockClear();
		const h = harness();
		h.a.v.file = Object.assign(new TFile(), { path: 'Renamed.md', extension: 'md' });
		h.a.callbacks[0]!();
		expect(openAsMindMap).toHaveBeenCalledWith(h.a.leaf, h.a.v.file);
		expect(openAsMindMap).not.toHaveBeenCalledWith(h.b.leaf, h.b.v.file);
	});

	it('重复刷新与语言变更复用按钮，主题 tooltip 随语言更新', async () => {
		const h = harness();
		h.events.get('file-open')!(); h.events.get('layout-change')!();
		await Promise.resolve();
		h.setLanguage('en'); h.actions.refresh();
		expect(h.a.addAction).toHaveBeenCalledOnce();
		expect(h.a.elements[0]?.attrs['aria-label']).toBe('Open as mind map');
	});

	it('宿主重建按钮 DOM 后补注册，视图离开与插件卸载移除自身动作', () => {
		const h = harness();
		h.a.elements[0]!.isConnected = false;
		h.actions.refresh();
		expect(h.a.addAction).toHaveBeenCalledTimes(2);
		h.setLeaves([{ view: h.b.v }]); h.actions.refresh();
		expect(h.a.elements.every(el => !el.isConnected)).toBe(true);
		for (const cleanup of h.cleanups) cleanup();
		expect(h.b.elements[0]?.isConnected).toBe(false);
		h.actions.refresh();
		expect(h.b.addAction).toHaveBeenCalledOnce();
	});
});
