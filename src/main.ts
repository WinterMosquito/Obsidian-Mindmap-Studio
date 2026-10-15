/**
 * MindMap Studio —— Obsidian 思维导图插件入口。
 *
 * 本类只做装配与生命周期编排（遵循 obsidian-sample-plugin 规范）：
 * - onload: 设置载入、注册视图/扩展名/事件监听/设置面板；
 *   「声明为导图 ⇒ 自动切导图视图」的时机与启动恢复委托给 mindmap-auto-open.ts；
 * - onunload: 排空未落盘的视图状态后清理。
 * 业务逻辑分别位于 settings.ts / commands.ts / creation.ts / features/view.ts /
 * mindmap.ts / images-*.ts / links-*.ts / markdown.ts / modal-*.ts。
 */
import { Menu, Plugin, TFile, TFolder } from 'obsidian';
import { VIEW_TYPE, SETTINGS_PERSIST_DEBOUNCE_MS, SETTINGS_APPLY_DEBOUNCE_MS, VIEW_STATE_PERSIST_MS, CODE_BLOCK_LANGUAGE } from './core/constants';
import { createDebouncer } from './core/concurrency';
import {
	MindMapStudioSettings,
	MindMapStudioSettingTab,
	diffLiveRefreshKeys,
	reportDroppedSettings,
	sanitizeSettings,
	type SettingsSanitizeReport,
} from './settings';
import { MindMapView } from './features/view';
import { MindmapEmbedRenderChild } from './features/mindmap-codeblock';
import { createNewMindMap } from './creation';
import {
	isMindMapFile,
	declareAndOpenAsMindMap,
	migrateMindMapPropertyKeys,
	openAsMarkdown,
	setViewSwitchDoneHook,
} from './markdown/md-open';
import {
	addMindMapRibbonIcon,
	refreshCommandLabels,
	registerCommands,
} from './commands';
import { t } from './core/i18n';
import { VaultSyncService } from './platform/vault-sync';
import { fileLookupIndex } from './links/file-lookup';
import { setImageSizeCacheStore } from './media/images-path';
import { ViewStateStore } from './services/view-state';
import { notifyError } from './core/errors';
import { PluginDataWriter } from './core/persistence';
import { ElementStatusBarService } from './services/status-bar';
import type { StatusBarService } from './services/status-bar';
import { updateStatusBar } from './features/view-status';
import { pruneViewSwitchNoise } from './platform/nav-history';
import { MindMapAutoOpener } from './platform/mindmap-auto-open';

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
	 * 设置**应用到视图**的防抖：应用一轮会重建每个打开的视图的引擎
	 * （`EngineController.refresh`：整树 structuredClone + 全量重渲染），
	 * 而 LIVE_REFRESH 键会被反复触发（`enableDrag` 勾选、`language` 切换）——
	 * 不防抖就是连点几次重建几十轮引擎。2026-09-17 起按键差集分流（见 K59）：
	 * 主题原地生效、默认布局/默认连线样式不再重建，只有「引擎创建期通道」的键
	 * 才真重建（2026-10-09 起性能模式常开，那两个设置键已删，见 K117④）。
	 */
	private readonly settingsApplyDebouncer = createDebouncer(SETTINGS_APPLY_DEBOUNCE_MS);
	/**
	 * 上次**已应用**到视图的设置快照：`applySettingsToViewsNow` 据此算出本次真正
	 * 变化的键（`diffLiveRefreshKeys`），让视图走最小刷新路径（见 K59）。
	 */
	private appliedSettingsSnapshot: MindMapStudioSettings | null = null;
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

		// 视图切换落定 → 导航历史卫生（K111）：清理 leaf 历史里同文件的跨视图
		// 冗余条目（打开声明为导图的文件会留下 markdown 中间态）；否则导图视图下
		// 侧键后退落在中间态上又被声明驱动逻辑切回，净效果为零（用户实测缺陷）。
		setViewSwitchDoneHook((leaf, path, viewType) => {
			pruneViewSwitchNoise(leaf, path, viewType);
		});

		this.registerView(VIEW_TYPE, (leaf) => new MindMapView(leaf, this));

		// ```` ```mindmap ```` 代码块：普通笔记中**只读**渲染块体大纲为导图。
		// 渲染子交给官方 `ctx.addChild` 托管（容器脱离 DOM 即自动卸载，
		// 引擎/观察器/事件随之回收）——注册是组合根的职责，渲染逻辑全在
		// features/mindmap-codeblock.ts。设置经 getter 传窄面（活引用，
		// 设置变更后新渲染的块即生效）。
		this.registerMarkdownCodeBlockProcessor(
			CODE_BLOCK_LANGUAGE,
			(source, el, ctx) => {
				ctx.addChild(
					new MindmapEmbedRenderChild(
						this.app,
						source,
						el,
						ctx.sourcePath,
						() => ({
							layout: this.settings.defaultLayout,
							lineStyle: this.settings.defaultLineStyle,
							themePref: this.settings.defaultTheme,
							lang: this.settings.language,
						}),
					),
				);
			},
		);

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

		// 文件右键：md 文件互斥一项（声明为导图 → 「以 Markdown 打开」降级；
		// 普通笔记 → 「以思维导图打开」，即「任意笔记可预览为导图」入口）；
		// 文件夹右键：新建思维导图。
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					if (file.extension === 'md') {
						this.addMarkdownFileMenuItems(menu, file);
					}
					return;
				}
				if (file instanceof TFolder) {
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.createMindMap'))
							.setIcon('dot-network')
							.onClick(() => {
								void createNewMindMap(this.app, this.settings, file.path);
							}),
					);
				}
			}),
		);

		// 声明式自动打开：frontmatter 声明为导图的文件以 markdown 视图出现时，
		// 自动切入导图视图（运行期事件 + 启动多档延时恢复）。打开方式不再记入
		// data.json——文件属性即声明，没有第二份状态可失配。
		const opener = new MindMapAutoOpener(
			this.app.workspace,
			(file) => isMindMapFile(this.app, file),
			(view) => view instanceof MindMapView,
		);
		opener.register(this);

		// 属性被**就地**加上时补判（属性面板 / 其它设备同步写回）：metadataCache
		// 变化即声明变化。反向（删掉声明）不主动把正在编辑的导图视图抽走——声明
		// 只决定「打开/新声明时怎么进」，运行中不打断用户。
		// 走**合并窗口**入口：同步回写 / 批量落盘会连发 changed，每次全量扫描都要
		// 遍历全部 markdown 叶子（见 MindMapAutoOpener.scheduleDeclaredLeavesScan）。
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file.extension === 'md' && isMindMapFile(this.app, file)) {
					opener.scheduleDeclaredLeavesScan();
				}
			}),
		);

		// 启动后恢复「声明为导图」的叶子。
		// 「在某个文件夹新建导图」只保留**一个**入口：上方官方 `file-menu` 的文件夹
		// 右键项（`TFolder` 分支）。此前的 file-explorer「新建」菜单注入是同一动作的
		// 第二入口、且依赖未公开私有 API（`view.fileCreator`），已于 2026-10-09 减法移除。
		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) {
				return;
			}
			opener.scheduleStartupRestore();
		});

		// Vault 文件事件同步（重命名/删除/创建时更新打开导图的引用与查找缓存，
		// 并经 hooks 迁移/清理视图状态键——事件单一注册入口，避免双订阅）
		this.vaultSync = new VaultSyncService(this.app);
		this.vaultSync.attach(this, {
			onRename: (file, oldPath) => {
				// 视图状态（布局/视口）按路径键存，改名即迁移；打开方式已不存
				// data.json，故不再按「是不是导图」分流。
				if (file instanceof TFile) {
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
		// 挂起的「设置应用到视图」直接丢弃：此刻视图正在关闭，重建引擎无意义
		this.settingsApplyDebouncer.cancel();
		this.statusBarEl = null;
	}

	/**
	 * md 文件的右键项（**互斥**一项，避免同名动作两种行为）：
	 * - 声明为导图（frontmatter `类型`/`Type` = `Mindmap`）→「以 Markdown 打开」，
	 *   点击**持久降级**（属性改写为 `Markdown`），此后不再自动进导图视图；
	 * - 其他 md →「以思维导图打开」，把当前标签切到导图视图
	 *   （「任意笔记可预览为导图」的入口）。
	 */
	private addMarkdownFileMenuItems(menu: Menu, file: TFile): void {
		const lang = this.settings.language;
		if (isMindMapFile(this.app, file)) {
			menu.addItem((item) =>
				item
					.setTitle(t(lang, 'command.openAsMarkdown'))
					.setIcon('file-text')
					.onClick(() => {
						// 该文件已是导图视图（全库至多一个实例，见 onLoadFile 的 P0
						// 互斥）→ 带到前台并复用视图自带返回入口：恢复进入前编辑/
						// 阅读模式（与工具栏/命令同语义）、持久化视口。按**文件**
						// 查找而非活跃 leaf：导图在后台标签时也应切它，而不是顶掉
						// 当前标签页。
						for (const leaf of this.app.workspace.getLeavesOfType(
							VIEW_TYPE,
						)) {
							const view = leaf.view;
							if (
								view instanceof MindMapView &&
								view.file?.path === file.path
							) {
								this.app.workspace.setActiveLeaf(leaf, {
									focus: true,
								});
								view.backToMarkdown();
								return;
							}
						}
						// 尚未以导图打开（声明刚写入 / auto-open 未跑）→ 直接切回
						void openAsMarkdown(
							this.app,
							this.app.workspace.getLeaf(false),
							file,
							'source',
							lang,
						);
					}),
			);
			return;
		}
		menu.addItem((item) =>
			item
				.setTitle(t(lang, 'command.openAsMindMap'))
				.setIcon('dot-network')
				.onClick(() => {
					void declareAndOpenAsMindMap(
						this.app,
						this.app.workspace.getLeaf(false),
						file,
						lang,
					);
				}),
		);
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
		// 使 getLayout 恒为 undefined —— 重启后布局/视口丢失。
		this.viewState.hydrate(raw);
		delete raw.viewState;
		// 坏值静默回退会让用户看到「设置没生效」——汇总留痕一次（进程内）
		const report: SettingsSanitizeReport = { dropped: [] };
		this.settings = sanitizeSettings(raw, report);
		reportDroppedSettings(report.dropped);
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

	/**
	 * 设置变更后应用到所有打开的思维导图视图（**防抖合并突发**：拖一次滑块只
	 * 重建一轮引擎；内存设置已即时生效，落盘另有 settingsPersistDebouncer）。
	 *
	 * 取「叶子列表」放在回调里：防抖窗口内打开/关闭的视图按**触发时刻**的实际
	 * 集合处理，不会给已关闭的视图补刷新、也不会漏掉刚打开的视图。
	 */
	applySettingsToViews(): void {
		this.settingsApplyDebouncer.schedule(() => {
			this.applySettingsToViewsNow();
		});
	}

	/** 立即应用到所有打开的思维导图视图（防抖回调本体；测试与卸载路径可直接调） */
	applySettingsToViewsNow(): void {
		// 差集 = 本次真正变化的 LIVE_REFRESH 键：视图据此走最小刷新路径
		//（主题原地生效；默认布局/默认连线样式对已打开的图本就不生效，跳过重建）
		const changedKeys = diffLiveRefreshKeys(
			this.appliedSettingsSnapshot,
			this.settings,
		);
		this.appliedSettingsSnapshot = { ...this.settings };
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof MindMapView) {
				view.refreshToolbar();
				view.applySettingsChange(changedKeys);
			}
		});
	}

	/**
	 * 语言变更后刷新用户入口文案：命令面板（注册时缓存 name）与丝带提示
	 * 重注册/更新，状态栏与已打开视图的搜索栏就地刷新。
	 * 视图工具栏已由 applySettingsToViews（language 属 LIVE_REFRESH 键）重建。
	 *
	 * 同时触发**属性键迁移**：把库内已有导图的声明键重命名为当前语言的键
	 * （zh `类型` ⇄ en `Type`），避免「只加新键」导致两把键并存。
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
		// 全库迁移：键名随语言收敛（异步、逐个文件；单文件失败只留痕）
		void migrateMindMapPropertyKeys(this.app, this.settings.language).catch(
			(error) => {
				console.error('迁移思维导图属性键失败:', error);
			},
		);
	}
}
