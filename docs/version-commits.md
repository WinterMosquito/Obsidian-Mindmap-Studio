# 版本需求与 Git 提交映射

> 来源：当前版本说明、完整 Git 历史及各提交文件差异。源码参考 HEAD：`fe08a2aa3e50a2538199860a3f9958d86ef1ae16`。

每个 `v0.x.x` 标签指向该版本需求完成快照，保留期间的功能、修复、性能与工程实现。`base_commit` 是上一版本的需求完成快照；版本号变更提交另列。一版可以跨多条提交，标签只标完成点，中间提交列于下方。

- 机器可读数据：[version-commits.json](version-commits.json)，含完整 SHA、文档摘要/校验值和实现相关提交及改动路径。
- 首版 `0.0.1` 的开发前基线不在历史中：仓库根提交 `5b1a70699d7e4e7b7d7463a6b273a5992165a422` 已含插件代码，故 base 明确为 null。
- 历史版本没有在本轮逐一构建或运行；完成点由版本文档与实际提交内容对照确定。
- 标签仅创建在本地，未推送；这些是需求完成点标签，发布流程中的 tag/manifest 校验约定仍见 [process.md](agents/process.md#发布流程)。
- 当前 Fork 在 `0.3.3` 之后的 UI、结构拖动与重构工作尚无新的版本说明，因此不并入原 `v0.3.3`。

## 完成点总表

| 标签 | Base commit | Feat commit | 版本号提交 |
|---|---|---|---|
| `v0.0.1` | 不可恢复 | `6cfe6c6` | `5b1a706` |
| `v0.0.2` | `6cfe6c6` | `3391a9b` | `54496d4` |
| `v0.0.3` | `3391a9b` | `762cefb` | `d7fb0fc` |
| `v0.0.4` | `762cefb` | `3fb7784` | `785db6c` |
| `v0.0.5` | `3fb7784` | `ef49078` | `c9e21b2` |
| `v0.1.0` | `ef49078` | `065b356` | `62c3d0e` |
| `v0.1.1` | `065b356` | `e4f9802` | `e4f9802` |
| `v0.1.2` | `e4f9802` | `c70a918` | `43b186e` |
| `v0.1.3` | `c70a918` | `deaab61` | `342e883` |
| `v0.1.4` | `deaab61` | `e75dec2` | `e75dec2` |
| `v0.1.5` | `e75dec2` | `4c8db75` | `bf639e2` |
| `v0.1.6` | `4c8db75` | `675346b` | `ed50e70` |
| `v0.1.7` | `675346b` | `d89512e` | `d89512e` |
| `v0.1.8` | `d89512e` | `bba2929` | `bba2929` |
| `v0.1.9` | `bba2929` | `0f21697` | `0f21697` |
| `v0.2.0` | `0f21697` | `80ab401` | `fd561d8` |
| `v0.2.1` | `80ab401` | `8285523` | `8285523` |
| `v0.2.2` | `8285523` | `136efbd` | `136efbd` |
| `v0.2.3` | `136efbd` | `e73957c` | `e653fc8` |
| `v0.2.4` | `e73957c` | `00453da` | `00453da` |
| `v0.2.5` | `00453da` | `843849e` | `843849e` |
| `v0.2.6` | `843849e` | `5e28888` | `5e28888` |
| `v0.2.7` | `5e28888` | `e810c2c` | `e810c2c` |
| `v0.2.8` | `e810c2c` | `4284adb` | `4284adb` |
| `v0.2.9` | `4284adb` | `d4ed612` | `f8df38e` |
| `v0.3.0` | `d4ed612` | `ef5a566` | `ef5a566` |
| `v0.3.1` | `ef5a566` | `9123c29` | `9123c29` |
| `v0.3.2` | `9123c29` | `399f917` | `399f917` |
| `v0.3.3` | `399f917` | `a714692` | `a714692` |


## 逐版本依据与提交清单

这里列出 base → feat 范围内改动源码、测试、工具配置、CI 或相关交付文件的提交。每条的具体文件路径见 JSON；语义类别以提交内容为准，标题无需以 feat 开头。

### v0.0.1

- 需求文档：[release-notes-0.0.1.md](release-notes-0.0.1.md)
- 完成提交：`6cfe6c6a106f2014a0505b9d45e1b9b4bf180dd4` — refactor: sync vendor css script and release notes for 0.0.1, harden paste naming
- 依据：首个公开版本文档在此提交建立，75 项测试与核心能力快照对应。根提交已含插件代码；开发前基线不可恢复。
- 实现相关提交：
  - `5b1a706` — The Mind Map 0.0.1
  - `3d8108e` — fix: wrap URL link destinations in angle brackets on serialize
  - `f4d8898` — fix: serialize URL links as autolink <url> and parse <url> back
  - `ad3d273` — feat: render URL links as icon-only (autolink not shown as node text)
  - `4c86409` — feat: write-back heuristics (link destination escaping/normalization + url display sync)
  - `e49b170` — refactor: rename plugin to MindMap Studio (id mindmap-studio)
  - `1559ffa` — fix: restore openAs=mindmap leaves after workspace reload (startup auto-switch)
  - `47d5e27` — fix: robustly restore openAs=mindmap views (layout-ready + delay + file-open)
  - `47526d7` — fix: multi-delay openAs restore after workspace reload
  - `72d336c` — fix: broaden openAs restore scans + startup diagnostic
  - `d3f96c2` — fix: hydrate viewState from the whole data.json (root cause of view/layout loss on restart)
  - `e13a8fc` — refactor: remove dead code and un-export internal-only helpers
  - `96bf21a` — refactor: serialize data.json writes and centralize openAs error handling (remove race/unhandled-rejection debt)
  - `1f83c69` — refactor: harden malformed-tree render, image size walk, file:// path, search debounce, view-state validation, export/finally, refresh clone
  - `ca64c89` — refactor: restructure into domain/services/features layers, promote roundtrip tests to vitest, enforce strict lint
  - `1641e2b` — refactor: consolidate single sources of truth, contain engine internals, extract plugin infra
  - `1b8158c` — refactor: unify resolution entry, enforce domain purity, shift status bar ownership
  - `6cfe6c6` — refactor: sync vendor css script and release notes for 0.0.1, harden paste naming

### v0.0.2

- 需求文档：[release-notes-0.0.2.md](release-notes-0.0.2.md)
- 完成提交：`3391a9bfd96b09574f7f6374cc1639a5d193201f` — ci: drop EOL Node 20.x from test matrix (keep 22.x, 24.x)
- 依据：b68ea32 实现节点交互，ad35a95 完成 lint；a432084/3391a9b 补齐版本说明中的 CI 要求。
- 实现相关提交：
  - `5e9dd41` — refactor: close code-quality audit findings - unified resolution, no polling, slim view context, vendor contract guard
  - `b68ea32` — feat: drag-target assisted reparenting, image drag resize, settings persist debounce; expand test matrix (engine-controller, event-binder, persistence, feature-helpers)
  - `ad35a95` — chore(lint): wire manifest.json/LICENSE into eslint, fix manifest description
  - `a432084` — ci: bump actions/upload-artifact v4 to v7 (node24 runtime)
  - `3391a9b` — ci: drop EOL Node 20.x from test matrix (keep 22.x, 24.x)

### v0.0.3

- 需求文档：[release-notes-0.0.3.md](release-notes-0.0.3.md)
- 完成提交：`762cefbe5f40e8d3ceec5b09e30d1bc2eee4f705` — docs: drop superseded code-quality/eslint audit reports and audit guide
- 依据：b029925 删除代码块功能，762cefb 完成同版本说明要求的审计文档清理。说明文件在后续 3fb7784 才补写。
- 实现相关提交：
  - `b029925` — refactor: remove Markdown code-block rendering; unify on .mindmap.md views
  - `762cefb` — docs: drop superseded code-quality/eslint audit reports and audit guide

### v0.0.4

- 需求文档：[release-notes-0.0.4.md](release-notes-0.0.4.md)
- 完成提交：`3fb7784b9ea78982750b94420e5fa140021fac9c` — fix: harden API usage, round-trip fidelity, interactions and copy
- 依据：3fb7784 同时实现 API/回写/交互修复并建立版本说明；785db6c 仅补版本号。
- 实现相关提交：
  - `3fb7784` — fix: harden API usage, round-trip fidelity, interactions and copy

### v0.0.5

- 需求文档：[release-notes-0.0.5.md](release-notes-0.0.5.md)
- 完成提交：`ef49078fb31208785601340b4966d812d128dbce` — fix(hotkeys): 创建视图作用域——F2 等视图内快捷键此前全部失效
- 依据：版本号提交 c9e21b2 后，ef49078 修正作用域，使说明中的 F2 等视图快捷键实际生效。
- 实现相关提交：
  - `183dc26` — fix: open at 100% centred on the central node; repair hover preview and node text edit
  - `96fc888` — feat: add a reset-zoom toolbar button; auto-arrange resets zoom instead of fitting
  - `150a04d` — fix: reset zoom only restores 100%, keeping the current pan
  - `e9516da` — fix: reset zoom anchors at the canvas centre so the visible content does not drift
  - `a0752ce` — feat: open mind maps centred on the whole content at 100%
  - `6d382dc` — feat: move the reset-zoom button to the left of fit-to-canvas
  - `ab9cf9c` — feat(view): F2 编辑当前节点
  - `15e6b2f` — fix(view): 悬停预览弹窗可翻转到节点下方
  - `8c903f4` — fix(md): 图文/链接合成不再丢 token，移除图片不再复活
  - `f1d60fd` — fix(view): 中心主题改名改用 FileManager.renameFile（更新库内链接/反链）
  - `7da1f4b` — fix(view): 交互会话/初始化定时器挂到画布所属窗口并补齐代际与陈旧引用守卫
  - `c6c6ddb` — fix: 文件名清理对齐 Obsidian 约束、测试闸门补几何用例并进 CI
  - `1e333d5` — refactor(view): 插入承载节点收敛到 insertChildNodeWithData 单一入口
  - `ce36a63` — test(save): 覆盖卸载兜底快照（排空时快照为 null 用 pendingTree 补写）
  - `c118c10` — chore(css): 删除无用的 vendor CSS 段（-28.8KB）
  - `c225342` — chore(vendor): 删除手写类型声明中未使用的 5 个成员
  - `ef49078` — fix(hotkeys): 创建视图作用域——F2 等视图内快捷键此前全部失效

### v0.1.0

- 需求文档：[release-notes-0.1.0.md](release-notes-0.1.0.md)
- 完成提交：`065b3566a2b1f2cae6e2fa083de22d6c73205985` — fix(md): `---` 分两种身份——setext H2 下划线不再被当分隔线丢弃（R2）
- 依据：065b356 完成 setext H2 区分；此前同批双链/嵌入与数据损坏修复一并包含。
- 实现相关提交：
  - `f3047ca` — ci: verify:visual 失败时输出转 check annotation（便于定位 Linux 侧失败）
  - `a8cb36c` — ci(verify:visual): 断言异常转为可见失败项，顶层异常带栈输出
  - `b5d8957` — ci(verify:visual): 探针前后加进度标记 + Chrome 加 --disable-dev-shm-usage
  - `7d033eb` — ci(verify:visual): 输出重定向到文件并带退出码（避免管道缓冲丢日志）
  - `2b45e63` — ci: verify:visual 失败重试一次（无头渲染在 CI 上偶发失败）
  - `e9b53ed` — ci(verify:visual): 加逐阶段 trace（定位 CI 无输出退出）
  - `a75acf1` — ci: 注解只取日志尾部 12 行（注解数量有上限）
  - `7930d62` — ci: 回退 verify:visual CI 步骤（Linux 侧不稳定，且无日志权限无法定位）
  - `4a5d6d1` — chore(license): 自备行级 parser 并补防回退测试，版权行改为精确匹配格式
  - `8b832d9` — feat(md): 纯双链节点编辑改为改别名（节点内只显示别名）
  - `b1ea190` — ci: verify:visual 以非阻断方式重新接入并归档诊断日志；action 升 v7
  - `e14477a` — docs: AGENTS.md 补文件规模豁免与 isDesktopOnly 承重性；清理计划文档
  - `e1871a9` — test: 回归套件扩充至 1126 用例（36 文件）
  - `95d4aab` — fix(mindmap): 文档页图标改用画布 document 创建（popout 兼容）
  - `668de5a` — chore(lint): 收窄 vendor 忽略，把手写类型声明纳入 lint
  - `6710d78` — docs(agents): 补 lint 的 cwd/manifest 依赖、API 版本基线与声明式键盲区
  - `ab10a55` — fix(mindmap): 文档页图标 tooltip 跟随实时别名（抽取 domain/wiki-display）
  - `906edcf` — feat(md): 文档嵌入改走文档双链通道（同图标 / 别名管道位 / 回写补 !）
  - `50ba05b` — feat(md): Canvas/Bases 归为文档类，保留非图片嵌入的管道位
  - `2acd53d` — fix: 修复 5 处数据损坏级缺陷（写盘归属 / 链接清除 / 外链图片 / 缩进与硬换行 / 跨文件夹引用）
  - `065b356` — fix(md): `---` 分两种身份——setext H2 下划线不再被当分隔线丢弃（R2）

### v0.1.1

- 需求文档：[release-notes-0.1.1.md](release-notes-0.1.1.md)
- 完成提交：`e4f980287438e1a180c2b0bfcb55c1d199d3031a` — chore(release): 0.1.1
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `e4f9802` — chore(release): 0.1.1

### v0.1.2

- 需求文档：[release-notes-0.1.2.md](release-notes-0.1.2.md)
- 完成提交：`c70a9182e1202f3f2393fc241321a15e3ee21211` — fix(test): vendor 哈希断言按 LF 归一，修 autocrlf 造成的 CI 假失败
- 依据：43b186e 只是早期里程碑；现有说明覆盖后续 acc573b/3ad2d9d 工作。c70a918 完成随后 vendor 哈希跨换行验证修复。
- 实现相关提交：
  - `43b186e` — chore(release): 0.1.2
  - `acc573b` — fix: 多链接内联需求前的累积修复（保真/拆分/移除图片/ABCE）
  - `97ebd6a` — refactor: 插件目录严格模块化重组（11 模块组 + 依赖矩阵机械强制）
  - `88a913e` — refactor: 移除单节点拆分双链命令（仅保留批量），同步文档/测试/i18n/eslint 配置
  - `3ad2d9d` — chore: 合规审计 P0/P1/P2 修复 + 既有开发工作快照
  - `c70a918` — fix(test): vendor 哈希断言按 LF 归一，修 autocrlf 造成的 CI 假失败

### v0.1.3

- 需求文档：[release-notes-0.1.3.md](release-notes-0.1.3.md)
- 完成提交：`deaab6190dfb646414e128d497ae3a6bf2519bbd` — perf: 打开大图不再装配全量 DOM；资源地址直解与索引增量收敛；verify:visual 探针加固
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `deaab61` — perf: 打开大图不再装配全量 DOM；资源地址直解与索引增量收敛；verify:visual 探针加固

### v0.1.4

- 需求文档：[release-notes-0.1.4.md](release-notes-0.1.4.md)
- 完成提交：`e75dec27f5192f872de22b1d36728041960fd1ed` — 0.1.4
- 依据：cb85791 是首次版本号提交；后续 scanner 修复到 e75dec2 才完成。
- 实现相关提交：
  - `91b27aa` — perf: 引擎性能轮（9 处自有补丁：分片渲染/监听器惰性注册/布局延迟物化）+ 社区目录三线对照 + 既有开发工作快照
  - `7e791d2` — fix(ci): scanner-lint 加固——依赖安装重试 ×3（网络抖动自愈）、Linux npm-cli 路径候选（hostedtoolcache lib 布局）、eslint 由 npx 改为直连 CLI 入口（消除「项目 node_modules 优先」的解析歧义）
  - `e75dec2` — 0.1.4

### v0.1.5

- 需求文档：[release-notes-0.1.5.md](release-notes-0.1.5.md)
- 完成提交：`4c8db75873fd0f4a3d926d6706ba208ce566617b` — K109
- 依据：095d857 实现 K90-K91，aea6c67 以后实现 K92-K109；4c8db75 是说明最后一次实现更新。bf639e2 并未包含全部需求。
- 实现相关提交：
  - `54d18aa` — docs: 许可声明口径修正——内联注释实测仅存 1 段，THIRD-PARTY-NOTICES 为主载体（K84）
  - `095d857` — K90-K91
  - `aea6c67` — K92-K98
  - `9d8167b` — K99
  - `e8c8a3a` — K101
  - `a97b13b` — K100
  - `09e0d7d` — K102
  - `660870f` — K103
  - `155de9c` — K105-K108
  - `4c8db75` — K109

### v0.1.6

- 需求文档：[release-notes-0.1.6.md](release-notes-0.1.6.md)
- 完成提交：`675346b6775d365b2d175ac7d761de5825bf0dd8` — 错误修正+性能优化
- 依据：675346b 完成当前说明的修复/性能范围；ed50e70 改版本，902501f 补版本元数据和说明。
- 实现相关提交：
  - `f8ff7f9` — chore 命名约定
  - `b23c34f` — 修复拖入渲染失败
  - `675346b` — 错误修正+性能优化

### v0.1.7

- 需求文档：[release-notes-0.1.7.md](release-notes-0.1.7.md)
- 完成提交：`d89512eca017dd9de8a1ece3118325d0eb51b0eb` — 0.1.7
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `18c976e` — 优化
  - `5320609` — 更新音频/视频扩展基表注释，删除过时清单信息
  - `18732a9` — 修复思维导图视图下“后退”功能
  - `d89512e` — 0.1.7

### v0.1.8

- 需求文档：[release-notes-0.1.8.md](release-notes-0.1.8.md)
- 完成提交：`bba29292109f6f4dc67df23d47903ccbee2d7d9c` — 0.1.8
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `bba2929` — 0.1.8

### v0.1.9

- 需求文档：[release-notes-0.1.9.md](release-notes-0.1.9.md)
- 完成提交：`0f2169710dd67effc30811387c1f99d6189853b2` — 0.1.9
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `f05e988` — 优化
  - `1257715` — 代码高亮
  - `0f21697` — 0.1.9

### v0.2.0

- 需求文档：[release-notes-0.2.0.md](release-notes-0.2.0.md)
- 完成提交：`80ab40197939eae6049481e3f686127d0cb235d9` — chore 恢复 package-lock.json
- 依据：功能源码完成于 fd561d8；该提交误删锁文件，80ab401 恢复。因此标签指向补齐构建依赖文件的完成快照。
- 实现相关提交：
  - `7d35859` — 优化拖拽
  - `fd561d8` — 0.2.0
  - `80ab401` — chore 恢复 package-lock.json

### v0.2.1

- 需求文档：[release-notes-0.2.1.md](release-notes-0.2.1.md)
- 完成提交：`8285523879e5e81427174ed451c730b74798114f` — 0.2.1
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `8285523` — 0.2.1

### v0.2.2

- 需求文档：[release-notes-0.2.2.md](release-notes-0.2.2.md)
- 完成提交：`136efbd07aadbffa6b0063af0df9c1aeffc3044b` — 0.2.2
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `136efbd` — 0.2.2

### v0.2.3

- 需求文档：[release-notes-0.2.3.md](release-notes-0.2.3.md)
- 完成提交：`e73957c61f2e5098167b850c08f70d4f63050ed8` — 四维偏好收敛
- 依据：最后的四维偏好收口 e73957c 已包含配色/边框/连线及模块收口；e653fc8 主要补版本、说明和截图。
- 实现相关提交：
  - `a13f905` — 模块化编程改进
  - `040f30a` — 修复 knip 报出的无用类型再导出（CI check:dead-code）
  - `b61ec1b` — 模块优化
  - `c56507d` — 修复同段多枚粗体被吞、下划线粗体嵌套外露
  - `ee069ea` — 整理图片调宽模块，修复新窗口里手柄不出现
  - `fce26c1` — 修复调宽保存把图片引用改写成完整路径
  - `7cb115d` — 图片新建引用改跟官方 New link format，同步文档
  - `68691bf` — docs(standard): 修复指针与结构，外迁修复史，新增文档一致性门禁
  - `01348b9` — feat(toolbar): 连线样式收敛为折线/曲线两态，固定直线布局显示「直线」
  - `07b9e01` — test(toolbar): 锁定连线样式顺序与旧值归一；applyLineStyle 写入侧归一
  - `d036023` — K127 节点外观主题
  - `aaa2bd8` — K128 配色与边框
  - `7169f10` — 围栏块跟随默认边框
  - `e73957c` — 四维偏好收敛

### v0.2.4

- 需求文档：[release-notes-0.2.4.md](release-notes-0.2.4.md)
- 完成提交：`00453daa793b5d8f3027ac6696a44dd68951ff81` — 0.2.4
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `a121702` — refactor(domain): 预编译 url 谓词正则，消除逐 token RegExp 分配
  - `5f7b752` — refactor(domain): wikilink 去 [[..]] 往返，linkDisplayText 去数组/正则
  - `843f5cb` — refactor(domain): 显示名只解析一次，删除无消费方的 withWikilinkAlias
  - `96fce9e` — refactor(domain): pipe-table 行切分改游标切片，去掉逐字符拼接
  - `8a799c1` — refactor(core): mapWithConcurrency 收尾判定只留一处
  - `3c72891` — refactor(links): file-lookup 后缀回退改逐级拼接，去掉临时数组
  - `8fe93fe` — refactor(links): encodedNameForm 提到形态循环外，stripMd 正则预编译
  - `8c454c2` — refactor(markdown): 抽出 md-outline-lines（逐行分类），md-outline 1159→941
  - `0c3c8f3` — refactor(markdown): 抽出 md-serialize-anchors（锚点三件套），md-serialize 1248→1143
  - `03d44ef` — refactor(markdown): md-serialize 按图片族/链接族纯排布（101 行换位）
  - `1013775` — refactor(markdown): 图片族整族抽出 md-serialize-inline，md-serialize 1157→915
  - `64a6095` — refactor(markdown): 行内 token 族抽出 md-outline-inline，md-outline 941→702
  - `2155df4` — refactor(engine): 抽出 mindmap-icons 与 mindmap-arrange，mindmap 759→623
  - `1035c96` — refactor(engine): 抽出 mindmap-viewport-canvas（画布几何族），viewport 1058→890
  - `2b9a114` — refactor(platform): 抽出 math-jax-char-rules（字符规则族），math-jax 1090→868
  - `0c5750a` — refactor(platform): 抽出 prism-code-color-probe，prism-code 444→393
  - `58bab94` — perf(features): protectedRanges 复用模块级扫描器（bench 无差异，仅去分配）
  - `3b8a723` — refactor(services): 抽出 engine-controller-deps（依赖契约），engine-controller 822→722
  - `465d96b` — refactor(services): 视口状态收进 ViewportSession，engine-controller 722→672
  - `ebb68ed` — refactor(services): options 构造外移为 buildCreateOptions，engine-controller 672→631
  - `a31e593` — refactor(features): 加载会话收进 LoadSession，view 1255→1235
  - `babf257` — refactor(features): 抽出 view-node-link-plan（链接规划族），view-node-actions 862→719
  - `204aa3b` — refactor(features): view-dnd 提取 resolveDropHost 与 importDroppedIntoVault
  - `0b65b49` — refactor(features): mindmap-codeblock 的 mount 拆为建引擎/绑事件/兜底帧三步
  - `d67ab00` — refactor(features): content-remeasure 的 flush 拆为挂起/反查/产物回退三步
  - `0fdfe56` — refactor(features): openNodeInlineEditor 拆为建元素/落位/绑输入三步
  - `00453da` — 0.2.4

### v0.2.5

- 需求文档：[release-notes-0.2.5.md](release-notes-0.2.5.md)
- 完成提交：`843849ef676c984679f534ed99cea4b1db4eb0cb` — 0.2.5
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `d0d38b0` — 「自动整理」功能保留视口
  - `d90734a` — 默认无边框
  - `4a2e10c` — 「小地图」新增功能
  - `ac11b6b` — 滚轮手势
  - `8a97f75` — 「剪贴板」全局复制
  - `f59248d` — UI优化
  - `843849e` — 0.2.5

### v0.2.6

- 需求文档：[release-notes-0.2.6.md](release-notes-0.2.6.md)
- 完成提交：`5e28888aea6a2c81cd6e5298dd9d015fc592017a` — 0.2.6
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `5e28888` — 0.2.6

### v0.2.7

- 需求文档：[release-notes-0.2.7.md](release-notes-0.2.7.md)
- 完成提交：`e810c2c4a4526f6f6081519498e3fd942c0a8712` — 0.2.7
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `e810c2c` — 0.2.7

### v0.2.8

- 需求文档：[release-notes-0.2.8.md](release-notes-0.2.8.md)
- 完成提交：`4284adbc79df4e0cd909ac336749fa00b7a09876` — 0.2.8
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `4284adb` — 0.2.8

### v0.2.9

- 需求文档：[release-notes-0.2.9.md](release-notes-0.2.9.md)
- 完成提交：`d4ed6122f29c5ea43fb771e0a96cebde9b7e8dbb` — 主题：标签 pill 与任务复选框跟链接色同源（K151）
- 依据：e8aa947/c56417d/d4ed612 完成离屏残渣、节点配色和链接色收口；f8df38e 只整理说明与版本元数据。
- 实现相关提交：
  - `e8aa947` — 修复：引擎离屏测量容器残渣（K152）
  - `c56417d` — 配色：节点级配色改主色派生
  - `d4ed612` — 主题：标签 pill 与任务复选框跟链接色同源（K151）

### v0.3.0

- 需求文档：[release-notes-0.3.0.md](release-notes-0.3.0.md)
- 完成提交：`ef5a566632c65e158fc4ec88e699972ffe4e3cdc` — 0.3.0
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `ef5a566` — 0.3.0

### v0.3.1

- 需求文档：[release-notes-0.3.1.md](release-notes-0.3.1.md)
- 完成提交：`9123c29e5ea18213c48b6afab9eb19175de1614c` — 0.3.1
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `9123c29` — 0.3.1

### v0.3.2

- 需求文档：[release-notes-0.3.2.md](release-notes-0.3.2.md)
- 完成提交：`399f917c77cd7f3c562cdd97372a0b14bb9aab57` — 0.3.2
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `888e11a` — docs: 文档契约与代码结构索引同步（K1-K167）
  - `302564c` — perf(engine): 布局偏移记账 + 一次物化（补丁 16/17）
  - `9d6f8cc` — refactor(markdown): 缩进单位判据收口与注释整理
  - `399f917` — 0.3.2

### v0.3.3

- 需求文档：[release-notes-0.3.3.md](release-notes-0.3.3.md)
- 完成提交：`a71469200b936dff88d1c32a7c88ecfd99030f4e` — 0.3.3
- 依据：版本提交同时包含功能代码/引擎补丁/工程实现，已按文件差异核对。
- 实现相关提交：
  - `a714692` — 0.3.3

## 使用

```bash
git show v0.1.5
git diff v0.1.4 v0.1.5
git log --oneline v0.1.4..v0.1.5
git show --no-patch v0.3.3
```

首版没有可恢复的开发前 base，不合成空白提交或改写仓库历史。
