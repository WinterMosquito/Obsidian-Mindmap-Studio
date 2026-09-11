/**
 * 语言切换后的文案刷新回归：
 * - `i18n.ts`：`t`（按语言取文案，非 en 一律走中文表）、`tf`（`{name}` 占位符
 *   格式化）、`LANGUAGE_OPTIONS`（设置面板下拉项）；
 * - `status-bar.ts`：`ElementStatusBarService.showNodeCount` 的单复数分键与
 *   **语言活引用**——语言切换后无需重建服务，下一次写入即用新语言（设置面板
 *   保存后立即生效的语义）；
 * - `commands.ts`：`refreshCommandLabels`（命令面板注册时缓存 name，须按 id
 *   先移除再重注册；丝带图标无移除 API，就地更新 aria-label）。
 *
 * 为什么断言精确字符串而不是「包含数字」：文案本身就是行为契约（`1 node` /
 * `3 nodes` 是两把不同的 key，中文两键同文），只断言包含数字时把单复数写错、
 * 或把中英搞混都不会被发现。
 */
import { describe, expect, it, vi } from 'vitest';
import {
	LANGUAGE_OPTIONS,
	t,
	tf,
	type Language,
} from '../src/i18n';
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

describe('i18n.t（按语言取文案）', () => {
	const cases: [Parameters<typeof t>[1], string, string][] = [
		['common.mindMap', '思维导图', 'Mind map'],
		['command.createMindMap', '新建思维导图', 'Create new mind map'],
		['command.openAsMindMap', '以思维导图打开', 'Open as mind map'],
		['toolbar.searchPlaceholder', '搜索节点…', 'Search nodes…'],
		['toolbar.resetZoom', '重置缩放（100%）', 'Reset zoom (100%)'],
		['menu.removeText', '移除文本', 'Remove text'],
		['menu.resetZoom', '重置缩放', 'Reset zoom'],
		['lineStyle.auto', '自动', 'Auto'],
		['lineStyle.direct', '直连', 'Direct'],
		// 状态栏单复数两把 key：中文同文、英文不同词
		['common.nodeOne', '个节点', 'node'],
		['common.nodeMany', '个节点', 'nodes'],
		['modal.cancel', '取消', 'Cancel'],
		['layout.fishbone', '鱼骨图', 'Fishbone'],
		['theme.forceDark', '强制暗色', 'Force dark'],
		['search.prev', '上一个 (Shift+Enter)', 'Previous (Shift+Enter)'],
		['attachment.chooseImage', '请选择图片文件', 'Choose an image file'],
	];

	it.each(cases)('t(zh, %s) = %s；t(en, %s) = %s', (key, zhText, enText) => {
		expect(t('zh', key)).toBe(zhText);
		expect(t('en', key)).toBe(enText);
	});

	it('未知语言值回退中文（实现只认 en 分支，其余一律走 ZH 表）', () => {
		// EN 字典缺键时 `EN[key] ?? ZH[key]` 的兜底同理：中文表是唯一权威键集
		expect(t('de' as unknown as Language, 'common.mindMap')).toBe('思维导图');
	});
});

describe('i18n.tf（占位符格式化）', () => {
	it('按语言填充 {size} / {max}：数值经 String 转换', () => {
		expect(tf('zh', 'attachment.tooLarge', { size: '12.5', max: 10 })).toBe(
			'图片过大（12.5 MB），最大支持 10 MB',
		);
		expect(tf('en', 'attachment.tooLarge', { size: '12.5', max: 10 })).toBe(
			'Image is too large (12.5 MB); the maximum is 10 MB',
		);
	});

	it('数字参数不做本地化（小数点与整数原样拼接）', () => {
		expect(tf('en', 'attachment.tooLarge', { size: 3.456, max: 10 })).toBe(
			'Image is too large (3.456 MB); the maximum is 10 MB',
		);
	});

	it('未提供的占位符原样保留（缺参不静默吞掉模板）', () => {
		expect(tf('en', 'attachment.tooLarge', { size: '5' })).toBe(
			'Image is too large (5 MB); the maximum is {max} MB',
		);
	});

	it('无关参数不影响文案（无对应占位符则保持原样）', () => {
		expect(tf('zh', 'common.nodeMany', { name: '任意名' })).toBe('个节点');
		expect(tf('en', 'modal.cancel', {})).toBe('Cancel');
	});

	it('同键不同参数互不污染（纯函数，无跨调用状态）', () => {
		expect(tf('en', 'attachment.tooLarge', { size: '1', max: 2 })).toBe(
			'Image is too large (1 MB); the maximum is 2 MB',
		);
		expect(tf('en', 'attachment.tooLarge', { size: '9', max: 10 })).toBe(
			'Image is too large (9 MB); the maximum is 10 MB',
		);
	});
});

describe('i18n.LANGUAGE_OPTIONS（设置面板下拉项）', () => {
	it('取值与展示名固定：zh 中文 / en English（顺序即下拉呈现顺序）', () => {
		expect(LANGUAGE_OPTIONS).toEqual([
			{ value: 'zh', label: '中文' },
			{ value: 'en', label: 'English' },
		]);
	});
});

/** 状态栏元素桩：记录 setText 写入（Obsidian 的 HTMLElement 扩展方法） */
function makeStatusBarElement() {
	const texts: string[] = [];
	return {
		texts,
		el: {
			setText: (text: string): void => {
				texts.push(text);
			},
		} as unknown as HTMLElement,
	};
}

describe('status-bar.ElementStatusBarService（节点计数文案）', () => {
	it('英文单复数分键：0/1/2/12 → 0 nodes / 1 node / 2 nodes / 12 nodes', () => {
		const { texts, el } = makeStatusBarElement();
		const service = new ElementStatusBarService(() => el, () => 'en');
		for (const count of [0, 1, 2, 12]) {
			service.showNodeCount(count);
		}
		expect(texts).toEqual(['0 nodes', '1 node', '2 nodes', '12 nodes']);
	});

	it('中文两键同文：0/1/12 → 0 个节点 / 1 个节点 / 12 个节点', () => {
		const { texts, el } = makeStatusBarElement();
		const service = new ElementStatusBarService(() => el, () => 'zh');
		for (const count of [0, 1, 12]) {
			service.showNodeCount(count);
		}
		expect(texts).toEqual(['0 个节点', '1 个节点', '12 个节点']);
	});

	it('文案由 i18n 表拼装（不硬编码模板：与 t() 逐字一致）', () => {
		const { texts, el } = makeStatusBarElement();
		const service = new ElementStatusBarService(() => el, () => 'en');
		service.showNodeCount(1);
		service.showNodeCount(3);
		expect(texts[0]).toBe(`1 ${t('en', 'common.nodeOne')}`);
		expect(texts[1]).toBe(`3 ${t('en', 'common.nodeMany')}`);
	});

	it('语言活引用：切换语言后同一服务实例的下一次写入即用新语言', () => {
		const { texts, el } = makeStatusBarElement();
		// 模拟插件 settings.language 的活引用（设置面板保存后整体替换/改写）
		const settings = { language: 'zh' as Language };
		const service = new ElementStatusBarService(() => el, () => settings.language);

		service.showNodeCount(1);
		expect(texts[0]).toBe('1 个节点');
		// 切到英文：不重建服务，状态栏文案跟随刷新
		settings.language = 'en';
		service.showNodeCount(1);
		expect(texts[1]).toBe('1 node');
		// 切回中文同理（双向跟随）
		settings.language = 'zh';
		service.showNodeCount(2);
		expect(texts[2]).toBe('2 个节点');
	});

	it('clear 写入空串（视图关闭/切到非导图视图时清空）', () => {
		const { texts, el } = makeStatusBarElement();
		const service = new ElementStatusBarService(() => el, () => 'zh');
		service.showNodeCount(7);
		service.clear();
		service.showNodeCount(8);
		expect(texts).toEqual(['7 个节点', '', '8 个节点']);
	});

	it('元素可用性跟随惰性取值器：元素缺失（onunload）时静默跳过', () => {
		let el: HTMLElement | null = null;
		const { texts, el: element } = makeStatusBarElement();
		const service = new ElementStatusBarService(() => el, () => 'en');

		expect(service.available).toBe(false);
		// 元素为 null：不抛异常、也不写入
		expect(() => service.showNodeCount(5)).not.toThrow();
		expect(() => service.clear()).not.toThrow();

		// onload 后元素就位：服务立即恢复可用（无需重建）
		el = element;
		expect(service.available).toBe(true);
		service.showNodeCount(5);
		service.clear();
		expect(texts).toEqual(['5 nodes', '']);
	});
});

/** 命令 id 表（与 src/commands.ts 的 COMMAND_IDS 一致，顺序即注册顺序） */
const COMMAND_IDS = [
	'create-new-mindmap',
	'create-mindmap-here',
	'search-mindmap-nodes',
	'mindmap-fit-view',
	'mindmap-arrange',
	'mindmap-split-links',
	'mindmap-split-links-all',
	'mindmap-export-png',
	'mindmap-open-md-as-view',
	'mindmap-back-to-markdown',
] as const;

interface CommandRecord {
	id: string;
	name: string;
}

/** 插件宿主桩：记录命令注册表与操作日志（验证「先移除再注册」的次序） */
function makeCommandHost(lang: Language) {
	const commands = new Map<string, CommandRecord>();
	const ops: string[] = [];
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
		app: {},
		addCommand: (command: CommandRecord): CommandRecord => {
			ops.push(`add:${command.id}`);
			commands.set(command.id, command);
			return command;
		},
		removeCommand: (id: string): void => {
			ops.push(`remove:${id}`);
			commands.delete(id);
		},
		addRibbonIcon: (icon: string, title: string): typeof ribbonEl => {
			ribbon.push({ icon, title });
			return ribbonEl;
		},
	};
	return {
		plugin: plugin as unknown as Parameters<typeof registerCommands>[0],
		commands,
		ops,
		ribbon,
		ribbonEl,
		settings,
	};
}

describe('commands.refreshCommandLabels（语言变更后的用户入口刷新）', () => {
	it('重注册后命令数量不变、id 不变、name 跟随新语言', () => {
		const host = makeCommandHost('zh');
		registerCommands(host.plugin);
		expect([...host.commands.keys()]).toEqual([...COMMAND_IDS]);
		expect(host.commands.get('create-new-mindmap')?.name).toBe(
			t('zh', 'command.createMindMap'),
		);

		host.settings.language = 'en';
		refreshCommandLabels(
			host.plugin,
			host.ribbonEl as unknown as HTMLElement,
		);

		// 数量不变（先按 id 移除再注册，不产生重复条目）
		expect(host.commands.size).toBe(COMMAND_IDS.length);
		expect([...host.commands.keys()]).toEqual([...COMMAND_IDS]);
		expect(host.commands.get('create-new-mindmap')?.name).toBe(
			t('en', 'command.createMindMap'),
		);
		expect(host.commands.get('mindmap-fit-view')?.name).toBe(
			t('en', 'command.fitCanvas'),
		);
		expect(host.commands.get('mindmap-back-to-markdown')?.name).toBe(
			t('en', 'command.backToMarkdown'),
		);
	});

	it('刷新次序：10 条命令全部先移除，之后才重新注册', () => {
		const host = makeCommandHost('en');
		registerCommands(host.plugin);
		host.ops.length = 0;

		refreshCommandLabels(
			host.plugin,
			host.ribbonEl as unknown as HTMLElement,
		);

		const removals = host.ops.filter((op) => op.startsWith('remove:'));
		const additions = host.ops.filter((op) => op.startsWith('add:'));
		expect(removals).toEqual(COMMAND_IDS.map((id) => `remove:${id}`));
		expect(additions).toEqual(COMMAND_IDS.map((id) => `add:${id}`));
		// 全部移除都排在第一次注册之前
		expect(host.ops.indexOf('add:create-new-mindmap')).toBe(COMMAND_IDS.length);
	});

	it('丝带提示就地更新为当前语言（官方无移除 API：不新增图标）', () => {
		const host = makeCommandHost('zh');
		const el = addMindMapRibbonIcon(host.plugin);
		expect(host.ribbon).toEqual([
			{ icon: 'network', title: t('zh', 'command.createMindMap') },
		]);
		expect(el).toBe(host.ribbonEl);

		host.settings.language = 'en';
		refreshCommandLabels(host.plugin, host.ribbonEl as unknown as HTMLElement);

		expect(host.ribbonEl.attrs['aria-label']).toBe(
			t('en', 'command.createMindMap'),
		);
		// 元素复用，不重复创建图标
		expect(host.ribbon).toHaveLength(1);
	});

	it('丝带元素缺失（图标创建失败/未就绪）时不抛异常', () => {
		const host = makeCommandHost('en');
		registerCommands(host.plugin);
		expect(() => refreshCommandLabels(host.plugin, null)).not.toThrow();
		expect(host.commands.size).toBe(COMMAND_IDS.length);
	});
});
