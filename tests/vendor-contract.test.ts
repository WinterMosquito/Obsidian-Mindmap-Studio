/**
 * vendor 契约冒烟测试：vendor/simple-mind-map.cjs ↔ vendor/simple-mind-map.d.cts ↔ src 引用面。
 *
 * 背景：vendor/simple-mind-map.cjs 是预打包压缩产物（esbuild --bundle --minify，
 * 属性名/字符串字面量均不混淆），d.cts 为手写类型声明（只声明本插件用到的面）。
 * 引擎升级时两者都可能漂移，本文件把三层契约钉死在**真实产物**上
 * （vendor/BUILD.md 升级流程第 5 步：任一断言失败即契约漂移，先对照更新
 * d.cts 与 mindmap.ts 防腐层，再继续）：
 *
 * 1. 产物存在性与导出面：能加载真实 bundle，导出类与 d.cts 声明**双向**一致；
 * 2. 原型面：d.cts 声明的每个 MindMap 方法 + src 直接调用的引擎入口都在原型上；
 * 3. 命令名：ENGINE_COMMANDS 全表每个名字都在 bundle 中以 `command.add("NAME",`
 *    形态被真实注册（断言注册形态而非裸子串——'BACK' 之类短名裸匹配会命中无关标识符）；
 * 4. 内部字段：防腐收口触碰的引擎内部形态（renderer/view/opt/search/doExport/drag）
 *    令牌逐一存在；
 * 5. 事件名：src 监听的每个引擎事件都在 bundle 中以 `emit("NAME"` 形态派发
 *    （事件名写错时监听会静默失效：右键菜单/拖拽/悬停预览/状态栏计数全哑）。
 *
 * 已核实的「非契约」事实（勿按漂移处理，详见 vendor/BUILD.md）：
 * - 引擎不在节点 DOM 上写 data-uid 属性（findNodeByDom 走 group 身份匹配）；
 * - bundle 顶层求值即探测全屏 API（触碰 document.documentElement），纯 Node 环境
 *   加载前必须先打最小 document 桩（见下方，vitest 每文件环境隔离，桩不外泄）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// —— 在任何 vendor 加载之前打桩 ——
// 静态 import 会先于本语句执行，故 src/vendor 全部经动态 import / createRequire 加载。
const globalStub = globalThis as unknown as { document?: unknown };
globalStub.document ??= { documentElement: {} };

// 经 src 的 import 链加载真实 bundle（与下方 createRequire 命中同一 CJS 实例）
const { ENGINE_COMMANDS } = await import('../src/engine/mindmap');

const VENDOR_DIR = path.resolve(import.meta.dirname, '..', 'vendor');
const BUNDLE_PATH = path.join(VENDOR_DIR, 'simple-mind-map.cjs');
const DCTS_PATH = path.join(VENDOR_DIR, 'simple-mind-map.d.cts');

const bundleSource = readFileSync(BUNDLE_PATH, 'utf8');
const dctsSource = readFileSync(DCTS_PATH, 'utf8');
const vendor = createRequire(import.meta.url)(BUNDLE_PATH) as Record<string, unknown>;

/** d.cts 声明的导出类名 */
const declaredClasses = [...dctsSource.matchAll(/export class (\w+)/g)].map((m) => m[1]!);
/** d.cts 中 MindMap 类体（到下一个导出类为止） */
const mindMapChunk = dctsSource.slice(
	dctsSource.indexOf('export class MindMap {'),
	dctsSource.indexOf('export class DoExport'),
);
/** d.cts 声明的 MindMap 方法名（tab 缩进行首的 `name(`，排除 constructor） */
const declaredMethods = [...mindMapChunk.matchAll(/^\t(\w+)\(/gm)]
	.map((m) => m[1]!)
	.filter((name) => name !== 'constructor');
/** bundle 真实导出中的可 new 构造函数 */
const bundleExports = Object.keys(vendor).filter(
	(name) => typeof vendor[name] === 'function',
);
const mindMapPrototype = (vendor.MindMap as { prototype: Record<string, unknown> })
	.prototype;

/**
 * 产物**字节级**身份（sha256，小写十六进制）——**按 LF 归一后**计算。
 *
 * 存在的理由：本文件其余断言都钉在「API 面」上（导出类 / 原型方法 / 命令名 /
 * 事件名令牌），无法发现 vendor 文件被手工编辑、或被换成来源不同的同名产物——
 * 而 `vendor/BUILD.md` 明确要求「不可手工编辑，一切修改必须从包源码重新打包」。
 * 该值同时登记在 `vendor/BUILD.md` 的「来源定性」一节；
 * **重新打包后必须同步更新两处**。
 *
 * **为什么必须归一换行**（2026-09-17 实测教训，勿「修正」回原始字节）：仓库没有
 * `.gitattributes`，而检出侧 `core.autocrlf=true`（Windows）会把该文件写成 CRLF，
 * CI 的 Linux 检出得到的则是索引里的 LF——**同一提交的原始字节跨平台不同**。
 * 曾直接对原始字节取哈希：本地（CRLF，96 处）算得 `a97b0caa…`、CI（LF）算得
 * `dca4cead…`，于是**本地绿、CI 红**，发布工作流被自己的门禁拦下。
 *
 * 代价（有意接受）：纯换行符改动不再被该断言发现。但换行符差异是「检出方式」的
 * 产物而不是内容改动，两者在上游行为上等价，故不作为漂移处理。
 */
const EXPECTED_BUNDLE_SHA256 =
	'dca4ceadeea46ad003ad600aacecc328b388f3505855c83d63b4b12a300ac898';
const bundleSha256 = createHash('sha256')
	.update(readFileSync(BUNDLE_PATH, 'utf8').replace(/\r\n/g, '\n'), 'utf8')
	.digest('hex');

describe('vendor 契约：产物存在性', () => {
	it('bundle 与手写声明都在磁盘上（缺失时本文件全部断言失去意义，故先钉死）', () => {
		expect(existsSync(BUNDLE_PATH), 'vendor/simple-mind-map.cjs').toBe(true);
		expect(existsSync(DCTS_PATH), 'vendor/simple-mind-map.d.cts').toBe(true);
		// 数量级断言：防「空文件 / 被截断的产物」也能通过后续契约
		// （fix.3 实测 406,580 B）
		expect(statSync(BUNDLE_PATH).size).toBeGreaterThan(100_000);
		expect(bundleSource.length).toBeGreaterThan(100_000);
	});

	it('bundle 的 sha256（LF 归一）与 vendor/BUILD.md 登记值一致（防手工编辑与换源）', () => {
		// 失败含义：产物**内容**被改动过（手工编辑，或换了来源不同的同名产物）。
		// 若确为「按 vendor/BUILD.md 配方重新打包」，则同步更新两处常量。
		expect(bundleSha256, 'vendor/simple-mind-map.cjs 的 sha256（LF 归一）').toBe(
			EXPECTED_BUNDLE_SHA256,
		);
	});
});

describe('vendor 契约：导出面（bundle ↔ d.cts 双向一致）', () => {
	it('bundle 具名导出集合与 d.cts 声明的导出类完全一致', () => {
		expect(declaredClasses.length).toBeGreaterThan(0);
		expect([...bundleExports].sort()).toEqual([...declaredClasses].sort());
	});

	it('每个声明类都是可 new 的构造函数，且产物无 default 包装', () => {
		for (const name of declaredClasses) {
			expect(typeof vendor[name], `导出类 ${name}`).toBe('function');
		}
		// esbuild 的 CJS 具名导出产物：src 的 `import { MindMap } from '...cjs'`
		// 依赖导出挂在模块顶层而非 default 上
		expect(vendor.default).toBeUndefined();
	});
});

describe('vendor 契约：MindMap 原型面（d.cts 声明 ↔ bundle 运行时）', () => {
	it('d.cts 声明的每个方法都真实存在于 bundle 原型', () => {
		expect(declaredMethods.length).toBeGreaterThan(0);
		for (const method of declaredMethods) {
			expect(typeof mindMapPrototype[method], `原型方法 ${method}`).toBe('function');
		}
	});

	it('src/engine/mindmap.ts 直接调用的引擎入口都在原型上', () => {
		// 与 src/engine/mindmap.ts 的调用点一一对应：execCommand/emit/render/updateConfig/
		// addPlugin…；引擎改这些入口名时此处比运行期报错更早失败。
		const usedBySrc = [
			'execCommand',
			'emit',
			'on',
			'off',
			'render',
			'resize',
			'destroy',
			'addPlugin',
			'getData',
			'setData',
			// 保留历史的整树替换入口（replaceMindMapData）：引擎升级若移除它，
			// 撤销链会退回「setData 清空历史」的旧行为，必须在契约层拦住
			'updateData',
			'updateConfig',
			'setLayout',
			'setThemeConfig',
		];
		for (const method of usedBySrc) {
			expect(typeof mindMapPrototype[method], `引擎入口 ${method}`).toBe('function');
		}
	});
});

describe('vendor 契约：画布导航手势（由引擎实现，插件不得重复实现）', () => {
	// 为什么钉死：features/view-viewport.ts 只补「抑制中键自动滚动」与 Shift+1/2，
	// 滚轮平移/缩放与中键拖平移**全部依赖引擎**。若升级后引擎丢了这些行为，
	// 插件侧的手势会整体失效（而不是降级），必须在契约层先失败。
	it('滚轮：默认平移 + Ctrl/Cmd 以指针为锚缩放（createMindMap 已显式钉住两者）', () => {
		expect(bundleSource, '默认行为 = 平移').toMatch(
			/mousewheelAction:\w+\.MOUSE_WHEEL_ACTION\.MOVE/,
		);
		expect(bundleSource, 'Ctrl/Cmd+滚轮缩放未被引擎默认关闭').toMatch(
			/disableMouseWheelZoom:!1/,
		);
		expect(bundleSource, 'Ctrl/Cmd 分支与缩放同路').toMatch(
			/t\.ctrlKey\|\|t\.metaKey/,
		);
	});

	it('滚轮事件先 stopPropagation：容器级 wheel 监听收不到（重复实现即死代码）', () => {
		expect(bundleSource, '监听挂在引擎 el 上').toMatch(
			/"wheel",this\.onMousewheel/,
		);
		expect(bundleSource, '处理前先 stopPropagation + preventDefault').toMatch(
			/onMousewheel\(t\)\{t\.stopPropagation\(\),t\.preventDefault\(\)/,
		);
	});

	it('中键拖拽：引擎自置 isMiddleMousedown 并派发 drag，监听在 window（拖出画布仍跟手）', () => {
		expect(bundleSource, 'mousedown 按 which 记录中键').toMatch(
			/which===2&&\(this\.isMiddleMousedown=!0\)/,
		);
		expect(bundleSource, '中键与左键同样派发 drag').toMatch(
			/this\.isMiddleMousedown\|\|/,
		);
		expect(bundleSource, 'mousemove 监听在 window').toMatch(
			/window\.addEventListener\("mousemove",this\.onMousemove\)/,
		);
	});
});

describe('vendor 契约：两种 getData() 的语义（活引用 vs 深拷贝）', () => {
	// 为什么钉死：插件里有两条互相依赖相反语义的路径——
	// ① `Node.getData()` 返回**活引用**：帧内图片尺寸预览（previewNodeImageSize）
	//    与清标记（delete data.mdImageAutoSize）都是**就地改写**，若引擎改成返回
	//    拷贝，这些操作会静默变成 no-op（画面不跟手、尺寸不回写）；
	// ② `MindMap.getData()` 返回**深拷贝**：批量拆分（splitAllLinks）先改树再整树
	//    回灌，若变成活引用，改动会直接写进引擎渲染树而绕过渲染/历史。
	it('Node.getData() 返回活引用（不经拷贝）', () => {
		expect(bundleSource, 'Node.getData 本体形态').toMatch(
			/getData\(t\)\{return t\?this\.nodeData\.data\[t\]:this\.nodeData\.data\}/,
		);
	});

	it('MindMap.getData() 返回拷贝（走 command.getCopyData）', () => {
		expect(bundleSource, 'MindMap.getData 走 getCopyData').toMatch(
			/getData\(t\)\{let e=this\.command\.getCopyData\(\)/,
		);
	});
});

describe('vendor 契约：ENGINE_COMMANDS 命令名全表', () => {
	/** 引擎命令名权威表（0.14.0-fix.3）：新增/改名须走 vendor/BUILD.md 升级流程第 3 步 */
	const expectedCommands = [
		'BACK',
		'FORWARD',
		'CLEAR_ACTIVE_NODE',
		'INSERT_CHILD_NODE',
		'INSERT_NODE',
		'REMOVE_NODE',
		'RESET_LAYOUT',
		'SET_NODE_DATA',
		'SET_NODE_HYPERLINK',
		'SET_NODE_IMAGE',
	];

	it('常量表就是上述命令名的纯注册表（不多不少，防静默增删）', () => {
		expect([...Object.values(ENGINE_COMMANDS)].sort()).toEqual(
			[...expectedCommands].sort(),
		);
	});

	it('全表每个命令名都在 bundle 中被 command.add() 真实注册', () => {
		for (const command of Object.values(ENGINE_COMMANDS)) {
			// 断言注册形态而非裸子串：短名（BACK/FORWARD）裸匹配会命中无关标识符
			expect(
				bundleSource.includes(`command.add("${command}",`),
				`命令 ${command} 未在 bundle 中注册`,
			).toBe(true);
		}
	});
});

describe('vendor 契约：防腐层触碰的引擎内部字段', () => {
	// 与 src/engine/mindmap.ts / src/services/engine-controller.ts 的收口函数一一对应；
	// 过于泛化的短名（root / fit / jump / search / draw 等）不作令牌，避免裸匹配误报。
	const internalTokens = [
		// renderer：激活节点（getActiveNode）、强制全渲染（fit/centerContent 性能模式）、
		// 文本编辑态与编辑框 DOM（isEditingText / focusNodeTextEdit）
		'activeNodeList',
		'forceLoadNode',
		'textEdit=',
		'isShowTextEdit',
		'textEditNode',
		// view：视口存取（persistViewport/restoreOrFitViewport）与缩放（zoomIn/Out/reset）
		'setTransformData',
		'getTransformData',
		'translateXY',
		'setScale',
		'enlarge',
		'narrow',
		// 内容包围盒（centerContentAtFullScale → measureContentBox 读 draw.rbox − elRect）
		'rbox',
		'elRect',
		// Search 插件状态（getSearchMatchCount / getSearchCurrentIndex / searchNext / endSearch）
		'matchNodeList',
		'currentIndex',
		'searchNext',
		'endSearch',
		// 插件实例名：mindMap.search / mindMap.doExport / mindMap.drag 这些属性名
		// 由插件注册时的 instanceName 决定（防腐层按此访问）
		'instanceName="search"',
		'instanceName="doExport"',
		'instanceName="drag"',
		// opt 配置项（runWithExportScale / 历史上限 / 性能模式 / 拖拽与超链定制）
		'minExportImgCanvasScale',
		'maxHistoryCount',
		'openPerformance',
		'removeNodeWhenOutCanvas',
		'enableFreeDrag',
		'customHyperlinkJump',
		// Drag 落点三态（getDragDropState / setDragOverlapTarget / setDragPrevTarget）
		'overlapNode',
		'prevNode',
		'nextNode',
		'checkOverlapNode',
		'command.add("MOVE_NODE_TO"',
		'command.add("INSERT_AFTER"',
		'command.add("INSERT_BEFORE"',
		// 图片展示尺寸（setNodeImageSize / features/image-resize.ts 拖拽调宽）
		'imageSize',
		'getImgShowSize',
	];

	it('每个内部字段令牌在 bundle 中真实存在', () => {
		for (const token of internalTokens) {
			expect(bundleSource.includes(token), `内部字段 ${token}`).toBe(true);
		}
	});
});

describe('vendor 契约：插件依赖的引擎事件名', () => {
	// 每个令牌对应一处 src 的 onEngine/emit 调用点：引擎若不派发该事件，
	// 相应监听静默失效（右键菜单、拖拽换父、悬停预览、状态栏计数、图片灯箱全哑）。
	const emittedEvents = [
		'data_change', // engine-controller：保存调度 / view-status 计数
		'node_click', // view-wikilink：链接点击跳转
		'node_contextmenu', // view-context-menu：节点右键菜单
		'node_dragend', // engine-controller（图片点击抑制）/ drag-target（会话收尾）
		'node_dragging', // drag-target / image-resize：拖拽会话开始
		'node_img_click', // engine-controller：图片灯箱
		'node_img_mouseenter', // image-resize：调宽手柄显隐
		'node_img_mouseleave', // image-resize：调宽手柄显隐
		'node_mouseenter', // view-wikilink：悬停预览
		'node_attachmentClick', // engine-controller：附件双链打开（注意大写 C）
		'node_text_edit_change', // engine-controller：自动拆分候选捕获（编辑期累积）
	];

	it('每个事件名都在 bundle 中以 emit() 形态派发', () => {
		for (const event of emittedEvents) {
			expect(bundleSource.includes(`emit("${event}"`), `事件 ${event}`).toBe(true);
		}
	});

	it('node_dblclick 同时被引擎核心文本编辑监听（startNodeTextEdit 的前提）', () => {
		// startNodeTextEdit 靠 emit('node_dblclick', node, null, false) 打开编辑框：
		// bundle 内必须存在 on("node_dblclick", ...) 的监听者，否则该 emit 无人接管、
		// 编辑框不出现。listen 回调第三参即 isInserting，故必须传 false。
		expect(bundleSource.includes('emit("node_dblclick"')).toBe(true);
		expect(bundleSource.includes('on("node_dblclick"')).toBe(true);
		expect(bundleSource.includes('isInserting')).toBe(true);
	});
});
