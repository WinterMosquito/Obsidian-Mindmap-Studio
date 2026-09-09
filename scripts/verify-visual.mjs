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
 * --dump-dom 输出逐场景断言。临时文件全部落在系统临时目录，验证后清理。
 *
 * 用法：
 *   npm run verify:visual                 # 无 Chrome 时跳过（退出码 0）
 *   npm run verify:visual -- --require-chrome   # 无 Chrome 时失败
 *   npm run verify:visual -- --keep        # 保留临时目录（排查用）
 *   CHROME_PATH=/path/to/chrome npm run verify:visual
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARGS = new Set(process.argv.slice(2));

/** 每个场景渲染「根 + 一个子节点」，断言集中在子节点上（根节点作为无图标对照） */
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
		);
	} else if (process.platform === 'darwin') {
		candidates.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		);
	} else {
		candidates.push(
			'/usr/bin/google-chrome',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
		);
	}
	return candidates.find((path) => path && existsSync(path)) ?? null;
}

/** 生成浏览器入口：按场景逐个渲染导图（与插件同款容器类名） */
function buildEntrySource() {
	const mindmapModule = join(ROOT, 'src', 'mindmap.ts').replaceAll('\\', '/');
	return `import { centerRootAtFullScale, createMindMap, resetZoom } from ${JSON.stringify(mindmapModule)};

const scenarios = ${JSON.stringify(
		SCENARIOS.map(({ name, data }) => ({ name, data })),
		null,
		'\t',
	)};

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

// —— 默认视口探针：打开时的默认视口应为 100% 缩放 + 根节点居中 ——
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
	centerRootAtFullScale(viewportMap);
	const state = viewportMap.view.getTransformData().state;
	const rootEl = viewportMap.renderer.root.group.node;
	const rootRect = rootEl.getBoundingClientRect();
	const canvasRect = viewportHolder.getBoundingClientRect();
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
		rootCenter: [
			Math.round(rootRect.left + rootRect.width / 2 - canvasRect.left),
			Math.round(rootRect.top + rootRect.height / 2 - canvasRect.top),
		],
		canvas: [Math.round(canvasRect.width), Math.round(canvasRect.height)],
		resetScale: reset.scale,
		resetDrift: Math.round(drift * 100) / 100,
	});
} catch (error) {
	probe.textContent = JSON.stringify({ error: String(error) });
}
document.body.appendChild(probe);
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

/** 用无头 Chrome 渲染并取回序列化 DOM（--headless=old 不可用时回退 new） */
async function dumpDom(chromePath, pagePath, profileDir) {
	const common = [
		'--disable-gpu',
		'--no-sandbox',
		'--disable-extensions',
		'--hide-scrollbars',
		'--allow-file-access-from-files',
		'--force-device-scale-factor=1',
		'--window-size=1400,900',
		'--virtual-time-budget=8000',
		`--user-data-dir=${profileDir}`,
	];
	const modes = ['--headless=old', '--headless=new'];
	let lastError = null;
	for (const mode of modes) {
		try {
			const { stdout } = await execFileAsync(
				chromePath,
				[mode, ...common, '--dump-dom', pagePath],
				{ maxBuffer: 64 * 1024 * 1024, windowsHide: true },
			);
			if (stdout.includes('id="map-')) return stdout;
			lastError = new Error(
				`Chrome ${mode} 输出不含导图 DOM（长度 ${stdout.length}）`,
			);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError ?? new Error('Chrome 渲染失败');
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
	const docIconTag = fragment.match(/<svg[^>]*mindmap-wiki-doc-icon[^>]*>/)?.[0] ?? null;
	const attachTitle = fragment.match(/<svg cursor="pointer"[^>]*><title>([^<]*)<\/title>/)?.[1] ?? null;
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

/**
 * 校验默认视口探针（由入口脚本写入 `#viewport-probe`，见 buildEntrySource）：
 * 打开导图时应为 100% 缩放且根（中心）节点落在画布中心附近。
 */
function checkViewport(dom) {
	const raw = dom
		.match(/<pre id="viewport-probe">([\s\S]*?)<\/pre>/)?.[1]
		?.replaceAll('&quot;', '"')
		.replaceAll('&amp;', '&');
	if (!raw) {
		return ['未找到视口探针（入口脚本未执行？）'];
	}
	let probe;
	try {
		probe = JSON.parse(raw);
	} catch {
		return [`视口探针 JSON 解析失败：${raw.slice(0, 120)}`];
	}
	const failures = [];
	if (typeof probe.error === 'string') {
		return [`入口脚本异常：${probe.error}`];
	}
	if (probe.scale !== 1) {
		failures.push(`缩放 ${probe.scale} ≠ 1（应为 100%）`);
	}
	const [centerX, centerY] = probe.rootCenter ?? [];
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
			`根节点中心 (${centerX},${centerY}) 未居中于画布 (${width},${height})`,
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

async function main() {
	const chromePath = findChrome();
	if (!chromePath) {
		const message =
			'未找到 Chrome：设 CHROME_PATH 或安装 Chrome 后重试（本项验证依赖真实浏览器渲染）';
		if (ARGS.has('--require-chrome')) {
			console.error(`✗ ${message}`);
			process.exit(1);
		}
		console.log(`⚠ 跳过视觉验证：${message}`);
		return;
	}

	const workDir = await mkdtemp(join(tmpdir(), 'mindmap-verify-'));
	const pagePath = join(workDir, 'page.html');
	try {
		await writeFile(join(workDir, 'entry.mjs'), buildEntrySource(), 'utf8');
		await writeFile(pagePath, buildPageSource(), 'utf8');
		await build({
			entryPoints: [join(workDir, 'entry.mjs')],
			outfile: join(workDir, 'bundle.js'),
			bundle: true,
			format: 'iife',
			platform: 'browser',
			logLevel: 'warning',
		});

		const dom = await dumpDom(chromePath, pagePath, join(workDir, 'profile'));

		let failed = 0;
		console.log(`无头渲染契约验证（Chrome: ${chromePath}）`);
		for (const scenario of SCENARIOS) {
			const failures = checkScenario(scenario, containerOf(dom, scenario.name));
			const mark = failures.length === 0 ? '✓' : '✗';
			const metrics = containerOf(dom, scenario.name);
			const width = metrics ? measure(metrics).childWidth : null;
			console.log(
				`  ${mark} ${scenario.name.padEnd(7)} ${scenario.label}（子节点测宽 ${width}）`,
			);
			for (const failure of failures) {
				console.log(`      - ${failure}`);
			}
			failed += failures.length;
		}
		// 默认视口契约：100% 缩放 + 根节点居中（打开大图时文字可读）
		const viewportFailures = checkViewport(dom);
		console.log(
			`  ${viewportFailures.length === 0 ? '✓' : '✗'} viewport 默认视口 100% + 根节点居中`,
		);
		for (const failure of viewportFailures) {
			console.log(`      - ${failure}`);
		}
		failed += viewportFailures.length;
		if (failed > 0) {
			console.error(`\n✗ 视觉验证失败：${failed} 项断言未通过`);
			process.exitCode = 1;
			return;
		}
		console.log('\n✓ 视觉验证通过');	} finally {
		if (ARGS.has('--keep')) {
			console.log(`临时目录已保留：${workDir}`);
		} else {
			await rm(workDir, { recursive: true, force: true });
		}
	}
}

await main();
