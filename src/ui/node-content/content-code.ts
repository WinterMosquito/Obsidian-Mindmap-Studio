/** 节点内容 code：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment, type InlineContentOptions } from '../../core/node-content-types';
import { type Language, t } from '../../core/i18n';
import { type NodeContentTones } from '../../domain/color';
import { CODE_BLOCK_CLASS, codeBlockStyle, CODE_BLOCK_PRE_STYLES } from './content-code.styles';
import { CODE_COPY_CLASS, CODE_COPY_BUTTON_STYLES } from './content-copy.styles';
import { CODE_RENDERED_CLASS } from '../../core/constants';

/**
 * 块级代码块段（围栏，`block` 标记）：轻量渲染 + Obsidian 同款复制按钮。
 *
 * 结构：`div.tmm-codeblock`（底色盒）>`button.tmm-code-copy`（绝对定位）+ `pre > code`
 * （原文：换行/缩进逐字）。
 *
 * **三处分工，勿混**（K115）：本模块只产 DOM、**零监听**——显隐（悬停才出现）在
 * `styles.css` 的 `@media (hover:hover){ .tmm-codeblock:not(:hover) > .tmm-code-copy }`；
 * 点击（经引擎 `node_click` 委托）在 `features/node-codeblock.ts`；本表只管外观。
 * 此前此处的「悬停显隐」注释指向 `CODE_COPY_BUTTON_STYLES`，而该表并无任何 hover
 * 属性，属**悬空注释**（设计过但从未实现，K115 落地）。
 *
 * 「轻量」= **纯同步 DOM**：底色/等宽/滚动（样式见 CODE_BLOCK_*），**高亮不在
 * 本函数**——先写与原文同形的字面代码（占位即回退态），token 元素由注入的
 * `renderCode` 异步替换（同 buildMathElement 的字面占位纪律），生产实现见
 * `platform/prism-code`。**点击行为也不在本函数**——视图层经引擎 `node_click`
 * 委托命中选择器（features/node-codeblock.ts），本模块保持零 Obsidian 依赖、
 * 零监听、可单测。
 * 复制内容 = `segment.text`（信息行已在 splitFenceInfo 剥离）。
 */
export function buildCodeBlockElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	lang: Language,
	options: InlineContentOptions,
	tones: NodeContentTones | null,
): HTMLElement {
	const block = doc.createElement('div');
	block.className = CODE_BLOCK_CLASS;
	Object.assign(block.style, codeBlockStyle(tones));
	const button = doc.createElement('button');
	button.className = CODE_COPY_CLASS;
	button.setAttribute('aria-label', t(lang, 'codeBlock.copy'));
	// 原生悬停提示（Obsidian 用自家 tooltip 体系；foreignObject 内取不到，
	// title 是零依赖近似——与 aria-label 同文案）
	button.setAttribute('title', t(lang, 'codeBlock.copy'));
	// **复制内容在构建期定死**（data-code）：视图层点击处理直接读它，不依赖
	// closest/querySelector 的 DOM 链——「复制到第一行」这类 DOM 读取脆弱性
	// 从根上消除；文本 = 已剥信息行的代码原文（与显示一致）
	button.setAttribute('data-code', segment.text);
	Object.assign(button.style, CODE_COPY_BUTTON_STYLES);
	const pre = doc.createElement('pre');
	Object.assign(pre.style, CODE_BLOCK_PRE_STYLES);
	const code = doc.createElement('code');
	// 语言类（宿主/主题与 Prism 的选择器口径，如 `.language-js`）：无语言码时
	// 省略——不写空类，避免留下 `language-` 这种无意义钩子
	const codeLang = segment.lang ?? '';
	if (codeLang) {
		code.className = `language-${codeLang}`;
	}
	code.appendChild(doc.createTextNode(segment.text));
	placeCodeTokens(doc, code, segment.text, codeLang, options);
	pre.appendChild(code);
	block.appendChild(button);
	block.appendChild(pre);
	return block;
}

/**
 * `<code>` 的 **token 元素放置**：产物缓存命中 → **同步**放置；未命中且有语言码
 * → 交给注入的 `renderCode` 异步高亮（生产实现 `platform/prism-code`）。
 *
 * 与 `buildMathElement` 的缓存命中路径同款纪律（理由见其注释）：引擎的离屏测量
 * 是**同步**的、缓存键是 `outerHTML`，同步放置 token 才能让引擎量到真实宽高，
 * 且重建路径不再触发异步替换（无重排循环）。
 *
 * **无语言码直接返回**（保留字面）：无信息行的围栏块与缩进式代码块都没有语法可查，
 * 空跑一次异步通道没有意义，也省掉每个缩进块一次 `loadPrism` 往返。
 */
function placeCodeTokens(
	doc: InlineContentDocument,
	code: HTMLElement,
	codeText: string,
	codeLang: string,
	options: InlineContentOptions,
): void {
	const cached = options.getCachedCode?.(codeText, codeLang) ?? null;
	if (cached && cached.length > 0) {
		code.replaceChildren(...cached);
		code.classList.add(CODE_RENDERED_CLASS);
		return;
	}
	if (!codeLang) {
		return;
	}
	options.renderCode?.(doc, codeText, codeLang, code);
}
