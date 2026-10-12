/**
 * 错误处理共享件：统一的消息提取、用户可见提示与**内部告警留痕**。
 *
 * 此前 `error instanceof Error ? error.message : String(error)` 三元在
 * creation / images-save / view-export / view-paste 四处复制；
 * 「i18n 前缀 + errorMessage」的 Notice 拼接另有 5 处（save/create/
 * attachment/export/paste），收口为 notifyError 后格式化只有一份实现。
 *
 * 「同一根因只告警一次」此前在 prism-code / math-jax（两处）/ view 各写了一份
 * 模块级或实例级去重标记，连 `MindMap Studio：` 前缀也各写一遍——收口为
 * `createWarnOnce` 后调用方只给正文。内部告警（console）的呈现口径见
 * AGENTS.md 决策表：用户可感 → `notifyError`；内部 → `console.error/warn`。
 */
import { Notice } from 'obsidian';
import { t, type Language, type TranslationKey } from './i18n';

/** 内部告警统一前缀（与既有 console.warn 文案口径一致） */
const WARN_PREFIX = 'MindMap Studio：';

/**
 * 创建「同一根因只告警一次」的留痕器（幂等 console.warn）。
 *
 * 为什么要收口（2026-10-11 审查）：同一机制此前有 4 份实现——`prism-code` 的
 * `renderWarned`、`math-jax` 的 `renderApiMissingWarned` 与 `renderInvisibleWarned`、
 * `view` 的 `contentRemeasureUnresolvedWarned`；四处的去重语义（首次输出、此后静默）
 * 与前缀完全同构，属「第二份判定」（AGENTS.md 硬规则 5）。
 *
 * 去重范围＝**返回的函数实例**（不是全局按文案去重）：模块级 const 得到「进程内一次」，
 * 视图实例字段得到「该视图一次」——两种既有语义都能表达，且互不干扰。
 *
 * 为什么这类留痕必须做：静默降级会让失效**无痕退化**（K85 ①/K113 的教训——
 * 单测与视觉闸门都触不到真环境，告警是唯一线索）。
 *
 * @returns 幂等告警函数：首次调用输出 `` `${WARN_PREFIX}${message}` ``，
 *   `detail` 非 `undefined` 时作为第二个参数一并输出（避免多写一个空串参数），
 *   此后同实例的调用一律静默。
 */
export function createWarnOnce(): (message: string, detail?: unknown) => void {
	let warned = false;
	return (message: string, detail?: unknown): void => {
		if (warned) {
			return;
		}
		warned = true;
		if (detail === undefined) {
			console.warn(`${WARN_PREFIX}${message}`);
		} else {
			console.warn(`${WARN_PREFIX}${message}`, detail);
		}
	};
}

/** 从 unknown 错误中提取可展示消息（Notice / console 输出用） */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 弹出用户可见的错误提示：i18n 文案作前缀 + 错误消息。
 * @param key 前缀文案 key（如 'save.failed'，通常以冒号/空格结尾）
 */
export function notifyError(
	lang: Language,
	key: TranslationKey,
	error: unknown,
): void {
	new Notice(`${t(lang, key)}${errorMessage(error)}`);
}
