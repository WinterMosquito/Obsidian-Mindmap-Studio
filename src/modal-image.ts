/**
 * 节点图片编辑弹窗（与 Obsidian 图片引用语义对齐）：
 * - 输入框联想库内图片文件（Obsidian 输入 ![[ 风格，AbstractInputSuggest）；
 * - 库内路径 / http(s) / data URL 均可；
 * - 「选择本地图片」保存到附件目录后插入；「粘贴图片」从剪贴板读取；
 * - 确认返回规范引用：库内图片 → vault 相对路径（md 回写 ![[路径]]），
 *   外链 → 原样 URL。
 */
import { App, Modal, TFile } from 'obsidian';
import { isImageExtension, MAX_IMAGE_SIZE_MB } from './constants';
import { isAppResourceUrl, isExternalImageRef } from './domain/url';
import { t, type Language } from './i18n';
import { buildPastedImageName } from './images-save';
import { resolvePathToFile } from './links-resolve';
import { createButton, createModalSettle, VaultFileSuggest } from './modal-common';

/** 输入是否为外链/数据地址（无需库内解析）：domain/url 单一权威 */
function isExternalImageUrl(value: string): boolean {
	return isExternalImageRef(value);
}

export function openImageEditorModal(
	app: App,
	current: string,
	saveImage: (
		file: File,
		maxSizeMB?: number,
		nameOverride?: string,
	) => Promise<TFile | null>,
	lang: Language,
): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		const settle = createModalSettle<string>(modal, resolve);
		modal.titleEl.setText(t(lang, 'modal.image.title'));
		const root = modal.contentEl.createDiv('mindmap-image-editor');

		const statusEl = root.createDiv();
		statusEl.addClass('mindmap-modal-muted-hint');

		/** 由引用文本得到「预览 URL」：统一入口解析（库内路径/app:///file://
		 *  等形态，与 AGENTS.md「解析只走 resolvePathToFile」一致）；
		 *  命中→资源地址；未命中→空串（无预览）。首次未命中会触发全库
		 *  索引构建（file-lookup 缓存），之后 O(1)。 */
		const toPreviewUrl = (value: string): string => {
			if (!value || isExternalImageUrl(value)) {
				return value;
			}
			const file = resolvePathToFile(value, app);
			return file ? app.vault.getResourcePath(file) : '';
		};

		const updateStatus = (url: string): void => {
			if (url && isExternalImageUrl(url)) {
				const shortened = url.length > 60 ? url.slice(0, 60) + '...' : url;
				statusEl.setText(`${t(lang, 'modal.image.address')}${shortened}`);
			} else if (url) {
				statusEl.setText(`${t(lang, 'modal.image.internalPath')}${url}`);
			} else {
				statusEl.setText(t(lang, 'modal.image.none'));
			}
		};
		// current 可能是资源地址（app://local/...）：解码并去掉主机前缀 → 库内路径。
		// app:// 引用来自用户可编辑 Markdown，解码失败（畸形 % 序列）须回退原值
		// 而非抛 URIError——抛错会让整个图片弹窗打不开（无未处理拒绝）。
		let initialRef = current;
		if (isAppResourceUrl(current)) {
			try {
				initialRef = decodeURIComponent(
					current.replace(/^app:\/\/[^/]*\//, ''),
				);
			} catch {
				// 保留原值，后续预览/保存分支兜底
			}
		}
		updateStatus(initialRef);

		const label = root.createDiv();
		label.setText(t(lang, 'modal.image.urlLabel'));
		label.addClass('mindmap-modal-label');
		const input = root.createEl('input', {
			cls: 'mindmap-modal-input',
			attr: {
				type: 'text',
				placeholder: t(lang, 'modal.image.hint'),
				value: initialRef.startsWith('obsidian://') ? '' : initialRef,
			},
		});
		input.focus();

		const fileInput = root.createEl('input', {
			attr: { type: 'file', accept: 'image/*' },
		});
		fileInput.addClass('mindmap-modal-hidden');

		const actions = root.createDiv();
		actions.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--inline');
		const chooseButton = createButton(
			actions,
			t(lang, 'modal.image.chooseLocal'),
			'secondary',
			() => fileInput.click(),
		);
		chooseButton.buttonEl.title = t(lang, 'modal.image.localHint');
		createButton(actions, t(lang, 'modal.image.paste'), 'secondary', () => {
			void pasteFromClipboard();
		});
		const fileStatus = actions.createSpan();
		fileStatus.addClass('mindmap-modal-file-status');

		const preview = root.createDiv('mindmap-modal-image-preview');
		const renderPreview = (ref: string): void => {
			preview.empty();
			preview.removeClass('is-error');
			preview.removeClass('is-empty');
			const url = toPreviewUrl(ref);
			if (url) {
				const img = preview.createEl('img');
				img.src = url;
				img.onerror = () => {
					preview.empty();
					preview.setText(t(lang, 'modal.image.loadFailed'));
					preview.addClass('is-error');
				};
			} else {
				preview.setText(t(lang, 'modal.image.none'));
				preview.addClass('is-empty');
			}
		};
		renderPreview(initialRef);

		const setFileStatus = (text: string, isError = false): void => {
			fileStatus.setText(text);
			fileStatus.toggleClass('is-error', isError);
		};

		/** 保存本地文件后，把库内相对路径填入输入框（规范引用）。
		 *  nameOverride：剪贴板粘贴时按 Obsidian 核心约定命名（Pasted image …） */
		const saveAndApply = async (file: File, nameOverride?: string): Promise<void> => {
			setFileStatus(t(lang, 'modal.image.saving'));
			try {
				const saved = await saveImage(file, MAX_IMAGE_SIZE_MB, nameOverride);
				if (saved) {
					input.value = saved.path;
					renderPreview(saved.path);
					updateStatus(saved.path);
					setFileStatus(`${t(lang, 'modal.image.saved')}${saved.path}`);
				} else {
					setFileStatus(t(lang, 'modal.image.saveFailed'), true);
				}
			} catch (error) {
				setFileStatus(t(lang, 'modal.image.saveFailed'), true);
				console.error('保存图片失败', error);
			}
		};

		fileInput.onchange = async () => {
			const file = fileInput.files?.[0];
			if (file) {
				await saveAndApply(file);
			}
		};

		const pasteFromClipboard = async (): Promise<void> => {
			try {
				const items = await navigator.clipboard.read();
				for (const item of items) {
					const imageType = item.types.find((type) =>
						type.startsWith('image/'),
					);
					if (imageType) {
						const blob = await item.getType(imageType);
						const ext = imageType.split('/')[1] || 'png';
						const file = new File([blob], `clipboard.${ext}`, {
							type: imageType,
						});
						await saveAndApply(file, buildPastedImageName());
						return;
					}
				}
				setFileStatus(t(lang, 'modal.image.noClipboardImage'), true);
			} catch {
				setFileStatus(t(lang, 'modal.image.clipboardError'), true);
			}
		};

		input.addEventListener('input', () => {
			renderPreview(input.value);
			updateStatus(input.value);
		});

		// 库内图片联想：选择后填入库内相对路径
		const vaultImages = app.vault
			.getFiles()
			.filter((f) => isImageExtension(f.extension));
		new VaultFileSuggest(
			app,
			input,
			vaultImages,
			(file) => ({ icon: 'image', label: file.name }),
			(file) => {
				input.value = file.path;
				renderPreview(file.path);
				updateStatus(file.path);
			},
		);

		const buttons = root.createDiv();
		buttons.addClass('mindmap-modal-action-row');
		createButton(buttons, t(lang, 'modal.image.clear'), 'muted', () => {
			settle('');
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
			settle(null);
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.confirm'), 'primary', () => {
			settle(input.value.trim());
			modal.close();
		});
		modal.open();
	});
}
