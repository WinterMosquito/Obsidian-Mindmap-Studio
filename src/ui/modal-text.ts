/**
 * 节点文本编辑弹窗：自绘（富）节点的**备选编辑入口**（2026-09-28 起，见 K92）。
 *
 * 主入口已改为**内联编辑器**（`features/node-inline-editor`：覆盖层 textarea 编辑
 * **文件里那一行原文**，双击 / F2 / 右键「编辑文本」）；本弹窗保留两类内联不具备的
 * 能力：**别名模式**（纯链接节点）与**原文模式 + 实时预览**（长文本/多行细调）。
 * 入口：右键「在弹窗中编辑」（`view-node-actions.editNodeTextInModal`）。
 *
 * 背景：引擎的节点编辑框只服务默认 SVG 文本节点——`textEdit.show()` 首行有
 * `if (t.isUseCustomNodeContent()) return;`，自绘节点双击静默无响应（不报错），
 * 故这类节点必须由插件侧编辑器兜底。
 * 两种模式（由调用方给 `rawMode` 决定）：
 * - **别名模式**（默认，纯链接节点）：编辑 `data.text`——对纯双链节点即改别名；
 * - **原文模式**（混排链接 / URL / 轻标记 / 超长节点）：编辑**文件里的那一行**
 *   （`[[双链]]`、URL、`**粗体**` 语法全部可见可改），提交后重解析写回
 *   （`markdown/md-line-write.applyRawToNode`）。此前的别名视图在这类节点上
 *   看不到语法、外链更是完全不可见（用户实测反馈），故改为原文 + **实时预览**。
 *
 * 快捷键：Esc = 取消；Mod+Enter = 确认。Enter 留给换行——节点文本可多行
 * （列表续行/段落），不能像单行弹窗那样把 Enter 当提交。
 *
 * 刻意不提供「轻标记按钮」：编辑器里显示的就是回写依据，插入 `**粗体**` 只需
 * 用户手输；渲染层负责把它显示成粗体（features/node-inline-content）。
 * @returns 新的内容（别名或原文，按模式）；取消/直接关闭返回 null
 */
import { App } from 'obsidian';
import { t, type Language } from '../core/i18n';
import { createButton, openFormModal } from './modal-common';

/** 弹窗模式选项（别名模式即缺省，行为与历史一致） */
export interface NodeTextModalOptions {
	/** 原文模式：标题/提示改为「编辑 Markdown 原文」 */
	rawMode?: boolean;
	/** 实时预览：入参为当前输入，返回一行预览文案（仅原文模式使用） */
	preview?: (value: string) => string;
}

export function openNodeTextModal(
	app: App,
	defaultValue: string,
	lang: Language,
	options: NodeTextModalOptions = {},
): Promise<string | null> {
	const rawMode = options.rawMode === true;
	return openFormModal<string>({
		app,
		title: t(lang, rawMode ? 'modal.text.titleRaw' : 'modal.text.title'),
		rootCls: 'mindmap-text-editor',
		build: ({ root, submit }) => {
			root
				.createDiv('mindmap-modal-muted-hint')
				.setText(t(lang, rawMode ? 'modal.text.hintRaw' : 'modal.text.hint'));

			const input = root.createEl('textarea', {
				cls: 'mindmap-modal-input mindmap-modal-textarea',
				attr: { rows: '4', spellcheck: 'false' },
			});
			input.value = defaultValue;
			input.focus();
			// 光标置于末尾（追加式编辑最常见），而非全选——避免误输入直接覆盖整段文本
			input.setSelectionRange(defaultValue.length, defaultValue.length);

			// 原文模式的**实时预览**：语法 → 节点显示 的转换当场可见（不必先保存再猜；
			// 也回答「URL 会不会丢」——预览由与写回同一解析入口（buildInlineData）产出）
			const preview = rawMode ? options.preview : undefined;
			if (preview) {
				const previewEl = root.createDiv('mindmap-modal-muted-hint');
				const update = (): void => {
					previewEl.setText(
						`${t(lang, 'modal.text.preview')}${preview(input.value)}`,
					);
				};
				input.addEventListener('input', update);
				update();
			}

			const confirm = (): void => {
				submit(input.value);
			};

			input.addEventListener('keydown', (event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					submit(null);
					return;
				}
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					confirm();
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
