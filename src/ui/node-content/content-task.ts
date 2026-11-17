/** 节点内容 task：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { NODE_TASK_CLASS, TASK_BOX_STYLES, TASK_GLYPH_STYLES, taskMarkColor } from './content-task.styles';
import { t } from '../../core/i18n';
import { THEME_LINK_COLOR } from './content-common.styles';

/**
 * 任务复选框：状态由 `data.mdTask` 决定，点击切换由 `features/view-node-task`
 * 在画布 capture 阶段接管（本函数只负责画，不绑事件——节点会随渲染重建，
 * 逐元素绑监听必然泄漏）。
 */
export function buildTaskCheckbox(
	doc: InlineContentDocument,
	state: 'todo' | 'done',
	params: BuildContentParams,
): HTMLElement {
	const box = doc.createElement('span');
	box.className = NODE_TASK_CLASS;
	box.setAttribute('data-task', state);
	box.setAttribute('role', 'checkbox');
	box.setAttribute('aria-checked', state === 'done' ? 'true' : 'false');
	box.setAttribute(
		'aria-label',
		t(
			params.lang,
			state === 'done' ? 'node.task.markUndone' : 'node.task.markDone',
		),
	);
	Object.assign(box.style, TASK_BOX_STYLES);
	// 着色节点：描边/填充取派生墨色（与行内码、表格线同源）；未着色走主题
	// 链接色——与内链、标签 pill 共用同一个基色常量（2026-10-28 用户裁决）
	const ink = params.tones?.ink;
	const accent = ink ?? THEME_LINK_COLOR;
	box.style.borderColor = accent;
	// 对勾层两态都建（未勾选留空）：结构恒定，避免「有没有子节点」再引出
	// 任何尺寸差异（基线/层叠上下文以外的第二份变量）
	const mark = doc.createElement('span');
	Object.assign(mark.style, TASK_GLYPH_STYLES);
	mark.textContent = state === 'done' ? '✓' : '';
	if (state === 'done') {
		box.style.backgroundColor = accent;
		// 对勾层继承盒色，故只在这里定一次（判据见 taskMarkColor）
		box.style.color = taskMarkColor(ink);
	}
	box.appendChild(mark);
	return box;
}
