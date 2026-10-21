/**
 * mindmap-theme 回归：布局/偏好 → 连线样式解析与主题配置产出。
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
	getThemeConfig,
	resolveLineStyle,
	supportsLineStyleSwitch,
} from '../src/engine/mindmap-theme';

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

describe('getThemeConfig（主题：节点外观，与主题色正交）', () => {
	/** 读取某一层级的节点 token（getThemeConfig 返回 Record<string, unknown>） */
	const tokenOf = (
		config: Record<string, unknown>,
		level: 'root' | 'second' | 'node',
	): Record<string, unknown> => config[level] as Record<string, unknown>;

	it('默认主题沿用色板：second/node 有填充与 1px 描边（存量观感，升级零变化）', () => {
		for (const isDark of [false, true]) {
			const config = getThemeConfig(isDark, 'logicalStructure');
			for (const level of ['second', 'node'] as const) {
				const token = tokenOf(config, level);
				expect(token.fillColor, `${isDark}/${level}`).not.toBe('transparent');
				expect(token.borderWidth, `${isDark}/${level}`).toBe(1);
			}
		}
	});

	it('无边框主题：second/node 填充与描边一起消失（只去描边会留一层淡灰底）', () => {
		for (const isDark of [false, true]) {
			const config = getThemeConfig(
				isDark,
				'logicalStructure',
				'straight',
				'borderless',
			);
			for (const level of ['second', 'node'] as const) {
				const token = tokenOf(config, level);
				expect(token.fillColor, `${isDark}/${level}`).toBe('transparent');
				expect(token.borderColor, `${isDark}/${level}`).toBe('transparent');
				expect(token.borderWidth, `${isDark}/${level}`).toBe(0);
			}
		}
	});

	it('无边框主题不动根节点（保留主题色填充作视觉锚点）', () => {
		const root = tokenOf(
			getThemeConfig(false, 'logicalStructure', 'straight', 'borderless'),
			'root',
		);
		expect(root.fillColor).toBe('#4a90d9');
		expect(root.borderWidth).toBe(0);
	});

	it('主题不得越权改字体度量与连线（各有单一来源）', () => {
		const config = getThemeConfig(
			false,
			'logicalStructure',
			'straight',
			'borderless',
		);
		expect(tokenOf(config, 'node').fontSize).toBe(13);
		expect(tokenOf(config, 'second').fontSize).toBe(14);
		expect(config.marginX).toBe(60);
		expect(config.marginY).toBe(24);
		expect(config.lineWidth).toBe(1.5);
	});

	it('主题与主题色、连线偏好互不干扰（三维正交）', () => {
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

	it('脏值/未知 id 回退默认主题（手改 data.json 不致渲染失败）', () => {
		for (const value of ['nope', '', 'BORDERLESS', 'default ']) {
			const config = getThemeConfig(
				false,
				'logicalStructure',
				'straight',
				value,
			);
			expect(tokenOf(config, 'node').borderWidth, value).toBe(1);
		}
	});
});
