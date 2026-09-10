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
 * - 不覆盖：样式级联的极端回归。历史上有害规则
 *   `.mindmap-canvas-container > div{width:100%}` 只在 richText/foreignObject
 *   渲染路径下放大测宽，该路径已随节点内 Markdown 渲染一并删除，当前架构下
 *   已无法复现（测量元素挂在 body 下，不经容器子 div）。
 *
 * 做法：esbuild 把 `src/mindmap.ts`（纯模块，无 obsidian 依赖）打成浏览器
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

/** 生成浏览器入口：按场景逐个渲染导图（与插件同款容器类名） */
function buildEntrySource() {
	const mindmapModule = join(ROOT, 'src', 'mindmap.ts').replaceAll('\\', '/');
	const wikilinkModule = join(ROOT, 'src', 'features', 'view-wikilink.ts').replaceAll(
		'\\',
		'/',
	);
	const serialized = JSON.stringify(
		SCENARIOS.map(({ name, data }) => ({ name, data })),
		null,
		'\t',
	);
	return `import { centerContentAtFullScale, createMindMap, resetZoom } from ${JSON.stringify(mindmapModule)};
import { ensureOffsetSize } from ${JSON.stringify(wikilinkModule)};

const scenarios = ${serialized};

const options = {
	layout: 'logicalStructure',
	themePref: 'default',
	isDark: false,
	enableDrag: true,
	performanceMode: false,
	performanceThreshold: 1000,
	lang: 'zh',
	onHyperlinkJump: null,
};

for (const { name, data } of scenarios) {
	const holder = document.createElement('div');
	holder.id = 'map-' + name;
	// 与 view.ts 一致：canvasEl 同时带 mindmap-canvas-container 与引擎容器类名
	holder.className = 'mindmap-canvas-container';
	holder.style.width = '1200px';
	holder.style.height = '400px';
	document.body.appendChild(holder);
	createMindMap(
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

// 与插件同款时序：引擎 render() 后首帧异步完成，视口设置在延时后执行
window.setTimeout(() => {
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
}, 150);
`;
}

/** 生成承载页：加载仓库真实 styles.css（CSS 级联回归是本脚本的验证目标之一） */
function buildPageSource() {
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
		<script src="bundle.js"></script>
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

/** 单次 Chrome 调用的参数（`--dump-dom` 之外的部分） */
function chromeArgs(profileDir) {
	return [
		'--disable-gpu',
		'--no-sandbox',
		'--disable-dev-shm-usage',
		'--disable-extensions',
		'--hide-scrollbars',
		'--allow-file-access-from-files',
		'--force-device-scale-factor=1',
		'--window-size=1400,900',
		'--virtual-time-budget=8000',
		`--user-data-dir=${profileDir}`,
	];
}

/**
 * 用无头 Chrome 渲染并取回序列化 DOM。
 *
 * 依次尝试 `--headless=old` / `--headless=new`（老版本 Chrome 不支持 new），
 * 每个模式再重试一次——无头渲染在 CI 上有偶发空白输出的历史。
 * 每次尝试的退出码与 stderr 尾部都会进诊断日志。
 */
async function dumpDom(chromePath, pagePath, profileDir, diag) {
	const args = chromeArgs(profileDir);
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
		nodeCount: [...fragment.matchAll(/class="smm-node"/g)].length,
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

	// 悬停预览锚定契约：SVG 节点补齐 offsetWidth/offsetHeight（弹窗可上下翻转）
	diag.log('  · viewport 探针完成，进入 anchor 探针');
	const anchorFailures = safe('anchor 探针', () => checkAnchor(dom));
	diag.log(
		`  ${anchorFailures.length === 0 ? '✓' : '✗'} anchor  SVG 节点盒模型尺寸补齐（弹窗可上下翻转）`,
	);
	for (const failure of anchorFailures) diag.log(`      - ${failure}`);
	failed += anchorFailures.length;

	return failed;
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
		await writeFile(join(workDir, 'entry.mjs'), buildEntrySource(), 'utf8');
		await writeFile(join(workDir, 'page.html'), buildPageSource(), 'utf8');
		await build({
			entryPoints: [join(workDir, 'entry.mjs')],
			outfile: join(workDir, 'bundle.js'),
			bundle: true,
			format: 'iife',
			platform: 'browser',
			logLevel: 'warning',
		});
		diag.log('  · 浏览器入口已打包，启动无头 Chrome');

		const dom = await dumpDom(
			chromePath,
			join(workDir, 'page.html'),
			join(workDir, 'profile'),
			diag,
		);
		// 完整 dump-dom 归档：失败时这是唯一能离线复现 DOM 现场的东西
		await diag.file('10-dom.html', dom);

		failed = await runChecks(dom, diag);
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
