/**
 * 标注（callout）与引用块的**识别口径**回归（`domain/callout`，纯逻辑）。
 *
 * 锁定五件事：
 * ① **头部解析**与宿主同口径（`obsidian.asar` 的 `\[!([^\]]+)\]([+\-]?)(?:\s|$)`
 *    + `|` 元数据 + `trim → 小写 → 空白转 -`）；`[!info]标题` 不算标注；
 * ② **别名归一**（`check`→`success`、`error`→`danger`、`important`→`tip` …）与
 *    未登记类型的 `note` 兜底；原型键（`toString` / `constructor`）不得漏进查表；
 * ③ **颜色变量名与类型 id 不同名**的四处（`note`→`default`、`abstract`→`summary`、
 *    `failure`→`fail`、`danger`→`error`）——照 id 拼会静默退到兜底色；
 * ④ **标题在解析期定稿**（未写标题 = 类型标识 Title Case），渲染期不再计算；
 * ⑤ **头部谓词与解析同口径**（`isCalloutHeaderLine` 只做判定、不造对象——块扫描的
 *    续行循环按行调用它，两处判据分叉会让「两个标注之间」时而断开时而不断开）。
 *
 * 显示层（盒子装配、递归、折叠标记、图标注入）的回归在
 * `tests/node-inline-content.test.ts` 的「引用块 / 标注段」组。
 */
import { describe, expect, it } from 'vitest';
import {
	calloutTypeOf,
	calloutVisualOf,
	isCalloutHeaderLine,
	normalizeCalloutType,
	parseCalloutHeader,
	stripQuotePrefix,
} from '../src/domain/callout';

describe('类型归一与别名（calloutTypeOf）', () => {
	it('归一：trim + 小写 + 空白转 `-`（与宿主同口径）', () => {
		expect(normalizeCalloutType('  Info  ')).toBe('info');
		expect(normalizeCalloutType('My  Type')).toBe('my-type');
		expect(normalizeCalloutType('WARNING')).toBe('warning');
	});

	it('官方 13 种类型各自命中（大小写不敏感）', () => {
		for (const type of [
			'note',
			'abstract',
			'info',
			'todo',
			'tip',
			'success',
			'question',
			'warning',
			'failure',
			'danger',
			'bug',
			'example',
			'quote',
		]) {
			expect(calloutTypeOf(type)).toBe(type);
			expect(calloutTypeOf(type.toUpperCase())).toBe(type);
		}
	});

	it('别名归一到官方主名（帮助文档的 Aliases 列）', () => {
		expect(calloutTypeOf('summary')).toBe('abstract');
		expect(calloutTypeOf('tldr')).toBe('abstract');
		expect(calloutTypeOf('hint')).toBe('tip');
		expect(calloutTypeOf('important')).toBe('tip');
		expect(calloutTypeOf('check')).toBe('success');
		expect(calloutTypeOf('done')).toBe('success');
		expect(calloutTypeOf('help')).toBe('question');
		expect(calloutTypeOf('faq')).toBe('question');
		expect(calloutTypeOf('caution')).toBe('warning');
		expect(calloutTypeOf('attention')).toBe('warning');
		expect(calloutTypeOf('fail')).toBe('failure');
		expect(calloutTypeOf('missing')).toBe('failure');
		expect(calloutTypeOf('error')).toBe('danger');
		expect(calloutTypeOf('cite')).toBe('quote');
	});

	it('未登记类型回落 note（官方口径）', () => {
		expect(calloutTypeOf('custom-question-type')).toBe('note');
		expect(calloutTypeOf('')).toBe('note');
	});

	it('原型链上的键不会漏进查表（用户可写 `[!toString]`）', () => {
		// 对象字面量查表时 `toString` 会命中原型方法（返回函数）——K172 ⑥ 的同款加固
		expect(calloutTypeOf('toString')).toBe('note');
		expect(calloutTypeOf('constructor')).toBe('note');
		expect(calloutTypeOf('__proto__')).toBe('note');
		expect(calloutTypeOf('hasOwnProperty')).toBe('note');
	});
});

describe('头部解析（parseCalloutHeader）', () => {
	it('仅类型：标题已定稿为 Title Case（渲染期不再计算）', () => {
		expect(parseCalloutHeader('[!info]')).toEqual({
			type: 'info',
			canonical: 'info',
			meta: '',
			fold: '',
			title: 'Info',
		});
	});

	it('自定义标题：类型标识之后的整段（含行内标记，原样保留）', () => {
		expect(parseCalloutHeader('[!tip] **重点** 提示')?.title).toBe('**重点** 提示');
	});

	it('折叠标记 `+` / `-`：紧跟类型标识、之后才是标题', () => {
		expect(parseCalloutHeader('[!faq]- 可折叠吗？')).toMatchObject({
			canonical: 'question',
			fold: '-',
			title: '可折叠吗？',
		});
		expect(parseCalloutHeader('[!tip]+ 默认展开')).toMatchObject({
			fold: '+',
			title: '默认展开',
		});
	});

	it('`|` 之后是 metadata（不是别名、也不进标题）', () => {
		expect(parseCalloutHeader('[!info|left] 标题')).toEqual({
			type: 'info',
			canonical: 'info',
			meta: 'left',
			fold: '',
			title: '标题',
		});
		// 空 metadata 照收（`[!info|]` 在宿主里同样合法）
		expect(parseCalloutHeader('[!info|]')?.meta).toBe('');
	});

	it('类型内允许空格：归一成 kebab（`[!My Type]` → my-type）', () => {
		expect(parseCalloutHeader('[!My Type] T')).toMatchObject({
			type: 'my-type',
			canonical: 'note',
			title: 'T',
		});
	});

	it('折叠标记后必须紧跟空白或行尾：`[!info]标题` 不是标注', () => {
		expect(parseCalloutHeader('[!info]标题')).toBeNull();
		expect(parseCalloutHeader('[!info]-标题')).toBeNull();
	});

	it('非标注形态一律 null（缺 `[!` / 空类型 / 非首列）', () => {
		expect(parseCalloutHeader('正文 [!info]')).toBeNull();
		expect(parseCalloutHeader('[!] 空类型')).toBeNull();
		expect(parseCalloutHeader('[! ] 全空白类型')).toBeNull();
		expect(parseCalloutHeader('> [!info]')).toBeNull(); // 前缀必须先剥掉
	});

	it('行尾空白容忍（`> [!info]   `）', () => {
		// 标题在解析期定稿：没写标题时就是类型标识的 Title Case，不是空串
		expect(parseCalloutHeader('[!info]   ')).toMatchObject({ title: 'Info' });
	});
});

describe('标题字面（解析期定稿）', () => {
	it('未写标题 = 类型标识的 Title Case（官方口径）', () => {
		expect(parseCalloutHeader('[!info]')!.title).toBe('Info');
		// 连续 `-` 有空段也要跳过（`[!foo--bar]` → 「Foo Bar」而不是「Foo  Bar」）
		expect(parseCalloutHeader('[!foo--bar]')!.title).toBe('Foo Bar');
	});

	it('自定义类型按**归一后的标识**做标题化，而不是规范类型', () => {
		// 若取 canonical 就会全部显示成 `Note`，用户看不出自己写了哪种
		expect(parseCalloutHeader('[!custom-question-type]')!.title).toBe(
			'Custom Question Type',
		);
	});

	it('写了标题就用标题（不重复标题化）', () => {
		expect(parseCalloutHeader('[!info] 小写标题 ok')!.title).toBe('小写标题 ok');
	});
});

describe('头部谓词（isCalloutHeaderLine）与解析同口径', () => {
	it('正例：与 parseCalloutHeader 一致地认「头部」', () => {
		for (const line of [
			'[!info]',
			'[!info] 标题',
			'[!faq]-',
			'[!info|left] 标题',
			'[!My Type] T',
		]) {
			expect(isCalloutHeaderLine(line), line).toBe(true);
			expect(parseCalloutHeader(line), line).not.toBeNull();
		}
	});

	it('反例：`[!info]标题`（缺分隔空白）/ 空类型 / 非首列', () => {
		for (const line of [
			'[!info]标题',
			'[!info]-标题',
			'[!] 空类型',
			'[! | ] 只有元数据',
			'正文 [!info]',
			'> [!info]', // 前缀须先剥掉
		]) {
			expect(isCalloutHeaderLine(line), line).toBe(false);
			expect(parseCalloutHeader(line), line).toBeNull();
		}
	});
});

describe('显示元数据（calloutVisualOf）', () => {
	it('颜色写成 var() 链：类型色优先，宿主缺失时退兜底色', () => {
		expect(calloutVisualOf('info').color).toBe('var(--callout-info, #086ddd)');
		expect(calloutVisualOf('question').color).toBe(
			'var(--callout-question, #ec7500)',
		);
	});

	it('四处「类型 id ≠ CSS 变量名」按宿主变量取值（照 id 拼会永远退兜底色）', () => {
		expect(calloutVisualOf('note').color).toContain('--callout-default');
		expect(calloutVisualOf('abstract').color).toContain('--callout-summary');
		expect(calloutVisualOf('failure').color).toContain('--callout-fail');
		expect(calloutVisualOf('danger').color).toContain('--callout-error');
	});

	it('图标 id 取宿主 `--callout-icon` 的原样值（question / quote 无 lucide- 前缀）', () => {
		expect(calloutVisualOf('info').icon).toBe('lucide-info');
		expect(calloutVisualOf('tip').icon).toBe('lucide-flame');
		expect(calloutVisualOf('question').icon).toBe('help-circle');
		expect(calloutVisualOf('quote').icon).toBe('quote-glyph');
	});

	it('同一类型返回**同一个对象**（元数据表初始化一次，渲染期零分配）', () => {
		expect(calloutVisualOf('info')).toBe(calloutVisualOf('info'));
	});
});

describe('引用前缀剥离（stripQuotePrefix）', () => {
	it('标准形态：`> 文本` / `>文本` / 最多 3 空格缩进', () => {
		expect(stripQuotePrefix('> 文本')).toBe('文本');
		expect(stripQuotePrefix('>文本')).toBe('文本');
		expect(stripQuotePrefix('   > 文本')).toBe('文本');
		// 至多吞掉**一个**分隔空白，其余是内容
		expect(stripQuotePrefix('>  文本')).toBe(' 文本');
	});

	it('单独一个 `>` = 引用块内的空行（空串，**不是** null）', () => {
		expect(stripQuotePrefix('>')).toBe('');
		expect(stripQuotePrefix('> ')).toBe('');
	});

	it('4 空格起首是缩进代码块，不算引用行', () => {
		expect(stripQuotePrefix('    > 文本')).toBeNull();
	});

	it('非引用行返回 null（`>` 不在行首 / 完全不含）', () => {
		expect(stripQuotePrefix('正文 > 引用')).toBeNull();
		expect(stripQuotePrefix('正文')).toBeNull();
		expect(stripQuotePrefix('')).toBeNull();
	});

	it('只剥一层：嵌套前缀留给下一轮（DOM 递归）', () => {
		expect(stripQuotePrefix('> > [!todo] 内层')).toBe('> [!todo] 内层');
	});
});
