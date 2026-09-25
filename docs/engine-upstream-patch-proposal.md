# 引擎上游补丁建议：节点文本测量（打开大图的性能瓶颈）

> 时点：2026-09-25 · 依据：本仓库无头 Chrome 实测（`npm run verify:visual -- --bench-open`）＋引擎源码（simple-mind-map 0.14.0-fix.3）
> 状态：**建议提交上游**（wanglin2/mind-map / 思绪思维导图 fork）；插件侧不可实施（`vendor/simple-mind-map.cjs` 禁止手工编辑，升级流程见 `vendor/BUILD.md`）

## 1. 问题（实测）

「打开 → 可交互」的耗时与**节点总字符数**严格线性——测度 ≈ **0.13ms/字符**（无头 Chrome；5000 与 10000 节点两规模独立拟合一致）：

| 场景（5000 节点，真实墙钟） | 耗时 |
|---|---|
| 典型图（5% 长文本 1540 字 + 普通 11 字节点） | **58.8s** |
| 去长文本（全短文本） | 8.6s |
| **全节点自绘接管（跳过该测量）** | **1.36s**（6.3 倍） |
| 折叠 3 层（对照，**不采用**） | 34.9s（引擎为每个折叠节点渲染展开按钮 ≈ +26s，净负） |

成本发生在**渲染期的节点构造**（`layout.doLayout → walk → createNode → new MindMapNode → getSize → createNodeData → createTextNode`），**早于性能模式可见性裁剪**（`MindMapNode.render` 的性能门）——因此 `openPerformance` / `removeNodeWhenOutCanvas` 只省 DOM 装配，省不掉测量：DOM 里只剩 15 个节点的图照样付全量测量时间。

## 2. 根因（源码位置）

`src/core/render/node/nodeCreateContents.js`：

1. **逐字符换行循环**（约 `:258-271`）：

   ```js
   let arr = item.split('')
   while (arr.length) {
     let str = arr.shift()
     let text = [...line, str].join('')          // 每字符重建整行字符串（O(L²)）
     if (measureText(text, this.style).width <= maxWidth) { line.push(str) }
     else { lines.push(line.join('')); line = [str] }
   }
   ```

   每个字符**都**做一次 `measureText`——与 `textAutoWrapWidth` 取值无关（无论何时换行，每字符都测一次）。

2. **measureText 的 DOM 往返**（约 `:17-23`）：每次 `new G()` + `Text()` + `bbox()`；元素不挂文档 → svg.js `Box.bbox()` 走 **retry 分支**：克隆 → 挂到 body 里的隐藏 svg → `getBBox()`（**强制同步布局**）→ 移除。每次测量还伴随 6 次主题样式合并（`Style.text()` 一族）。
   ⇒ 单次测量 = 「元素克隆 + DOM 插入 + 强制布局 + 移除」，实测合集约 0.13ms/字符（无头；真实 GUI 浏览器快若干倍但结构同量级）。

3. **无缓存**：同一文本/字体反复测量（同节点内每字符一次、跨节点重复文本再来一次）。

## 3. 补丁建议（按性价比）

### P1 快路径：整段不超宽时跳过逐字符循环（最低风险）

先测一次整段文本宽度：`if (measureText(item, style).width <= maxWidth) { 单行，直接返回 }`。绝大多数节点整段文本都 ≤ 500（默认 `textAutoWrapWidth`）⇒ 每节点从 L 次测量降到 **1 次**（5000 × 11 字：5.5 万次 → 5 千次）。

### P2 换测量实现：canvas measureText（上游已有现成实现）

`src/utils/index.js` 已有 canvas 测量上下文（搜 `measureTextContext`）——把该测量换成 canvas `measureText`（`ctx.font = ...` 一次 + 一次调用），**消除 DOM 往返**。注意字体串需与节点样式一致（`fontSize` / `fontWeight` / `fontFamily`）。

### P3 测量结果缓存（LRU）

以「字体样式 + 文本」为键缓存宽度（节点文本重复度高）。上限建议 ≤1000 条（与 `maxNodeCacheCount` 同档），或按节点缓存「每行最终宽度」。

### P4（可选）测量时机惰性化

把 `createTextNode` 的换行测量懒到「节点实际进入渲染」时（性能模式下视口外节点可延后）——收益大但改动面广（布局需要宽度），需与 `removeNodeWhenOutCanvas` 语义联动，慎重评估。

## 4. 验证方法（可复现）

- 本仓库：`npm run verify:visual -- --bench-open --bench-nodes 5000`（生产路径墙钟；`BENCH_VARIANT=no-long|all-link` 可做内容类型对照；实现见 `scripts/verify-visual.mjs`，A/B/B/A 取最小 + 进程墙钟，页内时钟在 `--virtual-time-budget` 下不可用）。
- 修复后预期：`--bench-nodes 5000` 全内容形态从 ~58.8s 落至数秒内；`500` / `10000` 同比例下降。
- **行为回归**：修复不应改变换行结果——建议上游以「同文本新旧实现对拍」（含中英混排、长单词、emoji、`\n` 多行）验证逐字一致。

## 5. 与插件侧的关系

- 插件侧已落地**规避性优化**：设置项 `selfDrawPlainNodes`（默认开）——文本节点全部自绘接管，引擎在 `MindMapNode.createNodeData` 提前 return、跳过 `createTextNode` 全路径（实测 6.3 倍）。它是「绕开」而非「修复」：保持引擎文本渲染的场景（用户关掉该设置）仍付原成本。
- 本补丁若被上游接收（或 fork 吸收），插件可在升级引擎后**撤销该规避**（自绘回归「富内容」定位），并恢复全量节点的引擎内联编辑框。
