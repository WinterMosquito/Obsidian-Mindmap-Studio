/**
 * 引擎节点 data（渲染字段）与渲染层 md 元数据的合并视图。
 *
 * 放在 src 根层而非 domain/：它同时引用引擎 vendor 类型与 domain 元数据
 * 契约，属于"黏合类型"——domain 保持纯领域逻辑（零引擎/Obsidian/上层
 * 依赖），由 eslint 的 no-restricted-imports 边界规则强制。
 */
import type { MindMapNodeData } from '../../vendor/simple-mind-map.cjs';
import type { MdNodeMeta } from '../domain/md-meta';

/**
 * 引擎节点 data + md 元数据的合并视图。
 *
 * ## 先认准是哪个 `getData()`：两者语义**相反**（vendor 0.14.0-fix.3 实测）
 * - `Node.getData()`（单节点）＝ **活引用**：
 *   `getData(t){return t?this.nodeData.data[t]:this.nodeData.data}`。
 *   就地改写即改引擎数据——帧内图片尺寸预览（`engine/mindmap.previewNodeImageSize`）、
 *   `delete data.mdImageAutoSize` 这类「清标记」都依赖它。**不可当快照保存**：
 *   渲染期间同一对象仍在变。
 * - `MindMap.getData()`（整树）＝ **深拷贝**：
 *   `getData(){let e=this.command.getCopyData(), …}`（另外补 `uid`/`smmVersion`）。
 *   `splitAllLinks` 之类「改树后整树回灌」的路径依赖这个拷贝。
 *
 * 两侧形态都由 `tests/vendor-contract.test.ts` 钉住：引擎升级若改成另一侧，
 * 先红灯，而不是让「清标记」「帧内预览」静默失效。
 */
export type MdNodeData = MindMapNodeData & MdNodeMeta;

/**
 * 节点 data 上可能承载「库内文件引用」的字段（引擎字段 + 插件回写字段）。
 * 引用更新（改名/删除，links-tree）与引用预检（engine-controller）**共用此清单**——
 * 新增引用字段只改这一处，避免两处清单漂移导致预检静默失效（漏改即整段更新被跳过）。
 */
const NODE_REFERENCE_FIELDS = [
	'image',
	'attachmentUrl',
	'hyperlink',
	'mdWikiLinkpath',
	// 双链附件的原始 linkpath：库内路径语义，且「移除引用」只清 attachmentUrl
	// 时会留下它——漏在清单外会让仅剩 linkpath 的节点被预检短路跳过
	'mdAttachmentLinkpath',
] as const;

/** 节点 data 是否含任一引用字段（引用更新前短路用：无引用即整树跳过） */
export function hasNodeReference(
	data: Record<string, unknown> | null | undefined,
): boolean {
	return !!data && NODE_REFERENCE_FIELDS.some((key) => Boolean(data[key]));
}

/**
 * 引用预检的最快路径：`needles` 是否命中节点的任一引用字段（零字符串构造）。
 *
 * 与 `hasNodeReference` 同字段表；匹配语义为「needle 是某字段值的子串」——
 * 命中即保守判定「可能引用目标」（宁可误报触发精确路径，不可漏报导致引用
 * 残留，见 `engine-controller.rendererTreeHasMatchingRef`）。
 *
 * 为什么不用「拼接比对串 + 一次 includes」：预检按**全树**调用、无关文件的
 * 命中率通常为 0，每节点一次数组 + join 是纯开销（复测：2000 节点含链接图
 * 0.68ms → 0.51ms；**无引用字段的节点零分配**，纯文本为主的图收益更大）。
 * 本实现只对非空字符串字段做子串比较。
 *
 * 与旧比对串的**两处有意差异**（方向都是「只减少误报/浪费」）：
 * ① **空 needle 不再恒命中**：原实现 `haystack.includes('')` 恒为真，而
 *    `oldBasename` 对 `.gitignore` 这类「点开头且无其他点」的文件名去扩展名
 *    后为空 ⇒ 旧实现每次重命名/删除这类文件都会白走一遍整树深拷贝精确路径；
 * ② 跨字段误命中不再发生（needle 含 `|` 且横跨两字段的拼接假象）——
 *    真实引用都在单字段内，故不会漏报。
 */
export function nodeReferenceMatches(
	data: Record<string, unknown> | null | undefined,
	needles: readonly string[],
): boolean {
	if (!data) {
		return false;
	}
	for (const key of NODE_REFERENCE_FIELDS) {
		const value = data[key];
		if (typeof value !== 'string' || value === '') {
			continue;
		}
		for (const needle of needles) {
			if (needle !== '' && value.includes(needle)) {
				return true;
			}
		}
	}
	return false;
}
