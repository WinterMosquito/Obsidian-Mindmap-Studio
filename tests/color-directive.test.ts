/**
 * 节点配色指令（`%%#hex%%`）回归。
 *
 * 三段口径分别锁在这里：
 * 1. **解析**（`features/node-inline-tokenize.colorDirectiveOf`）：只认注释段里的
 *    三/六位十六进制色；围栏代码 / 行内代码 / 数学里的同形态不是指令；非法值
 *    仍按普通注释（渲染期隐藏，2026-10-27 用户裁决）；
 * 2. **继承**（`domain/color.walkColorDirectives`）：就近覆盖——自身指令优先，
 *    否则取最近祖先，清空指令即回落主题；
 * 3. **落地**（`engine/mindmap-colors`）：填充 / 描边 / 连线同色、文字色按填充
 *    亮度二选一、清空时删除样式键（否则残留覆盖会一直压着主题配色）。
 *
 * 引擎侧只测纯函数与数据写入，不构造真实 `MindMap`（`syncNodeColorDirectives`
 * 用一个最小替身验证「有变化才重渲染」）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode, MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import {
	contrastRatio,
	contrastTextColor,
	inheritedColorOf,
	mixHex,
	nodeContentTones,
	nodeInkColor,
	normalizeHexColor,
	parseColorInput,
	relativeLuminance,
	walkColorDirectives,
} from '../src/domain/color';
import { topMostNodes } from '../src/engine/mindmap-nodes';
import {
	colorDirectiveOf,
	setColorDirective,
} from '../src/features/node-inline-tokenize';
import {
	applyColorDirectivesToTree,
	applyLiveColorDirectives,
} from '../src/engine/mindmap-colors';
import { syncNodeColorDirectives } from '../src/engine/mindmap';

// `engine/mindmap` barrel 会加载 vendor cjs（Node 下顶层求值触碰 document），
// 与 engine-history-limit 同款桩面；本文件不测引擎行为，只需模块可加载。
vi.mock('../vendor/simple-mind-map.cjs', () => ({
	MindMap: class {},
	MindMapNode: class {},
	DoExport: class {},
	Select: class {},
	TouchEvent: class {},
	AssociativeLine: class {},
	KeyboardNavigation: class {},
	Search: class {},
	Drag: class {},
}));

describe('十六进制色归一与亮度', () => {
	it('三位展开、六位小写、外壳空白容忍', () => {
		expect(normalizeHexColor('#0aF')).toBe('#00aaff');
		expect(normalizeHexColor('  #89CFF0 ')).toBe('#89cff0');
	});

	it('非法形态一律 null（含 4/8 位带 alpha）', () => {
		expect(normalizeHexColor('#12')).toBeNull();
		expect(normalizeHexColor('#89CFF00')).toBeNull();
		expect(normalizeHexColor('#ffffff00')).toBeNull();
		expect(normalizeHexColor('89CFF0')).toBeNull();
		expect(normalizeHexColor('red')).toBeNull();
	});

	it('相对亮度：黑 0 / 白 1 / 浅蓝约 0.56', () => {
		expect(relativeLuminance('#000000')).toBe(0);
		expect(relativeLuminance('#ffffff')).toBe(1);
		expect(relativeLuminance('#89cff0')).toBeCloseTo(0.5624, 3);
	});
});

describe('配色指令解析（注释语法）', () => {
	it('取第一处合法指令，归一为小写六位', () => {
		expect(colorDirectiveOf('标题 %%#89CFF0%%')).toBe('#89cff0');
		expect(colorDirectiveOf('%% #0af %% 后接文本')).toBe('#00aaff');
		expect(colorDirectiveOf('%%备注%% 与 %%#FFF%%')).toBe('#ffffff');
	});

	it('非法值不算指令（仍按普通注释隐藏）', () => {
		expect(colorDirectiveOf('%%备注%%')).toBeNull();
		expect(colorDirectiveOf('%%#12%%')).toBeNull();
		expect(colorDirectiveOf('%%#ffffff00%%')).toBeNull();
		expect(colorDirectiveOf('%%#fff')).toBeNull();
		expect(colorDirectiveOf('')).toBeNull();
	});

	it('围栏代码 / 行内代码 / 数学里的同形态不识别', () => {
		expect(colorDirectiveOf('```js\n%%#fff%%\n```')).toBeNull();
		expect(colorDirectiveOf('`%%#fff%%`')).toBeNull();
		expect(colorDirectiveOf('$%%#fff%%$')).toBeNull();
		// 保护区之外的指令照常生效
		expect(colorDirectiveOf('```\n代码\n``` %%#123456%%')).toBe('#123456');
	});

	it('哨兵 `none`：裸词才算（大小写 / 外壳空白宽容，`#none` 不算）', () => {
		expect(colorDirectiveOf('标题 %%none%%')).toBe('none');
		expect(colorDirectiveOf('%% None %% 后接文本')).toBe('none');
		expect(colorDirectiveOf('%%NONE%%')).toBe('none');
		// 带 `#` 既不是十六进制也不是哨兵 ⇒ 仍按普通注释隐藏
		expect(colorDirectiveOf('%%#none%%')).toBeNull();
		// 与十六进制混写：照旧取第一处
		expect(colorDirectiveOf('%%#f00%% 与 %%none%%')).toBe('#ff0000');
		expect(colorDirectiveOf('%%none%% 与 %%#f00%%')).toBe('none');
		// 哨兵同样受保护区约束
		expect(colorDirectiveOf('```\n%%none%%\n```')).toBeNull();
	});
});

describe('自定义颜色输入（十六进制 / RGB）', () => {
	it('十六进制：带不带 #、三位缩写都收，统一小写六位', () => {
		expect(parseColorInput('#89CFF0')).toBe('#89cff0');
		expect(parseColorInput('89cff0')).toBe('#89cff0');
		expect(parseColorInput('#0aF')).toBe('#00aaff');
		expect(parseColorInput('   #FFF  ')).toBe('#ffffff');
	});

	it('RGB：rgb() / 裸三元组，逗号或空格分隔', () => {
		expect(parseColorInput('rgb(137, 207, 240)')).toBe('#89cff0');
		expect(parseColorInput('137,207,240')).toBe('#89cff0');
		expect(parseColorInput('137 207 240')).toBe('#89cff0');
		// 带 alpha 的形态与十六进制的 4/8 位同口径：拒绝（无法确定文字对比色）
		expect(parseColorInput('rgba(137,207,240,0.8)')).toBeNull();
	});

	it('非法值：越界 / 缺通道 / 空串 / 带 alpha 的十六进制', () => {
		expect(parseColorInput('256, 0, 0')).toBeNull();
		expect(parseColorInput('12, 34')).toBeNull();
		expect(parseColorInput('')).toBeNull();
		expect(parseColorInput('#89cff0ff')).toBeNull();
		expect(parseColorInput('蓝色')).toBeNull();
	});

	it('混色：0 → 原色、1 → 目标色、中间值落在两色之间', () => {
		expect(mixHex('#89cff0', '#ffffff', 0)).toBe('#89cff0');
		expect(mixHex('#89cff0', '#ffffff', 1)).toBe('#ffffff');
		expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
	});

	it('对比文字色：浅底深字、深底白字', () => {
		expect(contrastTextColor('#89cff0')).toBe('#1e293b');
		expect(contrastTextColor('#123456')).toBe('#ffffff');
	});
});

describe('节点墨色与派生内容色', () => {
	/** 五套配色的节点色（`paletteNodeColor` = 各配色 light.rootFill） */
	const PALETTE_NODE_COLORS = [
		'#2e9e8f',
		'#c2761a',
		'#7c5cd6',
		'#2f7d5a',
		'#475569',
	] as const;

	it('首选柔和墨色够 4.5 就不换纯黑（浅底不刺眼）', () => {
		expect(nodeInkColor('#89cff0')).toBe('#111827');
		expect(nodeInkColor('#ffffff')).toBe('#111827');
	});

	it('深底与中间调：深底白字、中间调退纯黑（方案 A：不改底色）', () => {
		expect(nodeInkColor('#1e3a8a')).toBe('#ffffff');
		expect(nodeInkColor('#111111')).toBe('#ffffff');
		expect(nodeInkColor('#777777')).toBe('#000000');
		expect(nodeInkColor('#808080')).toBe('#000000');
	});

	it('五套配色：正文与码块均 ≥ 4.5，网格线 ≥ 2', () => {
		for (const fill of PALETTE_NODE_COLORS) {
			const tones = nodeContentTones(fill);
			expect(
				contrastRatio(tones.ink, fill),
				`${fill} 正文`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrastRatio(tones.ink, tones.chip),
				`${fill} 码块`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrastRatio(tones.border, fill),
				`${fill} 网格线`,
			).toBeGreaterThanOrEqual(2);
		}
	});

	it('近白 / 近黑节点：码块与底色仍有可见阶差（不会整块消失）', () => {
		for (const fill of ['#ffffff', '#fafafa', '#000000', '#111111']) {
			const tones = nodeContentTones(fill);
			expect(tones.chip, `${fill} 码块色`).not.toBe(fill);
			expect(
				contrastRatio(tones.ink, tones.chip),
				`${fill} 码块文字`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe('写入 / 清除颜色指令', () => {
	it('无指令时追加（原文已以空白结尾则不补空格；空原文不加前导空格）', () => {
		expect(setColorDirective('项目', '#89cff0')).toBe('项目 %%#89cff0%%');
		expect(setColorDirective('项目 ', '#89cff0')).toBe('项目 %%#89cff0%%');
		expect(setColorDirective('', '#89cff0')).toBe('%%#89cff0%%');
	});

	it('已有指令：替换第一处，保留原有间隔', () => {
		expect(setColorDirective('项目 %%#ff0000%%', '#00ff00')).toBe(
			'项目 %%#00ff00%%',
		);
	});

	it('多条指令：替换第一条，其余连同前一个空白删除', () => {
		expect(setColorDirective('A %%#ff0000%% B %%#00ff00%%', '#123456')).toBe(
			'A %%#123456%% B',
		);
	});

	it('清除：删除指令并吞掉前一个空白（不留双空格）', () => {
		expect(setColorDirective('项目 %%#ff0000%% 说明', null)).toBe('项目 说明');
		expect(setColorDirective('项目 %%#ff0000%%', null)).toBe('项目');
		expect(setColorDirective('%%#ff0000%%', null)).toBe('');
		expect(setColorDirective('项目', null)).toBe('项目');
	});

	it('清除行首指令：没有前导空白可吞，改吞后一个（不留前导空格）', () => {
		expect(setColorDirective('%%#ff0000%% 项目', null)).toBe('项目');
		expect(setColorDirective('%%#ff0000%% 项目', '#00ff00')).toBe(
			'%%#00ff00%% 项目',
		);
	});

	it('保护区（围栏代码 / 行内代码 / 数学）里的同形态不动', () => {
		const raw = '```\n%%#ff0000%%\n``` 后文';
		expect(setColorDirective(raw, '#00ff00')).toBe(
			'```\n%%#ff0000%%\n``` 后文 %%#00ff00%%',
		);
		expect(setColorDirective('`%%#ff0000%%`', null)).toBe('`%%#ff0000%%`');
	});

	it('非法注释不算指令：不清除、也不阻挡正常的追加', () => {
		expect(setColorDirective('%%备注%%', null)).toBe('%%备注%%');
		expect(setColorDirective('%%备注%%', '#123456')).toBe(
			'%%备注%% %%#123456%%',
		);
	});

	it('哨兵 `none` 与十六进制走同一条替换 / 清除逻辑', () => {
		expect(setColorDirective('项目', 'none')).toBe('项目 %%none%%');
		expect(setColorDirective('项目 %%#ff0000%%', 'none')).toBe('项目 %%none%%');
		expect(setColorDirective('项目 %%none%%', '#00ff00')).toBe(
			'项目 %%#00ff00%%',
		);
		// 「默认」把哨兵一并删掉（回到继承上层）
		expect(setColorDirective('项目 %%none%%', null)).toBe('项目');
		// 写出即可读回（解析与写入同一份判定）
		expect(colorDirectiveOf(setColorDirective('项目', 'none'))).toBe('none');
	});

	it('多行节点：无指令时追加到末行行尾', () => {
		expect(setColorDirective('标题\n第二行', '#89cff0')).toBe(
			'标题\n第二行 %%#89cff0%%',
		);
		// 末行已以空白结尾 ⇒ 不再补空格
		expect(setColorDirective('标题\n第二行 ', '#89cff0')).toBe(
			'标题\n第二行 %%#89cff0%%',
		);
	});

	/**
	 * 块级语法行不能**行内**尾插（2026-10-27 实机事故）：闭合围栏行尾插会让
	 * CommonMark 认为围栏未闭合，其后的同级节点全部被吞进这段代码；表格行尾插
	 * 会被 GFM 当成新单元格。两处都改为另起一行。
	 */
	it('末行是围栏定界行：另起一行（不在定界符后面接指令）', () => {
		const raw = '标题\n```js\nconst a = 1\n```';
		const written = setColorDirective(raw, '#89cff0');
		expect(written).toBe(`${raw}\n%%#89cff0%%`);
		// 闭合围栏行原样保留 ⇒ 重解析时围栏仍然闭合
		expect(written.split('\n')[3]).toBe('```');
		// 另起的那一行仍被读成指令（续行并入同一节点）
		expect(colorDirectiveOf(written)).toBe('#89cff0');
	});

	it('末行是表格行：另起一行（不在尾管符后接指令）', () => {
		const raw = '标题\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |';
		const written = setColorDirective(raw, '#89cff0');
		expect(written).toBe(`${raw}\n%%#89cff0%%`);
		expect(written).not.toContain('| %%#');
		expect(colorDirectiveOf(written)).toBe('#89cff0');
	});

	/**
	 * 上一条的**逆操作**：清除时必须把整行删掉，不能只删指令本身——否则原文末尾
	 * 留下一个空行，保存后文件凭空多一行、紧列表变松散列表（2026-10-27 审核发现）。
	 */
	it('清除独占一行的指令：整行连换行一起删（不留空行）', () => {
		const fence = '标题\n```js\nconst a = 1\n```';
		expect(setColorDirective(`${fence}\n%%#89cff0%%`, null)).toBe(fence);
		const table = '标题\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |';
		expect(setColorDirective(`${table}\n%%#89cff0%%`, null)).toBe(table);
		// 中间行：吞前一个换行，前后两行直接相接
		expect(setColorDirective('甲\n%%#89cff0%%\n乙', null)).toBe('甲\n乙');
		// 首行：没有前导换行可吞，改吞本行末尾那个
		expect(setColorDirective('%%#89cff0%%\n甲', null)).toBe('甲');
	});

	it('上色 → 「默认」往返回到原文（围栏 / 表格节点）', () => {
		const sources = [
			'标题\n```js\nconst a = 1\n```',
			'标题\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |',
		];
		for (const raw of sources) {
			expect(setColorDirective(setColorDirective(raw, '#2e9e8f'), null)).toBe(
				raw,
			);
		}
	});

	it('写入后解析口径一致（往返）', () => {
		const written = setColorDirective('项目', '#89cff0');
		expect(colorDirectiveOf(written)).toBe('#89cff0');
		expect(colorDirectiveOf(setColorDirective(written, null))).toBeNull();
	});
});

describe('最上层节点（多选合并）', () => {
	it('祖先被选中时，子孙从集合中剔除；顺序保持输入序', () => {
		const parent = fakeNode({ text: '父' });
		const child = fakeNode({ text: '子' });
		const sibling = fakeNode({ text: '兄弟' });
		child.parent = parent;
		parent.children = [child];
		expect(topMostNodes([child, sibling, parent])).toEqual([sibling, parent]);
		expect(topMostNodes([child])).toEqual([child]);
	});
});

describe('就近覆盖的继承遍历', () => {
	it('父节点颜色传给全部后代，子节点自身指令覆盖', () => {
		const tree = {
			name: 'root',
			children: [
				{ name: 'a', children: [{ name: 'a1', children: [] }] },
				{ name: 'b', children: [{ name: 'b1', children: [] }] },
			],
		};
		const directives: Record<string, string | null> = {
			root: null,
			a: '#111111',
			b: '#222222',
			b1: '#333333',
		};
		const result: Record<string, string | null> = {};
		walkColorDirectives(
			tree,
			(node) => directives[node.name] ?? null,
			(node, color) => {
				result[node.name] = color;
			},
		);
		expect(result).toEqual({
			root: null,
			a: '#111111',
			a1: '#111111',
			b: '#222222',
			b1: '#333333',
		});
	});

	/**
	 * 哨兵是**继承链上的空层**：它自己回落主题，且祖先色**到此为止**——
	 * 这是「彩色子树里的单个节点脱色」的唯一通路（删指令只会继续继承上层）。
	 */
	it('哨兵阻断继承：`none` 节点与其后代都不吃祖先色，兄弟节点照常染色', () => {
		const tree = {
			name: 'root',
			children: [
				{
					name: 'a',
					children: [
						{ name: 'a1', children: [{ name: 'a11', children: [] }] },
						{ name: 'a2', children: [] },
					],
				},
			],
		};
		const directives: Record<string, string | null> = {
			root: null,
			a: '#111111',
			a1: 'none',
			a2: '#222222',
		};
		const result: Record<string, string | null> = {};
		walkColorDirectives(
			tree,
			(node) => directives[node.name] ?? null,
			(node, color) => {
				result[node.name] = color;
			},
		);
		expect(result).toEqual({
			root: null,
			a: '#111111',
			a1: null, // 哨兵：自己不受父色影响
			a11: null, // 且不往下一代传
			a2: '#222222', // 兄弟照常染色
		});
	});
});

describe('自上层继承（inheritedColorOf）', () => {
	interface ChainNode {
		color: string | null;
		parent: ChainNode | null;
	}
	const readOwn = (node: ChainNode): string | null => node.color;
	/** 按「根 → 叶」顺序串成父链，返回最末节点 */
	const chain = (...colors: Array<string | null>): ChainNode => {
		let parent: ChainNode | null = null;
		let last: ChainNode | null = null;
		for (const color of colors) {
			last = { color, parent };
			parent = last;
		}
		return last!;
	};

	it('取最近一条指令；中间节点没写指令则继续往上找', () => {
		expect(inheritedColorOf(chain('#111111', null, null), readOwn)).toBe(
			'#111111',
		);
	});

	it('最近的指令是哨兵 ⇒ 返回 null 并终止（更上面的颜色不再露出来）', () => {
		expect(inheritedColorOf(chain('#111111', 'none', null), readOwn)).toBeNull();
	});

	it('一路没有指令 / 没有父节点 ⇒ null', () => {
		expect(inheritedColorOf(chain(null, null), readOwn)).toBeNull();
		expect(inheritedColorOf(chain('#111111'), readOwn)).toBeNull();
	});
});

interface FakeData {
	text?: string;
	mdRaw?: string;
	mdDerivedText?: string;
	fillColor?: string;
	lineColor?: string;
	color?: string;
	[key: string]: unknown;
}

function fakeTree(data: FakeData, children: MindMapTreeNode[] = []): MindMapTreeNode {
	return { data, children };
}

describe('data 树落地（引擎创建前）', () => {
	it('填充与连线同色；浅底配深字、深底配白字', () => {
		const light = fakeTree({ text: '浅', mdRaw: '浅 %%#89CFF0%%' });
		const dark = fakeTree({ text: '深', mdRaw: '深 %%#123456%%' });
		const root = fakeTree({ text: 'root', mdRaw: 'root' }, [light, dark]);

		applyColorDirectivesToTree(root, colorDirectiveOf);

		expect(light.data).toMatchObject({
			fillColor: '#89cff0',
			borderColor: '#89cff0',
			lineColor: '#89cff0',
			color: '#111827',
		});
		expect(dark.data).toMatchObject({
			fillColor: '#123456',
			borderColor: '#123456',
			lineColor: '#123456',
			color: '#ffffff',
		});
		// 未写指令的根节点不产生任何样式键（走整篇配色）
		expect(root.data.fillColor).toBeUndefined();
	});

	it('后代继承最近祖先；指令被删掉后样式键一并清除', () => {
		const child = fakeTree({ text: '子', mdRaw: '子' });
		const root = fakeTree({ text: 'root', mdRaw: 'root %%#ff0000%%' }, [child]);

		applyColorDirectivesToTree(root, colorDirectiveOf);
		expect(child.data.fillColor).toBe('#ff0000');

		// 模拟用户把指令删掉后重新解析
		root.data.mdRaw = 'root';
		applyColorDirectivesToTree(root, colorDirectiveOf);
		expect(root.data.fillColor).toBeUndefined();
		expect(root.data.borderColor).toBeUndefined();
		expect(root.data.lineColor).toBeUndefined();
		expect(root.data.color).toBeUndefined();
		expect(child.data.fillColor).toBeUndefined();
	});

	it('已编辑节点按 data.text 判定（mdRaw 过期不再生效）', () => {
		const node = fakeTree({
			text: '新文本',
			mdRaw: '旧文本 %%#ffffff%%',
			mdDerivedText: '旧文本',
		});
		applyColorDirectivesToTree(node, colorDirectiveOf);
		expect(node.data.fillColor).toBeUndefined();
	});
});

function fakeNode(data: FakeData, children: MindMapNode[] = []): MindMapNode {
	return {
		getData: () => data,
		children,
	} as unknown as MindMapNode;
}

describe('实时节点树同步（引擎创建后）', () => {
	it('首次应用有变化、再次应用幂等', () => {
		const child = fakeNode({ text: '子', mdRaw: '子 %%#00ff00%%' });
		const root = fakeNode({ text: 'root', mdRaw: 'root' }, [child]);

		expect(applyLiveColorDirectives(root, colorDirectiveOf)).toBe(true);
		expect(child.getData()).toMatchObject({ fillColor: '#00ff00' });
		expect(applyLiveColorDirectives(root, colorDirectiveOf)).toBe(false);
	});

	it('指令移除后清空覆盖（回落主题）', () => {
		const node = fakeNode({ text: '同', mdRaw: '同 %%#00ff00%%' });
		applyLiveColorDirectives(node, colorDirectiveOf);
		(node.getData() as FakeData).mdRaw = '同';
		expect(applyLiveColorDirectives(node, colorDirectiveOf)).toBe(true);
		expect((node.getData() as FakeData).fillColor).toBeUndefined();
	});

	it('哨兵节点：自身与后代都不挂色，兄弟节点仍染色', () => {
		const grand = fakeNode({ text: '孙', mdRaw: '孙' });
		const blocked = fakeNode({ text: '子', mdRaw: '子 %%none%%' }, [grand]);
		const colored = fakeNode({ text: '兄弟', mdRaw: '兄弟' });
		const root = fakeNode({ text: 'root', mdRaw: 'root %%#ff0000%%' }, [
			blocked,
			colored,
		]);

		expect(applyLiveColorDirectives(root, colorDirectiveOf)).toBe(true);
		expect(root.getData()).toMatchObject({ fillColor: '#ff0000' });
		expect(colored.getData()).toMatchObject({ fillColor: '#ff0000' });
		expect(blocked.getData()).not.toHaveProperty('fillColor');
		expect(grand.getData()).not.toHaveProperty('fillColor');
	});
});

describe('syncNodeColorDirectives：只在有变化时重渲染', () => {
	it('首次同步渲染一次，无变化不再渲染', () => {
		const child = fakeNode({ text: '子', mdRaw: '子 %%#0000ff%%' });
		const root = fakeNode({ text: 'root', mdRaw: 'root' }, [child]);
		const render = vi.fn();
		const mindMap = {
			renderer: { root },
			render,
		} as unknown as MindMap;

		expect(syncNodeColorDirectives(mindMap, colorDirectiveOf)).toBe(true);
		expect(render).toHaveBeenCalledTimes(1);

		expect(syncNodeColorDirectives(mindMap, colorDirectiveOf)).toBe(false);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('空引擎（未就绪）不抛错', () => {
		expect(syncNodeColorDirectives(null, colorDirectiveOf)).toBe(false);
	});
});
