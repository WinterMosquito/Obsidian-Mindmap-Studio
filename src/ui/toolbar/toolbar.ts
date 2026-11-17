/** 工具栏组件：只管理骨架、按钮呈现与局部点击反馈；动作由调用方提供。 */
import { setIcon, setTooltip } from 'obsidian';

interface ToolbarButtonState {
	icon: string;
	tooltip: string;
	pressed?: boolean;
	disabled?: boolean;
}

export interface ToolbarButtonSpec {
	id: string;
	describe: () => ToolbarButtonState;
	onClick?: () => void;
}

interface ButtonEntry {
	spec: ToolbarButtonSpec;
	element: HTMLButtonElement;
	state?: ToolbarButtonState;
}

const HUD_TOOLTIP = { placement: 'left' } as const;

export class Toolbar {
	private readonly buttons: ButtonEntry[] = [];

	constructor(private readonly root: HTMLElement, groups: readonly (readonly ToolbarButtonSpec[])[]) {
		const rail = root.createDiv('mindmap-hud mindmap-hud--rail');
		for (const specs of groups) {
			const group = rail.createDiv('mindmap-hud-group');
			for (const spec of specs) {
				const element = group.createEl('button', { cls: 'mindmap-tool-btn' });
				const entry: ButtonEntry = { spec, element };
				this.buttons.push(entry);
				if (spec.onClick) {
					element.onclick = () => {
						if (element.disabled) return;
						spec.onClick?.();
						this.refresh([spec.id]);
					};
				}
				this.render(entry);
			}
		}
	}

	/** 历史变化只刷新历史按钮，不重建图标、DOM 或监听。 */
	refresh(ids?: readonly string[]): void {
		for (const entry of this.buttons) {
			if (!ids || ids.includes(entry.spec.id)) this.render(entry);
		}
	}

	private render(entry: ButtonEntry): void {
		const { element, spec, state: previous } = entry;
		const state = spec.describe();
		if (previous?.icon !== state.icon) setIcon(element, state.icon);
		if (previous?.tooltip !== state.tooltip) setTooltip(element, state.tooltip, HUD_TOOLTIP);
		if (state.pressed !== undefined) element.setAttribute('aria-pressed', String(state.pressed));
		if (state.disabled !== undefined) {
			element.disabled = state.disabled;
			element.toggleClass('is-disabled', state.disabled);
			// 无动作的固定布局开关沿用原来的 disabled 语义。
			if (spec.onClick) element.setAttribute('aria-disabled', String(state.disabled));
		}
		entry.state = state;
	}

	dispose(): void {
		for (const { element } of this.buttons) element.onclick = null;
		this.buttons.length = 0;
		this.root.empty();
	}
}
