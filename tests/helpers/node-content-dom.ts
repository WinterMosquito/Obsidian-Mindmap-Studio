/** 内容组件与装配测试共用的最小 DOM 夹具。 */
export class FakeTextNode {
	constructor(readonly text: string) {}
}

/** 最小元素桩：只实现本模块使用的面（tagName/className/textContent/style/属性/appendChild） */
export class FakeElement {
	className = '';
	textContent = '';
	/** 元素名：真实 DOM 里由 createElement(tag) 决定，用于断言语义元素包装 */
	tagName = '';
	readonly style: Record<string, string> = {};
	readonly children: unknown[] = [];
	readonly attributes = new Map<string, string>();
	/** classList 桩：真实 DOM 里classList.add 改的是 className，本桩只记录 token */
	readonly classTokens = new Set<string>();
	readonly classList = {
		add: (token: string): void => {
			this.classTokens.add(token);
		},
		remove: (token: string): void => {
			this.classTokens.delete(token);
		},
		contains: (token: string): boolean => this.classTokens.has(token),
	};

	appendChild(child: unknown): unknown {
		this.children.push(child);
		return child;
	}

	/** 语义化替换子节点（真实 DOM 会连带清掉textContent；本桩只管 children） */
	replaceChildren(...nodes: unknown[]): void {
		this.children.length = 0;
		this.children.push(...nodes);
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
}

/** 最小 Document 桩（记录 createElement 的标签名） */
export class FakeDocument {
	createElement(tag = ''): FakeElement {
		const el = new FakeElement();
		el.tagName = tag;
		return el;
	}

	createTextNode(text: string): FakeTextNode {
		return new FakeTextNode(text);
	}
}

export function asDocument(doc: FakeDocument): Document {
	return doc as unknown as Document;
}

