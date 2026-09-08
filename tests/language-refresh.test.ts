/**
 * 语言变更后的入口文案刷新回归：
 * - commands.ts `refreshCommandLabels`：命令面板按 id 先移除再重注册（面板缓存
 *   注册时的 name），丝带图标就地更新 aria-label（官方无移除 API）；
 * - status-bar.ts `ElementStatusBarService.showNodeCount`：单复数分键
 *   （en "1 node" / "3 nodes"，zh 两键同文）。
 *
 * 语言切换由设置面板触发（settings.setControlValue → refreshLanguageUi），
 * 本测试直接验证这两处入口的刷新语义。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { Language } from '../src/i18n';
import { t } from '../src/i18n';
import { ElementStatusBarService } from '../src/status-bar';
import {
	addMindMapRibbonIcon,
	refreshCommandLabels,
	registerCommands,
} from '../src/commands';

// commands.ts 经 view.ts 加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

/** 命令注册桩（记录 id → name，removeCommand 删除） */
interface CommandRecord {
	id: string;
	name: string;
}

interface PluginHarness {
	readonly plugin: Parameters<typeof registerCommands>[0];
	readonly commands: Map<string, CommandRecord>;
	readonly ribbon: { icon: string; title: string }[];
	readonly ribbonEl: { attrs: Record<string, string>; setAttribute(k: string, v: string): void };
	/** 切换语言（模拟设置面板写回后的活引用变化） */
	setLang(lang: Language): void;
}

function makePlugin(lang: Language): PluginHarness {
	const commands = new Map<string, CommandRecord>();
	const ribbon: { icon: string; title: string }[] = [];
	const ribbonEl = {
		attrs: {} as Record<string, string>,
		setAttribute(key: string, value: string): void {
			this.attrs[key] = value;
		},
	};
	const settings = { language: lang };
	const plugin = {
		settings,
		app: {} as App,
		addCommand: (command: CommandRecord): CommandRecord => {
			commands.set(command.id, command);
			return command;
		},
		removeCommand: (id: string): void => {
			commands.delete(id);
		},
		addRibbonIcon: (icon: string, title: string): typeof ribbonEl => {
			ribbon.push({ icon, title });
			return ribbonEl;
		},
	} as unknown as Parameters<typeof registerCommands>[0];
	return {
		plugin,
		commands,
		ribbon,
		ribbonEl,
		setLang: (next: Language): void => {
			settings.language = next;
		},
	};
}

describe('refreshCommandLabels（语言变更后重注册命令与丝带提示）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('重注册后命令数量不变，name 跟随新语言', () => {
		const harness = makePlugin('zh');
		registerCommands(harness.plugin);
		const zhName = harness.commands.get('create-new-mindmap')?.name;
		expect(zhName).toBe(t('zh', 'command.createMindMap'));

		harness.setLang('en');
		refreshCommandLabels(
			harness.plugin,
			harness.ribbonEl as unknown as HTMLElement,
		);

		// 数量不变（先移除再注册，不产生重复）
		expect(harness.commands.size).toBe(8);
		expect(harness.commands.get('create-new-mindmap')?.name).toBe(
			t('en', 'command.createMindMap'),
		);
		expect(harness.commands.get('mindmap-fit-view')?.name).toBe(
			t('en', 'command.fitCanvas'),
		);
	});

	it('丝带图标提示就地更新为当前语言（不新增图标）', () => {
		const harness = makePlugin('zh');
		addMindMapRibbonIcon(harness.plugin);
		expect(harness.ribbon).toHaveLength(1);

		harness.setLang('en');
		refreshCommandLabels(
			harness.plugin,
			harness.ribbonEl as unknown as HTMLElement,
		);

		expect(harness.ribbonEl.attrs['aria-label']).toBe(
			t('en', 'command.createMindMap'),
		);
		// 官方无 removeRibbonIcon：元素复用，不重复创建
		expect(harness.ribbon).toHaveLength(1);
	});

	it('无丝带元素时不抛异常（图标创建失败/未就绪）', () => {
		const harness = makePlugin('en');
		registerCommands(harness.plugin);
		expect(() => refreshCommandLabels(harness.plugin, null)).not.toThrow();
	});
});

describe('ElementStatusBarService.showNodeCount（单复数）', () => {
	function makeService(lang: Language) {
		const texts: string[] = [];
		const el = {
			setText: (text: string): void => {
				texts.push(text);
			},
		} as unknown as HTMLElement;
		return {
			texts,
			service: new ElementStatusBarService(() => el, () => lang),
		};
	}

	it('英文单复数分键：1 node / 3 nodes', () => {
		const { service, texts } = makeService('en');
		service.showNodeCount(1);
		service.showNodeCount(3);
		expect(texts).toEqual(['1 node', '3 nodes']);
	});

	it('中文两键同文：个节点', () => {
		const { service, texts } = makeService('zh');
		service.showNodeCount(1);
		service.showNodeCount(12);
		expect(texts).toEqual(['1 个节点', '12 个节点']);
	});

	it('元素缺失（onunload 后）静默跳过', () => {
		const service = new ElementStatusBarService(() => null, () => 'en');
		expect(service.available).toBe(false);
		expect(() => service.showNodeCount(5)).not.toThrow();
	});
});
