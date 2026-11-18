# 代码结构与文件规模（详录）

> 本文件由 AGENTS.md 迁出（2026-10-04 瘦身）。AGENTS.md 只保留固定规则、命令与读取入口；可变清单见 index.md，实现决策见 decisions.md；
> 本文是**详录**，改代码前按需查阅，改约定时**同步更新 index.md / decisions.md 的对应记录**。

## 代码结构

**分组与分层（依赖单向；许可集由 lint + 静态依赖图测试机械强制，见 K51）**：

| 层 | 组 | 定位 |
|---|---|---|
| L0 | `domain/` | 纯领域逻辑（零依赖，lint 强制） |
| L1 | `core/` `links/` `markdown/` `media/` `engine/` `platform/` | 基础模块组（组间许可：`links→core`；`markdown→links/core`；`media→links/core`；`engine→core`；`platform→links/markdown/core`；`domain` 对每层恒许，故不逐条列） |
| L2 | `ui/` `services/` | 弹窗与视图服务（`ui→links/media/core`；`services→core/links/markdown/media/engine/platform`） |
| L3 | `features/` | UI 特性与视图控制器 |
| 根 | `main.ts` `commands.ts` `settings.ts` `creation.ts` | 组合根（唯一可依赖全图） |

> **模块化是硬约束**：单一职责 / 分层单向 / 收口唯一 / 窄接口四条边界见 K50；依赖矩阵与机械强制见 K51；文件规模与拆分判定见「文件规模与豁免」。

源码与测试的逐文件清单统一维护在 [index.md](index.md#代码结构索引)，这里仅说明模块职责，避免两份文件树随迁移漂移。

- **platform/**：平台能力（K210）。
  - **rendering/**：数学、代码、mermaid 与 callout 图标；数学与代码各自成组。
  - **workspace/**：文件迁移、自动打开、导航、标签与 Vault 集成。
  - **system/**：系统剪贴板与外部打开。
  - `export-svg-postprocess.ts`：共用导出后处理入口。
- **features/**：视图能力（K210）。
  - **view/**：主视图、上下文、加载与工具栏、搜索、状态、小地图和菜单装配。
  - **content/**：节点内容解析、渲染装配、写回与重测，以及任务、标签和脚注交互。
  - **editing/**：节点编辑、快捷键、剪贴板、粘贴、拖放与语法守卫。
  - **canvas/**：拖动会话、节点宽度与画布手势。
  - **media/**：图片动作、尺寸调整与全屏预览。
  - **navigation/**：链接导航、分屏打开与标题改名。
  - **relations/**：联系、概要、锚点与点选节点。
  - `mindmap-codeblock.ts` / `view-export.ts`：独立嵌入与导出入口。

子目录不新增依赖层；仍按一级模块组校验许可集与成环。保留原文件名与具名接口，不新增转发 `index.ts`。

测试目录遵循同样的模块与能力归属（K211），按主要被测职责放置，不建立新的运行时依赖层：

- **模块测试**：`tests/` 下与 `src/` 同名模块目录；`features/`、`platform/`、`ui/` 延续相应能力子目录。
- **组合入口测试**：创建、设置、文件菜单、语言刷新留在 `tests/` 根目录。
- **工程契约**：`tests/contracts/`。
- **共享支持**：`tests/helpers/`、`tests/mocks/`、`tests/fixtures/` 与 `tests/setup.ts`。

### 文件规模与豁免（超限须登记）

官方社区模板建议单文件控制在 200–300 行。本项目**不做机械拆分**——按「拆分会不会把已有收口职责摊开」判定，而不是按行数判定：行数是症状，收口点被拆散才是病。故引入一条硬规则：

> **超过 300 行的源文件必须在 `docs/agents/index.md`「文件规模与豁免」表登记豁免理由；未登记者一律视为待偿还债务。**

（豁免是「已知并接受」，不是「没看见」。债务指标：**未登记的超限文件数，只允许递减**。）

> **登记表只在 `docs/agents/index.md`「文件规模与豁免」一处维护**（2026-11-17 由入口迁到索引，见 K202）：逐文件行数、
> 豁免理由、行数回填（`npm run check:gates -- --fix-lines`）与两道机械门禁
> （`agents-md-sync` 的漂移阈值、`check:gates` 的「未登记超限」核对）都读那一张表。
> 本文件**不再复制**——两张表并行时只有一张受门禁，另一张必然漂移（实测同一文件曾
> 同时出现 1121 / 1280 两个读数，而另一处已涨到 1532）。读行数请直接看 `docs/agents/index.md`
> 或跑 `npm run check:gates -- --dry-run`。

行数快照与历次回填流水见 `docs/agents/line-count-log.md`（只追加、不改旧条目）；
本文件不保留任何行数数字——同一个可漂移的量只允许有一处权威。

**判定分两层**：
1. **是否已登记理由**（文档层）—— 未登记者一律视为待偿还债务，`npm run check:gates`
   的 line-budget 静态核对会红灯。
2. **登记值与实测的漂移**（机械层）—— `tests/contracts/agents-md-sync.test.ts` 的「豁免表登记
   行数与实测无超阈值漂移」用例守门，阈值 `±min(+15%, +50 行)`（**双向**）。
   改动任一豁免文件后若该用例转红，必须回填 `docs/agents/index.md` 的行数列
   （`npm run check:gates -- --fix-lines`）。

**函数内拆分口径（2026-09-28「批次 2」逐行评估裁决）**：超长函数（>90 行）能否拆，判据同文件级——「拆会不会把契约摊开」，而非行数。① **不拆**（判定/优先级链形态：分支**顺序即契约**、注释与状态流集中可见；拆分需 `continue`→`return` 转换或引入 ctx/闭包状态，属机械改写而非提取）——`md-outline.buildInlineData`（220 行）/ `md-outline.classifyLines`（174）/ `node-inline-content.splitMarkedText`（111）。② **拆**（纯移动：块间独立、签名统一、零共享可变状态）——2026-09-28 已完成：`view-wikilink.registerWikilinkInteractions`（137 → 编排壳 + 点击/悬停/画布锚点悬停/中键四个注册函数）、`view-toolbar.buildToolbar`（114 → 编排壳 + 右缘四组构建；2026-10-22 重排为浮层后仍是编排壳形态）、`commands.registerCommands`（145 → 编排壳 + 创建/视图/导出与文档三组）。**重跑函数级评估前先读本节**，避免重复论证。
