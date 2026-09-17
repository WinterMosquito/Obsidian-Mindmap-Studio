/**
 * 节点内联内容渲染回归（方案 B 原型）。
 *
 * 覆盖两件事：
 * ① `buildInlineSegments`（纯函数）：行内原文 → 段序列的切分、显示名口径
 *    （与解析侧同一 `tokenizeInline` / `tokenDisplay`）、首尾空白与连续空格归一、
 *    库内/外部链接的分类；
 * ② `buildInlineNodeContent` 的**接管判定**与**锚点属性契约**：
 *    - 返回 null 的情形（无 data / 含图 / 既无链接又无轻标记 / 超长）——决定
 *      「哪些节点回落引擎默认 SVG 文本」，是性能与可编辑性的边界；
 *      **有轻标记也接管**（2026-09-15 修订：混合字形单串 SVG 文本做不到）；
 *    - 非 null 时锚点必须是 `a.internal-link[data-href]`（原始 linkpath，无 [[ ]]）
 *      或 `a.external-link[href]`——这正是 `view-wikilink.findAnchorInNode` 与
 *      `resolveAnchorLink` 识别的形态（后者的分支回归见 tests/view-wikilink.test.ts）。
 *      两文件合起来才构成「节点内链接可点」的完整证据链。
 *
 * Node 环境无 DOM：本文件自建最小 Document/Element 桩（只实现本模块用到的面），
 * 真实 DOM 装配（foreignObject、测宽、点击命中）由 verify:visual 的 inline 探针覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
	buildInlineNodeContent,
	buildInlineSegments,
	MAX_INLINE_CONTENT_CHARS,
	NODE_INLINE_CONTENT_CLASS,
	segmentCacheStats,
} from '../src/features/node-inline-content';
import type { InlineSegment } from '../src/features/node-inline-content';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';

describe('buildInlineSegments（行内原文 → 段序列）', () => {
	it('纯文本：单段、无链接', () => {
		expect(buildInlineSegments('纯文本')).toEqual([
			{ kind: 'text', text: '纯文本' },
		]);
	});

	it('双链（无别名 / 带别名）：库内链接段，显示名为剥壳名', () => {
		expect(buildInlineSegments('见 [[笔记A]] 与 [[目录/笔记B|别名]]')).toEqual([
			{ kind: 'text', text: '见 ' },
			{ kind: 'link', text: '笔记A', link: '笔记A', internal: true },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'link', text: '别名', link: '目录/笔记B', internal: true },
		]);
	});

	it('双链显示名去 .md（与节点文本口径一致）', () => {
		const segments = buildInlineSegments('[[笔记.md]]');
		expect(segments).toEqual([
			{ kind: 'link', text: '笔记', link: '笔记.md', internal: true },
		]);
	});

	it('附件双链：仍走库内锚点（data-href = 原始 linkpath）', () => {
		expect(buildInlineSegments('[[附件.pdf]]')).toEqual([
			{ kind: 'link', text: '附件.pdf', link: '附件.pdf', internal: true },
		]);
	});

	it('md 链接：外部地址走 external，库内路径走 internal', () => {
		expect(
			buildInlineSegments('[站点](https://example.com) 与 [说明](目录/笔记.md)'),
		).toEqual([
			{ kind: 'link', text: '站点', link: 'https://example.com', internal: false },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'link', text: '说明', link: '目录/笔记.md', internal: true },
		]);
	});

	it('obsidian:// 协议链接按外部地址处理（scheme 形态）', () => {
		expect(buildInlineSegments('[打开](obsidian://open?file=x)')).toEqual([
			{
				kind: 'link',
				text: '打开',
				link: 'obsidian://open?file=x',
				internal: false,
			},
		]);
	});

	it('尖括号 URL 与裸 URL：一律外部锚点，显示名即 URL 本体', () => {
		// 显示名刻意不走 tokenDisplay：它对裸 URL 取「目标末段」（→ `x`），
		// 那是 icon-only 时代的剥离口径，不是可读显示名
		expect(buildInlineSegments('见 <https://a.com> 与 https://b.com/x')).toEqual([
			{ kind: 'text', text: '见 ' },
			{ kind: 'link', text: 'https://a.com', link: 'https://a.com', internal: false },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'link', text: 'https://b.com/x', link: 'https://b.com/x', internal: false },
		]);
	});

	it('md 链接的 label 本身是 URL：显示整个地址（还原粘贴形态）', () => {
		expect(
			buildInlineSegments('[https://example.com/a](https://example.com/a)'),
		).toEqual([
			{
				kind: 'link',
				text: 'https://example.com/a',
				link: 'https://example.com/a',
				internal: false,
			},
		]);
	});

	it('图片 token 不产链接段（图片走引擎图片通道），只保留剥壳显示名', () => {
		expect(buildInlineSegments('文字 ![[图.png]] 文字')).toEqual([
			{ kind: 'text', text: '文字 ' },
			{ kind: 'text', text: '图.png' },
			{ kind: 'text', text: ' 文字' },
		]);
	});

	it('同一行多链接：每枚都是独立链接段（方案 B 的多链接内联可点）', () => {
		const segments = buildInlineSegments('[[A]] 和 [[B]] 和 https://c.com');
		expect(segments.filter((segment) => segment.kind === 'link')).toHaveLength(3);
	});

	it('首尾空白剔除：plain 行的前导缩进与行尾空格不进显示', () => {
		expect(buildInlineSegments('   缩进文本 [[A]]  ')).toEqual([
			{ kind: 'text', text: '缩进文本 ' },
			{ kind: 'link', text: 'A', link: 'A', internal: true },
		]);
	});

	it('连续空格折叠为单个（与解析侧 text 同口径）', () => {
		expect(buildInlineSegments('A  B [[C]]')).toEqual([
			{ kind: 'text', text: 'A B ' },
			{ kind: 'link', text: 'C', link: 'C', internal: true },
		]);
	});

	it('空串 / 纯空白：空段序列', () => {
		expect(buildInlineSegments('')).toEqual([]);
		expect(buildInlineSegments('   ')).toEqual([]);
	});
});

/**
 * 轻标记扩展（2026-09-15，对齐官方帮助「Basic formatting syntax」）：
 * 高亮 `==…==`、下划线式粗斜 `__…__` / `_…_`、组合字形 `***…***`、
 * 双反引号代码跨度、反斜杠转义、`%%注释%%`（渲染期隐藏）。
 *
 * 断言用「样式:文本」投影：既钉住切分边界，也钉住每段的样式归属。
 */
describe('轻标记扩展（显示层，不回写）', () => {
	const shape = (raw: string): string[] =>
		buildInlineSegments(raw).map((segment) =>
			segment.style ? `${segment.style}:${segment.text}` : segment.text,
		);

	it('高亮 / 下划线式粗斜 / 组合字形', () => {
		expect(shape('==高亮==')).toEqual(['highlight:高亮']);
		expect(shape('__粗__ 与 _斜_')).toEqual(['bold:粗', ' 与 ', 'italic:斜']);
		expect(shape('***粗斜***')).toEqual(['boldItalic:粗斜']);
	});

	it('行内代码：双反引号跨度允许内含反引号（CommonMark 同长度闭合）', () => {
		expect(shape('``a`b``')).toEqual(['code:a`b']);
	});

	it('反斜杠转义：消费反斜杠、按字面显示（不再误渲染成斜体）', () => {
		// 此前 `\*a\*` 会被正则在 `\*` 里匹配到 `*` → 渲染成斜体 a（真实偏差）
		expect(shape('\\*a\\*')).toEqual(['*a*']);
		expect(shape('\\_x\\_ 与 \\`c\\`')).toEqual(['_x_ 与 `c`']);
	});

	it('转义字符集对齐官方清单：`\\#` `\\|` `\\\\` 也消费反斜杠', () => {
		// 官方「Escaping Markdown Syntax」列出 `\*` `\_` `\#` `\`` `\|` `\~`；
		// 字符集由 ESCAPABLE_CLASS 一处定义（转义分支与接管判据共用）
		expect(shape('\\#标题 与 \\|管道 与 反斜杠\\\\ 收尾')).toEqual([
			'#标题 与 |管道 与 反斜杠\\ 收尾',
		]);
	});

	it('普通反斜杠路径不被吞：`\\U` 这类非转义序列原样保留', () => {
		expect(shape('C:\\Users\\a')).toEqual(['C:\\Users\\a']);
	});

	it('注释：渲染期整段隐藏（含跨行块注释）', () => {
		// 注释两侧的无样式片段会合并为一段（HTML 折叠空白，显示与 Obsidian 一致）
		expect(shape('可见 %%备注%% 文本')).toEqual(['可见  文本']);
		expect(shape('前 %%\n多行\n%% 后')).toEqual(['前  后']);
	});

	it('未闭合注释：按字面保留（不吞掉后半行）', () => {
		expect(shape('保留 %% 未闭合')).toEqual(['保留 %% 未闭合']);
	});

	it('snake_case 不误判为斜体（下划线式要求两侧非字母数字）', () => {
		expect(shape('a_b_c')).toEqual(['a_b_c']);
	});

	it('代码跨度内的标记与转义按字面（不二次解释）', () => {
		expect(shape('`\\*a\\*`')).toEqual(['code:\\*a\\*']);
	});

	it('一层嵌套：`**粗 _斜_**` 内层斜体生效（官方 combine them）', () => {
		const segments = buildInlineSegments('**粗 _斜_**');
		expect(segments).toHaveLength(1);
		const nested = segments[0]!;
		expect(nested.style).toBe('bold');
		expect(nested.text).toBe('粗 _斜_');
		expect(nested.children).toEqual([
			{ kind: 'text', text: '粗 ' },
			{ kind: 'text', text: '斜', style: 'italic' },
		]);
	});

	it('嵌套深度上限：第三层按字面（MAX_MARKUP_DEPTH = 2，渲染收益趋零）', () => {
		const segment = buildInlineSegments('**_==x==_**')[0]!;
		expect(segment.style).toBe('bold');
		// 内层斜体的标记体 `==x==` 不再解释（children 未挂）
		expect(segment.children).toEqual([
			{ kind: 'text', text: '==x==', style: 'italic' },
		]);
	});

	it('标记体无样式子段：不挂 children（字面即显示文本）', () => {
		const segment = buildInlineSegments('**粗体**')[0]!;
		expect(segment.children).toBeUndefined();
	});

	it('行内数学 `$…$`：段样式 math、定界符不进显示文本', () => {
		expect(shape('$E=mc^2$')).toEqual(['math:E=mc^2']);
	});

	it('数学优先于标记：`$a*b*c$` 的星号不是斜体', () => {
		expect(shape('$a*b*c$')).toEqual(['math:a*b*c']);
	});

	it('数学边界：开 $ 后紧空白 / 闭 $ 前空白 / 闭 $ 后数字 不误判（价签）', () => {
		expect(shape('$ x$ 与 $x $ 与 价格 $5 和 $6')).toEqual([
			'$ x$ 与 $x $ 与 价格 $5 和 $6',
		]);
	});

	it('未闭合 `$`：按字面保留', () => {
		expect(shape('价格 $5 与 公式 $x^2')).toEqual([
			'价格 $5 与 公式 $x^2',
		]);
	});
});

/** 最小文本节点桩 */
class FakeTextNode {
	constructor(readonly text: string) {}
}

/** 最小元素桩：只实现本模块使用的面（tagName/className/textContent/style/属性/appendChild） */
class FakeElement {
	className = '';
	textContent = '';
	/** 元素名：真实 DOM 里由 createElement(tag) 决定，用于断言语义元素包装 */
	tagName = '';
	readonly style: Record<string, string> = {};
	readonly children: unknown[] = [];
	readonly attributes = new Map<string, string>();

	appendChild(child: unknown): unknown {
		this.children.push(child);
		return child;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
}

/** 最小 Document 桩（记录 createElement 的标签名） */
class FakeDocument {
	createElement(tag = ''): FakeElement {
		const el = new FakeElement();
		el.tagName = tag;
		return el;
	}

	createTextNode(text: string): FakeTextNode {
		return new FakeTextNode(text);
	}
}

function asDocument(doc: FakeDocument): Document {
	return doc as unknown as Document;
}

/** 节点桩：getData() 无参返回整份 data（与引擎 MindMapNode 形态一致） */
function fakeNode(data: Record<string, unknown> | null): MindMapNode {
	return {
		getData: () => data,
	} as unknown as MindMapNode;
}

/** 元素桩 → 便于断言的窄视图 */
function childrenOf(el: HTMLElement): unknown[] {
	return (el as unknown as FakeElement).children;
}

/** 元素桩的内联样式（宽度/上限断言用） */
function styleOf(el: HTMLElement): Record<string, string> {
	return (el as unknown as FakeElement).style;
}

/** 自绘必接管的节点数据（含链接 + 轻标记 → 必定走自绘通道） */
function richData(): Record<string, unknown> {
	return {
		text: '见 重点 笔记A',
		mdRaw: '见 **重点** [[笔记A]]',
		mdDerivedText: '见 重点 笔记A',
	};
}

/**
 * 带**节点实例字段**的桩（引擎拖拽期间写的是 `node.customTextWidth` 活值，
 * 松手才落 data；两处都要覆盖）。
 */
function fakeNodeWithField(
	data: Record<string, unknown>,
	field: Record<string, unknown> = {},
): MindMapNode {
	return Object.assign(fakeNode(data), field);
}

function attrsOf(el: unknown): Map<string, string> {
	return (el as FakeElement).attributes;
}

describe('buildInlineNodeContent（接管判定）', () => {
	it('无 data：不接管', () => {
		expect(buildInlineNodeContent(fakeNode(null), asDocument(new FakeDocument()))).toBeNull();
	});

	it('含图节点：不接管（图片由引擎图片通道渲染，自绘会丢图）', () => {
		const node = fakeNode({
			image: 'attachments/a.png',
			mdRaw: '见图 ![[a.png]] 与 [[B]]',
		});
		expect(buildInlineNodeContent(node, asDocument(new FakeDocument()))).toBeNull();
	});

	it('无行内链接（纯文本）：不接管（保持引擎 SVG 文本，可双击编辑）', () => {
		const node = fakeNode({ text: '纯文本', mdRaw: '纯文本' });
		expect(buildInlineNodeContent(node, asDocument(new FakeDocument()))).toBeNull();
	});

	it('仅轻标记（无链接）：**接管**——混合字形单串 SVG 文本表达不了', () => {
		// 2026-09-15 修订：此前只按「含链接」接管，导致 `**粗**` 在无链接节点里
		// 原样显示（用户实测发现）。代价与含链接节点同款：编辑入口走插件弹窗。
		const node = fakeNode({
			text: '重点 与 码',
			mdRaw: '**重点** 与 `码`',
			mdDerivedText: '重点 与 码',
		});
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		expect(el).not.toBeNull();
		expect((childrenOf(el)[0] as FakeElement).tagName).toBe('strong');
		expect((childrenOf(el)[2] as FakeElement).tagName).toBe('code');
	});

	it('未闭合标记：按字面保留 → 无样式段即不接管（显示与引擎一致）', () => {
		const node = fakeNode({
			text: 'a **b',
			mdRaw: 'a **b',
			mdDerivedText: 'a **b',
		});
		expect(buildInlineNodeContent(node, asDocument(new FakeDocument()))).toBeNull();
	});

	it('转义序列：**必须接管**（引擎会把反斜杠一起显示）', () => {
		const node = fakeNode({
			text: '\\*a\\*',
			mdRaw: '\\*a\\*',
			mdDerivedText: '\\*a\\*',
		});
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		expect(el).not.toBeNull();
		// 显示为 `*a*`：反斜杠被消费、未产生斜体样式
		expect((childrenOf(el)[0] as FakeTextNode).text).toBe('*a*');
	});

	it('注释：有其它可见内容时接管并隐藏注释', () => {
		const node = fakeNode({
			text: '可见 文本',
			mdRaw: '可见 %%备注%% 文本',
			mdDerivedText: '可见 文本',
		});
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		expect(el).not.toBeNull();
		expect(
			childrenOf(el)
				.map((child) => (child as FakeTextNode).text)
				.join(''),
		).toBe('可见  文本');
	});

	it('整行只有注释：不接管（否则会渲染出一个空节点）', () => {
		const node = fakeNode({
			text: '',
			mdRaw: '%%只有注释%%',
			mdDerivedText: '',
		});
		expect(buildInlineNodeContent(node, asDocument(new FakeDocument()))).toBeNull();
	});

	it('行内数学：接管并写字面占位，renderMath 收到 TeX 与 holder', () => {
		const node = fakeNode({
			text: '质能方程',
			mdRaw: '$E=mc^2$',
			mdDerivedText: '质能方程',
		});
		const doc = new FakeDocument();
		const calls: { tex: string; holder: HTMLElement }[] = [];
		const el = buildInlineNodeContent(node, asDocument(doc), {}, 'zh', {
			renderMath: (_doc, tex, holder) => {
				calls.push({ tex, holder });
			},
		})!;
		expect(el).not.toBeNull();
		const holder = childrenOf(el)[0] as FakeElement;
		expect(holder.tagName).toBe('span');
		// 占位 = 字面 `$…$`（回退态）：渲染失败/未注入时保持这行
		expect(holder.textContent).toBe('$E=mc^2$');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.tex).toBe('E=mc^2');
		expect(calls[0]!.holder).toBe(holder);
	});

	it('行内数学未注入 renderMath：仍接管（占位字面显示，与引擎一致但保留通道）', () => {
		const node = fakeNode({
			text: '$x$',
			mdRaw: '$x$',
			mdDerivedText: '$x$',
		});
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		expect(el).not.toBeNull();
		expect((childrenOf(el)[0] as FakeElement).textContent).toBe('$x$');
	});

	it('只有图片语法（无链接）：不接管', () => {
		const node = fakeNode({ mdRaw: '![[a.png]]' });
		expect(buildInlineNodeContent(node, asDocument(new FakeDocument()))).toBeNull();
	});

	it('data 为空对象 / mdRaw 与 text 均空：不接管', () => {
		const doc = asDocument(new FakeDocument());
		expect(buildInlineNodeContent(fakeNode({}), doc)).toBeNull();
		expect(buildInlineNodeContent(fakeNode({ mdRaw: '', text: '' }), doc)).toBeNull();
	});

	it('含链接：接管，mdRaw 优先于 text 作为段序列来源', () => {
		// mdDerivedText === text ⇒ 未编辑（rawOk 同口径）→ 用 mdRaw
		const node = fakeNode({ text: '见 A', mdRaw: '见 [[A]]', mdDerivedText: '见 A' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()));
		expect(el).not.toBeNull();
		// 来源是 mdRaw（含链接语法），而非已被剥壳的 text
		expect(childrenOf(el!)).toHaveLength(2);
	});

	it('mdRaw 缺失时回退 text（新建节点等无原文场景）', () => {
		const node = fakeNode({ text: '见 [[A]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()));
		expect(el).not.toBeNull();
		expect(childrenOf(el!)).toHaveLength(2);
	});

	it('已编辑（text ≠ mdDerivedText）：改用 text 渲染，不吃过期的 mdRaw', () => {
		// mdRaw 是解析期快照：用户编辑后旧内容不得再出现在节点上
		const node = fakeNode({
			text: '见 [[新目标]]',
			mdRaw: '见 [[旧目标]]',
			mdDerivedText: '见 旧目标',
		});
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const anchor = childrenOf(el)[1] as FakeElement;
		expect(attrsOf(anchor).get('data-href')).toBe('新目标');
	});
});

describe('轻标记（渲染期样式，不改动回写原文）', () => {
	it('粗体/斜体/行内代码/删除线切分为带样式的段', () => {
		expect(buildInlineSegments('**粗** 与 *斜* 与 `码` 与 ~~删~~')).toEqual([
			{ kind: 'text', text: '粗', style: 'bold' },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'text', text: '斜', style: 'italic' },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'text', text: '码', style: 'code' },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'text', text: '删', style: 'strike' },
		]);
	});

	it('未闭合/单层之外：按字面保留（不吞字符）', () => {
		expect(buildInlineSegments('a **b')).toEqual([
			{ kind: 'text', text: 'a **b' },
		]);
		expect(buildInlineSegments('a * b * c')).toEqual([
			{ kind: 'text', text: 'a * b * c' },
		]);
	});

	it('标记与链接混排：链接段与标记段各自独立', () => {
		expect(buildInlineSegments('**重点** 见 [[A]]')).toEqual([
			{ kind: 'text', text: '重点', style: 'bold' },
			{ kind: 'text', text: ' 见 ' },
			{ kind: 'link', text: 'A', link: 'A', internal: true },
		]);
	});

	it('DOM：标记段包语义元素（strong/em/code/del）', () => {
		const node = fakeNode({ mdRaw: '**粗** 与 `码` 与 [[A]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const children = childrenOf(el);
		const first = children[0] as FakeElement;
		expect(first.tagName).toBe('strong');
		expect((first.children[0] as FakeTextNode).text).toBe('粗');
		expect((children[2] as FakeElement).tagName).toBe('code');
		expect((children[4] as FakeElement).className).toBe('internal-link');
	});
});

describe('嵌入 token 的分流（图片 vs 文档/附件）', () => {
	it('文档嵌入 ![[笔记]] → 库内链接锚点（显示名为去 .md 的目标名）', () => {
		expect(buildInlineSegments('![[笔记]] 说明')).toEqual([
			{ kind: 'link', text: '笔记', link: '笔记', internal: true },
			{ kind: 'text', text: ' 说明' },
		]);
	});

	it('附件嵌入 ![[报告.pdf]] → 库内链接锚点（保留扩展名）', () => {
		expect(buildInlineSegments('附件 ![[报告.pdf]]')).toEqual([
			{ kind: 'text', text: '附件 ' },
			{ kind: 'link', text: '报告.pdf', link: '报告.pdf', internal: true },
		]);
	});

	it('图片嵌入 ![[图.png]] → 文本占位（图片走引擎图片通道）', () => {
		expect(buildInlineSegments('文字 ![[图.png]]')).toEqual([
			{ kind: 'text', text: '文字 ' },
			{ kind: 'text', text: '图.png' },
		]);
	});
});

describe('buildInlineNodeContent（锚点属性契约：view-wikilink 识别的形态）', () => {
	it('库内链接 → a.internal-link[data-href]（原始 linkpath，无 [[ ]] 包裹）', () => {
		const node = fakeNode({ mdRaw: '见 [[目录/笔记|别名]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		expect((el as unknown as FakeElement).className).toBe(
			NODE_INLINE_CONTENT_CLASS,
		);
		const children = childrenOf(el);
		expect(children[0]).toBeInstanceOf(FakeTextNode);
		const anchor = children[1] as FakeElement;
		expect(anchor.className).toBe('internal-link');
		// data-href 不带 [[ ]]，由 view-wilink.resolveAnchorLink 包回 wikilink 形态
		expect(attrsOf(anchor).get('data-href')).toBe('目录/笔记');
		expect(attrsOf(anchor).has('href')).toBe(false);
		expect(anchor.textContent).toBe('别名');
	});

	it('外部链接 → a.external-link[href]（无 data-href）', () => {
		const node = fakeNode({ mdRaw: '[站点](https://example.com)' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const anchor = childrenOf(el)[0] as FakeElement;
		expect(anchor.className).toBe('external-link');
		expect(attrsOf(anchor).get('href')).toBe('https://example.com');
		expect(attrsOf(anchor).has('data-href')).toBe(false);
	});

	it('一段一元素：文本与多枚锚点按序装配（多链接内联可点）', () => {
		const node = fakeNode({ mdRaw: '[[A]] 与 [[B]] 结束' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const children = childrenOf(el);
		expect(children).toHaveLength(4); // 锚点、文本、锚点、文本
		expect((children[0] as FakeElement).className).toBe('internal-link');
		expect(children[1]).toBeInstanceOf(FakeTextNode);
		expect((children[2] as FakeElement).className).toBe('internal-link');
		expect(children[3]).toBeInstanceOf(FakeTextNode);
	});

	it('主题样式随节点传入（自绘节点跳过默认文本渲染，样式必须自带）', () => {
		const node = fakeNode({ mdRaw: '[[A]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()), {
			fontSize: '13px',
			color: '#333333',
			fontWeight: 'bold',
		})!;
		const style = (el as unknown as FakeElement).style;
		expect(style.fontSize).toBe('13px');
		expect(style.color).toBe('#333333');
		expect(style.fontWeight).toBe('bold');
	});

	it('样式缺省时不写入（不覆盖 CSS 默认）', () => {
		const node = fakeNode({ mdRaw: '[[A]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const style = (el as unknown as FakeElement).style;
		expect(style.fontSize).toBeUndefined();
		expect(style.color).toBeUndefined();
		expect(style.fontWeight).toBeUndefined();
	});

	it('段序列为空（仅空白原文）：不接管', () => {
		const node = fakeNode({ mdRaw: '   ' });
		expect(buildInlineNodeContent(node, asDocument(new FakeDocument()))).toBeNull();
	});
});

/**
 * 未解析链接的标记（2026-09-15，对齐 Obsidian 阅读视图：指向尚不存在的笔记的
 * 链接显示为更弱的颜色 + `is-unresolved` 类）。
 *
 * 判定由调用方注入（`InlineContentOptions.isResolvedLink`）——本模块必须能在
 * 无 Obsidian 运行时的页面里打包（verify:visual 直接打包它做无头验证），
 * 故解析发生在**每次构建**时，不进段序列缓存（缓存按原文寻址，与库状态无关）。
 */
describe('未解析链接（注入解析器 → 弱化形态）', () => {
	const node = fakeNode({
		text: '见 A',
		mdRaw: '见 [[A]]',
		mdDerivedText: '见 A',
	});

	/** 取内容元素里的第一枚锚点 */
	function firstAnchor(el: HTMLElement): FakeElement {
		return childrenOf(el).find(
			(child) => (child as FakeElement).tagName === 'a',
		) as FakeElement;
	}

	it('解析失败：类名叠加 is-unresolved + 弱化配色；data-href 仍是原始 linkpath', () => {
		const el = buildInlineNodeContent(
			node,
			asDocument(new FakeDocument()),
			{},
			'zh',
			{ isResolvedLink: () => false },
		)!;
		const anchor = firstAnchor(el);
		// `internal-link` 前缀不能被替换：findAnchorInNode 按它识别锚点
		expect(anchor.className).toBe('internal-link is-unresolved');
		expect(attrsOf(anchor).get('data-href')).toBe('A');
		expect(anchor.style.opacity).toContain('--link-unresolved-opacity');
	});

	it('解析成功：保持普通内链样式（不标记）', () => {
		const el = buildInlineNodeContent(
			node,
			asDocument(new FakeDocument()),
			{},
			'zh',
			{ isResolvedLink: () => true },
		)!;
		const anchor = firstAnchor(el);
		expect(anchor.className).toBe('internal-link');
		expect(anchor.style.opacity).toBeUndefined();
	});

	it('未注入解析器（单测/无头验证环境）：视同已解析，不误标', () => {
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		expect(firstAnchor(el).className).toBe('internal-link');
	});

	it('解析器按 linkpath 调用（含子路径 / 附件名）', () => {
		const calls: string[] = [];
		buildInlineNodeContent(
			fakeNode({ mdRaw: '[[目录/笔记]] 与 [[报告.pdf]]' }),
			asDocument(new FakeDocument()),
			{},
			'zh',
			{
				isResolvedLink: (linkpath) => {
					calls.push(linkpath);
					return true;
				},
			},
		);
		expect(calls).toEqual(['目录/笔记', '报告.pdf']);
	});

	it('外部锚点不参与解析（http / 协议地址没有「未解析」概念）', () => {
		const calls: string[] = [];
		const el = buildInlineNodeContent(
			fakeNode({ mdRaw: '[站点](https://example.com)' }),
			asDocument(new FakeDocument()),
			{},
			'zh',
			{
				isResolvedLink: (linkpath) => {
					calls.push(linkpath);
					return false;
				},
			},
		)!;
		expect(firstAnchor(el).className).toBe('external-link');
		expect(calls).toEqual([]);
	});
});

describe('渲染期缓存与超长回落（性能收口）', () => {
	it('同一原文命中缓存：返回同一数组（内容寻址，不重复 tokenize）', () => {
		const raw = '见 [[缓存命中]] 与 https://example.com/cache';
		expect(buildInlineSegments(raw)).toBe(buildInlineSegments(raw));
		// 不同原文各自独立（不会互相串味）
		const other = '见 [[另一行]] 与 https://example.com/other';
		expect(buildInlineSegments(other)).not.toBe(buildInlineSegments(raw));
		// 缓存不改变结果（仍是同一份正确段序列）
		expect(buildInlineSegments(raw)).toEqual([
			{ kind: 'text', text: '见 ' },
			{ kind: 'link', text: '缓存命中', link: '缓存命中', internal: true },
			{ kind: 'text', text: ' 与 ' },
			{
				kind: 'link',
				text: 'https://example.com/cache',
				link: 'https://example.com/cache',
				internal: false,
			},
		]);
	});

	it('超长节点**接管并截断展示**（绝不回落引擎：其换行是逐字符二次复杂度）', () => {
		// 纯文本且未超限：不接管（引擎 SVG 文本，短行廉价、可双击原位编辑）
		const atLimit = 'x'.repeat(MAX_INLINE_CONTENT_CHARS);
		expect(
			buildInlineNodeContent(
				fakeNode({ mdRaw: atLimit, text: atLimit, mdDerivedText: atLimit }),
				asDocument(new FakeDocument()),
			),
			'恰在上限：仍不接管（纯文本节点保持引擎路径）',
		).toBeNull();

		// 超上限：**接管**（长行进 HTML，绝不交给引擎的逐字符换行）+ 截断展示
		const long = 'x'.repeat(MAX_INLINE_CONTENT_CHARS + 500);
		const el = buildInlineNodeContent(
			fakeNode({ mdRaw: long, text: long, mdDerivedText: long }),
			asDocument(new FakeDocument()),
		)!;
		expect(el).not.toBeNull();
		expect(attrsOf(el).get('data-truncated')).toBe('true');
		expect(
			attrsOf(el).get('title'),
			'悬停提示说明「完整内容仍在文件里」，避免误以为数据丢了',
		).toContain('完整内容仍保存在文件中');
		expect((childrenOf(el)[0] as FakeTextNode).text).toBe(
			'x'.repeat(MAX_INLINE_CONTENT_CHARS),
		);
		expect((childrenOf(el)[1] as FakeTextNode).text).toBe('…');
	});

	it('截断不切出半个链接：整枚放不下就整枚不显示', () => {
		// 文本先吃满预算 → 其后的 [[A]] 整枚省略（显示半个 `[[A` 会误导用户
		// 以为文件里就是这么写的；链接段不可切，只能整枚丢弃）
		const filler = 'x'.repeat(MAX_INLINE_CONTENT_CHARS);
		const text = `${filler} 见 A`;
		const el = buildInlineNodeContent(
			fakeNode({ mdRaw: `${filler} 见 [[A]]`, text, mdDerivedText: text }),
			asDocument(new FakeDocument()),
		)!;
		const children = childrenOf(el);
		expect(
			children.some((child) => (child as FakeElement).tagName === 'a'),
			'放不下的链接段必须整枚省略',
		).toBe(false);
		expect((children[children.length - 1] as FakeTextNode).text).toBe('…');
	});
});

describe('内联样式契约（导出 PNG 保真）', () => {
	it('结构/排版样式内联在根元素上（插件 styles.css 不在导出 SVG 里生效）', () => {
		const node = fakeNode({ mdRaw: '[[A]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const style = (el as unknown as FakeElement).style;
		// 引擎导出只注入自身 CSS + header/footer 的 cssText → 这些属性必须随元素
		// 一起被序列化，否则导出图里自绘内容掉样式而 foreignObject 尺寸不变（溢出/错位）
		expect(style.maxWidth).toBe('500px');
		expect(style.whiteSpace).toBe('pre-wrap');
		expect(style.padding).toBe('5px 16px');
		expect(style.display).toBe('block');
		expect(style.overflowWrap).toBe('anywhere');
	});

	it('锚点内联样式：可点光标 + 主题变量配色（含字面量兜底）', () => {
		const node = fakeNode({ mdRaw: '[[库内]] 与 [外链](https://example.com)' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const children = childrenOf(el);
		const internal = children[0] as FakeElement;
		const external = children[2] as FakeElement;
		expect(internal.style.cursor).toBe('pointer');
		expect(internal.style.color).toContain('var(--link-color');
		expect(external.style.color).toContain('var(--link-external-color');
	});

	it('轻标记元素内联样式（strong / code）', () => {
		const node = fakeNode({ mdRaw: '**粗** 与 `码` 与 [[A]]' });
		const el = buildInlineNodeContent(node, asDocument(new FakeDocument()))!;
		const children = childrenOf(el);
		expect((children[0] as FakeElement).style.fontWeight).toBe('600');
		const code = (children[2] as FakeElement).style;
		expect(code.fontFamily).toContain('var(--font-monospace');
		expect(code.backgroundColor).toContain('var(--code-background');
	});
});

describe('节点宽度：拖左右边框（引擎 customTextWidth）→ 自绘内容必须跟随', () => {
	// 用户实测缺陷（2026-09-16）：拖动自绘节点左右边框改宽后，节点**高度不跟着变**。
	// 根因在引擎分工——引擎只把宽度写到 `node.customTextWidth` 再回调本钩子
	// （`node.reRender([], { ignoreUpdateCustomTextWidth: true })`），宽度由**自绘内容
	// 自己落到元素上**（引擎自己的富文本节点同款：`style.width/maxWidth = 宽 + "px"`）；
	// 此前本模块恒用 CONTENT_STYLES 的 500 折行上限，故拖多宽都是同一套换行，
	// 离屏克隆测出的高度自然纹丝不动。
	it('未拖过（无 customTextWidth）：沿用 500 折行上限，不写死宽度', () => {
		const el = buildInlineNodeContent(
			fakeNode(richData()),
			asDocument(new FakeDocument()),
		)!;
		const style = styleOf(el);
		expect(style.maxWidth).toBe('500px');
		expect(style.width).toBeUndefined();
	});

	it('data.customTextWidth（松手后落盘值）：宽度写进元素', () => {
		const data = { ...richData(), customTextWidth: 240 };
		const el = buildInlineNodeContent(
			fakeNode(data),
			asDocument(new FakeDocument()),
		)!;
		const style = styleOf(el);
		expect(style.width).toBe('240px');
		// maxWidth 必须同步放开：CONTENT_STYLES 的 500 会把更宽的拖拽钳回 500
		expect(style.maxWidth).toBe('240px');
	});

	it('node.customTextWidth（拖拽中的活值，data 尚未写入）同样生效', () => {
		const el = buildInlineNodeContent(
			fakeNodeWithField(richData(), { customTextWidth: 320 }),
			asDocument(new FakeDocument()),
		)!;
		expect(styleOf(el).width).toBe('320px');
		expect(styleOf(el).maxWidth).toBe('320px');
	});

	it('活值优先于 data（拖拽中每帧以节点字段为准）', () => {
		const el = buildInlineNodeContent(
			fakeNodeWithField({ ...richData(), customTextWidth: 240 }, {
				customTextWidth: 180,
			}),
			asDocument(new FakeDocument()),
		)!;
		expect(styleOf(el).width).toBe('180px');
	});

	/** 非法/边界值：一律忽略 → 回落 500 上限（绝不写出 0px / NaNpx） */
	const invalidCases: { name: string; value: unknown }[] = [
		{ name: '0', value: 0 },
		{ name: '负数', value: -120 },
		{ name: 'NaN', value: Number.NaN },
		{ name: '字符串', value: '240' },
		{ name: 'undefined', value: undefined },
	];

	it.each(invalidCases)('非法宽度忽略：$name', ({ value }) => {
		const el = buildInlineNodeContent(
			fakeNodeWithField({ ...richData(), customTextWidth: value }, {
				customTextWidth: value,
			}),
			asDocument(new FakeDocument()),
		)!;
		expect(styleOf(el).width).toBeUndefined();
		expect(styleOf(el).maxWidth).toBe('500px');
	});

	it('拖宽只改尺寸、不改结构：轻标记与锚点照旧渲染', () => {
		const el = buildInlineNodeContent(
			fakeNode({ ...richData(), customTextWidth: 240 }),
			asDocument(new FakeDocument()),
		)!;
		const children = childrenOf(el);
		// 段序列次序：文本「见 」→ strong「重点」→ 文本「 」→ 锚点「笔记A」
		expect((children[1] as FakeElement).tagName).toBe('strong');
		expect(
			children.filter((child) => (child as FakeElement).tagName === 'a'),
		).toHaveLength(1);
	});
});

describe('InlineSegment（类型契约）', () => {
	it('段序列仅两种 kind，链接段带 link/internal', () => {
		const segments: readonly InlineSegment[] = buildInlineSegments('a [[B]] c');
		for (const segment of segments) {
			if (segment.kind === 'link') {
				expect(typeof segment.link).toBe('string');
				expect(typeof segment.internal).toBe('boolean');
			}
		}
	});
});

describe('段序列缓存：LRU 淘汰（渲染热点不被「预览洪水」冲掉）', () => {
	/**
	 * 缓存上限 512，编辑弹窗实时预览**每个键入都产生一个新键**
	 * （"a"、"ab"、"abc"…）。旧的「满即整表清空」策略下，敲几十个字符就会把
	 * 正在渲染的热点条目一并刷掉，此后每次渲染全部重 tokenize。
	 * 断言口径：热点条目的**同一个数组对象**（`toBe`）在整个洪水期间都能命中。
	 */
	it('预览式新键洪水下，持续命中的热点条目仍是同一份缓存对象', () => {
		const hot = '热点行 [[链接]] 与 `代码`';
		const first = buildInlineSegments(hot);
		// 命中返回的是缓存里的同一对象（不是每次新建的等值数组）
		expect(buildInlineSegments(hot)).toBe(first);

		// 600 个互不相同的新键（> 上限 512，必然触发淘汰）
		for (let i = 0; i < 600; i++) {
			expect(buildInlineSegments(hot), `第 ${i} 轮：热点仍命中`).toBe(first);
			buildInlineSegments(`预览${i} **粗** [[链接${i}]]`);
		}

		expect(buildInlineSegments(hot)).toBe(first);
	});

	it('内容相同即命中（缓存正确性）：等值请求不产生新对象', () => {
		const raw = '同一行 [[A]] **粗**';
		const a = buildInlineSegments(raw);
		const b = buildInlineSegments(raw);
		expect(b).toBe(a);
		expect(b).toEqual(a);
	});

	/**
	 * 长会话内存不变式：缓存**有界**。
	 *
	 * 上面的 LRU 例子只证明「热点不被洪水冲掉」，不证明「表不会无限涨」——
	 * 若淘汰分支被误删（或上限被调成 Infinity），长会话（大量互不相同的行）
	 * 会让缓存无限增长，而渲染结果照旧正确、单测照旧全绿。口径取 3× 上限的
	 * 连续新键：淘汰只删最旧一条 ⇒ 表必然稳定在**恰好** max（既不满溢、也不清空）。
	 */
	it('规模封顶：3× 上限的连续新键后仍稳定在 max（既不满溢也不清空）', () => {
		const { max } = segmentCacheStats();
		expect(max).toBeGreaterThan(0);
		for (let i = 0; i < max * 3; i++) {
			buildInlineSegments(`长会话键 ${i} [[链接${i}]]`);
		}
		const stats = segmentCacheStats();
		expect(stats.max).toBe(max);
		expect(stats.size).toBe(max);
	});
});
