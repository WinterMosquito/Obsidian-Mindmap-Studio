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
