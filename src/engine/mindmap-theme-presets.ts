/**
 * 主题（节点外观风格）数据表 —— **纯数据，不含任何分支逻辑**。
 *
 * 与 `mindmap-theme.ts`（渲染管线）的分工：本文件只声明「每个主题长什么样」，
 * 管线只负责把它合并进色板。新增一套主题 = 本表加一条 + `core/constants` 的
 * `THEME_STYLE_OPTIONS` 加一条 id + i18n 加一对中英文案，**渲染代码零改动**。
 *
 * 硬约束：
 * 1. **只能覆盖节点填充/描边**——字号、间距、连线样式各由 `variant` 单一来源表达，
 *    主题越权会与「主题色 / 布局 / 连线偏好」三方打架；
 * 2. 与「主题色」（明暗）**正交**：本表不写死任何色板色值，只用 `transparent`
 *    表达「不绘制」，具体色值一律由 `LIGHT_COLORS` / `DARK_COLORS` 决定；
 * 3. `Record<ThemeStyleId, …>` 把本表绑死到选项表：新增 id 而漏写外观（或反之）
 *    直接编译失败，杜绝「选项存在但渲染无感」的静默退化；
 * 4. id 发布即冻结——它会写进 `data.json`，改名等于让用户的设置失效。
 */
import type { ThemeStyleId } from '../core/constants';

/** 主题可覆盖的节点外观键（其余键一律沿用主题色板） */
interface ThemeNodeOverride {
	fillColor?: string;
	borderColor?: string;
	borderWidth?: number;
}

/** 按层级声明覆盖；未列出的层级/键一律沿用主题色板 */
export interface ThemeStylePreset {
	root?: ThemeNodeOverride;
	second?: ThemeNodeOverride;
	node?: ThemeNodeOverride;
}

/**
 * 无边框节点的共同外观：填充与描边一并去掉。
 *
 * 为什么连填充一起去：只去描边会留一层淡灰底——亮色下 second 的 `#f1f5f9`
 * 与画布 `#ffffff` 仅差 2%，肉眼仍看得出灰块；暗色下 node 的 `#1e1e1e` 本就与
 * 画布同色。因此置 `transparent` 在暗色下观感与改造前完全一致，亮色下才真正干净。
 *
 * `Object.freeze`：second 与 node 共用同一份声明，防止日后单边修改造成两层级漂移。
 */
const BORDERLESS_NODE: ThemeNodeOverride = Object.freeze({
	fillColor: 'transparent',
	borderColor: 'transparent',
	borderWidth: 0,
});

export const THEME_STYLE_PRESETS: Record<ThemeStyleId, ThemeStylePreset> = {
	/** 默认：完全沿用色板（＝本特性引入前的外观，存量用户升级后零变化） */
	default: {},
	/**
	 * 无边框：second / node 去掉填充与描边，文字直接浮在画布上；
	 * root 保持主题色填充作视觉锚点（它本就没有描边，且不宜失去锚点）。
	 */
	borderless: {
		second: BORDERLESS_NODE,
		node: BORDERLESS_NODE,
	},
};
