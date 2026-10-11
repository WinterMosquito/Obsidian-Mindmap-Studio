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
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`（无头 `--headless=old`） | `scripts/verify-visual.mjs:281` 的 `findChrome()` |
| 库（实机） | `C:\Users\LEGION\OneDrive\Obsidian\Mindmap`，23 篇 md / 24 个文件 | `obsidian eval` 查询 `app.vault.getName()` / `getMarkdownFiles().length` |
| 记录日期 | 2026-10-07（首版）；2026-10-08（第一次全表复测）；**本次全表复测 2026-10-09** | - |
| 构建指纹（本次复测） | `main.js` sha256 `003d78e7…b411214e`（598,827 B）｜ `vendor/simple-mind-map.cjs` sha256 `07dc23d0…5381f69b2`（413,469 B） | `sha256sum main.js vendor/simple-mind-map.cjs` |

**读数与指纹的绑定关系（重要）**：上表指纹是本次复测所用构建。**§1–§6 的数字均由各自「复现命令」在该构建上实测**；§5 的实机读数同在**该构建**上重测（`main.js`/`manifest.json`/`styles.css` 已复制到 `<vault>/.obsidian/plugins/mindmap-studio/` 并 `obsidian plugin:reload id=mindmap-studio`，`obsidian dev:errors` 无报错），但**测量环境有降级**（窗口隐藏 + rAF 垫片，见下方更正记录第 2 条）；§7 是 2026-10-07 的实机核销台账、§8 是未实测项与方法论，二者未随本次复测（渲染与命令面未改动，§8.1 的行号随 `view.ts` 行数刷新复算）。

注意：**打开基准跑在无头 Chrome 里，与 Obsidian 实机不同源**。`vendor/BUILD.md` 里的 5000 节点读数（1151ms、1091ms 等）是**实机**口径，与本文件 §2 的无头读数**不可直接相减**。

### 复测更正记录（2026-10-09）

本轮为全表复测（§1~§6 全部重跑）。与上一版（2026-10-08）相比：**4 处更正**（含 1 处方法论修正、1 处口径补全）、**1 处新增缺口**、**1 处正常演进**。

1. **§5 夹具已被就地改动**：上一版登记的 `real-5000.mindmap.md`（239,438 B / 5,001 行 / sha `7eb5ec78…`）**已不是生成器输出**——库内副本比生成器输出多 1 个空节点，且有 1 个节点被拖动换父（`diff` 生成器输出与库内副本可见）。本轮用生成器**重建为标准形态**（见 §5 的复现命令），夹具指纹随之更新。**夹具指纹必须与本表同步**，否则 §5 读数不可复核。
2. **§5 测量环境降级（必须与读数一起读）**：本轮测量时 Obsidian 窗口处于**隐藏/最小化**（实测 `document.hidden === true`），浏览器**暂停 rAF** ⇒ 视图初始化（`loadMindMapFromFile` 的 `pendingInitRaf`）与渐进渲染都停在半途（实测数分钟不动）。故临时以 `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16)` 垫片替代 rAF，读数才得以完成。垫片只改**调度方式**（不改变节点数/视口/剪枝判据），但 **R-04 的耗时含 UI 线程空闲差异**，且端点 B 需等渐进渲染跑完（约 2 分钟）。上一版是窗口可见时测的，故 R-04 **不可跨轮相减**。
3. **§6 真实缺口 1 处（上一版漏计）**：`src/features/view-link-navigator.ts:87` 的 `void view.app.workspace.openLinkText(...)` 是**官方 Promise 且全调用链无 `.catch`**。上一版登记「0 处」是按 7+31=38 配平命中数的结果，未逐点核到这一条。本表按实测改为 **1 处、待处置**（见 §6）。
4. **§4.1 检测器必须先去注释（方法论修正）**：`view-context.ts` 的头注释里写着 ``import type { MindMapView } from './view'``，**未去注释**的检测器会据此造出一条**假类型边** `view-context.ts → view.ts`，并把 24 个 `view-*` 模块连成一个假环。本轮检测器加「去注释（保留字符串字面量）」后，编译期与运行时**均为 0 环**——结论与上一版一致，但上一版「0 环」是在「无该边」的前提下得出的，口径需写明。
5. **§3.1 的 915 B 已定位（口径补全）**：归因构建的 `outputs[].bytes` 与其 `inputs[].bytesInOutput` 求和**恒差 915 B**（esbuild 运行时/CJS 包装，未归属到任何输入）。上一版把「归因构建产物 604,714 B」与「合计 603,799 B」并列而未说明这 915 B；本轮两者都写明口径（598,694 / 597,779）。
6. **K117 减法批次的读数变化**（属正常演进，非遗漏）：`src/` 77 → **76 文件**（删 `features/file-creator.ts`）、i18n 键 176/176 → **166/166**、设置项 12 → **8**、`main.js` 604,847 → **598,827 B**、单测 1906 → **1911** 用例。§3/§4 相应读数整体下移。

---

## §1 工程门禁基线（实测）

| 指标ID | 指标 | 值 | 复现命令 |
| --- | --- | --- | --- |
| G-01 | 类型检查 + 生产构建 | `BUILD_EXIT=0` | `npm run build` |
| G-02 | Lint（0 warning 门禁） | `LINT_EXIT=0` | `npm run lint` |
| G-03 | 单测 | 66 文件 / **1911** 用例全通过 | `npx vitest run` |
| G-04 | 死代码 | `KNIP_EXIT=0` | `npm run check:dead-code` |
| G-05 | 文档同步契约 | 4 passed | `npx vitest run tests/agents-md-sync.test.ts` |

---

## §2 打开性能基线（实测 · 无头 Chrome）

命令：`npm run verify:visual -- --require-chrome --bench-open`
（各规模 **2 次取最小**；同页同 bundle，仅节点数不同）

| 节点数 | 打开墙钟 | 相对同轮 500 基准 | 构造期 | 渲染 `.smm-node` | 自绘锚点 | 截断 | 剪枝命中 | 内部节点 | 预测量 built/visited | 正式测量缓存命中 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | **386 ms** | +0 ms | 0 ms | 24 | 2 | 0 | 23 | 371/500 | 475/500 | 475/475（100%） |
| 5000 | **687 ms** | +301 ms | 0 ms | **15** | 1 | 0 | 117 | 3701/5000 | 4750/5000 | **4750/4750（100%）** |
| 10000 | **1039 ms** | +653 ms | 0 ms | **15** | 1 | 0 | 217 | 7401/10000 | 9500/10000 | **9500/9500（100%）** |

（各规模仍为 2 次取最小。探针在 500 行也会输出「自绘锚点 / 截断」两列，故如实填入。**同轮内噪声量级 ±5 ms**；与上一版相隔一轮的两组读数 409/725/1091 ms（2026-10-08）与 386/687/1039 ms（本轮）相差约 5%，**DOM 与内部节点计数完全一致**——插件自有代码在 K117 批次后变小，属正常演进，不构成回归判定。）

**读数解释（勿误读）**

- 「相对基线增量」= `row.ms - rows[0].ms`，基准是**同轮 500 节点**（`scripts/verify-visual.mjs:5423` 的 `const base = rows[0]`），**不是历史基线，不构成回归**。
- 「构造期=0ms」：节点数据构造不计入打开墙钟。
- **`.smm-node` 在 5000 / 10000 节点下仍只有 15**：子树纵向剪枝生效（对应 `vendor/BUILD.md` 补丁 11「访问节点数 5002 → 110」），DOM 存量与节点数**解耦**。
- 首帧预测量的**正式测量缓存命中率 100%**，说明 A2 元素复用链路闭合（`vendor/BUILD.md` 补丁 5②）。
- 本模式**不断言阈值**（`scripts/verify-visual.mjs:48` 注释），只记录基线。

---

## §3 产物体积与归因（实测）

| 指标ID | 指标 | 值 | 复现命令 |
| --- | --- | --- | --- |
| P-01 | 发布产物 | **598,827 B** | `ls -l main.js` |
| P-02 | gzip 后 | **175,810 B** | `gzip -c main.js \| wc -c` |
| P-03 | vendor 源文件 | **413,469 B** | `ls -l vendor/simple-mind-map.cjs` |
| P-04 | **gzip 分组占比**（消融实测，见 §3.2） | vendor **117,526 B（66.9%）** / 自有（含 i18n）**58,179 B（33.1%）** | 消融构建 + `gzip -c \| wc -c` |

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
| `vendor/simple-mind-map.cjs` | 1 | **412,970** | **69.08 %** |
| `src/`（插件自有） | 74 | **184,809** | **30.92 %** |
| 合计 | 75 | 597,779 | 100 % |

`src/` 内 Top10（bytesInOutput）：

| 字节 | 文件 | 备注 |
| --- | --- | --- |
| **21,836** | `src/core/i18n.ts` | 自有第一大项（占总包 3.7%），166 键 × ZH/EN 双语纯词表 |
| 13,435 | `src/engine/mindmap.ts` | 引擎防腐层唯一收口 |
| 12,043 | `src/features/view.ts` | 编排壳 |
| 9,453 | `src/features/node-inline-content.ts` | 自绘内容 |
| 8,464 | `src/markdown/md-outline.ts` | 往返双向实现之一 |
| 8,461 | `src/markdown/md-serialize.ts` | 往返双向实现之二 |
| 7,072 | `src/services/engine-controller.ts` | - |
| 5,535 | `src/platform/math-jax.ts` | - |
| 5,374 | `src/features/view-dnd.ts` | - |
| 5,109 | `src/features/view-node-actions.ts` | - |

**口径说明（两条都要读）**：归因构建产物 598,694 B 与发布产物 598,827 B 相差 **133 B**，等于 `esbuild.config.mjs:5-9` 的 banner 长度，归因因此有效；而 `bytesInOutput` 合计 **597,779 B** 与产物文件 598,694 B 相差 **915 B**，是 **esbuild 运行时/CJS 包装**未归属到任何输入的固定开销（上一版同样存在，只是未写明）。两者不可混用为同一口径。

**结论**：体积约三分之二来自 vendor，故显著降体积必须动 vendor，而 vendor 改动会触发 AGENTS.md 硬规则 3 的双 sha256 同步（`vendor/BUILD.md:32` + `tests/vendor-contract.test.ts`）。自有侧唯一大项 `i18n.ts` 无法用 `import()` 拆包（Obsidian 插件为单文件产物）。

### 3.2 gzip 分组占比（消融实测，2026-10-09）

**为什么要消融而不是「分组后各自 gzip」**：gzip 用滑动窗口跨输入复用冗余，**事后切分同一条 gzip 流不可加**；而「逐源文件独立 gzip 再分组求和」测的是**源文件**（src 源未 minify 对 vendor 源已 minify），会得出与产物相反的结论——该口径**无效，勿用**。

**做法**（两次单变量消融，均在 **`.tmp-ablate` 拷贝树**内进行、不触碰真实 src/vendor）：

| 变体 | 替换物 | raw | gzip |
| --- | --- | --- | --- |
| base | 无 | 598,694 B | **175,705 B** |
| no-i18n | `.tmp-ablate/no-i18n/src/core/i18n.ts` → 同导出面桩（无词条表） | 576,964 B | 169,441 B |
| no-vendor | `.tmp-ablate/no-vendor/vendor/simple-mind-map.cjs` → 同导出名占位桩 | 185,447 B | **58,179 B** |

（base 的 raw 598,694 B 与 §3.1 归因构建的产物文件 598,694 B **完全相同**——两者用同一条 esbuild 命令产出，口径已对齐。）

**边际贡献**：

| 组成 | gzip | 占全包 gzip |
| --- | --- | --- |
| **vendor** | **117,526 B** | **66.9 %** |
| 自有（不含 i18n） | 51,915 B | 29.6 % |
| 其中 `core/i18n.ts` | **6,264 B** | **3.6 %** |
| 合计 | 175,705 B | 100 % |

**交叉验证**：i18n 消融的 raw 差 **−21,730 B** 与 metafile 记录的 `bytesInOutput` 21,836 B 一致（差 106 B 为桩自身 + 树内重写文件的最小差异）；vendor 消融的 raw 差 −413,247 B 与 metafile 的 412,970 B 一致（差 277 B 为桩自身）。

**结论（可支撑决策）**：自有代码**全部删光也最多省 33.1 %**，而其中最大的单个模块（i18n 词表）只占 **3.6 %** ⇒ **优化自有代码的收益上限是个位数百分比**。除非动 vendor，否则体积不可能显著下降。噪声说明：消融会轻微改变 minifier 的标识符分配，实测偏差约 ±1 %。

---

## §4 静态指标（实测）

| 指标ID | 指标 | 值 | 复现命令 |
| --- | --- | --- | --- |
| S-01 | `as any` / `@ts-ignore` / `@ts-expect-error` | **0 / 0 / 0** | `grep -rno "as any" src --include=*.ts \| wc -l` 等三条 |
| S-02 | `as unknown as` | **35**（`engine/mindmap.ts` 占 22） | `grep -rho "as unknown as" src --include=*.ts \| wc -l` |
| S-03 | 分支密度 Top5 | `mindmap.ts` 208、`md-serialize.ts` 122、`node-inline-content.ts` 91、`md-outline.ts` 88、`math-jax.ts` 85 | `grep -oE "if\|for\|while\|catch" <file> \| wc -l`（**逐文件**统计、按计数降序取 5；该正则含标识符内出现，如 `verify` 里的 `if`，故只作横向排序口径） |
| S-04 | features 横向 import | **41**（`view-context` 23 + `view-common` 5 除外），`view-node-actions` 被 6 处依赖 | `grep -rhoP "from './[a-z-]+'" src/features` |
| S-05 | `view.ts` 规模 | 1252 行 / 17 自有方法 / 21 私有字段 / 39 import | `awk 'END{print NR}' src/features/view.ts`；`grep -cP "^\t[a-zA-Z]+\(" …`；`grep -cP "^\tprivate [a-zA-Z]+[?!]?\s*[:=]" …`；`grep -c "^import" …` |
| S-06 | 超过 300 行的文件 | **23**（与 AGENTS.md 豁免表的 23 行登记一致） | 逐文件 `awk 'END{print NR}'`；或 `npx vitest run tests/agents-md-sync.test.ts` |
| S-07 | `addEventListener` 出现 | **31** 处 | `grep -rno "addEventListener" src --include=*.ts \| wc -l` |
| S-08 | `console.` 调用 | **78** 处 | `grep -rno "console\." src --include=*.ts \| wc -l` |
| S-09 | src / tests 规模 | 76 文件 23,148 行 / 68 文件 34,992 行 | `find src -name "*.ts" \| xargs wc -l` |
| S-10 | i18n 键 | ZH **166** / EN **166**（对齐） | 统计 `src/core/i18n.ts` 两段字面量键（`^\t'` 行；ZH 段以 `} as const;` 收尾、EN 段以 `};` 收尾，**按段切分**，勿用单一结束标记） |
| S-11 | 设置 | 接口 **8** 项声明 / `DEFAULT_SETTINGS` **8** 键 / 面板走 `getSettingDefinitions()` | 取 `export interface MindMapStudioSettings` 与 `DEFAULT_SETTINGS` 两段内的字段行（文件为 CRLF，行尾 `\r` 需先剥离） |
| S-12 | **循环依赖**（§4.1） | **编译期与运行时均为 0 个环**；76 文件 / **331** 条 src 内部依赖边（其中仅类型边 **60** 条） | 自建 Tarjan 检测脚本（见 §4.1 口径与盲区） |
| S-13 | **圈复杂度**（§4.2） | ≥9 共 **77** 个函数；≥15 共 26；≥20 共 15；≥30 共 5 | `npx eslint src --rule "{\"complexity\":[\"warn\",8]}" -f json` |

### 4.1 循环依赖（实测）

方法：自建 Tarjan SCC 检测（**零新依赖**，不装 madge）——解析 `src/` 全部相对 import（含 `export … from`），**先去掉注释再匹配**（保留字符串字面量），按两个视角判环：

- **类型边**：`import type …`，或具名集合内每个说明符都带 `type ` 前缀（`export type … from` 同口径）；
- **值边**：默认导入 / 命名空间导入 / 副作用导入 / 含非 type 具名的混合导入。

| 视角 | 环数 | 说明 |
| --- | --- | --- |
| 编译期（含类型边） | **0** | 含类型边的整图也是 **DAG** |
| 运行时（仅值边） | **0** | 值依赖图是 **DAG** |

**更正记录（2026-10-08 复测）**：本表上一版登记「编译期 1 个环：`view.ts -> view-wikilink.ts -> view-context.ts -> view.ts`」，本次**无法复现**——`view-context.ts` 在当前与 `HEAD` 版本都不存在指向 `./view` 的边（`grep -rn "from './view'" src` 无命中；该文件头注释正说明它是用来替代原先各 `view-*` 模块 `import type { MindMapView } from './view'` 的形态）。故该行按实测替换为 **0 环**；若将来重新引入「view-* → view.ts」的类型边，应重新评估是否需要回到 `view-context` 契约。

**方法论更正（2026-10-09）**：上述 2026-10-08 的 `grep "from './view'"` 之所以「无命中」，是因为该字面量出现在 `view-context.ts` 的**头注释**里（第 4 行）。**检测器若不先去注释**，会把注释里的那句 `import type { MindMapView } from './view'` 当成真导入，造出假边 `view-context.ts → view.ts`，进而把 24 个 `view-*` 模块连成一个假环（本轮实测复现过该假环）。结论（0 环）不变，但**复现命令必须包含去注释步骤**，否则下一位复测者会看到 1 个环。

规模：76 文件 / **331** 条 src 内部依赖边（其中仅类型边 **60** 条）。另有 **28 处**指向 `vendor/simple-mind-map.cjs` 的跨出边（27 个文件；`engine-controller.ts` 有两处），**不计入 src 图**。

**检测器盲区已逐一核实为空**（故 DAG 结论可靠）：`src/` 内**无**无 `from` 的副作用导入、**无**动态 `import(`、**无** `export * from`（三条命令均无命中）。

### 4.2 圈复杂度（实测）

命令：`npx eslint src --rule "{\"complexity\":[\"warn\",8]}" -f json`
（**注意**：ESLint 9 已移除 `-f compact`；用它会让计数恒为 0 而误判为「无超限函数」。另 `--rule` 覆盖不改仓库配置。）

分布（阈值 8 下的超限函数）：

| 阈值 | ≥9 | ≥10 | ≥12 | ≥15 | ≥20 | ≥25 | ≥30 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 函数数 | **77** | 64 | 43 | 26 | 15 | 7 | 5 |

Top 5：

| 复杂度 | 位置 | 函数 |
| --- | --- | --- |
| 36 | `src/links/links-resolve.ts:172` | `resolveDroppedFile` |
| 36 | `src/markdown/md-outline.ts:352` | `buildInlineData` |
| 35 | `src/markdown/md-serialize.ts:68` | `renderHyperlink` |
| 33 | `src/features/node-inline-content.ts:508` | `splitMarkedText` |
| 31 | `src/markdown/md-serialize.ts:543` | `rawOk` |

按文件聚合 Top3：`md-serialize.ts` 11 个（max 35）、`engine/mindmap.ts` 9 个（max 19）、`md-outline.ts` 6 个（max 36）。

**读法**：高复杂度集中在 **Markdown 往返层**——正是 `AGENTS.md` 明确的「不可拆分、必须共享同一套规则」的两个文件。故这些高值属**刻意设计的不可约复杂度**，缓解手段是性质测试（项目已有 fast-check 往返性质）而非拆分。**不应**据此拆文件。

---

## §5 实机渲染规模（实测 · Obsidian CLI）

夹具：`real-5000.mindmap.md`（239,437 B、5,002 行、sha256 `a409f893…4715c517`；生成器口径 **5,000 节点**（不含根）／深 8／783 长文本／225 wikilink），**确定性重建**命令：

```bash
node scripts/gen-perf-fixture.mjs --out "<vault>/real-5000.mindmap.md"   # seed 20261005，输出 5000 节点 / 深 8 / 783 长文本 / 225 wikilink
```

**更正记录（2026-10-09）**：上一版登记的夹具（239,438 B / 5,001 行 / sha `7eb5ec78…`）与生成器输出不一致，且库内副本已被就地编辑（多一个空节点、一个节点被拖动换父）。本轮**重建为标准形态**：生成器在根后输出一个空行，故行数为 5,002（上一版 5,001 是旧版生成器口径）。读数经 `obsidian vault="Mindmap" eval` 读画布 DOM。

**测量环境（必须与读数一起读）**：本轮 Obsidian 窗口隐藏（`document.hidden === true`）⇒ rAF 被暂停，视图初始化与渐进渲染都不会推进；故以 `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16)` 垫片替代 rAF（见 §0 更正记录第 2 条）。端点 B 需等渐进渲染跑完（约 2 分钟）。

**读数由「当前视口」决定（2026-10-08 复测确认的口径）**：性能模式生效时剪枝是「**节点移出画布即摘 DOM**」（引擎 `opt.performanceConfig.removeNodeWhenOutCanvas = true`），而视口变换按文件持久化在 `data.json`，故同一文件在不同会话下 DOM 规模可从「只渲染视口内十几个节点」到「全量 5002 个」——**任何回归比对都必须先说明视口状态**。下表两列即实测的两个端点（本轮两端点均可**按命令复现**）：

| 指标ID | 指标 | 端点 A：初始默认视口 | 端点 B：全图可见（fit 后） |
| --- | --- | --- | --- |
| R-01 | 渲染 `.smm-node` / `g` 节点组 | **36 / 41** | **5,002 / 5,007** |
| R-02 | 自绘内容 `div`（`.mindmap-node-inline-content`） | **36** | **5,002** |
| R-03 | 画布 DOM 元素总数 | **354** | **31,877** |
| R-04 | `mindmap-fit-view` 命令耗时（`performance.now` 包裹 `executeCommandById`） | **1.7 / 2.3 ms** | **2.6 / 3.4 / 3.9 ms** |

**两端点的状态与复现**：

- 端点 A：清空该文件的 `viewState` 条目（保留 `openAs: 'mindmap'`）后重开 ⇒ 引擎落在**同一默认视口** `scale 1 / translate (-1505.79, -14.60)`（容器 832×783，画布 832×741），两次重开读数一致（36/41/36/354），故该端点可复现。
- 端点 B：执行 `mindmap-studio:mindmap-fit-view` ⇒ `scale 0.00585 / translate (404.67, 368.08)`，等渐进渲染收敛（`.smm-node` 1655 → 2815 → 3192 → 5002）后为 5,002/5,007/5,002/31,877。
- R-04 是**同步**耗时（fit 的 DOM 更新走异步渲染，不在这段区间内）；单次采样、±1 ms 级噪声，端点 A 的数字取自两次「真转变」调用，端点 B 取自 3 次连续调用（含 no-op 重复）。

### 5.2 内存（实测 · CLI 双口径，零代码改动）

命令：`obsidian vault="Mindmap" eval code="…"` 读 `performance.memory` 与 `process.memoryUsage()`。

| 场景 | `performance.memory.usedJSHeapSize` | `process.memoryUsage().rss` |
| --- | --- | --- |
| 空闲（插件 reload 后、无导图视图） | 38,753,389 B（**37.0 MB**） | 193,613,824 B（**184.6 MB**） |
| 打开 `real-5000.mindmap.md` 后（全量 DOM 5,002） | 53,574,592 B（**51.1 MB**） | 383,606,784 B（**365.9 MB**） |
| detach 全部导图视图后（约 20 s 空闲） | 57,540,721 B（**54.9 MB**） | 393,957,376 B（**375.7 MB**） |

（本表 MB 一律为 **MiB**＝字节 ÷ 1024²，与上一版首行口径一致；上一版后两行曾用十进制 MB，故跨轮比较请只认字节数。）

**口径警告（勿误读）**

- **JS 堆增量（第 1→2 行 +14.1 MB）才是可用于回归比对的数字**；`rss` 在 Electron 里含渲染进程未归还操作系统的分配，**单次读数不可用作阈值**。
- 测量**未强制 GC**（harness 的 `--expose-gc` 未接入）；采样为单次，非取最小。
- 该口径是 **Obsidian 实机渲染进程**，与 §2 的无头 Chrome 不同源，**不可混用**。

**2026-10-09 复测（同一会话、未强制 GC、全量 DOM 5,002 节点）**：第 2→3 行显示 **detach 之后空闲读数反而更高**（JS 堆 +3.8 MB，rss +9.9 MB）——与 2026-10-08 那轮方向一致（该轮同样出现 detach 后升高），直接印证上面第一条警告：单次采样被 GC 时刻主导，**本表读数只能当历史记录，不能用于回归比对**（要用于门槛需配对采样 + 强制 GC 或多次取最小）。

---

## §6 未 await（`void`）调用台账

命令：`grep -rnP "\bvoid [a-zA-Z_(]" src --include=*.ts`
命中 **41 行**，其中 **4 行为注释**（`core/persistence.ts:13`、`features/view-image-actions.ts:51`、`features/view-node-actions.ts:415`、`markdown/md-open.ts:46`，后三处是显式声明「调用方以 `void …` 调用」的约定注释），**真实调用点 37 处**。

（比上一版少 1 行：`HEAD` 里的 `main.ts:220`（文件夹右键「新建思维导图」入口）在本次工作树中已不存在，其余命中集合逐条一致。）

| 类别 | 数量 | 依据 |
| --- | --- | --- |
| 链尾显式 `.catch` | **7** | `view-dnd.ts:80`、`open-as-restore.ts:88`、`node-inline-editor.ts:365`（链尾 +8 行 → `:373`）、`view-context-menu.ts:197`（链尾 +3 行 → `:200`）、`view.ts:708`（链尾 +2 行 → `:710`）、`view.ts:832`（链尾 +21 行 → `:853`）、`platform/system-open.ts:21`（`void result.then(…).catch(…)` → `:29`） |
| 被调方内部 try/catch 兜底 | **29** | `commands.ts:52/65/211`（`createNewMindMap` → `creation.ts:41-56` try）、`commands.ts:158`（`view.exportPNG` → `view-export.ts` try）、`commands.ts:176` + `main.ts:170/195` + `open-as-restore.ts:106`（`openAsMindMap` → `md-open.ts:81-86` try）、`main.ts:180` + `view.ts:1105`（`openAsMarkdown` → `md-open.ts:101-106` try）、`main.ts:252`（`flushNow` → `view-state.ts` 注明注入的 `PluginDataWriter.write` 内部吞错）、`main.ts:256/302`（`saveSettings` → 同上 `dataWriter.write` 吞错）、`view-state.ts:143`（`persist` → 同上）、`view-context-menu.ts:172` + `view-toolbar.ts:84`（`addLinkToActiveNode` 自兜，`view-node-actions.ts:422-427`）、`view-context-menu.ts:220` + `view-toolbar.ts:87`（`addImageToActiveNode` 自兜，`view-image-actions.ts:57-62`）、`view-toolbar.ts:166`（`exportPNG`）、`view-paste.ts:25/50`（`handlePasteEvent` 内 try）、`view-title-renamer.ts:37`（`performRename` 内 try）、`node-codeblock.ts:179`（`copyText` 内部全 try/catch 且返回 false）、`measure-cache.ts:121`（`?.catch?.()`）、`math-jax.ts:620`（`runFlush` 内 try）、`math-jax.ts:879` 与 `prism-code.ts:399`（IIFE 内 try）、`document-service.ts:158`（`save` → `:322` catch）、`ui/modal-image.ts:101`（`pasteFromClipboard` 内 try） |
| **真实缺口（官方 Promise 无兜底）** | **1** | `features/view-link-navigator.ts:87`，本轮新发现，见下 |

**真实缺口 1 处（2026-10-09 复测发现，待处置）**

| 位置 | 表达式 | 分析 |
| --- | --- | --- |
| `src/features/view-link-navigator.ts:87` | `void view.app.workspace.openLinkText(linkText, sourcePath, mode === 'current' ? false : mode)` | 官方契约 `openLinkText(linktext, sourcePath, newLeaf?, openViewState?): Promise<void>`（`obsidian.d.ts:7914`，`@since 0.16.0`）。`openResolvedTarget()` 内**无 try**，其上游 `openHyperlink()` 同步返回 `void`，**接不住这个 Promise** ⇒ 未处理拒绝。 |

**处置建议（本轮未改代码）**：链尾挂 `.catch` → `console.warn`（与 `view.ts:708` 同策：官方失败时核心自身有反馈路径，插件侧只留痕、不二次弹 Notice）；若实机确认失败时用户毫无反馈，再升级为 `notifyError`。**本轮刻意不改**——改源代码会同时作废本表 §3（体积/归因）与 §4（行数/复杂度/边数）的全部读数，须作为独立改动连同测试一起提交。

---

## §7 README 交互承诺核销台账

核销方式：Obsidian CLI 实机读 DOM 与命令表（`obsidian vault="Mindmap" eval code="…"`）。**本节为 2026-10-07 的读数，未随本次复测**（渲染与命令面未改动）。

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
| 设置面板声明式 | `src/settings.ts:192` 的 `getSettingDefinitions()`；官方 `obsidian.d.ts:9246`，`display()` 自 1.13 起弃用（`obsidian.d.ts:9300-9303`） | 通过，与 `minAppVersion 1.13.0` 自洽 |

### 7.2 未核销（需指针交互，CLI 无法驱动）

| README 条目 | 缺口 | 测量方法 |
| --- | --- | --- |
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
| U-02 | gzip 分组占比（vendor 对自有） | **已结清**：见 §3.2（消融实测 vendor 66.9 % / 自有 33.1 %，其中 i18n 3.6 %）。曾一度误判为「口径不成立」，纠正记录见 §3.2 开头 |
| U-03 | 函数圈复杂度 | **已结清**：见 §4.2（`--rule` 覆盖，未改配置，未装新工具） |
| U-04 | 循环依赖 | **已结清**：见 §4.1（自建零依赖检测，未装 madge） |
| U-05 | `view.ts` 中「本该下沉」的代码行跨度 | **已复算为机制可复现的行跨度**（见下）；「是否该下沉」仍是判断，结论：**不投入** |

### 8.1 U-05 复算明细（行跨度，A 级；2026-10-09 随 `view.ts` 行数刷新复算）

`view.ts` 全 1252 行。按成员边界（`grep -nP "^\t(private |public |protected )?(async )?[a-zA-Z]+\s*[(=]"`）复算四个候选簇：

| 簇 | 成员（起始行） | 行跨度（相邻成员起始行之差） |
| --- | --- | --- |
| A 内容重测调度器 | `scheduleContentRemeasure`(346) `flushContentRemeasure`(365) `retryDeferredContentRemeasure`(434) `remeasureSettledContentNodes`(448) `installMathFontsHook`(456) | 346→479 = **133** |
| B 图片尺寸回灌 | `loadMindMapFromFile`(790) `applyPendingImageCorrections`(910) `onEngineReady`(927) | 790→878 = **88**；910→978 = **68**；小计 **156** |
| C 引用更新组合 | `updateReferencesOnRename`(1140) `updateReferencesOnDelete`(1158) | 1140→1179 = **39** |
| D 自动拆分调度 | `scheduleAutoSplitCheck`(1071) `cancelAutoSplitCheck`(1080) | 1071→1090 = **19** |

四簇行跨度合计 = **347 行**（占 1252 行的 28%）；上一版（1250 行基准）为 337 行——差额全部来自 C 簇（引用更新组合在本轮工作树中 +10 行）。

**这是上界，不是「可下沉量」**：B 簇含 `loadMindMapFromFile`（加载编排，必须留在视图）整段 88 行，A 簇含若干方法签名与守卫。若只计「被指认为可下沉的块」（如 `loadMindMapFromFile` 内的图片探测块 `:831-855` 约 25 行 + 两个独立小方法），量级降至约 **284 行**（= 347 − 88 + 25，沿用上一版同一算法）。原方案文档里的「约 310 行」是子代理估算（**B 级**），现已被本表替换为可复算的数字。

**但「是否该下沉」是判断，不是测量**：这些方法大量读写 `view.ts` 的**私有会话/代际状态**（实测 **21 个私有字段**，见 S-05），下沉必须先搬状态与守卫（`loadingFilePath` 代际、`pendingInitRaf`、`contentRemeasureNodes`、`deferredContent*`）。在编排层无直测的前提下搬运状态，风险高于收益 ⇒ **维持「不投入」**（对应 OPT-02 已排除）。

---

## §9 相关文件

- 架构与豁免理由：`docs/agents/architecture.md`
- 引擎补丁与性能实测账本：`vendor/BUILD.md`
- 测试分层与 CI：`docs/agents/testing.md`
