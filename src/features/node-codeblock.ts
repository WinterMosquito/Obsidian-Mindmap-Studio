/**
 * 代码块复制交互（视图层）：节点内块级代码块的「悬停复制按钮」行为，
 * 对齐 Obsidian 阅读视图的代码块复制（悬停显形 → 点击复制 → 短暂 ✓）。
 *
 * 为什么在这里而不是构建器里：`node-inline-content` 是**零 Obsidian 依赖**的
 * 纯构建模块（可无头打包/可单测），它的代码块分支只产出 DOM 结构
 * （`.tmm-codeblock` > `.tmm-code-copy` 按钮）。点击语义沿**引擎 `node_click`
 * 委托**承接——与 `view-wikilink` 的锚点点击同款模式，在 `view.ts` 同一处注册
 * （事件携带原始 MouseEvent，`event.target` 即真实落点元素）。
 *
 * 复制内容 = 被点按钮所在代码块的 `pre > code` 文本（围栏信息行已在段构建时
 * 剥离，见 `node-inline-content.splitFenceInfo`；不含围栏定界符）。
 * 反馈与剪贴板失败均**不抛穿**渲染链：失败仅 `console.warn`（可诊断）。
 */
import { CODE_BLOCK_CLASS, CODE_COPY_CLASS } from './node-inline-content';
import type { MindMapViewContext } from './view-context';

/** 复制按钮命中：构建侧类名的单一来源（node-inline-content 导出） */
const COPY_BUTTON_SELECTOR = `.${CODE_COPY_CLASS}`;
/** 代码块容器选择器 */
const CODE_BLOCK_SELECTOR = `.${CODE_BLOCK_CLASS}`;

/** ✓ 反馈保持时长（毫秒）：与 Obsidian 复制按钮的短暂反馈口径一致 */
const COPIED_FEEDBACK_MS = 1200;

/**
 * 从点击目标解析「复制按钮 + 复制文本」；非按钮目标返回 null。
 *
 * 复制文本**优先读构建期写入的 `data-code`**（buildCodeBlockElement 在构建时
 * 把段文本定死在按钮上）——不依赖 closest/querySelector 的 DOM 链，点击路径
 * 上任何 DOM 变动（重建/克隆/测量副本）都不会改变复制内容；`data-code` 缺失
 * （旧构建/异常形态）才回落 `pre > code` 的 textContent。
 *
 * 纯函数（只做 closest/getAttribute/querySelector 链，无副作用），供单测直测。
 * 按钮存在而文本缺失（异常形态）时返回空串——仍给出 ✓ 反馈，不静默吞点击。
 */
export function resolveCodeCopyTarget(
	target: EventTarget | null,
): { button: HTMLElement; text: string } | null {
	if (!(target instanceof Element)) {
		return null;
	}
	const button = target.closest(COPY_BUTTON_SELECTOR);
	if (!(button instanceof HTMLElement)) {
		return null;
	}
	const embedded = button.getAttribute('data-code');
	if (embedded !== null && embedded !== undefined) {
		return { button, text: embedded };
	}
	const block = button.closest(CODE_BLOCK_SELECTOR);
	const code = block?.querySelector('pre code');
	return { button, text: code?.textContent ?? '' };
}

/** 按钮 → ✓ 反馈定时器（重复点击重置；按钮脱离后到点自行清理，无泄漏面） */
const feedbackTimers = new WeakMap<HTMLElement, number>();

/**
 * 写入剪贴板：取按钮**属主窗口**的 navigator（popout 场景按钮挂副窗口文档，
 * 主窗口 navigator 在焦点判定上可能不成立）；失败仅告警并返回 false。
 */
async function copyText(button: HTMLElement, text: string): Promise<boolean> {
	try {
		const nav = button.ownerDocument?.defaultView?.navigator ?? navigator;
		await nav.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.warn('MindMap Studio：复制代码失败，保留原状', error);
		return false;
	}
}

/**
 * ✓ 反馈：置字形 + `is-copied` 类 + **外观直改内联样式**（2026-09-28 第四轮：
 * 不依赖 styles.css 新鲜度——用户实机长期滞留旧版 CSS，只写在类规则里的
 * 「撤 mask/撤底色/成功色」会不生效）。进反馈前快照 `style` 属性原文，到点
 * **逐字还原**（等于回到构建期内联态）；引擎中途重建节点则 WeakMap 到点
 * 空转，无泄漏面。
 */
function showCopiedFeedback(button: HTMLElement): void {
	const win = button.ownerDocument?.defaultView;
	if (!win) {
		return;
	}
	const previous = feedbackTimers.get(button);
	if (previous !== undefined) {
		win.clearTimeout(previous);
	}
	const previousStyle = button.getAttribute('style');
	button.textContent = '✓';
	button.classList.add('is-copied');
	// 撤图标 mask/填充 → ✓ 字形可见；成功色与字号对齐 styles.css 的 is-copied 口径
	button.style.setProperty('mask-image', 'none');
	button.style.backgroundColor = 'transparent';
	button.style.color = 'var(--text-success, var(--text-accent))';
	button.style.fontSize = '12px';
	button.style.lineHeight = '20px';
	button.style.textAlign = 'center';
	const timer = win.setTimeout(() => {
		feedbackTimers.delete(button);
		button.textContent = '';
		button.classList.remove('is-copied');
		if (previousStyle === null) {
			button.removeAttribute('style');
		} else {
			button.setAttribute('style', previousStyle);
		}
	}, COPIED_FEEDBACK_MS);
	feedbackTimers.set(button, timer);
}

/**
 * 注册代码块复制交互（`initMindMap` 内调用一次，与 wikilink 交互同点——
 * 见 `features/view.ts` 的注册块）。命中复制按钮即写剪贴板并按结果反馈；
 * 其余点击**不拦截**（节点选择/编辑等引擎默认语义不受影响）。
 */
export function registerCodeBlockInteractions(view: MindMapViewContext): void {
	if (!view.mindMap) {
		return;
	}
	view.engineEvents.onEngine(view.mindMap, 'node_click', (...args: unknown[]) => {
		const event = args[1] as MouseEvent | undefined;
		const resolved = resolveCodeCopyTarget(event?.target ?? null);
		if (!resolved) {
			return;
		}
		void copyText(resolved.button, resolved.text).then((ok) => {
			if (ok) {
				showCopiedFeedback(resolved.button);
			}
		});
	});
}
