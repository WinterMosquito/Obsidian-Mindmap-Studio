/**
 * 错误处理共享件：统一的消息提取与用户可见提示。
 *
 * 此前 `error instanceof Error ? error.message : String(error)` 三元在
 * creation / images-save / view-export / view-paste 四处复制；
 * 「i18n 前缀 + errorMessage」的 Notice 拼接另有 5 处（save/create/
 * attachment/export/paste），收口为 notifyError 后格式化只有一份实现。
 */
import { Notice } from 'obsidian';
import { t, type Language, type TranslationKey } from './i18n';

/** 从 unknown 错误中提取可展示消息（Notice / console 输出用） */
export function errorMessage(error: unknown): string {
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
