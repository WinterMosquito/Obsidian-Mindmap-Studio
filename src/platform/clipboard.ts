/**
 * 系统剪贴板 IO 收口（**纯文本**）：复制/剪切/粘贴的唯一读写面。
 *
 * 为什么落在 platform：读写的是宿主（Electron/Chromium）能力，与
 * `platform/system-open`（把链接交给系统应用）同类。剪贴板的**内容形态**
 * 判定不在这里——「子树 → 大纲文本」在 `markdown/md-serialize`，
 * 「文本 → 子树」在 `markdown/md-outline`（硬规则 5：不造第二份判定）。
 *
 * 失败**不抛**、留痕后回 `false` / `null`：读/写失败属用户可感操作的一环，
 * 由调用方（`features/view-clipboard`）统一提示；本层再提示一次即同根因两条
 * 提示（决策表「错误呈现」）。
 */

/**
 * 写入纯文本；返回是否成功（失败已在此留痕，调用方据此提示）。
 *
 * @param ownerDocument 调用方所在文档。**popout 场景必须传**（节点内代码块的
 *        复制按钮挂副窗口文档）：取按钮属主窗口的 `navigator` 才在焦点判定下
 *        可用，主窗口 `navigator` 在副窗口里可能被拒。缺省用全局 `navigator`。
 *
 * 为什么要这个参数而不是让调用方自开一条写通道（2026-10-15 收口）：`node-codeblock`
 * 与 `view-context-menu` 曾各自直调 `navigator.clipboard` 并自带 catch/Notice，
 * 与本函数形成三套失败呈现——决策表「通用机制各一份」。
 */
export async function writeClipboardText(
	text: string,
	ownerDocument?: Document | null,
): Promise<boolean> {
	try {
		const nav = ownerDocument?.defaultView?.navigator ?? navigator;
		await nav.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.warn('MindMap Studio：写入剪贴板失败', error);
		return false;
	}
}

/**
 * 读取纯文本；不可用/被拒时返回 `null`。
 *
 * 两条读取通道的分工（不是第二份判定，是两条能力不同的入口）：
 * - 键盘路径优先用 `paste` 事件自带的 `clipboardData`——同步读、**不要求
 *   任何权限**（见 `features/view-paste`）；
 * - 菜单路径没有事件可用（右键「粘贴」），只能走本函数（`readText`）；
 *   宿主拒绝时回 `null`，由调用方提示。
 */
export async function readClipboardText(): Promise<string | null> {
	try {
		return await navigator.clipboard.readText();
	} catch (error) {
		console.warn('MindMap Studio：读取剪贴板失败', error);
		return null;
	}
}
