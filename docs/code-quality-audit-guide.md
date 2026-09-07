# Mindmap-Studio 代码质量调研指南

> 技术债评估与重构优先级 · 基于 2026-09-07 代码库快照（v0.0.1，25 commits，src 51 个 TS 文件 / 7971 行）
>
> 本指南做两件事：① 给出一套可复用的评估框架（维度 → 检查项 → 严重度分级）；② 用该框架对当前代码库完成一次基线评估，产出有证据的发现清单与重构路线图。后续可在任意时点按同一框架复评，用「发现清单」章节的增减来度量技术债走势。
>
> **版本记录**：v1（2026-09-07 上午）基线评估与路线图 → 首轮按严重度修复（R1-R3）→ **v2（2026-09-07）复评**：按附录 B 清单重扫先行指标、刷新各维度证据，修复项已标注 ✅，遗留项保持 ⚠️/⏳ → **v3（2026-09-07）遗留债偿还轮**：R4 上下文瘦身预演、vendor 契约冒烟测试、open-as-restore 单测三项遗留全部落地；契约测试随即抓到并修复 `findNodeByDom` 恒空缺陷与 `THEME` 幽灵声明两处真实漂移（见发现清单 #10/#11）。

---

## 1. 基线画像（评估前提）

先客观描述现状，避免「为改而改」：

**架构与规模**

- 四层结构：`domain/`（纯领域逻辑，4 文件）→ `services/`（2 文件）→ `features/`（13 文件）→ 根层基础设施（32 文件）。
- 最大文件：view.ts 569 行、md-outline.ts 468、mindmap.ts 441、i18n.ts 408、engine-controller.ts 366。无千行文件。
- vendor：simple-mind-map 0.14.0-fix.3（上游 fork，预打包 406KB cjs + 手写 4.5KB d.cts）。

**已验证的防护（本轮实证，非文档自述）**

- `tsc strict + noUncheckedIndexedAccess`；ESLint（obsidianmd recommendedTypeChecked）全绿，0 告警。
- 源码 0 处 `any`、0 处 TODO/FIXME/@ts-ignore；`as unknown as` 仅 6 处且全部位于文档化的私有 API 防腐点。
- console 仅 `console.error`（22 处，全部在错误路径），无调试残留。
- 测试 8 个文件 / 1454 行：domain、concurrency、save-pipeline、view-state、settings、md 往返、url、pasted-name。
- CI（lint.yml）：push/PR 全分支跑 build + test + lint（Node 20/22/24 矩阵）。
- i18n EN 字典声明为 `Record<TranslationKey, string>`——键奇偶性有编译期强制，缺译直接编译报错。
- git 历史显示 4 轮以上专项重构（分层、防腐收口、单一真源、竞态修复）。

**结论性判断**：本库**不属于**「屎山」。真实技术债集中在三类：**约定靠 prose 而非机械强制导致的漂移**、**setTimeout 时序耦合**、**纯逻辑模块的测试盲区**。评估框架围绕这三类展开。

### 1.1 复评快照（v2 · 首轮修复后，同日）

| 指标 | v1 基线 | v2 复评 | 走势 |
|------|---------|---------|------|
| features/modal 层解析直调（应走统一入口） | 2 处 | **0 处**（lint `no-restricted-syntax` 机械强制，唯一 disable 为存在性检查且注明理由） | ↓ 清零并锁死 |
| 裸数字 setTimeout | 3 处 | **0 处**（余量均为具名常量/参数化/文档化 workaround） | ↓ 清零 |
| `waitForReady` 10ms 轮询 | 1 处 | **0 处**（`whenReady` Promise 信号替代） | ↓ 清零 |
| `as unknown as` | 6 处 | 6 处（全部在文档化防腐点，属受控代价） | → 持平（预期内） |
| 测试 | 8 文件 / 1454 行 | **13 文件**（新增 links-resolve/links-tree/file-lookup/images-path/view-node-actions） | ↑ 盲区清零 |
| 验证 | — | `tsc` ✅ / `eslint` 0 错 0 警 ✅ / `vitest` **128/128** ✅ / `npm run build` ✅ | — |
| 遗留 | — | P2#5 上下文宽度（随特性顺带）、P2#6 vendor 契约冒烟测试（随升级）、open-as-restore 多档扫描单测 | ⏳ |

### 1.2 复评快照（v3 · 遗留债偿还轮，同日）

| 指标 | v2 复评 | v3 偿还 | 走势 |
|------|---------|---------|------|
| MindMapViewContext 装配面宽度 | 单一宽接口（13+ 成员直接暴露） | 拆出 `ViewEngineContext`/`ViewDomContext` 子上下文，view-search/view-status 已迁移至最窄访问面，约定写入 AGENTS.md | ↓ 预演落地 |
| vendor 契约守护 | 无（升级靠人眼对照 BUILD.md） | `tests/vendor-contract.test.ts` 三层冒烟（导出面 ↔ d.cts 双向 / 原型方法 / 命令·内部字段·事件令牌扫描） | ↑ 0→5 用例锁死 |
| open-as-restore 多档扫描 | 文档化 workaround，无测试 | 6 用例直测（file-open 矩阵 / active-leaf-change 守卫 / 多档延时） | ↑ |
| findNodeByDom（data-uid 恒空缺陷） | **潜伏缺陷**（引擎从不写 data-uid，画布右键委托路径恒弹空白菜单） | 改为 group 身份匹配 + 5 用例回归锁定 | ✅ 契约测试发现并修复 |
| d.cts ↔ bundle 导出面 | `THEME` 幽灵声明（bundle 未导出、src 未使用） | 声明已删除，导出面双向一致性由测试锚定 | ✅ |
| 测试 | 13 文件 / 128 用例 | **16 文件 / 144 用例**（新增 vendor-contract / find-node-by-dom / open-as-restore） | ↑ |
| 验证 | — | `tsc` ✅ / `eslint` 0 错 0 警 ✅ / `vitest` **144/144** ✅ / `npm run build` ✅ | — |

---

## 2. 评估维度与具体检查项

每个维度给出：检查项 → 度量方法 → 本库当前证据。度量命令见附录 A。

### D1 可读性与一致性

| # | 检查项 | 度量方法 | 本库证据 |
|---|--------|----------|----------|
| D1.1 | 命名一致性：同一概念全库同名（如 `resolvePathToFile` vs 散落的 getAbstractFileByPath） | grep 概念关键词，统计同义实现数 | ✅ v2 复评统一：解析全部收口统一入口（见 D2.1） |
| D1.2 | 魔法数：裸写延时/阈值/倍率 | grep `setTimeout(\d`、裸数字常量 | ✅ v2 复评归零：3 处时延已具名（`RESET_LAYOUT_FIT_DELAY_MS`/`SEARCH_FOCUS_DELAY_MS`/`DOWNLOAD_REVOKE_DELAY_MS`） |
| D1.3 | 错误处理一致性：用户可见错误是否统一走 `notifyError`，日志统一 `console.error` | grep `new Notice(` 与 `console\.` | ✅ 22 处 console.error 格式统一；Notice 均走 i18n |
| D1.4 | 注释解释「为什么」而非「是什么」；模块头有职责声明 | 抽查大文件头部与关键分支 | ✅ 高质量：竞态守卫、防腐动机均有 why 注释 |
| D1.5 | 函数长度：单函数 >80 行或嵌套 >4 层标记复核 | awk / 手工抽查 | ✅ 仅 `parseMdOutline`（约 120 行）与 `classifyLines` 偏长，但分段注释清晰，暂不动 |
| D1.6 | i18n 键奇偶性与占位符规范 | 编译期类型 + `tf()` 收口 | ✅ 编译期强制；无 `.replace` 链 |

### D2 模块耦合与边界

| # | 检查项 | 度量方法 | 本库证据 |
|---|--------|----------|----------|
| D2.1 | 分层禁令是否被 lint 机械强制：domain 零依赖 ✅；「库内文件解析只走 `resolvePathToFile`」 | grep `getAbstractFileByPath`，区分「存在性检查」（合法）与「路径→文件解析」（应走统一入口） | ✅ v2 复评：漂移 2 处已改走统一入口，且 eslint `no-restricted-syntax`（features/ + modal-*.ts）机械强制；余下直调均为统一入口内部/存在性检查（`view.ts:399` disable 注明） |
| D2.2 | services 层不得反向依赖 features/main | grep import 方向 | ✅ 0 违例 |
| D2.3 | 引擎内部形态（renderer/opt/search/doExport/textEdit）访问是否收口在 mindmap.ts / engine-controller.ts | grep 内部字段名 | ✅ 收口完整；6 处 `as unknown as` 均在防腐点内 |
| D2.4 | 上下文接口宽度：`MindMapViewContext` 公开面随特性增长的膨胀趋势 | 统计接口成员数 / view 实现的公开字段 | ⚠️ 偏宽：视图公开 13+ 字段（6 个 DOM 元素引用 + 3 个 md 模式字段），view-* 直接操作视图 DOM 元素。当前可控，是增长最快的耦合面 |
| D2.5 | 循环依赖 | madge / tsc | ✅ main↔view 仅 type-only import，无运行时环 |
| D2.6 | 模块级可变状态（WeakMap/单例）是否有清理路径 | grep `new WeakMap` / 模块级 let | ✅ 2 处 WeakMap 均按视图键控，可随视图回收 |

### D3 重复代码

| # | 检查项 | 度量方法 | 本库证据 |
|---|--------|----------|----------|
| D3.1 | 跨文件的「守卫 + 提示」样板：取激活节点 + 空值 Notice | grep `getActiveNode` + `selectNodeFirst` | ✅ v2 复评：3 处重复已收敛为 `requireActiveNode` 单实现（view-dnd/view-paste 的静默变体语义不同，保留） |
| D3.2 | 引擎取值样板：`(node.getData?.('x') as string)` 式强转散布 | grep `getData?\.\(` | ✅ v2 复评：view-node-actions 内强转已替换为防腐层 `getNodeDataString`；view-dnd 等其余文件如有触点随下次改动顺带 |
| D3.3 | 算法级重复（两段逻辑做同一件事） | jscpd / 抽查 | ✅ 未发现成块重复；links-tree 重命名/清除已共用同一遍历（mode 参数） |
| D3.4 | 正则/常量重复定义 | grep 同名字面量 | ✅ marker/扩展名/命令名均已收口 constants.ts、mindmap.ts ENGINE_COMMANDS |

### D4 设计坏味道

| # | 检查项 | 度量方法 | 本库证据 |
|---|--------|----------|----------|
| D4.1 | 上帝类/上帝模块：单类承担 >3 类职责 | 读类头职责声明 vs 实际方法 | ✅ view.ts 已拆分（编排 + 6 个 feature 模块），职责声明与实现一致 |
| D4.2 | 时序耦合：用 `setTimeout` 做「同步/等待/重试」而非事件或 Promise | grep `setTimeout` 逐处分类（延时 UI vs 时序假设） | 🟡 v3：余量 6 处仍为具名常量或文档化 workaround（时序假设本质未变）；open-as-restore 多档扫描已补 6 用例直测（mock workspace + fake timers），⏳ 全部关闭 |
| D4.3 | 竞态防护是否成体系（代际锁/去重/串行队列）vs 手搓标志位 | 审查 loadMindMapFromFile / SavePipeline / initSeq | ✅ 成体系：代际锁 + loadingFilePath 去重 + 串行排空；v2 复评：手搓轮询等待已 Promise 化 |
| D4.4 | 特性开关/分支发散：if 链按类型发散且各分支重复 | 抽查 links-resolve 路由、md-serialize 分支 | ✅ 路由型 if 链有清晰形态谓词驱动，非坏味道 |
| D4.5 | 不稳定依赖接口：手写 `d.cts` 与 vendor 实际产物的一致性 | 对照 BUILD.md 流程升级时验证 | ⚠️ 4.5KB 手写类型是隐式契约，引擎升级时 `.d.cts` 漂移无编译期兜底（见 D5.1） |

### D5 维护风险

| # | 检查项 | 度量方法 | 本库证据 |
|---|--------|----------|----------|
| D5.1 | 上游/供应链：vendor 是上游 fork，防腐层外的隐式依赖会随升级爆雷 | 清点 `as unknown as` 点位 + d.cts 覆盖面；升级演练 | ✅ v3 收敛为低风险：`tests/vendor-contract.test.ts` 已锁死「d.cts ↔ bundle 双向导出面、原型方法、命令/内部字段/事件令牌」三层契约，BUILD.md 升级清单第 5 步强制执行；升级时契约漂移即测试红 |
| D5.2 | 私有 API 触点（file-creator/dragManager/shell.openPath）的防御式访问是否集中且有降级路径 | grep 触点清单 | ✅ 3 处均防御式 + 文档化 + 「官方补齐后替换」的退出策略 |
| D5.3 | 持久化兼容：data.json 历史格式/坏值的防御 | 审查 sanitizeSettings / hydrate | ✅ 双入口共用同一校验；main.ts 对非对象 data 丢弃 |
| D5.4 | 知识单点：约定是否只存在于某人的脑子里 | AGENTS.md 完整性 vs lint 强制清单 | ⚠️ AGENTS.md 覆盖全面，但约 10 条「勿再手写 X」类约定中仅 domain 零依赖与部分规则由 eslint no-restricted-imports 机械强制；其余靠 code review |
| D5.5 | 产物与发布：main.js/styles.css 为发布产物随仓库提交 | 常规 Obsidian 插件做法 | ✅ 非 Debt；release.yml 自动构建草稿 Release |

### D6 测试与守护网

| # | 检查项 | 度量方法 | 本库证据 |
|---|--------|----------|----------|
| D6.1 | 纯逻辑模块单测覆盖：无 DOM 依赖却无测试的模块清单 | 模块 × 测试导入矩阵 | ✅ v2 复评盲区清零：links-resolve（形态路由矩阵）、links-tree（rename/clear 矩阵）、file-lookup（索引/缓存/失效）、images-path（地址解析/比例探测 stub Image）、view-node-actions（守卫与编排）各有直测；测试 13 文件 / 128 用例 |
| D6.2 | 回归测试锚定关键不变量（md 往返不动点） | 已有 roundtrip 断言矩阵 | ✅ 516 行 roundtrip 测试，解析↔序列化不动点已锚定 |
| D6.3 | 竞态回归：写入中再触发、失败上报、防抖尾随 | save-pipeline/concurrency 测试 | ✅ 已覆盖 |
| D6.4 | DOM/引擎层可测性：核心交互逻辑是否被推出 view-* 模块成为可测纯函数 | 抽查 | 🟡 v2 复评部分改善：view-node-actions 已有 9 用例（mock 防腐层与弹窗）；其余 view-* 12 个模块仍零测试，DOM 重的部分可接受，决策逻辑下推仍随特性顺带 |

---

## 3. 问题严重度分级标准

| 级别 | 名称 | 判定条件（满足任一） | 处理策略 |
|------|------|----------------------|----------|
| **P0** | 致命 | 用户数据丢失/损坏（写坏 .mindmap.md、viewState 串文件）；崩溃且无法恢复；安全漏洞 | 立即修复，阻断发版 |
| **P1** | 高 | 特定时序下可复现的错误行为（竞态导致旧内容写入新文件）；约定漂移已产生语义偏差；上游升级必然破坏的未锚定契约 | 本迭代内修复，写回归测试锚定 |
| **P2** | 中 | 可维护性侵蚀：机械强制缺失的约定开始漂移；核心纯逻辑无测试；重复 ≥3 处的样板；时序耦合新增点 | 排入路线图，随相关特性开发顺带偿还 |
| **P3** | 低 | 风格不一致、命名魔法数、单处小重复、注释过期 | 零成本顺带修（boy-scout），不单独立项 |

**升级规则**：同一 P2 问题在第 3 次被新代码复制时升为 P1（说明机械防护缺失已在扩散）；任何涉及用户文件的边界问题默认升一级。

---

## 4. 发现清单（按严重度，v2 复评后状态）

### P1（2 项，均已修复）

1. ✅ **库内文件解析绕过统一入口** — `view-node-actions.ts` 与 `modal-image.ts` 原直接 `app.vault.getAbstractFileByPath(url)` 做路径→文件解析。→ 已改走 `resolvePathToFile`；eslint `no-restricted-syntax` 机械强制（features/ + modal-*.ts），`view.ts:399` 存在性检查 disable 注明理由。回归：新增测试锚定统一入口路由矩阵。
2. ✅ **时序耦合未收敛**（v1 计 7 处）— `waitForReady` 轮询已替换为 `whenReady` Promise 信号；3 处魔法延时具名化；150ms/200ms 本已是具名常量；open-as-restore 多档扫描为文档化 workaround（ADR 保留，✅ v3 已补 mock workspace 单测）。时序假设的本质未变，但已全部可 grep、可审计。

### P2（4 项：4 已修，0 遗留）

3. ✅ **核心纯逻辑测试盲区** — links-resolve / links-tree / file-lookup / images-path(纯函数) 已全部直测（新增 4 个测试文件）。
4. ✅ **激活节点守卫样板 3 连重复** + 引擎取值强转散布 — 已提取 `requireActiveNode` 与 `getNodeDataString`，并配 9 个用例。
5. ✅ **MindMapViewContext 公开面偏宽** — v3 落地拆分预演：装配面继承 `ViewEngineContext`/`ViewDomContext` 子上下文；view-search、view-status 迁移至最窄访问面（结构化子集兼容，调用方零改动）；「按需依赖子上下文」写入 AGENTS.md 关键约定，随新特性逐步扩散。
6. ✅ **vendor 升级无契约测试** — v3 落地 `tests/vendor-contract.test.ts`（5 用例，非 jsdom 方案）：最小 document 桩加载真实 bundle 断言导出面 ↔ d.cts 双向一致与原型方法存在；命令名/内部字段/事件名令牌扫描（压缩产物不混淆属性名与字面量，令牌消失即漂移）。BUILD.md 升级清单第 5 步强制执行。落地即抓到两处真实漂移（#10/#11）。

### P3（3 项：1 已修，2 维持）

7. ✅ 3 处未命名时延魔法数 — 已具名常量化。
8. 🟡 `view.ts` 头部注释的功能模块清单需与 features/ 目录保持同步（当前一致，防过期提醒）。
9. 🟡 `parseMdOutline`/`classifyLines` 函数偏长 — 已有分段注释与测试锚定，仅在未来改动时顺带拆分。

### 契约测试落地时抓到的缺陷（v3 新增，均已修复）

10. ✅ **（P1 级功能缺陷）`findNodeByDom` 依赖引擎从不写入的 `data-uid`** — 令牌扫描发现 bundle 全文零处 `data-uid`，旧实现的 `el.getAttribute('data-uid')` 恒返回 null：画布空白右键委托路径（附件图标等未 stopPropagation 的冒泡事件命中节点时）永远解析不出节点、恒弹空白菜单。→ 改为「节点渲染 group 包含目标元素」的对象身份匹配（引擎内部形态访问仍收口 mindmap.ts），新增 5 用例回归锁定；「引擎不写 data-uid、`.smm-node` group 互不嵌套」作为已核实非契约事实记入 vendor/BUILD.md。
11. ✅ **（P3 级）d.cts `THEME` 幽灵声明** — bundle 实际导出 8 个符号不含 `THEME`，src 也未使用；双向导出面断言暴露后已删除该声明。

### 明确不是债（防止过度重构）

- 6 处 `as unknown as`：全部位于文档化防腐点，是**受控的**私有 API 代价，非坏味道。
- console.error 22 处：全部在 catch 路径且格式统一。
- main.js 随仓库提交：Obsidian 插件发布惯例。
- i18n 双字典同文件：有编译期键奇偶性强制，拆文件无收益。

---

## 5. 重构与优化优先级路线图

> **修复进度（2026-09-07，首轮按严重度执行完毕，v2 复评通过）**：
> - ✅ R1 全部完成——解析统一入口（view-node-actions/modal-image）、`requireActiveNode` 守卫提取、3 处魔法数具名、eslint `no-restricted-syntax` 机械强制落地。
> - ✅ R2 核心完成——`waitForReady` 10ms 轮询已替换为 `whenReady` Promise 信号；open-as-restore 多档扫描按 ADR 保留。
> - ✅ R3 完成——新增 5 个测试文件（links-resolve/links-tree/file-lookup/images-path/view-node-actions），测试由 8 → 13 个文件，128 用例全绿。
> - ✅ 附带完成 R4 的「引擎取值器收口」（mindmap.getNodeDataString）。
> - ⏳ 未做：R4 上下文瘦身（随下一个 view-* 特性顺带）、vendor 升级契约冒烟测试（随下一次 vendor 升级）、open-as-restore 多档扫描单测。
> - 验证：`tsc -noEmit` ✅ / `eslint .` ✅（0 错 0 警）/ `vitest run` 128/128 ✅ / `npm run build` ✅

> **偿还进度（2026-09-07，v3 遗留债偿还轮，全部完成）**：
> - ✅ R4 上下文瘦身预演——`ViewEngineContext`/`ViewDomContext` 拆分 + view-search/view-status 最窄面迁移 + AGENTS.md 约定（全量拆分随新特性逐步扩散）。
> - ✅ R4 vendor 契约冒烟——`tests/vendor-contract.test.ts` 三层契约锁死 + BUILD.md 升级清单挂钩；即期抓到 findNodeByDom 恒空缺陷（#10）与 THEME 幽灵声明（#11）并修复。
> - ✅ open-as-restore `restoreMarkdownLeaves` mock workspace 单测（6 用例，覆盖 file-open 矩阵/active-leaf-change 守卫/多档延时）。
> - 验证：`tsc -noEmit` ✅ / `eslint .` ✅（0 错 0 警）/ `vitest run` **144/144** ✅ / `npm run build` ✅

### R1 快赢（半天内，P1#1 + P3#7）

| 动作 | 验收标准 |
|------|----------|
| `normalizeImageReference`（view-node-actions.ts:172-193）与 modal-image.ts:46 改走 `resolvePathToFile` | grep 确认 features 层无直接 `getAbstractFileByPath` 解析用途；roundtrip 测试全绿 |
| 提取 `requireActiveNode(view): MindMapNode \| null`（内含 Notice），替换 3 处重复守卫 | view-node-actions 行为不变；新增 1 个纯函数可在 D6 一并测 |
| 3 个魔法数提为具名常量（对齐 engine-controller 风格），集中放各模块顶部 | 编译 + lint 通过 |
| 在 eslint 配置为 features 层加 `no-restricted-syntax`/`no-restricted-imports` 规则，把「解析走统一入口」从 prose 升级为机械强制 | 故意写一处直调 → lint 报错 |

### R2 时序耦合收敛（1~2 天，P1#2）

| 动作 | 验收标准 |
|------|----------|
| `waitForReady` 改为 Promise 化的一次性 ready 信号（EventEmitter/resolve 持有），删除 10ms 轮询 | onLoadFile 无轮询；手测快速连续切换文件无回归 |
| `arrangeMindMap` 的 80ms fit：改由引擎 `data_change`/渲染完成回调触发，或在 mindmap.ts 内以常量 + 注释锚定并接受现状（若引擎无就绪回调） | 二选一落定，留 ADR 式注释 |
| 视口恢复 150ms、搜索 focus 50ms、导出 revoke 1000ms：统一移到 `constants.ts` 或各模块具名常量段，并在注释中写明「时序假设」与失效表现 | grep 无裸数字 setTimeout |
| open-as-restore 多档扫描保留（Obsidian 启动时序的已知 workaround，文档充分），但补一条针对 `restoreMarkdownLeaves` 的单测（mock workspace） | 新增测试通过 |

### R3 测试盲区补齐（2~3 天，P2#3）

优先级从高到低（按回归概率 × 逻辑复杂度）：

1. `links-resolve`：按形态谓词矩阵逐分支断言（远程拒绝 / obsidian:// / 资源地址 / 路径直查 / file:// 官方入口 / 索引兜底），复用 tests/mocks/obsidian.ts 模式。
2. `links-tree`：重命名/清除两 mode 共用遍历的分支矩阵。
3. `file-lookup`：索引构建 + O(1) 查询 + 失效。
4. `images-path` 纯函数部分（尺寸校正、地址判断）。
5. `requireActiveNode`（R1 产物）。

验收：新增 ≥5 个测试文件，CI 全绿；「纯逻辑模块直测覆盖率」从 0 提升到上述清单全覆盖。

### R4 结构优化（随特性开发顺带，P2#5/#6）— ✅ v3 完成

- ✅ **上下文瘦身预演**：`ViewEngineContext`/`ViewDomContext` 子上下文已拆出并由装配面继承；view-search/view-status 已迁移示范；「view-* 按需依赖子上下文，勿默认抓装配面」入 AGENTS.md。其余 8 个 view-* 模块仍持装配面引用（结构化兼容、行为零改动），按「触达即迁移」逐步收窄。
- ✅ **vendor 升级契约测试**：`tests/vendor-contract.test.ts`（未用 jsdom——bundle 顶层求值只需最小 document 桩，实例级渲染验证成本过高收益存疑，采用「模块加载 + d.cts↔导出面/原型双向断言 + 命令/内部字段/事件令牌扫描」三层方案）。BUILD.md 升级清单第 5 步已挂钩；落地即抓到 #10/#11 两处真实漂移。
- ✅ **引擎取值器收口**：以 `mindmap.getNodeDataString` 具名取值器替代散布的 `(node.getData?.('x') as string) || ''`（v2 附带完成）；按字段命名的 `getNodeText/getNodeHyperlink/getNodeImage` 语义分组未再引入——单取值器已覆盖现有 3 个调用点，避免过度封装。

### 明确不做

- 不拆 i18n.ts（编译期已强制键奇偶）。
- 不改 parseMdOutline 主体（测试锚定 + 注释充分，等下次需求触达再拆）。
- 不引入 jscpd/architecture-test 等新工具链——当前规模收益低于维护成本，grep 命令速查已够用。

---

## 6. 附录 A：度量命令速查

```bash
# 规模与热点
find src -name "*.ts" -exec wc -l {} + | sort -rn | head -20

# 约定漂移：features 层不应出现的解析直调
grep -rn "getAbstractFileByPath" src/features/
# 存在性检查（合法）与解析（应走 resolvePathToFile）需逐处人工分类

# 时序耦合清单（setTimeout 逐处分类：延时 UI / 时序假设 / 重试）
grep -rn "setTimeout\|setInterval" src/

# 防腐点完整性（应始终只出现在 mindmap.ts / engine-controller.ts / 3 处文档化触点）
grep -rn "as unknown as" src/

# 重复样板候选
grep -rn "selectNodeFirst" src/features/

# 机械验证
npm run lint && npm test
npx tsc -noEmit -skipLibCheck

# 依赖方向
grep -rn "from '../features" src/services/   # 期望：无结果
grep -rn "from 'obsidian" src/domain/        # 期望：无结果（lint 已强制）
```

## 附录 B：复评清单（v3 已执行；下次复评重置未勾项后继续用）

- [x] P1#1 解析统一入口：features 层直调是否归零且被 lint 锁死 → **2026-09-07 归零，`no-restricted-syntax` 机械强制**
- [x] P1#2 时序耦合：waitForReady 是否移除；裸数字 setTimeout 是否归零 → **均已归零**
- [x] P2#3 测试盲区：links-resolve/links-tree/file-lookup/images-path 是否有直测 → **全部有直测**
- [x] P2#5 Context 宽度：MindMapViewContext 成员数是否停止增长或已拆分子上下文 → **2026-09-07 拆出 ViewEngineContext/ViewDomContext，view-search/view-status 已迁移，约定入 AGENTS.md**（下次复评检查：其余 view-* 是否随特性触达逐步收窄）
- [x] P2#6 vendor 契约：冒烟测试是否落地并在最近一次升级中实际跑过 → **2026-09-07 测试落地（`tests/vendor-contract.test.ts`）并即期抓到 #10/#11**（下次 vendor 升级时验证其在真实升级中拦截漂移）
- [x] 先行指标（setTimeout / as unknown as / getAbstractFileByPath，只允许减不允许增）→ **setTimeout 有效点 7→6（轮询消除），`as unknown as` 6→6（受控持平），features/modal 解析直调 2→0**
- [x] 新增检查：open-as-restore `restoreMarkdownLeaves` 是否已补 mock workspace 单测 → **2026-09-07 已补（6 用例）**
- [ ] 新增检查（下次）：findNodeByDom 身份匹配的语义是否随引擎渲染结构变化失效（关注 `_generalizationList` 概要节点不在遍历树的边界）
- [ ] 新增检查（下次）：ViewDomContext/ViewEngineContext 子面成员数是否停止增长（防子面变成新的垃圾桶）
