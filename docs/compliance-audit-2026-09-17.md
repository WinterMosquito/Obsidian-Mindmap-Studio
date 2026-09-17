# MindMap Studio 合规审计报告

**审计日期**：2026-09-17
**审计对象**：`D:\Obsidian\Mindmap-Studio`（`id: mindmap-studio`，`version: 0.1.2`，`minAppVersion: 1.13.0`，`isDesktopOnly: true`）
**审计依据**：Obsidian Developer Policies、Submission requirements for plugins、Reference/Manifest、`obsidian-sample-plugin`（模板 + AGENTS.md）、`eslint-plugin-obsidianmd`、`obsidianmd/obsidian-workflows@v1`、`obsidian` 类型定义（1.13.2）与 `obsidian-help`。

> **范围声明**：审计阶段为**只读**（未修改 `Mindmap-Studio` 任何文件）。审计完成后按用户决策实施了 **P0 + P1 + P2** 的修复——改动清单、验证证据与两处被实测推翻的假设见 **§8 修复记录**；P3 未实施。审计过程曾另产出一份 API 维度子报告，已按用户决策删除（其结论已并入本报告 §0/§1）。**本报告正文（§0–§7）保留审计当时的判定与证据，未按修复结果改写。**

---

## 0. 基线与参照物核实

| 项目 | 事实 |
|---|---|
| 参照 `eslint-plugin-master` | `eslint-plugin-obsidianmd` **0.4.2** |
| 插件已安装同包 | **0.4.2** —— **与官方同版**，lint 基线不缺版本 |
| 参照 `obsidian-api-master` | `obsidian` **1.13.2** |
| 插件已安装 types | **1.13.1**（`package.json` 声明 `^1.13.1`） |
| 参照 `obsidian-workflows-main` | **1.0.0** = 官方 Action `obsidianmd/obsidian-workflows@v1`（当前目录校验 oracle） |
| `obsidian-sample-plugin-master` | 1.0.0 |

**基线实测（我本人执行）**

- **`npm run lint` 当前为红灯**：`node "node_modules\eslint\bin\eslint.js" . --max-warnings 0` → **1 error**
  `src/features/node-inline-content.ts:462` `@typescript-eslint/no-unnecessary-type-assertion`
- **测试全绿**：`node "node_modules\vitest\vitest.mjs" run` → **48 test files / 1539 tests 全通过**，exit 0。

**一处参照物信息已过期（影响审计锚点）**

`obsidian-sample-plugin-master\AGENTS.md` 把 `https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml` 称为「canonical requirements」。经核实该文件**已不存在**：`obsidian-releases` 的 `.github/workflows/` 下只有 `mirror-community-json.yml` 与 `plugin-stat.yml`。因此本次审计以**本地已有的** `eslint-plugin-obsidianmd@0.4.2`（目录 scanner 实际使用的规则集）与 `obsidian-workflows@v1`（目录 Action 的检查矩阵）为合规 oracle。

---

## 1. 判定摘要（分级）

| # | 级别 | 判定 | 一句话结论 |
|---|---|---|---|
| **V1** | **P0 阻断** | **lint 红灯** | 官方规则集报 1 error，与本仓库 CI（`--max-warnings 0`）直接冲突 |
| **V2** | **P1 高** | **第三方许可声明未随分发产物** | `main.js` 72.3% 是 MIT/BSD 第三方代码，却**零版权/许可声明**；`LICENSE` 与 `THIRD-PARTY-NOTICES.md` **不在** release 资产 |
| **V3** | P2 中 | 视图注册/清理不对称 | `MindMapView.onOpen` 注册 3 项，`onClose` 未 `unregister`（卸载安全，重开有累积风险） |
| **V4** | P2 中 | 引擎层 4 处裸定时器无取消 | `engine/mindmap.ts:838/864/866/1486`，视图关闭后可能在途 |
| **V5** | P2 中 | 无 stylelint 护栏 | `styles.css` 不受任何样式规则约束，而官方 release 模式强制跑 scanner stylelint（**当前文件本身干净**） |
| **V6** | P2 中 | `versions.json` 无校验 | 官方该检查为 **error** 级；本仓库 `globalIgnores` 显式排除之 |
| **V7** | P2 中 | release 门禁弱于 PR 门禁 | tag push 不触发 `lint.yml`；`release.yml` 只 build，不 lint/test |
| **V8** | P2 中 | vendor 产物来源未钉住且不可重建 | 无 sha256 锚点、`entry.mjs` 不在库、重建需联网 |
| **V15** | P2 中 | 模块边界块**整体替换** `no-restricted-imports` | 官方该规则上的 7 条依赖禁令在 `src/**` **全部丢失**（详见 4.1） |
| **V16** | P2 中 | domain 零依赖边界不拦裸包名 | 且 `no-nodejs-modules` 因 `isDesktopOnly: true` 被官方判为 **off** → `src/domain/` 内 `import fs from 'node:fs'` 可静默通过（详见 4.1） |
| **V17** | P2 中 | `no-unsupported-api` 在非仓库根 cwd 下**整条静默关闭** | `manifest.ts:12` 按 **cwd** 读 `manifest.json`，读失败即 `return {}`；并同时产生 `require` 假阳性（详见 4.2） |
| **V9** | P3 低 | `shell.openPath` 失败信号被丢弃 | Electron 该 API 失败时 resolve 错误串而非 reject，当前 `void` 丢弃 → 静默失败 |
| **V10** | P3 低 | `engines.node: ">=18"` 三方不一致 | knip 需 `^20.19.0 \|\| >=22.12.0`；CI 矩阵 `[22,24]`；官方下限 20 → 声明从未被测 |
| **V11** | P3 低 | knip 闸门未生效 | `lint.yml` 的 knip 步骤只在工作树、`knip.json` 未跟踪 → 文档所述闸门实际不跑 |
| **V12** | P3 低 | release-notes 时序无强制 | 文件不在被打 tag 的提交上则静默回落 `--generate-notes`（0.1.1 已实际发生） |
| **V13** | P3 低 | `0.1.2` **确认未打 tag**（本地与远端皆无） | `manifest`/`package`/`versions` 均为 0.1.2（`HEAD` 处亦然），但 `git tag -l` 与 `git ls-remote --tags origin` **都只到 `0.1.1`** ⇒ `release.yml` 从未为 0.1.2 运行 |
| **V14** | P3 低 | 元数据/文档小不一致 | `LICENSE:3` 写 `Winter Mosquito`，`manifest.json:7` 写 `WinterMosquito`；`allowJs: true` 为死配置；`obsidian: ^1.13.1` 相对 `minAppVersion 1.13.0` 有漂移空间 |
| **V18** | P3 低 | 陈旧豁免 + 文档漂移 | `file-lookup.ts` 已无 `getAbstractFileByPath` 调用却仍在豁免清单；AGENTS.md 声称有「system-open 的 require 全局」「modal 豁免」两块，配置里并不存在 |
| **V19** | P3 低 | 模块边界无 catch-all | `'../../src/links/x'` 这类等价写法与 `'../main.js'`（精确串匹配，无扩展名）可绕过 |

### 明确判定为 PASS 的面（零违规）

| 面 | 证据 |
|---|---|
| **manifest schema** | 必填 7 键齐备、类型正确、无多余键、无重复键；`id` 不含 `obsidian`；`name`/`description`/`id` 均不含禁用词 `obsidian`/`plugin` |
| **description 格式** | 173 字符 ≤250、首字母大写、以 `.` 结尾、字符集 `^[A-Za-z0-9\s.,!?'"-]+$` 纯净、无 emoji |
| **`fundingUrl`** | 未提供（不接受捐赠即应移除）→ 正确 |
| **`versions.json`** | 8 键（0.0.1…0.1.2）全 semver，最新键 == `manifest.version` == `package.json` version，值均 `1.13.0` == `minAppVersion` |
| **LICENSE** | MIT（OSI 认可）；版权行 `Copyright (C) 2026 by Winter Mosquito` 匹配官方 `validate-license` 正则；holder ≠ `Dynalist Inc.`；年份未过期 |
| **README** | 存在（17,131 B）、非空、相对链接（`assets/mindmap.png`、`docs/markdown-mindmap-standard.md`、`vendor/THIRD-PARTY-NOTICES.md`）均可解析 |
| **`@since` 超前** | **零命中**。d.ts 中所有 `@since > 1.13.0` 的面（`SettingSecretControl` 1.13.2；`DisplayValueComponent`/`addDisplayValue`/`SettingDefinitionGroup.search`/`displayValue`·`status`/`displayFormat` 1.13.1）均未使用 |
| **废弃 API** | **零命中**。13 处 `@deprecated` 逐一核验；且主动规避废弃的 `SettingTab.display()`（`settings.ts:207-210`） |
| **命令 ID** | `src/commands.ts:22-31` 全部命令 ID **不含插件 ID** `mindmap-studio` |
| **示例代码** | `src/` 无残留示例代码 |
| **客户端遥测** | 无 `telemetry`/`analytics`/`sendBeacon`/`WebSocket`/`EventSource` |
| **插件自更新** | 无（`autoUpdate*` 命中均为「自动更新链接」业务逻辑） |
| **网络使用** | `src/` 无 `requestUrl`/`fetch(`/`XMLHttpRequest`；仅 SVG 命名空间常量 |
| **混淆代码** | `esbuild.config.mjs` 与官方模板**逐字节相同**（含 `minify: prod`）→ 模板既定立场，非违规；且仓库公开源码 + release 带 `actions/attest@v4` 构建证明 |
| **构建产物未入库** | `main.js` 被 `.gitignore:19` 忽略、`git log -- main.js` 为空（**从未提交**）；README 的「not committed to the repo」**属实** |
| **release 资产集合** | `main.js` + `manifest.json` + 条件化 `styles.css`（`release.yml:67-71`），与官方 `createDraftRelease` 资产集**完全一致** |
| **tag ↔ manifest 一致性** | `release.yml:26-33` **硬失败**（`exit 1`）——**强于**官方 Action（官方仅 warning） |
| **attestation / draft** | `actions/attest@v4` provenance + `--draft`，与官方一致；attestation 失败即中断，更严 |
| **构建可复现性** | `package-lock.json` 在库、`esbuild` 精确锁 0.25.5、构建链完全离线、无平台相关步骤 |
| **内联 lint 抑制** | `src/` **零** `eslint-disable`（仅 `tests/concurrency.test.ts:272` 一处）；**零** `@ts-expect-error`/`@ts-ignore`/`@ts-nocheck`；**零** `as any` |

---

## 2. P0 —— lint 红灯（必修）

**证据**

```
node "node_modules\eslint\bin\eslint.js" . --max-warnings 0
→ src/features/node-inline-content.ts
  462:17  error  This assertion is unnecessary...  @typescript-eslint/no-unnecessary-type-assertion
→ 1 problem (1 error, 0 warnings)
```

**根因**：该行是

```ts
const oldest = segmentCache.keys().next().value as string | undefined;
```

460–461 行注释称「Map 迭代器 `.next().value` 在类型检查下被推定为 `any`，显式收窄以满足官方 no-unsafe-* 规则」。**该理由已过期**：当前 TS lib 下 `IteratorResult<string, undefined>` 已使 `.next().value` 本身即为 `string | undefined`，断言变成多余。

**修复**（删断言 + 清理过期注释）

```ts
const oldest = segmentCache.keys().next().value;
```

**为何是 P0**：`eslint-plugin-obsidianmd` 的规则集**就是目录 scanner 使用的规则集**，而本仓库 `package.json:14` 为 `eslint . --max-warnings 0`（更严）。当前状态意味着**本仓库自己的 CI 是红的**，且提交时目录侧同样会看到这条 error。

---

## 3. P1 —— 第三方许可声明未随分发产物（官方政策义务）

**证据（我本人用绝对路径逐项计数，非推断）**

| 文件 | 体积 | `@license` | `@preserve` | `Copyright` | MIT 同意条款 | BSD 同意条款 | `/*!` |
|---|---|---|---|---|---|---|---|
| `main.js` | 562,560 B | **0** | **0** | **0** | **0** | **0** | **0** |
| `vendor/simple-mind-map.cjs` | 406,580 B | **0** | — | **0** | **0** | — | — |

- `vendor/THIRD-PARTY-NOTICES.md` 列出**引擎本体 + 8 个实际入包依赖**（`@svgdotjs/svg.js` MIT、`katex` MIT、**`quill` BSD-3-Clause**、`mdast-util-from-markdown` MIT、`deepmerge` MIT、`eventemitter3` MIT、`xml-js` MIT、`uuid` MIT）。
- **该文件自身承认了这个缺口**（`THIRD-PARTY-NOTICES.md:36-40`）：
  > 「上游 `simple-mind-map` 以压缩产物分发，未携带逐文件版权横幅；自 2026-09 起 `BUILD.md` 的重建命令已追加 `--legal-comments=inline`，**重新打包时**会把各依赖的许可注释内联进产物……现有 `vendor/simple-mind-map.cjs`（406,580 B）为追加该参数**之前**的产物，故以本文件承担同样的声明作用。」
- **而该文件并不随发布分发**：`release.yml:67-71` 的 release 资产只有 `main.js`、`manifest.json`、条件化 `styles.css`。`THIRD-PARTY-NOTICES.md` 与 `LICENSE` **都不在其中**。
- `vendor/simple-mind-map.cjs ÷ main.js` = **72.3%** 的出货体积是这份预压缩 CJS 产物。

**违反的条款**

- Developer Policies：**「你使用任何代码都必须遵守其原始许可，必要时在 README 中署名。」**
- MIT 许可正文：版权声明与本许可声明**应包含于本软件的所有副本或实质性部分中**。`main.js` 是「实质性部分」的副本，但**不含任何声明**。
- BSD-3-Clause（`quill`）同义。

**补充风险**：`esbuild.config.mjs` 未设 `legalComments`。esbuild 默认 `eof` 会**搬移** legal comments 到文件尾部；若将来 vendor 内联了注释，`minify: prod` 下不能保证它们活着进入 `main.js`。

**修复（三步，任一步都能实质缓解；建议全做）**

1. **按 `vendor/BUILD.md:12` 既定配方重建 vendor 产物**（含 `--legal-comments=inline`）——这是项目自己已经写好的正确做法，只是尚未执行。
2. **在 `esbuild.config.mjs` 显式声明** `legalComments: 'inline'`（或 `'eof'`），确保注释能穿过再打包与 `minify: prod`。
3. **把 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md` 加入 `release.yml` 的发布资产**（`:67-71` 的 `gh release create` 文件列表）。这是成本最低、覆盖最完整的一步——即使 vendor 产物暂不重建，声明也随之分发。

---

## 4. P2 —— 工程与生命周期缺口

### V3 视图注册/清理不对称

- `features/view.ts` 的 `onOpen`（:338-382）注册三项：`app.workspace.on('css-change')`（:360）、`registerHotkeys` 的 9 个 `scope.register`（:365）、`registerDomEvent(containerEl.win, 'paste')`（:371）。
- `onClose`（:776-806）只做 `viewEvents.destroy()` + `engine.destroyInstance()`，**没有 `this.unregister(...)`**。
- `Component.registerEvent` 的清理时机是 **Component 卸载**（d.ts:1886 "detached when unloading"），**不是 `onClose`**。
- 对照：插件级注册**全部有清扫机制**（`open-as-restore.ts:63-69` 三档 `setTimeout` **逐档**注册 `clearTimeout`，是典范；`plugin.registerEvent`/`registerView`/`addCommand`/`addSettingTab`/`registerHoverLinkSource` 均齐备；`onunload`（`main.ts:244-260`）显式清理 `fileLookupIndex.invalidate()`、`viewState.flushNow()`、设置防抖落盘、`statusBarEl = null`）。

**结论**：**插件卸载是安全的**（官方「unloads safely」要求已满足）。风险仅在**同一 View 实例经历多次「关闭→重开」**时这些监听与热键逐次叠加（`paste` 虽被 `getActiveViewOfType(MindMapView) !== this` 早退兜住，功能不错乱但白做 N 次）。

**不确定性（须实测）**：Obsidian 是否复用 View 实例。若每次重开都是新实例，本条降为「无害的冗余」。建议在同一导图标签多次关闭/重开后检查监听计数确认。

**修复**：`onClose` 中 `this.unregister(...)`；保存 `scope.register` 返回的 `KeymapEventHandler` 后 `scope.unregister(handler)`（d.ts:5550/5555），或置 `this.scope = null` 让下次 `onOpen` 重建干净 Scope。

### V4 引擎层裸定时器无取消

- `engine/mindmap.ts:838`（延时 `fitMindMap`）、`:864/866`（`waitRenderRootThenArrange` 轮询，有上限 `RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS`）、`:1486`（`startNodeTextEdit` 延后 `emit('node_dblclick')`，0ms，风险低）。
- 对照正面样板：`services/engine-controller.ts` 的 `viewportTimer`（:358）/`recenterTimer`（:600）均由 `cancelViewportTimer`（:412）/`cancelRecenterTimer`（:420）在 `destroyInstance()`（:387-395）清理；`ResizeObserver` 三路径 `disconnect()` 且在 :235 兜底。
- 其余定时器已核验对称（`view.ts:390/399`、`view.ts:669/678`、`images-path.ts:251/306/314`、`core/concurrency.ts`）。

**修复**：对 `mindmap.ts` 这 4 处引入与 `engine-controller.ts` 同款的取消钩子。

### V5 无 stylelint 护栏（**当前文件本身干净**）

- 官方在 **release 模式强制**跑 scanner stylelint（`obsidian-workflows/src/lint.ts:565`，目标 `**/*.css`，ruleset 见 `lint.ts:10-123`）；本仓库无 stylelint 依赖、无 `.stylelintrc`。
- **但 `styles.css` 实测干净**：我在确认 grep 可见该文件（`mindmap-` 命中 68 处）后，对 scanner ruleset 的关键规则逐项计数 —— `!important`、`url(`、`:has(`、`@import`、命名颜色、`all:` **全部 0 命中**。
- 其中**唯一的 error 级规则**是 `function-url-scheme-disallowed-list`（禁止 `url()` 内 `http`/`https`/`file`，只允许 `data:`）—— 该项目零 `url()`，**通过**。

**结论**：这是**护栏缺口而非当前违规**。修复：把 `lint.ts:10-123` 的 ruleset 复刻为仓库内 `.stylelintrc.json`（`browsers` 由 `minAppVersion 1.13.0` 经 `lint.ts:126-160` 推导 → `electron >= 39`），并在 `lint.yml` 加一步 `npx stylelint "**/*.css"`。

### V6 `versions.json` 无校验

- 官方：JSON 非法或非对象 = **error**（`obsidian-workflows/src/manifest.ts:206-222`），会阻断官方 release。
- 本仓库：`eslint.config.mts:115` **显式排除** `versions.json` → 无任何替代检查。
- 后果：一旦被写成数组或语法损坏，本仓库 CI 全绿而目录校验直接失败。
- 修复：加一步 `node -e "const v=require('./versions.json');if(typeof v!=='object'||Array.isArray(v))process.exit(1)"`。

### V7 release 门禁弱于 PR 门禁

- `lint.yml:3-7` 的 `on.push.branches: ['**']` **不匹配 tag push** → 打 tag 时该工作流不运行。
- `release.yml:36-38` 只跑 `npm ci && npm run build`，**没有** test / lint / knip / verify:visual / scanner lint。
- 后果：测试或 lint 全红的提交，只要 build 过且 tag 与 manifest 相等，就能推出版本。
- 修复：在 `release.yml` 的 build **之前**插入 `uses: obsidianmd/obsidian-workflows@v1` + `with: { mode: pr, scanner-lint: 'true' }`。**务必用 `mode: pr`** —— `mode: release` 会自行创建 draft release，与 `release.yml:67` 的 `gh release create` 形成两个 draft。

### V8 vendor 产物来源未钉住且不可重建

- 在 `vendor/BUILD.md`、`vendor/THIRD-PARTY-NOTICES.md`、`README.md` 中搜索 `sha256`/40 位十六进制 → **0 命中**；`simple-mind-map` 也不在 `package.json` 任何依赖字段。
- `BUILD.md:12` 的重建配方依赖 `entry.mjs` —— **仓库中不存在**；目标版本 `0.14.0-fix.3` 只写在散文里；重建第 2 步 `npm install <版本> --no-save` **需要联网**。
- 实测锚点（可供登记）：`vendor/simple-mind-map.cjs` SHA256 = `A97B0CAAB190F14E9F814ECBD932DAC186780537949AFE65F95AA2C4AE1B8382`（406,580 B）。
- 现有 `tests/vendor-contract.test.ts` 只钉住导出面/原型/命令名/事件名/内部字段这层 **API 面**，无法发现文件被替换。
- **注意**：这**不影响插件构建的可复现性**（vendor 产物已入库、构建链完全离线），只影响引擎升级路径能否被第三方独立重放。
- 修复：把 sha256 与版本约束登记进 `BUILD.md` 和 `tests/vendor-contract.test.ts`；提交 `entry.mjs` 与封装脚本。

---

### 4.1 V15/V16 —— ESLint 配置层的规则回退

**V15：模块边界块整体替换了 `no-restricted-imports`，官方 7 条依赖禁令在 `src/**` 丢失**

- 官方在 `eslint-plugin-obsidianmd` 的 `lib/index.ts:202` 以 `["warn", ...restrictedImportsOptions]` 配置该规则，禁止 `axios` / `superagent` / `got` / `ofetch` / `ky` / `node-fetch` / `moment`。
- 本项目在 `eslint.config.mts:69`（9 个 `boundary()` 块）与 `:184-198`（domain 块）用 `['error', { patterns }]` 配置**同一规则**。ESLint 的规则配置是**替换而非合并** → `src/**` 全部文件丢失上述 7 条禁令。
- **当前不是现行违规**：已 grep 确认 `src/` 无这些 import。
- 危害：这条禁令正是官方用来防「把重型 HTTP 客户端 / moment 打进插件」的，而本插件的 `minify: prod` 会让这类依赖**静默膨胀出货体积**（现 `main.js` 已有 72.3% 是 vendor）。
- 修复：在各块的 `patterns` 中**追加**官方那组 group（而非另起一条配置），保留 `allowTypeImports: true`。

**V16：domain 零依赖边界不拦裸包名，且 Node 内置模块规则被官方关闭**

- `eslint.config.mts:184-198` 的 domain 块只列两组 pattern：`['..','../*','../**']` 与 `['obsidian','obsidian/*']`。**不拦裸包名**（`import _ from 'lodash'`、`import fs from 'node:fs'`、`import axios from 'axios'`）。
- 本应由 `obsidianmd/no-nodejs-modules` 兜住，但该规则在 `manifest.json` 的 `isDesktopOnly: true` 时被官方**判为 off**（`lib/index.ts:215-216`）。
- 结果：`src/domain/` 中 `import fs from 'node:fs'` 可**静默通过 lint**，而 AGENTS.md 对 domain 的承诺是「零依赖：lint `no-restricted-imports` 强制禁 obsidian/上层/vendor」——**承诺强于实现**。
- 实测旁证：`src/domain/` 现仅 2 处相对导入且均在 domain 内，无裸包名 → **当前干净**。
- 修复：domain 块补一条覆盖裸包名的约束（如 `group: ['*', 'node:*']` 的收窄版）。

### 4.2 V17 —— `no-unsupported-api` 的非仓库根 cwd 静默失效

- 该规则有两道前置条件：① `lib/manifest.ts:12` 用 `fs.readFileSync("manifest.json")` 读 **cwd**；② `noUnsupportedApi.ts:322-330` 在 program 中找 `/obsidian/obsidian.d.ts`。
- 在**仓库根**跑 `npm run lint` 时两者都满足 → 规则**确实在工作**（经核实不是静默 no-op）。
- 但任何**非仓库根 cwd**（编辑器 ESLint 集成、从 `D:\Obsidian` 直接跑 eslint）→ manifest 读失败 → `resolvedVersion` 为 undefined → 规则 **`return {}` 整条关闭**；同时 `no-nodejs-modules` 从 off 翻成 warn、`globals.node` 消失 → `src/platform/system-open.ts:23,48` 的裸 `require` 反被 `no-undef` 报出（**假阳性**）。
- **危害**：本报告「零 `@since` 超前」的结论**不是 lint 保证的**（它来自 d.ts 全量逐符号核验）。若未来引入 `Setting.addDisplayValue`（1.13.1）或 `SettingSecretControl`（1.13.2），lint 很可能不报错。
- 修复（硬编码，不依赖 cwd）：`'obsidianmd/no-unsupported-api': ['error', { minAppVersion: '1.13.0' }]`（options 优先于 manifest，见 `noUnsupportedApi.ts:54-55`）。

### 4.3 与社区 scanner 的严格度对照（核实结论）

scanner（`obsidian-workflows`）用 `npx --prefix <tmp> eslint --config <tmp>/eslint.config.scanner.mjs .`（`src/lint.ts:523-542`）**完全绕过**插件自身的 `eslint.config.mts`；它装 `eslint-plugin-obsidianmd@0.4.1`（比本地 0.4.2 **旧**），有 tsconfig 时用 `toWarns` 把几乎所有 error 降成 warn，且 **warning 永不失败**。

**结论：本地 `eslint . --max-warnings 0` 在规则集、严重度、文件覆盖三方面都 ≥ scanner，不存在「scanner 会报而本地放过」的 ESLint 项。唯一 scanner 有而本地完全没有的检查是 stylelint** —— 这与 §4 的 V5 相互印证：**V5 是本项目对目录口径的唯一实质盲点**。

### 4.4 参照物侧发现的两个上游缺陷（非本插件问题，供参考）

1. **`no-prototype-builtins` 拼写错误**：官方 `lib/index.ts:189` 把它拼成 `no-prototype-bultins`；ESLint 对值为 `"off"` 的规则跳过校验，于是该 off **从未生效**，`no-prototype-builtins` 仍由 `js.configs.recommended` 保持 error。本仓库 `src/` 无 `hasOwnProperty` 调用 → 无实害。
2. **官方 `plainTextParser` 在 CRLF 检出下静默失效**：官方 `plainTextParser.ts:15/26` 只按 `\n` 切分、保留行尾 `\r`，而 `validate-license` 的正则 `(.+)$` 中 `.` 不匹配 `\r` → 版权行规则**静默失效**。本项目 `scripts/plain-text-parser.mjs` **剥离 `\r`** 的加固是**正确且必要**的（这是对官方实现的修正，不是偏离）。



## 5. P3 —— 改进建议

| # | 项 | 位置 | 建议 |
|---|---|---|---|
| V9 | `shell.openPath` 失败静默 | `platform/system-open.ts:27/52` | Electron 该 API 失败时 **resolve 错误字符串而非 reject**；当前 `void` 丢弃 → 「无关联应用」时用户拿不到提示。改 `const err = await shell.openPath(p); if (err) new Notice(...)` |
| V10 | `engines` 三方不一致 | `package.json:24-26` vs `lint.yml:16` vs knip | knip 需 `^20.19.0 \|\| >=22.12.0`；CI 矩阵 `[22.x,24.x]`；官方下限 20。声明 `>=18` 从未被任何矩阵验证。改 `>=22.12`，或保留 `>=18` 但注明「仅指运行时插件需求，非开发工具链需求」并把 20.x 加回矩阵 |
| V11 | knip 闸门未生效 | `lint.yml`（工作树版） / `knip.json` | knip 步骤**只存在于工作树**（HEAD 无），且 `knip.json` **未被 git 跟踪** → 文档（AGENTS.md）把它当既有闸门与实际不符。一并提交两者 |
| V12 | release-notes 静默回退 | `release.yml:60-65` | `docs/release-notes-0.1.1.md` 由 `431cd02` 创建，而 tag `0.1.1` 指向更早的 `e4f9802` → 该次发布必然走了 `--generate-notes`。把 notes 纳入 bump 提交（`package.json:13` 的 `git add` 加 `docs/`），或在 `else` 分支加 `::warning::` |
| V13 | `0.1.2` **确认未打 tag** | — | **2026-09-17 已定论**：`git tag -l` 与 `git ls-remote --tags origin` **两侧都只到 `0.1.1`**；而 0.1.2 的 bump 提交 `43b186e "chore(release): 0.1.2"` 已在 `origin/main`（本地 main 领先其 5 个提交、落后 0）。⇒ 该版本已 bump 但从未进入 `release.yml`（按 tag 触发），故**没有 draft release、也未发布**——尽管 `docs/release-notes-0.1.2.md` 已写好。补打时**不带 `v` 前缀**（现存 7 个 tag 实测均无前缀，`.npmrc:1` 的 `tag-version-prefix=""` 已保证）。**顺序警告**：必须先提交工作树改动再打 tag——`HEAD` 处的 `release.yml` **不含** `LICENSE` / `THIRD-PARTY-NOTICES.md` 资产，`lint.yml` 也**不含**新增校验步骤；此时打 tag 会以**旧工作流**构建，发布产物仍缺许可声明（正是 V2 要修的缺口） |
| V14a | LICENSE 持有人写法不一致 | `LICENSE:3` vs `manifest.json:7` | `Winter Mosquito`（带空格）vs `WinterMosquito`。无规则要求一致，但同一主体两种写法易引起归属歧义，建议统一 |
| V14b | `allowJs: true` 死配置 | `tsconfig.json:17` | `include` 无任何 JS glob。实测 `allowJs` 真假都解析到 `vendor/simple-mind-map.d.cts`。建议删除（要真检查 JS 则补 `checkJs: true` 并显式纳入） |
| V14c | types 版本漂移空间 | `package.json:41` | `obsidian: "^1.13.1"` 而 `minAppVersion: 1.13.0`。`no-unsupported-api` 的可见版本上沿 = 安装的 typings 版本，一次 `npm install` 可能推前判定基准（规则会兜住）。建议改 `~1.13.1` |
| V14d | 上游 CSS 断言不可验证 | `vendor/BUILD.md:25-35` | 断言「上游 dist CSS 100% 是 Quill 样式」不可复现（`scripts/sync-vendor-css.mjs` 已不存在）。可确证的部分：`main.js` 含 `createElement("style")`/`document.head`，`src/` 无 `createEl('style')` → 引擎样式确在运行时注入，故不分发上游 CSS 是正当的。建议登记上游 CSS 的字节数与 hash |
| V14e | `version-bump.mjs` 共有缺陷 | `version-bump.mjs:3` | 直接 `node version-bump.mjs`（不经 `npm version`）时 `targetVersion` 为 `undefined` → manifest 会丢失 `version` 键、`versions.json` 多出 `"undefined"` 键。加 `if (!targetVersion) throw new Error('run via npm version')` |
| V14f | 工作树未提交状态 | — | 77 个已跟踪文件被修改（**已排除换行符成因**：`core.autocrlf=false` 下仍是 77）+ 16 个未跟踪文件。若准备提交，需先落盘；否则 CI 构建的代码与你本地不一致 |
| V15 | `no-restricted-imports` 被替换 | `eslint.config.mts:69`、`:184-198` | 见 §4.1：官方 7 条依赖禁令在 `src/**` 丢失。在各块 `patterns` 中追加官方那组 group |
| V16 | domain 不拦裸包名 | `eslint.config.mts:184-198` | 见 §4.1：补一条覆盖裸包名/`node:*` 的约束 |
| V17 | `no-unsupported-api` 依赖 cwd | `eslint.config.mts` | 见 §4.2：改为 `['error', { minAppVersion: '1.13.0' }]` |
| V18 | 陈旧豁免 + 文档漂移 | `eslint.config.mts:208`、AGENTS.md | 移除 `file-lookup.ts` 的陈旧豁免；修正 AGENTS.md 对「require 全局」「modal 豁免」的记载 |
| V19 | 边界无 catch-all | `eslint.config.mts:42-72` | 补 catch-all 或禁止等价相对写法 |

---

## 6. 值得记录的强项（相对官方模板的加固）

这些不是违规，而是**超出模板**的部分，审计中一并核实：

1. **tag ↔ manifest 版本硬校验**（`release.yml:26-33`）——官方 Action 只给 warning 后照样发 draft。
2. **release 显式支持双语发布说明**（`release.yml:60-65`）——官方 `createDraftRelease`（`release.ts:236-248`）完全不处理 notes。
3. **attestation 失败即中断**——官方降级为 warning 并继续发布。
4. **`--max-warnings 0`** 把 warning 级规则提升为失败；且显式把 `manifest.json` 与 `LICENSE` 纳入 lint（官方 recommended 不自动拾取），并自备等价 plain-text parser（并有**有意差异**：剥离行尾 `\r`，以在 `core.autocrlf=true` 下让版权行正则真正生效——这是对官方实现的**修正**）。
5. **`src/` 零内联 lint 抑制**（**零** `eslint-disable`、**零** `@ts-expect-error`/`@ts-ignore`/`@ts-nocheck`、**零** `as any`）；且配置级用 `off` 而非注释关闭 `no-explicit-any`，因为 recommended 的 `eslint-comments/no-restricted-disable` **禁止**用 disable 关掉该规则。
6. **`as unknown as` 共 28 处，其中 21 处是已收口且已登记豁免的引擎私有面**；Obsidian 内部 API 仅 6 处，全部防御式访问（特性检测 + try/catch + 官方默认值回落 + 文件头自述）。
7. **未使用任何 `@since > 1.13.0` 的 API** —— `minAppVersion: 1.13.0` 与实际使用面**完全对齐**。
8. **模块依赖矩阵 + domain 零依赖边界**由 lint 机械强制（`eslint.config.mts:74-102`、`:177-200`）。
9. **`onLayoutReady` 不可注销**的处理正确：用 `private unloaded` 守卫早退（`main.ts:214-220`），这是当前 API 下唯一正确写法。
10. **`Notice`/`Modal` 契约正确**：13 处 `Notice` 构造即用、不手动 `hide()`；5 个弹窗统一经 `createModalSettle()` 用官方 `Modal.setCloseCallback` 兜底，**不覆写 `onClose`**。
11. **构建可复现**：依赖锁定 + 输入闭包全部在库 + 无平台相关步骤 + 构建链离线。
12. **`vendor/` 文档质量高于社区常见水平**：`BUILD.md`（来源定性、9 条 fix 清单、升级流程、插件侧接缝、历史登记）+ `THIRD-PARTY-NOTICES.md`（引擎本体 + 8 个实际入包依赖的版本与许可），且与 `main.js` 内嵌的上游包元数据**逐项吻合**。

---

## 7. 修复优先级建议

**提交前必须（P0/P1）**

1. 删 `src/features/node-inline-content.ts:462` 的多余断言 + 清理 460–461 行过期注释 → 恢复 lint 全绿。
2. 落实第三方许可声明：把 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md` 加入 `release.yml` 发布资产；并按 `BUILD.md` 配方重建 vendor 产物（含 `--legal-comments=inline`）+ 在 `esbuild.config.mjs` 设 `legalComments`。

**近期建议（P2）**

3. 补 `.stylelintrc.json`（复刻 `lint.ts:10-123`）+ `lint.yml` 加 `npx stylelint "**/*.css"`。
4. `lint.yml` 加 `versions.json` 形状检查与 `[ -s README.md ]`。
5. `release.yml` 在 build 前插入官方 Action（`mode: pr` + `scanner-lint: 'true'`），补齐 release 门禁。
6. 修 `view.ts` 的 `onClose` 清理对称性（先实测实例复用行为）；给 `mindmap.ts` 4 处定时器加取消。
7. **收回 ESLint 配置层的三处规则回退**（§4.1/§4.2）：把官方那组依赖禁令加回 `no-restricted-imports` 的 `patterns`（V15）；给 domain 补裸包名约束（V16）；把 `no-unsupported-api` 的 `minAppVersion` 硬编码进规则选项，消除 cwd 依赖（V17）。
8. 把 sha256 与版本约束登记进 `vendor/BUILD.md`（V8）。

**按需（P3）**

9. 逐条处理 V9–V14、V18、V19。

---

## 8. 修复记录（2026-09-17，审计后实施）

修复范围＝用户决策的 **P0 + P1 + P2（含 ESLint 配置层三条回退）**；P3 未实施。
全部改动通过：`tsc -noEmit -skipLibCheck`（exit 0）、`eslint . --max-warnings 0`（exit 0）、
`vitest run`（48 文件 / 1539 用例）、`stylelint "**/*.css"`（exit 0）。

| 编号 | 状态 | 改动 | 验证证据 |
|---|---|---|---|
| V1 | 已修 | `src/features/node-inline-content.ts:462` 删除 `as string \| undefined` 多余断言，并改写 460–461 行的过期理由 | 修复前 `eslint . --max-warnings 0` 报 1 error；修复后 exit 0 |
| V2 | 已修 | `release.yml` 的 `gh release create` 资产加入 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md` | 两者均存在（1,096 B / 2,603 B），`gh` 不会因缺文件失败 |
| V3 | 已修 | `src/features/view.ts`：`onOpen` 保存 `css-change` 的 `EventRef` 与 paste 监听器引用；`onClose` 增加对称回收（`offref` + `removeEventListener` + `this.scope = null`） | `tsc` + `eslint` 通过 |
| V4 | 已修 | `src/engine/mindmap.ts` 新增 `engineTimers`（`WeakMap`）+ `scheduleEngineTimer` + `cancelEngineTimers`，3 处延时任务改走登记表；`engine-controller.ts` 的 `destroyInstance()` 调用 `cancelEngineTimers` | 同上 |
| V5 | 已修 | 新增 `stylelint.config.mjs`（规则照抄官方 `src/lint.ts:10-123`；`browsers: ['electron >= 39']` 由 `minAppVersion: 1.13.0` 推得）+ `lint:css` 脚本 + 两个工作流步骤；新增 devDeps `stylelint@^17.15.0`、`stylelint-no-unsupported-browser-features@^8.1.2`（**锁文件已同步**，`npm ci` 仍一致） | `stylelint "**/*.css"` exit 0，印证 §4「文件本身干净」的判定 |
| V6 | 已修 | 新增 `scripts/check-release-metadata.mjs` + `check:release` 脚本，接入两个工作流：`versions.json` 形状与 semver、`manifest.version` 在表内、**当前版本**的值 == `minAppVersion`、README 非空 | 正向 exit 0；四个负向用例（数组 / 缺当前版本 / minAppVersion 不一致 / README 无有效内容）均 exit 1 并给出对应 `::error::` |
| V7 | 已修 | `release.yml` 在构建前新增门禁：`check:release` + `npm test` + `npm run lint` + `npm run lint:css`（tag push **不**触发 `lint.yml`，故须在发布流程内自证） | — |
| V8 | 已修 | `vendor/BUILD.md` 登记产物 sha256；`tests/vendor-contract.test.ts` 新增字节级身份断言（此前所有契约都只钉 API 面，对字节改动无感） | **首次实现有缺陷，被 CI 抓出并已修正**：断言原按**原始字节**取哈希，而本仓库无 `.gitattributes`、检出侧 `core.autocrlf=true` ⇒ 本地工作树是 CRLF+BOM、CI 的 Linux 检出是 LF+BOM，**同一提交的原始字节跨平台不同**（本地 `a97b0caa…` / CI `dca4cead…`），发布工作流被自己的门禁拦下。已改为**按 LF 归一后**计算，登记值 `dca4cead…c898`（= CI 值）。两侧均已实测：本地（CRLF+BOM）与「字节级模拟的 CI 状态（LF+BOM）」下测试均通过 |
| V15 | 已修 | `eslint.config.mts` 新增 `OFFICIAL_RESTRICTED_IMPORT_PATTERNS`（官方 7 个包，文案取自 `eslint-plugin-master/lib/ruleOptions.ts:19-56`），前缀接入 9 个模块边界块与 domain 块 | 负向探针：`axios`、`moment`（值导入）各报一条 |
| V16 | 已修 | domain 块新增裸说明符闭包（**用 `regex` 而非 `group: ['*']`**，理由见下） | 负向探针：`node:fs`、`lodash` 各报一条；`./wikilink` **不报** |
| V17 | 已修 | `eslint.config.mts` 新增 `src/**/*.ts` 块，显式传 `minAppVersion`（值读自 `manifest.json`，不重复字面量） | `tsc` + `eslint` 通过 |

**实施时的连带改动**（由回归测试与文档一致性要求带出，非原报告条目）：

1. **`tests/engine-controller.test.ts` 的 mock 面**：该文件用工厂函数显式 mock 了
   `../src/engine/mindmap`（`vi.mock('../src/engine/mindmap', () => mocks)`）。新增
   `cancelEngineTimers` 后工厂里没有它，于是**每次 `destroyInstance()` 都抛
   「No "cancelEngineTimers" export is defined on the mock」——实测导致 61 个用例同时失败**。
   已在 mock 工厂与 `beforeEach` 的逐项 `mockReset` 列表补上，并在
   「destroyInstance：销毁实例…」用例新增一条断言（销毁时必须以**该实例**调用
   `cancelEngineTimers`）。**教训**：给被 mock 的模块新增导出时，必须同步该模块的 mock 工厂，
   否则失败会以「与被改代码毫无关系的 61 个用例」形式出现，且报错信息指向 mock 而非根因。
2. **`main.js` 已重新构建**（`npm run build`，562,560 → 563,103 B）：本次改动涉及 `src/` 三个
   文件，若不重建，本地 vault 加载的仍是旧产物（`main.js` 被 `.gitignore` 忽略、不进仓库，
   故无 diff）。
3. **`AGENTS.md` 同步五处**，避免本次修复制造新的文档漂移：
   ① 「测试与 CI」的脚本清单与 CI 执行顺序（新增 `lint:css` / `check:release`，并补发部门禁段）；
   ② 新增「CSS 检查」与「发布元数据护栏」两段（含三条维护要点：`minAppVersion` 变更须同步
   `browsers` 基准、`ignoreFiles` 必须排除 `coverage/**`、配置为无 `extends` 的独立配置）；
   ③ **K44 就地更新**——其原文①「阈值取 `options.minAppVersion ?? getManifest()?.minAppVersion`，
   manifest 读不到即关闭」的前提已被 V17 **部分消除**（配置侧显式传参后不再随 cwd 漂移），
   已注明封堵范围、并明确 K43 的其余两条耦合（`no-nodejs-modules` 与 `globals.node`）**未封堵**；
   ④「提交前校验链」补入两个新脚本；
   ⑤ **修正 lint 覆盖段落里的三处不实陈述**（即 V18 所述漂移）：删去并不存在的
   「system-open 的 require 全局」与「modal 豁免」，把 `file-lookup.ts` 标注为**陈旧豁免**，
   并说明 `require` 能通过**只是**因为 `isDesktopOnly: true` 带进了 `globals.node`（cwd 相关）。
4. **`eslint.config.mts` 的 `allowDefaultProject` 增加 `stylelint.config.mjs`**：该文件是项目
   自撰配置（与模板照抄、走 `globalIgnores` 的 `esbuild.config.mjs` / `version-bump.mjs` 不同类），
   纳入 lint 而非忽略；否则 eslint 会以「not found by the project service」直接失败。

**三处被实测推翻的假设**（记录以免后人重踩；前两处由本地负向探针发现，第三处由**首次推送后的 CI** 发现——本地环境无法暴露它）：

1. `patterns` 里的 `group: ['*']` **不能**当「裸包名」闭包——core 的 group 匹配以
   `allowRelativePaths: true` 配置 `ignore`（`eslint/lib/rules/no-restricted-imports.js`），
   会连 `./md-meta` 这类组内相对引用一起命中（曾误报 2 处）。
   已改用 `regex: '^(?!\\.)(?!/)(?!obsidian(?:/|$)).+$'`。
2. 校验 `versions.json` 时**不能**要求「所有版本的值都等于 `minAppVersion`」——历史版本
   可以合法地要求更低的 app 版本；唯一正确的不变式是「**当前**版本的值等于
   `manifest.minAppVersion`」。
3. **对「文本类入库文件」取原始字节哈希，跨平台不可复现**（本地绿、CI 红）。仓库无
   `.gitattributes`，而检出侧 `core.autocrlf=true`：`vendor/simple-mind-map.cjs` 在
   Windows 工作树是 **BOM + CRLF**（406,580 B），在 CI 的 Linux 检出是 **BOM + LF**
   （406,484 B，少 96 个 `\r`），故原始字节哈希必然不同。正确做法是**按 LF 归一后**取哈希。
   两个连带教训：① 用 `ReadAllText` / `WriteAllText` 做「模拟 LF 检出」会**静默吞掉 BOM**
   （差 3 字节：406,481 ≠ 406,484），使模拟失真、结论错误——必须做**字节级**转换；
   ② **不要**为此添加 `vendor/** -text` 之类的 `.gitattributes`：在既有 CRLF 工作副本上，
   它会让下一次 `git add` 把 CRLF 原样写进索引，等于**静默改掉 vendor 产物**。

**仍未实施（P3）**：V9–V14、V18、V19，清单与建议见 §5。

---

## 附：本次审计的证据边界

- **已实测**：lint 与测试基线（本人执行）；`main.js`/`vendor` 的许可声明计数（绝对路径读，计数有效）；`src/` 抑制面计数（含控制组校验：68 个文件中 63 个含 `import`，证明扫描有效）；`styles.css` 的 scanner 规则逐项计数（含控制组：`mindmap-` 命中 68 处）；`manifest.json`/`versions.json`/`LICENSE`/`README` 的格式与一致性；命令 ID；`@since`/`@deprecated` 全量核验；`git ls-files`/`log`/`check-ignore`/`ls-files --eol`。
- **审计当时未能核验、事后已补核**：审计阶段 `git diff` / `git show` / `git tag` 被沙箱拒绝，
  故当时只能由 `release.yml` 的硬校验、`.npmrc` 的 `tag-version-prefix=""` 与
  `docs/release-notes-*` 命名间接推断。**2026-09-17 事后复核**（沙箱策略放宽后
  `git tag -l`、`git for-each-ref`、`git ls-remote --tags origin`、`git cat-file -p HEAD:<path>`
  均可用）：① **「tag 不带 `v` 前缀」已验证 PASS**——远端 7 个 tag 全为 `0.0.1`…`0.1.1`，无前缀；
  ② **V13 已定论**（本地与远端都没有 `0.1.2` tag，见 §5）；
  ③ `HEAD` 处 `manifest.json` 的 `version` 已是 `0.1.2`，但 `HEAD` 处的 `release.yml` 与
  `lint.yml` 仍是本次修复**之前**的版本（§8 的全部改动尚未提交）。
- **属推断而非实测**：V3 的「实例复用导致累积」需在 Obsidian 内实测确认。
- **环境限制（影响复现本报告的命令）**：本沙箱下 `>` 重定向会让原生进程启动失败，`npm.ps1` 不可用（须直调 `node node_modules/...`）；`[System.IO.File]::ReadAllText` 的 cwd 不等于 PowerShell 的 `cd` 结果，读文件须用绝对路径（本次已因此修正过一次无效计数）。
