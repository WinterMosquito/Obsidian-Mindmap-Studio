# 外部权威源严格检测报告

> 检测对象：`D:\Obsidian\Mindmap-Studio`（唯一可修改目录）
> 检测依据（只读参考）：
> - `D:\Obsidian\obsidian-api-master`（官方 API 类型定义 1.13.2）
> - `D:\Obsidian\eslint-plugin-master`（官方 `eslint-plugin-obsidianmd` 源码 0.4.2）
> - `D:\Obsidian\obsidian-sample-plugin-master`（官方插件模板：构建配置 + 最佳实践 + AGENTS.md）
> - `D:\Obsidian\obsidian-workflows-main`（社区目录官方校验/发布工作流）
> - `D:\Obsidian\obsidian-help-master`（官方帮助文档 + style guide）
> 日期：2026-09-08

---

## 0. 检测方式

五路并行严格检测，每路均要求「证据到行」、禁止臆测：

| 路 | 范围 | 参考源 |
|---|------|--------|
| A | Obsidian API 合规（用了哪些 API、是否有废弃/超版本/不存在、私有触点、manifest 字段） | obsidian-api-master |
| B | 官方 eslint 规则（规则覆盖矩阵、版本一致性、逐规则违规扫描、未覆盖文件、disable 审计） | eslint-plugin-master |
| C | 构建/发布/目录收录（与官方模板差异、发布流水线正确性、catalog 机器校验项、版本一致性、产物卫生） | sample-plugin + workflows |
| D | 用户可见行为与官方帮助文档一致性（嵌入语法/链接别名/拖放/剪贴板/热键/文件改名/开发者政策） | obsidian-help-master |
| E | UI 文案与官方 style guide（双语字符串、术语一致性、设置项、命令名、README 文案） | obsidian-help-master + sample-plugin AGENTS.md |

## 1. 已由主检自行核实的模板级事实

| # | 模板要求（来源） | 仓库现状 | 判定 |
|---|------------------|----------|------|
| 1 | 不得提交构建产物（`obsidian-sample-plugin-master/AGENTS.md` L62：Never commit `main.js`） | `main.js` 在 `.gitignore` 中且未被 git 跟踪；`styles.css` 跟踪（本仓库它是手写源文件 + vendor 段） | ✅ 合规 |
| 2 | 默认本地/离线，不得有隐藏网络调用（模板 AGENTS.md L106-112） | `git grep -E "fetch\(|requestUrl|XMLHttpRequest|WebSocket" -- src` 无命中 | ✅ 合规 |
| 3 | 命令 ID 稳定、不加默认热键（模板 L93、L150） | `src/commands.ts` 8 个命令均有显式 `id`，无 `hotkeys` 字段 | ✅ 合规（ID 前缀不统一：`create-*`/`search-*` vs `mindmap-*`，见 E 路） |
| 4 | 单文件宜 ≤200-300 行（模板 L134） | `src/mindmap.ts` 693、`src/md-outline.ts` 638、`src/features/view.ts` 501、`src/services/engine-controller.ts` 424 行 | ⚠️ 超标（P2 结构项） |
| 5 | 发布工作流与官方模板一致（模板 `.github/workflows/release.yml`） | 本仓库 `release.yml` 与模板逐行一致（tag 触发 → 构建 → 校验 styles → attest → `gh release create --draft`）；`lint.yml` 为模板的超集（Node 22/24 矩阵 + 测试 + 覆盖率 + lint） | ✅ 一致 |
| 6 | 发布 tag 必须等于 `manifest.json` 版本（模板 L98） | 工作流按 `refs/tags/*` 原样建 Release，**未校验 tag == version**；当前 `manifest.json` 0.0.3 / `package.json` 0.0.3 / `versions.json` 最新键 0.0.3 一致 | ⚠️ 缺守卫（见 C 路） |

## 1.5 主检独立发现（参考源直接给出结论）

| # | 来源 | 发现 | 证据 | 判定 |
|---|------|------|------|------|
| 7 | `obsidian-api-master/CHANGELOG.md` v1.5.7 | 官方明确建议用**类型化取文件**替代易混淆的 `getAbstractFileByPath`（原句：*"The `getAbstractFileByPath` has long been a point of confusion for plugin developers… now you can just use `getFileByPath` or `getFolderByPath` to automatically do this check."*） | 仓库 10 处用通用版、**0 处**用类型化版：`creation.ts:74`、`file-lookup.ts:147`、`images-save.ts:149/165`、`links-resolve.ts:42/46/64/81`、`services/document-service.ts:120/141`；其中 4 处为绕过自有 eslint 规则的 `eslint-disable` | ⚠️ 可改进（P2）：`links-resolve`/`file-lookup` 的 5 处可直接换 `getFileByPath` 并删掉 `instanceof TFile` 分支；`images-save.ts:165` 换 `getFolderByPath`；存在性检查 3 处可经 `getFileByPath(x) ?? getFolderByPath(x)` 保持语义 |
| 8 | `obsidian-api-master/CHANGELOG.md` v1.5.11 | 滑块组件 1.5.9 起改为**松手才回调**，需要 `setInstant(true)` 恢复拖动即时更新 | 仓库未用命令式滑块（`grep addSlider` 无命中），设置面板走 1.13+ 声明式 `control.type='slider'`，持久化经防抖写盘 | ✅ 无影响 |
| 9 | 同上 v1.7.2 | 新增 `Plugin#onUserEnable`（用户启用后一次性初始化，优于在 `onload` 里建视图） | 参考 d.ts L5073；仓库视图在 `registerView` + `onOpen` 惰性装配 | ✅ 已符合精神（可选项） |
| 10 | `eslint-plugin-master/README.md` 规则表 + `docs/rules/validate-license.md` | LICENSE 版权行须为插件自有、年份有效 | `LICENSE` 为 MIT + `Copyright (c) 2026 Winter Mosquito`（非模板的 Dynalist 行）；`eslint .` 零问题（validate-license 为 warn 级但未触发） | ✅ 合规 |
| 11 | 规则表 `settings-tab/no-deprecated-display`、`prefer-setting-definitions` | minAppVersion ≥ 1.13.0 且实现 `getSettingDefinitions()` 后不得再留 `display()` | `src/settings.ts:152` 实现 `getSettingDefinitions()`；`:266` 用 `this.update()` 重渲染；无 `display()` 覆盖 | ✅ 合规 |
| 12 | 规则表 `vault/iterate`（warn） | 避免遍历全库文件按路径找文件 | 全库扫描仅 3 处：`file-lookup.ts:83/94`（索引原语本体）、`links-resolve.ts:131`（解析入口）、`modal-link.ts:42-43`（联想候选表）；均非「按路径查文件」；`eslint .` 零警告 | ✅ 合规 |
| 13 | 规则表 `commands/*`（warn 级） | 命令 ID/名称不得含 "command"/插件 ID/插件名；不得给默认热键 | `src/commands.ts` 8 条命令无 `hotkeys`、ID 不含 `mindmap-studio`；名称经 `t()` 间接取文案，**规则无法静态检查**（见 E 路） | ⚠️ 规则盲区（E 路人工核对） |

## 2. A 路：Obsidian API 合规

参照 `obsidian-api-master/obsidian.d.ts`（1.13.2，8498 行）与安装版 1.13.1（8482 行）逐符号核对。

### 2.1 结论（无 P0）

- **零废弃 API**：1.13.2 全文 13 条 `@deprecated` 无一被使用（`setWarning`/`noticeEl`/`PluginSettingTab.display`/`MarkdownRenderer.renderMarkdown`/`Workspace.activeLeaf` 等）。
- **零超版本 API**：所用 API 的最大 `@since` = 1.13.0（`getSettingDefinitions`/`setControlValue`/`update`/`SettingDefinitionItem`），恰好等于 `minAppVersion: 1.13.0`。
- **编译级双向验证**：安装版 1.13.1 下 `tsc -noEmit` 退出 0；以 `paths` 指向 1.13.2 参考后同样退出 0（探针证明映射生效）→ 升级类型定义不新增编译错误。
- **三处私有触点 claim 属实**：1.13.2 中 `fileCreator`/`dragManager`/`openWithDefaultApp`/`showInFolder` 命中数均为 0；`src/**` 无其他私有触点（无 `@ts-ignore`/`@ts-expect-error`/`as any`）。
- **manifest 零问题**：`validate-manifest` 0 警告；`isDesktopOnly: true` 与 `require('electron')`、`Platform.isDesktopApp` 一致。

### 2.2 已修（本轮）

| # | 项 | 修法 |
|---|----|------|
| A1 | P1 在核心视图实例上写自有属性 `_mindMapInjectedMenu`（污染 Obsidian 对象） | `file-creator.ts` 改用模块级 `WeakMap<object, Menu>` 记录注入标记，语义不变（菜单重建 → 引用变化 → 重新注入），不再触碰核心对象 |
| A4 | P2 用未文档化 CSS 类判深色主题 `document.body.hasClass('theme-dark')`（1.13.2 零命中） | `view.ts:135/235` 改官方 `App.isDarkMode()`（@1.10.0） |
| A5 | P2 启动恢复的 3 档定时器卸载后仍执行 | `open-as-restore.ts` 存 `host: Component`，每个 `setTimeout` 经 `host.register(() => clearTimeout(id))` 随组件注销清理 |
| A7 | P2 `trigger('hover-link')` 无类型约束 | 事件名集中为 `constants.ts` 的 `HOVER_LINK_EVENT` |
| A8 | P2 通用 `getAbstractFileByPath`（官方 CHANGELOG v1.5.7 建议类型化） | 10 处全部改为 `getFileByPath`/`getFolderByPath`（含 6 处 `eslint-disable` 一并消除）；4 个测试桩同步补类型化 getter |
| A9 | P2 依赖核心视图类型字符串 `'file-explorer'`/`'markdown'` | 集中为 `constants.ts` 的 `CORE_VIEW_TYPE`（d.ts 无这些常量，一处核对） |
| A12 | P2 `"obsidian": "latest"` 安装漂移 | 固定 `^1.13.1`（npm 上最新发布版本；参考目录 1.13.2 尚未发布，不能固定到 1.13.2） |

### 2.3 保留（有意偏离，已文档化）

私有触点 ①`file-creator` ②`links-resolve` dragManager ③`system-open` `shell.openPath`：官方无等价 API，防御式实现 + try/catch，AGENTS.md 已登记；`system-open` 的 `openPath` 失败串仍被丢弃（低）。视图 scope 抢占 `Mod+F`（核心「搜索当前文件」）与 `Mod+Z/Shift+Z`：属视图内快捷键，非命令默认热键；`Mod+Y` 已按官方 macOS 语义在 macOS 不注册。

## 3. B 路：官方 eslint 规则

B 路子代理中途失败，**由主检接手完成**（依据 `eslint-plugin-master` 的 README 规则表与 `lib/rules/*`）。

| 检查项 | 结果 |
|--------|------|
| 版本一致性 | `node_modules/eslint-plugin-obsidianmd` = 0.4.2 = 参考源码版本 |
| 规则覆盖 | 配置展开 `...obsidianmd.configs.recommended`（自包含 212 条规则，含 39 条 obsidianmd）→ 全部 recommended 规则启用 |
| 源码级抑制 | **0 处** `eslint-disable`（本轮 typed-getter 重构后清零） |
| 死配置 | 已删除 `src/modal-*.ts` 的 `obsidianmd/no-static-styles-assignment: off`——modal 文件已无任何 `.style` 赋值，该 override 是死配置；删除后 `--max-warnings 0` 仍通过 |
| 测试级抑制 | 仅 2 条（`rule-custom-message`、`no-global-this`，均为 Node 测试环境必需，注释说明理由） |
| 门禁强度 | `npm run lint` 改为 `eslint . --max-warnings 0`（原允许警告通过） |
| 未覆盖文件 | `globalIgnores`：`scripts/**`、`vendor/**`、`esbuild.config.mjs`、`version-bump.mjs`、`versions.json`、`main.js`、`package-lock.json`、`tsconfig.json`、`vitest.config.ts`（构建产物/脚本，非插件运行时）；`manifest.json` 与 `LICENSE` 已显式纳入并激活官方校验规则 |
| 规则盲区 | `ui/sentence-case` 与 `commands/*` 只检查**字面量**，本插件文案全部经 `t()` 间接取值 → 静态规则看不到（见 E 路人工核对） |
| 实跑 | `npx eslint . --max-warnings 0` 退出 0、零警告 |

## 4. C 路：构建 / 发布 / 目录收录

参照 `obsidian-sample-plugin-master` 与 `obsidian-workflows-main`（官方目录校验器源码）。

### 4.1 结论（无 P0）

- `release.yml` 与官方模板**逐行相同**；`esbuild.config.mjs` 与模板完全相同；`tsconfig`/`package.json`/`lint.yml`/`.gitignore` 的差异均为合理增强（覆盖 tests 类型检查、Node 22/24 矩阵、测试与覆盖率）。
- 目录收录**机器规则全部通过**：manifest schema/禁词/semver/描述格式/URL、`versions.json`、README 非空、LICENSE 为 MIT（OSI）、Release 三资产齐备。
- **版本五方一致**：`manifest` = `package` = `package-lock` = `versions.json` 最新键 = git tag = GitHub Release，均 `0.0.3`。
- 运行时依赖为空（全部 devDependencies），`package-lock.json` lockfileVersion 3。

### 4.2 已修（本轮）

| # | 项 | 修法 |
|---|----|------|
| C1 | P1 发布不校验 tag 与 `manifest.version`（官方校验器 `release.ts:76-99` 有该检查） | `release.yml` 新增 `Verify tag matches manifest version` 步骤，不一致即 `exit 1` |
| C2 | P1 Release 说明不自动附加（0.0.3 的 3782 字说明为人工补写） | `release.yml` 改为 `--notes-file docs/release-notes-${tag}.md`，文件缺失回退 `--generate-notes` |
| C7 | P2 `vendor/simple-mind-map.cjs` 无版权/许可声明（内含 svg.js/quill/katex 等） | 新增 `vendor/THIRD-PARTY-NOTICES.md`（引擎本体 + 实际打包进产物的 8 个依赖及其许可）；`vendor/BUILD.md` 重打包命令追加 `--legal-comments=inline`，后续重建自动内联许可注释 |

### 4.3 保留 / 待决策

- `AGENTS.md` 称「创建草稿 Release」——`release.yml` 确实带 `--draft`（线上 release 已公开是人工发布所致），**文档与工作流一致**，C 路此项不成立。
- P2：`npm run build` 不重建 `styles.css`（vendor CSS 升级后需手动 `sync-vendor-css`）——AGENTS.md 已写明该命令，可再加 CI 门禁（`git diff --exit-code styles.css`）。
- P2：`main.js` 被 minify（与官方模板一致），社区目录审核对可审阅性敏感，可保留 sourcemap。
- P2：工作区 44 个已跟踪文件未提交——**发布前必须先提交**（本轮改动同样未提交）。
- P2：未接入 `obsidianmd/obsidian-workflows@v1` 的目录扫描器 job（可选增强）。

### 4.4 事故与处置

C 路子代理在审计中误执行 `node scripts/sync-vendor-css.mjs` 与 `git checkout -- styles.css`，覆盖了工作区 `styles.css` 的两处未提交改动。**已核验**：现 `git diff --stat -- styles.css` = `15 insertions(+), 5 deletions(-)`，两处 hunk（`@@ -1195`、`@@ -1516`）内容与事故前一致，`mindmap-wiki-doc-icon` 块与容器规则注释均在，无 `.smm-richtext`/负向测试残留。唯一副作用是文件行尾被写为 CRLF（仓库 `core.autocrlf=true`，提交时归一为 LF），无内容影响。

## 5. D 路：用户可见行为 vs 官方帮助文档

参照 `obsidian-help-master/en/**`，逐项核对 15 条。**无 P0**（零网络调用、写入仅限 vault API）。

### 5.1 一致（5 项）

附件目录设置（`Attachments.md:21-30` + `Settings.md:195-202` ↔ `images-save.ts:137-142`）、重命名自动回链（`Manage notes.md:32` ↔ `view-title-renamer.ts:56-75`）、悬停预览（`Page preview.md:4-6` ↔ `main.ts:89-92` + `view-wikilink.ts:156-163`）、命令无默认热键（`Hotkeys.md:9-11` ↔ `commands.ts`）、零网络/无遥测（`Plugin security.md:37`）。

### 5.2 需修（用户可见）

| # | 严重度 | 现象 | 帮助文档依据 | 仓库位置 |
|---|--------|------|--------------|----------|
| D1 | P1 | 忽略「Use [[Wikilinks]]」「New link format」，恒生成 `[[basename]]` / `![[path]]` | `Drag and drop.md:21`「The generated link also follows your preferences, such as relative paths, or using Markdown links」；`Settings.md:206-220` | `view-dnd.ts:149`、`modal-link.ts:84,86`、`md-serialize.ts:98,103,110` |
| D2 | P1 | 编辑后回写丢 `\|高度`（`![[图.png\|300x150]]` → `![[图.png\|300]]`），重开比例变化 | `Embed files.md:46`「`\|640x480`…」:52 仅宽才等比 | `md-serialize.ts:94-98,108` |
| D3 | P1 | 编辑后回写丢外链图片 alt（`![说明\|300](url)` → `![\|300](url)`） | `Basic formatting syntax.md:199-209` | `md-outline.ts:181-190` + `md-serialize.ts:106-108` |
| D4 | P1 | 编辑后 URL 链接被改写为 autolink：`[说明](https://…)` → `说明 <https://…>` | `Internal links.md:166-169`「Use `[Display text](Link URL)`」 | `md-serialize.ts:57-61` + `md-outline.ts:317-326` |
| D5 | P1 | 附件双链别名在合成回写时丢失（文档双链保留） | `Internal links.md:159-163`；`Aliases.md:41-44` | `md-outline.ts:300-303`、`view-node-actions.ts:113-121`、`md-serialize.ts:32-38` |
| D6 | P2 | 外部拖入非图片被拒 + 提示「仅支持图片（音视频/PDF 无法写回）」，但库内 PDF/音视频可无损写回 | `Drag and drop.md:27`「drag and drop any files…」；`Accepted file formats.md:11-19` | `view-dnd.ts:182-205`、`i18n.ts:95-97` |
| D7 | P2 | 「仅支持拖入 Markdown 笔记或图片文件」与代码实际接受 pdf/音视频/zip/epub 矛盾 | 同上 | `i18n.ts:95-96`、`view-dnd.ts:100-107` |
| D8 | P2 | 「未识别到图片文件」把原始拖拽数据 dump 给用户 | 文档未规定（UX 缺陷） | `view-dnd.ts:199-203`、`i18n.ts:185` |
| D9 | P3 | `images-save.ts:66-76` 注释假引「官方帮助 Attachments」规定 `Pasted image …` 命名（帮助库全量无此字样） | 帮助文档未规定 | `images-save.ts:66-76` |
| D10 | P3 | macOS 上注册 `Mod+Y` 重做，但官方快捷键页 macOS 仅列 `Cmd+Shift+Z` | `Editing shortcuts.md:21-22` | `view.ts:242-261` |

### 5.3 有意偏离（已文档化，非缺陷）

非图片嵌入（`![[x.pdf]]`/`![[x.ogg]]`）走回形针通道而不内嵌——用户已决策（三类图标方案），`docs/markdown-mindmap-standard.md:50,58` 已写明；帮助文档 `Embed files.md:11` 的「inline」预期属能力差异，应在 README/文档中显式声明。

### 5.4 帮助文档未规定（仅记录）

`Pasted image …` 命名、10MB 上限、图片独占节点、单节点单链/单图、多图拖入分配策略、未选中节点挂根、视图状态存插件 `data.json`、`shell.openPath` 打开音视频、单行多链接的第二项降级为纯文本。

### 5.5 D 路未验证项

跨库 `obsidian://open?vault=…` 跳转表现、回形针点击把 `app://` 交给 `openLinkText` 的实际解析、`docs.obsidian.md/Developer+policies` 未联网核对、回写类结论据源码 + 往返测试推断（未在 Obsidian 内实测）。

## 6. E 路：UI 文案 vs 官方 style guide

参照 `obsidian-help-master/en/Contributing to Obsidian/Style guide.md`（+ `zh` 术语表、`Settings.md` 官方 UI 标签）与模板 `AGENTS.md` UX 章节，核对 `src/i18n.ts` 全部键 + README。

### 6.1 已修（本轮，客观错误/与官方 UI 不符）

| # | 项 | 修法 |
|---|----|------|
| E1 | 「附件存放位置」与官方中文 UI 标签不符（用户找不到） | 改「附件默认存放路径」（官方 `设置.md:195`）；英文 `Default location for new attachments` |
| E2/D7 | 「仅支持拖入 Markdown 笔记或图片文件」与代码实际接受 pdf/音视频/zip/epub 矛盾 | 改「不支持的文件类型（仅支持笔记、图片与可链接的附件）」 |
| E3/D6 | 「Markdown 导图仅支持图片（音视频/PDF 无法写回）」与库内附件可无损写回矛盾 | 改「外部拖入仅支持图片文件」 |
| E4/D8 | 未识别到图片时把原始 MIME/拖拽载荷 dump 进 Notice | Notice 只报「未识别到图片文件」；载荷改 `console.debug`；删除 `attachment.dragData` 键 |
| E11 | 快捷键工具提示 `(shift+enter)`/`(enter)`/`(esc)` 大小写不合规 | 改 `(Shift+Enter)`/`(Enter)`/`(Escape)` |
| E12 | 撤销/重做未给 macOS 变体 | 改 `(Ctrl+Z / Command+Z)`、`(Ctrl+Y / Command+Shift+Z)`（与 D10 的 macOS 不注册 `Mod+Y` 一致） |
| E13 | `(Del)` 非官方键名写法 | 改 `(Delete)` |
| D9 | `images-save.ts` 注释假引官方帮助规定 `Pasted image …` 命名 | 注释改述为「官方只规定附件位置，命名对齐核心实际行为（社区惯例）」 |
| D10 | macOS 注册 `Mod+Y` 重做（官方 macOS 仅 `Cmd+Shift+Z`） | `view.ts` 在 `!Platform.isMacOS` 时才注册 |

### 6.2 已修（第二轮，用户选择第 2 项：英文 sentence case + 术语统一）

| # | 项 | 修法 |
|---|----|------|
| E7 | 英文词典通篇 Title Case | 全量改句首大写（命令/工具栏/右键菜单/弹窗/设置/布局/主题/默认内容，约 60 键）；`Auto Save`→`Auto-save`、`Mind Map`→`Mind map`、`Zoom In`→`Zoom in` 等 |
| E4/E14 | 中文「主题」兼表 theme 与 topic | topic 一律改「节点」：中心主题→**中心节点**、子主题→**子节点**、根节点→**中心节点**、`default.secondLevel`「主题」→「节点」；「主题」只保留给 theme（`settings.defaultTheme`/`theme.*`/布局说明） |
| E15/E16 | 「库」vs 官方「仓库」；路径说法不统一 | UI 文案改「仓库」：到仓库中、仓库路径、仓库内图片；`modal.image.urlLabel`「Obsidian 内部路径」→「仓库路径」、`internalPath`「库内路径」→「仓库路径」、`address`「图片地址」→「图片 URL」 |
| E8/E9 | 「插入链接/图片」与「添加链接/图片」并存 | 统一为「添加链接」/「添加图片」（`toolbar.insertLink`/`insertImage`、`common.insertLinkFailed`/`insertImageFailed` 一并改）；英文 `Insert link`→`Add link`、`Insert image`→`Add image` |
| E17 | 「文字」vs「文本」 | 统一「文本」（`menu.removeText`、`default.tabHint`/`enterHint` 用「添加」而非「新建」） |
| E10 | 「以 Markdown 编辑」与「以 Markdown 打开」易混 | 命令/工具栏改「切换回 Markdown」/`Switch to Markdown` |
| E18/E19 | 省略号与标点不统一 | 中文 UI 统一 `…` 与全角 `：`（`imagesToVault`、`savingClipboardImage`、`imageSavedTo`、`pasteImageFailed` 等） |
| E21/E22/E25/E28 | 通知文案不完整/含实现术语/数字单位无空格 | 「已自动整理」→「已整理思维导图」、「无匹配」→「没有匹配的节点」、「虚拟渲染」→「只绘制视野内的节点」、`{size}MB`→`{size} MB`、性能阈值描述补「仅性能模式开启时生效」、导出倍率描述补「倍」 |
| E24 | 主题下拉「跟随 Obsidian 主题」 | 改「跟随 Obsidian 配色」/`use Obsidian color scheme`（官方设置名为 Base color scheme） |
| E26 | 默认内容示例无意义（「快捷键很好用！」） | 改「示例：把想法拆成子节点」/`Example: break an idea into child nodes` |
| README | 术语/UI 标签/事实错误（E5/E6/E32/E33/E34 + 术语） | 双语 README：默认文件名 `思维导图2026-09-06.mindmap.md`/`MindMap2026-09-06.mindmap.md`（与实际生成一致）、菜单标签对齐实际 UI（**添加子节点**/**添加同级节点**/**删除节点**）、`Ctrl/Cmd+点击` 拆为平台写法、导航箭头加粗、`desktop (Electron)`→`Desktop only (Windows, macOS, Linux)`、安装步骤补「重启 Obsidian」、库→仓库、中心主题→中心节点；英文示例改为英文；新增「非图片嵌入显示为附件图标而非内嵌」声明与 `vendor/THIRD-PARTY-NOTICES.md` 指引 |
| 文档 | `docs/markdown-mindmap-standard.md` 术语 | 中心主题→中心节点、子主题→子节点、库内路径→仓库路径、根节点→中心节点 |

### 6.3 已修（第三轮，用户选择第 2、3 项）

| # | 项 | 修法 |
|---|----|------|
| E30 | 语言切换后命令面板/丝带提示不刷新（真 bug） | `commands.ts` 拆出 `addMindMapRibbonIcon`（返回元素）与 `refreshCommandLabels`（按 `COMMAND_IDS` 先 `removeCommand` 再重注册，丝带元素就地更新 `aria-label`）；`main.ts` 新增 `refreshLanguageUi()`（命令 + 丝带 + 状态栏 + 各视图搜索栏）；`settings.setControlValue('language')` 调用它，再 `update()` 重渲染设置面板。视图工具栏本已由 `applySettingsToViews`（language 属 LIVE_REFRESH 键）重建；搜索栏新增 `refreshSearchBarLabels`（就地更新占位符与三个按钮 tooltip，不重建 DOM、不重复注册监听） |
| E20 | 状态栏 `node(s)` | `status-bar.ts` 按单复数分键 `common.nodeOne`/`common.nodeMany`：en `1 node` / `3 nodes`，zh 两键同文 |
| E23 | 弹窗「确定」不区分动作 | 拆为 `modal.create`（命名弹窗「创建」/`Create`）与 `modal.apply`（链接/图片弹窗「应用」/`Apply`） |
| E29 | `modal-image.ts` 硬编码 `'...'` | 改 `…` |

验证：`npm run build` 0 · `npm run lint` 0（`--max-warnings 0`）· `npm test` **430 例 / 31 文件** · `npm run verify:visual` 通过。新增 `tests/language-refresh.test.ts`（6 例：命令重注册/丝带提示/无元素安全、状态栏单复数与元素缺失）与 `view-search` 的 2 例刷新用例。

## 7. 汇总与修复计划

### 7.1 本轮已修（14 项，闸门全绿）

| 类别 | 项 |
|------|----|
| 保真度（D） | D2 丢 `\|高度`、D3 丢外链图片 alt、D4 `[文本](url)` 被降级为 autolink、D5 附件双链别名丢失 |
| API（A） | A1 WeakMap 注入标记、A4 `App.isDarkMode()`、A5 定时器随组件清理、A7 hover-link 常量、A8 类型化 vault getter（含清 6 处 disable）、A9 核心视图类型常量、A12 固定 obsidian `^1.13.1` |
| 发布（C） | C1 tag==version 校验、C2 release notes 自动附加、C7 vendor 第三方许可声明 |
| 文案（E） | E1 设置名、E2/E3 误导提示、E4 拖拽载荷不入 UI、E11/E12/E13 快捷键写法、D9 假引用注释、D10 macOS 不注册 Mod+Y |
| 工程 | `npm run lint` → `--max-warnings 0`；删除死配置 override（源码零 eslint-disable） |

验证：`npm run build` 0 · `npm run lint` 0（`--max-warnings 0`）· `npm test` **422 例 / 30 文件** · `npm run verify:visual` 通过。

### 7.2 第二轮：用户选择第 2 项（英文 sentence case + 术语统一）——已实施

见 §6.2（13 组改动：英文全量 sentence case、主题→节点、库→仓库、插入→添加、文字→文本、标点/省略号统一、通知文案完整化、双语 README 与标准文档术语同步）。验证：`npm run build` 0 · `npm run lint` 0（`--max-warnings 0`）· `npm test` **422 例 / 30 文件** · `npm run verify:visual` 通过。

### 7.3 第三轮：用户选择第 2、3 项——已实施

见 §6.3（语言切换后命令/丝带/状态栏/搜索栏文案刷新；状态栏单复数；弹窗按钮分「创建/应用」；省略号）。验证：build 0 · lint 0 · **430 例 / 31 文件** · verify:visual 通过。

### 7.4 待决策项：已决策（保留现状）

**链接格式偏好（D1）——保留现状**：新增链接/图片引用恒写 `[[…]]` / `![[…]]`，**不**遵循 Obsidian 的 `Use [[Wikilinks]]` / `New link format` 设置。

理由（决策依据）：本插件的三类图标方案（文档双链 → 自绘文档页图标、URL → 引擎原生链接图标、附件 → 回形针）依赖「文档链接走 `mdWikiLinkpath` 双链通道」；若遵循偏好生成 `[文本](路径.md)`，文档链接会落到引擎 hyperlink 通道并显示原生链接图标，与既定视觉冲突。该偏离已在 `AGENTS.md` 与 `docs/markdown-mindmap-standard.md` 显式声明；若未来要支持偏好，需同时把 md 形态的笔记链接映射回文档图标通道（D1 详述见 §5.2）。

至此五路审计的**待决策项全部清零**：A/B/C/D/E 的 P0/P1/P2 均已修复或有记录的保留决策。
