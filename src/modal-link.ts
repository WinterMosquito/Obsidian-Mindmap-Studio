/**
 * 节点链接编辑弹窗（与 Obsidian 双链对齐）：
 * - 联想库内 Markdown 笔记与附件文件（音/视/PDF），官方 AbstractInputSuggest
 *   提供浮层、键盘导航与模糊提示；
 * - 支持直接输入 http(s)/obsidian:// 外部或协议链接；
 * - 返回 { link, label }：link 为写入 md 的链接文本（[[..]] 或 url），
 *   label 为可见文本（笔记名/别名/文件名），供导图节点文本对齐。
 */
import { App, Modal } from 'obsidian';
import { t, type Language } from './i18n';
import { createButton, createModalSettle, VaultFileSuggest } from './modal-common';
import { isLinkAttachmentExtension } from './constants';
import { formatWikilink, parseWikilink } from './domain/wikilink';

export interface LinkPickResult {
	/** 链接文本（写入 md：[[..]] 或 url/obsidian://） */
	link: string;
	/** 可见文本（用于节点文本；URL 输入时为 undefined） */
	label?: string;
}

export function openLinkEditorModal(
	app: App,
	current: string,
	lang: Language,
): Promise<LinkPickResult | null> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		const settle = createModalSettle<LinkPickResult>(modal, resolve);
		modal.titleEl.setText(t(lang, 'modal.link.title'));
		const root = modal.contentEl.createDiv('mindmap-link-editor');
		const input = root.createEl('input', {
			cls: 'mindmap-link-input mindmap-modal-input',
			attr: {
				type: 'text',
				placeholder: t(lang, 'modal.link.placeholder'),
				value: current,
			},
		});
		input.focus();

		const markdownFiles = app.vault.getMarkdownFiles();
		const allFiles = app.vault.getFiles();
		const attachments = allFiles.filter(
			(f) => f.extension !== 'md' && isLinkAttachmentExtension(f.extension),
		);

		/**
		 * 把输入原样作为结果（URL / obsidian:// / 自定义）。
		 * 手输的双链别名（`[[目标|别名]]`）解析为 label，与「联想选择」路径同一
		 * 契约（label = 可见文本），使手输与点选对节点文本的影响一致。
		 */
		const commitRaw = (value: string): void => {
			const v = value.trim();
			if (!v) {
				settle(null);
				modal.close();
				return;
			}
			// 保持裸文本：是否包裹为 [[..]] 由序列化的 renderHyperlink 统一决定，
			// 避免此处与 md-serialize 的链接渲染规则产生第二套真相。
			const alias = parseWikilink(v)?.alias;
			settle(alias ? { link: v, label: alias } : { link: v });
			modal.close();
		};

		// 联想候选：md 笔记在前、附件在后（与原两段 push 的顺序一致）
		new VaultFileSuggest(
			app,
			input,
			[...markdownFiles, ...attachments],
			(file) =>
				file.extension === 'md'
					? { icon: 'file-text', label: file.basename }
					: { icon: 'file', label: file.name },
			(file) => {
				if (file.extension === 'md') {
					const unique =
						markdownFiles.filter((f) => f.basename === file.basename)
							.length === 1;
					// 同名笔记用路径消歧（Obsidian 双链 [[路径/名|名]] 语义）
					settle(
						unique
							? { link: formatWikilink(file.basename), label: file.basename }
							: {
									link: formatWikilink(file.path, file.basename),
									label: file.basename,
								},
					);
				} else {
					// 附件：完整库内路径链接（保留扩展名可见）
					settle({ link: formatWikilink(file.path), label: file.name });
				}
				modal.close();
			},
		);

		// 联想浮层未打开时 Enter 直接提交原始输入
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commitRaw(input.value);
			}
		});

		const buttons = root.createDiv();
		buttons.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--mt');
		createButton(buttons, t(lang, 'modal.link.clear'), 'muted', () => {
			settle({ link: '' });
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
			settle(null);
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.apply'), 'primary', () => {
			commitRaw(input.value);
		});
		modal.open();
	});
}
