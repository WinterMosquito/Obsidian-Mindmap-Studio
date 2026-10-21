/**
 * ```` ```mindmap ```` 代码块嵌入（features/mindmap-codeblock）单元回归。
 *
 * 覆盖三组：
 * ① `embedDisplayTree`（纯函数）：块体大纲 → **展示树**的虚拟根折叠规则
 *    （单子折叠 / 多顶层块保留虚拟根）。用例直接喂 `parseMdOutline` 的真实
 *    产物（而非手搓树），保证「解析口径 → 展示口径」这条链被整段钉住；
 * ② `shouldRenderOutline`：与 `CODE_BLOCK_MAX_NODES` 的边界（超过即降级大纲）；
 * ③ **跨文件契约**：
 *    - `CODE_BLOCK_LANGUAGE === 'mindmap'`：语言串是**存量笔记的接口**
 *      （0.0.1/0.0.2 的笔记写着 ` ```mindmap `，0.0.3 移除、本次恢复）——
 *      改这个值会让旧笔记静默失效，故在此钉住；
 *    - `createMindMap` 的只读口径：`readonly: true` **不注册任何交互插件**
 *      （Search/KeyboardNavigation 会经 KeyCommand 抢宿主笔记的 Ctrl+F 与方向键）；
 *    - `applyThemeConfig`：亮暗 + 主题偏好 → 主题配置的**唯一**合成入口。
 *
 * 隔离策略：Node 环境无 DOM，故只测纯逻辑与「选项传递」；真实 DOM 装配
 * （引擎挂载、滚轮拦截、100% 居中、观察器）由 `verify:visual` 的
 * codeblock-embed 场景覆盖。vendor cjs 以 `vi.mock` 桩替代（同
 * engine-refresh-nodes.test.ts：真实模块顶层求值会触碰 document）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CODE_BLOCK_LANGUAGE, CODE_BLOCK_MAX_NODES } from '../src/core/constants';
import { t, tf } from '../src/core/i18n';
import {
	applyThemeConfig,
	createMindMap,
	getThemeConfig,
	isDarkTheme,
	measureContentFitToWidth,
} from '../src/engine/mindmap';
import { parseMdOutline } from '../src/markdown/md-outline';
import {
	EMBED_CANVAS_CLASS,
	EMBED_CONTAINER_CLASS,
	EMBED_NOTICE_CLASS,
	EMBED_OUTLINE_CLASS,
	embedDisplayTree,
	shouldRenderOutline,
} from '../src/features/mindmap-codeblock';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/** 引擎桩：记录构造选项与 addPlugin 序列（实例经 `vendor.instances` 取出） */
const vendor = vi.hoisted(() => ({
	instances: [] as { options: Record<string, unknown>; added: string[] }[],
}));

vi.mock('../vendor/simple-mind-map.cjs', () => {
	class FakeMindMap {
		options: Record<string, unknown>;
		added: string[] = [];

		constructor(options: Record<string, unknown>) {
			this.options = options;
			vendor.instances.push(this);
		}

		addPlugin(plugin: { name: string }): void {
			this.added.push(plugin.name);
		}

		resize(): void {}

		updateConfig(): void {}
	}

	return {
		MindMap: FakeMindMap,
		MindMapNode: class MindMapNode {},
		DoExport: class DoExport {},
		Select: class Select {},
		TouchEvent: class TouchEvent {},
		KeyboardNavigation: class KeyboardNavigation {},
		Search: class Search {},
		Drag: class Drag {},
	};
});

/** 块体源码 → 展示树（走真实解析链：与运行时同一条路径） */
function displayTreeOf(source: string, rootName = '思维导图'): MindMapTreeNode {
	return embedDisplayTree(parseMdOutline(source, rootName).tree);
}

describe('embedDisplayTree（块体 → 展示树）', () => {
	it('单个一级标题：折叠虚拟根，中心主题就是标题文本', () => {
		const tree = displayTreeOf('# 主题\n## 分支\n- 叶子');

		expect(tree.data.text).toBe('主题');
		expect(tree.children.length).toBe(1);
	});

	it('单条列表（平铺一行节点）：同样折叠虚拟根', () => {
		const tree = displayTreeOf('- 唯一主题');

		expect(tree.data.text).toBe('唯一主题');
		expect(tree.children).toEqual([]);
	});

	it('多个顶层块：保留虚拟根（唯一中心才有意义），根名取传入名', () => {
		const tree = displayTreeOf('# A\n# B', '思维导图');

		expect(tree.data.text).toBe('思维导图');
		expect(tree.children.map((child) => child.data.text)).toEqual(['A', 'B']);
	});

	it('平铺多条列表：保留虚拟根', () => {
		const tree = displayTreeOf('- a\n- b\n- c');

		expect(tree.data.text).toBe('思维导图');
		expect(tree.children.map((child) => child.data.text)).toEqual(['a', 'b', 'c']);
	});
});

describe('shouldRenderOutline（超限降级判据）', () => {
	it('上限之内不降级、恰在上限不降级、超过即降级', () => {
		expect(shouldRenderOutline(0)).toBe(false);
		expect(shouldRenderOutline(CODE_BLOCK_MAX_NODES)).toBe(false);
		expect(shouldRenderOutline(CODE_BLOCK_MAX_NODES + 1)).toBe(true);
	});
});

describe('measureContentFitToWidth（嵌入「按宽度适配」量测）', () => {
	/**
	 * 数据层几何桩：单节点 = 内容盒（size 即该节点的 left/top/width/height）。
	 * 性能模式口径（`openPerformance: true`）零 DOM，最适合直测。
	 */
	function stubMap(options: {
		width: number;
		height: number;
		performance?: boolean;
	}): unknown {
		return {
			opt: { openPerformance: options.performance ?? true },
			renderer: {
				root: {
					left: 0,
					top: 0,
					width: options.width,
					height: options.height,
					children: [],
				},
			},
			view: {
				getTransformData: () => ({
					transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
				}),
			},
		};
	}

	it('窄容器：等比缩到可用宽度，高度 = 原高 × scale + 两倍留白', () => {
		const fit = measureContentFitToWidth(
			stubMap({ width: 800, height: 200 }) as never,
			400,
			10,
		);

		// 可用宽 = 400 − 2×10 = 380 ⇒ scale = 380/800
		expect(fit).toEqual({
			height: Math.ceil(200 * (380 / 800) + 20),
			scale: 380 / 800,
		});
	});

	it('宽容器：**不放大**（scale 封顶 1），高度 = 原高 + 两倍留白', () => {
		const fit = measureContentFitToWidth(
			stubMap({ width: 300, height: 120 }) as never,
			640,
			12,
		);

		expect(fit).toEqual({ height: 144, scale: 1 });
	});

	it('内容恰好占满可用宽度时 scale 为 1（边界不产生亚像素缩放）', () => {
		const fit = measureContentFitToWidth(
			stubMap({ width: 376, height: 100 }) as never,
			400,
			12,
		);

		expect(fit?.scale).toBe(1);
		expect(fit?.height).toBe(124);
	});

	it('几何不可得（引擎为空 / 渲染树为空 / 宽度非正）→ null，调用方保持现状', () => {
		const emptyTree = {
			opt: { openPerformance: true },
			renderer: { root: null },
			view: { getTransformData: () => null },
		};

		expect(measureContentFitToWidth(null, 400, 10)).toBeNull();
		expect(
			measureContentFitToWidth(stubMap({ width: 800, height: 200 }) as never, 0, 10),
		).toBeNull();
		expect(measureContentFitToWidth(emptyTree as never, 400, 10)).toBeNull();
	});
});

describe('跨文件契约', () => {
	/**
	 * 类名两侧同源（TS 常量 ↔ styles.css 选择器）。
	 *
	 * 为什么必须钉住：`.tmm-embed-canvas` 的高度来自 styles.css（引擎的离屏测量与
	 * 首次布局都按容器尺寸换算，高度为 0 时嵌入会**静默不建引擎**——块体看起来
	 * 「什么都没渲染」，却没有任何单测会红）。删掉那条规则或改错类名，本用例报红。
	 */
	it('styles.css 含四个嵌入类名与画布高度基准', () => {
		const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

		for (const cls of [
			EMBED_CONTAINER_CLASS,
			EMBED_CANVAS_CLASS,
			EMBED_NOTICE_CLASS,
			EMBED_OUTLINE_CLASS,
		]) {
			expect(css, `styles.css 缺少 .${cls}`).toContain(`.${cls}`);
		}
		expect(css).toMatch(
			/\.tmm-embed-canvas\s*\{[^}]*height:\s*var\(--tmm-embed-height/,
		);
	});

	it('空态与超限提示用独立 i18n 词条（降级不得静默）', () => {
		expect(t('zh', 'mindmapEmbed.empty')).not.toBe('');
		expect(t('en', 'mindmapEmbed.empty')).not.toBe('');
		// tf 占位符替换：节点数与上限都要落在文案里
		const text = tf('zh', 'mindmapEmbed.tooMany', { count: 602, max: 500 });
		expect(text).toContain('602');
		expect(text).toContain('500');
	});

	it('代码块语言键保持 mindmap（存量笔记的接口，改动即静默失效）', () => {
		expect(CODE_BLOCK_LANGUAGE).toBe('mindmap');
	});

	it('只读嵌入：opt.readonly 为真且不注册任何交互插件', () => {
		vendor.instances.length = 0;

		createMindMap({} as HTMLElement, { data: { text: '根' }, children: [] }, {
			layout: 'logicalStructure',
			lineStyle: 'auto',
			themePref: 'default',
			themeStyle: 'default',
			palette: 'default',
			isDark: false,
			enableDrag: true,
			readonly: true,
			lang: 'zh',
		});

		const [instance] = vendor.instances;
		expect(instance?.options.readonly).toBe(true);
		// 空数组 = 连 Drag 都没注册（readonly 下 enableDrag 也不该生效）
		expect(instance?.added).toEqual([]);
	});

	it('可编辑视图（缺省）：交互插件照旧注册（回归护栏）', () => {
		vendor.instances.length = 0;

		createMindMap({} as HTMLElement, { data: { text: '根' }, children: [] }, {
			layout: 'logicalStructure',
			lineStyle: 'auto',
			themePref: 'default',
			themeStyle: 'default',
			palette: 'default',
			isDark: false,
			enableDrag: true,
			lang: 'zh',
		});

		const [instance] = vendor.instances;
		expect(instance?.options.readonly).toBe(false);
		expect(instance?.added).toEqual([
			'Select',
			'TouchEvent',
			'KeyboardNavigation',
			'DoExport',
			'Search',
			'Drag',
		]);
	});

	it('applyThemeConfig：亮暗与主题偏好经 isDarkTheme 合成（视图与嵌入共用入口）', () => {
		const calls: unknown[] = [];
		const fake = {
			setThemeConfig: (config: unknown): void => {
				calls.push(config);
			},
		};

		// 宿主为亮色但偏好强制暗色 → 取暗色配置；主题（节点外观）原样透传
		applyThemeConfig(fake as never, {
			isDark: false,
			themePref: 'dark',
			layout: 'logicalStructure',
			lineStyle: 'auto',
			themeStyle: 'borderless',
			palette: 'amber',
		});

		expect(calls).toEqual([
			getThemeConfig(
				isDarkTheme('dark', false),
				'logicalStructure',
				'auto',
				'borderless',
				'amber',
			),
		]);
	});

	it('applyThemeConfig：引擎为 null 时安全 no-op', () => {
		expect(() =>
			applyThemeConfig(null, {
				isDark: true,
				themePref: 'default',
				layout: 'mindMap',
				lineStyle: 'curve',
				themeStyle: 'default',
				palette: 'default',
			}),
		).not.toThrow();
	});

	it('嵌入不吃按文件记的两项（配色 / 主题）：两处恒传默认值', () => {
		const source = readFileSync(
			new URL('../src/features/mindmap-codeblock.ts', import.meta.url),
			'utf8',
		);
		// 两处换肤（创建期 + css-change）都必须是默认值
		expect(source.match(/palette: DEFAULT_PALETTE/g)?.length).toBe(2);
		expect(source.match(/themeStyle: DEFAULT_THEME_STYLE/g)?.length).toBe(2);
		// 嵌入面不得读用户设置，也不得从 config 透传这两项
		expect(source).not.toMatch(/settings\.(palette|themeStyle)/);
		expect(source).not.toMatch(/themeStyle: (config|next)\.themeStyle/);
	});
});
