[中文](#cn-v0.1.8) | [English](#en-v0.1.8)

0.1.8 是一次**性能模式可靠性与性能**版本：修复性能模式下大型导图（数千节点）子树剪枝可能漏渲染可见节点的缺陷——节点坐标在布局之外被改写（自由拖拽、`SET_NODE_CUSTOM_POSITION`）后，过时的子树记账范围会把新位置上的可见节点剪掉；同时把平移 / 缩放 / 居中时的全树重绘开销从数十毫秒降到亚毫秒级。无破坏性变更（`.mindmap.md` 格式、命令 ID 与设置项均未变）。

<h3 id="cn-v0.1.8">修复</h3>

* **子树剪枝不再漏渲染自由拖拽后的可见节点**：性能模式自底向上记账每个节点的子树纵向范围，渲染期据此整棵跳过视口外的子树（纵向可剪、横向不可剪——子节点在右侧展开，父节点出视口不代表子节点出视口）。但当坐标在**布局之外**被改写（自由拖拽、`SET_NODE_CUSTOM_POSITION` 只写数据不触发 render）时，已记账的 `__subLo/__subHi` 仍是旧数字，而 `top` getter 已返回新值 ⇒ 会「用旧范围剪掉新位置上的可见节点」。现新增失效钩子：布局之外改写坐标立即禁用剪枝，直到下一次布局重记账（`refreshSubtreeExtents`）再启用。关键判断是**布局后一律启用**——`top` 的 getter `customTop || _top` 已把自定义坐标计入 `top`，读到的就是最终坐标，范围本就准；若改成「树内存在自定义坐标就禁用」，会让**自由拖拽过一次的用户永久失去 -91% 的遍历收益**（实测过，已修正）
* **出视口节点不再残留**：剪枝跳过整棵子树后，被跳过子树里会残留「上一轮物化、现已出视口」的节点——`removeSelf` 只把 `group` 从 DOM 摘下、不置空 `group`（实测 5002 节点树有 3104 个此类脱离 DOM 的 `group` 对象）。现新增在屏节点集合 `renderer.attachedNodes`，每轮渲染入口补做一次摘除核对（`reconcileOutOfClientNodes`），只遍历在屏集合，**代价 O(在屏数) ≈ 数十项、不随树规模增长**；摘除放在剪枝分支里会随命中次数重复扫描（实测每轮命中 76 次），故统一在渲染入口跑一次

<h3>性能</h3>

* **平移 / 缩放 / 居中重绘短路**：`onViewDataChange` 的语义是「补挂新进入视口的节点、摘掉离开的」，但视口可见集合未变时（平移后仍落在原可见集）这轮全树分片渲染（`render(..., async=true)`，每节点一个 `setTimeout`）纯属浪费——而 `view_data_change` 在平移 / 缩放 / 居中时**无条件** emit。现新增视口可见签名（含 `uid/left/top/width/height`），相同即短路。实测 5001 节点：单次全树重绘 **70.8ms** → **0.6ms**；节点尺寸变化（图片 / 数学公式定稿）与树结构变化（折叠 / 增删）都会使签名失效，故该优化不影响正确性
* **子树剪枝（见上「修复」）**：渲染遍历 **-91%**。实测 5002 节点真实形态：5002 次判定 → 46 个可见；成本分解显示其中约 60% 是遍历本身的每节点记账开销，故「把某一处判定变便宜」的微优化无效（如 svg.js `transform()` memo 实测 97.7% 命中、零墙钟收益，已回退并记入 `vendor/BUILD.md`「已否决的假设」）——唯一有效方向是**少访问节点**

<h3>工程</h3>

* **渲染契约可视化验证脚本新增剪枝覆盖率判据**：`scripts/verify-visual.mjs` 现核对剪枝是否真的落在热路径上、触发次数与跳过规模是否与实测访问数量级一致（沿用补丁 5 的 `__MEASURE_STATS__` 诊断先例，`pruneStats` 经 `window.__PRUNE_STATS__` 暴露）
* **新增 `scripts/gen-perf-fixture.mjs`**：生成大型导图性能测试 fixture，便于复现数千节点的剪枝 / 重绘基准
* **`vendor/BUILD.md` 补丁 11 记录**：子树剪枝设计、失效钩子判据、视口签名短路，以及已否决的假设（svg.js transform memo 等）；`tests/vendor-contract.test.ts` 同步引擎两处 sha256

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`.mindmap.md` 格式、命令 ID 与设置项均未变更——纯修复 / 性能版本，无需迁移
* 本轮 `styles.css` **无变化**，更新只需替换 `main.js`（发布资产仍建议三件套齐全）
* 无新增设置项、无新增第三方依赖

---

<h3 id="en-v0.1.8">Fixed</h3>

* **Subtree pruning no longer drops visible nodes after free-drag**: in performance mode each node's subtree vertical extent is tallied bottom-up after layout, and the renderer skips whole out-of-viewport subtrees (vertical only — children expand to the right, so a parent leaving the viewport does not imply its children do). But when coordinates are rewritten **outside** the layout pass (free-drag, `SET_NODE_CUSTOM_POSITION` writes data without triggering a render), the tallied `__subLo/__subHi` are stale while the `top` getter already returns the new value — so the old extent would prune nodes that are now visible at the new position. An invalidation hook now disables pruning the moment coordinates are rewritten outside layout, and re-enables it on the next layout re-tally (`refreshSubtreeExtents`). The crucial decision is to **re-enable after every layout**: the `top` getter `customTop || _top` already folds the custom coordinate into `top`, so the extent read at render time is correct. Disabling merely because "custom coordinates exist" would make a user who free-dragged **permanently** lose the -91% traversal win (verified, and fixed)
* **Out-of-viewport nodes no longer linger**: after a whole subtree is pruned, nodes that were materialized in a previous round but are now off-screen would linger — `removeSelf` only detaches the `group` from the DOM and does not null it (measured 3104 such detached `group` objects in a 5002-node tree). A new on-screen set `renderer.attachedNodes` is reconciled once at each render entry (`reconcileOutOfClientNodes`), iterating only the on-screen set for a cost of **O(on-screen count) ≈ tens of items that does not grow with tree size**; doing it inside the prune branch would rescan per hit (76 hits per round measured), so it runs once at the render entry instead

<h3>Performance</h3>

* **Pan / zoom / center redraw short-circuit**: `onViewDataChange`'s job is "attach nodes entering the viewport, detach those leaving", but when the visible set is unchanged (e.g. after a pan that stays within the same visible set) the whole-tree sliced render (`render(..., async=true)`, one `setTimeout` per node) is pure waste — and `view_data_change` emits **unconditionally** on pan / zoom / center. A viewport-visibility signature (with `uid/left/top/width/height`) now short-circuits identical rounds. Measured on 5001 nodes: a single full-tree redraw dropped from **70.8ms** to **0.6ms**; node-size changes (image / math-settling) and tree-structure changes (collapse / add / delete) invalidate the signature, so correctness is unaffected
* **Subtree pruning (see "Fixed" above)**: render traversal **-91%**. Measured on a 5002-node real-shape baseline: 5002 checks → 46 visible; cost breakdown showed ~60% is per-node bookkeeping overhead of the traversal itself, so "making one check cheaper" micro-opts are ineffective (e.g. an svg.js `transform()` memo hit 97.7% but yielded zero wall-clock gain and was rolled back — recorded under "Rejected assumptions" in `vendor/BUILD.md`) — the only effective direction is **visiting fewer nodes**

<h3>Engineering</h3>

* **The visual render-contract verifier gained a pruning-coverage criterion**: `scripts/verify-visual.mjs` now checks that pruning actually lands on the hot path and that fired-count / skipped-extent match the measured access magnitude (following patch 5's `__MEASURE_STATS__` precedent, `pruneStats` exposed via `window.__PRUNE_STATS__`)
* **New `scripts/gen-perf-fixture.mjs`**: generates large mind-map performance fixtures to reproduce the thousands-of-nodes pruning / redraw baselines
* **`vendor/BUILD.md` patch 11 records**: the subtree-pruning design, the invalidation-hook criterion, the viewport-signature short-circuit, and rejected assumptions (svg.js transform memo, etc.); `tests/vendor-contract.test.ts` syncs the engine's two sha256 values

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; the `.mindmap.md` format, command IDs and settings are unchanged — a fix/performance release with no migration needed
* **`styles.css` is unchanged in this release** — updating only `main.js` is sufficient (the full three-file release bundle is still recommended)
* No new settings, no new third-party dependencies
