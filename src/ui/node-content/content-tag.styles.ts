/** 节点内容 tag.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { THEME_LINK_COLOR } from './content-common.styles';

/**
 * 标签 pill 的内联样式（**导出保真**：导出图不含 styles.css）。
 *
 * 配色与内链**同源**（`THEME_LINK_COLOR`）：文字直接取链接色，底色取同色
 * 14% 混合——14% 落在 `#7f6df2` 兜底上时与改造前的 `rgba(127, 109, 242, 0.14)`
 * 等价，无主题变量的环境观感不变。底色走 `color-mix` 而不是写死的 rgba：
 * 它必须跟着主题链接色走（2026-10-28 用户裁决「标签/任务同 Wiki 链接配色」）。
 * `color-mix` 按 **premultiplied** 插值，`transparent` 只贡献 alpha ⇒ 结果恰为
 * `rgba(<链接色>, 0.14)`，不是「往黑色里混」。`color-mix` 需 Chromium 111+
 * （Obsidian 1.13 的 Electron 远高于此），导出 `<img>` 解码由同一渲染引擎完成，
 * 故屏上与导出是同一份值；**第三方 SVG 编辑器**（不支持该函数）会把底色退成
 * transparent——已知且可接受的降级，别当缺陷去补第二份 rgba。
 *
 * 用 `<a>` 但**不写 href**：既有 `ANCHOR_SELECTOR`
 * （`a.internal-link, a.external-link, a[href]`）因此不会命中它，链接的三条
 * 通道（点击 / 悬停预览 / 中键）零改动；标签点击由 `features/content/view-tag` 的
 * `a.tag[data-tag]` 分支单独接管（唯一入口，文件视图与只读嵌入共用）。
 */
export const TAG_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'inline',
	padding: '0 4px',
	borderRadius: '4px',
	textDecoration: 'none',
	cursor: 'pointer',
	color: THEME_LINK_COLOR,
	backgroundColor: `color-mix(in srgb, ${THEME_LINK_COLOR} 14%, transparent)`,
};
