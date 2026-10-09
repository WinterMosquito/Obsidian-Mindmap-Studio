/**
 * 新建文件名称输入弹窗（需求 2）：
 * 创建时允许用户直接修改文件名（预填默认名，全选便于改写）。
 * 空白名称无意义：确认按钮随输入实时置灰（Enter 路径由 confirm 内守卫兜住，
 * 只重新聚焦、不关闭），避免「点击确定无反应」的死按钮。
 * @returns 输入的名称（已去除首尾空白）；取消返回 null
 * 从 modals.ts 拆出。
 */
import { App } from 'obsidian';
import { t, type Language } from '../core/i18n';
import { createButton, openFormModal } from './modal-common';

export function openNameInputModal(
	app: App,
	defaultValue: string,
	folderPath: string,
	lang: Language,
): Promise<string | null> {
	return openFormModal<string>({
		app,
		title: t(lang, 'command.createMindMap'),
		rootCls: 'mindmap-name-editor',
		build: ({ root, submit }) => {
			const hint = root.createDiv();
			hint.setText(`${t(lang, 'modal.name.folder')}${folderPath || '/'}`);
			hint.addClass('mindmap-modal-muted-hint');

			const input = root.createEl('input', {
				cls: 'mindmap-modal-input',
				attr: { type: 'text', value: defaultValue, spellcheck: 'false' },
			});
			input.focus();
			input.select(); // 全选，便于直接输入新名称

			const confirm = (): void => {
				const name = input.value.trim();
				if (!name) {
					// 空白名称无意义：确认按钮已随输入禁用（见下方 syncConfirmState），
					// 此处兜住 Enter 路径——只重新聚焦、不关闭（不留下悬空的 Promise）。
					input.focus();
					return;
				}
				submit(name);
			};
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					confirm();
				} else if (event.key === 'Escape') {
					submit(null);
				}
			});

			const buttons = root.createDiv();
			buttons.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--mt');
			createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
				submit(null);
			});
			const confirmButton = createButton(
				buttons,
				t(lang, 'modal.create'),
				'primary',
				confirm,
			);
			// 空白名称时置灰确认按钮：否则点击「确定」既不关闭也无提示，用户会以为
			// 按钮坏了（历史行为）。输入后即时恢复，Enter 路径由 confirm 内守卫兜住。
			const syncConfirmState = (): void => {
				confirmButton.setDisabled(input.value.trim() === '');
			};
			syncConfirmState();
			input.addEventListener('input', syncConfirmState);
		},
	});
}
