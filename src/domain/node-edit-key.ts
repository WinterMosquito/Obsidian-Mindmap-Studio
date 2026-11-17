/** 节点原文编辑的按键语义；IME 组合态由 DOM 组件先行短路。 */
/** 键盘动作（纯函数判定，见下方裁决表） */
export type InlineEditKeyAction = 'commit' | 'newline' | 'none';

/**
 * 按键 → 动作（纯函数，供单测直测；IME 组合态由调用方先行短路）。
 *
 * 表（2026-09-28 裁决）：`Enter`/`Mod+Enter`/`Tab`/`Escape` = 提交
 * （Esc 为「停止并保留」）；`Shift+Enter` = 换行；`Alt+Enter` 与其他键 = 让位。
 */
export function resolveInlineEditKey(event: {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}): InlineEditKeyAction {
	if (event.key === 'Enter') {
		if (event.altKey) {
			return 'none';
		}
		if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
			return 'newline';
		}
		return 'commit';
	}
	if (event.key === 'Escape' || event.key === 'Tab') {
		return 'commit';
	}
	return 'none';
}

