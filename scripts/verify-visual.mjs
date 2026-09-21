#!/usr/bin/env node
/**
 * 无头渲染契约验证（Chrome headless --dump-dom）。
 *
 * 为什么需要：链接三类图标（文档双链自绘文档页图标 / URL 引擎原生链接图标 /
 * 附件引擎原生回形针）取决于引擎运行时 DOM 装配（`createNodePrefixContent`
 * 注入、prefix/suffix 内容入布局），**单测覆盖不到**——单测只能验证「写了哪些
 * 数据字段」，验证不了「引擎是否把它渲染成了图标、图标有没有尺寸」。本脚本在
 * 真实浏览器里渲染导图并断言 DOM，作为回归闸门。
 *
 * 覆盖与边界：
 * - 覆盖：三类图标的分流与存在性、图标尺寸（18×18，防 `foreignObject` 里
 *   0×0 不可见的旧故障）、回形针标题、画布铺满容器、节点测宽随文本变化
 *   （不被容器宽度拉平）；
 * - 覆盖（方案 B 原型，`features/node-inline-content.ts`）：自绘节点内联内容是否
 *   真的进入 foreignObject、离屏克隆测宽是否与渲染宽度同源、以及**点击命中契约**
 *   ——合成的 click 事件经引擎 `node_click` 派发后，`event.target` 必须就是锚点本体
 *   且落在节点 group 内（= view-wikilink.findAnchorInNode 的两个前置判据），
 *   `data-href` 即锚点携带的原始 linkpath；`**重点**` 必须渲染为 `<strong>`；
 *   纯文本节点必须仍走引擎默认 SVG 文本；
 * - 覆盖（导出保真）：导出 SVG（`map.getSvgData().svgHTML`）里自绘根元素 / 锚点 /
 *   轻标记元素必须带**内联样式**——引擎导出只注入自身 CSS 与 header/footer 的
 *   cssText，插件 styles.css 不在导出图里生效；
 * - 覆盖（打开视口的性能契约，`perf-box` 探针，见 AGENTS.md K70）：121 节点性能模式
 *   大图 + 800×300 视口——`centerContentAtFullScale` 前后 `.smm-node` 数均 < 总数 50%
 *   （不装配全量 DOM）、内容中心 = 画布中心 ±2px、数据层几何并集与 DOM 全量盒尺寸差
 *   ≤8px；探针规模须取「刚过阈值的最小量」（641 节点版本会因分片渲染任务链推后
 *   其余探针的读取窗口而连锁失败，见 K70 ③）；
 * - 不覆盖：样式级联的极端回归。历史上有害规则
 *   `.mindmap-canvas-container > div{width:100%}` 会在 foreignObject 渲染路径下
 *   放大测宽（引擎的离屏测宽元素是**挂在画布容器下的 position:fixed 子 div**，
 *   见 vendor `measureCustomNodeContentSize`），故 styles.css 明确禁止给该容器
 *   直接子 div 设 width/height；本脚本不覆盖该规则的样式级联后果。
 *
 * 做法：esbuild 把 `src/engine/mindmap.ts`（纯模块，无 obsidian 依赖）打成浏览器
 * IIFE，配合**仓库真实 styles.css** 在无头 Chrome 里渲染若干场景，再解析
 * --dump-dom 输出逐场景断言。临时文件默认落在系统临时目录并在验证后清理。
 *
 * 用法：
 *   npm run verify:visual                        # 无 Chrome 时跳过（退出码 0）
 *   npm run verify:visual -- --require-chrome    # 无 Chrome 时失败（CI 用）
 *   npm run verify:visual -- --keep              # 保留临时目录（排查用）
 *   npm run verify:visual -- --log-dir <dir>     # 落盘诊断日志（CI 归档用）
 *   CHROME_PATH=/path/to/chrome npm run verify:visual
 *
 * 退出码：0 = 通过或（未要求时）缺浏览器跳过；1 = 断言失败或缺浏览器但要求了。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARGV = process.argv.slice(2);
const ARGS = new Set(ARGV);

/**
 * 读取 `--name value` 或 `--name=value` 形式的参数值。
 * 不带值时返回 null（避免把紧随其后的另一个开关误当成值）。
 */
function argValue(name) {
	const eq = ARGV.find((arg) => arg.startsWith(`${name}=`));
	if (eq !== undefined) return eq.slice(name.length + 1);
	const index = ARGV.indexOf(name);
	if (index === -1) return null;
	const next = ARGV[index + 1];
	if (next === undefined || next.startsWith('--')) return null;
	return next;
}

/**
 * 每个场景渲染「根 + 一个子节点」，断言集中在子节点上（根节点作为无图标对照）。
 * 根节点自带文字，因此节点数恒为 2——这个前提本身也被断言，防止场景退化。
 */
const SCENARIOS = [
	{
		name: 'plain',
		label: '无链接节点（对照）',
		data: { text: 'Plain' },
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0, widthBelow: 100 },
	},
	{
		name: 'doc',
		label: '文档双链 → 自绘文档页图标',
		data: {
			text: 'Note',
			mdWikiLinkpath: '[[Note]]',
			mdLinkText: 'Note',
			mdLinkStyle: 'wiki',
		},
		expect: { docIcon: 1, linkIcon: 0, attachIcon: 0 },
	},
	{
		name: 'url',
		label: 'URL → 引擎原生链接图标',
		data: { text: 'Site', hyperlink: 'https://example.com' },
		expect: { docIcon: 0, linkIcon: 1, attachIcon: 0 },
	},
	{
		name: 'attach',
		label: '附件双链 → 引擎原生回形针',
		data: {
			text: 'Report.pdf',
			attachmentUrl: 'Report.pdf',
			attachmentName: 'Report.pdf',
			mdAttachmentLinkpath: 'Report.pdf',
			mdLinkStyle: 'wiki',
		},
		expect: {
			docIcon: 0,
			linkIcon: 0,
			attachIcon: 1,
			attachTitle: 'Report.pdf',
		},
	},
	{
		name: 'long',
		label: '长文本节点 → 测宽封顶（自动换行）',
		data: { text: 'L'.repeat(200) },
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0, widthAtLeast: 400 },
	},
	{
		name: 'inline',
		label: '方案B 原型：节点内联可点链接（自绘 HTML）',
		data: {
			// 与解析产物同形：mdDerivedText === text ⇒ 未编辑 → 自绘路径读 mdRaw
			// （已编辑的节点渲染改读 data.text，见 node-inline-content 文件头契约）
			text: '见 **重点** 笔记A 与 https://example.com',
			mdDerivedText: '见 **重点** 笔记A 与 https://example.com',
			mdRaw: '见 **重点** [[笔记A]] 与 https://example.com',
		},
		// 被接管后引擎跳过 text/image/icon/hyperlink/tag/note/prefix/postfix：
		// 三类图标一律为 0 正是「接管生效」的负向证据（详细断言在 inline 探针）
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0 },
	},
	{
		name: 'markup',
		label: '方案B 原型：仅轻标记（无链接）也应接管',
		data: {
			// 接管条件含轻标记段（2026-09-15 修订：此前只按「含链接」接管，
			// 导致 `**粗**` 在无链接节点里原样显示）——本场景是该修订的锁定用例
			text: '重点 与 码',
			mdDerivedText: '重点 与 码',
			mdRaw: '**重点** 与 `码`',
		},
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0 },
	},
	{
		name: 'syntax',
		label: '方案B 原型：高亮 / 下划线式粗斜 / 转义 / 注释 / 未解析链接',
		data: {
			// 对齐官方帮助「Basic formatting syntax」的显示层处理（2026-09-15）：
			// `==高亮==` → <mark>、`__粗__` → <strong>、`\*转义\*` → 字面 `*转义*`、
			// `%%注释%%` 隐藏；`[[未解析的笔记]]` 由注入的解析器判为未解析 → 弱化形态
			//（解析器注入见 options.createNodeContent —— 生产在 view.ts 注入真实解析）
			text: '高亮 与 粗 与 *转义* 与 未解析的笔记',
			mdDerivedText: '高亮 与 粗 与 *转义* 与 未解析的笔记',
			mdRaw:
				'==高亮== 与 __粗__ 与 \\*转义\\* 与 [[未解析的笔记]] %%备注%%',
		},
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0 },
	},
	{
		name: 'paragraph',
		label: '段落（多行）节点：行内链接同样渲染为可点文本',
		data: {
			// 段落节点的 mdRaw 是**逐字原文**（多行以 \n 连接），自绘路径按它渲染
			// → 段落里的链接与轻标记同样生效（多行靠 white-space: pre-wrap 保留）
			text: '第一段 见 笔记A\n第二段 见 https://example.com',
			mdDerivedText: '第一段 见 笔记A\n第二段 见 https://example.com',
			mdRaw: '第一段 见 [[笔记A]]\n第二段 见 https://example.com',
			mdType: 'plain',
		},
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0 },
	},
	{
		name: 'hugeline',
		label: '超长单行（20k）→ 必须接管并截断展示（绝不回落引擎）',
		data: {
			// 20k 是**实测能压垮引擎**的尺寸：引擎 createTextNode 逐字符换行 +
			// 每字一次测量（二次复杂度），同内容走引擎 ≈ +2.8s（整轮 1.1s → 3.9s）。
			// 故本场景既是功能守卫（截断展示），也是性能守卫——若接管条件回归，
			// 这一项会先失败（更糟时还会吃掉 --virtual-time-budget 让后续探针集体失败）。
			text: '长'.repeat(20000),
			mdRaw: '长'.repeat(20000),
			mdDerivedText: '长'.repeat(20000),
		},
		expect: { docIcon: 0, linkIcon: 0, attachIcon: 0 },
	},
];

/**
 * 布局探针的测试树（7 节点：根 + 3 子 + 2 孙 + 1 孙），
 * 用于六种布局的渲染与连线样式分派核验。
 */
const LAYOUT_PROBE_TREE = {
	data: { text: '中心主题', uid: 'lpr' },
	children: [
		{
			data: { text: '分支 A', uid: 'lpa' },
			children: [
				{ data: { text: 'A-1', uid: 'lpa1' }, children: [] },
				{ data: { text: 'A-2', uid: 'lpa2' }, children: [] },
			],
		},
		{
			data: { text: '分支 B', uid: 'lpb' },
			children: [{ data: { text: 'B-1', uid: 'lpb1' }, children: [] }],
		},
		{ data: { text: '分支 C', uid: 'lpc' }, children: [] },
	],
};

/** 布局探针覆盖的六种布局（与 constants.LAYOUT_OPTIONS 同集） */
const LAYOUT_PROBE_LAYOUTS = [
	'logicalStructure',
	'mindMap',
	'organizationStructure',
	'catalogOrganization',
	'timeline',
	'fishbone',
];

/**
 * 布局探针契约：曲线 = 支持三态分派的两种布局（auto 偏好下取 curve）；
 * 其余四种为布局类固有直线（不接受 lineStyle）。
 */
const LAYOUT_PROBE_CONTRACTS = [
	{ layout: 'logicalStructure', curves: true },
	{ layout: 'mindMap', curves: true },
	{ layout: 'organizationStructure', curves: false },
	{ layout: 'catalogOrganization', curves: false },
	{ layout: 'timeline', curves: false },
	{ layout: 'fishbone', curves: false },
];

/** 定位无头 Chrome（环境变量优先，其次平台默认安装路径） */
function findChrome() {
	const candidates = [];
	if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
	if (process.platform === 'win32') {
		candidates.push(
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			join(
				process.env.LOCALAPPDATA ?? '',
				'Google\\Chrome\\Application\\chrome.exe',
			),
			'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		);
	} else if (process.platform === 'darwin') {
		candidates.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		);
	} else {
		candidates.push(
			'/usr/bin/google-chrome',
			'/usr/bin/google-chrome-stable',
			'/opt/google/chrome/chrome',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
		);
	}
	return candidates.find((path) => path && existsSync(path)) ?? null;
}

/**
 * `obsidian` 的最小垫片（仅在无头验证页里使用）。
 *
 * 为什么需要：本页要加载的模块图包含 `features/view-wikilink.ts`（探针用它的
 * `ensureOffsetSize`），而它现在会经 `view-link-navigator.ts` 触达 `obsidian`
 * 的运行时导出（Notice / Platform / normalizePath…）。obsidian 包只发布类型、
 * 没有 JS，故打包时会报「Could not resolve "obsidian"」。
 *
 * 与 tests/mocks/obsidian.ts 同源（那条路径由 vitest alias 使用）：只保证
 * **模块图能链接**（具名导出存在）+ 被 `instanceof` 判定的类可实例化；
 * 交互行为不在这里实现——探针从不调用这些 Obsidian API。
 */
const OBSIDIAN_SHIM_SOURCE = `export class App {}
export class TAbstractFile {}
export class TFile {}
export class TFolder {}
export class MarkdownView {}
export class WorkspaceLeaf {}
export class Plugin {}
export class Component {}
export class FileSystemAdapter {
	getBasePath() {
		return '/';
	}
}
export class Notice {
	constructor() {}
}
export class Modal {
	setCloseCallback() {
		return this;
	}
}
export class Scope {
	register() {}
	unregister() {}
}
// view-wikilink 修饰键分流的具名导入（官方语义桩，与 tests/mocks/obsidian.ts
// 同源；探针不直接调用，仅保证模块图可链接）
export class Keymap {
	static isModEvent(evt) {
		if (!evt) {
			return false;
		}
		if (evt.ctrlKey === true || evt.metaKey === true) {
			return evt.altKey === true
				? evt.shiftKey === true
					? 'window'
					: 'split'
				: 'tab';
		}
		return evt.button === 1 ? 'tab' : false;
	}
}
export class Menu {
	addItem() {
		return this;
	}
	addSeparator() {
		return this;
	}
	showAtPosition() {}
}
export const Platform = {
	isDesktopApp: true,
	isMobile: false,
	isIosApp: false,
	isAndroidApp: false,
	isMacOS: false,
	isWin: true,
	isLinux: false,
};
export function normalizePath(p) {
	return String(p).replace(/\\\\/g, '/');
}
export function setIcon() {}
`;

/** 生成浏览器入口：按场景逐个渲染导图（与插件同款容器类名） */
function buildEntrySource({ workloadEdits = 0, memoryProbe = false } = {}) {
	const mindmapModule = join(ROOT, 'src', 'engine', 'mindmap.ts').replaceAll('\\', '/');
	const wikilinkModule = join(ROOT, 'src', 'features', 'view-wikilink.ts').replaceAll(
		'\\',
		'/',
	);
	const inlineContentModule = join(
		ROOT,
		'src',
		'features',
		'node-inline-content.ts',
	).replaceAll('\\', '/');
	const nodeWidthModule = join(
		ROOT,
		'src',
		'features',
		'view-node-width.ts',
	).replaceAll('\\', '/');
	const imagesPathModule = join(ROOT, 'src', 'media', 'images-path.ts').replaceAll(
		'\\',
		'/',
	);
	const serialized = JSON.stringify(
		SCENARIOS.map(({ name, data }) => ({ name, data })),
		null,
		'\t',
	);
	return `import { applyImageSizeCorrectionsToEngine, applyPerformanceMode, centerContentAtFullScale, countTreeNodes, createMindMap, HISTORY_BUDGET_BYTES, previewNodeImageSize, refreshNodeCustomContent, replaceMindMapData, resetZoom, resolveHistoryLimit, setNodeImageSize, setNodeText } from ${JSON.stringify(mindmapModule)};
import { ensureDefaultImageSizes } from ${JSON.stringify(imagesPathModule)};
import { ensureOffsetSize } from ${JSON.stringify(wikilinkModule)};
import { buildInlineNodeContent, segmentCacheStats, shouldSelfDrawNode } from ${JSON.stringify(inlineContentModule)};
import { gateNodeWidthHandles } from ${JSON.stringify(nodeWidthModule)};

const scenarios = ${serialized};

const options = {
	layout: 'logicalStructure',
	lineStyle: 'auto',
	themePref: 'default',
	isDark: false,
	enableDrag: true,
	performanceMode: false,
	performanceThreshold: 1000,
	lang: 'zh',
	onHyperlinkJump: null,
	// 方案B 原型：节点内联内容渲染（返回 null 的节点走引擎默认 SVG 文本）。
	// 未解析链接的弱化需要**注入解析器**（本模块不接触 Obsidian API，生产由
	// view.ts 经 isResolvedWikiLinkpath 注入真实解析；无头验证里用确定性桩：
	// linkpath 以「未解析」开头即视为未解析，其余已解析）。
	// 与生产 view.ts 同一接线：先装宽度手柄门禁（纯文本/含图节点不留死手柄），
	// 再建自绘内容（返回 null 的节点走引擎默认 SVG 文本）
	createNodeContent: (node, doc, style, lang) => {
		gateNodeWidthHandles(node);
		return buildInlineNodeContent(node, doc, style, lang, {
			isResolvedLink: (linkpath) => !linkpath.startsWith('未解析'),
		});
	},
};

/** 场景名 → 引擎实例（inline 探针需要渲染节点与引擎事件） */
const scenarioMaps = {};

for (const { name, data } of scenarios) {
	const holder = document.createElement('div');
	holder.id = 'map-' + name;
	// 与 view.ts 一致：canvasEl 同时带 mindmap-canvas-container 与引擎容器类名
	holder.className = 'mindmap-canvas-container';
	holder.style.width = '1200px';
	holder.style.height = '400px';
	document.body.appendChild(holder);
	scenarioMaps[name] = createMindMap(
		holder,
		{
			data: { text: name, uid: 'root-' + name },
			children: [{ data: { uid: 'child-' + name, ...data }, children: [] }],
		},
		options,
	);
}

// —— 默认视口探针：打开时应为 100% 缩放 + 整体内容居中 ——
// 用「深链」大图复现用户场景：fit 全图会把比例压到文字不可读。
const viewportHolder = document.createElement('div');
viewportHolder.id = 'map-viewport';
viewportHolder.className = 'mindmap-canvas-container';
viewportHolder.style.width = '1200px';
viewportHolder.style.height = '400px';
document.body.appendChild(viewportHolder);
let chain = { data: { text: 'v20', uid: 'vp-20' }, children: [] };
for (let i = 19; i >= 1; i--) {
	chain = { data: { text: 'v' + i, uid: 'vp-' + i }, children: [chain] };
}
const viewportMap = createMindMap(viewportHolder, chain, options);

// 与插件同款时序：引擎 render() 后首帧异步完成，视口设置在延时后执行。
// 就绪判定改为「引擎首帧事件（node_tree_render_end）+ 节点出现」的轮询
// （基准延时 150ms 保留，之后每 50ms 复查，上限 600ms）：固定 150ms 在冷启动/
// 高负载下偶发不足——2026-09-18 实测两次与代码无关的假失败：容器尚无
// .smm-node 时锚定探针读 null 尺寸、视口探针包围盒为空（中心 NaN → 字段缺失）。
// 就绪即测（通常零额外虚拟时间），真正渲染失败时轮询到上限仍会如实报告。
let viewportRendered = false;
viewportMap.on('node_tree_render_end', () => {
	viewportRendered = true;
});
const runViewportProbes = () => {
	const probe = document.createElement('pre');
	probe.id = 'viewport-probe';
	try {
		centerContentAtFullScale(viewportMap);
		const state = viewportMap.view.getTransformData().state;
		const canvasRect = viewportHolder.getBoundingClientRect();
		// 整体内容包围盒（所有已渲染节点矩形的并集，相对画布左上角）
		const rects = [...viewportHolder.querySelectorAll('.smm-node')].map((el) =>
			el.getBoundingClientRect(),
		);
		const minX = Math.min(...rects.map((r) => r.left));
		const minY = Math.min(...rects.map((r) => r.top));
		const maxX = Math.max(...rects.map((r) => r.right));
		const maxY = Math.max(...rects.map((r) => r.bottom));
		const contentCenter = [
			Math.round((minX + maxX) / 2 - canvasRect.left),
			Math.round((minY + maxY) / 2 - canvasRect.top),
		];
		// 重置缩放不漂移：先缩到 50%（以画布中心为锚点），记录中心处的内容坐标，
		// 重置后再算该内容点落回屏幕的位置——位移应 ≤1px（否则表现为「视图乱飘」）
		const cx = canvasRect.width / 2;
		const cy = canvasRect.height / 2;
		viewportMap.view.setScale(0.5, cx, cy);
		const zoomed = viewportMap.view.getTransformData().state;
		const contentX = (cx - zoomed.x) / zoomed.scale;
		const contentY = (cy - zoomed.y) / zoomed.scale;
		resetZoom(viewportMap);
		const reset = viewportMap.view.getTransformData().state;
		const drift = Math.hypot(
			contentX * reset.scale + reset.x - cx,
			contentY * reset.scale + reset.y - cy,
		);
		probe.textContent = JSON.stringify({
			scale: state.scale,
			contentCenter,
			canvas: [Math.round(canvasRect.width), Math.round(canvasRect.height)],
			nodeCount: rects.length,
			resetScale: reset.scale,
			resetDrift: Math.round(drift * 100) / 100,
		});
	} catch (error) {
		probe.textContent = JSON.stringify({ error: String(error) });
	}
	document.body.appendChild(probe);

	// —— 悬停预览锚定探针：SVG 节点须能提供有限的 offsetWidth/offsetHeight ——
	// 官方 HoverPopover.position() 取 bottom = rect.top + targetEl.offsetHeight；
	// SVG 元素没有这两个属性时该值为 NaN，弹窗「下方放得下就放下方」的分支永不成立。
	const anchorProbe = document.createElement('pre');
	anchorProbe.id = 'anchor-probe';
	try {
		const nodeEl = viewportHolder.querySelector('.smm-node');
		const beforeWidth = String(nodeEl.offsetWidth);
		ensureOffsetSize(nodeEl);
		const nodeRect = nodeEl.getBoundingClientRect();
		anchorProbe.textContent = JSON.stringify({
			beforeWidth,
			offsetWidth: Math.round(nodeEl.offsetWidth),
			offsetHeight: Math.round(nodeEl.offsetHeight),
			rectWidth: Math.round(nodeRect.width),
			rectHeight: Math.round(nodeRect.height),
			bottom: Math.round(nodeRect.top + nodeEl.offsetHeight),
			right: Math.round(nodeRect.left + nodeEl.offsetWidth),
		});
	} catch (error) {
		anchorProbe.textContent = JSON.stringify({ error: String(error) });
	}
	document.body.appendChild(anchorProbe);
};
const waitViewportReady = (deadline) => {
	if (
		viewportRendered ||
		viewportHolder.querySelector('.smm-node') ||
		Date.now() > deadline
	) {
		runViewportProbes();
		return;
	}
	window.setTimeout(() => waitViewportReady(deadline), 50);
};
window.setTimeout(() => waitViewportReady(Date.now() + 600), 150);

// —— 大图性能模式探针：内容包围盒的数据层求法（居中不再全树装配 DOM） ——
// 背景（2026-09-20 用户报告「多节点打开卡顿严重、加载很久」）：打开时的默认
// 视口居中此前用 forceLoadNode + rbox 测全内容包围盒——性能模式下这是把整树
// 节点**同步**装配进 DOM（vendor 的 forceLoadNode 同步递归 render），且打开窗口
// 内被多轮触发（首帧渲染结束、其自身 emit 重入、150ms 兜底、图片回灌补居中）。
// 修复方向：性能模式改用渲染树布局几何（node.left/top/width/height，与引擎裁剪
// 判定 checkIsInClient 同源）直接求盒，全程不碰 DOM；引擎随后按新视口自行回收/补齐。
// 本探针钉住两条契约：
//   ① 居中不装配全量 DOM：centerContentAtFullScale 前后 .smm-node 数均 ≪ 总数；
//   ② 数据层盒与 DOM 全量盒（forceLoadNode + rbox）尺寸口径一致（容差内）。
const perfBoxHolder = document.createElement('div');
perfBoxHolder.id = 'perf-box';
perfBoxHolder.className = 'mindmap-canvas-container';
perfBoxHolder.style.width = '800px';
perfBoxHolder.style.height = '300px';
document.body.appendChild(perfBoxHolder);
// 121 节点（1 + 10×(1+11)），超过阈值 100 ⇒ 性能模式生效；800×300 视口远小于
// 内容范围 ⇒ 首帧裁剪必然显著（全量 vs 可见子集的差可判定）。
// 规模刻意取「刚过阈值」的最小量：本探针在共享页面里跑，图越大，其分片渲染
// 任务链（引擎 view_data_change 后每子节点一个 setTimeout）越长，越可能把
// 其余探针的读取窗口推后（2026-09-20 实测 641 节点版本会连锁失败 43 项）。
const perfBoxTree = { data: { text: 'perf-root', uid: 'pb-root' }, children: [] };
for (let i = 0; i < 10; i++) {
	const branch = { data: { text: 'b' + i, uid: 'pb-b' + i }, children: [] };
	for (let j = 0; j < 11; j++) {
		branch.children.push({
			data: { text: 'l' + i + '-' + j, uid: 'pb-l-' + i + '-' + j },
			children: [],
		});
	}
	perfBoxTree.children.push(branch);
}
const perfBoxProbe = document.createElement('pre');
perfBoxProbe.id = 'perf-box-probe';
perfBoxProbe.textContent = 'PENDING';
document.body.appendChild(perfBoxProbe);
let perfBoxMap = null;
let perfBoxRendered = false;
try {
	perfBoxMap = createMindMap(perfBoxHolder, perfBoxTree, {
		...options,
		performanceMode: true,
		performanceThreshold: 100,
	});
	perfBoxMap.on('node_tree_render_end', () => {
		perfBoxRendered = true;
	});
} catch (error) {
	perfBoxProbe.textContent = JSON.stringify({ error: String(error) });
}
/** 渲染树全量节点的布局几何并集（画布/布局坐标系，不依赖 DOM） */
const collectDataBox = (root) => {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const walk = (node) => {
		const { left, top, width, height } = node;
		if (
			Number.isFinite(left) &&
			Number.isFinite(top) &&
			Number.isFinite(width) &&
			Number.isFinite(height)
		) {
			if (left < minX) minX = left;
			if (top < minY) minY = top;
			if (left + width > maxX) maxX = left + width;
			if (top + height > maxY) maxY = top + height;
		}
		const children = node.children || [];
		for (const child of children) walk(child);
	};
	if (root) walk(root);
	if (!Number.isFinite(minX)) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};
const runPerfBoxProbe = () => {
	try {
		if (!perfBoxMap) return;
		const domCount = () => perfBoxHolder.querySelectorAll('.smm-node').length;
		const firstFrameDom = domCount();
		// 生产入口：默认视口居中（修复后：性能模式走数据层盒，不装配全量）
		centerContentAtFullScale(perfBoxMap);
		const afterCenterDom = domCount();
		const transform = perfBoxMap.draw.transform();
		const dataBox = collectDataBox(perfBoxMap.renderer.root);
		const canvasRect = perfBoxHolder.getBoundingClientRect();
		// 内容中心（画布内坐标）= 布局中心 × scale + translate（引擎 getNodePosInClient 同口径）
		const contentCenter = dataBox
			? [
					(dataBox.x + dataBox.width / 2) * transform.scaleX + transform.translateX,
					(dataBox.y + dataBox.height / 2) * transform.scaleY + transform.translateY,
				]
			: null;
		// 对照：DOM 全量盒（forceLoadNode + rbox）放最后测，避免污染上面的裁剪计数
		perfBoxMap.renderer.forceLoadNode();
		const allDom = domCount();
		const rbox = perfBoxMap.draw.rbox();
		perfBoxProbe.textContent = JSON.stringify({
			total: countTreeNodes(perfBoxTree),
			firstFrameDom,
			afterCenterDom,
			allDom,
			scale: Math.round(transform.scaleX * 1000) / 1000,
			canvas: [Math.round(canvasRect.width), Math.round(canvasRect.height)],
			contentCenter: contentCenter
				? [Math.round(contentCenter[0]), Math.round(contentCenter[1])]
				: null,
			canvasCenter: [
				Math.round(canvasRect.width / 2),
				Math.round(canvasRect.height / 2),
			],
			dataBox: dataBox
				? { width: Math.round(dataBox.width), height: Math.round(dataBox.height) }
				: null,
			domBox: { width: Math.round(rbox.width), height: Math.round(rbox.height) },
		});
	} catch (error) {
		perfBoxProbe.textContent = JSON.stringify({ error: String(error) });
	}
};
window.setTimeout(() => {
	const wait = (deadline) => {
		if (perfBoxRendered || Date.now() > deadline) {
			runPerfBoxProbe();
			return;
		}
		window.setTimeout(() => wait(deadline), 50);
	};
	wait(Date.now() + 600);
}, 400);

/**
 * 等图首帧落地后再读取引擎结构（事件 + 轮询；同 viewport / anchor 的 K69 ④ 修法）。
 *
 * 存在的理由（2026-09-21 复查加固）：多处探针原先「建图 → 固定 ms → 读
 * renderer.root」，而引擎 render() 经 setTimeout(0) 起链、布局分片跨多个宏任务
 * ——冷启动 / 机器负载高时固定延时不足，读到 renderer.root 为 null 的中间态
 * （perf / image / count / layout 四个探针在负载机上稳定假失败，同页其余探针
 * 正常）。就绪即测（通常零额外虚拟时间），真正渲染失败时轮询到上限仍会如实
 * 报告（run 照常执行，读到什么断言什么）。
 *
 * @param map 引擎实例（可为 null）
 * @param holder 画布容器（.smm-node 出现作为兜底判据）
 * @param run 就绪后的读取动作
 * @param baseDelay 基准延时（默认 80ms，之后每 40ms 复查）
 * @param timeout 轮询上限（默认 1200ms）
 * @param strict 只认 node_tree_render_end 事件（渲染**完整**落地）：读 DOM 结构 /
 *   计数的探针必须传 true——.smm-node / renderer.root 兜底只保证「首个
 *   节点已创建」，部分渲染的中间态会把「首帧尚未完成时调 render()」变成
 *   「全量重建」（实测：空 render 构建器调用 500 次 vs 期望 0；2026-09-21）。
 */
const whenMapReady = (map, holder, run, baseDelay = 80, timeout = 1200, strict = false) => {
	let rendered = false;
	try {
		if (map && typeof map.on === 'function') {
			map.on('node_tree_render_end', () => {
				rendered = true;
			});
		}
	} catch {
		// 无事件面的桩：仅靠轮询兜底
	}
	const ready = () =>
		rendered ||
		(!strict &&
			(!!(map && map.renderer && map.renderer.root) ||
				!!(holder && holder.querySelector && holder.querySelector('.smm-node'))));
	const wait = (deadline) => {
		if (ready() || Date.now() > deadline) {
			run();
			return;
		}
		window.setTimeout(() => wait(deadline), 40);
	};
	window.setTimeout(() => wait(Date.now() + timeout), baseDelay);
};

// —— 布局探针：六种布局渲染 × 连线样式分派 × 根节点连线起点 ——
// 连线路径 = 容器内非节点形状的 path（节点形状带 class="smm-node-shape"，
// 圆角以 C 命令实现，混入会把"直线布局"误判成含曲线）。
const layoutProbe = document.createElement('pre');
layoutProbe.id = 'layout-probe';
document.body.appendChild(layoutProbe);
const layoutMaps = {};
window.setTimeout(() => {
	for (const layout of ${JSON.stringify(LAYOUT_PROBE_LAYOUTS)}) {
		const holder = document.createElement('div');
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1000px';
		holder.style.height = '600px';
		document.body.appendChild(holder);
		try {
			layoutMaps[layout] = { holder, map: createMindMap(holder, ${JSON.stringify(LAYOUT_PROBE_TREE)}, { ...options, layout }) };
		} catch (error) {
			layoutMaps[layout] = { holder, error: 'createMindMap 抛错: ' + String(error) };
		}
	}
	// 六张图逐一等首帧落地后再读取（事件 + 轮询；此前固定 400ms，负载机器上
	// 读到 renderer.root 为 null 的中间态——2026-09-21 复查加固，见 whenMapReady）。
	const runLayoutRead = () => {
		const report = {};
		try {
			for (const layout of ${JSON.stringify(LAYOUT_PROBE_LAYOUTS)}) {
				const entry = layoutMaps[layout];
				if (!entry || entry.error) {
					report[layout] = { error: entry?.error || '未创建' };
					continue;
				}
				const root = entry.map.renderer.root;
				if (!root) {
					report[layout] = { error: 'renderer.root 尚未就绪' };
					continue;
				}
				const box = { left: root.left, top: root.top, width: root.width, height: root.height };
				const paths = [...entry.holder.querySelectorAll('path')]
					.filter((el) => !el.classList.contains('smm-node-shape'))
					.map((el) => el.getAttribute('d') || '');
				const starts = paths
					.map((d) => {
						const m = /^M\\s*(-?[\\d.]+)[ ,](-?[\\d.]+)/.exec(d.trim());
						return m ? [Number(m[1]), Number(m[2])] : null;
					})
					.filter(Boolean);
				report[layout] = {
					nodes: entry.holder.querySelectorAll('.smm-node').length,
					lines: paths.length,
					curves: paths.filter((d) => /[CQ]/.test(d)).length,
					root: box,
					startsAtRootCenter: starts.filter(
						([x, y]) =>
							Math.abs(x - (box.left + box.width / 2)) <= 3 &&
							Math.abs(y - (box.top + box.height / 2)) <= 3,
					).length,
					startsAtRootEdgeX: starts.filter(
						([x]) =>
							Math.abs(x - box.left) <= 3 ||
							Math.abs(x - box.left - box.width) <= 3,
					).length,
				};
			}
			// 引擎快捷键表（KeyCommand 内部字段）：createMindMap 末段必须已移除
			// 引擎自带的 Ctrl+L（= RESET_LAYOUT），自动整理统一走插件命令。
			const first = layoutMaps[${JSON.stringify(LAYOUT_PROBE_LAYOUTS[0])}];
			const shortcutMap =
				first && first.map && first.map.keyCommand
					? first.map.keyCommand.shortcutMap
					: null;
			report.engineShortcuts = shortcutMap ? Object.keys(shortcutMap) : [];
			layoutProbe.textContent = JSON.stringify(report);
		} catch (error) {
			layoutProbe.textContent = JSON.stringify({ error: String(error) });
		}
	};
	const layoutEntries = ${JSON.stringify(LAYOUT_PROBE_LAYOUTS)}
		.map((layoutName) => layoutMaps[layoutName])
		.filter((entry) => entry && !entry.error);
	// 六张图各自等首帧**完整**落地：只认 node_tree_render_end（读 DOM 结构的一侧
	// 必须用严格判据——.smm-node 出现只代表首个节点已创建，部分渲染时会少算）
	let layoutsRendered = 0;
	for (const entry of layoutEntries) {
		try {
			entry.map.on('node_tree_render_end', () => {
				layoutsRendered++;
			});
		} catch {
			// 无事件面的桩：交给超时兜底
		}
	}
	const allLayoutReady = () => layoutsRendered >= layoutEntries.length;
	const waitLayouts = (deadline) => {
		if (allLayoutReady() || Date.now() > deadline) {
			runLayoutRead();
			return;
		}
		window.setTimeout(() => waitLayouts(deadline), 50);
	};
	window.setTimeout(() => waitLayouts(Date.now() + 1200), 80);
}, 200);

// —— 方案B 原型探针：自绘节点内联内容的装配 × 测宽同源 × 点击命中锚点 ——
// 这一步验证的是「单测覆盖不到」的引擎运行时装配：HTML 是否真进了 foreignObject、
// 引擎是否按离屏克隆测出了尺寸、以及节点内锚点点击后 event.target 是否就是锚点
// （= view-wikilink.findAnchorInNode 的两个前置判据；其后的跳转分流已由
// tests/view-wikilink.test.ts 覆盖）。
const inlineProbe = document.createElement('pre');
inlineProbe.id = 'inline-probe';
document.body.appendChild(inlineProbe);
window.setTimeout(() => {
	try {
		const holder = document.getElementById('map-inline');
		const plainHolder = document.getElementById('map-plain');
		const map = scenarioMaps.inline;
		// 查询一律限定在 foreignObject 内：引擎的离屏测量元素也挂在画布容器下
		// （position:fixed，内含自绘内容的克隆体），不限定会把克隆体算进来
		const region = holder
			? holder.querySelector('foreignObject .mindmap-node-inline-content')
			: null;
		const anchor = holder ? holder.querySelector('foreignObject a.internal-link') : null;
		const external = holder
			? holder.querySelector('foreignObject a.external-link')
			: null;
		// 仅轻标记（无链接）的场景容器：验证「轻标记也走自绘」
		const markupHolder = document.getElementById('map-markup');
		// 轻标记扩展 / 转义 / 注释 / 未解析链接的场景容器
		const syntaxHolder = document.getElementById('map-syntax');
		const syntaxText = syntaxHolder
			? (syntaxHolder.querySelector('.mindmap-node-inline-content')?.textContent ??
				'')
			: '';
		// 段落（多行）场景：README 承诺「段落里的链接同样可点」，此处实测
		const paragraphHolder = document.getElementById('map-paragraph');
		// 超长单行场景：必须被接管（长行交给引擎会二次复杂度卡死）
		const hugeHolder = document.getElementById('map-hugeline');
		const hugeRegion = hugeHolder
			? hugeHolder.querySelector('.mindmap-node-inline-content')
			: null;
		const root = map && map.renderer ? map.renderer.root : null;
		const child = root && root.children ? root.children[0] : null;
		// 祖先链上是否存在 foreignObject：证明内容确实走了引擎自绘节点内容通道
		const insideForeignObject = (el) => {
			let cur = el ? el.parentElement : null;
			while (cur) {
				if (cur.localName === 'foreignObject') return true;
				cur = cur.parentElement;
			}
			return false;
		};
		// 点击模拟：引擎在节点 group 的 click 上派发 node_click(node, event)，
		// view-wilink 用 event.target 与该节点 group 的 contains 定位锚点
		let click = null;
		/** 宽度拖拽实测结果（未取到节点时为 null） */
		let widthDrag = null;
		map.on('node_click', (node, event) => {
			const groupEl = node.group ? node.group.node : null;
			const target = event.target;
			click = {
				isAnchor: target === anchor,
				inGroup: !!(groupEl && groupEl.contains(target)),
				closestHit: !!(
					target &&
					target.closest &&
					target.closest('a.internal-link') === anchor
				),
				dataHref:
					target && target.getAttribute
						? target.getAttribute('data-href')
						: null,
			};
		});
		if (anchor) {
			anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		}
		// 宽度拖拽实测：取超长（自绘接管）节点，按引擎拖拽的同一条路径把宽度压到
		// 240px，再读节点尺寸与内容元素实测宽度
		const hugeMap = scenarioMaps.hugeline;
		const hugeNode =
			hugeMap && hugeMap.renderer && hugeMap.renderer.root
				? hugeMap.renderer.root.children[0]
				: null;
		if (hugeNode) {
			const regionWidthNow = () => {
				const el = hugeHolder
					? hugeHolder.querySelector('.mindmap-node-inline-content')
					: null;
				return el ? Math.round(el.getBoundingClientRect().width) : null;
			};
			const regionDiagnostics = () => {
				const els = hugeHolder
					? [
							...hugeHolder.querySelectorAll(
								'.mindmap-node-inline-content',
							),
						]
					: [];
				return {
					count: els.length,
					styleWidths: els.map((el) => el.style.width || null).slice(0, 4),
					rectWidths: els
						.map((el) => Math.round(el.getBoundingClientRect().width))
						.slice(0, 4),
				};
			};
			const beforeWidth = Math.round(hugeNode.width);
			const beforeHeight = Math.round(hugeNode.height);
			// ① 拖拽帧：引擎写活值后调 reRender([], { ignoreUpdateCustomTextWidth: true })
			// ——**不重建**自绘内容（keys 为空 ⇒ h.custom 为假），故此处只验证「宽度跟上」
			hugeNode.customTextWidth = 240;
			if (typeof hugeNode.reRender === 'function') {
				hugeNode.reRender([], { ignoreUpdateCustomTextWidth: true });
			}
			const dragWidth = Math.round(hugeNode.width);
			const dragRegionWidth = regionWidthNow();
			// ② 松手：setData({ customTextWidth }) + 全量 render —— 内容重建，
			// 自绘元素按新宽度渲染后**高度必须跟着变**（用户实测缺陷的判定点）
			if (typeof hugeNode.setData === 'function') {
				hugeNode.setData({ customTextWidth: 240 });
			}
			// 走**生产入口**（engine/mindmap.refreshNodeCustomContent）：自定义内容只在
			// keys 含 'custom' 时重建（createNodeData：h.custom ⇒ 重新调用
			// customCreateNodeContent）；整树 render / needLayout 都不会重建（实测
			// style.width 仍为 null），故插件侧在拖宽结束事件里显式补这一下
			refreshNodeCustomContent(hugeMap, hugeNode);
			const diagnostics = regionDiagnostics();
			widthDrag = {
				beforeWidth,
				beforeHeight,
				dragWidth,
				dragRegionWidth,
				afterWidth: Math.round(hugeNode.width),
				afterHeight: Math.round(hugeNode.height),
				regionWidth: regionWidthNow(),
				requestedWidth: 240,
				nodeCustomTextWidth: hugeNode.customTextWidth ?? null,
				...diagnostics,
			};
		}
		inlineProbe.textContent = JSON.stringify({
			anchorCount: holder
				? holder.querySelectorAll(
						'foreignObject a.internal-link, foreignObject a.external-link',
					).length
				: -1,
			internalHref: anchor ? anchor.getAttribute('data-href') : null,
			externalHref: external ? external.getAttribute('href') : null,
			inForeignObject: insideForeignObject(region),
			// 轻标记：**重点** 必须渲染成 <strong> 且标记符不进显示文本
			markupCount: holder
				? holder.querySelectorAll('foreignObject strong').length
				: -1,
			markupText: holder
				? (holder.querySelector('foreignObject strong')?.textContent ?? null)
				: null,
			regionWidth: region ? Math.round(region.getBoundingClientRect().width) : null,
			childWidth: child ? Math.round(child.width) : null,
			childHeight: child ? Math.round(child.height) : null,
			// 仅轻标记（无链接）：同样必须被接管——混合字形单串 SVG 文本做不到
			markupOnlyForeign: markupHolder
				? insideForeignObject(
						markupHolder.querySelector('.mindmap-node-inline-content'),
					)
				: null,
			markupOnlyStrong: markupHolder
				? markupHolder.querySelectorAll('foreignObject strong').length
				: -1,
			markupOnlyCode: markupHolder
				? markupHolder.querySelectorAll('foreignObject code').length
				: -1,
			markupOnlyAnchors: markupHolder
				? markupHolder.querySelectorAll('foreignObject a').length
				: -1,
			// 轻标记扩展（2026-09-15，对齐官方 Basic formatting syntax）：
			// ==高亮== → mark、__粗__ → strong、\*转义\* 消费反斜杠、
			// %%注释%% 整段不进显示、未解析链接 → is-unresolved 弱化形态
			syntaxInForeignObject: syntaxHolder
				? insideForeignObject(
						syntaxHolder.querySelector('.mindmap-node-inline-content'),
					)
				: null,
			syntaxMarkCount: syntaxHolder
				? syntaxHolder.querySelectorAll('foreignObject mark').length
				: -1,
			syntaxStrongCount: syntaxHolder
				? syntaxHolder.querySelectorAll('foreignObject strong').length
				: -1,
			syntaxText,
			syntaxUnresolved: syntaxHolder
				? syntaxHolder.querySelectorAll(
						'foreignObject a.internal-link.is-unresolved',
					).length
				: -1,
			// 对照组：inline 场景里的 [[笔记A]] 视为已解析 → 不得带未解析标记
			inlineResolvedAnchors: holder
				? holder.querySelectorAll(
						'foreignObject a.internal-link:not(.is-unresolved)',
					).length
				: -1,
			// 超长单行：接管 + 截断展示（尾部 … + data-truncated + title 提示）
			hugeInForeignObject: hugeHolder ? insideForeignObject(hugeRegion) : null,
			hugeDisplayLen: hugeRegion
				? (hugeRegion.textContent ?? '').length
				: -1,
			hugeTruncated: hugeRegion
				? hugeRegion.getAttribute('data-truncated')
				: null,
			hugeTitleLen: hugeRegion
				? (hugeRegion.getAttribute('title') ?? '').length
				: -1,
			hugeEllipsis: hugeRegion
				? (hugeRegion.textContent ?? '').endsWith('…')
				: null,
			// 段落（多行）节点：行内链接同样接管（README 对外承诺，需实测锁定）
			paragraphInForeignObject: paragraphHolder
				? insideForeignObject(
						paragraphHolder.querySelector('.mindmap-node-inline-content'),
					)
				: null,
			paragraphAnchors: paragraphHolder
				? paragraphHolder.querySelectorAll(
						'foreignObject a.internal-link, foreignObject a.external-link',
					).length
				: -1,
			paragraphLines: paragraphHolder
				? (
						paragraphHolder.querySelector('.mindmap-node-inline-content')
							?.textContent ?? ''
					).split('\\n').length
				: -1,
			// 对照：纯文本节点未被接管（自绘锚点数为 0）
			plainAnchors: plainHolder
				? plainHolder.querySelectorAll(
						'foreignObject a.internal-link, foreignObject a.external-link',
					).length
				: -1,
			// —— 节点宽度拖拽（引擎 customTextWidth）→ 自绘内容必须跟随换行 ——
			// 引擎对 isUseCustomNodeContent 节点启用左右边框的 ew-resize 手柄
			// （checkEnableDragModifyNodeWidth）：拖拽中写 node.customTextWidth 后调
			// node.reRender([], { ignoreUpdateCustomTextWidth: true })，宽度**由自绘内容
			// 自己落到元素上**（引擎自己的富文本节点同款写法）。自绘内容不响应就表现为
			// 「拖了宽、节点高度不跟着变」（2026-09-16 用户实测）。此处走引擎同一路径实测。
			widthDrag,
			click,
		});
	} catch (error) {
		inlineProbe.textContent = JSON.stringify({ error: String(error) });
	}
}, 400);

// —— 撤销探针：插入 → BACK 的还原度与节点实例同一性 ——
// 两条契约：
// ① 撤销必须**精确还原**（DOM 节点数回到插入前、树上被撤销的节点消失）——用户报过的
//    「Ctrl+Z 失效」那类缺陷的守卫；
// ② 撤销**不替换节点实例**（引擎复用 Node 对象）——view-drag-duplicate 的 Alt 拖拽
//    复制依赖它：BACK 之后仍用拖拽前捕获的父节点引用插入副本。
const identityProbe = document.createElement('pre');
identityProbe.id = 'undo-probe';
document.body.appendChild(identityProbe);
window.setTimeout(() => {
	const report = {};
	try {
		const idMap = scenarioMaps.plain;
		const root0 = idMap && idMap.renderer ? idMap.renderer.root : null;
		const child0 = root0 && root0.children ? root0.children[0] : null;
		report.hasMap = !!idMap;
		report.hasChild = !!child0;
		if (child0) {
			const holderEl = document.getElementById('map-plain');
			const domNodes = () =>
				holderEl ? holderEl.querySelectorAll('g.smm-node').length : -1;
			const uid = child0.getData('uid');
			report.domNodesBefore = domNodes();
			// 引擎签名：INSERT_CHILD_NODE(openEdit=false, appointNodes=[父], appointData)
			idMap.execCommand('INSERT_CHILD_NODE', false, [child0], {
				text: 'tmp',
			});
			// 引擎渲染是异步的（render 走 rAF/定时器）：必须等渲染落定再读身份与 DOM
			window.setTimeout(() => {
				report.domNodesAfterInsert = domNodes();
				report.childSameAfterInsert =
					idMap.renderer.findNodeByUid(uid) === child0;
				idMap.execCommand('BACK');
				window.setTimeout(() => {
					report.domNodesAfterBack = domNodes();
					report.rootSameAfterBack = idMap.renderer.root === root0;
					report.childSameAfterBack =
						idMap.renderer.findNodeByUid(uid) === child0;
					report.treeChildrenAfterBack = child0.children
						? child0.children.length
						: -1;
					identityProbe.textContent = JSON.stringify(report);
				}, 250);
			}, 250);
			return;
		}
	} catch (error) {
		report.error = String(error);
	}
	identityProbe.textContent = JSON.stringify(report);
}, 500);

// —— 宽度手柄探针：手柄只应出现在「拖动真正生效」的自绘节点上 ——
// 引擎的 checkEnableDragModifyNodeWidth() 只看全局开关（本插件恒开），于是
// 纯文本 / 含图节点上也会出现左右边框手柄，而引擎的 SVG 文本路径不认
// customTextWidth（拖了毫无反应＝死手柄，用户实测 2026-09-16）。插件侧给该判定
// 加了「且会被自绘接管」这一层（features/view-node-width.gateNodeWidthHandles）。
// 手柄是激活时懒创建的无类名透明 rect（inline cursor: ew-resize），故按此计数。
const handleProbe = document.createElement('pre');
handleProbe.id = 'handle-probe';
document.body.appendChild(handleProbe);
window.setTimeout(() => {
	const report = {};
	const ewResizeCount = (holderId) => {
		const holder = document.getElementById(holderId);
		if (!holder) return -1;
		return [...holder.querySelectorAll('rect')].filter((el) =>
			(el.getAttribute('style') || '').includes('ew-resize'),
		).length;
	};
	try {
		const plainNode =
			scenarioMaps.plain && scenarioMaps.plain.renderer.root
				? scenarioMaps.plain.renderer.root.children[0]
				: null;
		const richNode =
			scenarioMaps.inline && scenarioMaps.inline.renderer.root
				? scenarioMaps.inline.renderer.root.children[0]
				: null;
		if (plainNode && typeof plainNode.active === 'function') plainNode.active();
		if (richNode && typeof richNode.active === 'function') richNode.active();
		report.plainHandles = ewResizeCount('map-plain');
		report.richHandles = ewResizeCount('map-inline');
		// 引擎内部诊断：门禁后手柄节点根本没被创建
		report.plainHasHandleNodes = Array.isArray(plainNode && plainNode._dragHandleNodes);
		report.richHasHandleNodes = Array.isArray(richNode && richNode._dragHandleNodes);
		// 判据自身的取值（断言用的前置事实：纯文本 false / 自绘 true）
		report.wantedPlain = plainNode ? shouldSelfDrawNode(plainNode) : null;
		report.wantedRich = richNode ? shouldSelfDrawNode(richNode) : null;
	} catch (error) {
		report.error = String(error);
	}
	handleProbe.textContent = JSON.stringify(report);
}, 900);

// —— DOM 规模探针：同形状地图下「引擎文本节点」vs「自绘节点」的 DOM 元素预算 ——
// 为什么需要：自绘（方案 B）是结构性开销（每节点固定几个元素，乘节点数即整页的
// 样式/布局规模），单测看不见 DOM。目的**不是**证明自绘更贵——2026-09-16 实测反而
// 更轻（自绘 7.3 元素/节点 vs 引擎文本 8.2：接管后引擎跳过全部默认内容），真正
// 成本在引擎对自绘内容的**离屏测宽**与内容重建；此探针只防「渲染路径悄悄加元素」。
//
// ⚠️ 本探针**不测耗时**：CI 用 --virtual-time-budget 跑，performance.now() 被虚拟化，
// 耗时断言无意义；引擎的内容重建又走内部批处理，计数式测量也读不到（实测恒为 0），
// 故只用与时钟无关的**结构规模**。
const perfProbe = document.createElement('pre');
perfProbe.id = 'perf-probe';
perfProbe.textContent = 'PENDING';
document.body.appendChild(perfProbe);
window.setTimeout(() => {
	const report = {};
	try {
		const makeHolder = (id, w, h) => {
			const div = document.createElement('div');
			div.id = id;
			div.className = 'mindmap-canvas-container';
			div.style.width = w + 'px';
			div.style.height = h + 'px';
			document.body.appendChild(div);
			return div;
		};
		const N = 30;
		const plainChildren = [];
		const linkChildren = [];
		for (let i = 0; i < N; i++) {
			plainChildren.push({
				data: {
					uid: 'p-' + i,
					text: '第 ' + i + ' 条普通的说明文本内容',
					mdType: 'plain',
					mdRaw: '第 ' + i + ' 条普通的说明文本内容',
					mdDerivedText: '第 ' + i + ' 条普通的说明文本内容',
				},
				children: [],
			});
			// 纯单链接节点：自绘接管（hasRichSegments 命中）。
			// text === mdDerivedText ⇒ 视为「未编辑」，渲染源取 mdRaw（含链接语法）
			linkChildren.push({
				data: {
					uid: 'l-' + i,
					text: '关于 笔记' + i + ' 的说明',
					mdType: 'plain',
					mdRaw: '关于 [[笔记' + i + ']] 的说明',
					mdDerivedText: '关于 笔记' + i + ' 的说明',
					mdWikiLinkpath: '[[笔记' + i + ']]',
					mdLinkStyle: 'wiki',
					mdLinkText: '笔记' + i + '',
				},
				children: [],
			});
		}
		const plainHolder = makeHolder('perf-plain', 1200, 400);
		const linkHolder = makeHolder('perf-link', 1200, 400);
		// 构建器调用计数（决定「每帧重建」是否成立的前提测量）：
		// 包一层 options.createNodeContent，测 idle render 与「改文本」render 各调几次。
		// 构建器计数器**只装在本探针两张图的 options 浅拷贝上**——不修改共享
		// options：同页其他图的渲染（如 count 探针 151 节点图的首帧）同样会调用
		// createNodeContent，装共享对象会把它们的调用记进本探针的空 render 窗口
		// （实测「空 render 仍调用构建器 151」＝被邻图首帧污染；2026-09-21）。
		let builderCalls = 0;
		const origBuilder = options.createNodeContent;
		const countedBuilder = (node, doc, style, lang) => {
			builderCalls++;
			return origBuilder(node, doc, style, lang);
		};
		const perfOptions = { ...options, createNodeContent: countedBuilder };
		const plainMap = createMindMap(
			plainHolder,
			{ data: { text: 'root-p', uid: 'root-p' }, children: plainChildren },
			perfOptions,
		);
		const linkMap = createMindMap(
			linkHolder,
			{ data: { text: 'root-l', uid: 'root-l' }, children: linkChildren },
			perfOptions,
		);

		// 一次大图用于 countTreeNodes（数据树 1000 节点）
		let big = { data: { text: 'b' }, children: [] };
		for (let i = 0; i < 999; i++) {
			big = { data: { text: 'b' + i }, children: [big] };
		}

		// 两张图各自等首帧落地后再进入测量链（事件 + 轮询；此前固定 200ms 起链，
		// 负载机上首帧未落完就开始计数与结构性断言——2026-09-21 复查加固）
		const startMeasureChain = () => {
			// 首帧 settle 后才测量：引擎 render() 会经 rAF 调度，**同步读计数恒为 0**
			// （那是异步假象，不是「没发生」）。每个阶段等 60ms 再读累计计数。
			const measureAfter = (ms, record) =>
				window.setTimeout(() => {
					try {
						record();
					} catch (error) {
						report.error = String(error);
					}
				}, ms);
			const finishReport = () => {
				report.nodesPerMap = N + 1;
				// 结构规模：每节点平均 DOM 元素数（自绘节点 = foreignObject + HTML 内容子树）
				report.plainDomEls = plainHolder.querySelectorAll('*').length;
				report.linkDomEls = linkHolder.querySelectorAll('*').length;
				// 自绘通道确实生效的 DOM 证据（每个自绘节点一个 foreignObject）
				report.linkForeignObjects =
					linkHolder.querySelectorAll('foreignObject').length;
				report.plainForeignObjects =
					plainHolder.querySelectorAll('foreignObject').length;
				// countTreeNodes 的遍历规模（渲染树与数据树同构；这里额外验证数据树也可用）
				report.plainRenderNodes = countTreeNodes(plainMap.renderer.root);
				report.linkRenderNodes = countTreeNodes(linkMap.renderer.root);
				report.bigTreeNodes = countTreeNodes(big);
				perfProbe.textContent = JSON.stringify(report);
			};
			measureAfter(400, () => {
				report.afterFirstRenderCalls = builderCalls;
				builderCalls = 0;
				plainMap.render();
				measureAfter(60, () => {
					report.idleBuilderCallsPlain = builderCalls;
					builderCalls = 0;
					linkMap.render();
					measureAfter(60, () => {
						report.idleBuilderCallsLink = builderCalls;
						builderCalls = 0;
						const oneLink = linkMap.renderer.root
							? linkMap.renderer.root.children[0]
							: null;
						if (oneLink) {
							const d = oneLink.getData();
							d.text = d.text + ' ';
						}
						linkMap.render();
						measureAfter(60, () => {
							report.editBuilderCallsLink = builderCalls;
							// 共享 options 自始未被修改（计数器装在浅拷贝上），无需恢复
							finishReport();
						});
					});
				});
			});
		};
		let perfReady = 0;
		const perfOnReady = () => {
			perfReady++;
			if (perfReady === 2) {
				startMeasureChain();
			}
		};
		whenMapReady(plainMap, plainHolder, perfOnReady, 80, 1200, true);
		whenMapReady(linkMap, linkHolder, perfOnReady, 80, 1200, true);
		return;
	} catch (error) {
		report.error = String(error);
	}
	perfProbe.textContent = JSON.stringify(report);
}, 200);

// —— 编辑成本探针：一次「改一个节点文本」到底触发多少真实工作（时钟无关计数） ——
// 为什么用计数而非耗时：CI 用 --virtual-time-budget 跑，Date/performance 被虚拟化
// （同 perf / scale 探针口径），耗时断言恒近 0、无意义。可测且有意义的口径：
//   renderEnds   = node_tree_render_end 次数（真正的布局落地次数，一轮 = 一次全树布局）
//   mutations    = MutationObserver 记录数（DOM 变更量 ≈ 重建/重排规模）
//   builderCalls = 自绘构建器调用数（内容重建粒度：整树 or 仅受影响节点）
//   domNodes     = 该图的 DOM 元素总数（结构规模基线）
// 规模取 500（= 默认 performanceThreshold）且**关闭性能模式** ⇒ 全部节点在 DOM，
// 属最坏形态。本轮只记录基线（ⓘ 输出）：阈值待基线稳定后再钉，避免把尚未复核的
// 引擎行为写成假契约。
const editProbe = document.createElement('pre');
editProbe.id = 'edit-probe';
editProbe.textContent = 'PENDING';
document.body.appendChild(editProbe);
window.setTimeout(() => {
	const report = {};
	const EDIT_PROBE_NODES = 500;
	try {
		const holder = document.createElement('div');
		holder.id = 'map-edit-cost';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1400px';
		holder.style.height = '900px';
		document.body.appendChild(holder);

		// 奇偶交替：偶数纯文本、奇数含链接（自绘接管）——两条渲染通道都覆盖
		const children = [];
		for (let i = 0; i < EDIT_PROBE_NODES - 1; i++) {
			const rich = i % 2 === 1;
			children.push({
				data: rich
					? {
							uid: 'e-l-' + i,
							text: '链接 笔记' + i,
							mdType: 'plain',
							mdRaw: '链接 [[笔记' + i + ']]',
							mdDerivedText: '链接 笔记' + i,
							mdWikiLinkpath: '[[笔记' + i + ']]',
							mdLinkStyle: 'wiki',
							mdLinkText: '笔记' + i,
						}
					: {
							uid: 'e-p-' + i,
							text: '普通节点 ' + i,
							mdType: 'plain',
							mdRaw: '普通节点 ' + i,
							mdDerivedText: '普通节点 ' + i,
						},
				children: [],
			});
		}

		let builderCalls = 0;
		const origBuilder = options.createNodeContent;
		// 只统计**本探针地图**的节点（uid 前缀 e-）：options 是共享对象，随后创建的
		// 其它探针地图若在测量窗口内重建内容会把计数带偏（跨探针噪声）
		options.createNodeContent = (node, doc, style, lang) => {
			const uid = String(node.getData().uid);
			if (uid.indexOf('e-') === 0) {
				builderCalls++;
			}
			return origBuilder(node, doc, style, lang);
		};
		const editMap = createMindMap(
			holder,
			{ data: { text: 'root-e', uid: 'root-e' }, children },
			{ ...options, performanceMode: false },
		);

		let renderEnds = 0;
		editMap.on('node_tree_render_end', () => {
			renderEnds++;
		});
		let mutations = 0;
		// 拆分口径（决定「局部重绘」值不值的关键）：childList 的增删 = 真的重建
		// DOM；attributes / characterData = 就地更新（位置重排、文本替换）——
		// 后者是布局固有可能发生的工作，前者才是「整树重建」的证据。
		// 属性再按「值是否真的变了」二拆：同值空写属于可省开销（局部重绘/脏值
		// 比对能省），真变化则属布局固有（省不掉）。
		let addedNodes = 0;
		let removedNodes = 0;
		let attrMutations = 0;
		let attrRealChanges = 0;
		let attrSameValues = 0;
		let textMutations = 0;
		const observer = new MutationObserver((records) => {
			mutations += records.length;
			for (const record of records) {
				if (record.type === 'childList') {
					addedNodes += record.addedNodes.length;
					removedNodes += record.removedNodes.length;
				} else if (record.type === 'attributes') {
					attrMutations++;
					let now = null;
					try {
						now = record.target.getAttribute(record.attributeName);
					} catch (readError) {
						now = null;
					}
					if (now === record.oldValue) {
						attrSameValues++;
					} else {
						attrRealChanges++;
					}
				} else if (record.type === 'characterData') {
					textMutations++;
				}
			}
		});
		observer.observe(holder, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeOldValue: true,
			characterData: true,
		});

		// 每次测量：归零计数 → 执行动作（空 render 对照 / setNodeText）
		// → 等布局落地后读累计
		const measureEdit = (label, action, next) => {
			renderEnds = 0;
			mutations = 0;
			addedNodes = 0;
			removedNodes = 0;
			attrMutations = 0;
			attrRealChanges = 0;
			attrSameValues = 0;
			textMutations = 0;
			builderCalls = 0;
			try {
				action();
			} catch (error) {
				report[label + 'Error'] = String(error);
			}
			window.setTimeout(() => {
				report[label + 'RenderEnds'] = renderEnds;
				report[label + 'Mutations'] = mutations;
				report[label + 'AddedNodes'] = addedNodes;
				report[label + 'RemovedNodes'] = removedNodes;
				report[label + 'AttrMutations'] = attrMutations;
				report[label + 'AttrRealChanges'] = attrRealChanges;
				report[label + 'AttrSameValues'] = attrSameValues;
				report[label + 'TextMutations'] = textMutations;
				report[label + 'BuilderCalls'] = builderCalls;
				next();
			}, 150);
		};

		window.setTimeout(() => {
			report.nodeCount = countTreeNodes(editMap.renderer.root);
			report.domNodes = holder.querySelectorAll('*').length;
			const nodes = editMap.renderer.root
				? editMap.renderer.root.children
				: [];
			const isRich = (n) => String(n.getData().uid).indexOf('e-l-') === 0;
			const isPlain = (n) => String(n.getData().uid).indexOf('e-p-') === 0;
			const richNode = nodes.find(isRich);
			const plainNode = nodes.find(isPlain);
			if (!richNode) report.richEditMissing = true;
			if (!plainNode) report.plainEditMissing = true;
			// 顺序：对照组（数据不变的空 render）→ 两次真实编辑
			measureEdit('idleRender', () => editMap.render(), () => {
				measureEdit(
					'richEdit',
					() =>
						setNodeText(editMap, richNode, String(richNode.getData().text) + '·'),
					() => {
						measureEdit(
							'plainEdit',
							() =>
								setNodeText(
									editMap,
									plainNode,
									String(plainNode.getData().text) + '·',
								),
							() => {
								observer.disconnect();
								options.createNodeContent = origBuilder;
								editProbe.textContent = JSON.stringify(report);
								// 计数已入 report：摘掉 500 节点地图，避免 DOM dump 体积
								// 翻三倍（CI 传输/解析成本），其余探针不依赖它
								holder.remove();
							},
						);
					},
				);
			});
		}, 500);
	} catch (error) {
		report.error = String(error);
		editProbe.textContent = JSON.stringify(report);
	}
}, 1200);

// —— 图片尺寸回灌探针：首帧后回灌校正结果，引擎必须按新尺寸渲染 ——
// 对应「加载期图片尺寸探测不再挡首帧」的后半程：探测在首帧前起步，结果在引擎
// 就绪后经 applyImageSizeCorrectionsToEngine 写入（对象身份 + image 地址守卫），
// 引擎随即按新尺寸渲染。单测只能验数据写入，**渲染是否真的变了**必须在此证明。
// 图片用 1×1 GIF 的 data URI：无库、无网络，引擎 <image> 直接可加载。
const imageProbe = document.createElement('pre');
imageProbe.id = 'image-probe';
document.body.appendChild(imageProbe);
window.setTimeout(() => {
	const report = {};
	const DATA_URI =
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	const sizeOf = (holder, attr) => {
		const el = holder.querySelector('image');
		return el ? Number(el.getAttribute(attr)) : null;
	};
	try {
		const makeTree = () => ({
			data: { text: 'root-img', uid: 'root-img' },
			children: [
				// 生产同款：解析器只产 image，不产 imageSize（PLAIN_IMAGE_FIELDS 不含它）
				{ data: { uid: 'img-1', text: '', image: DATA_URI }, children: [] },
			],
		});
		const makeHolder = (id) => {
			const h = document.createElement('div');
			h.id = id;
			h.className = 'mindmap-canvas-container';
			h.style.width = '800px';
			h.style.height = '300px';
			document.body.appendChild(h);
			return h;
		};
		// 对照组：不填默认值直接建图（预期渲染链抛错——只记录，不作断言：
		// 引擎将来若自带兜底，这里变 true 也不该挡发布）
		const rawMap = createMindMap(makeHolder('map-image-raw'), makeTree(), options);
		// 主组：与 view.ts 加载路径同款——先同步填默认尺寸，再建图
		const tree = makeTree();
		report.filled = ensureDefaultImageSizes(tree);
		const holder = makeHolder('map-image');
		const map = createMindMap(holder, tree, options);
		// 主组等首帧落地后再读 / 回灌（事件 + 轮询；此前固定 400ms，负载机器上
		// renderer.root 仍为 null——2026-09-21 复查加固，见 whenMapReady）
		whenMapReady(map, holder, () => {
			try {
				report.rawHasRoot = !!rawMap.renderer.root;
				const node = map.renderer.root ? map.renderer.root.children[0] : null;
				const data = node ? node.getData() : null;
				report.beforeWidth = sizeOf(holder, 'width');
				report.beforeHeight = sizeOf(holder, 'height');
				report.applied = data
					? applyImageSizeCorrectionsToEngine(map, [
							{
								data,
								image: DATA_URI,
								width: 120,
								height: 40,
								custom: true,
								autoSize: true,
							},
						])
					: -1;
				// 回灌触发的渲染落地后再读尺寸：轮询到目标宽（或超时）而非固定
				// 200ms——超时仍读实际值，真失败照常由断言报红
				const waitApplied = (deadline) => {
					report.afterWidth = sizeOf(holder, 'width');
					report.afterHeight = sizeOf(holder, 'height');
					if (report.afterWidth === 120 || Date.now() > deadline) {
						report.marked = !!(data && data.mdImageAutoSize === true);
						imageProbe.textContent = JSON.stringify(report);
						return;
					}
					window.setTimeout(() => waitApplied(deadline), 40);
				};
				window.setTimeout(() => waitApplied(Date.now() + 800), 60);
				return;
			} catch (error) {
				report.error = String(error);
			}
			imageProbe.textContent = JSON.stringify(report);
		}, 80, 1200, true);
		return;
	} catch (error) {
		report.error = String(error);
	}
	imageProbe.textContent = JSON.stringify(report);
}, 200);

// —— 节点计数探针：性能模式下渲染树结构必须完整（状态栏计数不得漏计） ——
// 术语澄清（vendor 0.14.0-fix.3 实测）：removeNodeWhenOutCanvas 走 node.removeSelf()
// = this.group.remove()（只摘 DOM 绘制）+ removeGeneralization()；**节点实例仍留在
// parent.children** ⇒ 渲染树结构完整，countTreeNodes 在性能模式下依然准确。
// 若引擎改成把节点摘出 children，本探针先红——否则状态栏会静默漏计。
const countProbe = document.createElement('pre');
countProbe.id = 'count-probe';
document.body.appendChild(countProbe);
window.setTimeout(() => {
	const report = {};
	try {
		// 必然超出视口（容高 400px）的宽扇形树：150 个子节点
		const total = 151;
		const children = [];
		for (let i = 0; i < 150; i++) {
			children.push({
				data: { uid: 'c-' + i, text: '节点 ' + i },
				children: [],
			});
		}
		const holder = document.createElement('div');
		holder.id = 'map-count';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1200px';
		holder.style.height = '400px';
		document.body.appendChild(holder);
		const map = createMindMap(
			holder,
			{ data: { text: 'root-c', uid: 'root-c' }, children },
			{ ...options, performanceMode: true, performanceThreshold: 1 },
		);
		// 等首帧落地后再计数（事件 + 轮询；此前固定 400ms，负载机器上
		// renderer.root 仍为 null → 计数 0——2026-09-21 复查加固）
		whenMapReady(map, holder, () => {
			try {
				report.trueNodes = total;
				report.renderTreeNodes = countTreeNodes(map.renderer.root);
				// DOM 侧的节点 group 数（应少于总数 = 视口外节点已被摘出 DOM）
				report.domNodeGroups = holder.querySelectorAll('.smm-node').length;
			} catch (error) {
				report.error = String(error);
			}
			countProbe.textContent = JSON.stringify(report);
		}, 80, 1200, true);
		return;
	} catch (error) {
		report.error = String(error);
	}
	countProbe.textContent = JSON.stringify(report);
}, 200);

// —— 性能模式运行时切换探针：updateConfig 必须真的开/关虚拟渲染 ——
// 为什么需要：设置面板的性能模式/阈值是**滑块**（唯一高频拖拽项）。引擎若支持
// 运行时切换（updateConfig → after_update_config 重新绑定 view_data_change +
// forceLoadNode），插件就能原地生效而不销毁重建引擎。这条只有真实引擎渲染一遍
// 才能证明：单测只能验证「调了 updateConfig」，证不了「DOM 真的裁剪/恢复」。
// 判据（与 count 探针同源）：151 节点宽扇形图，创建时关闭性能模式 ⇒ DOM 组数 =
// 全部；开启后 ⇒ DOM 组数 < 全部（视口外被摘出）；关闭后 ⇒ 恢复全部。
const perfSwitchProbe = document.createElement('pre');
perfSwitchProbe.id = 'perf-switch-probe';
perfSwitchProbe.textContent = 'PENDING';
document.body.appendChild(perfSwitchProbe);
window.setTimeout(() => {
	const report = {};
	try {
		const total = 151;
		const children = [];
		for (let i = 0; i < total - 1; i++) {
			children.push({
				data: { uid: 's-' + i, text: '节点 ' + i },
				children: [],
			});
		}
		const holder = document.createElement('div');
		holder.id = 'map-perf-switch';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1200px';
		holder.style.height = '400px';
		document.body.appendChild(holder);
		// 创建时**关闭**性能模式（阈值判据不满足）⇒ 全部节点在 DOM
		const map = createMindMap(
			holder,
			{ data: { text: 'root-s', uid: 'root-s' }, children },
			{ ...options, performanceMode: false, performanceThreshold: 1 },
		);
		const domGroups = () => holder.querySelectorAll('.smm-node').length;
		const wait = (ms, next) => window.setTimeout(next, ms);
		wait(400, () => {
			report.trueNodes = total;
			report.renderTreeNodes = countTreeNodes(map.renderer.root);
			report.domBeforeOn = domGroups();

			// ① 运行时开启（走生产路径）
			report.appliedOn = applyPerformanceMode(map, true);
			wait(300, () => {
				report.domAfterOn = domGroups();

				// ② 运行时关闭
				report.appliedOff = applyPerformanceMode(map, false);
				wait(300, () => {
					report.domAfterOff = domGroups();
					perfSwitchProbe.textContent = JSON.stringify(report);
					// 计数已入 report：摘掉大图控 DOM dump 体积（同 edit 探针）
					holder.remove();
				});
			});
		});
		return;
	} catch (error) {
		report.error = String(error);
	}
	perfSwitchProbe.textContent = JSON.stringify(report);
}, 700);

// —— 渲染经济探针：「一次动作 = 一次布局落地（≤1）」——
// 为什么需要：K58 量化了**一次整树渲染**的代价（每节点数条属性写入），插件侧减少
// 浪费的唯一抓手就是不让动作产生多次布局落地（引擎 render() 有 setTimeout(0) 合并
// 窗口 ⇒ 同一任务内的重复入口免费，跨任务才是真多一轮）。本探针逐动作数
// node_tree_render_end，把该契约钉住：谁在跨任务路径上补渲染、或包装函数多写一次
// render，这里立刻红。动作只取 mindmap.ts 的生产入口 + 两个引擎命令（页面侧无
// obsidian，features 层调用点由静态审计覆盖，见 AGENTS.md K61）。
const renderEcoProbe = document.createElement('pre');
renderEcoProbe.id = 'render-eco-probe';
renderEcoProbe.textContent = 'PENDING';
document.body.appendChild(renderEcoProbe);
window.setTimeout(() => {
	const report = {};
	try {
		const holder = document.createElement('div');
		holder.id = 'map-render-eco';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1200px';
		holder.style.height = '600px';
		document.body.appendChild(holder);
		const children = [];
		for (let i = 0; i < 30; i++) {
			const rich = i % 2 === 1;
			children.push({
				data: rich
					? {
							uid: 're-l-' + i,
							text: '链接 笔记' + i,
							mdType: 'plain',
							mdRaw: '链接 [[笔记' + i + ']]',
							mdDerivedText: '链接 笔记' + i,
							mdWikiLinkpath: '[[笔记' + i + ']]',
							mdLinkStyle: 'wiki',
							mdLinkText: '笔记' + i,
						}
					: {
							uid: 're-p-' + i,
							text: '普通节点 ' + i,
							mdType: 'plain',
							mdRaw: '普通节点 ' + i,
							mdDerivedText: '普通节点 ' + i,
						},
				children: [],
			});
		}
		const map = createMindMap(
			holder,
			{ data: { text: 'root-re', uid: 'root-re' }, children },
			{ ...options, performanceMode: false },
		);
		let ends = 0;
		map.on('node_tree_render_end', () => {
			ends++;
		});
		const nodes = () => (map.renderer.root ? map.renderer.root.children : []);
		const pick = (prefix) =>
			nodes().find((n) => String(n.getData().uid).indexOf(prefix) === 0);
		const DATA_URI =
			'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
		// 每次动作前归零，动作后等布局落地再读（引擎 render 经 setTimeout(0)）
		const measure = (label, action, next) => {
			ends = 0;
			try {
				action();
			} catch (error) {
				report[label + 'Error'] = String(error);
			}
			window.setTimeout(() => {
				report[label] = ends;
				next();
			}, 200);
		};
		window.setTimeout(() => {
			measure(
				'setNodeImageSize',
				() => setNodeImageSize(map, pick('re-l-'), 120, 40),
				() =>
					measure(
						'previewNodeImageSize',
						() => previewNodeImageSize(map, pick('re-l-'), 100, 30),
						() =>
							measure(
								'refreshNodeCustomContent',
								() => refreshNodeCustomContent(map, pick('re-l-')),
								() =>
									measure(
										'replaceMindMapData',
										() =>
											replaceMindMapData(map, {
												data: { text: 'root-re2', uid: 'root-re' },
												children: nodes().map((n) => ({
													data: JSON.parse(JSON.stringify(n.getData())),
													children: [],
												})),
											}),
										() =>
											measure(
												'applyPerformanceModeOn',
												() => applyPerformanceMode(map, true),
												() =>
													measure(
														'applyPerformanceModeOff',
														() => applyPerformanceMode(map, false),
														() =>
															measure(
																'commandSetNodeImage',
																() =>
																	map.execCommand('SET_NODE_IMAGE', pick('re-p-'), {
																		url: DATA_URI,
																	}),
																() =>
																	measure(
																		'commandSetNodeHyperlink',
																		() =>
																			map.execCommand(
																				'SET_NODE_HYPERLINK',
																				pick('re-p-'),
																				'https://example.com',
																			),
																		() =>
																			// 对照：只 updateConfig、不显式 render——
																			// 判断 applyPerformanceMode 里那次 render 是否多余
																			// （引擎 after_update_config 会 forceLoadNode）
																			measure(
																				'rawUpdateConfigOn',
																				() =>
																					map.updateConfig({
																						openPerformance: true,
																						performanceConfig: {
																							time: 200,
																							padding: 150,
																							removeNodeWhenOutCanvas: true,
																						},
																					}),
																				() =>
																					measure(
																						'rawUpdateConfigOff',
																						() =>
																							map.updateConfig({
																								openPerformance: false,
																								performanceConfig: {
																									time: 200,
																									padding: 150,
																									removeNodeWhenOutCanvas: true,
																								},
																							}),
																						() => {
																							renderEcoProbe.textContent =
																								JSON.stringify(report);
																							// 计数已入 report：摘掉地图控 DOM dump 体积
																							holder.remove();
																						},
																					),
																			),
																	),
															),
													),
											),
									),
							),
					),
			);
		}, 400);
		return;
	} catch (error) {
		report.error = String(error);
	}
	renderEcoProbe.textContent = JSON.stringify(report);
}, 1500);

// —— 调宽写入通道探针：帧内预览不上历史、不派发 data_change；收尾提交各一次 ——
// 用户实测「图片拖动大小时保存好几次 + 卡顿」的守卫：引擎 Command.exec 对非
// 白名单命令一律 addHistory()（整树 getCopyData + JSON.stringify 比对）并
// emit('data_change') ⇒ 视图层 scheduleSave / 状态栏 / 标题重算都被逐帧触发。
// 故帧内只走 previewNodeImageSize（同款数据写入，不记历史），收尾一次
// setNodeImageSize。
const historyProbe = document.createElement('pre');
historyProbe.id = 'history-probe';
document.body.appendChild(historyProbe);
window.setTimeout(() => {
	const report = {};
	try {
		// 本探针**自建引擎**：其它探针会在各自引擎上产生历史（激活节点也走
		// SET_NODE_DATA），共用实例会把读数搅浑
		const holder = document.createElement('div');
		holder.id = 'map-history';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '600px';
		holder.style.height = '300px';
		document.body.appendChild(holder);
		const map = createMindMap(
			holder,
			{
				data: { text: 'h-root', uid: 'h-root' },
				children: [
					{ data: { text: 'h-child', uid: 'h-child' }, children: [] },
				],
			},
			options,
		);
		let dataChange = 0;
		map.on('data_change', () => {
			dataChange++;
		});
		// 历史写入是**防抖**的（引擎构造函数把 addHistory 包成 100ms 延迟，
		// addHistoryTime 默认 100）→ 读数必须等窗口过去，否则恒为 0
		const AFTER_HISTORY_WINDOW_MS = 320;
		window.setTimeout(() => {
			const node =
				map.renderer && map.renderer.root
					? map.renderer.root.children[0]
					: null;
			// 历史数组会被引擎**整体重建**（addHistory 里 this.history =
			// this.history.slice(...)），必须每次现取，缓存引用会读到旧数组
			const historyLength = () => {
				const cmd = map.command;
				return cmd && Array.isArray(cmd.history) ? cmd.history.length : -1;
			};
			report.hasHistory = historyLength() >= 0;
			report.hasNode = !!node;
			const before = historyLength();
			// data_change 基线取在这里：建图时的初始历史（addHistoryOnInit）已在
			// 上面的等待窗口里落地，不该算进拖动阶段
			const changeBefore = dataChange;
			// ① 拖动中的 6 帧（每帧都超过合并步长）：等窗口后仍必须零增长
			for (let i = 1; i <= 6; i++) {
				previewNodeImageSize(map, node, 40 + i * 8, 40 + i * 8);
			}
			const data = node ? node.getData() : null;
			report.framesWrittenWidth =
				data && data.imageSize ? data.imageSize.width : null;
			window.setTimeout(() => {
				report.framesHistoryDelta = historyLength() - before;
				report.framesDataChange = dataChange - changeBefore;
				// ② 收尾提交一次（应记一条历史、派发一次 data_change）
				setNodeImageSize(map, node, 200, 200);
				window.setTimeout(() => {
					report.commitHistoryDelta = historyLength() - before;
					report.commitDataChange = dataChange - changeBefore;
					historyProbe.textContent = JSON.stringify(report);
				}, AFTER_HISTORY_WINDOW_MS);
			}, AFTER_HISTORY_WINDOW_MS);
		}, 250);
		return;
	} catch (error) {
		report.error = String(error);
	}
	historyProbe.textContent = JSON.stringify(report);
}, 1000);

// —— 导出样式探针：自绘内容的样式必须随导出 SVG 一起带出 ——
// 引擎导出（getSvgData）只注入 joinCss()（引擎自身 CSS）与 header/footer 的
// cssText，**插件 styles.css 不在导出图里生效**；而 foreignObject 的尺寸仍按
// 屏上测宽固定 → 自绘内容一旦依赖类样式，导出 PNG 就会掉排版并溢出/错位。
// 故断言导出 SVG 里自绘根元素 / 锚点 / 轻标记元素都带**内联样式**。
const exportProbe = document.createElement('pre');
exportProbe.id = 'export-probe';
document.body.appendChild(exportProbe);
window.setTimeout(() => {
	try {
		const map = scenarioMaps.inline;
		const data = typeof map.getSvgData === 'function' ? map.getSvgData({}) : null;
		const html = data && typeof data.svgHTML === 'string' ? data.svgHTML : '';
		const styleOf = (pattern) => {
			const tag = pattern.exec(html);
			if (!tag) return null;
			const style = /style="([^"]*)"/.exec(tag[0]);
			return style ? style[1] : '';
		};
		exportProbe.textContent = JSON.stringify({
			hasSvgHtml: html.length > 0,
			regionStyle: styleOf(/<div[^>]*mindmap-node-inline-content[^>]*>/),
			anchorStyle: styleOf(/<a[^>]*internal-link[^>]*>/),
			markupStyle: styleOf(/<strong[^>]*>/),
		});
	} catch (error) {
		exportProbe.textContent = JSON.stringify({ error: String(error) });
	}
}, 500);

// —— 富节点规模探针：自绘节点成规模时仍全部渲染，且不留测量垃圾 ——
// 引擎的离屏测宽元素是**缓存的单个复用元素**（commonCaches.measureCustomNodeContentSizeEl，
// 每次 innerHTML='' 后复用，见 vendor 测宽实现），故「画布容器内只有 1 个测量元素」
// 是**无泄漏不变量**：一旦渲染路径改成每节点新建，节点越多 DOM 越大，这里立刻红。
//
// 本探针**不测耗时**：CI 用 --virtual-time-budget=8000 跑，Date/performance 都被
// 虚拟化（耗时恒近 0），耗时类断言在此环境无意义——性能基线需在真实时钟环境另设。
const scaleProbe = document.createElement('pre');
scaleProbe.id = 'scale-probe';
document.body.appendChild(scaleProbe);
window.setTimeout(() => {
	try {
		const holder = document.createElement('div');
		holder.id = 'map-rich-scale';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1200px';
		holder.style.height = '400px';
		document.body.appendChild(holder);
		// 6 个分支 ×（5 个自绘 + 5 个纯文本）= 30 富节点 / 67 节点（含根与分支）
		const richPerBranch = 5;
		const plainPerBranch = 5;
		const children = [];
		for (let c = 0; c < 6; c++) {
			const grand = [];
			for (let g = 0; g < richPerBranch + plainPerBranch; g++) {
				const rich = g < richPerBranch;
				const line = rich
					? '见 [[笔记' + c + '-' + g + ']] 与 **重点**'
					: '纯文本 ' + c + '-' + g;
				grand.push({
					data: {
						uid: 'scale-' + c + '-' + g,
						// 未编辑同形（mdDerivedText === text）→ 自绘路径读 mdRaw
						text: line,
						mdDerivedText: line,
						mdRaw: line,
					},
					children: [],
				});
			}
			children.push({
				data: { uid: 'scale-branch-' + c, text: '分支 ' + c },
				children: grand,
			});
		}
		const scaleMap = createMindMap(
			holder,
			{ data: { text: '规模', uid: 'scale-root' }, children },
			options,
		);
		// 引擎首帧在 rAF 之后才建节点 DOM → 必须等一拍再读（同步读只会读到空画布）
		window.setTimeout(() => {
			try {
				// 再渲染两轮：验证重复渲染不产生测量垃圾
				scaleMap.render();
				scaleMap.render();
				scaleProbe.textContent = JSON.stringify({
					richExpected: 6 * richPerBranch,
					richRendered: holder.querySelectorAll('foreignObject').length,
					measureEls: holder.querySelectorAll('div[style*="-99999px"]').length,
					totalNodes: holder.querySelectorAll('g.smm-node').length,
					nodeExpected: 1 + 6 + 6 * (richPerBranch + plainPerBranch),
				});
			} catch (error) {
				scaleProbe.textContent = JSON.stringify({ error: String(error) });
			}
		}, 300);
	} catch (error) {
		scaleProbe.textContent = JSON.stringify({ error: String(error) });
	}
}, 600);

// —— 真实墙钟负载块（仅 --perf 注入；本块**不写断言**，读数由 Node 侧按墙钟差计算）——
// 为什么需要：CI 跑在 --virtual-time-budget 下，页内 Date/performance 被虚拟化，
// 页内耗时无意义（见 perf/scale 探针注释）。但虚拟时间只在**空闲**时快速推进——
// 布局与 DOM 写入消耗的是真实 CPU ⇒ 「同页两次调用的墙钟差」≈ 负载的真实成本
// （启动、打包、其余探针在差值里抵消）。口径与 release notes 的「同页 1.1s → 3.9s」
// 同源。负载 = 500 节点图上的 N 次文本编辑（每次恰好一次整树渲染，见 edit /
// render-eco 探针），空跑 = 同页同图但不编辑。
window.setTimeout(() => {
	const NODES = ${PERF_WORKLOAD_NODES};
	const EDITS = ${workloadEdits};
	// 长会话内存采样开关（--perf 注入；默认关，普通校验不付 gc / 采样的代价）
	const MEMORY = ${memoryProbe};
	const loadProbe = document.createElement('pre');
	loadProbe.id = 'perf-load-probe';
	loadProbe.textContent = 'PENDING';
	document.body.appendChild(loadProbe);
	try {
		const holder = document.createElement('div');
		holder.id = 'map-perf-load';
		holder.className = 'mindmap-canvas-container';
		holder.style.width = '1400px';
		holder.style.height = '900px';
		document.body.appendChild(holder);
		// 奇偶交替：偶数纯文本、奇数含链接（自绘接管）——与 edit 探针同形，
		// 让「编辑重建内容」的成本也落在负载里
		const children = [];
		for (let i = 0; i < NODES - 1; i++) {
			const rich = i % 2 === 1;
			children.push({
				data: rich
					? {
							uid: 'pl-l-' + i,
							text: '链接 笔记' + i,
							mdType: 'plain',
							mdRaw: '链接 [[笔记' + i + ']]',
							mdDerivedText: '链接 笔记' + i,
							mdWikiLinkpath: '[[笔记' + i + ']]',
							mdLinkStyle: 'wiki',
							mdLinkText: '笔记' + i,
						}
					: {
							uid: 'pl-p-' + i,
							text: '普通节点 ' + i,
							mdType: 'plain',
							mdRaw: '普通节点 ' + i,
							mdDerivedText: '普通节点 ' + i,
						},
				children: [],
			});
		}
		const map = createMindMap(
			holder,
			{ data: { text: 'root-pl', uid: 'root-pl' }, children },
			{ ...options, performanceMode: false },
		);
		/**
		 * 长会话采样：强制 GC 后读堆 / DOM / 命令历史 / 段缓存。
		 *
		 * 为什么要先 gc：不强制回收的读数是「分配水位」（含尚未回收的垃圾），
		 * 连续编辑后必涨、看不出泄漏；故内存模式给 Chrome 加
		 * --js-flags=--expose-gc（见 chromeArgs）后先回收再采样。
		 * 注意：本块在**模板字符串内**，注释里不得出现反引号。
		 * DOM 侧读三处结构性数字：元素总数、离屏测宽元素（引擎约定为**一个复用
		 * 元素**，>1 即渲染路径在新建）、命令历史条数与上限（大图会被插件下调）。
		 */
		const sample = (label) => {
			if (!MEMORY) return null;
			if (typeof window.gc === 'function') window.gc();
			const mem = window.performance && window.performance.memory;
			const command = map.command;
			const history =
				command && Array.isArray(command.history) ? command.history : null;
			const opt = map.opt || {};
			return {
				label,
				heapBytes: mem ? mem.usedJSHeapSize : null,
				elements: holder.querySelectorAll('*').length,
				measureEls: holder.querySelectorAll('div[style*="-99999px"]').length,
				foreignObjects: holder.querySelectorAll('foreignObject').length,
				// 按标签拆分（增长归属：是节点组、连线路径、文本 span 还是自绘 div）
				gSmmNodes: holder.querySelectorAll('g.smm-node').length,
				allGs: holder.querySelectorAll('g').length,
				paths: holder.querySelectorAll('path').length,
				rects: holder.querySelectorAll('rect').length,
				texts: holder.querySelectorAll('text').length,
				tspans: holder.querySelectorAll('tspan').length,
				divs: holder.querySelectorAll('div').length,
				historyCount: history ? history.length : null,
				// 历史快照是**整树 JSON 字符串**：其字节数直接解释堆增长（见
				// engine/mindmap 的 HISTORY_BUDGET_BYTES / resolveHistoryLimit：
				// 上限按 30MB/视图的预算反推，每条 ≈ 节点数 × 384B）
				historyBytes: history
					? history.reduce((sum, item) => sum + String(item).length, 0)
					: null,
				historyCap:
					typeof opt.maxHistoryCount === 'number'
						? opt.maxHistoryCount
						: null,
				segments: segmentCacheStats(),
			};
		};
		const nodes = () =>
			map.renderer.root ? map.renderer.root.children : [];
		let baseline = null;
		const report = () => {
			loadProbe.textContent = JSON.stringify({
				nodes: NODES,
				edits: EDITS,
				done: true,
				memory: MEMORY
					? {
							baseline,
							after: sample('after'),
							// 上限与预算的事实源是插件自身：页内用插件的函数算一遍，Node 侧
							// 断言「引擎 opt 里确实是这个值」——预算没应用（仍是引擎默认）
							// 或公式两侧漂移即红（K66）
							expectedCap: resolveHistoryLimit(NODES),
							budgetBytes: HISTORY_BUDGET_BYTES,
						}
					: null,
			});
			// 计数已入 probe：摘掉大图控 DOM dump 体积（同 edit / perf-switch 探针）
			holder.remove();
		};
		window.setTimeout(() => {
			baseline = sample('baseline');
			let done = 0;
			const editOnce = () => {
				const list = nodes();
				if (done >= EDITS || list.length === 0) {
					report();
					return;
				}
				const node = list[done % list.length];
				setNodeText(map, node, String(node.getData().text) + '·');
				// 等本次布局落地再下一次：保证「N 次编辑 = N 次整树渲染」；
				// 间隔取 PERF_WORKLOAD_EDIT_GAP_MS（> addHistoryTime 防抖）⇒ 每次
				// 编辑各记一条历史，否则连打会被引擎并成一条（见该常量注释）
				window.setTimeout(() => {
					done++;
					editOnce();
				}, ${PERF_WORKLOAD_EDIT_GAP_MS});
			};
			editOnce();
		}, 400);
	} catch (error) {
		loadProbe.textContent = JSON.stringify({ error: String(error) });
	}
}, ${PERF_WORKLOAD_DELAY_MS});
`;
}

// ---------------------------------------------------------------------------
// 真实墙钟模式（`--perf`）的负载参数
// ---------------------------------------------------------------------------
/** 负载图规模（= 默认 performanceThreshold，非性能模式 ⇒ 全部节点在 DOM，最坏形态） */
const PERF_WORKLOAD_NODES = 500;
/**
 * 默认编辑次数（每次 = 一次整树渲染 + 一条历史快照）。
 *
 * 取 300 有两个理由：① 墙钟读数要明显高于运行间噪声；② （K66 起）500 节点图的
 * 历史上限为 163 条 ⇒ 必须**编辑数 > 上限**才能让「满仓并逐条裁剪」这个稳态
 * 出现，内存轮的三条预算断言（上限应用 / 精确裁剪 / 快照堆 ≤ 预算）才非空转。
 */
const PERF_WORKLOAD_EDITS_DEFAULT = 300;
/**
 * 负载块启动延迟：必须晚于其余探针（最后一个在 ~2400ms 虚拟时间）跑完，
 * 否则会与它们的测量窗口互相污染；同时须保证该块在虚拟时间预算
 * （`--virtual-time-budget=8000`）内完成——虚拟时间只在空闲时推进，
 * 负载的**真实** CPU 时间不计入预算，故 30 次编辑只需几十毫秒虚拟时间。
 */
const PERF_WORKLOAD_DELAY_MS = 3400;
/**
 * 负载编辑的间隔（虚拟时间）。必须大于引擎 `addHistoryTime`（默认 **100ms** 防抖）：
 * 引擎把 `addHistory` 包在防抖里，间隔为 0 时虚拟时钟下 100 次连打会被并成**一条**
 * 历史（实测「编辑后：历史 1」），命令历史 / 内存增长的读数就失去意义。
 * 虚拟等待不计真实耗时（虚拟时间只在空闲时瞬时推进），故间隔不污染墙钟基线；
 * 代价是虚拟时间预算要随编辑数放大——见 measureRealClockWorkload 的 budgetMs。
 */
const PERF_WORKLOAD_EDIT_GAP_MS = 150;

/** 生成承载页：加载仓库真实 styles.css（CSS 级联回归是本脚本的验证目标之一） */
function buildPageSource({ bundleFile = 'bundle.js' } = {}) {
	const cssUrl = new URL(
		`file:///${join(ROOT, 'styles.css').replaceAll('\\', '/')}`,
	).href;
	return `<!doctype html>
<html lang="zh">
	<head>
		<meta charset="utf-8" />
		<title>mindmap visual verify</title>
		<link rel="stylesheet" href="${cssUrl}" />
	</head>
	<body>
		<script src="${bundleFile}"></script>
	</body>
</html>
`;
}

/**
 * 诊断日志收集器：把控制台输出镜像到 `--log-dir`，并落盘源文件与 DOM。
 *
 * 存在的理由：本步骤上次接入 CI 时在 ubuntu-latest 上「场景检查后无输出退出」，
 * 而当时没有 Actions 日志读取权限，无法定位、只能回退。现在把可复现失败所需的
 * 一切（环境、执行的 Chrome 命令、每次尝试的退出码与 stderr 尾部、完整 dump-dom、
 * 逐场景片段）全部写进文件并归档，失败才有据可查。
 */
function createDiagnostics(logDir, chromePath) {
	const lines = [];
	return {
		log(line = '') {
			console.log(line);
			lines.push(line);
		},
		async flush(extra = {}) {
			if (!logDir) return;
			const write = (name, content) =>
				writeFile(join(logDir, name), content, 'utf8');
			const header = [
				`time: ${new Date().toISOString()}`,
				`node: ${process.version}`,
				`platform: ${process.platform} ${process.arch}`,
				`chrome: ${chromePath ?? '(not found)'}`,
				`argv: ${ARGV.join(' ') || '(none)'}`,
				`cwd: ${process.cwd()}`,
				`root: ${ROOT}`,
			];
			for (const [key, value] of Object.entries(extra)) {
				header.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
			}
			await write('00-environment.txt', `${header.join('\n')}\n`);
			await write('01-report.txt', `${lines.join('\n')}\n`);
		},
		file(name, content) {
			if (!logDir) return Promise.resolve();
			return writeFile(join(logDir, name), content, 'utf8');
		},
	};
}

/**
 * 单次 Chrome 调用的参数（`--dump-dom` 之外的部分）。
 *
 * `memoryProbe`（长会话内存轮）额外开两项：① `--js-flags=--expose-gc` 让页内能
 * **显式回收**——不回收的堆读数是「分配水位」，连续编辑后必涨、看不出泄漏；
 * ② `--enable-precise-memory-info` 关掉 Chrome 对 `usedJSHeapSize` 的粗量化。
 */
function chromeArgs(profileDir, { memoryProbe = false, budgetMs = 8000 } = {}) {
	const args = [
		'--disable-gpu',
		'--no-sandbox',
		'--disable-dev-shm-usage',
		'--disable-extensions',
		'--hide-scrollbars',
		'--allow-file-access-from-files',
		'--force-device-scale-factor=1',
		'--window-size=1400,900',
		`--virtual-time-budget=${budgetMs}`,
		`--user-data-dir=${profileDir}`,
	];
	if (memoryProbe) {
		args.push('--js-flags=--expose-gc', '--enable-precise-memory-info');
	}
	return args;
}

/**
 * 用无头 Chrome 渲染并取回序列化 DOM。
 *
 * 依次尝试 `--headless=old` / `--headless=new`（老版本 Chrome 不支持 new），
 * 每个模式再重试一次——无头渲染在 CI 上有偶发空白输出的历史。
 * 每次尝试的退出码与 stderr 尾部都会进诊断日志。
 */
async function dumpDom(chromePath, pagePath, profileDir, diag, { memoryProbe = false, budgetMs = 8000 } = {}) {
	const args = chromeArgs(profileDir, { memoryProbe, budgetMs });
	const attempts = [];
	let lastError = null;

	for (const mode of ['--headless=old', '--headless=new']) {
		for (let round = 1; round <= 2; round++) {
			const label = `${mode} 第 ${round} 次`;
			try {
				const { stdout, stderr } = await execFileAsync(
					chromePath,
					[mode, ...args, '--dump-dom', pagePath],
					{ maxBuffer: 96 * 1024 * 1024, windowsHide: true },
				);
				if (stdout.includes('id="map-')) {
					attempts.push(`${label}: ok（DOM ${stdout.length} 字节）`);
					diag.log(`    · Chrome ${label} 成功（DOM ${stdout.length} 字节）`);
					diag.file('05-chrome-stderr.txt', String(stderr ?? ''));
					return stdout;
				}
				attempts.push(`${label}: 输出不含导图 DOM（${stdout.length} 字节）`);
				lastError = new Error(
					`Chrome ${mode} 输出不含导图 DOM（长度 ${stdout.length}）`,
				);
			} catch (error) {
				const stderrTail = String(error?.stderr ?? '').slice(-2000);
				attempts.push(
					`${label}: 退出码 ${error?.code ?? '?'}；stderr 尾部：${stderrTail || '(空)'}`,
				);
				lastError = error;
			}
			diag.log(`    · Chrome ${label} 未取到 DOM`);
		}
	}
	const detail = attempts.map((line) => `  - ${line}`).join('\n');
	throw new Error(`Chrome 渲染失败（已尝试 ${attempts.length} 次）：\n${detail}`);
}

/** 切出某个场景容器的 DOM 片段（容器按脚本内顺序追加，取到下一个容器为止） */
function containerOf(dom, name) {
	const marker = `id="map-${name}"`;
	const start = dom.indexOf(marker);
	if (start === -1) return null;
	const next = dom.indexOf('id="map-', start + marker.length);
	return dom.slice(start, next === -1 ? dom.length : next);
}

/** 从容器片段中提取待断言指标 */
function measure(fragment) {
	const widths = [...fragment.matchAll(/data-width="(\d+)"/g)].map((m) =>
		Number(m[1]),
	);
	const docIconTag =
		fragment.match(/<svg[^>]*mindmap-wiki-doc-icon[^>]*>/)?.[0] ?? null;
	// 引擎回形针：`<svg cursor="pointer">` 且带 <title>（标题即附件名）
	const attachTitle =
		fragment.match(/<svg cursor="pointer"[^>]*><title>([^<]*)<\/title>/)?.[1] ?? null;
	// 容器首个 svg 即引擎画布（尺寸须铺满容器，否则布局/命中全部失效）
	const canvas = fragment.match(/<svg[^>]*\swidth="(\d+)"\s+height="(\d+)"/);
	return {
		// 节点 group 的 class 可能被追加状态类（如 inline 探针点击后的 `active`）；
		// 排除 smm-node-container / smm-node-shape（后随 `-`，不匹配分隔符）
		nodeCount: [...fragment.matchAll(/class="smm-node(?:\s[^"]*)?"/g)].length,
		/** 子节点文本宽度：容器内最后一个 data-width（根节点在前） */
		childWidth: widths.at(-1) ?? null,
		widths,
		canvasWidth: canvas ? Number(canvas[1]) : null,
		canvasHeight: canvas ? Number(canvas[2]) : null,
		docIcon: docIconTag ? 1 : 0,
		docIconTag,
		linkIcon: [...fragment.matchAll(/target="_blank"/g)].length,
		attachIcon: [...fragment.matchAll(/<svg cursor="pointer"/g)].length,
		attachTitle,
	};
}

/** 单场景断言：返回失败原因数组（空数组 = 通过） */
function checkScenario(scenario, fragment) {
	const failures = [];
	if (!fragment) return [`容器 #map-${scenario.name} 未渲染`];
	const m = measure(fragment);
	const { expect } = scenario;

	if (m.nodeCount !== 2) {
		failures.push(`节点数 ${m.nodeCount} ≠ 2（根 + 子节点）`);
	}
	// 画布须铺满容器（styles.css 的 .mindmap-canvas-container 尺寸链断裂时
	// 引擎会以 0 或错误尺寸布局，节点位置/命中全部失效）
	if (m.canvasWidth !== 1200 || m.canvasHeight !== 400) {
		failures.push(
			`画布尺寸 ${m.canvasWidth}×${m.canvasHeight} ≠ 1200×400（未铺满容器）`,
		);
	}
	if (m.docIcon !== expect.docIcon) {
		failures.push(`自绘文档图标 ${m.docIcon} ≠ ${expect.docIcon}`);
	}
	if (expect.docIcon === 1) {
		// 图标必须是带尺寸的 <svg> 根（历史上裸 <g> 在 foreignObject 里 0×0 不可见）
		const tag = m.docIconTag ?? '';
		if (!/width="18"/.test(tag) || !/height="18"/.test(tag)) {
			failures.push(`文档图标缺尺寸（应为 18×18）：${tag}`);
		}
	}
	if (m.linkIcon !== expect.linkIcon) {
		failures.push(`引擎链接图标 ${m.linkIcon} ≠ ${expect.linkIcon}`);
	}
	if (m.attachIcon !== expect.attachIcon) {
		failures.push(`引擎回形针 ${m.attachIcon} ≠ ${expect.attachIcon}`);
	}
	if (expect.attachTitle !== undefined && m.attachTitle !== expect.attachTitle) {
		failures.push(
			`回形针标题 ${JSON.stringify(m.attachTitle)} ≠ ${JSON.stringify(expect.attachTitle)}`,
		);
	}
	if (expect.widthBelow !== undefined) {
		if (m.childWidth === null || m.childWidth >= expect.widthBelow) {
			failures.push(
				`子节点测宽 ${m.childWidth} 未 < ${expect.widthBelow}（短文本被拉平到容器宽？）`,
			);
		}
	}
	if (expect.widthAtLeast !== undefined) {
		if (m.childWidth === null || m.childWidth < expect.widthAtLeast) {
			failures.push(
				`长文本子节点测宽 ${m.childWidth} 未 ≥ ${expect.widthAtLeast}（换行/封顶失效？）`,
			);
		}
	}
	return failures;
}

/** 取回探针 `<pre>` 的文本（dump-dom 会转义引号与 &） */
function probeText(dom, id) {
	return dom
		.match(new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`))?.[1]
		?.replaceAll('&quot;', '"')
		.replaceAll('&amp;', '&');
}

/** 解析探针 JSON：返回 `{ probe }` 或 `{ failures }` */
function readProbe(dom, id, label) {
	const raw = probeText(dom, id);
	if (!raw) return { failures: [`未找到${label}探针（入口脚本未执行？）`] };
	let probe;
	try {
		probe = JSON.parse(raw);
	} catch {
		return { failures: [`${label}探针 JSON 解析失败：${raw.slice(0, 200)}`] };
	}
	if (typeof probe.error === 'string') {
		return { failures: [`入口脚本异常（${label}）：${probe.error}`] };
	}
	return { probe };
}

/**
 * 校验默认视口探针（由入口脚本写入 `#viewport-probe`，见 buildEntrySource）：
 * 打开导图时应为 100% 缩放，且渲染内容包围盒中心落在画布中心附近。
 */
function checkViewport(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'viewport-probe',
		'视口',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.scale !== 1) {
		failures.push(`缩放 ${probe.scale} ≠ 1（应为 100%）`);
	}
	const [centerX, centerY] = probe.contentCenter ?? [];
	const [width, height] = probe.canvas ?? [];
	if (
		typeof centerX !== 'number' ||
		typeof centerY !== 'number' ||
		typeof width !== 'number' ||
		typeof height !== 'number'
	) {
		failures.push('视口探针字段缺失');
	} else if (
		Math.abs(centerX - width / 2) > 2 ||
		Math.abs(centerY - height / 2) > 2
	) {
		failures.push(
			`内容包围盒中心 (${centerX},${centerY}) 未居中于画布 (${width},${height})`,
		);
	}
	// 重置缩放：回到 100% 且画布中心处的内容不漂移（≤1px）
	if (probe.resetScale !== 1) {
		failures.push(`重置缩放后比例 ${probe.resetScale} ≠ 1`);
	}
	if (typeof probe.resetDrift !== 'number' || probe.resetDrift > 1) {
		failures.push(
			`重置缩放漂移 ${probe.resetDrift}px > 1px（应锁定屏幕可见内容）`,
		);
	}
	return failures;
}

/**
 * 校验大图性能模式探针（`#perf-box-probe`，见 buildEntrySource）：
 * ① 居中不装配全量 DOM——`centerContentAtFullScale` 前后 `.smm-node` 数均 ≪ 总数
 *    （修复「打开大图卡顿」的核心契约：性能模式走数据层包围盒，不 forceLoadNode）；
 * ② 内容中心落在画布中心（数据层盒 + transform 的居中算式正确）；
 * ③ 数据层盒与 DOM 全量盒尺寸口径一致（容差 8px，含 SVG 描边/形状差异）。
 */
function checkPerfBox(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'perf-box-probe',
		'大图包围盒',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.total !== 121) {
		failures.push(`大图节点数 ${probe.total} ≠ 121（探针结构退化）`);
	}
	if (!(probe.firstFrameDom > 0) || !(probe.firstFrameDom < probe.total * 0.5)) {
		failures.push(
			`首帧 DOM ${probe.firstFrameDom}/${probe.total}：性能模式裁剪未生效或探针退化`,
		);
	}
	if (!(probe.afterCenterDom < probe.total * 0.5)) {
		failures.push(
			`居中后 DOM ${probe.afterCenterDom}/${probe.total}：centerContentAtFullScale 装配了全量节点（应走数据层盒）`,
		);
	}
	const [cx, cy] = probe.contentCenter ?? [];
	const [wx, wy] = probe.canvasCenter ?? [];
	if (
		typeof cx !== 'number' ||
		typeof cy !== 'number' ||
		typeof wx !== 'number' ||
		typeof wy !== 'number' ||
		Math.abs(cx - wx) > 2 ||
		Math.abs(cy - wy) > 2
	) {
		failures.push(`内容中心 (${cx},${cy}) 未居中于画布中心 (${wx},${wy})`);
	}
	const dataWidth = probe.dataBox?.width;
	const dataHeight = probe.dataBox?.height;
	const domWidth = probe.domBox?.width;
	const domHeight = probe.domBox?.height;
	if (
		typeof dataWidth !== 'number' ||
		typeof dataHeight !== 'number' ||
		typeof domWidth !== 'number' ||
		typeof domHeight !== 'number' ||
		Math.abs(dataWidth - domWidth) > 8 ||
		Math.abs(dataHeight - domHeight) > 8
	) {
		failures.push(
			`数据层盒 ${dataWidth}×${dataHeight} 与 DOM 盒 ${domWidth}×${domHeight} 相差 > 8px`,
		);
	}
	return failures;
}

/**
 * 校验悬停预览锚定探针（`#anchor-probe`）：SVG 节点元素必须能提供有限的
 * offsetWidth/offsetHeight，否则官方弹窗的锚定矩形 bottom/right 为 NaN，
 * 预览只会出现在节点上方、上方放不下时完全不显示。
 */
function checkAnchor(dom) {
	const { probe, failures: parseFailures } = readProbe(dom, 'anchor-probe', '锚定');
	if (parseFailures) return parseFailures;
	const failures = [];
	// 前提：SVG 元素本身没有这两个属性（否则本探针失去意义）
	if (probe.beforeWidth !== 'undefined') {
		failures.push(
			`SVG 节点已有 offsetWidth=${probe.beforeWidth}（探针前提不成立）`,
		);
	}
	if (!Number.isFinite(probe.bottom) || !Number.isFinite(probe.right)) {
		failures.push(
			`锚定矩形 bottom/right 非有限数（bottom=${probe.bottom}, right=${probe.right}）`,
		);
	}
	if (!(probe.offsetWidth > 0) || !(probe.offsetHeight > 0)) {
		failures.push(`补齐的尺寸非正（${probe.offsetWidth}×${probe.offsetHeight}）`);
	}
	if (
		probe.offsetWidth !== probe.rectWidth ||
		probe.offsetHeight !== probe.rectHeight
	) {
		failures.push(
			`补齐尺寸 (${probe.offsetWidth}×${probe.offsetHeight}) 与实测矩形 (${probe.rectWidth}×${probe.rectHeight}) 不一致`,
		);
	}
	return failures;
}

/**
 * 校验方案 B 原型探针（`#inline-probe`）：自绘节点内联内容的装配、测宽与点击命中。
 *
 * 断言口径：
 * - 锚点数 = 2（库内 `[[笔记A]]` + 外部裸 URL）：库内走 `data-href`（原始 linkpath，
 *   无 [[ ]] 包裹——view-wilink.resolveAnchorLink 会包回 wikilink 形态），外部走 `href`；
 * - 内容落在 foreignObject 内，节点宽度为正且与内容实测宽度一致（测宽与渲染同源）；
 * - 点击命中契约：合成 click 后 `node_click` 的 `event.target` 必须是锚点本体、
 *   在节点 group 内、`closest('a.internal-link')` 命中同一锚点——这三条正是
 *   `view-wilink.findAnchorInNode` 的前置判据；
 * - 仅轻标记（无链接）的节点也必须被接管（`**重点**` → `<strong>`、`` `码` `` →
 *   `<code>`，且无锚点）：2026-09-15 修订前只按「含链接」接管，该形态在真实
 *   节点里原样显示标记符（用户实测发现）；
 * - **超长单行（20k）必须接管 + 截断**（显示 ≤ 2000 字 + `…` + `data-truncated`
 *   + `title`）：引擎的文本换行是逐字符 + 每字一次测量的二次复杂度，把长行交给
 *   它是用户报的「白屏 / 卡死后关闭」的成因（实测 +2.8s / 20k 字）；
 * - **段落（多行）节点**：`mdRaw` 是逐字原文，故段落里的链接同样渲染为可点文本
 *   （2 枚锚点）且保留多行结构（README 对外承诺，此处实测锁定）；
 * - 对照：纯文本节点不得出现自绘锚点（未被接管，仍走引擎 SVG 文本）。
 */
/**
 * 校验图片尺寸回灌探针（`#image-probe`）：首帧后回灌校正结果 → 引擎按新尺寸渲染。
 *
 * 断言口径（生产同款流程：解析器不产 imageSize → 填默认值 → 首帧 → 回灌）：
 * - 默认尺寸填充恰好命中 1 个图片节点（引擎硬要求：缺 imageSize 渲染链即断）；
 * - 回灌返回 1（对象身份命中且值有变化）；
 * - `<image>` 的 width/height **从默认尺寸变为 120×40**（渲染确实跟随数据写入）；
 * - 自动校正条目打上 `mdImageAutoSize` 标记（序列化据此不回写文件）。
 * 对照组「不填默认值」只记录不断言（`rawHasRoot` 预期 false，留作证据）。
 */
function checkImageCorrection(dom, diag) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'image-probe',
		'图片尺寸回灌',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.filled !== 1) {
		failures.push(`默认尺寸填充 ${probe.filled} ≠ 1（应恰好命中 1 个图片节点）`);
	}
	if (probe.applied !== 1) {
		failures.push(`回灌条数 ${probe.applied} ≠ 1（应命中 1 个图片节点）`);
	}
	if (probe.afterWidth !== 120 || probe.afterHeight !== 40) {
		failures.push(
			`回灌后渲染尺寸 ${probe.afterWidth}×${probe.afterHeight} ≠ 120×40（引擎未按新尺寸渲染）`,
		);
	}
	if (probe.beforeWidth === 120 && probe.beforeHeight === 40) {
		failures.push(
			'回灌前就已是 120×40：探针无法区分「回灌生效」与「本来如此」',
		);
	}
	if (probe.marked !== true) {
		failures.push('自动校正条目未打 mdImageAutoSize 标记（会被序列化回写文件）');
	}
	diag.log(
		`      ⓘ 回灌前 ${probe.beforeWidth}×${probe.beforeHeight} → 回灌后 ${probe.afterWidth}×${probe.afterHeight}；不填默认值的对照组 hasRoot=${probe.rawHasRoot}`,
	);
	return failures;
}

/**
 * 校验节点计数探针（`#count-probe`）：性能模式的渲染树结构完整。
 *
 * 断言口径：开启性能模式（阈值 1 ⇒ 必开）的 151 节点宽扇形地图，渲染树计数
 * 必须等于真实节点数——`removeNodeWhenOutCanvas` 只摘 DOM（`removeSelf` =
 * `group.remove()`），不摘 `parent.children`。状态栏计数（`view-status`）依赖
 * 这条：**只扫 DOM 的路径才需要 forceLoadNode，计数/遍历树不需要**。
 */
function checkCount(dom, diag) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'count-probe',
		'节点计数',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.renderTreeNodes !== probe.trueNodes) {
		failures.push(
			`性能模式下渲染树计数 ${probe.renderTreeNodes} ≠ 真实节点数 ${probe.trueNodes}（状态栏会漏计）`,
		);
	}
	// DOM 侧必须**少于**总数：否则说明性能模式没真正裁剪（那样上面的计数断言
	// 就成了空转——必须同时证明「裁剪发生了」且「计数没漏」）
	if (!(probe.domNodeGroups < probe.trueNodes)) {
		failures.push(
			`性能模式未真正裁剪 DOM：节点组数 ${probe.domNodeGroups}（应 < 总数 ${probe.trueNodes}）`,
		);
	}
	diag.log(
		`      ⓘ 性能模式：渲染树 ${probe.renderTreeNodes} 节点 / DOM ${probe.domNodeGroups} 组`,
	);
	return failures;
}

/**
 * 校验 DOM 规模探针（`#perf-probe`）：自绘节点的结构开销有上限。
 *
 * 断言口径（同形状两棵地图，各 30 子节点，实测值写在上限里）：
 * - 自绘通道确实生效：自绘侧 foreignObject = 子节点数，引擎文本侧 = 0；
 * - **每节点 DOM 元素预算**：引擎文本 ≈8/节点、自绘 ≈13/节点（自绘多出
 *   foreignObject + 内容子树）——留出余量设上限（12 / 20），防渲染路径里的
 *   元素偷偷膨胀（DOM 规模直接决定样式与布局成本，且按节点数成倍放大）；
 * - `countTreeNodes` 对**数据树**同样可用（节点数正确）。
 */
function checkPerf(dom, diag) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'perf-probe',
		'DOM 规模',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	const nodes = probe.nodesPerMap;
	if (!Number.isInteger(nodes) || nodes !== 31) {
		failures.push(`探针地图规模异常：${nodes}（应为 31 = 根 + 30 子节点）`);
	}
	if (probe.linkForeignObjects !== 30 || probe.plainForeignObjects !== 0) {
		failures.push(
			`自绘通道未按预期生效：自绘 foreignObject ${probe.linkForeignObjects}（应 30）/ 引擎文本 ${probe.plainForeignObjects}（应 0）`,
		);
	}
	const perNode = (els) => (typeof els === 'number' ? els / nodes : NaN);
	const plainPerNode = perNode(probe.plainDomEls);
	const linkPerNode = perNode(probe.linkDomEls);
	if (!(plainPerNode <= 12)) {
		failures.push(
			`引擎文本节点 DOM 元素/节点 ${plainPerNode.toFixed(1)} 超过上限 12`,
		);
	}
	if (!(linkPerNode <= 20)) {
		failures.push(`自绘节点 DOM 元素/节点 ${linkPerNode.toFixed(1)} 超过上限 20`);
	}
	// 注意**不**断言「自绘更重」：实测自绘节点元素数反而更少（接管后引擎跳过
	// text/image/icon/hyperlink/tag/note/prefix/postfix 全部默认内容，自绘只留
	// foreignObject + 内容子树）。自绘的真实成本在**离屏测宽**与内容重建，
	// 与元素数量无关——这里只钉「结构规模不膨胀」。
	if (probe.plainRenderNodes !== nodes || probe.linkRenderNodes !== nodes) {
		failures.push(
			`渲染树规模异常：${probe.plainRenderNodes} / ${probe.linkRenderNodes}（应各为 ${nodes}）`,
		);
	}
	if (probe.bigTreeNodes !== 1000) {
		failures.push(
			`countTreeNodes 对数据树计数错误：${probe.bigTreeNodes}（应 1000）`,
		);
	}
	// 「每帧重建」前提的守门：空 render 不得调用自绘构建器（引擎只改 transform，
	// 不重建内容）；改一个节点的文本应恰好重建 1 次（代价随编辑数线性，不按帧）。
	// 若这两条红了，自绘成本模型变了——届时才需要重新评估「收窄接管面」。
	if (probe.idleBuilderCallsPlain !== 0 || probe.idleBuilderCallsLink !== 0) {
		failures.push(
			`空 render 仍调用自绘构建器：引擎文本 ${probe.idleBuilderCallsPlain} / 自绘 ${probe.idleBuilderCallsLink}（应各为 0）`,
		);
	}
	if (probe.editBuilderCallsLink !== 1) {
		failures.push(
			`改一个节点文本触发了 ${probe.editBuilderCallsLink} 次构建器（应恰好 1 次）`,
		);
	}
	diag.log(
		`      ⓘ DOM 元素/节点：引擎文本 ${plainPerNode.toFixed(1)}，自绘 ${linkPerNode.toFixed(1)}；构建器调用 空 render ${probe.idleBuilderCallsLink} / 改文本 ${probe.editBuilderCallsLink}`,
	);
	return failures;
}

/**
 * 校验编辑成本探针（`#edit-probe`）：一次「改一个节点文本」的真实工作量基线。
 *
 * 为什么单列：现有 perf 探针只证明「自绘构建器按编辑数线性」（30 节点、直接改
 * 数据 + render），而**生产路径**（`setNodeText` = 引擎命令 + render）在大图上的
 * 落地次数、DOM 变更量、内容重建粒度都没有口径——这三点正是「局部重绘值不值」
 * 的判据（2026-09-17 性能评审的 P0）。
 *
 * 口径是**时钟无关**的计数（见脚本头部：--virtual-time-budget 下耗时无意义）。
 * DOM 变更按类型拆分是关键判据：childList 增删 = 真的重建 DOM（局部重绘能省），
 * attributes / characterData = 就地更新（布局固有，局部重绘省不掉）。
 * 本轮只记录基线（ⓘ 输出），仅断言结构事实：规模、计数为整数、至少一次落地。
 */
function checkEdit(dom, diag) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'edit-probe',
		'编辑成本',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.nodeCount !== 500) {
		failures.push(`编辑成本探针规模异常：${probe.nodeCount}（应为 500）`);
	}
	for (const label of ['richEdit', 'plainEdit']) {
		if (probe[label + 'Error']) {
			failures.push(`${label}：setNodeText 抛错 ${probe[label + 'Error']}`);
		}
		if (probe[label + 'Missing']) {
			failures.push(`${label}：未找到目标节点（探针树构造异常）`);
			continue;
		}
		const ends = probe[label + 'RenderEnds'];
		if (!Number.isInteger(ends) || ends < 1) {
			failures.push(`${label}：一次编辑的布局落地次数异常（${ends}，应 ≥1）`);
		}
	}
	diag.log(
		`      ⓘ 编辑成本（500 节点 / 非性能模式，DOM 元素 ${probe.domNodes}）：`,
	);
	for (const [label, name] of [
		['idleRender', '空 render（对照）'],
		['richEdit', '自绘节点'],
		['plainEdit', '纯文本节点'],
	]) {
		diag.log(
			`         ${name}编辑 → 布局落地 ${probe[label + 'RenderEnds']} 次；DOM 变更 ${probe[label + 'Mutations']}（增 ${probe[label + 'AddedNodes']} / 删 ${probe[label + 'RemovedNodes']} / 属性 ${probe[label + 'AttrMutations']}＝真变化 ${probe[label + 'AttrRealChanges']} + 同值空写 ${probe[label + 'AttrSameValues']} / 文本 ${probe[label + 'TextMutations']}）；内容重建 ${probe[label + 'BuilderCalls']}`,
		);
	}
	return failures;
}

/**
 * 校验性能模式运行时切换探针（`#perf-switch-probe`）：`updateConfig` 真的能开/关虚拟渲染。
 *
 * 断言口径（151 节点宽扇形，创建时关闭性能模式）：
 * - 开启后 DOM 节点组数必须**少于**总数（视口外真的被摘出）；
 * - 关闭后必须**恢复到**开启前的数量（引擎 forceLoadNode + 一次渲染载回全部）；
 * - 渲染树计数全程 = 总数（裁剪只摘 DOM，见 count 探针）。
 * 这条是「设置面板性能阈值滑块原地生效」（K60）的引擎侧前提；不成立就得退回重建路径。
 */
function checkPerfSwitch(dom, diag) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'perf-switch-probe',
		'性能模式切换',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.trueNodes !== 151) {
		failures.push(`探针规模异常：${probe.trueNodes}（应为 151）`);
	}
	if (probe.renderTreeNodes !== probe.trueNodes) {
		failures.push(
			`切换过程中渲染树计数变化：${probe.renderTreeNodes} ≠ ${probe.trueNodes}`,
		);
	}
	if (probe.appliedOn !== true || probe.appliedOff !== true) {
		failures.push(
			`applyPerformanceMode 未成功应用：on=${probe.appliedOn} / off=${probe.appliedOff}`,
		);
	}
	if (!(probe.domBeforeOn >= probe.trueNodes)) {
		failures.push(
			`创建时（性能模式关闭）DOM 节点组 ${probe.domBeforeOn} 应等于全部 ${probe.trueNodes}`,
		);
	}
	if (!(probe.domAfterOn < probe.trueNodes)) {
		failures.push(
			`运行时开启性能模式后 DOM 节点组 ${probe.domAfterOn} 未减少（应 < ${probe.trueNodes}）——updateConfig 未真正启用裁剪`,
		);
	}
	if (probe.domAfterOff !== probe.domBeforeOn) {
		failures.push(
			`运行时关闭性能模式后 DOM 节点组 ${probe.domAfterOff} 未恢复（应为 ${probe.domBeforeOn}）`,
		);
	}
	diag.log(
		`      ⓘ 性能模式运行时切换：DOM 组数 ${probe.domBeforeOn} → 开启 ${probe.domAfterOn} → 关闭 ${probe.domAfterOff}（渲染树恒 ${probe.renderTreeNodes}）`,
	);
	return failures;
}

/**
 * 校验渲染经济探针（`#render-eco-probe`）：**一次动作至多一次布局落地**。
 *
 * 为什么需要：K58 已量化「一次整树渲染」的代价（每节点数条属性空写），插件侧减少
 * 浪费的唯一抓手是别让一个动作产生多次布局落地——引擎 `render()` 有 `setTimeout(0)`
 * 合并窗口，**同一任务内的重复入口是免费的**，跨任务才会真的多跑一轮。
 *
 * 断言口径：`mindmap.ts` 暴露的包装函数（内部显式 render）必须**恰好 1 次**；
 * 两个引擎命令单独调用只记录（命令是否自带渲染属引擎内部形态，随行 ⓘ 输出）。
 * 将来谁在跨任务路径上补渲染（或包装函数多写/漏写一次 render），这里立刻红。
 */
function checkRenderEco(dom, diag) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'render-eco-probe',
		'渲染经济',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	// 恰好 1 次：我们的包装函数（内部显式 render 一次）+ 关闭方向的性能模式切换
	// + 裸 updateConfig 两个对照（引擎 forceLoadNode 自带的一次）
	const exactlyOne = [
		'setNodeImageSize',
		'previewNodeImageSize',
		'refreshNodeCustomContent',
		'replaceMindMapData',
		'applyPerformanceModeOff',
		'rawUpdateConfigOn',
		'rawUpdateConfigOff',
	];
	for (const label of exactlyOne) {
		if (probe[label + 'Error']) {
			failures.push(`${label}：动作抛错 ${probe[label + 'Error']}`);
			continue;
		}
		if (probe[label] !== 1) {
			failures.push(
				`${label}：一次动作的布局落地为 ${probe[label]} 次（应恰好 1 次）`,
			);
		}
	}
	// 开启方向 2 次是**有意**的：forceLoadNode 一次（不裁剪）+ 补一次裁剪渲染，
	// 换取「开启后立刻收敛到裁剪态」（perf-switch 探针验证 151→11）。多于 2 即异常。
	if (probe.applyPerformanceModeOnError) {
		failures.push(
			`applyPerformanceModeOn：动作抛错 ${probe.applyPerformanceModeOnError}`,
		);
	} else if (probe.applyPerformanceModeOn !== 2) {
		failures.push(
			`applyPerformanceModeOn：布局落地 ${probe.applyPerformanceModeOn} 次（开启方向应为 2 次：forceLoadNode + 裁剪渲染）`,
		);
	}
	// 引擎命令单独调用：命令是否自带渲染属引擎内部形态，只要求「不超过 1 次」
	for (const label of ['commandSetNodeImage', 'commandSetNodeHyperlink']) {
		if (probe[label + 'Error']) {
			failures.push(`${label}：命令抛错 ${probe[label + 'Error']}`);
			continue;
		}
		if (!(probe[label] <= 1)) {
			failures.push(
				`${label}：引擎命令单独调用产生 ${probe[label]} 次布局落地（应 ≤1）`,
			);
		}
	}
	diag.log(
		`      ⓘ 渲染经济（每次动作的布局落地次数）：图尺寸 ${probe.setNodeImageSize} / 预览 ${probe.previewNodeImageSize} / 自绘重建 ${probe.refreshNodeCustomContent} / 整树替换 ${probe.replaceMindMapData} / 性能开 ${probe.applyPerformanceModeOn} / 性能关 ${probe.applyPerformanceModeOff}；引擎命令单独调用 SET_NODE_IMAGE ${probe.commandSetNodeImage} / SET_NODE_HYPERLINK ${probe.commandSetNodeHyperlink}；对照——裸 updateConfig 开 ${probe.rawUpdateConfigOn} / 关 ${probe.rawUpdateConfigOff}`,
	);
	return failures;
}

/**
 * 校验调宽写入通道探针（`#history-probe`）：帧内不得产生历史/保存调度。
 *
 * 断言口径：
 * - 6 帧预览写入后历史**零增长**、`data_change` **零次**（否则每次拖拽都触发
 *   视图的自动保存调度与状态栏/标题重算——用户实测「保存好几次 + 卡顿」）；
 * - 帧内数据确实生效（写入宽度 = 最后一帧请求值）；
 * - 收尾一次提交：历史 **+1**、`data_change` **1 次**（一次拖动一条历史，
 *   一次 Ctrl+Z 撤回整次调宽；一次保存调度）。
 */
function checkHistory(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'history-probe',
		'调宽写入通道',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.error) {
		failures.push(`探针异常：${probe.error}`);
		return failures;
	}
	if (probe.hasHistory !== true || probe.hasNode !== true) {
		failures.push('探针环境异常（引擎历史表或节点取不到）');
		return failures;
	}
	if (probe.framesHistoryDelta !== 0) {
		failures.push(
			`帧内预览写入产生了 ${probe.framesHistoryDelta} 条历史（拖动一次会切碎撤销链）`,
		);
	}
	if (probe.framesDataChange !== 0) {
		failures.push(
			`帧内预览触发了 ${probe.framesDataChange} 次 data_change（自动保存被逐帧调度 = 保存好几次 + 卡顿）`,
		);
	}
	if (probe.framesWrittenWidth !== 88) {
		failures.push(
			`帧内数据未生效：写入宽度 ${probe.framesWrittenWidth} ≠ 88（最后一帧请求值）`,
		);
	}
	if (probe.commitHistoryDelta !== 1) {
		failures.push(
			`收尾提交后历史增量 ${probe.commitHistoryDelta} ≠ 1（应为一条：一次 Ctrl+Z 撤回整次调宽）`,
		);
	}
	if (probe.commitDataChange !== 1) {
		failures.push(
			`收尾提交后 data_change 次数 ${probe.commitDataChange} ≠ 1（保存调度应只有一次）`,
		);
	}
	return failures;
}

/**
 * 校验宽度手柄探针（`#handle-probe`）：手柄只应出现在自绘节点上。
 *
 * 断言口径：
 * - 纯文本节点（引擎 SVG 文本，拖动宽度无任何效果）**不得**出现宽度手柄
 *   （DOM 里 0 个 `ew-resize` 透明 rect，引擎内部也没有手柄节点）；
 * - 自绘节点（含链接的富节点，拖宽 + 高度跟随已实现）**必须**有手柄（左右各 1）。
 */
function checkHandles(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'handle-probe',
		'宽度手柄',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.error) {
		failures.push(`探针异常：${probe.error}`);
		return failures;
	}
	if (probe.plainHandles !== 0) {
		failures.push(
			`纯文本节点出现 ${probe.plainHandles} 个宽度手柄（拖动无效果的死手柄）`,
		);
	}
	if (probe.plainHasHandleNodes === true) {
		failures.push('纯文本节点仍创建了引擎手柄节点（门禁未生效）');
	}
	if (probe.wantedPlain !== false || probe.wantedRich !== true) {
		failures.push(
			`接管判据取值异常（纯文本 ${probe.wantedPlain} / 自绘 ${probe.wantedRich}）——门禁判据与自绘判据应当同源`,
		);
	}
	if (probe.richHandles !== 2) {
		failures.push(
			`自绘节点宽度手柄数 ${probe.richHandles} ≠ 2（拖宽能力被误关）`,
		);
	}
	if (probe.richHasHandleNodes !== true) {
		failures.push('自绘节点未创建引擎手柄节点（拖宽能力被误关）');
	}
	return failures;
}

/**
 * 校验撤销探针（`#undo-probe`）：插入 → BACK 的还原度 + 节点实例同一性。
 *
 * 断言口径：
 * - 插入后 DOM 节点数 = 插入前 + 1（新节点确实渲染出来了，否则后续断言无意义）；
 * - BACK 后 DOM 节点数**回到插入前**（撤销必须真正重绘，不能只改数据）——
 *   「Ctrl+Z 失效」类缺陷的直接守卫；
 * - 树上被撤销的临时子节点消失（`treeChildrenAfterBack === 0`）；
 * - 撤销后**同一节点仍能用同一实例寻址**（`childSameAfterBack`）：引擎复用 Node 对象，
 *   `view-drag-duplicate`（Alt 拖拽复制）在 BACK 之后继续用旧父引用插入副本，
 *   引擎若改成重建实例，此处先红、需同步改为按 uid 重新定位。
 */
function checkUndo(dom) {
	const { probe, failures: parseFailures } = readProbe(dom, 'undo-probe', '撤销');
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.hasChild !== true) {
		failures.push('撤销探针未取到对照节点（场景结构变了？）');
		return failures;
	}
	if (probe.domNodesAfterInsert !== probe.domNodesBefore + 1) {
		failures.push(
			`插入后 DOM 节点数 ${probe.domNodesAfterInsert} ≠ 插入前 ${probe.domNodesBefore} + 1（新节点未渲染）`,
		);
	}
	if (probe.domNodesAfterBack !== probe.domNodesBefore) {
		failures.push(
			`撤销后 DOM 节点数 ${probe.domNodesAfterBack} ≠ 插入前 ${probe.domNodesBefore}（撤销未还原画面）`,
		);
	}
	if (probe.treeChildrenAfterBack !== 0) {
		failures.push(
			`撤销后树上被撤销的子节点仍存在（children=${probe.treeChildrenAfterBack}）`,
		);
	}
	if (probe.childSameAfterBack !== true) {
		failures.push(
			'撤销后节点实例被替换（Alt 拖拽复制的「BACK 后用旧父引用插入」将失效，需改为按 uid 定位）',
		);
	}
	return failures;
}

function checkInline(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'inline-probe',
		'内联内容',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.anchorCount !== 2) {
		failures.push(`自绘锚点数 ${probe.anchorCount} ≠ 2（库内 + 外部）`);
	}
	if (probe.internalHref !== '笔记A') {
		failures.push(
			`库内锚点 data-href ${JSON.stringify(probe.internalHref)} ≠ "笔记A"（应为无 [[ ]] 包裹的原始 linkpath）`,
		);
	}
	if (probe.externalHref !== 'https://example.com') {
		failures.push(
			`外部锚点 href ${JSON.stringify(probe.externalHref)} ≠ "https://example.com"`,
		);
	}
	if (probe.inForeignObject !== true) {
		failures.push('自绘内容未落在 foreignObject 内（引擎自绘节点内容通道未生效）');
	}
	if (probe.markupCount !== 1 || probe.markupText !== '重点') {
		failures.push(
			`轻标记渲染异常（strong 数 ${probe.markupCount}、文本 ${JSON.stringify(probe.markupText)}，应 1 个「重点」）`,
		);
	}
	// 仅轻标记（无链接）的节点：接管条件必须覆盖「有标记段」这一支
	if (probe.markupOnlyForeign !== true) {
		failures.push(
			'仅轻标记节点未进入 foreignObject（无链接的标记节点未被接管 → 标记符会原样显示）',
		);
	}
	if (probe.markupOnlyStrong !== 1 || probe.markupOnlyCode !== 1) {
		failures.push(
			`仅轻标记节点的 <strong>/<code> 数 ${probe.markupOnlyStrong}/${probe.markupOnlyCode} ≠ 1/1`,
		);
	}
	if (probe.markupOnlyAnchors !== 0) {
		failures.push(
			`仅轻标记节点不应有锚点（实得 ${probe.markupOnlyAnchors}）`,
		);
	}
	// 轻标记扩展 / 隐藏语法 / 未解析标记（2026-09-15，对齐官方 Basic formatting syntax）
	if (probe.syntaxInForeignObject !== true) {
		failures.push('含 `==高亮==` / `%%注释%%` 的节点未进入 foreignObject（未被接管）');
	}
	if (probe.syntaxMarkCount !== 1) {
		failures.push(`==高亮== 未渲染为 <mark>（实得 ${probe.syntaxMarkCount} 个）`);
	}
	if (probe.syntaxStrongCount !== 1) {
		failures.push(`__粗__ 未渲染为 <strong>（实得 ${probe.syntaxStrongCount} 个）`);
	}
	if (!probe.syntaxText.includes('*转义*')) {
		failures.push(
			`\\*转义\\* 未消费反斜杠（显示文本 ${JSON.stringify(probe.syntaxText)}）`,
		);
	}
	if (probe.syntaxText.includes('%%') || probe.syntaxText.includes('备注')) {
		failures.push(
			`%%注释%% 未被隐藏（显示文本 ${JSON.stringify(probe.syntaxText)}）`,
		);
	}
	if (probe.syntaxUnresolved !== 1) {
		failures.push(
			`未解析链接未标记 is-unresolved（实得 ${probe.syntaxUnresolved} 个）`,
		);
	}
	if (probe.inlineResolvedAnchors !== 1) {
		failures.push(
			`已解析链接被误标为未解析（inline 场景非未解析锚点 ${probe.inlineResolvedAnchors} ≠ 1）`,
		);
	}
	// 超长单行必须接管 + 截断：这条是「白屏/卡死」的直接守卫（引擎逐字符换行
	// 是二次复杂度，20k 字单行交给它 ≈ +2.8s，再多就直接冻住渲染进程）
	if (probe.hugeInForeignObject !== true) {
		failures.push(
			'超长单行节点未进入 foreignObject（回落引擎 = 逐字符二次换行，会卡死）',
		);
	}
	if (!(probe.hugeDisplayLen > 0) || probe.hugeDisplayLen > 2001) {
		failures.push(
			`超长节点显示字符数 ${probe.hugeDisplayLen} 不在 (0, 2000+省略号] 内（截断失效）`,
		);
	}
	if (probe.hugeTruncated !== 'true') {
		failures.push('超长节点缺少 data-truncated 标记（无法提示「只显示了开头」）');
	}
	if (!(probe.hugeTitleLen > 0)) {
		failures.push('超长节点缺少 title 提示（用户会以为文件里的内容也丢了）');
	}
	if (probe.hugeEllipsis !== true) {
		failures.push('超长节点显示文本未以 … 结尾（截断位置不可见）');
	}
	// 段落（多行）节点：README 承诺「段落里的链接同样可点」，此处是它的实测锚点
	if (probe.paragraphInForeignObject !== true) {
		failures.push('段落（多行）节点未进入 foreignObject（链接在段落里不可点）');
	}
	if (probe.paragraphAnchors !== 2) {
		failures.push(
			`段落节点自绘锚点数 ${probe.paragraphAnchors} ≠ 2（库内 [[笔记A]] + 裸 URL）`,
		);
	}
	if (probe.paragraphLines !== 2) {
		failures.push(
			`段落节点显示行数 ${probe.paragraphLines} ≠ 2（多行结构被压平，white-space 失效）`,
		);
	}
	if (!(probe.childWidth > 0) || !(probe.childHeight > 0)) {
		failures.push(
			`自绘节点测宽非正（${probe.childWidth}×${probe.childHeight}，离屏克隆测宽失效？）`,
		);
	}
	if (
		typeof probe.regionWidth !== 'number' ||
		Math.abs(probe.childWidth - probe.regionWidth) > 2
	) {
		failures.push(
			`节点宽 ${probe.childWidth} 与内容实测宽 ${probe.regionWidth} 不一致（测宽与渲染不同源）`,
		);
	}
	if (probe.plainAnchors !== 0) {
		failures.push(
			`纯文本节点出现 ${probe.plainAnchors} 个自绘锚点（应回落引擎默认 SVG 文本）`,
		);
	}
	// 宽度拖拽（引擎 customTextWidth）：自绘内容必须把宽度落到元素上——
	// 否则拖多宽都是 500 折行，节点高度纹丝不动（2026-09-16 用户实测缺陷）
	const drag = probe.widthDrag;
	if (!drag) {
		failures.push('宽度拖拽探针未取到超长自绘节点（无法验证「拖宽 → 高度跟随」）');
	} else {
		// 拖拽帧：宽度必须跟上光标（`reRender([])` 不重建自绘内容，高度可滞后一拍）
		if (Math.abs(drag.dragWidth - drag.requestedWidth) > 2) {
			failures.push(
				`拖拽帧节点宽 ${drag.dragWidth} ≠ 请求宽 ${drag.requestedWidth}（未响应 customTextWidth）`,
			);
		}
		if (
			typeof drag.dragRegionWidth === 'number' &&
			Math.abs(drag.dragRegionWidth - drag.requestedWidth) > 2
		) {
			failures.push(
				`拖拽帧内容实测宽 ${drag.dragRegionWidth} ≠ 请求宽 ${drag.requestedWidth}（宽度未落到元素上）`,
			);
		}
		if (Math.abs(drag.afterWidth - drag.requestedWidth) > 2) {
			failures.push(
				`松手后节点宽 ${drag.afterWidth} ≠ 请求宽 ${drag.requestedWidth}（自绘内容未响应 customTextWidth）`,
			);
		}
		if (
			typeof drag.regionWidth === 'number' &&
			Math.abs(drag.regionWidth - drag.requestedWidth) > 2
		) {
			failures.push(
				`松手后内容实测宽 ${drag.regionWidth} ≠ 请求宽 ${drag.requestedWidth}（宽度未落到元素上）`,
			);
		}
		// 核心：收窄（500 → 240）→ 行数变多 → **高度必须变大**
		if (!(drag.afterHeight > drag.beforeHeight)) {
			failures.push(
				`拖宽后高度未随宽度变化（前 ${drag.beforeHeight} → 后 ${drag.afterHeight}）：自绘内容未在新宽度下重建（元素 inline width ${JSON.stringify(drag.styleWidths)}）`,
			);
		}
	}
	const click = probe.click;
	if (!click) {
		failures.push('点击模拟未收到 node_click（自绘节点内锚点不可点）');
	} else {
		if (!click.isAnchor) {
			failures.push('node_click 的 event.target 不是被点击的锚点');
		}
		if (!click.inGroup) {
			failures.push('锚点不在节点 group 内（findAnchorInNode 会拒绝命中）');
		}
		if (!click.closestHit) {
			failures.push('target.closest("a.internal-link") 未命中锚点');
		}
		if (click.dataHref !== '笔记A') {
			failures.push(
				`点击命中锚点的 data-href ${JSON.stringify(click.dataHref)} ≠ "笔记A"`,
			);
		}
	}
	return failures;
}

/**
 * 校验导出样式探针（`#export-probe`）：自绘内容的样式必须**内联在元素上**。
 *
 * 引擎导出（`getSvgData`）只把 `joinCss()`（引擎自身 CSS）与 header/footer 的
 * cssText 注入导出 SVG——插件 styles.css 不在其中；若自绘内容依赖类规则，交给
 * canvas 光栅化时就会掉排版（尺寸/换行/配色），而 foreignObject 的宽高仍按屏上
 * 测宽固定 → 导出图溢出/错位。故导出 SVG 里必须能读到三类内联样式。
 */
function checkExport(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'export-probe',
		'导出样式',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.hasSvgHtml !== true) {
		failures.push('未取到导出 SVG（map.getSvgData 未返回 svgHTML）');
		return failures;
	}
	const region = typeof probe.regionStyle === 'string' ? probe.regionStyle : '';
	if (
		!/white-space/.test(region) ||
		!/padding/.test(region) ||
		!/max-width/.test(region)
	) {
		failures.push(
			`自绘根元素缺内联样式（导出图会掉排版）：${JSON.stringify(probe.regionStyle)}`,
		);
	}
	const anchor = typeof probe.anchorStyle === 'string' ? probe.anchorStyle : '';
	if (!/color/.test(anchor) || !/cursor/.test(anchor)) {
		failures.push(
			`锚点缺内联样式（导出图链接配色丢失）：${JSON.stringify(probe.anchorStyle)}`,
		);
	}
	const markup = typeof probe.markupStyle === 'string' ? probe.markupStyle : '';
	if (!/font-weight/.test(markup)) {
		failures.push(
			`轻标记元素缺内联样式（导出图粗体丢失）：${JSON.stringify(probe.markupStyle)}`,
		);
	}
	return failures;
}

/**
 * 校验富节点规模探针（`#scale-probe`）：30 个自绘节点的大图必须**全部渲染**，
 * 且**不留测量垃圾**（引擎约定离屏测宽元素是单个复用元素）。
 *
 * 覆盖的是「单测覆盖不到」的规模性回归：自绘节点漏渲染（例如缓存串味、
 * 接管判定在大图上退化）、节点总数不符（丢节点）、以及每节点新建测量元素
 * （DOM 随节点数膨胀）。
 *
 * **不测耗时**：CI 跑在 `--virtual-time-budget` 下，时钟被虚拟化 → 耗时断言
 * 恒过且无意义；性能基线需在真实时钟环境另设（见脚本头部说明）。
 */
function checkScale(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'scale-probe',
		'富节点规模',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	if (probe.richRendered !== probe.richExpected) {
		failures.push(
			`自绘节点渲染数 ${probe.richRendered} ≠ ${probe.richExpected}（含富节点的大图漏渲染）`,
		);
	}
	if (probe.totalNodes !== probe.nodeExpected) {
		failures.push(
			`节点总数 ${probe.totalNodes} ≠ ${probe.nodeExpected}（根 1 + 分支 6 + 叶子 60；丢节点或多渲染）`,
		);
	}
	if (probe.measureEls !== 1) {
		failures.push(
			`离屏测宽元素 ${probe.measureEls} 个 ≠ 1（引擎约定单个复用元素，多于 1 即测量垃圾累积）`,
		);
	}
	return failures;
}

/**
 * 校验布局探针（`#layout-probe`）：六种布局均能渲染；连线样式分派正确
 * （曲线布局的连线全含 C/Q，直线布局零曲线）；**根节点连线起点在节点边缘**
 * ——引擎默认从节点中心起画，会在边缘斜穿而出（衔接"斜戳"回归），此项专门守它。
 */
function checkLayouts(dom) {
	const { probe, failures: parseFailures } = readProbe(
		dom,
		'layout-probe',
		'布局',
	);
	if (parseFailures) return parseFailures;
	const failures = [];
	for (const { layout, curves } of LAYOUT_PROBE_CONTRACTS) {
		const entry = probe[layout];
		if (!entry) {
			failures.push(`布局 ${layout} 无探针记录（未渲染？）`);
			continue;
		}
		if (entry.error) {
			failures.push(`布局 ${layout} 探针异常：${entry.error}`);
			continue;
		}
		const expectedNodes = LAYOUT_PROBE_TREE.children.reduce(
			(sum, child) => sum + 1 + child.children.length,
			1,
		);
		if (entry.nodes !== expectedNodes) {
			failures.push(`布局 ${layout} 节点数 ${entry.nodes} ≠ ${expectedNodes}`);
		}
		if (!(entry.lines > 0)) {
			failures.push(`布局 ${layout} 未渲染连线路径`);
		}
		if (curves && entry.curves !== entry.lines) {
			failures.push(
				`布局 ${layout} 应为全曲线（${entry.curves}/${entry.lines} 条含曲线）`,
			);
		}
		if (!curves && entry.curves !== 0) {
			failures.push(
				`布局 ${layout} 应为直线连线，却出现 ${entry.curves} 条曲线路径`,
			);
		}
		if (!(entry.startsAtRootCenter === 0)) {
			failures.push(
				`布局 ${layout} 有 ${entry.startsAtRootCenter} 条连线从根节点中心起画（衔接应始于节点边缘）`,
			);
		}
	}
	// 水平展开的曲线布局须存在"从根左右缘出发"的连线（衔接修复的直接证据）
	for (const layout of ['logicalStructure', 'mindMap']) {
		if (!((probe[layout]?.startsAtRootEdgeX ?? 0) > 0)) {
			failures.push(`布局 ${layout} 未见从根节点边缘出发的连线`);
		}
	}
	// 引擎自带 Ctrl+L（RESET_LAYOUT）必须已被移除：自动整理统一走插件命令，
	// 本插件不定义默认热键（由用户在 Hotkeys 中自行分配）。
	const shortcuts = probe.engineShortcuts;
	if (!Array.isArray(shortcuts) || shortcuts.length === 0) {
		// 前提断言：读不到快捷键表说明探针失效（不能"空表即通过"）
		failures.push('未能读到引擎快捷键表（engineShortcuts 为空，探针失去意义）');
	} else if (shortcuts.includes('Control+l')) {
		failures.push(
			'引擎自带 Ctrl+L 仍注册：自动整理应统一走插件命令，不得保留默认热键',
		);
	}
	return failures;
}

/**
 * 跑完所有检查：返回未通过项数量。
 *
 * 任何断言函数抛异常都转成一条失败项（而不是让整个脚本静默退出）——
 * CI 上曾出现「场景全过后脚本无输出地退出」，此处保证异常可见且计入失败数。
 */
async function runChecks(dom, diag) {
	let failed = 0;
	const safe = (label, fn) => {
		try {
			return fn();
		} catch (error) {
			return [`${label} 检查异常：${error?.message ?? String(error)}`];
		}
	};

	for (const scenario of SCENARIOS) {
		const fragment = containerOf(dom, scenario.name);
		const failures = safe(`场景 ${scenario.name}`, () =>
			checkScenario(scenario, fragment),
		);
		const width = fragment ? measure(fragment).childWidth : null;
		diag.log(
			`  ${failures.length === 0 ? '✓' : '✗'} ${scenario.name.padEnd(7)} ${scenario.label}（子节点测宽 ${width}）`,
		);
		for (const failure of failures) diag.log(`      - ${failure}`);
		if (failures.length > 0) {
			await diag.file(
				`20-fail-${scenario.name}.html`,
				fragment ?? `(容器 #map-${scenario.name} 未渲染)`,
			);
		}
		failed += failures.length;
	}

	// 默认视口契约：100% 缩放 + 整体内容居中（打开大图时文字可读）
	diag.log(`  · 场景检查完成（DOM ${dom.length} 字节），进入 viewport 探针`);
	const viewportFailures = safe('viewport 探针', () => checkViewport(dom));
	diag.log(
		`  ${viewportFailures.length === 0 ? '✓' : '✗'} viewport 默认视口 100% + 整体内容居中`,
	);
	for (const failure of viewportFailures) diag.log(`      - ${failure}`);
	failed += viewportFailures.length;

	// 大图性能模式契约：居中不装配全量 DOM + 数据层盒口径（打开大图卡顿修复）
	diag.log('  · viewport 探针完成，进入 perf-box 探针');
	const perfBoxFailures = safe('perf-box 探针', () => checkPerfBox(dom));
	diag.log(
		`  ${perfBoxFailures.length === 0 ? '✓' : '✗'} perf-box 大图居中不装配全量 DOM（数据层包围盒）`,
	);
	for (const failure of perfBoxFailures) diag.log(`      - ${failure}`);
	failed += perfBoxFailures.length;

	// 悬停预览锚定契约：SVG 节点补齐 offsetWidth/offsetHeight（弹窗可上下翻转）
	diag.log('  · viewport 探针完成，进入 anchor 探针');
	const anchorFailures = safe('anchor 探针', () => checkAnchor(dom));
	diag.log(
		`  ${anchorFailures.length === 0 ? '✓' : '✗'} anchor  SVG 节点盒模型尺寸补齐（弹窗可上下翻转）`,
	);
	for (const failure of anchorFailures) diag.log(`      - ${failure}`);
	failed += anchorFailures.length;

	// 方案B 原型契约：自绘节点内联内容（foreignObject 装配 × 测宽同源 × 点击命中锚点）
	diag.log('  · anchor 探针完成，进入 inline 探针');
	const inlineFailures = safe('inline 探针', () => checkInline(dom));
	diag.log(
		`  ${inlineFailures.length === 0 ? '✓' : '✗'} inline 方案B 原型：自绘内容入 foreignObject × 测宽同源 × 点击命中锚点`,
	);
	for (const failure of inlineFailures) diag.log(`      - ${failure}`);
	failed += inlineFailures.length;

	// DOM 规模：自绘节点的结构开销预算（防渲染路径悄悄加元素）
	diag.log('  · inline 探针完成，进入 DOM 规模探针');
	const perfFailures = safe('DOM 规模探针', () => checkPerf(dom, diag));
	diag.log(
		`  ${perfFailures.length === 0 ? '✓' : '✗'} perf   DOM 规模：引擎文本 vs 自绘节点的元素预算（自绘必带 foreignObject）`,
	);
	for (const failure of perfFailures) diag.log(`      - ${failure}`);
	failed += perfFailures.length;

	// 编辑成本：一次编辑的真实工作量基线（局部重绘决策的判据）
	diag.log('  · DOM 规模探针完成，进入 edit 探针');
	const editFailures = safe('编辑成本探针', () => checkEdit(dom, diag));
	diag.log(
		`  ${editFailures.length === 0 ? '✓' : '✗'} edit   编辑成本基线：布局落地次数 / DOM 变更 / 内容重建（500 节点）`,
	);
	for (const failure of editFailures) diag.log(`      - ${failure}`);
	failed += editFailures.length;

	// 图片尺寸回灌：首帧后写入 → 引擎按新尺寸渲染（加载期探测不挡首帧的后半程）
	const imageFailures = safe('图片回灌探针', () =>
		checkImageCorrection(dom, diag),
	);
	diag.log(
		`  ${imageFailures.length === 0 ? '✓' : '✗'} image  图片尺寸回灌：首帧后写入即按新尺寸渲染（自动校正打标记不回写）`,
	);
	for (const failure of imageFailures) diag.log(`      - ${failure}`);
	failed += imageFailures.length;

	// 节点计数：性能模式的渲染树结构完整（状态栏计数正确性的前提）
	const countFailures = safe('节点计数探针', () => checkCount(dom, diag));
	diag.log(
		`  ${countFailures.length === 0 ? '✓' : '✗'} count  性能模式下渲染树结构完整（状态栏计数不漏计，裁剪只摘 DOM）`,
	);
	for (const failure of countFailures) diag.log(`      - ${failure}`);
	failed += countFailures.length;

	// 性能模式运行时切换：updateConfig 真的能开/关虚拟渲染（设置滑块原地生效的前提）
	diag.log('  · count 探针完成，进入 perf-switch 探针');
	const perfSwitchFailures = safe('性能模式切换探针', () =>
		checkPerfSwitch(dom, diag),
	);
	diag.log(
		`  ${perfSwitchFailures.length === 0 ? '✓' : '✗'} perf-switch 性能模式运行时切换（updateConfig 真的裁剪/恢复 DOM）`,
	);
	for (const failure of perfSwitchFailures) diag.log(`      - ${failure}`);
	failed += perfSwitchFailures.length;

	// 渲染经济：一次动作至多一次布局落地（插件侧唯一能省的渲染浪费）
	diag.log('  · perf-switch 探针完成，进入 render-eco 探针');
	const renderEcoFailures = safe('渲染经济探针', () => checkRenderEco(dom, diag));
	diag.log(
		`  ${renderEcoFailures.length === 0 ? '✓' : '✗'} render-eco 一次动作至多一次布局落地（包装函数恰好 1 次）`,
	);
	for (const failure of renderEcoFailures) diag.log(`      - ${failure}`);
	failed += renderEcoFailures.length;

	// 调宽写入通道：帧内不上历史、不触发保存调度
	diag.log('  · inline 探针完成，进入 history 探针');
	const historyFailures = safe('history 探针', () => checkHistory(dom));
	diag.log(
		`  ${historyFailures.length === 0 ? '✓' : '✗'} history 调宽写入：帧内 0 历史 / 0 保存调度，收尾各 1 次`,
	);
	for (const failure of historyFailures) diag.log(`      - ${failure}`);
	failed += historyFailures.length;

	// 宽度手柄：只在自绘节点上出现（纯文本节点不留死手柄）
	diag.log('  · history 探针完成，进入 handle 探针');
	const handleFailures = safe('handle 探针', () => checkHandles(dom));
	diag.log(
		`  ${handleFailures.length === 0 ? '✓' : '✗'} handle 宽度手柄：仅自绘节点有手柄（纯文本节点 0 个）`,
	);
	for (const failure of handleFailures) diag.log(`      - ${failure}`);
	failed += handleFailures.length;

	// 撤销契约：插入 → BACK 的还原度 × 节点实例同一性
	diag.log('  · handle 探针完成，进入 undo 探针');
	const undoFailures = safe('undo 探针', () => checkUndo(dom));
	diag.log(
		`  ${undoFailures.length === 0 ? '✓' : '✗'} undo  撤销：插入 → BACK 精确还原 × 节点实例仍可寻址`,
	);
	for (const failure of undoFailures) diag.log(`      - ${failure}`);
	failed += undoFailures.length;

	// 导出契约：自绘内容的样式随导出 SVG 带出（插件 CSS 不在导出图里生效）
	diag.log('  · inline 探针完成，进入 export 探针');
	const exportFailures = safe('export 探针', () => checkExport(dom));
	diag.log(
		`  ${exportFailures.length === 0 ? '✓' : '✗'} export 自绘内容样式随导出 SVG 带出（内联）`,
	);
	for (const failure of exportFailures) diag.log(`      - ${failure}`);
	failed += exportFailures.length;

	// 规模契约：30 个自绘节点全部渲染 + 无测量垃圾累积（性能收口）
	diag.log('  · export 探针完成，进入 scale 探针');
	const scaleFailures = safe('scale 探针', () => checkScale(dom));
	diag.log(
		`  ${scaleFailures.length === 0 ? '✓' : '✗'} scale  自绘节点成规模渲染（30 富节点）× 无测量垃圾`,
	);
	for (const failure of scaleFailures) diag.log(`      - ${failure}`);
	failed += scaleFailures.length;

	// 布局契约：六种布局渲染 + 连线样式分派 + 根节点连线起点
	diag.log('  · scale 探针完成，进入 layout 探针');
	const layoutFailures = safe('layout 探针', () => checkLayouts(dom));
	diag.log(
		`  ${layoutFailures.length === 0 ? '✓' : '✗'} layout 六布局渲染 × 连线分派（曲线/直线）× 根连线起点`,
	);
	for (const failure of layoutFailures) diag.log(`      - ${failure}`);
	failed += layoutFailures.length;

	return failed;
}

/**
 * 真实墙钟模式（`--perf`）：同一页面再跑一次「负载版」，用**进程墙钟差**给出真实成本。
 *
 * 为什么不在页内计时：页跑在 `--virtual-time-budget` 下，`Date`/`performance` 被虚拟化
 * （见 perf/scale 探针注释）；但虚拟时间只在**空闲**时快速推进，真实计算消耗真实 CPU
 * ⇒ 同页两次调用的墙钟差 ≈ 负载的真实耗时（进程启动、打包、其余探针在差值里抵消）。
 *
 * @returns 失败项（负载未跑完 / 探针缺失）。读数只记 ⓘ、不作阈值断言——这是**基线**，
 *   阈值待数据稳定后再钉（绝对耗时与大图形态都还没有多次读数）。
 */
async function measureRealClockWorkload({
	chromePath,
	workDir,
	diag,
	firstControlMs,
	controlProbe,
	edits,
}) {
	// 探针块在**浏览器入口**（entry）里，故负载版是另一份 entry + bundle；
	// 打包与写盘一律移出计时窗口——否则 esbuild 的时间（百毫秒级）会被误记成负载成本
	await writeFile(
		join(workDir, 'entry-perf.mjs'),
		buildEntrySource({ workloadEdits: edits, memoryProbe: true }),
		'utf8',
	);
	await build({
		entryPoints: [join(workDir, 'entry-perf.mjs')],
		outfile: join(workDir, 'bundle-perf.js'),
		bundle: true,
		format: 'iife',
		platform: 'browser',
		logLevel: 'warning',
		alias: { obsidian: join(workDir, 'obsidian-shim.mjs') },
	});
	await writeFile(
		join(workDir, 'page-perf.html'),
		buildPageSource({ bundleFile: 'bundle-perf.js' }),
		'utf8',
	);
	// 虚拟时间预算：编辑按 PERF_WORKLOAD_EDIT_GAP_MS 间隔（须 > 引擎历史防抖）⇒
	// 预算要够走完负载与收尾。虚拟等待不计真实耗时，多给不花钱；空跑与负载给同一
	// 预算，两次调用的唯一差异就只剩「编辑」本身
	const budgetMs =
		PERF_WORKLOAD_DELAY_MS + 400 + edits * PERF_WORKLOAD_EDIT_GAP_MS + 3000;
	// A/B/B/A 交替各两次、取各自**最小值**：单次对比会被系统性冷热差（首次运行的
	// 冷却、profile 预热、OS 文件缓存）整片吃掉——首版单次 A→B 实测出过 −233ms 的
	// 负差值（第二次运行反而更快）。交替 + 取最小可把这类单调漂移抵掉。
	const samples = { control: [firstControlMs], load: [] };
	let loadDom = null;
	for (const variant of ['load', 'load', 'control']) {
		const isLoad = variant === 'load';
		const started = process.hrtime.bigint();
		const dom = await dumpDom(
			chromePath,
			join(workDir, isLoad ? 'page-perf.html' : 'page.html'),
			join(workDir, 'profile'),
			diag,
			{ memoryProbe: true, budgetMs },
		);
		samples[variant].push(Number(process.hrtime.bigint() - started) / 1e6);
		if (isLoad) loadDom = dom;
	}
	await diag.file('11-dom-perf-load.html', loadDom);
	const { probe, failures: parseFailures } = readProbe(
		loadDom,
		'perf-load-probe',
		'真实墙钟负载',
	);
	if (parseFailures) return parseFailures;
	if (probe.done !== true || probe.edits !== edits) {
		return [
			`真实墙钟负载未跑完（done=${String(probe.done)} / edits=${String(probe.edits)}，应 ${edits}）——负载启动延迟或虚拟时间预算不足`,
		];
	}
	const best = (list) => Math.min(...list);
	const controlMs = best(samples.control);
	const loadMs = best(samples.load);
	const deltaMs = loadMs - controlMs;
	const fmt = (list) => list.map((ms) => ms.toFixed(0)).join(' / ');
	diag.log(
		`      ⓘ 真实墙钟（${probe.nodes} 节点 / 非性能模式，A/B/B/A 取最小）：空跑 ${fmt(samples.control)}ms；负载（+${edits} 次编辑）${fmt(samples.load)}ms`,
	);
	diag.log(
		`         ⇒ ${edits} 次编辑 ≈ ${deltaMs.toFixed(0)}ms（平均 ${(deltaMs / edits).toFixed(1)}ms/次；每次 = 一次整树渲染）${deltaMs <= 0 ? '——差值为负说明噪声仍大于负载成本，请加大 --perf-edits' : ''}`,
	);
	return checkLongSessionMemory({
		control: controlProbe?.memory ?? null,
		load: probe.memory ?? null,
		edits,
		diag,
	});
}

/**
 * 长会话内存读数与硬断言（2026-09-17，承 K58/K61/K63/K66）。
 *
 * 为什么需要：「一次动作至多一次布局落地」（K61）与「单次渲染 ≲0.6ms」（K63）都
 * 只覆盖**单次**动作，而**连续编辑**会不会留下结构残留（离屏测量元素堆积、段缓存
 * 无界增长、历史不停追加）没有口径——这些缺陷功能上完全正确、单测也全绿，只在
 * 长会话里以内存 / 延迟渐进的形式出现。
 *
 * 四条硬断言都与时钟、平台噪声无关，故可作闸门：① 离屏测宽元素 ≤1（引擎约定
 * 单元素复用，>1 即渲染路径在新建）；② 命令历史条数 ≤ 上限；③ 上限 == 插件按
 * 30MB 预算反推的 `resolveHistoryLimit(节点数)`（`engine/mindmap`，K66）——等于
 * 引擎默认 500 即「预算没应用」，且负载编辑数 > 上限时还须**恰好**等于上限
 * （满仓逐条裁剪）与快照堆 ≈ 字符数 × 2 ≤ 预算（默认编辑数 300 > 500 节点图的
 * 163 条，故三条预算断言在默认 `--perf` 下即生效）；④ 段序列缓存 size ≤ max
 * （LRU 淘汰失效即红）。
 * 原始堆与 DOM 数字只记 ⓘ：跨机器可比性差，噪声大于真实差异，先做基线不设阈值
 * （预算断言走「字符数 × 2」的确定性换算，不是原始堆读数）。
 */
function checkLongSessionMemory({ control, load, edits, diag }) {
	const after = load?.after ?? null;
	if (!after) {
		return [
			'长会话内存采样缺失（负载探针未带 memory：需 entry 侧 memoryProbe 与 --js-flags=--expose-gc）',
		];
	}
	const failures = [];
	const fmtMb = (bytes) =>
		typeof bytes === 'number' ? `${(bytes / 1048576).toFixed(1)}MB` : 'n/a';
	const fmt = (mem) =>
		mem
			? `DOM ${mem.elements}（测量 ${mem.measureEls}）/ 堆 ${fmtMb(mem.heapBytes)} / 历史 ${String(mem.historyCount)} 条 ${fmtMb(mem.historyBytes)}（上限 ${String(mem.historyCap)}）/ 段缓存 ${mem.segments.size}（上限 ${mem.segments.max}）`
			: 'n/a';
	diag.log('      ⓘ 长会话内存（500 节点 / 非性能模式，强制 GC 后采样）');
	if (control) diag.log(`         空跑 settle 后：${fmt(control.after)}`);
	if (load.baseline) diag.log(`         负载 settle 后：${fmt(load.baseline)}`);
	diag.log(`         编辑后：　　　${fmt(after)}`);
	// 每次编辑的归属：堆增长里有多少是历史快照（引擎每步存的整树 JSON），
	// DOM 增长落在哪类元素上——「值不值得优化、优化谁」就看这一行。
	//
	// 读数的已知解释（2026-09-17 实测，勿误判为泄漏）：DOM 增长来自**富节点从自绘
	// 切回引擎 SVG 渲染**——本负载用引擎级 `setNodeText`（只改 `data.text`，不同步
	// `mdRaw` 等行内字段）⇒ `shouldSelfDrawNode` 判为非接管，引擎改渲染文本 + 链接
	// 图标：实测 div −1 与 g / path / rect / text / tspan 各 +1。生产路径的原文写回
	// 会重建行内字段（见 K54 / `view-node-actions`），不会触发该切换。
	if (load.baseline && typeof after.heapBytes === 'number') {
		const steps = Math.max(1, edits);
		const heapPer = (after.heapBytes - load.baseline.heapBytes) / steps;
		const histPer =
			typeof after.historyBytes === 'number' &&
			typeof load.baseline.historyBytes === 'number'
				? (after.historyBytes - load.baseline.historyBytes) / steps
				: null;
		const elemPer = (after.elements - load.baseline.elements) / steps;
		const deltaOf = (key) =>
			typeof after[key] === 'number' && typeof load.baseline[key] === 'number'
				? after[key] - load.baseline[key]
				: null;
		diag.log(
			`         ⇒ 每次编辑：堆 +${fmtMb(heapPer)}（其中历史快照 ${histPer === null ? 'n/a' : `+${fmtMb(histPer)}`}）；` +
				`DOM ${elemPer >= 0 ? '+' : ''}${elemPer.toFixed(1)} 元素/次（共 ${steps} 次）`,
		);
		diag.log(
			`         ⇒ DOM 归属：节点组 ${deltaOf('gSmmNodes')} / 全部 g ${deltaOf('allGs')} / 路径 ${deltaOf('paths')} / rect ${deltaOf('rects')} / text ${deltaOf('texts')} / tspan ${deltaOf('tspans')} / div ${deltaOf('divs')}`,
		);
	}
	if (after.measureEls > 1) {
		failures.push(
			`编辑后离屏测宽元素 ${after.measureEls} 个（引擎约定单元素复用，>1 即渲染路径在新建）`,
		);
	}
	if (
		typeof after.historyCount === 'number' &&
		typeof after.historyCap === 'number' &&
		after.historyCount > after.historyCap
	) {
		failures.push(
			`命令历史 ${after.historyCount} 条超过上限 ${after.historyCap}（撤销栈未被裁剪）`,
		);
	}
	if (after.segments && after.segments.size > after.segments.max) {
		failures.push(
			`段序列缓存 ${after.segments.size} 项超过上限 ${after.segments.max}（LRU 淘汰失效）`,
		);
	}
	// —— 预算不变式（K66）：上限 = 30MB 预算反推值；满仓时确被裁剪到该值且堆在预算内 ——
	const expectedCap = load?.expectedCap ?? null;
	const budgetBytes = load?.budgetBytes ?? null;
	if (typeof after.historyCap === 'number' && typeof expectedCap === 'number') {
		if (after.historyCap !== expectedCap) {
			failures.push(
				`历史实际上限 ${after.historyCap} ≠ 预算反推值 ${expectedCap}（engine/mindmap.resolveHistoryLimit 未应用或被覆盖）`,
			);
		}
	}
	if (typeof expectedCap === 'number' && edits > expectedCap) {
		if (after.historyCount !== expectedCap) {
			failures.push(
				`历史 ${String(after.historyCount)} 条 ≠ 上限 ${expectedCap}（编辑 ${edits} 次 > 上限，应满仓并逐条裁剪）`,
			);
		}
		if (
			typeof after.historyBytes === 'number' &&
			typeof budgetBytes === 'number'
		) {
			// 快照是 JSON 字符串（UTF-16）⇒ 堆 ≈ 字符数 × 2；字符数是确定性读数，
			// 故这条预算断言无平台噪声。超预算即「上限 × 每条字节」失控——多半是
			// vendor 快照字段膨胀（此时应上调 HISTORY_SNAPSHOT_BYTES_PER_NODE）
			const heapApprox = after.historyBytes * 2;
			if (heapApprox > budgetBytes) {
				failures.push(
					`历史快照堆 ≈ ${fmtMb(heapApprox)} 超过预算 ${fmtMb(budgetBytes)}（上限 ${expectedCap} 条 × 每条 ${fmtMb(after.historyBytes / Math.max(1, after.historyCount))}：快照体积漂移？）`,
				);
			}
		}
	}
	if (
		typeof after.historyBytes === 'number' &&
		typeof expectedCap === 'number' &&
		after.historyCount > 0
	) {
		const perEntry = after.historyBytes / after.historyCount;
		diag.log(
			`         ⇒ 历史每条 ${fmtMb(perEntry)} 字符；满仓（上限 ${expectedCap} 条）堆投影 ≈ ${fmtMb(perEntry * expectedCap * 2)}（预算 ${fmtMb(budgetBytes)}）`,
		);
	}
	if (
		typeof after.heapBytes === 'number' &&
		typeof load.baseline?.heapBytes === 'number'
	) {
		const growth = after.heapBytes - load.baseline.heapBytes;
		diag.log(
			`         ⇒ 编辑后堆变化 ${fmtMb(growth)}（含引擎为每次编辑保存的整树快照，属预期；仅记 ⓘ）`,
		);
	}
	return failures;
}

async function main() {
	const chromePath = findChrome();
	const logDirArg = argValue('--log-dir');
	const logDir = logDirArg ? resolve(ROOT, logDirArg) : null;
	if (logDir) await mkdir(logDir, { recursive: true });
	const diag = createDiagnostics(logDir, chromePath);

	if (!chromePath) {
		const message =
			'未找到 Chrome：设 CHROME_PATH 或安装 Chrome 后重试（本项验证依赖真实浏览器渲染）';
		if (ARGS.has('--require-chrome')) {
			diag.log(`✗ ${message}`);
			await diag.flush({ result: 'failed: no chrome' });
			process.exitCode = 1;
			return;
		}
		diag.log(`⚠ 跳过视觉验证：${message}`);
		await diag.flush({ result: 'skipped: no chrome' });
		return;
	}

	const workDir = await mkdtemp(join(tmpdir(), 'mindmap-verify-'));
	let failed = null;
	let crash = null;
	try {
		diag.log(`无头渲染契约验证（Chrome: ${chromePath}）`);
		await writeFile(
			join(workDir, 'entry.mjs'),
			// 空跑也带内存采样（--perf）：负载与空跑必须同形状，差值才可归因
			buildEntrySource({ memoryProbe: ARGS.has('--perf') }),
			'utf8',
		);
		await writeFile(join(workDir, 'page.html'), buildPageSource(), 'utf8');
		// obsidian 只发布类型声明（无运行时 JS）：本页要加载的模块图里凡 import
		// 'obsidian' 的（view-wikilink → view-link-navigator → links-resolve 等，
		// 见 OBSIDIAN_SHIM_SOURCE）都别名到一个最小垫片，否则打包直接失败。
		await writeFile(
			join(workDir, 'obsidian-shim.mjs'),
			OBSIDIAN_SHIM_SOURCE,
			'utf8',
		);
		await build({
			entryPoints: [join(workDir, 'entry.mjs')],
			outfile: join(workDir, 'bundle.js'),
			bundle: true,
			format: 'iife',
			platform: 'browser',
			logLevel: 'warning',
			// 别名而非 external：external 会在浏览器里留下无法解析的裸导入
			alias: { obsidian: join(workDir, 'obsidian-shim.mjs') },
		});
		diag.log('  · 浏览器入口已打包，启动无头 Chrome');

		const controlStart = process.hrtime.bigint();
		const dom = await dumpDom(
			chromePath,
			join(workDir, 'page.html'),
			join(workDir, 'profile'),
			diag,
			{ memoryProbe: ARGS.has('--perf') },
		);
		const controlMs = Number(process.hrtime.bigint() - controlStart) / 1e6;
		// 完整 dump-dom 归档：失败时这是唯一能离线复现 DOM 现场的东西
		await diag.file('10-dom.html', dom);

		failed = await runChecks(dom, diag);

		// 真实墙钟基线（opt-in：默认不跑，避免给常规校验加一次重页面渲染）
		if (ARGS.has('--perf')) {
			const parsedEdits = Number.parseInt(argValue('--perf-edits') ?? '', 10);
			const edits =
				Number.isFinite(parsedEdits) && parsedEdits > 0
					? parsedEdits
					: PERF_WORKLOAD_EDITS_DEFAULT;
			diag.log(
				'  · 进入真实墙钟模式（--perf）：同一页再跑三次（负载 ×2 / 空跑 ×1，取最小）',
			);
			// 空跑的内存读数取自上面这次常规运行（同页同形状，仅不编辑）
			const { probe: controlProbe } = readProbe(
				dom,
				'perf-load-probe',
				'空跑内存',
			);
			const perfFailures = await measureRealClockWorkload({
				chromePath,
				workDir,
				diag,
				firstControlMs: controlMs,
				controlProbe,
				edits,
			});
			diag.log(
				`  ${perfFailures.length === 0 ? '✓' : '✗'} perf-clock 真实墙钟基线（空跑 vs 负载之差 = N 次整树渲染的真实成本）`,
			);
			for (const failure of perfFailures) diag.log(`      - ${failure}`);
			failed += perfFailures.length;
		}
	} catch (error) {
		crash = error;
		failed = null;
	} finally {
		await diag.flush({
			result: crash ? 'crashed' : failed ? `failed: ${failed} assertions` : 'passed',
			workDir,
		});
		if (ARGS.has('--keep')) {
			console.log(`临时目录已保留：${workDir}`);
		} else {
			await rm(workDir, { recursive: true, force: true });
		}
		if (logDir) console.log(`诊断日志已写入：${logDir}`);
	}

	if (crash) {
		console.error(`✗ verify:visual 异常：${crash?.stack ?? String(crash)}`);
		process.exitCode = 1;
		return;
	}
	if (failed > 0) {
		console.error(`\n✗ 视觉验证失败：${failed} 项断言未通过`);
		process.exitCode = 1;
		return;
	}
	console.log('\n✓ 视觉验证通过');
}

await main();
