# AGENTS.md

## 项目速览

Obsidian 社区插件（TypeScript → esbuild → `main.js`）。把「声明为导图」的 `.md`（**100% 标准 Markdown**：frontmatter 的 `Mindmap: Mindmap`（启用）+ `Mindmap Layout: <布局>` + 标题 + 列表）解析为思维导图，编辑后**无损回写**为 Markdown。

- 标识 `mindmap-studio`，安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`
- 发布产物三件套：`main.js` / `manifest.json` / `styles.css`（`main.js` **不入库**，CI 构建）
- 入口 `src/main.ts`；命令 ID 表 `src/commands.ts`（**发布后永不变更**）；设置 `src/settings.ts`
- 引擎 `vendor/simple-mind-map.cjs` = `simple-mind-map 0.14.0-fix.3`，思绪（sxmind.cn）发布的第三方修订版（fork 自 wanglin2/mind-map 0.14.0）。**不 vendor 其 CSS**——上游 dist CSS 100% 是 Quill 富文本样式（本插件不注册 RichText），引擎样式由 bundle 运行时注入 `document.head`；修订与打包流程见 `vendor/BUILD.md`
- 依赖单向 `domain → core → {links,markdown,media,engine,platform} → {ui,services} → features → 组合根`，由 eslint 强制

## 环境与安装

- Node `>=20`（以 `package.json` 的 `engines` 为准），包管理器 npm，打包器 esbuild
- **终端一律 Git Bash（须写全路径）**：常规命令经 Git Bash 执行，形式为 `& 'C:\Program Files\Git\bin\bash.exe' -lc '…'`（Bash 5.3.15 / MINGW64）。**裸 `bash -lc` 不可用**——本机 PATH 里的 Git 只有 `Git\cmd`（无 `bash.exe`），`bash` 实际命中 `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`（WSL 别名，实测 `$HOME=/home/legion`）。仅当任务确需 Windows 专属能力（注册表、PowerShell 专有 cmdlet）才切 **PowerShell 7+**，并在输出中说明原因（口径与理由见 K125）
- 装依赖 `npm install`｜开发 watch `npm run dev`｜生产构建 `npm run build`
- **内嵌第三方运行时**：除 `vendor/simple-mind-map.cjs` 外，`pele@1.13.0`（Obsidian 阅读视图同款 mermaid 渲染器）作为 **npm 依赖**打进 `main.js`（约 +720 KB，产物 ≈1.42 MB / 1,485,329 B），唯一 import 点是 `src/platform/mermaid.ts`。它**不进 `vendor/`**：vendor 只存「打过补丁 + sha256 契约」的 bundle，npm 依赖走锁版本；升级时核对宿主 `Obsidian/Credits.md` 的 Pele 版本
- **实机验证三步**：① 把 `main.js` + `manifest.json` + `styles.css` 复制到 `<vault>/.obsidian/plugins/mindmap-studio/`；② `obsidian reload`（重载库）——`plugin:reload` 与 `plugin:disable/enable` **都不会**重新 require `main.js`（2026-10-23 实测：onload 探针不触发、导出仍跑旧代码）；③ 启用插件（首次装：重启 Obsidian → 设置 → 第三方插件；自动化：`await app.plugins.enablePlugin('mindmap-studio')`）再等 2–3s，然后看 `obsidian dev:errors`
- ⚠ `reload` 之后插件是**未加载**态（`app.plugins.plugins['mindmap-studio']` 为 `undefined`、命令表为空）。此时 `dev:errors` 是干净的，别把它当成「插件已就绪」
- ⚠ 同一导图文件**允许多个视图并存**（2026-11-09 起为 **Level B**）：同一文件的多个视图共享**一份文档会话**（`services/document-session`：一棵权威树 + 一条撤销时间线 + 一条保存管线），编辑经会话广播到其它视图（不重建引擎），撤销/重做由会话驱动；外部写入放弃陈旧写盘、重载并把草稿留作一条撤销快照。各视图仍有自己的引擎与视口/选中态。自动化脚本连续测多个文件前先 detach 已有的导图 leaf，否则会拿到空视图而误判为缺陷
- ⚠ **引擎初始化排在 `requestAnimationFrame` 里**：Obsidian 窗口被完全遮挡 / 最小化时 `document.visibilityState === 'hidden'`，rAF 不执行 ⇒ 视图正常打开但 `view.mindMap === null`（`loadSession.pendingInitRaf` 非空），而 `dev:errors` **干净**、无任何提示。自动化前先把窗口切到前台并确认 `visibilityState === 'visible'`（Windows：`ShowWindow(SW_RESTORE)` + `SetForegroundWindow`，必要时 `WScript.Shell.AppActivate`；CDP `Page.bringToFront` 对已被遮挡的窗口无效），否则会把「环境不可见」误判成「打开导图不建引擎」的缺陷

## 硬规则（Don't / Do 配对）

**1. 分层单向**

- Don't：跨组 import（例：`features/` 直引引擎内部形态）；Don't 在测试或 lint 配置里另抄一份依赖矩阵
- Do：按许可集；矩阵唯一定义在 `scripts/module-boundaries.mjs`，`eslint.config.mts` 的 9 个边界块 + 组合根禁令（`npm run lint`）与 `tests/module-boundaries.test.ts`（解析后的真实依赖图：组内成环 / 深层路径 / 新组未登记）都从它生成

**2. 引擎访问只走防腐层**

- Don't：在 `features/` 直读 `renderer.*` / `node.group` / `view_data_change` / `doExport`
- Do：经 `engine/mindmap.ts` 的具名函数（该文件是唯一收口面）

**3. vendor 只读**

- Don't：直接编辑 `vendor/simple-mind-map.cjs`
- Do：改 `vendor/patches/` → `npm run build:vendor` → 同步 `vendor/BUILD.md` 与 `tests/vendor-contract.test.ts` 的两处 sha256

**4. Markdown 保真是硬契约**

- Don't：trim 行内空白、丢弃 `---`、合成未编辑行；Don't **只是打开看一眼就写盘**（序列化带规范化，写下即等于重排全文）
- Do：未编辑行**逐字回写**（`mdRaw` 存**未 trim 原文**，`text` 才是 trim 后的显示文本）；纯浏览靠 `SavePipeline.markLoaded` 的加载基线兜住（见 `docs/agents/decisions.md`「写盘时机」与 K156）

**5. 不造第二份判定**

- Don't：另写一份 URL 形态判断 / 双链解析 / 并发原语 / 错误消息格式化
- Do：经 `domain/url.ts`、`domain/wikilink.ts`、`core/concurrency.ts`、`core/errors.ts`

**6. 源文件变更必须同步索引**

- Don't：新增 / 重命名 / 删除 `src/`、`tests/` 文件而不改 `docs/agents/index.md`「代码结构索引」
- Do：同步 `docs/agents/index.md`；漏登记时 `npx vitest run tests/agents-md-sync.test.ts` 红灯并列出文件名。**「改了什么 → 落到哪份文档」的完整映射只有一份**：`docs/agents/process.md` 的「变更 → 文档义务」表

**7. 纯逻辑必须直测**

- Don't：只改实现不补测试
- Do：纯逻辑 → `tests/*.test.ts` 直测；DOM 装配 / 渲染 → `npm run verify:visual`

**8. i18n 双语强制对齐**

- Don't：只加中文词条
- Do：`ZH` 与 `EN` 同时加（`EN: Record<TranslationKey, string>` 在编译期强制）

**9. 官方 API 优先**

- Don't：自研 Obsidian 已有能力
- Do：先查 `obsidian.d.ts` 与官方帮助文档；官方缺口才允许私有触点，且必须防御式实现 + 登记

**10. 文件规模只允许收敛**

- Don't：新增超 300 行文件而不登记
- Do：登记到 `docs/agents/index.md` 的豁免表；**未登记的超限文件数只允许递减**

## 标准工作流

### 新增特性

1. **落层**：查 `docs/agents/decisions.md` 对应决策；新逻辑并入最贴近的已有模块，勿造第二份收口（**新模块组**＝`src/` 下新一级目录，须先在 `scripts/module-boundaries.mjs` 的 `MODULE_GROUPS` + `MODULE_DEPENDENCIES` 定层，否则 `tests/module-boundaries.test.ts` 红灯）
2. **官方优先**：`obsidian.d.ts` + 官方帮助；缺口才允许私有触点
3. **实现**：只触碰 `docs/agents/decisions.md` 指定的收口点
4. **测试**：纯逻辑直测；渲染契约交 `verify:visual`
5. **同步**：更新 `docs/agents/index.md`「代码结构索引」；超 300 行则在同文件登记豁免
6. **校验**（全绿才提交）：一条命令 `npm run check:gates`——按 git 变更集算出附加门禁并顺序执行、首败即停（`--all` 全跑、`--dry-run` 只看计划、`--fix-lines` 回填豁免表行数），顺带核对「未登记超限文件数」（硬规则 10 的机器核对）。固定先跑 `npm run build` → `npm test` → `npm run lint`；改过下列文件的再加对应项：
   - `styles.css` → `npm run lint:css`
   - 导出 / 文件增删 → `npm run check:dead-code`
   - `vendor/` → `npm run build:vendor`
   - 自绘判据 / 节点渲染 / `scripts/verify-visual.mjs` → `npm run verify:visual -- --require-chrome`（2026-10-11：判据从「有链接段才接管」收敛为「段序列非空即接管」，门禁整片转红却没在提交前跑到）
   - `docs/markdown-mindmap-standard.md` → `npx vitest run tests/docs-standard.test.ts`（目录 / 章节摘要 / 指针 / 版本 / 白名单映射）
   - `src/`、`tests/` 的文件清单或豁免表 → `npx vitest run tests/agents-md-sync.test.ts`（漏登记即红；对豁免表只守**漂移阈值**，超限总数只能人工对账）
   - `README*` / `manifest.json` / `versions.json` / `LICENSE*` → `npm run check:release`
     增删门禁须同步 `scripts/check-gates.mjs`（映射由 `tests/check-gates.test.ts` 直测）

### 修改 Markdown 往返格式

1. 解析改 `src/markdown/md-outline.ts`，序列化改 `src/markdown/md-serialize.ts`
2. 同步 `docs/markdown-mindmap-standard.md`（权威标准）
3. `npx vitest run tests/md-roundtrip-property.test.ts`（fast-check 四条性质，含 `T∘T` 不动点）
4. `npx vitest run tests/md-roundtrip.test.ts`

### 发布

见 `docs/agents/process.md`（tag 触发、门禁顺序、发布资产清单、安全合规）

## 常用命令

| 用途                                                          | 命令                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 迭代单测                                                      | `npx vitest run tests/<file>.test.ts`                                                           |
| 往返生成式验证                                                | `npx vitest run tests/md-roundtrip-property.test.ts`                                            |
| 文档同步契约                                                  | `npx vitest run tests/agents-md-sync.test.ts`                                                   |
| 标准文档一致性                                                | `npx vitest run tests/docs-standard.test.ts`                                                    |
| 模块边界（依赖图 / 成环 / 组合根）                            | `npx vitest run tests/module-boundaries.test.ts`                                                |
| 全量测试                                                      | `npm test`                                                                                      |
| 类型 + 构建                                                   | `npm run build`                                                                                 |
| Lint（**含依赖矩阵 + domain 零依赖 + 组合根禁令**）     | `npm run lint`                                                                                  |
| CSS（发布资产）                                               | `npm run lint:css`                                                                              |
| 死代码                                                        | `npm run check:dead-code`                                                                       |
| vendor 契约（两处 sha256 与补丁面一致）                       | `npm run build:vendor -- --check`                                                               |
| 渲染契约（无头 Chrome）                                       | `npm run verify:visual -- --require-chrome`                                                     |
| 打开性能基线（500/5000/10000）                                | `npm run verify:visual -- --require-chrome --bench-open`                                        |
| 发布元数据                                                    | `npm run check:release`                                                                         |
| 变更驱动门禁（按 git 变更集算链执行 + 豁免表行数对账 / 回填） | `npm run check:gates`（`--dry-run` 只看计划；`--all` 全跑；`--fix-lines` 回填豁免表行数） |
| 实机验证                                                      | `obsidian reload`（必须；`plugin:reload` 不重载 `main.js`）→ `obsidian dev:errors`       |

> Lint 必须在**插件根目录**执行（cwd 依赖，见 `docs/agents/conventions.md`）。

## 文档读取与维护

- 文档导航、源码/测试清单、文件规模与豁免统一维护在 [docs/agents/index.md](docs/agents/index.md)。按任务关键词或文件名定位相关段落，**不要求通读索引或详录**。
- 详细实现决策见 [docs/agents/decisions.md](docs/agents/decisions.md)；开始修改相关模块前，查阅该模块对应的决策与 `conventions.md` K 条目。本文硬规则优先，具体行为以决策表及 Markdown 权威标准为准。
- 新增/删除文件、更新行数或实现记录时只更新对应的 `docs/agents/` 文件；**只有固定开发规则或入口流程改变才修改 `AGENTS.md`**。
- 每次修改代码之后所需要维护文档，请你参考 [docs/agents/process.md](docs/agents/process.md) 执行
