/**
 * 自有补丁（2026-09-25 性能轮，见 vendor/BUILD.md「补丁清单」补丁 5）：
 * 首帧前**批量预测量**自绘内容尺寸，并把构建出的内容元素**留给正式路径复用**。
 *
 * 背景与两段式设计（实测驱动，详见 BUILD.md 补丁 5 与 AGENTS.md K75）：
 * - 单次测量「挂载 → getBoundingClientRect → 卸载」每节点一次强制 reflow；
 *   5000 节点首帧的测量段实测 ≈450–466ms（K74 的 twice 对照）；
 * - 但**只在首帧前预测量**（不保留元素）与正式构建构成**两遍内容构建**，
 *   实测净收益为零（100% 缓存命中但总时长无变化）——两遍构建抵消测量节省；
 * - 故本模块在预测量同时把内容元素按 **uid** 存入
 *   `mindMap.__preMeasuredContentMap`，正式路径（`MindMapNode` 内容创建点）
 *   优先取用同一元素 ⇒ 只剩**一遍构建** + 零 reflow，净收益 ≈ 测量段全量。
 *
 * 一致性：元素来自与正式路径**同一个构建回调**（插件 createNodeContent，经
 * engine/mindmap.ts 绑定 doc/style/lang），同数据、同样式来源 ⇒ 逐字节一致；
 * key（addXmlns 后的 outerHTML）与正式测量/缓存同口径。任何不一致只会导致
 * 缓存 miss 或复用失效（回退原构建，无副作用）；单节点构建抛错即跳过。
 */
import { walk, addXmlns } from '../../utils/index'
import Style from './node/Style'
import { measureCacheGet, measureCachePut } from './node/nodeCreateContents'

/** 字体未就绪（web font 加载中）的度量可能偏 fallback，不写缓存（与补丁 4 同口径） */
function fontsReady() {
  return (
    typeof document === 'undefined' ||
    !document.fonts ||
    document.fonts.status === 'loaded'
  )
}

/**
 * 为数据树中所有「会被自绘接管」的节点预测量内容尺寸并登记复用元素。
 *
 * @param {object} mindMap 引擎实例（`new MindMap` 之后即可调用；读 renderer.renderTree）
 * @param {(proxyNode: object) => HTMLElement | null} buildContent 内容构建回调——
 *   生产由 `engine/mindmap.ts` 注入（与 `customCreateNodeContent` 同一条调用链），
 *   返回 null 表示该节点非自绘
 */
export function preMeasureCustomContents(mindMap, buildContent) {
  if (!mindMap || typeof buildContent !== 'function') return
  const renderer = mindMap.renderer
  const renderTree = renderer && renderer.renderTree
  const el = mindMap.el
  if (!renderTree || !el) return
  const doc = el.ownerDocument
  if (!doc) return
  const cache = mindMap.commonCaches || (mindMap.commonCaches = {})
  // 复用映射：每次预测量重置（防上一轮残留元素被错误复用）
  const reuseMap = new Map()
  mindMap.__preMeasuredContentMap = reuseMap
  // 复用与单次测量完全相同的离屏容器（同一上下文 ⇒ 度量一致）
  if (!cache.measureCustomNodeContentSizeEl) {
    cache.measureCustomNodeContentSizeEl = doc.createElement('div')
    cache.measureCustomNodeContentSizeEl.style.cssText =
      'position: fixed; left: -99999px; top: -99999px;'
    el.appendChild(cache.measureCustomNodeContentSizeEl)
  }
  const holder = cache.measureCustomNodeContentSizeEl
  const keys = []
  const clones = []
  const stats = { visited: 0, built: 0, hit: 0, queued: 0, wrote: 0, canCache: false }
  walk(renderTree, null, (node, parent, isRoot, layerIndex) => {
    stats.visited++
    if (!node || !node.data) return
    const nodeData = node
    // 轻量代理节点：只提供自绘构建与 Style.merge 实际读取的面
    const proxy = {
      nodeData,
      mindMap,
      layerIndex,
      isGeneralization: false,
      customTextWidth: undefined,
      effectiveStyles: {},
      getData: prop => (prop ? nodeData.data[prop] : nodeData.data)
    }
    proxy.style = new Style(proxy)
    let content = null
    try {
      content = buildContent(proxy)
    } catch (error) {
      content = null
    }
    if (!content) return
    stats.built++
    addXmlns(content)
    // 复用登记（A2）：元素本体不挂载、不测量，留给正式路径
    const uid = nodeData.data.uid
    if (typeof uid === 'string' && uid) {
      reuseMap.set(uid, content)
    }
    const key = content.outerHTML
    if (measureCacheGet(key)) {
      stats.hit++
      return
    }
    keys.push(key)
    clones.push(content.cloneNode(true))
    stats.queued++
  })
  // 诊断：供 --bench-open 页面读取（预测量是否执行 / 命中）
  try {
    const view = doc.defaultView || doc.parentWindow || null
    if (view) view.__PREMEASURE_STATS__ = stats
  } catch (error) {
    /* 诊断写入失败不影响功能 */
  }
  if (clones.length === 0) return
  // 集中挂载（只写不读，不触发 reflow）→ 首次读取触发一次 reflow，
  // 其余逐个读数命中浏览器的布局缓存。
  // ⚠️ 每个 clone 包一层 `width: max-content` 的 wrapper：自绘内容根元素是
  // `display: block`（CONTENT_STYLES），直接平铺会被 shrink-to-fit 容器
  // （宽 = 最宽子元素）拉伸到最宽者——与单次测量「唯一子元素」的语义不一致。
  for (let i = 0; i < clones.length; i++) {
    const wrap = doc.createElement('div')
    wrap.style.width = 'max-content'
    wrap.appendChild(clones[i])
    holder.appendChild(wrap)
  }
  const canCache = fontsReady()
  stats.canCache = canCache
  for (let i = 0; i < clones.length; i++) {
    const rect = clones[i].getBoundingClientRect()
    if (canCache) {
      measureCachePut(keys[i], { width: rect.width, height: rect.height })
      stats.wrote++
    }
  }
  holder.innerHTML = ''
}
