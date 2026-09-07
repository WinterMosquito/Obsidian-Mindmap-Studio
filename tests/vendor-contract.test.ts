/**
 * vendor 契约冒烟测试（P2#6）：simple-mind-map.cjs ↔ simple-mind-map.d.cts ↔ src 引用面。
 *
 * 背景：vendor/simple-mind-map.cjs 是预打包压缩产物（esbuild --minify，属性名不混淆），
 * d.cts 为手写类型声明（只声明插件用到的面）。引擎升级时两者都可能漂移——
 * 本测试锁定三层契约，升级 vendor 后跑一次即知（vendor/BUILD.md 升级流程第 5 步）：
 *
 * 1. 模块加载：最小 document 桩下能加载真实 bundle，且导出类与 d.cts 声明完全一致
 *    （曾借此发现 d.cts 多声明的 THEME 在 bundle 中并不存在，已删除声明）；
 * 2. 原型面：d.cts 声明的每个 MindMap 方法都真实存在于 bundle 原型；
 * 3. 令牌扫描：ENGINE_COMMANDS 全表命令名、防腐层触碰的引擎内部字段、
 *    插件依赖的引擎事件名，在 bundle 文本中逐一存在（压缩产物不混淆属性名与
 *    字符串字面量，令牌消失即契约漂移）。
 *
 * 已核实的「非契约」事实（勿当回归处理）：
 * - 引擎不在节点 DOM 上写 data-uid 属性（findNodeByDom 已改为 group 身份匹配）；
 * - bundle 顶层求值需要 document.documentElement 存在（全屏 API 探测），
 *   本文件顶部打最小桩后动态加载（vitest 每个测试文件环境隔离，桩不外泄）。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// —— 在任何 vendor 加载之前打桩（静态 import 会先于本语句执行，故全部动态导入）——
const globalStub = globalThis as unknown as { document?: unknown };
globalStub.document ??= { documentElement: {} };

const { ENGINE_COMMANDS } = await import('../src/mindmap');

const VENDOR_DIR = path.resolve(import.meta.dirname, '..', 'vendor');
const vendorRequire = createRequire(import.meta.url);
const bundleSource = readFileSync(path.join(VENDOR_DIR, 'simple-mind-map.cjs'), 'utf8');
const dctsSource = readFileSync(path.join(VENDOR_DIR, 'simple-mind-map.d.cts'), 'utf8');
const vendor = vendorRequire(path.join(VENDOR_DIR, 'simple-mind-map.cjs')) as Record<
	string,
	unknown
>;

/** d.cts 声明的导出类名 */
const declaredClasses = [...dctsSource.matchAll(/export class (\w+)/g)].map((m) => m[1]!);
/** d.cts 中 MindMap 类体（到下一个导出类为止） */
const mindMapChunk = dctsSource.slice(
	dctsSource.indexOf('export class MindMap {'),
	dctsSource.indexOf('export class DoExport'),
);
/** d.cts 声明的 MindMap 方法名（排除 constructor） */
const declaredMethods = [...mindMapChunk.matchAll(/^\t(\w+)\(/gm)]
	.map((m) => m[1]!)
	.filter((name) => name !== 'constructor');

const mindMapCtor = vendor.MindMap as { prototype: Record<string, unknown> };

describe('vendor 契约冒烟：模块加载与导出面', () => {
	it('bundle 导出类与 d.cts 声明完全一致（双向防漂移）', () => {
		const bundleExports = Object.keys(vendor).filter(
			(name) => typeof vendor[name] === 'function',
		);
		expect([...bundleExports].sort()).toEqual([...declaredClasses].sort());
		for (const name of declaredClasses) {
			expect(typeof vendor[name], `导出类 ${name}`).toBe('function');
		}
	});

	it('d.cts 声明的 MindMap 方法都存在于 bundle 原型', () => {
		expect(declaredMethods.length).toBeGreaterThan(0);
		for (const method of declaredMethods) {
			expect(typeof mindMapCtor.prototype[method], `原型方法 ${method}`).toBe(
				'function',
			);
		}
	});
});

describe('vendor 契约冒烟：引擎命令名（ENGINE_COMMANDS 全表）', () => {
	it('每个命令名在 bundle 中真实存在', () => {
		const commands = Object.values(ENGINE_COMMANDS);
		expect(commands.length).toBeGreaterThan(0);
		for (const command of commands) {
			expect(bundleSource.includes(command), `命令 ${command}`).toBe(true);
		}
	});
});

describe('vendor 契约冒烟：防腐层触碰的引擎内部字段', () => {
	// 与 src/mindmap.ts / engine-controller.ts 防腐收口一一对应；
	// 过于泛化的短名（root/fit/jump/search 等）不作令牌，避免误报。
	const internalShapeTokens = [
		// renderer：激活节点列表 / 强制全渲染 / 文本编辑态
		'activeNodeList',
		'forceLoadNode',
		'textEdit',
		'isShowTextEdit',
		// view：视口存取与缩放
		'setTransformData',
		'getTransformData',
		'enlarge',
		'narrow',
		// search 插件：命中列表与游标
		'matchNodeList',
		'currentIndex',
		'searchNext',
		'endSearch',
		// opt 配置项：导出倍率 / 历史上限 / 性能模式 / 拖拽与超链定制
		'minExportImgCanvasScale',
		'maxHistoryCount',
		'openPerformance',
		'removeNodeWhenOutCanvas',
		'enableFreeDrag',
		'customHyperlinkJump',
	];

	it('每个内部字段令牌在 bundle 中真实存在', () => {
		for (const token of internalShapeTokens) {
			expect(bundleSource.includes(token), `内部字段 ${token}`).toBe(true);
		}
	});
});

describe('vendor 契约冒烟：插件依赖的引擎事件名', () => {
	const eventTokens = [
		'data_change',
		'node_click',
		'node_contextmenu',
		'node_dblclick',
		'node_dragend',
		'node_img_click',
		'node_mouseenter',
	];

	it('每个引擎事件名在 bundle 中真实存在', () => {
		for (const token of eventTokens) {
			expect(bundleSource.includes(token), `事件 ${token}`).toBe(true);
		}
	});
});
