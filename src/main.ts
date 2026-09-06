/**
 * MindMap Studio —— Obsidian 思维导图插件入口。
 *
 * 本类只做装配与生命周期编排（遵循 obsidian-sample-plugin 规范）：
 * - onload: 设置载入、注册视图/扩展名/代码块处理器/事件监听/设置面板；
 *   「打开方式记忆」的自动切换与文件浏览器菜单注入委托给
 *   open-as-restore.ts / features/file-creator.ts；
 * - onunload: 排空未落盘的视图状态后清理。
 * 业务逻辑分别位于 settings.ts / commands.ts / creation.ts / features/view.ts /
 * codeblock.ts / mindmap.ts / images-*.ts / links-*.ts / markdown.ts / modal-*.ts。
 */
import { Plugin, TFile, TFolder } from 'obsidian';
import { CODE_BLOCK_LANGUAGE, VIEW_TYPE } from './constants';
import {
	TheMindMapSettings,
	TheMindMapSettingTab,
	sanitizeSettings,
} from './settings';
import { MindMapView } from './features/view';
import { MindMapCodeBlock } from './codeblock';
import { createNewMindMap } from './creation';
import {
	isMindMapMarkdownFile,
	openAsMarkdown,
	openAsMindMap,
	setOpenAsPreferenceHook,
} from './md-open';
import { registerCommands } from './commands';
import { t } from './i18n';
import { VaultSyncService } from './vault-sync';
import { ViewStateStore } from './view-state';
import { PluginDataWriter } from './persistence';
import { injectIntoFileCreator } from './features/file-creator';
import { OpenAsPreferenceRestorer } from './open-as-restore';

export default class TheMindMapPlugin extends Plugin {
	settings!: TheMindMapSettings;
	statusBarEl: HTMLElement | null = null;
	/**
	 * data.json 写盘器（串行队列 + 写前重读合并 + 内部吞错）。
	 * 先于 viewState 声明：字段按声明顺序初始化，viewState 的持久化回调依赖它。
	 */
	private readonly dataWriter = new PluginDataWriter(this);
	/** 视图状态（布局/视口，按文件路径）——与设置合并写 data.json */
	viewState = new ViewStateStore((state) => {
		void this.dataWriter.write({ viewState: state });
	}, 600);
	/** Vault 文件事件同步服务（rename/delete/create） */
	private vaultSync!: VaultSyncService;

	async onload(): Promise<void> {
		await this.loadSettings();

		// 「以思维导图打开」→ 记录打开方式偏好（双向：最后一次主动选择决定下次）
		setOpenAsPreferenceHook((path) => {
			this.viewState.setOpenAs(path, 'mindmap');
		});

		this.registerView(VIEW_TYPE, (leaf) => new MindMapView(leaf, this));

		// 悬停预览源：导图节点上的 [[wikilink]] 触发 Obsidian 原生页面预览
		// （core 只处理已注册 hoverLinkSource 的事件，未注册会静默忽略）
		this.registerHoverLinkSource(VIEW_TYPE, {
			display: 'MindMap Studio',
			defaultMod: false,
		});

		// 命令面板命令与丝带图标（用户入口）
		registerCommands(this);

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText(t(this.settings.language, 'common.mindMap'));

		// 文件右键：.mindmap.md 以思维导图打开；文件夹右键：新建思维导图
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && isMindMapMarkdownFile(file)) {
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.openAsMindMap'))
							.setIcon('dot-network')
							.onClick(() => {
								void openAsMindMap(this.app.workspace.getLeaf(false), file);
							}),
					);
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.openAsMarkdown'))
							.setIcon('file-text')
							.onClick(() => {
								// 先写偏好再打开：避免 active-leaf-change 自动切回导图
								this.viewState.setOpenAs(file.path, 'markdown');
								void openAsMarkdown(
									this.app.workspace.getLeaf(false),
									file,
									'source',
								);
							}),
					);
					return;
				}
				if (file instanceof TFolder) {
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.createMindMap'))
							.setIcon('dot-network')
							.onClick(() => {
								void createNewMindMap(
									this.app,
									this.settings.language,
									file.path,
								);
							}),
					);
				}
			}),
		);

		// 打开方式记忆：偏好为 mindmap 的 .mindmap.md 以 markdown 视图被激活时，
		// 自动切入导图视图（重新打开仍为思维导图）。
		const restorer = new OpenAsPreferenceRestorer(
			this.app,
			this.app.workspace,
			this.viewState,
			(view) => view instanceof MindMapView,
		);
		restorer.register(this);

		// 文件浏览器「新建文件」菜单注入 + 启动后恢复「偏好为思维导图」的叶子
		const injectFileCreatorMenu = (): void => {
			injectIntoFileCreator(this.app, this.settings.language, (folderPath) => {
				void createNewMindMap(this.app, this.settings.language, folderPath);
			});
		};
		this.app.workspace.onLayoutReady(() => {
			injectFileCreatorMenu();
			restorer.scheduleStartupRestore();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => injectFileCreatorMenu()),
		);

		// Markdown 代码块渲染
		this.registerMarkdownCodeBlockProcessor(
			CODE_BLOCK_LANGUAGE,
			(source, el, ctx) => {
				const codeBlock = new MindMapCodeBlock(
					this.app,
					this.settings,
					source,
					el,
					ctx.sourcePath,
				);
				ctx.addChild(codeBlock);
			},
		);

		// Vault 文件事件同步（重命名/删除/创建时更新打开导图的引用与查找缓存）
		this.vaultSync = new VaultSyncService(this.app);
		this.vaultSync.attach(this);

		// 视图状态（布局/视口）随文件改名/删除迁移键或清理
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && isMindMapMarkdownFile(file)) {
					this.viewState.renameKey(oldPath, file.path);
				} else {
					this.viewState.removeKey(oldPath);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.viewState.removeKey(file.path);
			}),
		);

		this.addSettingTab(new TheMindMapSettingTab(this.app, this));
	}

	onunload(): void {
		// 排空未落盘的视图状态（防抖定时器）
		this.viewState.flushNow?.();
		this.statusBarEl = null;
	}

	async loadSettings(): Promise<void> {
		let data: unknown;
		try {
			data = await this.loadData();
		} catch (error) {
			// 配置读取失败（如 data.json 被占用/损坏）不应拖垮插件启动
			console.error('读取插件配置失败，回退默认设置', error);
			data = null;
		}
		// 非对象 data.json（数组/字符串等）会把索引当键展开，必须丢弃
		if (data === null || typeof data !== 'object' || Array.isArray(data)) {
			data = {};
		}
		const raw = data as Record<string, unknown>;
		// hydrate 期望收到「整个 data.json 对象」（内部读取 data['viewState']），
		// 而非视图状态对象本身；传错会导致 viewState 映射从未载入，
		// 使 getOpenAs/getLayout 恒为 undefined —— 重启后不切导图视图、布局丢失。
		this.viewState.hydrate(raw);
		delete raw.viewState;
		this.settings = sanitizeSettings(raw);
	}

	/**
	 * 合并写盘（历史格式：设置位于 data.json 顶层；viewState 为额外顶层键）。
	 * 写盘排队与重读合并在 PluginDataWriter 内部完成。
	 */
	async saveSettings(): Promise<void> {
		await this.dataWriter.write({
			...this.settings,
			viewState: this.viewState.serialize(),
		});
	}

	/** 设置变更后应用到所有打开的思维导图视图 */
	applySettingsToViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof MindMapView) {
				view.refreshToolbar();
				view.refreshMindMap();
			}
		});
	}
}
