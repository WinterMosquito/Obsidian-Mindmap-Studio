/**
 * 新建文件名称输入弹窗（需求 2）：
 * 创建时允许用户直接修改文件名（预填默认名，全选便于改写）。
 * 空白名称无意义：确认按钮随输入实时置灰（Enter 路径由 confirm 内守卫兜住，
 * 只重新聚焦、不关闭），避免「点击确定无反应」的死按钮。
 * @returns 输入的名称（已去除首尾空白）；取消返回 null
 * 从 modals.ts 拆出。
 */
import { App, Modal } from 'obsidian';
import { t, type Language } from './i18n';
import { createButton, createModalSettle } from './modal-common';

export function openNameInputModal(
	app: App,
	defaultValue: string,
	folderPath: string,
	lang: Language,
): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		// settle 守卫 + onClose 兜底（createModalSettle）：点击遮罩等非按钮
		// 路径关闭时 Promise 也必然 resolve，避免调用方 await 永久挂起。
		const settle = createModalSettle<string>(modal, resolve);
		modal.titleEl.setText(t(lang, 'command.createMindMap'));
		const root = modal.contentEl.createDiv('mindmap-name-editor');

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
			// 先 settle 再 close：Obsidian 的 Modal.close() 会同步触发 onClose
			// （兜底 settle(null)），若先 close 则用户输入的名称会被当作取消。
			settle(name);
			modal.close();
		};
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				confirm();
			} else if (event.key === 'Escape') {
				settle(null);
				modal.close();
			}
		});

		const buttons = root.createDiv();
		buttons.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--mt');
		createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
			settle(null);
			modal.close();
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
		modal.open();
	});
}
