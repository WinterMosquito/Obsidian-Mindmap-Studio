[中文](#cn-v0.1.7) | [English](#en-v0.1.7)

0.1.7 是一次**可靠性与工程门禁**版本：修复「节点文本编辑失败毫无反馈」「工具栏图标尺寸兜底压掉主题变量通道」两处缺陷，补上两处此前从未被类型检查覆盖的真实类型错误；同时完成一轮性能去平方（数学公式重排的节点反查）与工程门禁收紧——三个发布相关配置纳入 `tsc`、依赖矩阵与文档清单纳入机械校验。无破坏性变更（`.mindmap.md` 格式、命令 ID 与设置项均未变）。

<h3 id="cn-v0.1.7">修复</h3>

* **节点文本编辑失败不再毫无反馈**：在弹窗中编辑节点文本时，若底层操作失败，此前 Promise 拒绝被静默吞掉——用户点了「在弹窗中编辑」却毫无反应，也无法判断是自己操作有误还是插件出错；现在会弹出明确提示，且不触碰写回与保存通道（引擎状态、保存调度均保持原样，不会写入半成品）
* **工具栏图标尺寸兜底不再压掉主题变量通道**：图标尺寸此前依赖官方内部类名消费 `--icon-size` 变量；新增的自包含兜底规则 specificity 高于官方规则，若把尺寸写死就会连变量通道一起覆盖，导致「跟随官方尺寸体系 / 允许用户与主题覆盖」的设计失效。现走 `var(--icon-size, 16px)`：变量在位时跟随变量，官方改名致其不再消费时回落到 16px，两条失效路径都兜住
* **依赖矩阵的一处类型逃逸**：`ModuleGroup` 联合类型遗漏了 `domain`，而 9 个模块边界块中有 8 个把 `domain` 列为允许依赖——该声明此前完全逃过类型检查。已补入类型（并明确标注「禁止跨组导入」清单**有意不含** `domain`，否则会与依赖矩阵语义相反）
* **LICENSE 校验器的 8 处类型违规**：`plain-text-parser.mjs` 此前不在类型检查视野内，其行级 token 形状是无约束的 `Record<string, unknown>`；现已补上精确形状定义，token 字段名一并纳入门禁

<h3>性能</h3>

* **数学公式重排的节点反查从平方级降为线性**：含行内公式的导图在公式定稿后需把每个公式元素反查回所属节点以重排尺寸，此前逐个元素各走一遍全树遍历（元素数 × 节点数）；现改为一次遍历建「节点 → DOM 组」映射、逐元素沿祖先链查表，复杂度 O(节点数 + 元素数 × 祖先链深度)。查表未命中时**逐个回落**原全树扫描（宁可慢、不可错），覆盖引擎在建表后重渲染的情形
* **段落文本不再重复拼接**：Markdown 解析时同一份段落内容此前拼接两遍（显示文本与解析期快照各一次），现复用同一字符串

<h3>工程</h3>

* **三个发布相关配置纳入类型门禁**：`eslint.config.mts` / `stylelint.config.mjs` / `manifest.json` 现在参与 `build` 前置的类型检查（`manifest.json` 的 JSON 语法错误在构建期即被拦下，不必等到发布扫描），并因此退役了 ESLint 的「默认工程」兜底配置
* **模块解析切到 `bundler`**：旧选项在 TypeScript 6 起被标记弃用、7 将移除，编辑器会持续报错。实测对现有 400+ 处无扩展名导入**零改动**通过；同时明确不使用「忽略弃用警告」的静音开关——它在当前锁定的 TypeScript 版本下反而会报配置错误并真的阻断构建
* **文档清单校验覆盖子目录**：`AGENTS.md` 的 `docs/` 清单此前只校验顶层文件，`docs/agents/` 下的详录虽已登记却从不被检查——指向不存在的文件无人拦截。现已纳入
* **依赖与配置的显式声明**：死代码检查补上项目文件边界（结论与原推断一致，零残留）；写盘失败回调改用函数类型属性，类型层面即无隐含 `this`，日后传入未绑定方法引用仍会被拦下
* **`AGENTS.md` 重构为索引 + 详录**：主文件 1628 行 → 183 行，保留硬规则（Don't/Do 配对）、决策表、编号工作流、命令表与索引；112 条设计约定与架构/测试详录迁至 `docs/agents/` 四份文档。**未登记的超限文件数只允许递减**这一约束不变
* **行数统计口径统一**：此前文档登记值与实测的「差异」实为两套统计口径不同所致；现已统一为校验脚本的口径，并在文档中标注了不要用 PowerShell 统计行数
* 测试全量 **60 文件 / 1820 例**（0.1.6 为 58 / 1765）
* 文档：README 中英双语补齐快捷键表（搜索、撤销/重做、编辑、删除、适应画布、缩放到选区，含各自的让位条件）；开发环境要求 Node 20+

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`.mindmap.md` 格式、命令 ID 与设置项均未变更——纯修复 / 性能版本，无需迁移
* ⚠ **本轮 `styles.css` 有变化**（新增图标尺寸自包含兜底规则），更新时**需同时替换 `main.js` 与 `styles.css`**，不能只换 `main.js`
* 无新增设置项、无新增第三方依赖

---

<h3 id="en-v0.1.7">Fixed</h3>

* **Editing node text no longer fails silently**: when editing a node's text in the modal, a failed underlying operation used to be swallowed — the command appeared to do nothing and there was no way to tell whether the input was rejected or the plugin failed. It now shows an explicit error, and the write-back and save channels stay untouched (engine state and save scheduling are left alone, so no half-finished content is written)
* **The toolbar icon-size fallback no longer overrides the theme variable channel**: icon sizing previously relied on an Obsidian-internal class name to consume the `--icon-size` variable. The new self-contained fallback rule is more specific than the official rule, so a hard-coded value would suppress the variable channel too — defeating the "follow the official sizing / let users and themes override it" design. The value is now `var(--icon-size, 16px)`: it follows the variable when present, and falls back to 16px if the official class is renamed and stops consuming it, so both failure paths are covered
* **A type escape in the dependency matrix**: the `ModuleGroup` union type was missing `domain`, although 8 of the 9 module boundary blocks list it as an allowed dependency — the declaration was therefore never type-checked. The type is fixed (with an explicit note that the "forbidden cross-group import" list deliberately **excludes** `domain`, which would otherwise invert the dependency matrix)
* **8 type violations in the LICENSE checker**: `plain-text-parser.mjs` was outside the type-checked surface, so its line-token shape was an unconstrained `Record<string, unknown>`. A precise shape is now declared, which also brings the token field names under the gate

<h3>Performance</h3>

* **Node lookups during math re-measurement go from quadratic to linear**: after inline formulas settle, a mind map with formulas must map each formula element back to its owning node to re-measure layout. Each element previously triggered its own full-tree walk (elements × nodes). It now builds a node → DOM-group map in a single traversal and walks each element's ancestor chain, giving O(nodes + elements × depth). Elements that miss the map **fall back individually** to the original full-tree scan (slower but never wrong), which covers cases where the engine re-renders after the map was built
* **Paragraph text is no longer concatenated twice**: Markdown parsing previously joined the same paragraph content twice (once for display text, once for the parse-time snapshot); the same string is now reused

<h3>Engineering</h3>

* **Three release-related configs are now type-checked**: `eslint.config.mts` / `stylelint.config.mjs` / `manifest.json` take part in the type check that precedes `build` (so a JSON syntax error in `manifest.json` is caught at build time rather than at release scanning), which also retired ESLint's "default project" fallback configuration
* **Module resolution moved to `bundler`**: the old option is deprecated from TypeScript 6 and removed in 7, so editors report it continuously. Verified to pass with **zero changes** to the 400+ extension-less imports; the "ignore deprecation" silencer is deliberately not used — on the currently pinned TypeScript version it raises a configuration error and genuinely blocks the build
* **The docs manifest check now covers subdirectories**: the `docs/` list in `AGENTS.md` previously validated top-level files only, so the detailed records under `docs/agents/` were registered but never checked — a pointer to a non-existent file went unnoticed. They are now covered
* **Explicit declarations for dependencies and config**: the dead-code check now declares project file boundaries (the conclusion matches the previous inference, with zero findings); the save-failure callback is declared as a function-typed property, so there is no implicit `this` at the type level and passing an unbound method reference would still be caught
* **`AGENTS.md` refactored into an index plus detailed records**: the main file went from 1628 to 183 lines, keeping hard rules (paired Don't/Do), a decision table, numbered workflows, a command table and an index; the 112 design conventions plus architecture/testing details moved into four documents under `docs/agents/`. The existing constraint stands — the number of over-limit files without a registered exemption may only decrease
* **Line-count measurement unified**: the previously reported "discrepancy" between registered and measured values was in fact two different counting conventions. Everything now uses the validation script's convention, and the docs note that PowerShell's line count should not be used
* Full suite: **60 files / 1820 cases** (0.1.6: 58 / 1765)
* Docs: the Chinese and English READMEs gained a keyboard-shortcut table (search, undo/redo, edit, delete, fit to canvas, zoom to selection, including when each one yields to Obsidian); development now requires Node 20+

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; the `.mindmap.md` format, command IDs and settings are unchanged — a fix/performance release with no migration needed
* ⚠ **`styles.css` changed in this release** (a self-contained icon-size fallback rule was added). Update **both `main.js` and `styles.css`** — replacing only `main.js` is not enough
* No new settings, no new third-party dependencies
