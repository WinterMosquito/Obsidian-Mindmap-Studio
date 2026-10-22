/**
 * MathJax 逐字符规则的**读取与判定**：索引缓存（样式表元素 + 规则条数作失效键）、
 * 字符码取键、规则落盘检查、零宽字符的豁免判据。
 *
 * 从 `platform/math-jax.ts` 拆出（2026-10-22，纯搬移，零行为改动）。
 *
 * 为什么整族同文件：`readCharRuleIndex` 的**可用性三态**、`hasCharRule` 的
 * 「规则是否已落盘」与 `isInvisibleCharByDesign` 的「零宽是否设计使然」是
 * **同一条判定链**——三者对 `CharRuleIndex` 的语义解释必须一致，拆开会让
 * 「usable=false 时退回宽度判据」这条约定散成两处。消费方 `isProductReady`
 * 仍留在 `math-jax.ts`（它是渲染就绪判据，不属于规则读取）。
 */
import { createWarnOnce } from '../core/errors';
import { CHTML_STYLES_ID } from './math-jax-export';

/**
 * 「字符码（大写 hex） → 该字符逐字符规则的声明体」索引 + **可用性三态**。
 *
 * 两条判据共用：`isProductReady` 的 **v4 就绪判据**（本段字符的规则是否已
 * 落盘）与 `isInvisibleCharByDesign` 的零宽豁免。规则形如
 * `mjx-c.mjx-c2061 { padding: 0px; }`；选择器**可能带字体类后缀**
 * （MathJax `addCharStyles` 的 `"mjx-c"+charSelector+(o?"."+o:"")`）与
 * **v3 的 `::before` 伪元素后缀**（v3 的字形与宽度都在伪元素里），两者一并
 * 容忍；`[noic]` / `:not(...)` 等派生变体不参与（要的是基规则）。
 *
 * 三态语义（2026-10-15 修复引入——此前「留空」没有区分「明确无规则」与
 * 「环境读取失败」，而 v4 下两者后果相反）：
 * - **usable=true + 空表**：样式表元素**不存在** = MathJax 尚未 flush
 *   （v4 未挂载形态，实机取证）⇒ 调用方必须判「未就绪」（修复核心：此前该
 *   形态被「字符宽度 > 0」的假阳放行）；
 * - **usable=true + 有规则**：正常读数（含「部分落盘」——新字符尚未注册时
 *   其键缺失，同样判未就绪）；
 * - **usable=false**：判定环境不可用（无 `document` / `sheet` 缺失 /
 *   `cssRules` 抛错）⇒ 调用方退回旧「宽度 > 0」判据（异常宿主保持可渲染，
 *   不因判定环境缺陷全量退字面）+ 留痕告警。
 *
 * ⚠ **缓存键 =（样式表元素, 规则条数）**，不再按 flush 代际（2026-10-15
 * 修复）：样式表可能由**外部通道**挂载/补齐（用户本会话在阅读视图渲染过
 * 数学、其他插件渲染数学）——此时本模块的 `flushGeneration` 不前进，按代际
 * 缓存会把「规则缺失」的空索引钉住，新段永久误判未就绪。MathJax 的规则
 * **只增不减**（S0.5 双环境实测），故条数即可作为失效键：任何追加都会改长度。
 */
interface CharRuleIndex {
	/** 索引可信：true = 结果有效（含「明确无规则」）；false = 环境不可用 */
	usable: boolean;
	/** 字符码（大写 hex）→ 该字符逐字符规则的声明体 */
	decl: Map<string, string>;
}

let charRuleIndex: {
	/** 样式表对象身份（元素不在时为 null） */
	sheet: CSSStyleSheet | null;
	/** 规则条数（元素不在时为 -1） */
	ruleCount: number;
	value: CharRuleIndex;
} | null = null;

/** 「CHTML 字符规则索引读取失败」告警留痕：同一进程只提醒一次（前缀/去重交 core/errors） */
const warnCharRuleUnreadableOnce = createWarnOnce();

/** 索引读取失败告警文案（两处 catch 共用同一句——失效语义相同，勿各写一份） */
const CHAR_RULE_UNREADABLE_MSG =
	'读取 MathJax CHTML 字符规则失败，v4 就绪判据将退回宽度兜底';

/** 不可用索引（共享空表——只读消费，无写路径） */
const UNUSABLE_CHAR_RULE_INDEX: CharRuleIndex = {
	usable: false,
	decl: new Map(),
};

/** 「明确零规则」索引（样式表元素不存在 = 尚未 flush；只读消费，无写路径） */
const EMPTY_CHAR_RULE_INDEX: CharRuleIndex = {
	usable: true,
	decl: new Map(),
};

export function readCharRuleIndex(): CharRuleIndex {
	if (typeof document === 'undefined') {
		return UNUSABLE_CHAR_RULE_INDEX;
	}
	let el: HTMLStyleElement | null = null;
	let sheet: CSSStyleSheet | null = null;
	let ruleCount = -1;
	try {
		el = document.getElementById(CHTML_STYLES_ID) as HTMLStyleElement | null;
		if (el) {
			sheet = el.sheet;
			if (sheet) {
				ruleCount = sheet.cssRules.length;
			}
		}
	} catch (error) {
		// 读取失败不是无害降级：索引不可用会让 v4 就绪判据退回宽度兜底（本次修复
		// 失效）且 K113 零宽豁免整体失效 → 含 \sin/\log 的公式永久判未就绪 →
		// 退字面。而用户看到的唯一告警是下游泛化的「字体/样式未就绪」，指错根因，
		// 故此处必须留痕（AGENTS.md决策表：静默跳过会让问题无痕退化）。
		warnCharRuleUnreadableOnce(CHAR_RULE_UNREADABLE_MSG, error);
		return UNUSABLE_CHAR_RULE_INDEX;
	}
	if (!el) {
		// 元素不存在 = MathJax 尚未 flush（v4 未挂载形态）：**明确零规则**。
		// ⚠ 不可与「表格异常」混同：后者退回旧判据（见上），前者必须判未就绪。
		return EMPTY_CHAR_RULE_INDEX;
	}
	if (!sheet) {
		// 元素在、CSSOM 不可读（异常宿主；真实 MathJax 挂载后 sheet 恒可用）
		// ⇒ 退回旧判据。不单独告警：本分支在真实宿主不可达（判定环境缺陷
		// 由上方 catch 留痕），而单测桩普遍以无 sheet 元素表达「样式表存在」。
		return UNUSABLE_CHAR_RULE_INDEX;
	}
	if (
		charRuleIndex &&
		charRuleIndex.sheet === sheet &&
		charRuleIndex.ruleCount === ruleCount
	) {
		return charRuleIndex.value;
	}
	const decl = new Map<string, string>();
	try {
		for (const rule of Array.from(sheet.cssRules)) {
			const m =
				/^mjx-c\.mjx-c([0-9a-f]+)(?:\.[\w-]+)?(?:::before)?\s*\{([^}]*)\}$/i.exec(
					rule.cssText,
				);
			if (m) {
				decl.set((m[1] ?? '').toUpperCase(), m[2] ?? '');
			}
		}
	} catch (error) {
		warnCharRuleUnreadableOnce(CHAR_RULE_UNREADABLE_MSG, error);
		return UNUSABLE_CHAR_RULE_INDEX;
	}
	const value: CharRuleIndex = { usable: true, decl };
	charRuleIndex = { sheet, ruleCount, value };
	return value;
}

/**
 * 字符码键（大写 hex）：产物元素 → 逐字符规则的字典键。
 *
 * **双通道**（两代 MathJax 形态差）：
 * - **类名优先**：`mjx-c1D465` 两代命名一致（v3 的字符元素**文本为空**——
 *   字形在 `::before` 伪元素里，故 v3 下这是唯一键源；v4 起字符改为真实
 *   文本节点）；
 * - **文本兜底**：类名不可用（异常形态/桩）时按 `textContent` 首码点。
 *
 * 两通道皆不可得 → null（=「无对应规则」，就绪判据据此判未就绪）。
 */
function charRuleKey(char: Element): string | null {
	try {
		const cls = typeof char.className === 'string' ? char.className : '';
		const m = /mjx-c([0-9a-f]+)/i.exec(cls);
		if (m) {
			return (m[1] ?? '').toUpperCase();
		}
	} catch {
		/* 形态不符：尝试文本通道 */
	}
	try {
		const code = char.textContent?.codePointAt(0);
		return code === undefined ? null : code.toString(16).toUpperCase();
	} catch {
		return null;
	}
}

/**
 * 该字符的逐字符规则是否**已落盘**（v4 就绪判据的字符级检查）；
 * 三态语义见 `CharRuleIndex`，调用点 `isProductReady`。
 *
 * 键取不到（无类名也无文本码点）与「规则缺失」同一后果：未就绪——保守，
 * 不放行无法验证的产物。
 */
export function hasCharRule(char: Element, index: CharRuleIndex): boolean {
	const key = charRuleKey(char);
	return key !== null && index.decl.has(key);
}

/**
 * 声明体中 `padding` 的各分量是否**全为 0**——MathJax 4 的零宽不可见操作符形态
 * （`padding: 0px`）。可见字符恒有非零分量（实测 `padding: 0.68em 0.764em 0px 0px`
 * / `0.367em 0.778em 0px 0px` / `0.442em 0.878em 0.011em 0px`），故该判据不误伤。
 *
 * 语义等价性（对照 MathJax 4 `padding([t,e,s],i=0){return [t,s+i,e,0].map(...)}`）：
 * 四项为 `[左, 右+ic, 字宽, 0]`，**字宽为 0 且无内边距**的字符本就不占横向空间——
 * 即「设计上不可见」，与 v3 的空 content 规则语义一致。
 */
function isZeroPaddingDecl(decl: string): boolean {
	const m = /(?:^|;)\s*padding\s*:\s*([^;}]+)/i.exec(decl);
	if (!m) {
		return false;
	}
	const parts = (m[1] ?? '').trim().split(/\s+/);
	return parts.length > 0 && parts.every((v) => /^0(?:px|em|rem|%)?$/.test(v));
}

/**
 * 零宽字符是否为「设计上不可见」（U+2061 函数应用符、U+2062 隐式乘号等）。
 *
 * **调用点约定**：只由 `isProductReady` 对**宽度为 0** 的字符调用——可见字符
 * 在更早的宽度检查处就绪、不走这里（伪元素样式查询不便宜，勿对每字符调用）。
 *
 * **双形态**（两代MathJax 的规则形态都保留，缺一即误判）：
 * - **MathJax ≤ 3.x**：`::before` 的 content 为**空串**（显式空内容规则）。
 * - **MathJax 4.x**：不再有任何 content 规则（实机：整表 0 条 `content:""`），
 *   改以逐字符规则 **`padding` 全为 0** 判定（K113）——规则体从调用方传入的
 *   索引取（键来源见 `charRuleKey`：类名优先，兼收 v3「文本为空、字形在
 *   伪元素」形态）。
 *
 * 其余一律 false：`none`（规则未落盘的塌缩态）、非空字形内容（字形规则在而宽度
 * 为 0 的异常态）、`padding` 非全零（可见字符被塌缩）、规则缺失。
 * 判定环境不可用（单测桩缺 getComputedStyle / 无样式表 / 异常宿主）时按 false
 * 处理，维持旧的保守行为。
 */
export function isInvisibleCharByDesign(
	char: Element,
	index: CharRuleIndex,
): boolean {
	try {
		if (
			typeof getComputedStyle === 'function' &&
			getComputedStyle(char, '::before').content === '""'
		) {
			return true;
		}
	} catch {
		/* 判定环境不可用：继续按 MathJax 4 形态判定 */
	}
	try {
		const key = charRuleKey(char);
		if (key === null) {
			return false;
		}
		const decl = index.decl.get(key);
		return decl !== undefined && isZeroPaddingDecl(decl);
	} catch {
		return false;
	}
}
