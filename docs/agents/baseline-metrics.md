# 基线数据与核销台账

本文件是**可复现基线**的唯一记录处：每条数字都附命令与产出位置，供后续任何性能或结构改动做前后对比。

**维护约定**

- 新增指标必须同时写「复现命令」与「实测值」，否则不得入表（同 AGENTS.md 硬规则 5「不造第二份真相」）。
- 数值分三类：**实测**（附命令输出）、**文档记录**（引用他人留下的读数并注明出处）、**未实测**（必须写测量方法）。
- 环境差异会导致读数漂移：跨机器比较前先看 §0 环境。

---

## §0 环境（实测）

| 项 | 值 | 取证 |
| --- | --- | --- |
| 平台 | Windows win32，PowerShell 7 + Git Bash 5.3 | - |
| Node | v24.21.0 | `node -v` |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`（无头 `--headless=old`） | `scripts/verify-visual.mjs:284-287` 的 `findChrome()` |
| 库（实机） | `C:\Users\LEGION\OneDrive\Obsidian\Mindmap`，23 篇 md / 24 个文件 | `obsidian eval` 查询 `app.vault.getName()` / `getMarkdownFiles().length` |
| 记录日期 | 2026-10-07（首版）；**本次全表复测 2026-10-08** | - |
| 构建指纹（本次复测） | `main.js` sha256 `70e40c52…d73389bf`（604,847 B）｜ `vendor/simple-mind-map.cjs` sha256 `07dc23d0…5381f69b2` | `sha256sum main.js vendor/simple-mind-map.cjs` |

**读数与指纹的绑定关系（重要）**：上表指纹是本次复测所用构建。**§1–§4、§6 的数字均由各自「复现命令」在该构建上实测**；§5 的实机读数也已在新构建上重测（条件见 §5，其中 §5.1 读数**随视口状态变化**、§5.2 单次采样仍不可作阈值）；**§7 是 2026-10-07 的实机核销台账、§8 是未实测项与方法论，二者未随本次复测**（渲染与命令面未改动）。

注意：**打开基准跑在无头 Chrome 里，与 Obsidian 实机不同源**。`vendor/BUILD.md` 里的 5000 节点读数（1151ms、1091ms 等）是**实机**口径，与本文件 §2 的无头读数**不可直接相减**。

---

## §1 工程门禁基线（实测）

| 指标ID | 指标 | 值 | 复现命令 |
| --- | --- | --- | --- |
| G-01 | 类型检查 + 生产构建 | `BUILD_EXIT=0` | `npm run build` |
| G-02 | Lint（0 warning 门禁） | `LINT_EXIT=0` | `npm run lint` |
| G-03 | 单测 | 65 文件 / **1906** 用例全通过 | `npx vitest run` |
| G-04 | 死代码 | `KNIP_EXIT=0` | `npm run check:dead-code` |
| G-05 | 文档同步契约 | 4 passed | `npx vitest run tests/agents-md-sync.test.ts` |

---

## §2 打开性能基线（实测 · 无头 Chrome）

命令：`npm run verify:visual -- --require-chrome --bench-open`
（各规模 **2 次取最小**；同页同 bundle，仅节点数不同）

| 节点数 | 打开墙钟 | 相对同轮 500 基准 | 构造期 | 渲染 `.smm-node` | 剪枝命中 | 内部节点 | 预测量 built/visited | 正式测量缓存命中 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | **409 ms** | +0 ms | 0 ms | 24 | 23 | 371/500 | 475/500 | 475/475（100%） |
| 5000 | **725 ms** | +317 ms | 0 ms | **15** | 117 | 3701/5000 | 4750/5000 | **4750/4750（100%）** |
| 10000 | **1091 ms** | +682 ms | 0 ms | **15** | 217 | 7401/10000 | 9500/10000 | **9500/9500（100%）** |

（本次复测各规模仍为 2 次取最小；500 行原表记为「无」，现探针会输出该列读数，故如实填 475/475。同一台机器上相隔一轮的两组读数：404/721/1088 ms 与 409/725/1091 ms，即**噪声量级 ±5 ms（≈1%）**，DOM 与内部节点计数完全一致。）

**读数解释（勿误读）**

- 「相对基线增量」= `row.ms - rows[0].ms`，基准是**同轮 500 节点**（`scripts/verify-visual.mjs:5425` 的 `const base = rows[0]`），**不是历史基线，不构成回归**。
- 「构造期=0ms」：节点数据构造不计入打开墙钟。
- **`.smm-node` 在 5000 / 10000 节点下仍只有 15**：子树纵向剪枝生效（对应 `vendor/BUILD.md` 补丁 11「访问节点数 5002 → 110」），DOM 存量与节点数**解耦**。
- 首帧预测量的**正式测量缓存命中率 100%**，说明 A2 元素复用链路闭合（`vendor/BUILD.md` 补丁 5②）。
- 本模式**不断言阈值**（`scripts/verify-visual.mjs:48` 注释），只记录基线。

---

## §3 产物体积与归因（实测）

| 指标ID | 指标 | 值 | 复现命令 |
| --- | --- | --- | --- |
| P-01 | 发布产物 | **604,847 B** | `ls -l main.js` |
| P-02 | gzip 后 | **177,366 B** | `gzip -c main.js \| wc -c` |
| P-03 | vendor 源文件 | **413,469 B** | `ls -l vendor/simple-mind-map.cjs` |
| P-04 | **gzip 分组占比**（消融实测，见 §3.2） | vendor **117,577 B（66.3%）** / 自有（含 i18n）**59,671 B（33.7%）** | 消融构建 + `gzip -c \| wc -c` |

### 3.1 归因（方案 OPT-01A）

归因构建（**输出到独立目录，绝不覆盖发布产物**）：

```bash
npx esbuild src/main.ts --bundle --format=cjs --target=es2021 --tree-shaking=true \
  --minify --outdir=.tmp-analyze --metafile=.tmp-analyze/meta.json \
  --external:obsidian --external:electron "--external:@codemirror/*" "--external:@lezer/*"
# 再按 .tmp-analyze/meta.json 的 outputs[].inputs[].bytesInOutput 聚合
```

| 来源 | 文件数 | bytesInOutput | 占比 |
| --- | --- | --- | --- |
| `vendor/simple-mind-map.cjs` | 1 | **412,970** | **68.40 %** |
| `src/`（插件自有） | 75 | **190,829** | **31.60 %** |
| 合计 | 76 | 603,799 | 100 % |

`src/` 内 Top10（bytesInOutput）：

| 字节 | 文件 | 备注 |
| --- | --- | --- |
| **25,072** | `src/core/i18n.ts` | 自有第一大项（占总包 4.2%），176 键 × ZH/EN 双语纯词表 |
| 13,677 | `src/engine/mindmap.ts` | 引擎防腐层唯一收口 |
| 12,395 | `src/features/view.ts` | 编排壳 |
| 9,844 | `src/features/node-inline-content.ts` | 自绘内容 |
| 8,464 | `src/markdown/md-outline.ts` | 往返双向实现之一 |
| 8,461 | `src/markdown/md-serialize.ts` | 往返双向实现之二 |
| 7,243 | `src/services/engine-controller.ts` | - |
| 5,535 | `src/platform/math-jax.ts` | - |
| 5,374 | `src/features/view-dnd.ts` | - |
| 5,109 | `src/features/view-node-actions.ts` | - |

**口径说明**：归因构建产物 604,714 B 与发布产物 604,847 B 相差 **133 B**，等于 `esbuild.config.mjs:5-9` 的 banner 长度，归因因此有效。

**结论**：体积约三分之二来自 vendor，故显著降体积必须动 vendor，而 vendor 改动会触发 AGENTS.md 硬规则 3 的双 sha256 同步（`vendor/BUILD.md:32` + `tests/vendor-contract.test.ts`）。自有侧唯一大项 `i18n.ts` 无法用 `import()` 拆包（Obsidian 插件为单文件产物）。

### 3.2 gzip 分组占比（消融实测，2026-10-08）

**为什么要消融而不是「分组后各自 gzip」**：gzip 用滑动窗口跨输入复用冗余，**事后切分同一条 gzip 流不可加**；而「逐源文件独立 gzip 再分组求和」测的是**源文件**（src 源 959 KB 未 minify 对 vendor 源 413 KB 已 minify），会得出与产物相反的结论——该口径**无效，勿用**。

**做法**（两次单变量消融，均在**.tmp 拷贝树**内进行、不触碰真实 src/vendor）：

| 变体 | 替换物 | raw | gzip |
| --- | --- | --- | --- |
| base | 无 | 604,714 B | **177,248 B** |
| no-i18n | `.tmp/src/core/i18n.ts` → 同导出面桩（无词条表） | 579,798 B | 170,116 B |
| no-vendor | `.tmp/vendor/simple-mind-map.cjs` → 同导出名占位桩 | 191,455 B | **59,671 B** |

（base 与 §3.1 归因构建的 `outputs_total_bytes` 604,714 B **完全相同**——两者用同一条 esbuild 命令、同一份拷贝，口径已对齐。）

**边际贡献**：

| 组成 | gzip | 占全包 gzip |
| --- | --- | --- |
| **vendor** | **117,577 B** | **66.3 %** |
| 自有（不含 i18n） | 52,539 B | 29.6 % |
| 其中 `core/i18n.ts` | **7,132 B** | **4.0 %** |
| 合计 | 177,248 B | 100 % |

**交叉验证**：i18n 消融的 raw 差 **−24,916 B** 与 metafile 记录的 `bytesInOutput` 25,072 B 一致（差 156 B 为桩自身 + 树内重写文件的最小差异）；vendor 消融的 raw 差 −413,259 B 与 metafile 的 412,970 B 一致（差 289 B 为桩自身）。

**结论（可支撑决策）**：自有代码**全部删光也最多省 33.7 %**，而其中最大的单个模块（i18n 词表）只占 **4.0 %** ⇒ **优化自有代码的收益上限是个位数百分比**。除非动 vendor，否则体积不可能显著下降。噪声说明：消融会轻微改变 minifier 的标识符分配，实测偏差约 ±1 %。

---

## §4 静态指标（实测）

| 指标ID | 指标 | 值 | 复现命令 |
| --- | --- | --- | --- |
| S-01 | `as any` / `@ts-ignore` / `@ts-expect-error` | **0 / 0 / 0** | `grep -rno "as any" src --include=*.ts \| wc -l` 等三条 |
| S-02 | `as unknown as` | **36**（`engine/mindmap.ts` 占 22） | `grep -rho "as unknown as" src --include=*.ts \| wc -l` |
| S-03 | 分支密度 Top5 | `mindmap.ts` 203、`md-serialize.ts` 122、`node-inline-content.ts` 95、`view.ts` 93、`md-outline.ts` 88 | `grep -oE "if\|for\|while\|catch" <file> \| wc -l`（**逐文件**统计、按计数降序取 5；该正则含标识符内出现，如 `verify` 里的 `if`，故只作横向排序口径） |
| S-04 | features 横向 import | **41**（`view-context` 23 + `view-common` 5 除外），`view-node-actions` 被 6 处依赖 | `grep -rhoP "from './[a-z-]+'" src/features` |
| S-05 | `view.ts` 规模 | 1250 行 / 17 自有方法 / 21 私有字段 / 39 import | `awk 'END{print NR}' src/features/view.ts`；`grep -cP "^\t[a-zA-Z]+\(" …`；`grep -cP "^\tprivate [a-zA-Z]+[?!]?\s*[:=]" …`；`grep -c "^import" …` |
| S-06 | 超过 300 行的文件 | **23**（与 AGENTS.md 豁免表的 23 行登记一致） | 逐文件 `awk 'END{print NR}'`；或 `npx vitest run tests/agents-md-sync.test.ts` |
| S-07 | `addEventListener` 出现 | **31** 处 | `grep -rno "addEventListener" src --include=*.ts \| wc -l` |
| S-08 | `console.` 调用 | **78** 处 | `grep -rno "console\." src --include=*.ts \| wc -l` |
| S-09 | src / tests 规模 | 77 文件 23,409 行 / 67 文件 34,896 行 | `find src -name "*.ts" \| xargs wc -l` |
| S-10 | i18n 键 | ZH **176** / EN **176**（对齐） | 统计 `src/core/i18n.ts` 两段字面量键（`^\t'` 行） |
| S-11 | 设置 | 接口 **12** 项声明 / `DEFAULT_SETTINGS` **12** 键 / 面板走 `getSettingDefinitions()` | 取 `export interface MindMapStudioSettings` 与 `DEFAULT_SETTINGS` 两段内的字段行 |
| S-12 | **循环依赖**（§4.1） | **编译期与运行时均为 0 个环**；77 文件 / **335** 条内部依赖边（其中仅类型边 **61** 条） | 自建 Tarjan 检测脚本（见 §4.1 口径与盲区） |
| S-13 | **圈复杂度**（§4.2） | ≥9 共 **77** 个函数；≥15 共 26；≥20 共 15；≥30 共 5 | `npx eslint src --rule "{\"complexity\":[\"warn\",8]}" -f json` |

### 4.1 循环依赖（实测）

方法：自建 Tarjan SCC 检测（**零新依赖**，不装 madge）——解析 `src/` 全部相对 import（含 `export … from`），按两个视角判环：

- **类型边**：`import type …`，或具名集合内每个说明符都带 `type ` 前缀；
- **值边**：默认导入 / 命名空间导入 / 副作用导入 / 含非 type 具名的混合导入。

| 视角 | 环数 | 说明 |
| --- | --- | --- |
| 编译期（含类型边） | **0** | 含类型边的整图也是 **DAG** |
| 运行时（仅值边） | **0** | 值依赖图是 **DAG** |

**更正记录（2026-10-08 复测）**：本表上一版登记「编译期 1 个环：`view.ts -> view-wikilink.ts -> view-context.ts -> view.ts`」，本次**无法复现**——`view-context.ts` 在当前与 `HEAD` 版本都不存在指向 `./view` 的边（`grep -rn "from './view'" src` 无命中；该文件头注释正说明它是用来替代原先各 `view-*` 模块 `import type { MindMapView } from './view'` 的形态）。故该行按实测替换为 **0 环**；若将来重新引入「view-* → view.ts」的类型边，应重新评估是否需要回到 `view-context` 契约。

规模：77 文件 / **335** 条内部依赖边（其中仅类型边 **61** 条）。

**检测器盲区已逐一核实为空**（故 DAG 结论可靠）：`src/` 内**无**无 `from` 的副作用导入、**无**动态 `import(`、**无** `export * from`（三条命令均无命中）。

### 4.2 圈复杂度（实测）

命令：`npx eslint src --rule "{\"complexity\":[\"warn\",8]}" -f json`
（**注意**：ESLint 9 已移除 `-f compact`；用它会让计数恒为 0 而误判为「无超限函数」。另 `--rule` 覆盖不改仓库配置。）

分布（阈值 8 下的超限函数）：

| 阈值 | ≥9 | ≥10 | ≥12 | ≥15 | ≥20 | ≥25 | ≥30 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 函数数 | **77** | 65 | 45 | 26 | 15 | 7 | 5 |

Top 5：

| 复杂度 | 位置 | 函数 |
| --- | --- | --- |
| 36 | `src/links/links-resolve.ts:172` | `resolveDroppedFile` |
| 36 | `src/markdown/md-outline.ts:352` | `buildInlineData` |
| 35 | `src/markdown/md-serialize.ts:68` | `renderHyperlink` |
| 33 | `src/features/node-inline-content.ts:526` | `splitMarkedText` |
| 31 | `src/markdown/md-serialize.ts:543` | `rawOk` |

按文件聚合 Top3：`md-serialize.ts` 11 个（max 35）、`engine/mindmap.ts` 9 个（max 19）、`md-outline.ts` 6 个（max 36）。

**读法**：高复杂度集中在 **Markdown 往返层**——正是 `AGENTS.md` 明确的「不可拆分、必须共享同一套规则」的两个文件。故这些高值属**刻意设计的不可约复杂度**，缓解手段是性质测试（项目已有 fast-check 往返性质）而非拆分。**不应**据此拆文件。

---

## §5 实机渲染规模（实测 · Obsidian CLI）

夹具：`real-5000.mindmap.md`（239,438 B、5,001 行、sha256 `7eb5ec78…657bc948`），经 `obsidian vault="Mindmap" eval` 读画布 DOM。

**读数由「当前视口」决定（2026-10-08 复测确认的口径）**：性能模式生效时剪枝是「**节点移出画布即摘 DOM**」（引擎 `opt.performanceConfig.removeNodeWhenOutCanvas = true`），而视口变换按文件持久化在 `data.json`，故同一文件在不同会话下 DOM 规模可从「只渲染视口内十几个节点」到「全量 5002 个」——**任何回归比对都必须先说明视口状态**。下表两列即实测的两个端点：

| 指标ID | 指标 | 端点 A：初始默认视口 | 端点 B：全图可见（视口已持久化为「适应画布」） |
| --- | --- | --- | --- |
| R-01 | 渲染 `.smm-node` / `g` 节点组 | **17 / 22** | **5,002 / 5,007** |
| R-02 | 自绘内容 `div`（`.mindmap-node-inline-content`） | **30** | **5,002** |
| R-03 | 画布 DOM 元素总数 | **424** | **31,991** |
| R-04 | `mindmap-fit-view` 耗时 | **3.5 ms**（在端点 A 的 DOM 上） | **4.8 ms**（此时已全量，几乎无增量可渲染） |

（端点 B 的两次读数分别为 `g` 5,006 / 5,007、元素总数 31,986 / 31,991，差 ≤5 个元素属瞬态元素抖动。）

**更正记录**：上一版登记的单值（`g` 2,810 / 自绘 `div` 2,807 / DOM 总数 20,787 / fit 3.2 ms）**未记录视口与剪枝状态**，本次在端点 A、B 都无法复现——它对应某个中间缩放状态。故本表替换为**带条件的两列**读数。

### 5.2 内存（实测 · CLI 双口径，零代码改动）

命令：`obsidian vault="Mindmap" eval code="…"` 读 `performance.memory` 与 `process.memoryUsage()`。

| 场景 | `performance.memory.usedJSHeapSize` | `process.memoryUsage().rss` |
| --- | --- | --- |
| 空闲（无导图视图） | 27,392,431 B（**26.1 MB**） | 157,384,704 B（**150.1 MB**） |
| 打开 `real-5000.mindmap.md` 后 | 39.1 MB（**+13.0 MB**） | 304.7 MB（**+154.6 MB**） |

**口径警告（勿误读）**

- **JS 堆增量（+13.0 MB）才是可用于回归比对的数字**；`rss` 在 Electron 里含渲染进程未归还操作系统的分配，**单次读数不可用作阈值**。
- 测量**未强制 GC**（harness 的 `--expose-gc` 未接入）；采样为单次，非取最小。
- 该口径是 **Obsidian 实机渲染进程**，与 §2 的无头 Chrome 不同源，**不可混用**。

**2026-10-08 复测（同一会话、未强制 GC、全量 DOM 5,002 节点）**：打开后 `usedJSHeapSize` 68,285,305 B / `rss` 1,520,721,920 B；detach 全部导图视图后空闲 72,713,381 B / 1,502,478,336 B ⇒ **空闲读数反而更高（JS 堆 +4.4 MB）**。这直接印证上面第一条警告：单次采样被 GC 时刻主导，**本表两个读数只能当历史记录，不能用于回归比对**（要用于门槛需配对采样 + 强制 GC 或多次取最小）。

---

## §6 未 await（`void`）调用台账

命令：`grep -rnP "\bvoid [a-zA-Z_(]" src --include=*.ts`
命中 **42 行**，其中 **4 行为注释**（`core/persistence.ts:13`、`features/view-image-actions.ts:51`、`features/view-node-actions.ts:415`、`markdown/md-open.ts:46`，后三处是显式声明「调用方以 `void …` 调用」的约定注释），**真实调用点 38 处**。

| 类别 | 数量 | 依据 |
| --- | --- | --- |
| 链尾显式 `.catch` | **7** | `view-dnd.ts:80`、`open-as-restore.ts:88`、`node-inline-editor.ts:365`（链尾 +9 行）、`view-context-menu.ts:197`、`view.ts:834`（链尾 +22 行，注释说明「移除 catch 则精确 1 例报红」）、`view.ts:710`（本轮补，原缺口 ①）、`platform/system-open.ts:21`（`void result.then(…).catch(…)`，本轮新增的收口实现） |
| 被调方内部 try/catch 兜底 | **31** | 逐点核对：`creation.ts:52-54`、`view-export.ts:37-40`、`md-open.ts:96-101`、`md-open.ts:46`（注释约定）、`view-paste.ts:79-97`、`view-node-actions.ts:415`（注释约定）、`view-image-actions.ts:51`（注释约定）、`persistence.ts:13`（注释约定）、`math-jax.ts:620`（`runFlush` 内 try）、`math-jax.ts:879` 与 `prism-code.ts:399`（IIFE 内 try）、`document-service.ts:322-324`、`view-title-renamer.ts:46`（`performRename` 内 try）、`measure-cache.ts:121`（`?.catch?.()`）、`node-codeblock.ts:179`（`copyText` 内部全 try/catch 且返回 false） |
| **真实缺口（官方 Promise 无兜底）** | **0** | 原有 3 处已于 2026-10-08 全部处置（上表两类相加 7+31=38 = 真实调用点总数），见下 |

**真实缺口处置（方案 OPT-05，2026-10-08 已修）**

| 位置 | 原表达式 | 处置 |
| --- | --- | --- |
| `src/features/view.ts:710`（原 707，本轮 +3 行位移） | `void this.app.workspace.revealLeaf(duplicateLeaf)` | 挂 `.catch` → `console.warn`（**不另弹 Notice**：上方已提示「该导图已在其他标签页打开」，再弹是重复打扰）。官方契约 `revealLeaf(leaf): Promise<void>`（`obsidian.d.ts:10992`，`@since 1.7.2`，JSDoc 明言需 `await`） |
| `src/platform/system-open.ts:54`（原 27） | `void shell.openPath(adapter.getFullPath(file.path))` | 改为 `surfaceOpenResult(...)`（见下） |
| `src/platform/system-open.ts:83`（原 52） | `void shell.openPath(path)` | 同上 |

`surfaceOpenResult`（`src/platform/system-open.ts:16`）处理的 **Electron 契约**：`openPath` **从不 reject 表示失败**，而是 resolve 一个错误消息串（成功为空串、失败非空）⇒「不读返回值」等于「打不开时零反馈」。现统一：成功静默；非空错误串与 reject 走同一出口（`console.error` + `Notice`）。
**词条（本轮修正）**：原先复用 `common.cannotOpen`（「无法打开该文件类型」）语义不符——这里的失败主因是**系统里没有关联应用**，故新增独立词条 `common.systemOpenFailed`（ZH/EN 双语，`zh`＝「无法用系统默认应用打开该文件」）。
直测：`tests/system-open.test.ts`（4 例：成功静默 / 错误串 / reject / 双语）。

---

## §7 README 交互承诺核销台账

核销方式：Obsidian CLI 实机读 DOM 与命令表（`obsidian vault="Mindmap" eval code="…"`）。

### 7.1 已核销（结构与文案实证）

| README 承诺 | 实测 | 结论 |
| --- | --- | --- |
| 6 种布局 | `layoutSelect.options` = `logicalStructure` / `mindMap` / `organizationStructure` / `catalogOrganization` / `timeline` / `fishbone` | 通过，6/6 |
| 4 种连线样式 | `lineStyleOptions` = `auto` / `curve` / `direct` / `straight` | 通过，4/4 |
| 工具栏 15 个控件 | 切换回 Markdown、添加子节点 (Tab)、添加同级节点 (Enter)、删除节点 (Delete)、撤销、重做、自动整理、搜索节点 (Ctrl+F)、添加链接、添加图片、重置缩放（100%）、适应画布、放大、缩小、导出 PNG | 通过，与 Everyday actions 表逐行对应 |
| 搜索框 | `view.searchInput` 存在 | 入口在，**搜索行为本身未测** |
| 命令 9 个 | `mindmap-studio:` 命令数组 | 通过，含 README 提到的 Split all mixed links / Switch to Markdown / Export PNG |
| 拆分混排链接命令 | 实机执行 `mindmap-studio:mindmap-split-links-all` 无错误，写回后文件仍为合法 Markdown | 通过 |
| 数学公式渲染 | `math-verify.mindmap.md` 截图：`E=mc²`、`sin x` 与 `cos x`、`√(a²+b²)`、`∫₀¹x²dx` 均为公式而非字面 | 通过 |
| 设置面板声明式 | `src/settings.ts:229` 的 `getSettingDefinitions()`；官方 `obsidian.d.ts:9246`，`display()` 自 1.13 起弃用（`obsidian.d.ts:9300-9303`） | 通过，与 `minAppVersion 1.13.0` 自洽 |

### 7.2 未核销（需指针交互，CLI 无法驱动）

| README 条目 | 缺口 | 测量方法 |
| --- | --- | --- |
| 拖拽换父与落点高亮 | 需真实鼠标拖拽 | 实机手动；或扩展 `verify:visual` 探针 |
| 拖入库内与系统文件 | 需 DataTransfer 拖放事件 | 实机手动；`tests/view-dnd.test.ts` 已覆盖分发逻辑（非真实拖放） |
| 图片 hover 手柄调宽 | 需 hover 加拖拽 | 实机手动；`tests/drag-session.test.ts` 与 `tests/feature-teardown.test.ts` 已覆盖会话生命周期 |
| 右键移除文本置空 | 需右键菜单 | 实机手动 |
| 修饰键点击（Ctrl/Cmd/Shift/Alt） | 需带修饰键的合成事件 | 实机手动 |

**结论**：README 未发现与实现不符之处，故**不改 README**（用户文档不写内部核销状态）；核销台账以本表为准。

---

## §8 未实测项与测量方法

| 指标ID | 指标 | 状态与测量方法 |
| --- | --- | --- |
| U-01 | **内存** | **已结清**：见 §5.2（CLI 双口径，未改验证脚本） |
| U-02 | gzip 分组占比（vendor 对自有） | **已结清**：见 §3.2（消融实测 vendor 66.3 % / 自有 33.7 %，其中 i18n 4.0 %）。曾一度误判为「口径不成立」，纠正记录见 §3.2 开头 |
| U-03 | 函数圈复杂度 | **已结清**：见 §4.2（`--rule` 覆盖，未改配置，未装新工具） |
| U-04 | 循环依赖 | **已结清**：见 §4.1（自建零依赖检测，未装 madge） |
| U-05 | `view.ts` 中「本该下沉」的代码行跨度 | **已复算为机制可复现的行跨度**（见下）；「是否该下沉」仍是判断，结论：**不投入** |

### 8.1 U-05 复算明细（行跨度，A 级）

`view.ts` 全 1250 行。按成员边界（`grep -nP "^\t(private |public |protected )?(async )?[a-zA-Z]+\s*[(=]"`）复算四个候选簇：

| 簇 | 成员（起始行） | 行跨度（相邻成员起始行之差） |
| --- | --- | --- |
| A 内容重测调度器 | `scheduleContentRemeasure`(346) `flushContentRemeasure`(365) `retryDeferredContentRemeasure`(434) `remeasureSettledContentNodes`(448) `installMathFontsHook`(456) | 346→479 = **133** |
| B 图片尺寸回灌 | `loadMindMapFromFile`(792) `applyPendingImageCorrections`(912) `onEngineReady`(929) | 792→880 = **88**；912→980 = **68**；小计 **156** |
| C 引用更新组合 | `updateReferencesOnRename`(1152) `updateReferencesOnDelete`(1166) | 1152→1181 = **29** |
| D 自动拆分调度 | `scheduleAutoSplitCheck`(1083) `cancelAutoSplitCheck`(1092) | 1083→1102 = **19** |

四簇行跨度合计 = **337 行**（占 1250 行的 27%）。

**这是上界，不是「可下沉量」**：B 簇含 `loadMindMapFromFile`（加载编排，必须留在视图）整段 88 行，A 簇含若干方法签名与守卫。若只计「被指认为可下沉的块」（如 `loadMindMapFromFile` 内的图片探测块 `:826-850` 约 25 行 + 两个独立小方法），量级降至约 **270–280 行**。原方案文档里的「约 310 行」是子代理估算（**B 级**），现已被本表替换为可复算的数字。

**但「是否该下沉」是判断，不是测量**：这些方法大量读写 `view.ts` 的**私有会话/代际状态**（实测 **21 个私有字段**，见 S-05），下沉必须先搬状态与守卫（`loadingFilePath` 代际、`pendingInitRaf`、`contentRemeasureNodes`、`deferredContent*`）。在编排层无直测的前提下搬运状态，风险高于收益 ⇒ **维持「不投入」**（对应 OPT-02 已排除）。

---

## §9 相关文件

- 架构与豁免理由：`docs/agents/architecture.md`
- 引擎补丁与性能实测账本：`vendor/BUILD.md`
- 测试分层与 CI：`docs/agents/testing.md`