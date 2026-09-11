/**
 * MindMap Studio —— Obsidian 思维导图插件入口。
 *
 * 本类只做装配与生命周期编排（遵循 obsidian-sample-plugin 规范）：
 * - onload: 设置载入、注册视图/扩展名/事件监听/设置面板；
 *   「打开方式记忆」的自动切换与文件浏览器菜单注入委托给
 *   open-as-restore.ts / features/file-creator.ts；
 * - onunload: 排空未落盘的视图状态后清理。
 * 业务逻辑分别位于 settings.ts / commands.ts / creation.ts / features/view.ts /
 * mindmap.ts / images-*.ts / links-*.ts / markdown.ts / modal-*.ts。
 */
import { Plugin, TFile, TFolder } from 'obsidian';
import { VIEW_TYPE, SETTINGS_PERSIST_DEBOUNCE_MS, VIEW_STATE_PERSIST_MS } from './constants';
import { createDebouncer } from './concurrency';
import {
	MindMapStudioSettings,
	MindMapStudioSettingTab,
	sanitizeSettings,
} from './settings';
import { MindMapView } from './features/view';
import { createNewMindMap } from './creation';
import {
	isMindMapMarkdownFile,
	openAsMarkdown,
	openAsMindMap,
	setOpenAsPreferenceHook,
} from './md-open';
import {
	addMindMapRibbonIcon,
	refreshCommandLabels,
	registerCommands,
} from './commands';
import { t } from './i18n';
import { VaultSyncService } from './vault-sync';
import { fileLookupIndex } from './file-lookup';
import { setImageSizeCacheStore } from './images-path';
import { ViewStateStore } from './view-state';
import { notifyError } from './errors';
import { PluginDataWriter } from './persistence';
import { ElementStatusBarService } from './status-bar';
import type { StatusBarService } from './status-bar';
import { updateStatusBar } from './features/view-status';
import { injectIntoFileCreator } from './features/file-creator';
import { OpenAsPreferenceRestorer } from './open-as-restore';

export default class MindMapStudioPlugin extends Plugin {
	override settings!: MindMapStudioSettings;
	statusBarEl: HTMLElement | null = null;
	/**
	 * 插件是否已卸载。`workspace.onLayoutReady` 回调不可注销（返回 void，
	 * 非 EventRef），布局就绪前禁用插件时回调仍会执行——须自行判定。
	 */
	private unloaded = false;
	/** 丝带图标元素（官方无移除 API；语言变更时就地更新提示文案） */
	ribbonEl: HTMLElement | null = null;
	/**
	 * 状态栏服务（节点计数展示/清空）：DOM 与 i18n 格式化归插件层，
	 * 视图侧只广播计数；元素/语言经惰性取值器获取，onunload 后静默。
	 */
	readonly statusBar: StatusBarService = new ElementStatusBarService(
		() => this.statusBarEl,
		() => this.settings.language,
	);
	/**
	 * data.json 写盘器（串行队列 + 写前重读合并 + 错误回调注入 NotifyError）。
	 * onError 闭包在调用时读取当前 settings.language（构造时 settings 尚未加载）。
	 */
	private readonly dataWriter = new PluginDataWriter(this, {
		onError: (error) => {
			notifyError(this.settings.language, 'save.pluginDataFailed', error);
		},
	});
	/**
	 * 设置落盘防抖：设置面板高频控件（滑块拖动每档都触发 setControlValue）
	 * 若逐次写盘，会形成「整文件重读+重写」的突发串行队列。内存设置即时
	 * 生效（sanitizeSettings 不经防抖），仅磁盘写入合并突发。
	 */
	private readonly settingsPersistDebouncer = createDebouncer(SETTINGS_PERSIST_DEBOUNCE_MS);
	/**
	 * 视图状态（布局/视口，按文件路径）——与设置合并写 data.json。
	 * persist 回调返回写盘 Promise（write 内部吞错不会拒绝），
	 * 供 ViewStateStore.flushNow 透传给卸载路径跟踪。
	 */
	viewState = new ViewStateStore((state) => {
		return this.dataWriter.write({ viewState: state });
	}, VIEW_STATE_PERSIST_MS);
	/** Vault 文件事件同步服务（rename/delete/create） */
	private vaultSync!: VaultSyncService;

	override async onload(): Promise<void> {
		await this.loadSettings();

		// 图片尺寸的跨会话缓存走官方**按库隔离**的存储：全局 localStorage 会跨库
		// 串味且被 lint 规则禁止；images-path 本身不依赖 App，故注入窄化适配面。
		setImageSizeCacheStore({
			// 官方 API 返回 any：显式落到 unknown（不把 any 漏进 images-path）
			load: (key) => {
				const data: unknown = this.app.loadLocalStorage(key);
				return data;
			},
			save: (key, data) => {
				this.app.saveLocalStorage(key, data);
			},
		});

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
		this.ribbonEl = addMindMapRibbonIcon(this);

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText(t(this.settings.language, 'common.mindMap'));

		// 视图切换后状态栏跟随激活视图：导图视图刷新计数，其余清空
		// （此前切到非导图视图后残留上一个导图的节点计数）
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const view = this.app.workspace.getActiveViewOfType(MindMapView);
				if (view) {
					updateStatusBar(view);
				} else {
					this.statusBar.clear();
				}
			}),
		);

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
			if (this.unloaded) {
				return;
			}
			injectFileCreatorMenu();
			restorer.scheduleStartupRestore();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => injectFileCreatorMenu()),
		);

		// Vault 文件事件同步（重命名/删除/创建时更新打开导图的引用与查找缓存，
		// 并经 hooks 迁移/清理视图状态键——事件单一注册入口，避免双订阅）
		this.vaultSync = new VaultSyncService(this.app);
		this.vaultSync.attach(this, {
			onRename: (file, oldPath) => {
				if (file instanceof TFile && isMindMapMarkdownFile(file)) {
					this.viewState.renameKey(oldPath, file.path);
				} else {
					this.viewState.removeKey(oldPath);
				}
			},
			onDelete: (file) => {
				this.viewState.removeKey(file.path);
			},
		});

		this.addSettingTab(new MindMapStudioSettingTab(this.app, this));
	}

	override onunload(): void {
		this.unloaded = true;
		// 全库文件索引（模块级单例，缓存 path→TFile）：插件禁用后不该继续驻留
		fileLookupIndex.invalidate();
		// 排空未落盘的视图状态（防抖定时器）：同步 onunload 无法 await 写盘，
		// 尽力启动在途写盘（flushNow 返回 PluginDataWriter.write 的 Promise，
		// write 内部吞错，无未处理拒绝风险）。
		void this.viewState.flushNow();
		// 设置防抖有挂起时立即落盘（尽力，同上不等待）
		if (this.settingsPersistDebouncer.isPending()) {
			this.settingsPersistDebouncer.cancel();
			void this.saveSettings();
		}
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
	 * 设置落盘（历史格式：设置位于 data.json 顶层）。
	 * 只写设置键——viewState 由其自身防抖回调经写前重读合并落盘，
	 * 设置变更无需携带全量视图状态快照（PluginDataWriter 合并保证互不丢键，
	 * 免去每次设置变更对整个 viewState 映射的序列化与写放大）。
	 * 写盘排队与重读合并在 PluginDataWriter 内部完成。
	 */
	async saveSettings(): Promise<void> {
		await this.dataWriter.write({ ...this.settings });
	}

	/**
	 * 设置变更后的防抖持久化（设置面板 setControlValue 调用）：
	 * 滑块等高频控件逐档触发，写盘合并为最后落盘一次。
	 */
	scheduleSettingsPersist(): void {
		this.settingsPersistDebouncer.schedule(() => {
			void this.saveSettings();
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

	/**
	 * 语言变更后刷新用户入口文案：命令面板（注册时缓存 name）与丝带提示
	 * 重注册/更新，状态栏与已打开视图的搜索栏就地刷新。
	 * 视图工具栏已由 applySettingsToViews（language 属 LIVE_REFRESH 键）重建。
	 */
	refreshLanguageUi(): void {
		refreshCommandLabels(this, this.ribbonEl);
		this.statusBarEl?.setText(t(this.settings.language, 'common.mindMap'));
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof MindMapView) {
				view.refreshSearchBarLabels();
			}
		});
	}
}
