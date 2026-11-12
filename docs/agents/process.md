# 流程与合规（详录）

> 本文件由 AGENTS.md 迁出（2026-10-04 瘦身）。AGENTS.md 只保留硬规则、决策表、命令与索引；
> 本文是**详录**，改代码前按需查阅，改约定时**同步更新 AGENTS.md 索引**。

## 新增功能检查清单

按以下顺序自检（先官方 API，再自研；先收口，再实现）：

1. **落层与模块粒度**：纯逻辑（无 obsidian / 引擎依赖）→ `domain/`；通用机制与共享词汇（常量/文案/错误/并发/事件/持久化/黏合类型）→ `core/`；链接与文件解析 → `links/`；Markdown 解析/序列化/打开/拆分 → `markdown/`；图片与附件 → `media/`；引擎封装与主题 → `engine/`；Obsidian 平台集成 → `platform/`；弹窗 → `ui/`；视图服务 → `services/`；UI 特性与视图控制器 → `features/`；入口与装配 → 组合根（`main.ts`/`commands.ts`/`settings.ts`/`creation.ts`）。新逻辑优先并入最贴近的已有模块；跨组复用先查许可集与已有收口点，勿造第二份；确需新建文件时按模块化四边界自检（单一职责 / 分层单向 / 收口唯一 / 窄接口，见 K50），依赖矩阵由 eslint zone + 静态依赖图测试双向强制——矩阵唯一定义在 `scripts/module-boundaries.mjs`，`src/` 下新增一级目录（新模块组）必须先在其中定层，否则 `tests/module-boundaries.test.ts` 红灯（见 K51）。
2. **收口**：是否触碰引擎内部形态？只允许经 `mindmap.ts` / `services/engine-controller.ts` 具名函数；库内文件解析走 `links-resolve.resolvePathToFile`；并发原语走 `concurrency.ts`；DOM/事件监听走 `this.register*` / `EventBinder`；URL 形态判断走 `domain/url.ts`（背景见 K25 / K28 / K29）。
3. **官方优先**：面向 Obsidian 的能力先对照官方 `obsidian.d.ts` 与帮助文档；官方缺口才允许私有触点，且必须防御式实现并在本文件登记（见 K39）。
4. **测试**：新增 `tests/*.test.ts`（纯逻辑直测；引擎运行时 DOM 装配类行为交 `verify:visual`）；同步 `AGENTS.md` 的「代码结构」两份清单——`agents-md-sync` 测试会强制。
5. **校验链**（顺序执行，全绿才允许提交；**提交动作本身需用户明确授权**——AI 助手不得自行 `git commit`，改动留在工作区待用户裁决）：`npm run build`（tsc 检查 src+tests）→ `npm test` → `npm run lint`（须在插件根 cwd，见 K43）→ `npm run lint:css`（改过 `styles.css` 必跑，见「测试与 CI」的 CSS 检查段）→ `npm run check:release`（改过 `manifest.json` / `versions.json` / README / `LICENSE*` 时必跑；含 License 缺失=error、非 OSI=warn，见 K109）→ 新增/删除导出或文件时加 `npm run check:dead-code`（见 K57）→ 涉及渲染/DOM 装配时加 `npm run verify:visual` → **改过 `vendor/upstream/` 或 `vendor/patches/` 时加 `npm run build:vendor` 重打包，并同步 `vendor/BUILD.md` 与 `tests/vendor-contract.test.ts` 两处 sha256 常量（见 K73）**。本链的可执行形态＝`npm run check:gates`（按 git 变更集自动算出附加门禁并顺序执行；映射同步于 `scripts/check-gates.mjs`，其映射有直测 `tests/check-gates.test.ts`，速查见 AGENTS.md 常用命令）。
6. **超限登记**：新增文件超 300 行 → 在「文件规模与豁免」表登记理由。
7. **声明式设置/版本**：改 `minAppVersion` 或给声明式设置新增键 → 人工核对对应 `@since`（lint 盲区，见 K41）。

## 文档维护规则与同步义务

**变更 → 文档义务**（`★` ＝ `tests/agents-md-sync.test.ts` 机械强制：漏做是红灯，不靠自觉）：

| 变更类型 | 落到哪份文档 |
|---|---|
| ★ 新增 / 删除 / 重命名 `src/**/*.ts`、`tests/**/*.ts` | `AGENTS.md`「代码结构」两份清单（文件名须以**独立 token**出现） |
| ★ 新增 / 删除 `docs/` 下的文档 | `AGENTS.md` 的 `docs/` 清单（登记了就必须真实存在）+ 本目录 `README.md` 的规模表 |
| ★ 新增 / 删除 K 条目 | `conventions.md` 标题与 `AGENTS.md` docs 清单里的 `K1–K<n>`（＝实际最大编号）；引用一律写「见 K n」，悬空引用红灯 |
| 改硬规则 / 跨文件决策 | `AGENTS.md` 决策表加或改一行（结论）＋ `conventions.md` 所属组末尾加 K 条目（依据 / 边界 / 回归） |
| 改单文件内的实现细节 | 只写该**源文件头契约**，不进 AGENTS.md / conventions（决策表给指针即可） |
| 改 Markdown 往返格式 | `docs/markdown-mindmap-standard.md`（权威）＋ `AGENTS.md` 决策表；历史修订记 `markdown-mindmap-history.md` |
| 改外观预设 / 选项表 / 常量 | `core/constants` 选项表 ＋ `engine/mindmap-theme-presets` 数据表 ＋ i18n 双语 ＋ `AGENTS.md` 决策表 |
| 改 vendor 源码 / 补丁 | `npm run build:vendor` → `vendor/BUILD.md` 的 sha256 与 `tests/vendor-contract.test.ts` 两处常量（`vendor-contract` 强制） |
| 改门禁脚本 / 命令 | `AGENTS.md`「常用命令」＋ `scripts/check-gates.mjs` 的映射（有直测）＋ `testing.md` |
| 新增 / 删除超 300 行文件 | `AGENTS.md` 的「文件规模与豁免」表（**唯一登记处**，理由随行；`architecture.md` 不再复制）；行数用 `npm run check:gates -- --fix-lines` 回填 |
| 发版 | `manifest.json` / `versions.json` / `package-lock.json` ＋ `docs/release-notes-<tag>.md`（中英双语）＋ 标准文档附录的版本指针（`docs-standard` 硬校验） |
| 批次收尾 | `docs/agents/line-count-log.md` 追加一条（行数 / 门禁 / 实机读数；**只追加、不改旧条目**） |

> 本表是「结论该落到哪个文件」的映射；硬规则 6（源文件变更同步索引）与硬规则 10（文件规模只允许收敛）
> 是**结论本身**，两者不是重复。冲突时以 `AGENTS.md` 为准。

## 迁移逻辑的生命周期

一次性数据迁移（旧格式 → 新契约）**必须独立成文件**、集中一处，便于整块删除：

- 文件头写 `【一次性迁移，X.Y.Z 删除】`，版本号即删除点；
- 只做数据改写，不承载长期判定；迁移后不再命中（幂等），**不存「已迁移」标记**，删除时无残留状态；
- **默认在下一个大版本删除**：删迁移文件、删 `main.ts` 的调用、删对应测试，并同步 `AGENTS.md` 两处清单；
- 现存条目：`src/platform/legacy-mindmap-migration.ts`（旧六值 → `Mindmap` + `Mindmap Layout`，**0.4.0 删除**）。**只换写法、不造声明**（K187）：没有启用键、或值是 `Markdown` / 未知值的文件一律不碰。

- **同步义务**：见上表带 ★ 的三行（源文件登记 / 文档登记 / K 编号区间）。**别在本文件与 `AGENTS.md` 各写一份细则**——表的唯一性本身就是「去重」这一条的落地。
- **编号规则**：K 编号一经分配**永不复用、不重编号**（删除条目时编号留空；新增条目追加到所属组末尾）；交叉引用一律写「见 K n」，勿用「见下条」这类相对指代。
- **写法约定**：条目结论先行（一句可独立理解的话打头），再展开依据与边界；跨文件规则留在本文件，**文件级实现细节写进源码文件头契约**（范例：`src/markdown/links-split.ts`），本文件只留指针。
- **去重**：同一事实只在最权威的一处展开，其余位置改为「见 K n」引用（反面教材：`isDesktopOnly` 的复述曾散落两处）。
- **事实陈述**：涉及官方行为 / 工具链行为的断言写明依据（官方 d.ts 版本、帮助文档路径、规则实现文件、负向自检结果），便于日后复核与失效检测。

## 发布流程

1. 更新版本号 → `npm version patch|minor|major` 一步做完 `manifest.json` / `package.json` / `versions.json` / **`package-lock.json` 根版本**；**手工改版本号时必须自己补 `package-lock.json`**（漏改不报错，只是 lock 与 `package.json` 不一致——2026-10-13 发布 0.2.1 时实际漏过一次）。**改完版本号还要同步 `docs/markdown-mindmap-standard.md` 附录「核对依据」里的 `manifest.json` 版本指针**——`tests/docs-standard.test.ts` 硬校验它等于 `manifest.version`，漏改即 `npm test` 红灯（2026-10-21 发布 0.2.3 时补记）。
   - **别用 `npm version --dry-run` 预览**：npm 的 dry-run **不阻止生命周期脚本**，`version` 脚本照跑照写盘（2026-11-03 实测：一条 `--dry-run` 把 `package.json` / `manifest.json` / `versions.json` / `package-lock.json` 全改成 0.3.2，`manifest.json` / `versions.json` 还被脚本里的 `git add` 进了索引，只能 `git restore --staged --worktree` 回退）。要预览就跑 `node version-bump.mjs`（它以 `package.json` 为准、不动 package.json）或先 `git stash`。
   - **tag 前缀由 `.npmrc` 保证**：`tag-version-prefix=""` ⇒ `npm version` 打的 tag 不带 `v`，与 `release.yml` 的「tag == `manifest.version`」门禁配套（历史 tag 0.0.1 … 0.3.0 全不带 `v`）。该文件**已入库**，改动它要同批说明；同一文件里另有三条防误设的注释（`ignore-scripts=false` 保住 esbuild 的 postinstall 二进制、`prefer-offline`、`fund=false`）。
   - **Windows 上别用 `npm ci` 复现发布环境**：它在删 `node_modules` 时会走 `trash` 操作并中断（`[safe-delete] … Some operations were aborted`，2026-11-03 实测），留下半残的依赖树；改用 `npm install` 即可（CI 侧是 Linux，`npm ci` 正常）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`，以及 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md`（`.github/workflows/release.yml` 自动构建并创建**草稿** Release——草稿需人工在 GitHub 上 Publish 才对用户可见；许可声明必须随副本分发，见 K84）。
4. 新增版本补 `docs/release-notes-<tag>.md`（中英双语）——`release.yml` 取该文件作 Release 正文，**tag 门禁硬校验其存在**（2026-10-13 起；此前缺失会静默回退 GitHub 自动生成），故该文件必须在打 tag 前入库。
5. **tag 路径的门禁集**（tag push 不触发 `lint.yml`，故 `release.yml` 必须自证）：tag == `manifest.json` 版本 → 发布说明存在 → `check:release` → `test` → `lint` → `lint:css` → `lint:scanner` → `check:dead-code`（2026-10-13 补，此前只有本地链与 `lint.yml` 有）→ `build`。**`verify:visual` 不在发布路径上**（`lint.yml` 里为 `continue-on-error`，Linux 侧稳定性原因见该文件注释）——渲染契约目前只由本地门禁与实机验收兜住，发版前须本地跑一次 `npm run verify:visual -- --require-chrome`。

### 提交信息与 Actions 命名约定

GitHub 的提交列表与 Actions 列表**只显示提交标题 / run 名称**（正文在列表里不展示），故：

- **提交标题极简**，一眼可辨，不留长描述：
  - 发布提交 = **纯版本号**（如 `0.1.5`）；
  - 功能 / 修复 / 加固 = **`K<编号>`**（可跟极短辨识名，如 `K108 编辑通道提交后编排`）；
  - 文档 / 工程 = `docs K109` / `chore K109`。
- 详细说明写在标题下、空行之后的**正文**里；正文可长（列表不显示），标题必须短。
- **Actions 运行名称**由 workflow 的 `run-name` 决定：`release.yml` → 版本号（`${{ github.ref_name }}`），`lint.yml` → 分支名（同表达式）——不再显示提交信息。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
  **该 `true` 是承重的**（豁免了 `md-serialize.ts` 的 lookbehind 正则，见 K42）——改动前必读该条目。
- 分发（release 资产 / BRAT 更新）必须携带 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md`——vendored 代码（约 72%）的许可声明载体，内联注释不可替代（见 K84）。
