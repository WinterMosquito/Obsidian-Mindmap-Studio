# 流程与合规（详录）

> 本文件由 AGENTS.md 迁出（2026-10-04 瘦身）。AGENTS.md 只保留硬规则、决策表、命令与索引；
> 本文是**详录**，改代码前按需查阅，改约定时**同步更新 AGENTS.md 索引**。

## 新增功能检查清单

按以下顺序自检（先官方 API，再自研；先收口，再实现）：

1. **落层与模块粒度**：纯逻辑（无 obsidian / 引擎依赖）→ `domain/`；通用机制与共享词汇（常量/文案/错误/并发/事件/持久化/黏合类型）→ `core/`；链接与文件解析 → `links/`；Markdown 解析/序列化/打开/拆分 → `markdown/`；图片与附件 → `media/`；引擎封装与主题 → `engine/`；Obsidian 平台集成 → `platform/`；弹窗 → `ui/`；视图服务 → `services/`；UI 特性与视图控制器 → `features/`；入口与装配 → 组合根（`main.ts`/`commands.ts`/`settings.ts`/`creation.ts`）。新逻辑优先并入最贴近的已有模块；跨组复用先查许可集与已有收口点，勿造第二份；确需新建文件时按模块化四边界自检（单一职责 / 分层单向 / 收口唯一 / 窄接口，见 K50），依赖矩阵由 eslint zone 强制（见 K51）。
2. **收口**：是否触碰引擎内部形态？只允许经 `mindmap.ts` / `services/engine-controller.ts` 具名函数；库内文件解析走 `links-resolve.resolvePathToFile`；并发原语走 `concurrency.ts`；DOM/事件监听走 `this.register*` / `EventBinder`；URL 形态判断走 `domain/url.ts`（背景见 K25 / K28 / K29）。
3. **官方优先**：面向 Obsidian 的能力先对照官方 `obsidian.d.ts` 与帮助文档；官方缺口才允许私有触点，且必须防御式实现并在本文件登记（见 K39）。
4. **测试**：新增 `tests/*.test.ts`（纯逻辑直测；引擎运行时 DOM 装配类行为交 `verify:visual`）；同步本文件「代码结构」两份清单——`agents-md-sync` 测试会强制。
5. **校验链**（顺序执行，全绿才提交）：`npm run build`（tsc 检查 src+tests）→ `npm test` → `npm run lint`（须在插件根 cwd，见 K43）→ `npm run lint:css`（改过 `styles.css` 必跑，见「测试与 CI」的 CSS 检查段）→ `npm run check:release`（改过 `manifest.json` / `versions.json` / README / `LICENSE*` 时必跑；含 License 缺失=error、非 OSI=warn，见 K109）→ 新增/删除导出或文件时加 `npm run check:dead-code`（见 K57）→ 涉及渲染/DOM 装配时加 `npm run verify:visual` → **改过 `vendor/upstream/` 或 `vendor/patches/` 时加 `npm run build:vendor` 重打包，并同步 `vendor/BUILD.md` 与 `tests/vendor-contract.test.ts` 两处 sha256 常量（见 K73）**。
6. **超限登记**：新增文件超 300 行 → 在「文件规模与豁免」表登记理由。
7. **声明式设置/版本**：改 `minAppVersion` 或给声明式设置新增键 → 人工核对对应 `@since`（lint 盲区，见 K41）。

## AGENTS.md 维护规则（本文件）

- **同步义务**：新增/删除/重命名 `src/**/*.ts`、`tests/**/*.ts` 文件时，必须同步「代码结构」两份清单——`tests/agents-md-sync.test.ts` 会强制（漏登记即红灯）。
- **编号规则**：K 编号一经分配**永不复用、不重编号**（删除条目时编号留空；新增条目追加到所属组末尾）；交叉引用一律写「见 K n」，勿用「见下条」这类相对指代。
- **写法约定**：条目结论先行（一句可独立理解的话打头），再展开依据与边界；跨文件规则留在本文件，**文件级实现细节写进源码文件头契约**（范例：`src/markdown/links-split.ts`），本文件只留指针。
- **去重**：同一事实只在最权威的一处展开，其余位置改为「见 K n」引用（反面教材：`isDesktopOnly` 的复述曾散落两处）。
- **事实陈述**：涉及官方行为 / 工具链行为的断言写明依据（官方 d.ts 版本、帮助文档路径、规则实现文件、负向自检结果），便于日后复核与失效检测。

## 发布流程

1. 更新 `manifest.json` 版本号 → `npm version patch|minor|major`（同步 `versions.json`）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`，以及 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md`（`.github/workflows/release.yml` 自动构建并创建草稿 Release；许可声明必须随副本分发，见 K84）。
4. 新增版本补 `docs/release-notes-<tag>.md`（中英双语）——`release.yml` 取该文件作 Release 说明，缺失则回退自动生成。

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
