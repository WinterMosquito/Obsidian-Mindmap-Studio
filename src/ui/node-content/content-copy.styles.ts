/** 节点内容 copy.styles：DOM/样式内聚，保持原输出与导出保真。 */


/** 代码块复制按钮类名（视图层点击委托的选择器，见 features/content/node-codeblock.ts） */
export const CODE_COPY_CLASS = 'tmm-code-copy';

/**
 * 复制按钮：外观 **100% 内联**（形状 mask / 填充 currentColor / 圆角）——
 * styles.css 类规则口径在本机曾被证实不可靠，外观不得依赖它；基色取
 * `--icon-color`（Obsidian 原生图标按钮变量）→ `--text-muted` → 默认灰兜底。
 * 屏上恒显（不写 opacity）；**导出图隐身**由 `handleExportSvg` 钩子
 * （`node-codeblock.hideCopyButtonsInExportSvg`）显式置 0。
 */
export const CODE_COPY_BUTTON_STYLES: Partial<CSSStyleDeclaration> & Record<string, string> = {
	position: 'absolute',
	top: '6px',
	// 逻辑属性（K115）：Obsidian 原生用 `inset-inline-end: 0`（app.css:11857），
	// 物理 `right` 在 RTL 语言下不镜像（与本轮 styles.css 的三处方向属性同类问题）。
	insetInlineEnd: '6px',
	width: '20px',
	height: '20px',
	padding: '0',
	border: 'none',
	borderRadius: '4px',
	cursor: 'pointer',
	color: 'var(--icon-color, var(--text-muted, #666666))',
	backgroundColor: 'currentColor',
	maskImage:
		`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='14' height='14' x='8' y='8' rx='2' ry='2'/%3E%3Cpath d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/%3E%3C/svg%3E")`,
	maskRepeat: 'no-repeat',
	maskPosition: 'center',
	maskSize: '14px',
};
