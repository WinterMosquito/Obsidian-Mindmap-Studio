/**
 * 弹窗共享件：官方 ButtonComponent 封装、Promise settle 守卫、
 * 库内文件联想（AbstractInputSuggest 统一实现）。
 * 被各 modal-*.ts 弹窗模块共用（从 modals.ts 拆出）。
 */
import {
	AbstractInputSuggest,
	App,
	ButtonComponent,
	Modal,
	setIcon,
	TFile,
} from 'obsidian';

export type ButtonVariant = 'primary' | 'secondary' | 'muted';

/**
 * 创建 Obsidian 官方按钮组件（主题一致、含可达性处理）。
 * primary 用 CTA 强调色；muted 为弱化操作（.is-muted 降饱和）。
 */
export function createButton(
	container: HTMLElement,
	text: string,
	variant: ButtonVariant,
	onClick: () => void,
): ButtonComponent {
	const button = new ButtonComponent(container);
	button.setButtonText(text);
	if (variant === 'primary') {
		button.setCta();
	} else if (variant === 'muted') {
		button.buttonEl.addClass('is-muted');
	}
	button.onClick(onClick);
	return button;
}

/**
 * 弹窗 Promise settle 守卫（modal-image / modal-link / modal-name 样板收口）：
 * - settle 幂等：按钮先 settle 再 close 时，onClose 的兜底是 no-op；
 * - onClose 兜底：Esc / 点击遮罩等非按钮路径关闭时 Promise 必然 resolve，
 *   调用方 await 不会永久挂起。
 * 注意先 settle 再 modal.close() 的顺序约定由调用方保持
 * （close 同步触发 onClose，若先 close 会被兜底 settle(null) 抢先）。
 */
export function createModalSettle<T>(
	modal: Modal,
	resolve: (value: T | null) => void,
): (value: T | null) => void {
	let settled = false;
	const settle = (value: T | null): void => {
		if (settled) {
			return;
		}
		settled = true;
		resolve(value);
	};
	modal.onClose = () => settle(null);
	return settle;
}

/** 联想候选数量上限（与 Obsidian 输入联想的轻量行为一致） */
const MAX_SUGGESTIONS = 20;

/** 联想条目的展示描述（图标 + 显示名，由弹窗按文件类型决定） */
export interface FileSuggestAppearance {
	icon: string;
	label: string;
}

/**
 * 库内文件输入联想（官方 AbstractInputSuggest 统一实现）。
 * 此前 modal-image / modal-link 各有一份近似子类（过滤、截断、渲染 90% 重复）；
 * 收口后候选列表与展示策略由调用方注入：
 * - candidates：候选文件（如全部图片、或 md 笔记在前附件在后的合并列表）；
 * - describe：按文件返回图标与显示名（笔记 basename / 附件含扩展名等）。
 */
export class VaultFileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly candidates: TFile[],
		private readonly describe: (file: TFile) => FileSuggestAppearance,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const keyword = query.toLowerCase().trim();
		if (!keyword) {
			return [];
		}
		const result: TFile[] = [];
		for (const file of this.candidates) {
			if (file.basename.toLowerCase().includes(keyword)) {
				result.push(file);
				if (result.length >= MAX_SUGGESTIONS) {
					break;
				}
			}
		}
		return result;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		const { icon, label } = this.describe(file);
		const iconEl = el.createSpan({ cls: 'mindmap-link-suggest-icon' });
		setIcon(iconEl, icon);
		el.createSpan({ text: label });
		const path = el.createSpan({
			cls: 'note-path',
			text: file.parent?.path ?? '',
		});
		path.addClass('mindmap-link-suggest-path');
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}
