/**
 * Markdown 代码块渲染：```mindmap ... ```
 */
import { App, MarkdownRenderChild } from 'obsidian';
import { TheMindMapSettings } from './settings';
import { MindMap, MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import {
	createMindMap,
	destroyMindMap,
	getCodeBlockThemeConfig,
} from './mindmap';
import { t } from './i18n';
import { ensureUniqueUids } from './markdown';
import { normalizeImageSizes, walkResolveImagePaths } from './images-path';
import { parseMdOutline } from './md-outline';

export class MindMapCodeBlock extends MarkdownRenderChild {
	app: App;
	settings: TheMindMapSettings;
	source: string;
	mindMap: MindMap | null = null;
	private cssChangeHandler: (() => void) | null = null;

	constructor(
		app: App,
		settings: TheMindMapSettings,
		source: string,
		containerEl: HTMLElement,
		sourcePath = '',
	) {
		super(containerEl);
		this.app = app;
		this.settings = settings;
		this.source = source;
	}

	onload(): void {
		this.containerEl.empty();
		this.containerEl.addClass('mindmap-codeblock-container');
		const canvasEl = this.containerEl.createDiv('mindmap-codeblock-canvas');
		try {
			const tree = this.parseSource();
			const isDark = document.body.hasClass('theme-dark');
			this.mindMap = createMindMap(canvasEl, tree, {
				layout: this.settings.codeBlockDefaultLayout,
				themePref: 'default',
				isDark,
				enableDrag: false,
				// 代码块无导出/搜索 UI：不注册这两个插件（见 mindmap.ts forCodeBlock）
				forCodeBlock: true,
				// 性能模式跟随设置（默认开启，≥阈值自动虚拟渲染）；代码块交互不受影响
				performanceMode: this.settings.performanceMode,
				performanceThreshold: this.settings.performanceThreshold,
				lang: this.settings.language,
			});
			this.mindMap.setThemeConfig(getCodeBlockThemeConfig(isDark));
			this.mindMap.render();
		} catch (error) {
			// 畸形源码/引擎异常：清理半创建实例并给出可读提示，避免卸载后残留监听
			console.error('渲染 mindmap 代码块失败:', error);
			destroyMindMap(this.mindMap);
			this.mindMap = null;
			canvasEl.empty();
			canvasEl.setText(t(this.settings.language, 'common.notLoaded'));
			return;
		}
		this.cssChangeHandler = () => {
			const dark = document.body.hasClass('theme-dark');
			this.mindMap?.setThemeConfig(getCodeBlockThemeConfig(dark));
		};
		this.registerEvent(
			this.app.workspace.on('css-change', this.cssChangeHandler),
		);
	}

	/** 代码块正文按 Markdown 大纲解析（渲染层定位：无专有 JSON 格式） */
	private parseSource(): MindMapTreeNode {
		// 无标题时根名用「中心主题」（代码块无文件名）
		const parsed = parseMdOutline(
			this.source,
			t(this.settings.language, 'default.centerTopic'),
		);
		const tree = parsed.tree;
		// 解析图片路径（库内路径 → 资源地址）、统一图片尺寸、修复缺失/重复 uid
		walkResolveImagePaths(tree, this.app);
		normalizeImageSizes(tree);
		ensureUniqueUids(tree);
		return tree;
	}

	onunload(): void {
		destroyMindMap(this.mindMap);
		this.mindMap = null;
	}
}
