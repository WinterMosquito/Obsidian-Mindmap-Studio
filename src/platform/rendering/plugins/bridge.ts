/** 通用插件渲染桥：适配器可扩展，组件会话与引擎归属由这里唯一登记。 */
import { embedPluginFonts } from './fonts';
import type { App } from 'obsidian';
import { PLUGIN_SLOT_CLASS, PLUGIN_SLOT_ID } from '../../../core/plugin-content-types';
import type { PluginBlockRequest, PluginContentRenderer } from '../../../core/plugin-content-types';
import { DEFAULT_PLUGIN_ADAPTERS } from './native';
import type { PluginAdapter } from './native';
import { PluginOwnerSession } from './owner';

const owners = new WeakMap<object, PluginOwnerSession>();
const products = new Map<string, () => HTMLElement | null>();
let sequence = 0;

export interface PluginBridgeDeps {
	app: App;
	sourcePath: () => string;
	onSettled: (holder: HTMLElement) => void;
	onChange?: (nodeId: string, index: number, expected: string, next: string | null) => Promise<void>;
}

export class PluginContentBridge implements PluginContentRenderer {
	constructor(private readonly deps: PluginBridgeDeps, private readonly adapters: readonly PluginAdapter[] = DEFAULT_PLUGIN_ADAPTERS) {}
	supports(language: string): boolean { return this.adapters.some(adapter => adapter.language === language.toLowerCase()); }
	mode(language: string): 'static' | 'live' | null { return this.adapters.find(adapter => adapter.language === language.toLowerCase())?.mode ?? null; }
	render(request: PluginBlockRequest): HTMLElement | null {
		if (!request.owner || !request.nodeId) return null;
		const adapter = this.adapters.find(candidate => candidate.language === request.language.toLowerCase());
		if (!adapter) return null;
		let session = owners.get(request.owner);
		if (!session) {
			session = new PluginOwnerSession(`p${++sequence}`, { ...this.deps, onEntry: (id, snapshot) => {
				if (snapshot) products.set(id, snapshot); else products.delete(id);
			} });
			owners.set(request.owner, session);
		}
		return session.register({ ...request, language: adapter.language }, adapter);
	}
}

export function syncPluginContents(root: HTMLElement, owner: object, sources: ReadonlyMap<string, string>): void {
	owners.get(owner)?.sync(root, sources);
}
export function hasPluginContents(owner: object): boolean { return owners.get(owner)?.hasEntries ?? false; }
export function disposePluginContents(owner: object): void { owners.get(owner)?.dispose(); owners.delete(owner); }

/** 导出只替换克隆槽位，活 DOM 与事件始终留在画布中。 */
export function freezePluginContents(svg: unknown): void {
	const root = ((svg as { node?: Element } | null)?.node ?? svg) as Element | null;
	if (!root) return;
	let slots: Element[];
	try { slots = Array.from(root.querySelectorAll(`.${PLUGIN_SLOT_CLASS}`)); }
	catch { return; }
	for (const slot of slots) {
		const snapshot = products.get(slot.getAttribute(PLUGIN_SLOT_ID) ?? '')?.();
		if (snapshot) slot.replaceChildren(snapshot);
	}
	embedPluginFonts(root);
}

export async function preparePluginContents(owner: object): Promise<ReadonlySet<string>> { return await owners.get(owner)?.prepare() ?? new Set(); }
