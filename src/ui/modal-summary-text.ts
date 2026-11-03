/**
 * 概要（Summary）文字输入弹窗。
 *
 * 概要文字存在节点指令行里（`%%sum:2 | 本周必须完成%%`），是**注释体的一段文本**：
 * 含 `%%`（注释不能嵌套）或 `[[` / `]]`（注释体不是行内 token 的保护区）时解析侧
 * 会 fail-closed 把整条概要丢掉 ⇒ 屏上的概要凭空消失、用户看不到任何提示。
 * 判据只有一份（`domain/summary.isWritableSummaryText`），这里只在输入侧提前拦。
 *
 * 空串**不是**合法输入：概要与联系标签不同，它就是显示在概要框上的正文，空框
 * 在画布上只是一个没有信息量的方框。取消返回 null。
 */
import { App } from 'obsidian';
import { t, type Language } from '../core/i18n';
import { isWritableSummaryText } from '../domain/summary';
import { createButton, openFormModal } from './modal-common';

/** 文字长度上限（仅输入侧限制；解析不截断，保真优先） */
const SUMMARY_TEXT_MAX_LENGTH = 120;

export function openSummaryTextModal(
	app: App,
	lang: Language,
	current: string,
	mode: 'create' | 'edit' = 'edit',
): Promise<string | null> {
	const isCreate = mode === 'create';
	return openFormModal<string>({
		app,
		// 标题 / 预填 / 按钮随场景切换：此前创建也写「编辑概要文字」并预填「概要」
		// ——回车就直接落下一个名叫「概要」的框，用户以为那只是占位符
		//（2026-11-03 实机）
		title: t(lang, isCreate ? 'summary.newText' : 'summary.editText'),
		rootCls: 'mindmap-summary-text-editor',
		build: ({ root, submit }) => {
			const input = root.createEl('input', {
				cls: 'mindmap-modal-input',
				attr: {
					type: 'text',
					value: isCreate ? '' : current,
					placeholder: t(lang, 'summary.textPlaceholder'),
					spellcheck: 'false',
					maxlength: String(SUMMARY_TEXT_MAX_LENGTH),
				},
			});
			const hint = root.createDiv();
			hint.addClass('mindmap-modal-muted-hint');
			input.focus();
			if (!isCreate) {
				input.select();
			}

			const confirm = (): void => {
				const value = input.value.trim();
				if (!value) {
					hint.setText(t(lang, 'summary.textEmpty'));
					input.focus();
					return;
				}
				if (!isWritableSummaryText(value)) {
					// 非法字符：留在弹窗里提示，不关闭（关掉会让用户以为已生效）
					hint.setText(t(lang, 'summary.textInvalid'));
					input.focus();
					return;
				}
				submit(value);
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
			createButton(
				buttons,
				t(lang, isCreate ? 'modal.create' : 'modal.apply'),
				'primary',
				confirm,
			);
		},
	});
}
