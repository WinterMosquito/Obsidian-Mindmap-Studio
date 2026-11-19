import { describe, expect, it, vi } from 'vitest';
import { FakeDocument, FakeElement, asDocument } from '../../helpers/node-content-dom';
import type { PluginBlockRequest } from '../../../src/core/plugin-content-types';
import { buildPluginBlock } from '../../../src/ui/node-content/content-plugin';

describe('插件节点测量槽位', () => {
	it('构建期间只登记槽位与来源，不自行创建或克隆活动组件', () => {
		const fake = new FakeDocument(); const doc = asDocument(fake); const owner = {};
		const render = vi.fn((_request: PluginBlockRequest) => null);
		const options = { pluginContent: { supports: () => true, mode: () => 'live' as const, render } };
		const source = 'tab: A\n```shell\necho test\n```';
		const card = buildPluginBlock(doc, { kind: 'text', style: 'code', block: true, lang: 'tab', text: source }, options, 'zh', null, 'n1', 2, owner, 400);
		expect((card as unknown as FakeElement).className).toBe('mindmap-plugin-card');
		expect(render.mock.calls[0]?.[0]).toMatchObject({ nodeId: 'n1', index: 2, owner, source, language: 'tab', availableWidth: 368 });
	});
	it('缓存副本同步进入测量槽位；静态图保留复制源码按钮', () => {
		const fake = new FakeDocument(); const doc = asDocument(fake); const image = fake.createElement('svg');
		const options = { pluginContent: { supports: () => true, mode: () => 'static' as const, render: () => image as unknown as HTMLElement } };
		const card = buildPluginBlock(doc, { kind: 'text', style: 'code', block: true, lang: 'tikz', text: '\\draw (0,0);' }, options, 'zh', null, 'n1', 0, {}, null) as unknown as FakeElement;
		const slot = card.children[0] as FakeElement;
		expect(slot.children).toEqual([image]);
		expect((card.children[1] as FakeElement).getAttribute('data-code')).toBe('\\draw (0,0);');
	});
});
