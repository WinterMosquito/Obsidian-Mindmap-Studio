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
	parseEmbedLayoutDirective,
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

		// `createMindMap` 末尾会挂「测量残渣清理」（`node_tree_render_end` →
		// `clearMeasureResidue`），桩需提供事件注册面（真实引擎 d.cts 有 `on`）
		on(): void {}

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
		// 联系（关系连线）的渲染插件：两种模式都注册（只读态只绑渲染事件）
		AssociativeLine: class AssociativeLine {},
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

describe('parseEmbedLayoutDirective（块体首行布局指令）', () => {
	it('合法值：剥离指令行，返回引擎 layout id', () => {
		expect(
			parseEmbedLayoutDirective('%%layout: Timeline%%\n# 主题\n- 叶子'),
		).toEqual({ source: '# 主题\n- 叶子', layoutId: 'timeline' });
	});

	it('宽容写法：键名大小写不敏感，值走同一套归一（连字符 / 空格 / 大小写）', () => {
		expect(
			parseEmbedLayoutDirective('%%LAYOUT: logical-structure%%\n# A').layoutId,
		).toBe('logicalStructure');
		expect(
			parseEmbedLayoutDirective('%% Layout : Fish Bone %%\n# A').layoutId,
		).toBe('fishbone');
	});

	it('允许指令前有空行，且空行原样保留（只删指令行本身）', () => {
		expect(
			parseEmbedLayoutDirective('\n\n%%layout: mindMap%%\n# A'),
		).toEqual({ source: '\n\n# A', layoutId: 'mindMap' });
	});

	it('非法值：同样剥离指令行，layoutId 为 null 并回填 invalidValue（布局回落默认）', () => {
		expect(parseEmbedLayoutDirective('%%layout: 笔记%%\n# A')).toEqual({
			source: '# A',
			layoutId: null,
			invalidValue: '笔记',
		});
	});

	it('`Markdown` 在嵌入里也是非法值（嵌入没有「终止渲染」语义）', () => {
		expect(parseEmbedLayoutDirective('%%layout: Markdown%%\n# A')).toEqual({
			source: '# A',
			layoutId: null,
			invalidValue: 'Markdown',
		});
	});

	it('外壳不匹配的普通注释原样返回（不能误吃用户注释）', () => {
		const source = '%%备注%%\n# A';
		expect(parseEmbedLayoutDirective(source)).toEqual({
			source,
			layoutId: null,
		});
	});

	it('值不可为空：`%%layout: %%` 等同普通注释（不剥行、不弹提示）', () => {
		// `(.+?)` 会吃掉分隔空白那个空格 ⇒ 外壳其实命中，故取到值后必须先判空。
		for (const source of [
			'%%layout: %%\n# A',
			'%%layout:   %%\n# A',
			'%%layout:%%\n# A',
		]) {
			expect(parseEmbedLayoutDirective(source)).toEqual({
				source,
				layoutId: null,
			});
		}
	});

	it('无指令：原样返回（含首行不是指令、整段没有指令）', () => {
		const plain = '# A\n- b';
		expect(parseEmbedLayoutDirective(plain)).toEqual({
			source: plain,
			layoutId: null,
		});
		expect(parseEmbedLayoutDirective('')).toEqual({ source: '', layoutId: null });
	});

	it('只识别首行：其后出现的同形文本是正文', () => {
		const source = '# A\n%%layout: Timeline%%';
		expect(parseEmbedLayoutDirective(source)).toEqual({
			source,
			layoutId: null,
		});
	});

	it('指令行不进入大纲（先剥离再 parseMdOutline）', () => {
		const parsed = parseEmbedLayoutDirective(
			'%%layout: Fishbone%%\n# 主题\n- 叶子',
		);
		const tree = embedDisplayTree(
			parseMdOutline(parsed.source, '思维导图').tree,
		);
		expect(tree.data.text).toBe('主题');
		expect(JSON.stringify(tree)).not.toContain('layout');
		expect(JSON.stringify(tree)).not.toContain('%%');
	});

	it('只有指令行、没有正文 → 剥离后为空（走现有「空块」提示）', () => {
		const parsed = parseEmbedLayoutDirective('%%layout: Timeline%%');
		expect(parsed.source.trim()).toBe('');
		expect(parseMdOutline(parsed.source, '思维导图').tree.children).toEqual([]);
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

	it('非法布局指令有块内提示（i18n 双语，值落在文案里）', () => {
		expect(t('zh', 'mindmapEmbed.unknownLayout')).not.toBe('');
		expect(t('en', 'mindmapEmbed.unknownLayout')).not.toBe('');
		expect(
			tf('zh', 'mindmapEmbed.unknownLayout', { value: '笔记' }),
		).toContain('笔记');
	});

	it('布局回退：无指令时用 config.layout，css-change 复用挂载时的解析结果', () => {
		const source = readFileSync(
			new URL('../src/features/mindmap-codeblock.ts', import.meta.url),
			'utf8',
		);
		// 挂载期：指令 ?? 回退值，存入实例字段
		expect(source).toContain(
			'this.embedLayout = directive.layoutId ?? config.layout;',
		);
		// 引擎创建（可能晚于挂载）读字段，不再重读配置
		expect(source).toContain('const layout = this.embedLayout ?? config.layout;');
		// 换肤同理：重读配置会让指令布局漂回默认
		expect(source).toContain('layout: this.embedLayout ?? next.layout,');
	});

	it('代码块语言键保持 mindmap（存量笔记的接口，改动即静默失效）', () => {
		expect(CODE_BLOCK_LANGUAGE).toBe('mindmap');
	});

	it('只读嵌入：opt.readonly 为真且只注册「只画线」的关联线插件', () => {
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
		// 只注册 AssociativeLine（联系/关系连线要能看见）；它的交互副作用由
		// vendor 补丁 13 在只读态整段跳过 ⇒ 不会抢宿主按键。Drag 仍然不注册。
		expect(instance?.added).toEqual(['AssociativeLine']);
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
			// 联系（关系连线）的渲染插件：两种模式都注册，位置在交互插件之后
			'AssociativeLine',
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

	it('嵌入的边框跟全局默认、配色恒基准蓝：两处都不读顶栏按文件值', () => {
		const source = readFileSync(
			new URL('../src/features/mindmap-codeblock.ts', import.meta.url),
			'utf8',
		);
		// 两处换肤（创建期 + css-change）：边框从 config 透传（＝ settings.defaultThemeStyle）
		expect(source.match(/themeStyle: (config|next)\.themeStyle/g)?.length).toBe(2);
		// 配色只有按文件记的值、没有全局默认 → 两处恒用基准蓝
		expect(source.match(/palette: DEFAULT_PALETTE/g)?.length).toBe(2);
		// 嵌入面不得直接读 settings（取值一律由组合根注入 config）
		expect(source).not.toMatch(/settings\.(palette|themeStyle|defaultThemeStyle)/);
		// 注入端：组合根必须取**全局默认**，不能硬编码、也不能取顶栏按文件值
		const mainSource = readFileSync(
			new URL('../src/main.ts', import.meta.url),
			'utf8',
		);
		expect(mainSource).toMatch(
			/themeStyle: this\.settings\.defaultThemeStyle/,
		);
	});
});
