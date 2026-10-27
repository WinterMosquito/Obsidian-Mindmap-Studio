/**
 * 「自定义颜色」输入弹窗（右键「配色」→ 自定义）。
 *
 * 两种写法都收：十六进制（`#89CFF0` / `89CFF0` / `#0af`）与 RGB
 * （`137, 207, 240` / `rgb(137,207,240)`）。解析与归一在
 * `domain/color.parseColorInput`（唯一实现），本弹窗只做输入体验：
 * 实时预览色块、非法值置灰确认键、`Enter` 提交 / `Esc` 取消。
 *
 * 返回值**恒为归一后的 `#rrggbb`**（或 null = 取消），调用方不重复解析。
 */
import { App } from 'obsidian';
import { t, type Language } from '../core/i18n';
import { parseColorInput } from '../domain/color';
import { createButton, openFormModal } from './modal-common';

export function openColorInputModal(
	app: App,
	lang: Language,
	current: string | null,
): Promise<string | null> {
	return openFormModal<string>({
		app,
		title: t(lang, 'modal.color.title'),
		rootCls: 'mindmap-color-editor',
		build: ({ root, submit }) => {
			const hint = root.createDiv();
			hint.setText(t(lang, 'modal.color.hint'));
			hint.addClass('mindmap-modal-muted-hint');

			const input = root.createEl('input', {
				cls: 'mindmap-modal-input',
				attr: {
					type: 'text',
					value: current ?? '',
					placeholder: t(lang, 'modal.color.placeholder'),
					spellcheck: 'false',
				},
			});
			// 预览区：布局与尺寸走样式表；色块颜色是用户输入的运行时值，在 sync 里写内联
			const preview = root.createDiv({ cls: 'mindmap-color-preview' });
			const swatch = preview.createSpan({
				cls: 'mindmap-color-preview-swatch',
			});
			const valueText = preview.createSpan();
			const invalid = root.createDiv({
				cls: 'mindmap-modal-muted-hint mindmap-color-invalid',
			});
			invalid.setText(t(lang, 'modal.color.invalid'));
			invalid.hidden = true;

			const buttons = root.createDiv();
			buttons.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--mt');
			createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
				submit(null);
			});
			const confirmButton = createButton(
				buttons,
				t(lang, 'modal.apply'),
				'primary',
				() => confirm(),
			);

			const parsed = (): string | null => parseColorInput(input.value);

			/** 输入即校验：色块跟随、非法值给出说明并置灰确认键 */
			const sync = (): void => {
				const color = parsed();
				// 空输入只置灰确认键、不报错（一打开就红字会显得像出错）
				invalid.hidden = color !== null || input.value.trim() === '';
				confirmButton.setDisabled(color === null);
				// 动态色值无法用类表达：`Object.assign(el.style, …)` 是仓库既有写法
				//（逐条 `el.style.X = '字面量'` 会触发 obsidianmd/no-static-styles-assignment）
				Object.assign(swatch.style, {
					backgroundColor: color ?? 'transparent',
				});
				valueText.setText(color ?? '');
			};

			const confirm = (): void => {
				const color = parsed();
				if (!color) {
					input.focus();
					return;
				}
				submit(color);
			};

			input.addEventListener('input', sync);
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					confirm();
				} else if (event.key === 'Escape') {
					// Esc 已由 Modal 关闭并兜底 settle(null)；显式提交保持幂等
					submit(null);
				}
			});
			sync();
			input.focus();
			input.select();
		},
	});
}
