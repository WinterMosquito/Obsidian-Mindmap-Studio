/** 搜索栏组件：DOM、文案、键盘分流与焦点；不读取导图或搜索结果。 */
import { setIcon, setTooltip } from 'obsidian';
import { createDebouncer } from '../../core/concurrency';
import { EventBinder } from '../../core/event-binder';

export interface SearchBarLabels {
	placeholder: string;
	prev: string;
	next: string;
	close: string;
}

interface SearchBarActions {
	input: () => void;
	prev: () => void;
	next: () => void;
	close: () => void;
}

const SEARCH_FOCUS_DELAY_MS = 50;

export class SearchBar {
	readonly input: HTMLInputElement;
	readonly count: HTMLElement;
	private readonly events = new EventBinder();
	private readonly focus = createDebouncer(SEARCH_FOCUS_DELAY_MS);
	private readonly buttons: { key: 'prev' | 'next' | 'close'; element: HTMLButtonElement }[] = [];

	constructor(private readonly root: HTMLElement, labels: SearchBarLabels, actions: SearchBarActions) {
		root.addClass('mindmap-search-bar-hidden');
		this.input = root.createEl('input', {
			cls: 'mindmap-search-input',
			attr: { type: 'text', placeholder: labels.placeholder, spellcheck: 'false' },
		});
		this.count = root.createSpan('mindmap-search-count');
		for (const [key, icon] of [['prev', 'chevron-up'], ['next', 'chevron-down'], ['close', 'x']] as const) {
			const element = root.createEl('button', { cls: 'mindmap-search-btn' });
			setIcon(element, icon);
			element.onclick = actions[key];
			this.buttons.push({ key, element });
		}
		this.updateLabels(labels);
		this.events.onDom(this.input, 'input', actions.input);
		this.events.onDom(this.input, 'keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				if (event.shiftKey) actions.prev();
				else actions.next();
			} else if (event.key === 'Escape') actions.close();
		});
	}

	updateLabels(labels: SearchBarLabels): void {
		this.input.setAttribute('placeholder', labels.placeholder);
		for (const { key, element } of this.buttons) setTooltip(element, labels[key]);
	}

	open(): void {
		this.root.removeClass('mindmap-search-bar-hidden');
		this.focus.schedule(() => this.input.focus());
	}

	close(): void {
		this.focus.cancel();
		this.root.addClass('mindmap-search-bar-hidden');
		this.input.value = '';
		this.count.setText('');
	}

	setCount(text: string, noResult: boolean): void {
		this.count.setText(text);
		if (noResult) this.count.addClass('mindmap-search-no-result');
		else this.count.removeClass('mindmap-search-no-result');
	}

	dispose(): void {
		this.focus.cancel();
		this.events.destroy();
		for (const { element } of this.buttons) element.onclick = null;
		this.buttons.length = 0;
		this.root.empty();
	}
}
