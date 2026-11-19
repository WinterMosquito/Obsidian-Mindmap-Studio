/** 单引擎插件会话：惰性挂载、活动组件迁移、冻结测量与编辑保护。 */
import { Component } from 'obsidian';
import type { App } from 'obsidian';
import { PLUGIN_SLOT_CLASS, PLUGIN_SLOT_ID, PLUGIN_LIVE_CLASS, PLUGIN_INTERACTIVE_ATTR } from '../../../core/plugin-content-types';
import type { PluginBlockRequest } from '../../../core/plugin-content-types';
import { fencedNodeBlocks, normalizeBlockSource } from '../../../markdown/md-codeblocks';
import { pluginPresentation } from './snapshot';
import { renderNativePlugin } from './native';
import type { CodeBlockHostRequest, PluginAdapter } from './native';

export interface PluginOwnerDeps {
	app: App;
	sourcePath: () => string;
	onSettled: (holder: HTMLElement) => void;
	onChange?: (nodeId: string, index: number, expected: string, next: string | null) => Promise<void>;
	onEntry: (id: string, snapshot: (() => HTMLElement | null) | null) => void;
}
interface Specification { source: string; language: string; adapter: PluginAdapter }
interface Entry extends Specification {
	id: string; nodeId: string; index: number; root: HTMLElement | null; stage: HTMLElement | null;
	component: Component | null; controller: AbortController; snapshot: HTMLElement | null;
	slot: HTMLElement | null; ready: boolean; failed: boolean; editing: boolean;
	width: number; height: number; widthHint: number; resize: ResizeObserver | null;
	pending: Specification | null; work: Promise<void> | null; focused: HTMLElement | null;
}

export class PluginOwnerSession {
	private readonly entries = new Map<string, Entry>();
	private parking: HTMLElement | null = null;
	private canvas: HTMLElement | null = null;
	private observer: MutationObserver | null = null;
	private queued = false;
	private closed = false;
	private sources: ReadonlyMap<string, string> | null = null;

	constructor(private readonly prefix: string, private readonly deps: PluginOwnerDeps) {}

	register(request: PluginBlockRequest, adapter: PluginAdapter): HTMLElement | null {
		const key = `${request.nodeId}:${request.index}`;
		const spec: Specification = { source: normalizeBlockSource(request.source), language: request.language, adapter };
		let entry = this.entries.get(key);
		if (entry && (entry.source !== spec.source || entry.language !== spec.language)) {
			if (entry.editing) entry.pending = spec;
			else this.restart(entry, spec);
		}
		if (!entry) {
			entry = { ...spec, id: `${this.prefix}:${key}`, nodeId: request.nodeId, index: request.index,
				root: null, stage: null, component: null, controller: new AbortController(), snapshot: null,
				slot: null, ready: false, failed: false, editing: false, width: 0, height: 0,
				widthHint: request.availableWidth ?? 468, resize: null, pending: null, work: null, focused: null };
			this.entries.set(key, entry);
			const current = entry;
			this.deps.onEntry(entry.id, () => {
				if (!current.ready || !current.root) return null;
				return current.root.parentElement === current.slot ? pluginPresentation(current.root)
					: current.snapshot?.cloneNode(true) as HTMLElement ?? null;
			});
		}
		entry.widthHint = request.availableWidth ?? 468;
		if (entry.stage) entry.stage.style.width = `${entry.widthHint}px`;
		if (entry.root) { entry.root.style.width = `${entry.widthHint}px`; entry.root.style.maxWidth = `${entry.widthHint}px`; }
		request.holder.setAttribute(PLUGIN_SLOT_ID, entry.id);
		return entry.snapshot ? entry.snapshot.cloneNode(true) as HTMLElement : null;
	}

	sync(root: HTMLElement, sources?: ReadonlyMap<string, string>): void {
		if (this.closed) return;
		if (sources) this.sources = sources;
		if (this.canvas !== root) {
			this.observer?.disconnect(); this.canvas = root;
			const Observer = root.ownerDocument.defaultView?.MutationObserver;
			if (Observer) {
				this.observer = new Observer(records => {
					if (this.entries.size && records.some(record => !(record.target as Element).closest?.(`.${PLUGIN_LIVE_CLASS}`))) this.queueSync();
				});
				this.observer.observe(root, { childList: true, subtree: true });
			}
		}
		const slots = new Map<string, HTMLElement>();
		for (const slot of Array.from(root.querySelectorAll<HTMLElement>(`.${PLUGIN_SLOT_CLASS}`))) {
			if (slot.isConnected && slot.closest('foreignObject')) slots.set(slot.getAttribute(PLUGIN_SLOT_ID) ?? '', slot);
		}
		for (const [key, entry] of this.entries) {
			if (this.sources) {
				const raw = this.sources.get(entry.nodeId);
				const block = raw === undefined ? null : fencedNodeBlocks(raw)[entry.index];
				if (!block) { this.release(entry); this.entries.delete(key); continue; }
				if (entry.pending && !entry.editing) this.restart(entry, entry.pending);
				if (block.language.toLowerCase() !== entry.language && !entry.editing) {
					this.release(entry); this.entries.delete(key); continue;
				}
				if (!entry.editing && normalizeBlockSource(block.source) !== entry.source) {
					this.restart(entry, { source: normalizeBlockSource(block.source), language: entry.language, adapter: entry.adapter });
				}
			}
			entry.slot = slots.get(entry.id) ?? null;
			if (entry.slot) {
				if (!entry.root && !entry.failed) this.start(entry, root.ownerDocument);
				if (entry.root && entry.ready && entry.root.parentElement !== entry.slot) {
					entry.slot.replaceChildren(entry.root);
					const active = entry.root.ownerDocument.activeElement;
					if (entry.focused && entry.root.contains(entry.focused) &&
						(active === entry.root.ownerDocument.body || entry.root.contains(active))) {
						entry.focused.focus({ preventScroll: true });
					}
					this.updateSize(entry);
				}
			} else if (entry.root && entry.stage && entry.root.parentElement !== entry.stage) {
				entry.stage.appendChild(entry.root);
			}
		}
	}

	private queueSync(): void {
		if (this.queued || this.closed) return;
		this.queued = true;
		queueMicrotask(() => { this.queued = false; if (this.canvas) this.sync(this.canvas); });
	}

	private start(entry: Entry, doc: Document): void {
		if (!this.parking) {
			this.parking = doc.createElement('div');
			Object.assign(this.parking.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' });
			doc.body.appendChild(this.parking);
		}
		const stage = doc.createElement('div'); stage.style.width = `${entry.widthHint}px`;
		this.parking.appendChild(stage); entry.stage = stage;
		const root = doc.createElement('div'); root.className = `${PLUGIN_LIVE_CLASS} markdown-rendered`;
		Object.assign(root.style, { display: 'inline-block', width: `${entry.widthHint}px`, maxWidth: `${entry.widthHint}px`, whiteSpace: 'normal',
			fontSize: 'var(--font-text-size, 16px)', color: 'var(--text-normal)', backgroundColor: 'var(--background-primary)',
			pointerEvents: entry.adapter.mode === 'static' ? 'none' : 'auto' });
		if (entry.adapter.host) stage.appendChild(root); entry.root = root;
		const controller = entry.controller;
		const component = new Component(); component.load(); entry.component = component;
		const stopControlEvent = (event: Event): void => {
			const target = event.target as Element | null;
			if (target?.closest?.(`button, a, input, textarea, [contenteditable], [${PLUGIN_INTERACTIVE_ATTR}]`)) event.stopPropagation();
		};
		for (const type of ['mousedown', 'pointerdown', 'click', 'dblclick', 'contextmenu', 'dragstart']) {
			root.addEventListener(type, stopControlEvent);
			component.register(() => root.removeEventListener(type, stopControlEvent));
		}
		const request: CodeBlockHostRequest = { version: 1, language: entry.language, source: entry.source,
			sourcePath: this.deps.sourcePath(), id: entry.id, container: root, component,
			readOnly: !this.deps.onChange, handled: false,
			onEditingChange: editing => {
				if (entry.controller !== controller || controller.signal.aborted) return;
				entry.editing = editing; if (!editing) this.queueSync();
			},
			onChange: this.deps.onChange ? async (expected, next) => {
				if (entry.controller !== controller || controller.signal.aborted) throw new Error('插件组件已关闭');
				const previous = entry.source; entry.source = next === null ? '' : normalizeBlockSource(next);
				try { await this.deps.onChange!(entry.nodeId, entry.index, expected, next); }
				catch (error) { entry.source = previous; throw error; }
			} : undefined };
		entry.work = renderNativePlugin(this.deps.app, request, entry.adapter, controller.signal, () => stage.appendChild(root)).then(() => {
			if (entry.controller !== controller || controller.signal.aborted) return;
			entry.ready = true;
			const Observer = doc.defaultView?.ResizeObserver;
			if (Observer) { entry.resize = new Observer(() => this.updateSize(entry)); entry.resize.observe(root); }
			if (this.canvas) this.sync(this.canvas);
		}).catch(error => {
			if (entry.controller !== controller) return;
			if (!controller.signal.aborted) console.warn('插件内容渲染失败，保留源码:', entry.language, error);
			entry.failed = true; component.unload(); root.remove(); stage.remove(); entry.root = null;
		});
	}

	private updateSize(entry: Entry): void {
		if (!entry.ready || !entry.root || !entry.slot || entry.root.parentElement !== entry.slot) return;
		const active = entry.root.ownerDocument.activeElement;
		if (entry.root.contains(active)) entry.focused = active as HTMLElement;
		const width = entry.root.offsetWidth; const height = entry.root.offsetHeight;
		if (!width || !height || (width === entry.width && height === entry.height)) return;
		entry.width = width; entry.height = height; entry.snapshot = pluginPresentation(entry.root);
		this.deps.onSettled(entry.slot);
	}

	private releaseComponent(entry: Entry): void {
		entry.controller.abort(); entry.resize?.disconnect(); entry.component?.unload(); entry.root?.remove(); entry.stage?.remove();
	}
	private release(entry: Entry): void { this.releaseComponent(entry); this.deps.onEntry(entry.id, null); }
	private restart(entry: Entry, spec: Specification): void {
		this.releaseComponent(entry); Object.assign(entry, spec);
		entry.controller = new AbortController(); entry.root = null; entry.stage = null; entry.component = null;
		entry.resize = null; entry.ready = false; entry.failed = false; entry.snapshot = null;
		entry.width = 0; entry.height = 0; entry.work = null; entry.pending = null;
	}
	get hasEntries(): boolean { return this.entries.size > 0; }
	async prepare(): Promise<ReadonlySet<string>> {
		if (!this.canvas || this.closed) return new Set();
		for (const entry of this.entries.values()) if (!entry.root && !entry.failed) this.start(entry, this.canvas.ownerDocument);
		await Promise.all(Array.from(this.entries.values(), entry => entry.work ?? Promise.resolve()));
		for (const entry of this.entries.values()) if (entry.ready && entry.root) entry.snapshot = pluginPresentation(entry.root);
		return new Set(Array.from(this.entries.values(), entry => entry.nodeId));
	}
	dispose(): void {
		this.closed = true; this.observer?.disconnect();
		for (const entry of this.entries.values()) this.release(entry);
		this.entries.clear(); this.parking?.remove(); this.parking = null;
	}
}
