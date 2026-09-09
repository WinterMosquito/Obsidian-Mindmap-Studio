/**
 * Hand-written type declarations for the vendored simple-mind-map engine
 * (simple-mind-map 0.14.0-fix.3, compiled bundle in vendor/simple-mind-map.cjs;
 * packaging & upgrade workflow: vendor/BUILD.md).
 *
 * Only the API surface actually used by this plugin is declared.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyObject = Record<string, any>;

export interface MindMapNodeData extends AnyObject {
	text?: string;
	image?: string;
	imageTitle?: string;
	imageSize?: { width: number; height: number; custom?: boolean };
	icon?: string[];
	tag?: string[] | { text: string; style?: AnyObject }[];
	hyperlink?: string;
	hyperlinkTitle?: string;
	note?: string;
	expand?: boolean;
	isActive?: boolean;
	generalization?: unknown;
	richText?: boolean;
	uid?: string;
	fillColor?: string;
	color?: string;
	fontSize?: number;
	fontWeight?: string;
	customLeft?: number;
	customTop?: number;
	customTextWidth?: number;
	attachmentUrl?: string;
	attachmentName?: string;
	lineColor?: string;
}

export interface MindMapTreeNode extends AnyObject {
	data: MindMapNodeData;
	children: MindMapTreeNode[];
}

export interface MindMapOptions {
	el: HTMLElement;
	data?: MindMapTreeNode;
	layout?: string;
	theme?: string;
	themeConfig?: AnyObject;
	fit?: boolean;
	defaultInsertSecondLevelNodeText?: string;
	defaultInsertBelowSecondLevelNodeText?: string;
	openPerformance?: boolean;
	performanceConfig?: { time?: number; padding?: number; removeNodeWhenOutCanvas?: boolean };
	enableFreeDrag?: boolean;
	customHyperlinkJump?: ((link: string, node: MindMapNode) => void) | null;
	customNoteContentShow?: {
		show: (content: unknown, left: number, top: number, node: MindMapNode) => void;
		hide: () => void;
	};
}

export interface MindMapNode {
	uid: string;
	parent: MindMapNode | null;
	children: MindMapNode[];
	nodeData: { data: MindMapNodeData; children: MindMapTreeNode[] };
	isRoot: boolean;
	getData(key?: string): MindMapNodeData | unknown;
	setData(data: Partial<MindMapNodeData>): void;
	active(): void;
}

export interface SetNodeImageOptions {
	url: string | null;
	title?: string;
	width?: number;
	height?: number;
	custom?: boolean;
}

export class MindMap {
	constructor(options: MindMapOptions);
	addPlugin(
		Plugin: new (options: AnyObject) => unknown,
		options?: AnyObject,
	): MindMap;
	on(event: string, callback: (...args: unknown[]) => void): void;
	off(event: string, callback: (...args: unknown[]) => void): void;
	emit(event: string, ...args: unknown[]): void;
	execCommand(name: string, ...args: unknown[]): void;
	getData(): MindMapTreeNode;
	setData(data: MindMapTreeNode): void;
	render(): void;
	resize(): void;
	destroy(): void;
	setLayout(layout: string): void;
	getLayout(): string;
	setThemeConfig(config: AnyObject): void;
	updateConfig(config: AnyObject): void;
	/** 画布尺寸（CSS 像素，随容器 resize 更新）：视口锚点计算用 */
	width: number;
	height: number;
	/** 引擎运行时配置（活引用，updateConfig 后立即生效） */
	opt: { openPerformance?: boolean; [key: string]: unknown };
	view: {
		fit(): void;
		enlarge(): void;
		narrow(): void;
		/** 直接设置缩放比例（1 = 100%），不改变平移 */
		/**
		 * 设置缩放比例。第二/三参给出锚点坐标时以该点为不动点缩放
		 * （引擎 scaleInCenter：反推平移使锚点处画面保持原位）；
		 * 省略锚点时仅改比例，画面会绕画布原点跳动。
		 */
		setScale(scale: number, centerX?: number, centerY?: number): void;
		/** 恢复保存的视口（缩放/平移）；入参为 getTransformData 的输出 */
		setTransformData(data: unknown): void;
		/** 相对平移画布（正数向右/下），立即重绘 */
		translateXY(x: number, y: number): void;
		/** 当前视口（缩放/平移），用于持久化 */
		getTransformData(): { transform: AnyObject; state: AnyObject };
	};
	renderer: {
		root: MindMapNode | null;
		activeNodeList: MindMapNode[];
		/** 强制渲染全部节点（绕过性能模式的视口裁剪），导出/fit 前使用 */
		forceLoadNode(node?: MindMapNode): void;
		/**
		 * 把指定节点移到画布视口中心（用当前 transform 计算偏移，
		 * 故需先 setScale）。第二参 true 时同时把比例重置为 1。
		 */
		moveNodeToCenter(node: MindMapNode, resetScale?: boolean): void;
		/** 把根（中心）节点移到视口中心 */
		setRootNodeCenter(): void;
		/** 引擎内部的文本编辑插件实例（textEditNode 为编辑框 DOM） */
		textEdit?: { textEditNode?: HTMLElement | null };
	};
	search: {
		search(text: string, callback?: () => void): void;
		searchNext(callback?: () => void): void;
		jump(index: number, callback?: () => void): void;
		endSearch(): void;
		matchNodeList: MindMapNode[];
		currentIndex: number;
	};
	doExport: {
		export(
			type: string,
			isDownload?: boolean,
			name?: string,
		): Promise<Blob | string | null>;
	};
}

export class DoExport {
	constructor(options?: AnyObject);
}
export class Select {
	constructor(options?: AnyObject);
}
export class TouchEvent {
	constructor(options?: AnyObject);
}
export class AssociativeLine {
	constructor(options?: AnyObject);
}
export class KeyboardNavigation {
	constructor(options?: AnyObject);
}
export class Search {
	constructor(options?: AnyObject);
}
export class Drag {
	constructor(options?: AnyObject);
}
