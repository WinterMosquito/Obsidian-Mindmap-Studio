/**
 * 联系（关系连线）标签输入弹窗。
 *
 * 标签存在节点指令行里（`%%rel:xxxxxx | 依赖%%`），是**注释体的一段文本**：
 * 含 `%%`（注释不能嵌套）或 `[[` / `]]`（注释体不是行内 token 的保护区）时解析侧
 * 会 fail-closed 把整条指令当普通注释 ⇒ 关系直接消失、用户看不到任何提示。
 * 判据只有一份（`domain/relation.isWritableRelationLabel`），这里只在输入侧提前拦。
 *
 * 空串是**合法**输入（= 无标签的线）；取消返回 null。
 */
import { App } from 'obsidian';
import { t, type Language } from '../core/i18n';
import { isWritableRelationLabel } from '../domain/relation';
import { createButton, openFormModal } from './modal-common';

/** 标签长度上限（仅输入侧限制；解析不截断，保真优先） */
const LABEL_MAX_LENGTH = 80;

export function openRelationLabelModal(
	app: App,
	lang: Language,
	current: string,
): Promise<string | null> {
	return openFormModal<string>({
		app,
		title: t(lang, 'nodeRelation.editLabel'),
		rootCls: 'mindmap-relation-label-editor',
		build: ({ root, submit }) => {
			const input = root.createEl('input', {
				cls: 'mindmap-modal-input',
				attr: {
					type: 'text',
					value: current,
					placeholder: t(lang, 'nodeRelation.labelPlaceholder'),
					spellcheck: 'false',
					maxlength: String(LABEL_MAX_LENGTH),
				},
			});
			const hint = root.createDiv();
			hint.addClass('mindmap-modal-muted-hint');
			input.focus();
			input.select();

			const confirm = (): void => {
				const value = input.value.trim();
				if (!isWritableRelationLabel(value)) {
					// 非法字符：留在弹窗里提示，不关闭（关掉会让用户以为已生效）
					hint.setText(t(lang, 'nodeRelation.labelInvalid'));
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
			createButton(buttons, t(lang, 'modal.apply'), 'primary', confirm);
		},
	});
}
