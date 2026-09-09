/**
 * 工具栏装配回归（view-toolbar）：
 * - 右侧按钮顺序：**重置缩放 → 适应画布 → 放大 → 缩小 → 导出**（用户明确要求）；
 * - 「重置缩放」按钮真实接线到 `resetZoom`（以画布中心为锚点回到 100%）。
 *
 * 无 DOM 环境：用最小伪元素记录 createDiv/createEl/createSpan 与 attr。
 */
import { describe, expect, it, vi } from 'vitest';
import { LAYOUT_OPTIONS } from '../src/constants';
import { t } from '../src/i18n';
import { buildToolbar } from '../src/features/view-toolbar';
import type { MindMapViewContext } from '../src/features/view-context';

// view-toolbar 经 mindmap.ts 加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

interface FakeInit {
	cls?: string;
	attr?: Record<string, string>;
}

/** 最小伪元素：记录子元素、类名与属性（obsidian 的 setIcon 在 mock 中为 no-op） */
class FakeEl {
	readonly tag: string;
	readonly children: FakeEl[] = [];
	readonly classes: string[] = [];
	readonly attr: Record<string, string> = {};
	text = '';
	value = '';
	onclick: (() => void) | null = null;

	constructor(tag: string, init: FakeInit = {}) {
		this.tag = tag;
		if (init.cls !== undefined) {
			this.classes.push(...init.cls.split(/\s+/).filter(Boolean));
		}
		Object.assign(this.attr, init.attr ?? {});
	}

	createDiv(cls?: string): FakeEl {
		const child = new FakeEl('div', cls === undefined ? {} : { cls });
		this.children.push(child);
		return child;
	}

	createEl(tag: string, init: FakeInit = {}): FakeEl {
		const child = new FakeEl(tag, init);
		this.children.push(child);
		return child;
	}

	createSpan(cls?: string): FakeEl {
		const child = new FakeEl('span', cls === undefined ? {} : { cls });
		this.children.push(child);
		return child;
	}

	setText(text: string): void {
		this.text = text;
	}
}

function makeView() {
	const toolbarEl = new FakeEl('div');
	const setScale = vi.fn<(scale: number, cx?: number, cy?: number) => void>();
	const fit = vi.fn();
	const mindMap = {
		execCommand: vi.fn(),
		opt: {},
		width: 800,
		height: 600,
		view: { setScale, fit },
	};
	const view = {
		toolbarEl: toolbarEl as unknown as HTMLElement,
		lang: 'zh',
		mindMap,
		isMdDocument: () => false,
		backToMarkdown: vi.fn(),
		applyLayout: vi.fn(),
		plugin: { settings: { defaultLayout: LAYOUT_OPTIONS[0]?.value ?? '' } },
	} as unknown as MindMapViewContext;
	return { view, toolbarEl, setScale, fit };
}

/** 取某个分组内的按钮（按 DOM 顺序） */
function buttonsOf(group: FakeEl): FakeEl[] {
	return group.children.filter((child) => child.tag === 'button');
}

describe('buildToolbar（右侧按钮顺序）', () => {
	it('顺序为 重置缩放 → 适应画布 → 放大 → 缩小 → 导出', () => {
		const { view, toolbarEl } = makeView();
		buildToolbar(view);

		const rightGroup = toolbarEl.children.find((child) =>
			child.classes.includes('mindmap-toolbar-right'),
		);
		expect(rightGroup).toBeDefined();

		expect(buttonsOf(rightGroup!).map((b) => b.attr['title'])).toEqual([
			t('zh', 'toolbar.resetZoom'),
			t('zh', 'command.fitCanvas'),
			t('zh', 'toolbar.zoomIn'),
			t('zh', 'toolbar.zoomOut'),
			t('zh', 'toolbar.exportPng'),
		]);
	});

	it('「重置缩放」按钮接线到 resetZoom（画布中心锚点 + 100%）', () => {
		const { view, toolbarEl, setScale } = makeView();
		buildToolbar(view);

		const rightGroup = toolbarEl.children.find((child) =>
			child.classes.includes('mindmap-toolbar-right'),
		)!;
		const resetButton = buttonsOf(rightGroup).find(
			(button) => button.attr['title'] === t('zh', 'toolbar.resetZoom'),
		);
		expect(resetButton?.onclick).toBeTypeOf('function');

		resetButton?.onclick?.();
		expect(setScale).toHaveBeenCalledWith(1, 400, 300);
	});

	it('「适应画布」按钮仍接线到引擎 fit', () => {
		const { view, toolbarEl, fit } = makeView();
		buildToolbar(view);

		const rightGroup = toolbarEl.children.find((child) =>
			child.classes.includes('mindmap-toolbar-right'),
		)!;
		buttonsOf(rightGroup)
			.find((button) => button.attr['title'] === t('zh', 'command.fitCanvas'))
			?.onclick?.();
		expect(fit).toHaveBeenCalledTimes(1);
	});
});
