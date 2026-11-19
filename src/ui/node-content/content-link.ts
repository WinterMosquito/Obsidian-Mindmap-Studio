/** 节点内容 link：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { anchorStyle, UNRESOLVED_LINK_STYLES, INTERNAL_LINK_STYLES, EXTERNAL_LINK_STYLES } from './content-link.styles';
import { isSafeAnchorHref } from '../../domain/url';

/**
 * 锚点形态与 Obsidian MarkdownRenderer 产物一致（这是点击「零改造」的前提）：
 * 库内 = `a.internal-link[data-href]`（原始 linkpath，无 [[ ]] 包裹）；
 * 外部 = `a.external-link[href]`。view-wikilink 的 `findAnchorInNode` /
 * `resolveAnchorLink` 按此分流，本模块不得改变这两个属性名。
 *
 * 库内锚点另有**未解析**形态（`is-unresolved` + 弱化配色）：与 Obsidian 阅读视图
 * 一致，用户据此知道目标尚不存在。判定由调用方注入（`options.isResolvedLink`），
 * 每次构建实时求值——不进段序列缓存（缓存按原文寻址，与库状态无关）。
 */
export function buildAnchor(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const anchor = doc.createElement('a');
	anchor.textContent = segment.text;
	const link = segment.link ?? '';
	if (segment.internal) {
		const unresolved = params.options.isResolvedLink
			? !params.options.isResolvedLink(link)
			: false;
		Object.assign(
			anchor.style,
			anchorStyle(
				unresolved ? UNRESOLVED_LINK_STYLES : INTERNAL_LINK_STYLES,
				params.tones,
			),
		);
		// 类名是锚点识别的契约（findAnchorInNode 用 `a.internal-link` 前缀匹配），
		// 故未解析形态必须是「internal-link 之上加 is-unresolved」，不能替换为别的名
		anchor.className = unresolved
			? 'internal-link is-unresolved'
			: 'internal-link';
		anchor.setAttribute('data-href', link);
	} else {
		Object.assign(anchor.style, anchorStyle(EXTERNAL_LINK_STYLES, params.tones));
		anchor.className = 'external-link';
		// 安全（K101 防御纵深）：链接原文来自 Markdown，可能是
		// `[点我](javascript:…)` / `data:` 这类危险协议——直接写进 href 后，一旦
		// 宿主按链接打开（中键/右键新标签/Obsidian 外链委托）即成脚本执行面
		//（Obsidian 运行在 Electron 上）。非安全协议仍按外链样式呈现，只是不设
		// href：点击走 data-href 分流，插件侧已有协议过滤，功能不受影响。
		if (isSafeAnchorHref(link)) {
			anchor.setAttribute('href', link);
		}
	}
	return anchor;
}
