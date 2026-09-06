/**
 * 错误处理共享件：统一的消息提取。
 *
 * 此前 `error instanceof Error ? error.message : String(error)` 三元在
 * creation / images-save / view-export / view-paste 四处复制。
 */

/** 从 unknown 错误中提取可展示消息（Notice / console 输出用） */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
