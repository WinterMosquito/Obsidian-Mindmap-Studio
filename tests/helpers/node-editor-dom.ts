/** 节点编辑组件与业务适配测试共用的最小 DOM 夹具，保留真实监听注册/解绑语义。 */
import { vi } from 'vitest';

/* —— 最小 DOM 桩 —— */

export interface ElStub {
	style: Record<string, string>;
	value: string;
	scrollHeight: number;
	scrollTop: number;
	/** 所属文档（提交时焦点归还 body、元素移除后解绑 document 监听用） */
	ownerDocument: unknown;
	remove: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
	setSelectionRange: ReturnType<typeof vi.fn>;
	contains: (node: unknown) => boolean;
	addEventListener: (type: string, handler: (event: unknown) => void) => void;
	removeEventListener: (type: string, handler: (event: unknown) => void) => void;
	listenerCount: () => number;
	/** 测试辅助：触发指定类型的已登记处理器 */
	fire: (type: string, event: unknown) => void;
}

export interface DocStub {
	body: {
		createEl: (tag: string, options?: unknown) => ElStub;
		focus: ReturnType<typeof vi.fn>;
	};
	addEventListener: (
		type: string,
		handler: (event: unknown) => void,
		capture?: boolean,
	) => void;
	removeEventListener: (type: string, handler: (event: unknown) => void) => void;
	/** 测试辅助：触发 document 级监听（如 capture mousedown） */
	fireDoc: (type: string, event: unknown) => void;
	/** 创建记录（tag/options/元素本体） */
	created: { tag: string; options: unknown; el: ElStub }[];
}

function makeElStub(): ElStub {
	const handlers = new Map<string, ((event: unknown) => void)[]>();
	const el: ElStub = {
		style: {},
		value: '',
		scrollHeight: 0,
		scrollTop: 0,
		ownerDocument: undefined,
		remove: vi.fn(),
		focus: vi.fn(),
		setSelectionRange: vi.fn(),
		contains: (node) => node === el,
		addEventListener: (type, handler) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
		},
		removeEventListener: (type, handler) => {
			handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler));
		},
		listenerCount: () => [...handlers.values()].reduce((count, items) => count + items.length, 0),
		fire: (type, event) => {
			for (const handler of handlers.get(type) ?? []) {
				handler(event);
			}
		},
	};
	return el;
}

export function makeDocStub(): DocStub {
	const handlers = new Map<string, ((event: unknown) => void)[]>();
	const created: DocStub['created'] = [];
	const doc = {
		body: {
			createEl: (tag: string, options?: unknown): ElStub => {
				const el = makeElStub();
				// 回填所属文档（提交时焦点归还 body 用；运行时由 createEl 自然建立）
				el.ownerDocument = doc;
				created.push({ tag, options, el });
				return el;
			},
			focus: vi.fn(),
		},
		addEventListener: (type: string, handler: (event: unknown) => void) => {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
		},
		removeEventListener: (type: string, handler: (event: unknown) => void) => {
			const list = handlers.get(type) ?? [];
			handlers.set(
				type,
				list.filter((item) => item !== handler),
			);
		},
		fireDoc: (type: string, event: unknown) => {
			for (const handler of handlers.get(type) ?? []) {
				handler(event);
			}
		},
		created,
	};
	return doc;
}

/** 会话创建的最新 textarea（本模块每会话只建一个） */
export function lastEl(doc: DocStub): ElStub {
	const entry = doc.created[doc.created.length - 1];
	if (!entry) {
		throw new Error('文档桩未创建任何元素');
	}
	return entry.el;
}

