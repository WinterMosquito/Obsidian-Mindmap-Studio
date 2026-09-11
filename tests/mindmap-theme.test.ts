/**
 * mindmap-theme 回归：布局/偏好 → 连线样式解析与主题配置产出。
 *
 * 事实基线（对照 vendor bundle 的布局类实现）：
 * - 六种布局中**四种为直线**：组织结构图经 `lineStyle: 'straight'` 生效
 *   （引擎为该布局实现三态 renderLine 分派，straight 为「父节点底部 → 竖直主干
 *   → 水平分叉 → 子节点顶部」的正交折线）；目录组织图 / 时间轴 / 鱼骨图的
 *   布局类本身即直线绘制（renderLine 只输出 M/L 路径、不接受 lineStyle）——
 *   登记在同一清单里是如实声明，对其渲染无副作用；
 * - 逻辑结构图 / 思维导图为圆滑曲线。**「其余五种都是曲线」是错误认知**。
 * - 三态（curve/direct/straight）仅对逻辑结构图/思维导图/组织结构图可见效果；
 *   auto（含未知坏值）回落布局默认——脏 data.json 不把非法值透传给引擎。
 *
 * 本模块零 vendor 依赖（仅常量与类型），可直接单测。
 */
import { describe, expect, it } from 'vitest';
import {
	getThemeConfig,
	lineStyleForLayout,
	resolveLineStyle,
	supportsLineStyleSwitch,
} from '../src/mindmap-theme';

describe('lineStyleForLayout（布局 → 布局默认连线样式）', () => {
	it('组织结构图经 lineStyle 得直线（引擎该布局支持 curve/direct/straight 三态）', () => {
		expect(lineStyleForLayout('organizationStructure')).toBe('straight');
	});

	it('目录组织图 / 时间轴 / 鱼骨图同为直线布局（布局类本身即直线，登记保持一致语义）', () => {
		for (const layout of ['catalogOrganization', 'timeline', 'fishbone']) {
			expect(lineStyleForLayout(layout), layout).toBe('straight');
		}
	});

	it('逻辑结构图与思维导图为圆滑曲线', () => {
		for (const layout of ['logicalStructure', 'mindMap']) {
			expect(lineStyleForLayout(layout), layout).toBe('curve');
		}
	});

	it('未知布局回落曲线（引擎侧同名非法值回落 logicalStructure）', () => {
		expect(lineStyleForLayout('unknownLayout')).toBe('curve');
	});
});

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
	it('显式偏好直接采用（三态对支持三态的布局可见效果）', () => {
		expect(resolveLineStyle('curve', 'organizationStructure')).toBe('curve');
		expect(resolveLineStyle('direct', 'logicalStructure')).toBe('direct');
		expect(resolveLineStyle('straight', 'mindMap')).toBe('straight');
	});

	it('auto / 未知值 / 空串回落布局默认（四种直线布局 straight、两种曲线布局 curve）', () => {
		for (const preference of ['auto', 'zigzag', '']) {
			expect(resolveLineStyle(preference, 'organizationStructure'), preference).toBe(
				'straight',
			);
			expect(resolveLineStyle(preference, 'catalogOrganization'), preference).toBe(
				'straight',
			);
			expect(resolveLineStyle(preference, 'logicalStructure'), preference).toBe(
				'curve',
			);
			expect(resolveLineStyle(preference, 'mindMap'), preference).toBe('curve');
		}
	});

	it('auto 偏好下布局切换即改变实际样式（组织结构图 → 直线）', () => {
		expect(resolveLineStyle('auto', 'mindMap')).toBe('curve');
		expect(resolveLineStyle('auto', 'organizationStructure')).toBe('straight');
	});
});

describe('getThemeConfig（lineStyle 随偏好与布局透传）', () => {
	it('auto：四种直线布局 straight、两种曲线布局 curve（亮/暗配色下一致）', () => {
		for (const isDark of [false, true]) {
			for (const layout of [
				'organizationStructure',
				'catalogOrganization',
				'timeline',
				'fishbone',
			]) {
				expect(getThemeConfig(isDark, layout).lineStyle, layout).toBe(
					'straight',
				);
			}
			for (const layout of ['logicalStructure', 'mindMap']) {
				expect(getThemeConfig(isDark, layout).lineStyle, layout).toBe('curve');
			}
		}
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

	it('显式偏好覆盖布局默认（direct/straight/curve；不传参数等同 auto）', () => {
		expect(getThemeConfig(false, 'mindMap', 'direct').lineStyle).toBe('direct');
		expect(getThemeConfig(false, 'mindMap', 'straight').lineStyle).toBe(
			'straight',
		);
		expect(
			getThemeConfig(false, 'organizationStructure', 'curve').lineStyle,
		).toBe('curve');
		expect(getThemeConfig(false, 'mindMap').lineStyle).toBe('curve');
	});
});
