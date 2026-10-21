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
| 平台 | Windows win32，PowerShell 7 + Git Bash **5.3.15**（须写全路径 `& 'C:\Program Files\Git\bin\bash.exe' -lc '…'`；裸 `bash` 命中 WindowsApps 的 WSL 别名） | `Get-Command bash -All`；`C:\Program Files\Git\bin\bash.exe -lc 'echo $BASH_VERSION'` |
| Node | v24.22.0 | `node -v` |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`（无头 `--headless=old`） | `scripts/verify-visual.mjs:281` 的 `findChrome()` |
| 库（实机） | **`D:\Obsidian\Mindmap测试仓库`**（vault 名 = 目录名；2026-10-20 复测库）；§7 的 2026-10-07 台账仍在旧库 `C:\Users\LEGION\OneDrive\Obsidian\Mindmap` | `obsidian vault="Mindmap测试仓库" eval code="app.vault.getName()"` |
| 记录日期 | 2026-10-07（首版）；2026-10-08（第一次全表复测）；2026-10-09（全表复测）；**2026-10-20 全表复测**（§1–§6 全部重跑；§3.2 消融与 §7 实机核销未重测，见各自小节） | - |
| 构建指纹（本次复测） | `main.js` sha256 `787a849a…77677b01`（625,647 B）｜ `vendor/simple-mind-map.cjs` sha256 `85905272…f4a89`（414,469 B，**LF 归一后**；raw 414,572 B） | `sha256sum main.js`；vendor 按 LF 归一后计算（`check-env.ps1` 同口径） |

**读数与指纹的绑定关系（重要）**：上表指纹是本次复测所用构建。**§1–§6 的数字均由各自「复现命令」在该构建上实测**；§5 的实机读数同在**该构建**上重测（三件套已复制到 `D:\Obsidian\Mindmap测试仓库\.obsidian\plugins\mindmap-studio\` 并 `obsidian vault="Mindmap测试仓库" plugin:reload id=mindmap-studio`，`dev:errors` 无报错），**窗口可见**（实测 `document.hidden === false`，无 rAF 垫片）；§3.2 消融、§7 实机核销与 §8.1 行跨度未随本次复测（原因见各自小节）。

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
| G-03 | 单测 | **82 文件 / 2219 用例**全通过（2026-10-21 复测） | `npx vitest run` |
| G-04 | 死代码 | `KNIP_EXIT=0` | `npm run check:dead-code` |
| G-05 | 文档同步契约 | 4 passed | `npx vitest run tests/agents-md-sync.test.ts` |
| G-06 | 渲染契约（无头 Chrome） | `✓ 视觉验证通过`（15 场景 / 19 探针；2026-10-21 复测） | `npm run verify:visual -- --require-chrome` |

---

## §2 打开性能基线（实测 · 无头 Chrome）

命令：`npm run verify:visual -- --require-chrome --bench-open`
（各规模 **2 次取最小**；同页同 bundle，仅节点数不同）

| 节点数 | 打开墙钟 | 相对同轮 500 基准 | 构造期 | 渲染 `.smm-node` | 自绘锚点 | 截断 | 剪枝命中 | 内部节点 | 预测量 built/visited | 正式测量缓存命中 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | **478 ms** | +0 ms | 0 ms | 24 | 2 | 0 | 23 | 371/500 | 475/500 | 475/475（100%） |
| 5000 | **800 ms** | +323 ms | 0 ms | **15** | 1 | 0 | 117 | 3701/5000 | 4750/5000 | **4750/4750（100%）** |
| 10000 | **1140 ms** | +663 ms | 0 ms | **15** | 1 | 0 | 217 | 7401/10000 | 9500/10000 | **9500/9500（100%）** |

（各规模仍为 2 次取最小。探针在 500 行也会输出「自绘锚点 / 截断」两列，故如实填入。**2026-10-20 读数 478/800/1140 ms** 较 2026-10-09 的 386/687/1039 ms 整体上移 **+24 % / +16 % / +10 %**，但 **DOM 与内部节点计数逐列完全一致**（24/15/15、371/3701/7401、475/4750/9500、缓存命中 100 %）——差异落在机器负载侧，不构成代码回归判定。）

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
| P-01 | 发布产物 | **627,228 B**（2026-10-21 复测） | `ls -l main.js` |
| P-02 | gzip 后 | **184,743 B**（2026-10-21 复测） | `gzip -c main.js \| wc -c` |
| P-03 | vendor 源文件 | **414,469 B**（LF 归一；raw 414,572 B） | `ls -l vendor/simple-mind-map.cjs`；LF 归一后计字节 |
| P-04 | **gzip 分组占比**（消融实测，见 §3.2） | vendor **117,526 B（66.9%）** / 自有（含 i18n）**58,179 B（33.1%）**（**2026-10-09 消融读数，2026-10-20 未重测**） | 消融构建 + `gzip -c \| wc -c` |

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
| `vendor/simple-mind-map.cjs` | 1 | **414,028** | **66.29 %** |
| `src/`（插件自有） | 91 | **210,571** | **33.71 %** |
| 合计 | 92 | 624,599 | 100 % |

`src/` 内 Top10（bytesInOutput）：

| 字节 | 文件 | 备注 |
| --- | --- | --- |
| **26,363** | `src/core/i18n.ts` | 自有第一大项（占总包 4.2%），192 键 × ZH/EN 双语纯词表 |
| 10,305 | `src/features/view.ts` | 编排壳 |
| 9,252 | `src/markdown/md-serialize.ts` | 往返双向实现之一 |
| 9,215 | `src/markdown/md-outline.ts` | 往返双向实现之二 |
| 6,761 | `src/services/engine-controller.ts` | 引擎防腐收口（services 侧） |
| 6,473 | `src/engine/mindmap-viewport.ts` | 画布几何与视口防腐面 |
| 6,250 | `src/features/node-inline-html.ts` | 段序列 → HTML 装配 |
| 5,861 | `src/features/node-inline-tokenize.ts` | 段序列切分（纯逻辑） |
| 5,588 | `src/platform/math-jax.ts` | 数学渲染通道 |
| 5,400 | `src/features/view-node-actions.ts` | 节点操作共用入口 |

**口径说明（两条都要读）**：归因构建产物 **625,514 B** 与发布产物 **625,647 B** 相差 **133 B**，等于 `esbuild.config.mjs:5-9` 的 banner 长度，归因因此有效；而 `bytesInOutput` 合计 **624,599 B** 与产物文件 625,514 B 相差 **915 B**，是 **esbuild 运行时/CJS 包装**未归属到任何输入的固定开销（两轮读数下该差值不变）。两者不可混用为同一口径。

**结论**：体积约三分之二来自 vendor，故显著降体积必须动 vendor，而 vendor 改动会触发 AGENTS.md 硬规则 3 的双 sha256 同步（`vendor/BUILD.md:32` + `tests/vendor-contract.test.ts`）。自有侧唯一大项 `i18n.ts` 无法用 `import()` 拆包（Obsidian 插件为单文件产物）。

### 3.2 gzip 分组占比（消融实测，2026-10-09；**2026-10-20 未重测**）

> 本节数字基于 2026-10-09 的 598,694 B 归因构建。2026-10-20 归因产物已变为 **625,514 B**（§3.1），**未重跑消融**（需两次单变量构建 + 两个桩文件），故边际贡献比例不随本轮刷新；引用时须与 §3.1 的基准分开读。

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
| S-02 | `as unknown as` | **34**（`engine/` 层占 23，其中 `mindmap-viewport.ts` 9、`mindmap-nodes.ts` 8） | `grep -rho "as unknown as" src --include=*.ts \| wc -l` |
| S-03 | 分支密度 Top5 | `mindmap-viewport.ts` 151、`md-serialize.ts` 149、`md-outline.ts` 101、`math-jax.ts` 90、`node-inline-tokenize.ts` 73 | `grep -oE "if\|for\|while\|catch" <file> \| wc -l`（**逐文件**统计、按计数降序取 5；该正则含标识符内出现，如 `verify` 里的 `if`，故只作横向排序口径） |
| S-04 | features 横向 import | **58**（总 86 边，`view-context` 21 + `view-common` 7 除外），`view-node-actions` 被 6 处依赖 | `grep -rhoP "from './[a-z-]+'" src/features` |
| S-05 | `view.ts` 规模 | **1149** 行 / 17 自有方法 / **17** 私有字段 / 41 import（2026-10-21 复测行数） | `awk 'END{print NR}' src/features/view.ts`；`grep -cP "^\t[a-zA-Z]+\(" …`；`grep -cP "^\tprivate [a-zA-Z]+[?!]?\s*[:=]" …`；`grep -c "^import" …` |
| S-06 | 超过 300 行的文件 | **28**（2026-10-21 实测；与 AGENTS.md 豁免表、`docs/agents/architecture.md` 同表**逐行一致**） | 逐文件 `awk 'END{print NR}'`；或 `npx vitest run tests/agents-md-sync.test.ts` |
| S-07 | `addEventListener` 出现 | **31** 处 | `grep -rno "addEventListener" src --include=*.ts \| wc -l` |
| S-08 | `console.` 调用 | **87** 处 | `grep -rno "console\." src --include=*.ts \| wc -l` |
| S-09 | src / tests 规模 | **94 文件 28,758 行 / 84 文件 41,126 行**（2026-10-21 复测；行数按 `countSourceLines`——直接 `wc -l` 会少 1～4 行，来自末尾无换行的文件） | `find src -name "*.ts" \| wc -l`（文件数）；行数用 `countSourceLines` 口径 |
| S-10 | i18n 键 | ZH **203** / EN **203**（对齐；2026-10-21 复测） | 统计 `src/core/i18n.ts` 两段字面量键（`^\t'` 行；ZH 段以 `} as const;` 收尾、EN 段以 `};` 收尾，**按段切分**，勿用单一结束标记） |
| S-11 | 设置 | 接口 **12** 项声明 / `DEFAULT_SETTINGS` **12** 键 / 面板走 `getSettingDefinitions()`（2026-10-21 复测；边框与配色已改为按文件记，`defaultThemeStyle` 只提供新建时的初始值） | 取 `export interface MindMapStudioSettings` 与 `DEFAULT_SETTINGS` 两段内的字段行（文件为 CRLF，行尾 `\r` 需先剥离） |
| S-12 | **循环依赖**（§4.1） | **编译期与运行时均为 0 个环**；**94** 文件 / **450** 条 src 内部依赖边（其中仅类型边 **93** 条；2026-10-21 复测，口径同 §4.1） | 自建 Tarjan 检测脚本（见 §4.1 口径与盲区） |
| S-13 | **圈复杂度**（§4.2） | ≥9 共 **81** 个函数；≥15 共 30；≥20 共 15；≥30 共 5（2026-10-20 读数，2026-10-21 未重测） | ESLint Node API 覆盖 `complexity` 规则（CLI `--rule` 在 flat config 下已不可用，见 §4.2） |

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

规模：**94** 文件 / **450** 条 src 内部依赖边（其中仅类型边 **93** 条；2026-10-21 复测）。另有 **10 处**指向 `vendor/simple-mind-map.cjs` 的跨出边（**10 个文件**：`engine/` 层 9 个 + `core/engine-types.ts` 的 type-only），**不计入 src 图**（2026-10-20 实测；2026-09 那一轮为 28 处 / 27 文件，engine 层拆分为 8 个子模块后被收拢）。

**检测器盲区已逐一核实**：`src/` 内**无**无 `from` 的副作用导入、**无**动态 `import(`；`export * from` 现有 **5 处**（全部在 `engine/mindmap.ts` 的 barrel），**已按边计入**整图，故 DAG 结论仍可靠。

### 4.2 圈复杂度（实测）

命令（**2026-10-20 修正**：ESLint 9 + flat config 下 CLI `--rule` 已移除，实测报 `Value for 'rule' of type 'Object' required`）：

```js
// scripts 内临时探针，零配置改动；用 ESLint Node API 覆盖 rule
const eslint = new ESLint({ overrideConfig: { rules: { complexity: ['warn', 8] } } })
const results = await eslint.lintFiles(['src'])   // 取 message 中 "complexity of N"
```

（**注意**：ESLint 9 已移除 `-f compact`；用它会让计数恒为 0 而误判为「无超限函数」。)

分布（阈值 8 下的超限函数）：

| 阈值 | ≥9 | ≥10 | ≥12 | ≥15 | ≥20 | ≥25 | ≥30 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 函数数 | **81** | 68 | 49 | 30 | 15 | 8 | 5 |

Top 5：

| 复杂度 | 位置 | 函数 |
| --- | --- | --- |
| 37 | `src/markdown/md-outline.ts:390` | `buildInlineData` |
| 36 | `src/links/links-resolve.ts:176` | `resolveDroppedFile` |
| 35 | `src/markdown/md-serialize.ts:71` | `renderHyperlink` |
| 33 | `src/features/node-inline-tokenize.ts:285` | `splitMarkedText` |
| 31 | `src/markdown/md-serialize.ts:546` | `rawOk` |

按文件聚合 Top3：`md-serialize.ts` 12 个（max 35）、`engine/mindmap-viewport.ts` 7 个（max 16）、`md-outline.ts` 6 个（max 37）。

**读法**：高复杂度集中在 **Markdown 往返层**——正是 `AGENTS.md` 明确的「不可拆分、必须共享同一套规则」的两个文件。故这些高值属**刻意设计的不可约复杂度**，缓解手段是性质测试（项目已有 fast-check 往返性质）而非拆分。**不应**据此拆文件。

---

## §5 实机渲染规模（实测 · Obsidian CLI）

夹具（2026-10-20 定版）：`fixtures/bench/realistic-5000.md` —— **239,462 B / 5,006 行 / sha256 `e29f50a9…0dd8f`**；口径 **5,000 节点**（不含根）／深 8／783 长文本／225 wikilink。**唯一重建命令**：

```bash
node scripts/gen-perf-fixture.mjs --out "<vault>/fixtures/bench/realistic-5000.md"   # seed 20261005
```

**夹具治理（2026-10-20 决策）**：库内旧副本（5,004 行 / 239,460 B / sha `03adc54b…`）**未删除，已改名归档**为 `realistic-5000.legacy-2026-10-20.md`；当前 `realistic-5000.md` 已由生成器重建（指纹见上）。规则：**每次测量前先跑生成器并核对 sha**，库内文件只是缓存，指纹不符即重建——不再接受「就地编辑夹具后继续测」（2026-10-09 与 2026-10-20 两次漂移同源）。

**测量环境（必须与读数一起读）**：2026-10-20 复测时 Obsidian **窗口可见**（实测 `document.hidden === false`），**无 rAF 垫片**；容器 `1315 × 1027`。读数经 `obsidian vault="Mindmap测试仓库" eval` 读画布 DOM（`view.containerEl`，注意本版本 `contentEl` 为空）。端点 B 等渐进渲染停增（连续两次读数相同，实测约 2 分钟）。

**读数由「当前视口」决定（2026-10-08 复测确认的口径）**：性能模式生效时剪枝是「**节点移出画布即摘 DOM**」（引擎 `opt.performanceConfig.removeNodeWhenOutCanvas = true`），而视口变换按文件持久化在 `data.json`，故同一文件在不同会话下 DOM 规模可从「只渲染视口内十几个节点」到「全量 5002 个」——**任何回归比对都必须先说明视口状态**。下表两列即实测的两个端点（本轮两端点均可**按命令复现**）：

| 指标ID | 指标 | 端点 A：初始默认视口 | 端点 B：fit 后（scale 触下限） |
| --- | --- | --- | --- |
| R-01 | 渲染 `.smm-node` / `g` 节点组 | **59 / 64** | **607 / 612** |
| R-02 | 自绘内容 `div`（`.mindmap-node-inline-content`） | **59** | **607** |
| R-03 | 画布 DOM 元素总数 | **590** | **4,049** |
| R-04 | `mindmap-fit-view` 命令耗时（`performance.now` 包裹 `executeCommandById`） | **5.8 / 3.9 / 2.1 ms**（连续 3 次） | 同左（见下） |

**两端点的状态与复现**（2026-10-20 实测；与 2026-10-09 的端点 B **不可直接相减**）：

- 端点 A：`data.json` 中该文件无 `viewState` 条目时首次打开 ⇒ 默认视口 `scale 1`，容器 1315×1027 下渲染 **59 / 64 / 59 / 590**。
- 端点 B：执行 `mindmap-studio:mindmap-fit-view` ⇒ **`scale = 0.1`（插件 `LARGE_MAP_MIN_FIT_SCALE` 下限，不是 0.00585）**，故「fit 后全图可见」在当前实现下**不等于全量挂 DOM**：停增后为 **607 / 612 / 607 / 4,049**（间隔 60 s 两次读数相同）。2026-10-09 记录的 5,002/31,877 是**下限引入前**的读数，两轮口径不同。
- R-04 是**同步**耗时（fit 的 DOM 更新走异步渲染）；3 次连续调用 `5.8 / 3.9 / 2.1 ms`，第一次含真转换、后两次近似 no-op。窗口尺寸与视口状态都会改变该值，跨轮只作量级参考。

**跨轮比较规则（2026-10-20 决策）**：§5 读数只在「同一夹具 sha + 同一 `LARGE_MAP_MIN_FIT_SCALE` + 同一窗口尺寸」三者一致时可比；任一变化只作量级参考。历史端点 B（5,002 / 31,877，2026-10-09）标签已更名，检索时勿与当前「fit 后（scale 触下限）」混淆——**不恢复下限前行为**：把 `LARGE_MAP_MIN_FIT_SCALE` 调回 0 会让 5000 节点 fit 到 0.00585，既不可读又触发全量布局（补丁 12 记录的 27.5s 级回归），收益为负。

### 5.2 内存（实测 · CLI 双口径，零代码改动）

命令：`obsidian vault="Mindmap" eval code="…"` 读 `performance.memory` 与 `process.memoryUsage()`。

| 场景 | `performance.memory.usedJSHeapSize` | `process.memoryUsage().rss` |
| --- | --- | --- |
| 空闲（插件 reload 后、无导图视图） | 72,507,209 B（**69.1 MiB**） | 285,241,344 B（**272.0 MiB**） |
| 打开 5000 节点后（端点 B 状态，DOM 607） | 73,740,303 B（**70.3 MiB**） | 289,202,176 B（**275.8 MiB**） |
| detach 全部导图视图后（约 20 s 空闲） | 72,495,167 B（**69.1 MiB**） | 285,241,344 B（**272.0 MiB**） |

（本表 MB 一律为 **MiB**＝字节 ÷ 1024²，与上一版首行口径一致；上一版后两行曾用十进制 MB，故跨轮比较请只认字节数。）

**口径警告（勿误读）**

- **JS 堆增量（第 1→2 行 +1.2 MB，2026-10-20）才是可用于回归比对的数字**；`rss` 在 Electron 里含渲染进程未归还操作系统的分配，**单次读数不可用作阈值**。注意本次第 2 行是**端点 B（DOM 607）**状态，不是全量 DOM —— 与 2026-10-09 的 +14.1 MB（全量 5,002）不同源。
- 测量**未强制 GC**（harness 的 `--expose-gc` 未接入）；采样为单次，非取最小。
- 该口径是 **Obsidian 实机渲染进程**，与 §2 的无头 Chrome 不同源，**不可混用**。

**2026-10-20 复测（同一会话、未强制 GC、端点 B 状态 DOM 607）**：第 1→2 行 JS 堆 **+1.2 MB**；第 2→3 行 detach 后 **基本回到空闲水平**（JS 堆 −1.2 MB，rss 持平）——与 2026-10-09 那轮「detach 后反而升高」方向相反，再次印证：单次采样被 GC 时刻主导，**本表读数只能当历史记录，不能用于回归比对**（要用于门槛需配对采样 + 强制 GC 或多次取最小）。

---

## §6 未 await（`void`）调用台账

命令：`grep -rnP "\bvoid [a-zA-Z_(]" src --include=*.ts`
命中 **43 行**（2026-10-20），其中 **4 行为注释**（`core/persistence.ts:13`、`features/view-image-actions.ts:51`、`features/view-node-actions.ts:516`、`markdown/md-open.ts:52`，后三处是显式声明「调用方以 `void …` 调用」的约定注释），**真实调用点 39 处**。

| 类别 | 数量 | 依据 |
| --- | --- | --- |
| 链尾显式 `.catch` | **6** | `node-inline-editor.ts:365`、`view-dnd.ts:81`、`view.ts:593`、`main.ts:493`、`platform/mindmap-auto-open.ts:142`、`platform/system-open.ts:21` |
| 被调方内部 try/catch 兜底 | **32** | 主群：`commands.ts:106/122/190/208/249`（`createNewMindMap` / `exportImage` / `declareAndOpenAsMindMap` 内部 try）、`main.ts:227/326/330/376/393/445`（同上 + `flushNow` / `saveSettings` 经注入 writer 吞错）、`view.ts:716/968`、`view-context-menu.ts:199/226/250` 与 `view-toolbar.ts:83/86/165`（`addLinkToActiveNode` / `addImageToActiveNode` 自兜）、`view-paste.ts:27/52`、`view-title-renamer.ts:43`、`view-clipboard.ts:80/191`、`node-codeblock.ts:194`（`copyText` 返回布尔）、`measure-cache.ts:140`、`math-jax.ts:589/926`、`prism-code.ts:395`、`document-service.ts:152`、`view-state.ts:195`、`ui/modal-image.ts:101` |
| **真实缺口（官方 Promise 无兜底）** | **1** | `features/view-link-navigator.ts:91`（2026-10-09 发现，至今未处置），见下 |

**真实缺口 1 处（2026-10-09 复测发现，待处置）**

| 位置 | 表达式 | 分析 |
| --- | --- | --- |
| `src/features/view-link-navigator.ts:91` | `void host.app.workspace.openLinkText(...)` | 官方契约 `openLinkText(linktext, sourcePath, newLeaf?, openViewState?): Promise<void>`（`obsidian.d.ts:7914`，`@since 0.16.0`）。`openResolvedTarget()` 内**无 try**，其上游 `openHyperlink()` 同步返回 `void`，**接不住这个 Promise** ⇒ 未处理拒绝。 |

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

> **2026-10-21 增补**：连线样式已收敛为**两态**（`straight` 折线 / `curve` 曲线，默认折线；`auto` /
> `direct` 下线）——上表「4 种连线样式」是 10-07 的历史读数，现况以 README 设置表与 K16 为准。

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

> **2026-10-15 订正，行号已失效（勿据上表直接定位）**：A 簇（内容重测调度器）已于
> 2026-10-11 **外置**为 `features/content-remeasure.ts`——`scheduleContentRemeasure` /
> `flushContentRemeasure` / `retryDeferredContentRemeasure` / `remeasureSettledContentNodes` /
> `installMathFontsHook` 在 `view.ts` 中**已不存在**（同名能力见 `content-remeasure.ts`），
> 故上表 A 簇行号与「346→479」跨度只反映 2026-10-09 那一份 `view.ts`；B/C/D 三簇行号亦
> 随其后各批改动前移。U-05 的**结论不变**（不投入），但如需复算，请以当前
> `view.ts`（1137 行）与 `content-remeasure.ts`（502 行）为对象重跑同一算法。
>
> **2026-10-20 复核**：当前 `view.ts` **1131 行**（S-05）、`content-remeasure.ts` **502 行**；A 簇仍在
> `content-remeasure.ts` 内，B/C/D 三簇行号随各批改动再次前移。U-05 结论（**不投入**）不变，本表
> 四簇的行号自 2026-10-09 起即仅作历史记录。

**这是上界，不是「可下沉量」**：B 簇含 `loadMindMapFromFile`（加载编排，必须留在视图）整段 88 行，A 簇含若干方法签名与守卫。若只计「被指认为可下沉的块」（如 `loadMindMapFromFile` 内的图片探测块 `:831-855` 约 25 行 + 两个独立小方法），量级降至约 **284 行**（= 347 − 88 + 25，沿用上一版同一算法）。原方案文档里的「约 310 行」是子代理估算（**B 级**），现已被本表替换为可复算的数字。

**但「是否该下沉」是判断，不是测量**：这些方法大量读写 `view.ts` 的**私有会话/代际状态**（实测 **21 个私有字段**，见 S-05），下沉必须先搬状态与守卫（`loadingFilePath` 代际、`pendingInitRaf`、`contentRemeasureNodes`、`deferredContent*`）。在编排层无直测的前提下搬运状态，风险高于收益 ⇒ **维持「不投入」**（对应 OPT-02 已排除）。

---

## §9 相关文件

- 架构与豁免理由：`docs/agents/architecture.md`
- 引擎补丁与性能实测账本：`vendor/BUILD.md`
- 测试分层与 CI：`docs/agents/testing.md`
