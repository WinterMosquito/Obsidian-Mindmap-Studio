/** 在同一个真实浏览器文档里比较 HEAD 与当前渲染器的 DOM、尺寸和注入调用。 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** @param {string} root @param {string} baselineRoot */
export function buildNodeContentCompareSource(root, baselineRoot) {
	const current = join(root, 'src/features/content/node-inline-html.ts').replaceAll('\\', '/');
	// 两侧独立解析：HEAD 快照可能仍使用迁移前的平铺路径。
	const baselineFile = [
		'src/features/content/node-inline-html.ts',
		'src/features/node-inline-html.ts',
	].map(file => join(baselineRoot, file)).find(file => existsSync(file));
	if (!baselineFile) throw new Error(`HEAD 快照缺少节点内容入口：${baselineRoot}`);
	const baseline = baselineFile.replaceAll('\\', '/');
	const raws = [
		'', '普通中文节点', 'React / : ? 技术体系', '长文本'.repeat(220),
		'[[目录/笔记|别名]] 与 [站点](https://example.com)',
		'[危险](javascript:alert(1)) 与 [[未解析]]', '**粗 _斜_** `代码` ==高亮== ~~删除~~',
		'**粗[^1]** #标签/子项', '引用[^a,b] 和 [^2]', '[^a,b]: 定义一\n[^2]: 定义二',
		'[ ] 未完成', '[x] 已完成', '[X] 原样大写',
		'$x^2$ 与 $$E=mc^2$$', '$$\n\\begin{matrix}a&b\\\\c&d\\end{matrix}\n$$',
		'```js\n  const a = 1;\n\n  return a;\n```', '```\n无语言\n```',
		'```mermaid\ngraph LR\nA-->B\n```', '```mermaid\ninvalid\n```',
		'|左|右|\n|:---|---:|\n|**粗[^1]**|[[目标]]|\n|`码`|$x$|',
		'> 引用 **重点**\n> [[笔记]]', '> [!info]- 标题 [[笔记]]\n> 正文[^1]',
		'> [!custom]+ 自定义\n> 正文', '> [!info] > 字面标题',
		'> [!tip] 代码\n> ```js\n> const a = 1;\n> ```',
		'> [!tip] 表格\n> |甲|乙|\n> |---|---|\n> |a|b|',
		'> 一层\n> > 二层\n> > > 三层字面',
		'> [!tip] 仅标题', '转义 \\#标签 \\$x\\$ 与 %%注释%%', '![[图片.png]]',
	];
	return `
import * as before from ${JSON.stringify(baseline)};
import * as after from ${JSON.stringify(current)};
const raws = ${JSON.stringify(raws)};
const result = document.createElement('pre'); result.id = 'node-content-compare-probe';
document.body.appendChild(result);
const fail = (message) => { throw new Error(message); };
(async () => {
	try {
		await document.fonts.ready;
		let compared = 0;
		for (const [index, raw] of raws.entries()) for (const fillColor of [undefined, '#e7e8ea', '#111827']) {
			for (const lang of ['zh', 'en']) for (const cached of [false, true]) {
				const data = { text: raw, mdRaw: raw, mdDerivedText: raw, mdType: 'list', mdTask: index === 10 ? 'todo' : index === 11 || index === 12 ? 'done' : undefined, image: index === 29 ? '图片.png' : undefined, fillColor, customTextWidth: index % 3 === 0 ? 280 : undefined };
				const node = { getData: () => data, customTextWidth: index % 7 === 0 ? 360 : undefined };
				const initial = JSON.stringify(data);
				const owner = {};
				const options = (calls) => ({
					isResolvedLink: link => { calls.push(['link', link]); return link !== '未解析'; },
					getCachedMath: (tex, display) => {
						calls.push(['math-cache', tex, display]);
						if (!cached) return null;
						const el = document.createElement('span'); el.textContent = '公式:' + tex; return el;
					},
					renderMath: (_doc, tex, _holder, display, actualOwner) => { calls.push(['math-render', tex, display, actualOwner === owner]); },
					getCachedCode: (code, language) => {
						calls.push(['code-cache', code, language]);
						if (!cached) return null;
						const el = document.createElement('span'); el.textContent = code; el.style.color = '#987'; return [el];
					},
					renderCode: (_doc, code, language) => { calls.push(['code-render', code, language]); },
					renderMermaid: code => {
						calls.push(['mermaid', code]); if (code === 'invalid') return null;
						const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
						svg.setAttribute('width', '60'); svg.setAttribute('height', '30');
						const a = document.createElementNS(svg.namespaceURI, 'a'); a.setAttribute('href', 'https://example.com');
						svg.appendChild(a); return svg;
					},
					resolveCalloutIcon: icon => { calls.push(['callout-icon', icon]); const el = document.createElement('span'); el.textContent = '◊'; return el; },
				});
				const firstCalls = [], secondCalls = [];
				const style = { fontSize: '15px', fontWeight: '400', color: '#334455' };
				for (const preview of [false, true]) {
					const first = preview ? before.buildInlineTextContent(document, raw, lang, options(firstCalls)) : before.buildInlineNodeContent(node, document, style, lang, options(firstCalls), owner);
					const second = preview ? after.buildInlineTextContent(document, raw, lang, options(secondCalls)) : after.buildInlineNodeContent(node, document, style, lang, options(secondCalls), owner);
					const label = 'fixture=' + index + ', color=' + fillColor + ', lang=' + lang + ', cached=' + cached + ', preview=' + preview;
					if ((first?.outerHTML ?? null) !== (second?.outerHTML ?? null)) fail('DOM/内联样式/测量缓存键不一致: ' + label);
					if (first && second) {
						document.body.append(first, second);
						const a = first.getBoundingClientRect(), b = second.getBoundingClientRect();
						if (Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) fail('尺寸改变: ' + label);
						const x = getComputedStyle(first), y = getComputedStyle(second);
						for (const key of ['fontSize', 'fontFamily', 'color', 'maxWidth', 'lineHeight', 'padding']) if (x[key] !== y[key]) fail('计算样式改变: ' + label + ', ' + key);
						// foreignObject 导出序列化同样必须逐字一致。
						const serializer = new XMLSerializer();
						if (serializer.serializeToString(first) !== serializer.serializeToString(second)) fail('导出序列化改变: ' + label);
						first.remove(); second.remove();
					}
					compared++;
				}
				if (JSON.stringify(firstCalls) !== JSON.stringify(secondCalls)) fail('注入调用顺序/缓存行为改变: fixture=' + index);
				if (JSON.stringify(data) !== initial) fail('渲染修改节点数据: fixture=' + index);
			}
		}
		result.textContent = JSON.stringify({ ok: true, compared });
	} catch (error) { result.textContent = JSON.stringify({ error: error.stack || String(error) }); }
})();
`;
}
