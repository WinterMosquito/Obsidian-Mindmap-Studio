/**
 * mindmap-theme 回归：布局 / 偏好 → 连线样式解析与边框配置产出。
 *
 * 事实基线（2026-10-21 连线样式收敛为两态）：
 * - 可选样式只有**折线（straight，正交折线）/ 曲线（curve）**；`auto`（随布局）
 *   与 `direct`（直连）已下线，存量值在读取侧归一为折线。
 * - 逻辑结构图 / 思维导图 / 组织结构图支持切换（引擎为该三者实现三态 renderLine，
 *   折线绘制「父节点底部 → 竖直主干 → 水平分叉 → 子节点顶部」）；
 *   目录组织图 / 时间轴 / 鱼骨图的布局类本身即直线绘制（renderLine 只输出 M/L
 *   路径、不接受 lineStyle）——`resolveLineStyle` 对这三者恒返回 straight。
 *
 * 本模块零 vendor 依赖（仅常量与类型），可直接单测。
 */
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_THEME_STYLE,
	normalizePalette,
	PALETTE_OPTIONS,
} from '../src/core/constants';
import {
	contrastRatio,
	hexToHsl,
	nodeColorScale,
	relativeLuminance,
} from '../src/domain/color';
import { paletteNodeColor } from '../src/engine/mindmap-palette';
import {
	getThemeConfig,
	resolveLineStyle,
	supportsLineStyleSwitch,
} from '../src/engine/mindmap-theme';
import {
	NODE_COLORS,
	nodeLineColorOf,
	PALETTES,
} from '../src/engine/mindmap-theme-presets';

/** 读取 getThemeConfig 返回值中某一层级的节点 token */
function tokenOf(
	config: Record<string, unknown>,
	level: 'root' | 'second' | 'node',
): Record<string, unknown> {
	return config[level] as Record<string, unknown>;
}

describe('supportsLineStyleSwitch（布局是否支持三态切换）', () => {
	it('逻辑结构图 / 思维导图 / 组织结构图支持切换', () => {
		for (const layout of [
			'logicalStructure',
			'mindMap',
			'organizationStructure',
		]) {
			expect(supportsLineStyleSwitch(layout), layout).toBe(true);
		}
	});

	it('目录组织图 / 时间轴 / 鱼骨图为固定直线布局（工具栏据此收窄选项面）', () => {
		for (const layout of ['catalogOrganization', 'timeline', 'fishbone']) {
			expect(supportsLineStyleSwitch(layout), layout).toBe(false);
		}
	});

	it('未知布局不支持（不误开选项面）', () => {
		expect(supportsLineStyleSwitch('unknownLayout')).toBe(false);
	});
});

describe('resolveLineStyle（偏好 + 布局 → 实际连线样式）', () => {
	it('两态偏好直接采用：curve 保留、straight 保留（支持切换的布局）', () => {
		expect(resolveLineStyle('curve', 'organizationStructure')).toBe('curve');
		expect(resolveLineStyle('curve', 'logicalStructure')).toBe('curve');
		expect(resolveLineStyle('straight', 'mindMap')).toBe('straight');
	});

	it('旧词汇与脏值归一为折线（auto / direct / 未知 / 空串）', () => {
		for (const preference of ['auto', 'direct', 'zigzag', '']) {
			expect(resolveLineStyle(preference, 'logicalStructure'), preference).toBe(
				'straight',
			);
			expect(resolveLineStyle(preference, 'mindMap'), preference).toBe(
				'straight',
			);
			expect(
				resolveLineStyle(preference, 'organizationStructure'),
				preference,
			).toBe('straight');
		}
	});

	it('固定直线布局恒 straight（lineStyle 对其无效：不把偏好透传给引擎）', () => {
		for (const layout of ['catalogOrganization', 'timeline', 'fishbone']) {
			expect(resolveLineStyle('curve', layout), layout).toBe('straight');
			expect(resolveLineStyle('straight', layout), layout).toBe('straight');
		}
	});
});

describe('getThemeConfig（lineStyle 两态：偏好 / 布局 / 默认）', () => {
	it('不传偏好＝折线（新默认），亮/暗一致', () => {
		for (const isDark of [false, true]) {
			expect(getThemeConfig(isDark, 'logicalStructure').lineStyle).toBe(
				'straight',
			);
			expect(getThemeConfig(isDark, 'mindMap').lineStyle).toBe('straight');
		}
	});

	it('曲线偏好对支持切换的布局生效；固定直线布局仍为折线', () => {
		expect(getThemeConfig(false, 'logicalStructure', 'curve').lineStyle).toBe(
			'curve',
		);
		expect(
			getThemeConfig(false, 'organizationStructure', 'curve').lineStyle,
		).toBe('curve');
		expect(getThemeConfig(false, 'fishbone', 'curve').lineStyle).toBe(
			'straight',
		);
	});

	it('旧词汇 auto / direct 归一为折线（存量 data.json 不清盘也能正确显示）', () => {
		expect(getThemeConfig(false, 'mindMap', 'auto').lineStyle).toBe('straight');
		expect(getThemeConfig(false, 'mindMap', 'direct').lineStyle).toBe(
			'straight',
		);
	});

	it('根节点连线起点在右缘（修复根节点衔接的关键开关，勿回退）', () => {
		expect(
			getThemeConfig(false, 'logicalStructure')
				.rootLineStartPositionKeepSameInCurve,
		).toBe(true);
		expect(
			getThemeConfig(true, 'mindMap').rootLineStartPositionKeepSameInCurve,
		).toBe(true);
	});
});

describe('getThemeConfig（边框：节点外观，与主题色正交）', () => {
	it('有边框（default）沿用色板：second / node 有填充与 1px 描边', () => {
		// 显式传 id，避免用例依赖出厂默认值
		for (const isDark of [false, true]) {
			const config = getThemeConfig(
				isDark,
				'logicalStructure',
				'straight',
				'default',
			);
			for (const level of ['second', 'node'] as const) {
				const token = tokenOf(config, level);
				expect(token.fillColor, `${isDark}/${level}`).not.toBe('transparent');
				expect(token.borderWidth, `${isDark}/${level}`).toBe(1);
			}
		}
	});

	it('无边框：填充透明 + 描边宽度归零，描边颜色保留（小地图拿它当墨）', () => {
		for (const isDark of [false, true]) {
			const variant = isDark ? 'dark' : 'light';
			const config = getThemeConfig(
				isDark,
				'logicalStructure',
				'straight',
				'borderless',
			);
			for (const level of ['second', 'node'] as const) {
				const token = tokenOf(config, level);
				expect(token.fillColor, `${variant}/${level}`).toBe('transparent');
				expect(token.borderWidth, `${variant}/${level}`).toBe(0);
				// 「不描边」由宽度表达；颜色留着，缩略图节点块才不会跟着消失
				expect(token.borderColor, `${variant}/${level}`).toBe(
					PALETTES.default[variant].border,
				);
			}
		}
	});

	it('无边框不动根节点（保留主题色填充作视觉锚点）', () => {
		const root = tokenOf(
			getThemeConfig(false, 'logicalStructure', 'straight', 'borderless'),
			'root',
		);
		expect(root.fillColor).toBe(PALETTES.default.light.rootFill);
		expect(root.borderWidth).toBe(0);
	});

	it('边框不得越权改字体度量与连线（两档取值完全一致）', () => {
		// 不锁具体数值：字号 / 间距 / 线宽各有单一来源（2026-11-05 起字号梯度为
		// 24/16/13），本用例只验证「换边框档位不会连带改它们」。
		const metrics = (themeStyle: string): Record<string, unknown> => {
			const config = getThemeConfig(
				false,
				'logicalStructure',
				'straight',
				themeStyle,
			);
			return {
				rootFont: tokenOf(config, 'root').fontSize,
				secondFont: tokenOf(config, 'second').fontSize,
				nodeFont: tokenOf(config, 'node').fontSize,
				secondWeight: tokenOf(config, 'second').fontWeight,
				nodePaddingX: tokenOf(config, 'node').paddingX,
				nodePaddingY: tokenOf(config, 'node').paddingY,
				marginX: config.marginX,
				marginY: config.marginY,
				lineWidth: config.lineWidth,
			};
		};
		expect(metrics('borderless')).toEqual(metrics('default'));
	});

	it('边框与主题色、连线偏好互不干扰（三维正交）', () => {
		const light = getThemeConfig(false, 'mindMap', 'curve', 'borderless');
		const dark = getThemeConfig(true, 'mindMap', 'curve', 'borderless');
		for (const config of [light, dark]) {
			expect(tokenOf(config, 'node').fillColor).toBe('transparent');
			expect(config.lineStyle).toBe('curve');
		}
		// 明暗色板仍在起作用（文字色随主题色变化）
		expect(tokenOf(light, 'root').fillColor).not.toBe(
			tokenOf(dark, 'root').fillColor,
		);
	});

	it('脏值/未知 id 回退出厂默认（手改 data.json 不致渲染失败）', () => {
		// 与「出厂默认」逐值比对，不写死边框宽度（默认值会变，脏值回退口径不能变）
		const fallback = getThemeConfig(
			false,
			'logicalStructure',
			'straight',
			DEFAULT_THEME_STYLE,
		);
		for (const value of ['nope', '', 'BORDERLESS', 'default ']) {
			const config = getThemeConfig(
				false,
				'logicalStructure',
				'straight',
				value,
			);
			expect(tokenOf(config, 'node'), value).toEqual(
				tokenOf(fallback, 'node'),
			);
		}
	});
});

describe('getThemeConfig（配色：色相方案，与明暗 / 边框三维正交）', () => {
	/** 从选项表派生（新增配色时这里不再需要手改，防漏测） */
	const PALETTE_IDS = PALETTE_OPTIONS.map((option) => option.value);

	const configOf = (
		isDark: boolean,
		palette: string,
		themeStyle = 'default',
	): Record<string, unknown> =>
		getThemeConfig(isDark, 'logicalStructure', 'straight', themeStyle, palette);

	it('默认配色逐值取自 PALETTES.default（亮暗两档，升级即换肤）', () => {
		// 填充色只在「有边框」形态上可见；文件记录可能是无边框，故显式取 default
		const light = configOf(false, 'default');
		expect(tokenOf(light, 'root').fillColor).toBe(
			PALETTES.default.light.rootFill,
		);
		expect(tokenOf(light, 'second').fillColor).toBe(
			PALETTES.default.light.secondFill,
		);
		expect(tokenOf(light, 'node').fillColor).toBe(
			PALETTES.default.light.nodeFill,
		);
		expect(tokenOf(light, 'second').borderColor).toBe(
			PALETTES.default.light.border,
		);
		expect(light.lineColor).toBe(PALETTES.default.light.line);

		const dark = configOf(true, 'default');
		expect(tokenOf(dark, 'root').fillColor).toBe(PALETTES.default.dark.rootFill);
		expect(dark.lineColor).toBe(PALETTES.default.dark.line);
	});

	it('联系（关系连线）取更轻的辅助线：同连线色、1.5px、4,4 虚线、12px 标签', () => {
		// 关联线无避让（两点贝塞尔），故靠"更细 + 更密虚线 + 小字号"降低穿节点的视觉重量；
		// 线是否画在节点之下由 opt（engine/mindmap.createMindMap）决定，不在主题里。
		const light = configOf(false, 'default');
		expect(light.associativeLineColor).toBe(light.lineColor);
		expect(light.associativeLineWidth).toBe(1.5);
		expect(light.associativeLineDasharray).toBe('4,4');
		expect(light.associativeLineTextFontSize).toBe(12);
		// 标签色跟随节点文字色（不用纯黑），亮暗各自成立
		expect(light.associativeLineTextColor).toBe(tokenOf(light, 'node').color);
		const dark = configOf(true, 'default');
		expect(dark.associativeLineTextColor).toBe(tokenOf(dark, 'node').color);
	});

	it('六套配色都产出完整九键色板，且亮暗两档成对（root / line 不同）', () => {
		for (const palette of PALETTE_IDS) {
			const light = configOf(false, palette);
			const dark = configOf(true, palette);
			for (const level of ['root', 'second', 'node'] as const) {
				expect(tokenOf(light, level).fillColor, `${palette}/light/${level}`).toMatch(
					/^#[0-9a-f]{6}$/,
				);
				expect(tokenOf(dark, level).fillColor, `${palette}/dark/${level}`).toMatch(
					/^#[0-9a-f]{6}$/,
				);
			}
			expect(tokenOf(light, 'root').fillColor, palette).not.toBe(
				tokenOf(dark, 'root').fillColor,
			);
			expect(light.lineColor, palette).not.toBe(dark.lineColor);
		}
	});

	it('文字色不随配色变（三档按明暗固定，避免彩色底配错字）', () => {
		const lightRootTexts = new Set(
			PALETTE_IDS.map((p) => tokenOf(configOf(false, p), 'root').color),
		);
		const darkRootTexts = new Set(
			PALETTE_IDS.map((p) => tokenOf(configOf(true, p), 'root').color),
		);
		expect(lightRootTexts.size).toBe(1);
		expect(darkRootTexts.size).toBe(1);
	});

	/**
	 * 2026-11-05 配色 id 由植物/物品名改为颜色名。**只改名的读兼容**：
	 * 存量 `data.json` 里的旧 id 打开即按对应新配色渲染，不能静默回落 default
	 * （否则用户以为配色丢了）。
	 */
	it('旧配色 id 读兼容：六个别名逐一映射到新 id，脏值仍回落 default', () => {
		expect(normalizePalette('mint')).toBe('teal');
		expect(normalizePalette('amber')).toBe('orange');
		expect(normalizePalette('rose')).toBe('crimson');
		expect(normalizePalette('wisteria')).toBe('purple');
		expect(normalizePalette('forest')).toBe('green');
		expect(normalizePalette('slate')).toBe('grey');
		// 新 id 原样、未知值回退
		expect(normalizePalette('teal')).toBe('teal');
		expect(normalizePalette('nope')).toBe('default');
	});

	it('配色与无边框正交：root 保留配色、second / node 被置透明', () => {
		const config = configOf(false, 'teal', 'borderless');
		expect(tokenOf(config, 'root').fillColor).toBe(PALETTES.teal.light.rootFill);
		expect(tokenOf(config, 'node').fillColor).toBe('transparent');
		expect(tokenOf(config, 'second').borderWidth).toBe(0);
	});

	/**
	 * 预设可辨性回归（2026-10-29）：节点级配色把主色当「色相锚」，一支一整片。
	 * 曾经的 `forest #2f7d5a` 与 `mint #2e9e8f` 只差 18°（ΔE76 18.0、派生填充 2.7），
	 * 实机上两支几乎同色——本用例把「主色 ΔE ≥ 25 / 派生填充 ΔE ≥ 5」写成契约。
	 *
	 * 参与比较的档位**从选项表派生**（新增配色自动纳入，不会因为漏改一张手写表而
	 * 静默漏测），只排除两档：`default`（整篇基准蓝，不是节点菜单项）与 `grey`
	 * （刻意的中性降噪档，C* ≈ 13，不参与彩色两两比较）。
	 */
	const COLORFUL_PALETTES = PALETTE_IDS.filter(
		(palette) => palette !== 'default' && palette !== 'grey',
	);

	it('彩色预设两两可辨：主色 ΔE76 ≥ 25，节点色直出主色，且主色都承载得住反白字', () => {
		const colorful = COLORFUL_PALETTES;
		const lab = (hex: string): [number, number, number] => {
			const channel = (index: number): number => {
				const value =
					Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
				return value <= 0.04045
					? value / 12.92
					: ((value + 0.055) / 1.055) ** 2.4;
			};
			const [r, g, b] = [channel(0), channel(1), channel(2)];
			const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
			const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
			const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
			const f = (t: number): number =>
				t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
			return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
		};
		const deltaE = (a: string, b: string): number => {
			const [l1, a1, b1] = lab(a);
			const [l2, a2, b2] = lab(b);
			return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
		};

		for (let i = 0; i < colorful.length; i++) {
			const left = PALETTES[colorful[i]!].light.rootFill;
			for (let j = i + 1; j < colorful.length; j++) {
				const right = PALETTES[colorful[j]!].light.rootFill;
				expect(
					deltaE(left, right),
					`${colorful[i]} vs ${colorful[j]} 主色`,
				).toBeGreaterThanOrEqual(25);
			}
		}
		for (const palette of colorful) {
			const root = PALETTES[palette].light.rootFill;
			// 2026-11-04 直出：节点填充就是主色本身，不再洗成浅档
			expect(nodeColorScale(root).fill, `${palette} 直出`).toBe(root);
			// root 承载反白字：设计约束是 ≥3:1（加粗大字可读）
			expect(contrastRatio(root, '#ffffff'), palette).toBeGreaterThanOrEqual(3);
		}
	});

	/**
	 * 两套色板的**同色相**契约（2026-11-05 审核补漏）。
	 *
	 * `NODE_COLORS` 管「点给某个节点的填充 / 线条」，`PALETTES` 管「整篇层级色」，
	 * 是同一套色语言的两种用途，但代码上只有人眼对齐——此前测试只锁了「两者不是
	 * 同一个值」，把某个节点色挪 40° 也不会有红灯。
	 *
	 * 判据：同 id 的两个 hex 色相**差 ≤ 8°**（实测最大 3.6°，出现在 `default` 的
	 * 210.6 / 214.2——差值来自六位取整与「填充按另一档明度反推」的浮点误差）；明度
	 * 分工固定为「根色中深（承载反白字）→ 填充最浅（大面积铺开不压屏）→ 线条深于
	 * 填充（fit 缩放下结构线仍可见）」。
	 */
	it('两套色板同色相：节点填充 / 线条与整篇根色不各说各话', () => {
		const hueOf = (hex: string): number => {
			const hsl = hexToHsl(hex);
			if (!hsl) {
				throw new Error(`不是合法色值：${hex}`);
			}
			return hsl.h;
		};
		/** 色相环上的最短距离（0–180） */
		const hueGap = (a: string, b: string): number => {
			const diff = Math.abs(hueOf(a) - hueOf(b));
			return Math.min(diff, 360 - diff);
		};
		for (const palette of PALETTE_IDS) {
			const { fill, line } = NODE_COLORS[palette];
			const root = PALETTES[palette].light.rootFill;
			expect(hueGap(fill, root), `${palette}：填充 vs 整篇根色`).toBeLessThanOrEqual(8);
			expect(hueGap(line, fill), `${palette}：线条 vs 填充`).toBeLessThanOrEqual(8);
			expect(
				relativeLuminance(fill),
				`${palette}：填充应浅于整篇根色`,
			).toBeGreaterThan(relativeLuminance(root));
			expect(
				relativeLuminance(line),
				`${palette}：线条应深于填充`,
			).toBeLessThan(relativeLuminance(fill));
		}
	});

	it('配色与明暗正交：每套配色在亮/暗下都生效且互不相同', () => {
		const lightRoots = PALETTE_IDS.map(
			(p) => tokenOf(configOf(false, p), 'root').fillColor,
		);
		// 六套 root 互不相同（否则说明某套配色没被读到，退回同一个值）
		expect(new Set(lightRoots).size).toBe(PALETTE_IDS.length);
	});

	it('未知 / 空 / 大小写不符的配色回退「默认」（手改 data.json 不致渲染失败）', () => {
		const defaultRoot = tokenOf(configOf(false, 'default'), 'root').fillColor;
		for (const bad of ['nope', '', 'DEFAULT', 'teal ']) {
			expect(tokenOf(configOf(false, bad), 'root').fillColor, bad).toBe(defaultRoot);
		}
	});
});

describe('getThemeConfig（自定义整篇配色：一个十六进制 → 五档色板）', () => {
	const tokenOf = (
		config: Record<string, unknown>,
		level: 'root' | 'second' | 'node',
	): Record<string, unknown> => config[level] as Record<string, unknown>;

	const configOf = (
		isDark: boolean,
		palette: string,
	): Record<string, unknown> =>
		getThemeConfig(isDark, 'logicalStructure', 'straight', 'default', palette);

	it('根节点用原色，二/三级向画布底色淡出（不等于原色）', () => {
		const config = configOf(false, '#89cff0');
		expect(tokenOf(config, 'root').fillColor).toBe('#89cff0');
		expect(tokenOf(config, 'second').fillColor).not.toBe('#89cff0');
		expect(tokenOf(config, 'node').fillColor).not.toBe('#89cff0');
		// 层级递减：second 比 node 更接近主色（更深）
		expect(tokenOf(config, 'second').fillColor).not.toBe(
			tokenOf(config, 'node').fillColor,
		);
	});

	it('文字色按底色亮度现算：浅底深字、深底白字', () => {
		const light = configOf(false, '#89cff0');
		expect(tokenOf(light, 'second').color).toBe('#1e293b');
		const dark = configOf(false, '#123456');
		expect(tokenOf(dark, 'root').color).toBe('#ffffff');
	});

	/**
	 * 2026-11-05 实机对照的缺陷：同一个 `#2d62be`，预设「湛蓝」与自定义走两条
	 * 派生路径 → 描边更深、连线更浅（比自己的描边还浅）、二级文字更黑。
	 * 现在两边共用同一套明度阶梯，只允许色相/饱和度不同。
	 */
	it('自定义色与预设同一套明度阶梯（同色 → 同样的深浅与文字色）', () => {
		const custom = configOf(false, '#2d62be');
		const preset = configOf(false, 'blue');
		expect(tokenOf(custom, 'root').fillColor).toBe(
			tokenOf(preset, 'root').fillColor,
		);
		const lum = (value: unknown): number => relativeLuminance(value as string);
		for (const level of ['second', 'node'] as const) {
			expect(
				Math.abs(
					lum(tokenOf(custom, level).fillColor) -
						lum(tokenOf(preset, level).fillColor),
				),
				level,
			).toBeLessThan(0.04);
		}
		// 描边与连线也同阶梯（旧实现里连线反而比描边浅，结构感倒挂）
		expect(
			Math.abs(
				lum(tokenOf(custom, 'second').borderColor) -
					lum(tokenOf(preset, 'second').borderColor),
			),
		).toBeLessThan(0.04);
		expect(
			Math.abs(lum(custom.lineColor) - lum(preset.lineColor)),
		).toBeLessThan(0.04);
		// 二/三级文字色沿用预设那组固定值，不再按每档亮度各算一次
		expect(tokenOf(custom, 'node').color).toBe(tokenOf(preset, 'node').color);
		expect(tokenOf(custom, 'second').color).toBe(
			tokenOf(preset, 'second').color,
		);
	});

	it('亮 / 暗两档各自向背景靠拢（同一主色在暗色下派生更深）', () => {
		const lightSecond = tokenOf(configOf(false, '#89cff0'), 'second')
			.fillColor as string;
		const darkSecond = tokenOf(configOf(true, '#89cff0'), 'second')
			.fillColor as string;
		expect(lightSecond).not.toBe(darkSecond);
	});

	it('非法十六进制回退「默认」预设（手改 data.json 不致渲染失败）', () => {
		const fallback = tokenOf(configOf(false, 'default'), 'root').fillColor;
		for (const bad of ['#12345', '#gggggg', '#89cff0ff']) {
			expect(tokenOf(configOf(false, bad), 'root').fillColor, bad).toBe(fallback);
		}
	});

	it('节点配色菜单取「节点填充色」而非整篇根色（2026-11-05 分流）', () => {
		// 填充是柔和浅色（写进正文、大面积铺开不刺眼），与整篇 rootFill（中深、承载反白字）不同
		expect(paletteNodeColor('teal')).toBe(NODE_COLORS.teal.fill);
		expect(paletteNodeColor('teal')).not.toBe(PALETTES.teal.light.rootFill);
		// 线条是同色相深档（比填充深一截，用于结构与描边），与填充成对
		expect(nodeLineColorOf(NODE_COLORS.teal.fill)).toBe(NODE_COLORS.teal.line);
		expect(NODE_COLORS.teal.line).not.toBe(NODE_COLORS.teal.fill);
		// 自定义 hex 没有配对：按同色相深一档（浅填充也要看得见结构线）
		expect(nodeLineColorOf('#89cff0')).toBe('#228dc0');
		// 深色输入不会黑成一团：L 下限 22 托底
		expect(nodeLineColorOf('#123456')).toBe('#173859');
	});
});

/**
 * 概要括号的起笔留白（`generalizationLineMargin`）。
 *
 * 为什么锁死：引擎默认 0 —— 括号线紧贴被覆盖节点的右缘，而「＋」展开按钮也挂在
 * 那里、垂直居中，线的凸起方向正好穿过按钮（2026-11-03 实机：想展开子节点时
 * 点到线）。这不是可调偏好，而是「线必须从按钮外侧起笔」的硬要求，故按数值下限
 * 断言，改小了会直接红灯。
 */
describe('generalizationLineMargin（概要括号不与「＋」按钮抢位）', () => {
	it('各配色 / 明暗下都留出正留白，且不小于展开按钮的半径量级', () => {
		for (const isDark of [false, true]) {
			for (const palette of ['default', 'teal', '#89cff0']) {
				const margin = getThemeConfig(
					isDark,
					'logicalStructure',
					'curve',
					'default',
					palette,
				).generalizationLineMargin;
				expect(typeof margin, `${isDark}/${palette}`).toBe('number');
				expect(margin as number, `${isDark}/${palette}`).toBeGreaterThanOrEqual(8);
			}
		}
	});
});
