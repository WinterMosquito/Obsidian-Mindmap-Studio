/**
 * 联系（关系连线）指令回归：`%%id:xxxxxx%%` / `%%rel:xxxxxx | 标签%%`。
 *
 * 四段口径分别锁在这里：
 * 1. **语法**（`domain/relation`）：判定表、行内兼容形态的剥离、`isDirectiveLine`；
 * 2. **归属**（`markdown/md-outline`）：整行只有指令的行**不产出节点**，挂到上一个
 *    节点（heading / list / plain 三条路径），且不进 text；
 * 3. **回写**（`markdown/md-serialize` + `md-line-write`）：未编辑逐字回写、编辑后
 *    由 `mdDirectiveTail` 贴回末行；
 * 4. **图解析**（`resolveRelationGraph`）：id 权威性 / 悬空 / 重复 / 自环 / 边上限。
 *
 * 语法为什么是"独立指令行"而不是行内尾插，见 `domain/relation` 文件头（2026-10-30
 * 实机：行内形态会让 Obsidian 的 heading 文本带上注释，`[[#标题]]` 与 `^block-id` 失效）。
 */
import { describe, expect, it } from 'vitest';
import {
	applyDirectiveLine,
	isDirectiveLine,
	normalizeRelationId,
	relationStateOf,
	relationStateOfSource,
	renderDirectiveLine,
	resolveRelationGraph,
	splitDirectiveTail,
	stripDirectiveTail,
	stripTrailingSegments,
} from '../src/domain/relation';
import { parseMdOutline } from '../src/markdown/md-outline';
import { serializeMdBody } from '../src/markdown/md-serialize';
import { applyRawToNode } from '../src/markdown/md-line-write';
import type { MdNodeData } from '../src/core/node-data';

/** 构造一个"未编辑"的节点 data（rawOk 走 mdRaw 逐字回写） */
function rawData(text: string, mdRaw = text): MdNodeData {
	return { text, mdDerivedText: text, mdRaw };
}

describe('指令语法', () => {
	it('id 归一：trim + 小写，长度/字符集不符即非法', () => {
		expect(normalizeRelationId(' 7F3A11 ')).toBe('7f3a11');
		expect(normalizeRelationId('7f3a11')).toBe('7f3a11');
		expect(normalizeRelationId('7f3')).toBeNull();
		expect(normalizeRelationId('7f3a110')).toBeNull();
		expect(normalizeRelationId('zzzzzz')).toBeNull();
		expect(normalizeRelationId('')).toBeNull();
	});

	it('isDirectiveLine：整行只由合法指令段组成才算', () => {
		expect(isDirectiveLine('%%id:7f3a11%%')).toBe(true);
		expect(isDirectiveLine('  %%id:7f3a11%%  %%rel:9c2e22 | 依赖%%  ')).toBe(true);
		expect(isDirectiveLine('%%rel:9c2e22%%')).toBe(true);
		// 混入非指令文本 / 非法段 → 整行不算（fail-closed）
		expect(isDirectiveLine('标题 %%id:7f3a11%%')).toBe(false);
		expect(isDirectiveLine('%%备注%%')).toBe(false);
		expect(isDirectiveLine('%%id:7f3%%')).toBe(false);
		expect(isDirectiveLine('%%id:7f3a11%% 后文')).toBe(false);
		expect(isDirectiveLine('')).toBe(false);
		expect(isDirectiveLine('%%id:7f3a11%% %%bad%%')).toBe(false);
	});

	it('标签不允许 `[[` / `]]` / `%%`（注释体不是行内 token 保护区）', () => {
		expect(isDirectiveLine('%%rel:7f3a11 | [[笔记]]%%')).toBe(false);
		expect(isDirectiveLine('%%rel:7f3a11 | a%%b%%')).toBe(false);
		// 首个 `|` 之后整段都是标签，`|` 本身允许
		expect(relationStateOfSource('子\n%%rel:7f3a11 | a|b%%').refs[0]).toEqual({
			target: '7f3a11',
			label: 'a|b',
		});
	});

	it('stripTrailingSegments：只剥行尾连续指令段', () => {
		expect(stripTrailingSegments('标题 %%rel:7f3a11%%')).toEqual({
			text: '标题',
			segments: ['%%rel:7f3a11%%'],
		});
		expect(stripTrailingSegments('标题 %%备注%%')).toEqual({
			text: '标题 %%备注%%',
			segments: [],
		});
		expect(stripTrailingSegments('纯文本')).toEqual({
			text: '纯文本',
			segments: [],
		});
	});
});

describe('几何（拖动端点 / 控制点后的持久化）', () => {
	const geo = {
		fromDir: 'right' as const,
		fromRange: 0,
		toDir: 'left' as const,
		toRange: 8,
		ctl1: { x: 12, y: 0 },
		ctl2: { x: -30, y: -12 },
	};

	it('第三段 `geo=…` 解析为 8 个字段，且与渲染互为逆映射', () => {
		const tail = '%%rel:7f3a11 | 依赖 | geo=right,0,left,8,12,0,-30,-12%%';
		const state = relationStateOfSource(`源\n${tail}`);
		expect(state.refs).toHaveLength(1);
		expect(state.refs[0]?.label).toBe('依赖');
		expect(state.refs[0]?.geo).toEqual(geo);
		// 写回去必须逐字相同（幂等，避免每次保存都改文件）
		expect(renderDirectiveLine(state)).toBe(tail);
	});

	it('没有 geo 段时不产生几何（走引擎自动计算）', () => {
		expect(
			relationStateOfSource('源\n%%rel:7f3a11 | 依赖%%').refs[0]?.geo,
		).toBeUndefined();
	});

	it('标签里允许 `|`，只有末段以 `geo=` 开头才算几何', () => {
		const state = relationStateOfSource(
			'源\n%%rel:7f3a11 | A|B|geo=top,3,bottom,-4,1,2,3,4%%',
		);
		expect(state.refs[0]?.label).toBe('A|B');
		expect(state.refs[0]?.geo?.fromDir).toBe('top');
		// 不是几何的 `|` 段仍是标签
		const plain = relationStateOfSource('源\n%%rel:7f3a11 | A|B%%');
		expect(plain.refs[0]?.label).toBe('A|B');
		expect(plain.refs[0]?.geo).toBeUndefined();
	});

	it('几何值非法：**丢弃几何、保留边**（不把整条边降级成普通注释）', () => {
		for (const bad of [
			'geo=right,0,left,8,12,0,-30', // 字段数不对
			'geo=up,0,left,8,12,0,-30,-12', // dir 不认识
			'geo=right,x,left,8,12,0,-30,-12', // range 非数
			'geo=right,0,left,8,12,0,-30,999999', // 越界
		]) {
			const state = relationStateOfSource(`源\n%%rel:7f3a11 | 依赖 | ${bad}%%`);
			expect(state.refs, bad).toHaveLength(1);
			expect(state.refs[0]?.label, bad).toBe('依赖');
			expect(state.refs[0]?.geo, bad).toBeUndefined();
		}
	});

	it('几何取整：亚像素由 renderRelationGeometry 四舍五入（写入侧稳定）', () => {
		const state = relationStateOfSource(
			'源\n%%rel:7f3a11 | 依赖 | geo=right,1.4,left,-2.6,0,0,0,0%%',
		);
		expect(renderDirectiveLine(state)).toBe(
			'%%rel:7f3a11 | 依赖 | geo=right,1,left,-3,0,0,0,0%%',
		);
	});

	it('指令行判定包含几何段（否则整行会被当普通注释，边丢失）', () => {
		expect(
			isDirectiveLine('%%rel:7f3a11 | 依赖 | geo=right,0,left,8,12,0,-30,-12%%'),
		).toBe(true);
	});

	it('改写后几何保留（改标签不影响几何）', () => {
		const raw = '源\n%%rel:7f3a11 | 依赖 | geo=right,0,left,8,12,0,-30,-12%%';
		const next = applyDirectiveLine(
			raw,
			renderDirectiveLine({
				id: null,
				refs: [{ target: '7f3a11', label: '强依赖', geo }],
			}),
		);
		expect(next).toContain('强依赖');
		expect(next).toContain('geo=right,0,left,8,12,0,-30,-12');
		expect(relationStateOfSource(next).refs[0]?.geo).toEqual(geo);
	});
});

describe('线色（`color=` 段）', () => {
	it('解析为归一 hex，且与渲染互为逆映射', () => {
		const tail = '%%rel:7f3a11 | 依赖 | color=#4A90D9%%';
		const state = relationStateOfSource(`源\n${tail}`);
		expect(state.refs[0]?.label).toBe('依赖');
		expect(state.refs[0]?.color).toBe('#4a90d9');
		expect(renderDirectiveLine(state)).toBe(
			'%%rel:7f3a11 | 依赖 | color=#4a90d9%%',
		);
	});

	it('三位缩写归一为六位（写进文件的恒是 `#rrggbb`）', () => {
		const state = relationStateOfSource('源\n%%rel:7f3a11 | 依赖 | color=#0aF%%');
		expect(state.refs[0]?.color).toBe('#00aaff');
	});

	it('与 geo 段顺序无关；写侧固定 geo → color（保证幂等）', () => {
		const geo = 'geo=right,0,left,8,12,0,-30,-12';
		const a = relationStateOfSource(`源\n%%rel:7f3a11 | 依赖 | ${geo} | color=#ff0000%%`);
		const b = relationStateOfSource(`源\n%%rel:7f3a11 | 依赖 | color=#ff0000 | ${geo}%%`);
		expect(a.refs[0]?.geo).toEqual(b.refs[0]?.geo);
		expect(a.refs[0]?.color).toBe('#ff0000');
		expect(renderDirectiveLine(a)).toBe(
			`%%rel:7f3a11 | 依赖 | ${geo} | color=#ff0000%%`,
		);
	});

	it('没有 color 段 = 跟随主题（undefined，不是空串）', () => {
		expect(
			relationStateOfSource('源\n%%rel:7f3a11 | 依赖%%').refs[0]?.color,
		).toBeUndefined();
	});

	it('颜色值非法：丢弃颜色、保留边与标签（不降级成普通注释）', () => {
		for (const bad of ['red', '#12345', '#ff000080', 'rgb(1,2,3)', '']) {
			const state = relationStateOfSource(
				`源\n%%rel:7f3a11 | 依赖 | color=${bad}%%`,
			);
			expect(state.refs, bad).toHaveLength(1);
			expect(state.refs[0]?.label, bad).toBe('依赖');
			expect(state.refs[0]?.color, bad).toBeUndefined();
		}
	});

	it('重复的 color 段 / 其它 `key=` 段仍属标签（不吞用户文字）', () => {
		const dup = relationStateOfSource(
			'源\n%%rel:7f3a11 | 甲 | color=#ff0000 | color=#00ff00%%',
		);
		expect(dup.refs[0]?.color).toBe('#00ff00');
		expect(dup.refs[0]?.label).toBe('甲 | color=#ff0000');

		const formula = relationStateOfSource('源\n%%rel:7f3a11 | 公式 a=b%%');
		expect(formula.refs[0]?.label).toBe('公式 a=b');
		expect(formula.refs[0]?.color).toBeUndefined();
	});

	it('指令行判定包含颜色段（否则整行会被当普通注释，边丢失）', () => {
		expect(isDirectiveLine('%%rel:7f3a11 | 依赖 | color=#ff0000%%')).toBe(true);
		expect(
			isDirectiveLine('%%rel:7f3a11 | 依赖 | geo=right,0,left,8,12,0,-30,-12 | color=#ff0000%%'),
		).toBe(true);
	});
});

describe('状态读取', () => {
	it('独立指令行：id 取首个，rel 按出现顺序且去重', () => {
		const state = relationStateOfSource(
			'子\n%%id:7f3a11%% %%rel:9c2e22 | 依赖%%\n%%id:aaaaaa%% %%rel:9c2e22%%',
		);
		expect(state.id).toBe('7f3a11');
		expect(state.refs).toEqual([{ target: '9c2e22', label: '依赖' }]);
	});

	it('行内兼容形态同样能读', () => {
		expect(relationStateOfSource('标题 %%id:7f3a11%%')).toEqual({
			id: '7f3a11',
			refs: [],
		});
	});

	it('只认行尾：行中间的段不算，孤立整行按字面（不产生关系）', () => {
		// 行尾的 `%%rel%%` 属行内兼容形态 ✓，行中间的 `%%id%%` 不是
		expect(relationStateOfSource('%%id:7f3a11%% 中间 %%rel:9c2e22%%')).toEqual({
			id: null,
			refs: [{ target: '9c2e22', label: '' }],
		});
		// 整行就是指令行（没有内容行）：不产生关系（解析层按普通段落处理）
		expect(relationStateOfSource('%%id:7f3a11%%')).toEqual({
			id: null,
			refs: [],
		});
	});

	it('renderDirectiveLine：顺序固定 id → rel，空状态为空串', () => {
		expect(renderDirectiveLine({ id: '7f3a11', refs: [] })).toBe('%%id:7f3a11%%');
		expect(
			renderDirectiveLine({
				id: '7f3a11',
				refs: [
					{ target: '9c2e22', label: '依赖' },
					{ target: 'bbbbbb', label: '' },
				],
			}),
		).toBe('%%id:7f3a11%% %%rel:9c2e22 | 依赖%% %%rel:bbbbbb%%');
		expect(renderDirectiveLine({ id: null, refs: [] })).toBe('');
	});
});

describe('指令改写', () => {
	it('stripDirectiveTail：剥掉末尾指令行与末行行内段，内容行原样', () => {
		expect(stripDirectiveTail('子\n%%id:7f3a11%%')).toBe('子');
		expect(stripDirectiveTail('子 %%rel:7f3a11%%')).toBe('子');
		expect(stripDirectiveTail('甲\n乙\n%%id:7f3a11%%')).toBe('甲\n乙');
		// 整段都是指令时不吞成空串以外的形态（保留空内容行）
		expect(stripDirectiveTail('\n%%id:7f3a11%%')).toBe('');
		// 中间行不动
		expect(stripDirectiveTail('甲\n%%id:7f3a11%%\n乙')).toBe('甲\n%%id:7f3a11%%\n乙');
	});

	it('splitDirectiveTail：内容与尾部一次给出，贴回去逐字还原', () => {
		// 行内段在前、指令行在后（与 md-outline / md-line-write 的写法一致）
		expect(splitDirectiveTail('子 %%rel:bbbbbb%%\n%%id:7f3a11%%')).toEqual({
			content: '子',
			tail: '%%rel:bbbbbb%%\n%%id:7f3a11%%',
		});
		// 没有指令：tail 为空串（调用方据此省掉拼接）
		expect(splitDirectiveTail('甲\n乙')).toEqual({ content: '甲\n乙', tail: '' });
		// 中间行的指令段属普通注释：既不被剥掉，也不进 tail
		expect(splitDirectiveTail('甲\n%%id:7f3a11%%\n乙')).toEqual({
			content: '甲\n%%id:7f3a11%%\n乙',
			tail: '',
		});
	});

	it('applyDirectiveLine：替换尾段；空指令等于清除', () => {
		expect(applyDirectiveLine('子', '%%id:7f3a11%%')).toBe('子\n%%id:7f3a11%%');
		expect(applyDirectiveLine('子\n%%id:7f3a11%%', '%%id:9c2e22%%')).toBe(
			'子\n%%id:9c2e22%%',
		);
		expect(applyDirectiveLine('子\n%%id:7f3a11%%', '')).toBe('子');
	});

	it('applyDirectiveLine：内容为空时保留空内容行（指令不得变成节点正文）', () => {
		// 空标题 / 空列表项：写成单行会让 `%%id:…%%` 直接显示在节点上
		const raw = applyDirectiveLine('', '%%id:7f3a11%%');
		expect(raw).toBe('\n%%id:7f3a11%%');
		expect(relationStateOfSource(raw)).toEqual({ id: '7f3a11', refs: [] });
		expect(stripDirectiveTail(raw)).toBe('');
	});

});

describe('解析归属（指令行不产出节点）', () => {
	it('标题：指令行挂到标题，标题文本保持干净', () => {
		const { tree } = parseMdOutline('# 支付\n%%id:7f3a11%%\n', 'root');
		expect(tree.children).toHaveLength(1);
		const heading = tree.children[0]!;
		expect(heading.data?.text).toBe('支付');
		expect(heading.data?.mdDirectiveTail).toBe('%%id:7f3a11%%');
		expect(heading.data?.mdRaw).toBe('支付\n%%id:7f3a11%%');
	});

	it('列表项：缩进指令行挂到该项，不并进文本', () => {
		const { tree } = parseMdOutline(
			'- 甲\n  %%rel:7f3a11 | 依赖%%\n- 乙\n',
			'root',
		);
		expect(tree.children).toHaveLength(2);
		const first = tree.children[0]!;
		expect(first.data?.text).toBe('甲');
		expect(first.data?.mdDirectiveTail).toBe('%%rel:7f3a11 | 依赖%%');
		expect(tree.children[1]!.data?.text).toBe('乙');
		expect(tree.children[1]!.data?.mdDirectiveTail).toBeUndefined();
	});

	it('列表项的无缩进指令行（用户手写）同样归到上一节点', () => {
		const { tree } = parseMdOutline('- 甲\n%%id:7f3a11%%\n- 乙\n', 'root');
		expect(tree.children).toHaveLength(2);
		expect(tree.children[0]!.data?.mdDirectiveTail).toBe('%%id:7f3a11%%');
	});

	it('段落：指令行不成为新节点', () => {
		const { tree } = parseMdOutline('正文段落。\n%%id:c0de11%%\n', 'root');
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0]!.data?.text).toBe('正文段落。');
		expect(tree.children[0]!.data?.mdDirectiveTail).toBe('%%id:c0de11%%');
	});

	it('文件首部的孤立指令行按普通段落处理（没有上一个节点）', () => {
		const { tree } = parseMdOutline('%%id:7f3a11%%\n', 'root');
		expect(tree.children).toHaveLength(1);
		// 按字面文本保留，不产生关系（没有可归属的上一节点）
		expect(tree.children[0]!.data?.text).toBe('%%id:7f3a11%%');
		expect(relationStateOf(tree.children[0]!.data).id).toBeNull();
	});

	it('非法注释不是指令行，仍按原语义解析', () => {
		const { tree } = parseMdOutline('正文\n%%备注%%\n', 'root');
		expect(tree.children[0]!.data?.mdDirectiveTail).toBeUndefined();
		expect(tree.children[0]!.data?.text).toBe('正文\n%%备注%%');
	});
});

describe('回写', () => {
	it('未编辑：整篇往返逐字不动点', () => {
		// 规范化形态（块之间空行、标题与紧随的列表之间无空行，见 md-serialize
		// 的 pushBlock 契约）：往返是**严格**不动点，指令行的位置与缩进都不变
		const md = [
			'# 支付',
			'%%id:7f3a11%%',
			'',
			'## 子',
			'%%rel:7f3a11 | 依赖%%',
			'- 甲',
			'  %%rel:7f3a11%%',
			'- 乙',
		].join('\n');
		const { tree } = parseMdOutline(md, 'root');
		expect(serializeMdBody(tree, null)).toBe(md);
		// 再往返一次仍不动（幂等）
		const again = parseMdOutline(serializeMdBody(tree, null), 'root').tree;
		expect(serializeMdBody(again, null)).toBe(md);
	});

	it('编辑文本后指令行仍在（合成路径拼回）', () => {
		const { tree } = parseMdOutline('# 支付\n%%id:7f3a11%%\n', 'root');
		const heading = tree.children[0]!;
		heading.data.text = '支付改';
		expect(serializeMdBody(tree, null)).toBe('# 支付改\n%%id:7f3a11%%');
	});

	it('applyRawToNode：指令行进 tail 不进 text，mdRaw 保留全文', () => {
		const data: MdNodeData = { text: '旧', mdDerivedText: '旧', mdRaw: '旧' };
		applyRawToNode(data, '新内容\n第二行\n%%id:7f3a11%% %%rel:9c2e22 | 依赖%%');
		expect(data.text).toBe('新内容\n第二行');
		expect(data.mdDerivedText).toBe('新内容\n第二行');
		expect(data.mdDirectiveTail).toBe('%%id:7f3a11%% %%rel:9c2e22 | 依赖%%');
		expect(data.mdRaw).toBe('新内容\n第二行\n%%id:7f3a11%% %%rel:9c2e22 | 依赖%%');
	});

	it('空节点 + 指令行：内容行保留一行空白，指令独占末行', () => {
		const { tree } = parseMdOutline('- \n  %%id:7f3a11%%\n', 'root');
		const item = tree.children[0]!;
		expect(item.data?.text).toBe('');
		expect(serializeMdBody(tree, null)).toBe('- \n  %%id:7f3a11%%');
	});
});

describe('图解析', () => {
	const node = (data: Record<string, unknown>, children: unknown[] = []) => ({
		data,
		children: children as never[],
	});

	it('id 权威与边方向', () => {
		const target = node(rawData('目标', '目标\n%%id:7f3a11%%'));
		const source = node(rawData('源', '源\n%%rel:7f3a11 | 依赖%%'));
		const root = node({ text: 'root' }, [target, source]);

		const graph = resolveRelationGraph(root as never);
		expect(graph.ids.get('7f3a11')).toBe(target);
		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]!.from).toBe(source);
		expect(graph.edges[0]!.to).toBe(target);
	});

	it('悬空边：不画线（文件里那行原样保留，不属于图解析的职责）', () => {
		const source = node(rawData('源', '源\n%%rel:ffffff%%'));
		const root = node({ text: 'root' }, [source]);
		const graph = resolveRelationGraph(root as never);
		expect(graph.edges).toHaveLength(0);
		// 源节点仍带着自己的 ref（读侧靠它判断"这条边存在但画不出来"），
		// 只是它没有进入可绘制集合
		expect(graph.ids.size).toBe(0);
	});

	it('重复 id：文档序首个权威，边连到首个节点', () => {
		const first = node(rawData('甲', '甲\n%%id:7f3a11%%'));
		const second = node(rawData('乙', '乙\n%%id:7f3a11%%'));
		const source = node(rawData('源', '源\n%%rel:7f3a11%%'));
		const root = node({ text: 'root' }, [first, second, source]);
		const graph = resolveRelationGraph(root as never);
		expect(graph.ids.get('7f3a11')).toBe(first);
		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]!.to).toBe(first);
	});

	it('自环被忽略', () => {
		const self = node(rawData('甲', '甲\n%%id:7f3a11%% %%rel:7f3a11%%'));
		const root = node({ text: 'root' }, [self]);
		const graph = resolveRelationGraph(root as never);
		expect(graph.edges).toHaveLength(0);
	});

	it('边上限只截断可绘制集合', () => {
		const target = node(rawData('目标', '目标\n%%id:7f3a11%%'));
		const sources = [1, 2, 3].map((i) =>
			node(rawData(`源${i}`, `源${i}\n%%rel:7f3a11%%`)),
		);
		const root = node({ text: 'root' }, [target, ...sources]);
		const graph = resolveRelationGraph(root as never, 2);
		expect(graph.edges).toHaveLength(2);
		// 上限只影响画多少：id 索引不受影响（否则悬空判定会随上限漂移）
		expect(graph.ids.size).toBe(1);
	});

	it('没有任何指令时零开销（返回空图）', () => {
		const root = node({ text: 'root' }, [node(rawData('甲'))]);
		const graph = resolveRelationGraph(root as never);
		expect(graph.ids.size).toBe(0);
		expect(graph.edges).toHaveLength(0);
	});

	it('nodeInlineSource 已编辑时补回指令行（引擎内联编辑后关系不丢）', () => {
		const data: Record<string, unknown> = {
			text: '改后的文本',
			mdDerivedText: '原文本',
			mdRaw: '原文本\n%%id:7f3a11%%',
			mdDirectiveTail: '%%id:7f3a11%%',
		};
		expect(relationStateOf(data).id).toBe('7f3a11');
	});
});
