[中文](#cn-v0.3.1) | [English](#en-v0.3.1)

0.3.1 加入「概要」：把同一父节点下相邻的若干条主题括起来，挂一句说明——文件里只多一行 `%%sum:2 | 本周必须完成%%`，正文一个字符都不动。在空白处按住右键拉框选中一段主题，松手弹出的菜单首项就是它。

这一版也把「打开」这件事收拾干净了：只是打开看一眼不再重排文件（加载基线）、撤销链从打开那一刻起算、启动恢复不再先闪一屏 Markdown 原文（436 ms → 10 ms）；大图首帧与首次导出也都补上了可见反馈——这五处原本都是「界面没变、体验差一截」的静默问题。

<h3 id="cn-v0.3.1">新增</h3>

* **概要（Summary）**：右键节点 →「概要」；建 / 改 / 删各是**一次提交、一条撤销**
  * 菜单标题自己说明走哪条路：右键时已多选到 **≥2 个相邻同级**（且未与已有概要重叠）⇒ 写「概要（覆盖 N 个）」按选中集合直接建；其余 ⇒ 写「概要…」，进入**两次点选**（起点 = 右键的那个节点，再点一下落定终点；终点可点在起点**前面**，区间取两端之间）
  * 语法 `%%sum:<count> | 文字%%` 写在**第一个被覆盖的兄弟**上，`count` = 从它起连续覆盖的同级节点数（`1..999`）。锚第一个兄弟而不是父节点：锚父节点得写「第几个到第几个」，在前面插一个兄弟整段区间就错位；锚第一个兄弟时只有**区间内部**的增删才改变覆盖面
  * 多选跨分支时**自动拆成多条**（XMind 同款）；一段一行，与 `%%id%%` / `%%rel%%` 同处一个指令块——写联系只替换 `id` / `rel` 段、写概要只替换 `sum` 段，两个特性互不抹除
  * 弹窗取消则一个字节都不写；区间与文字都合法后**一次批量提交**（一次渲染 / 一次保存 / 一条撤销）
  * 改文字：双击概要节点 / 选中后 `F2` / 右键「编辑概要文字」；删：右键「删除概要」/ `Delete` / `Backspace`。概要节点的右键菜单是**独立一套**（只有这两项）——正文那套编辑项对它全是错的
  * **为什么不走引擎内联编辑**：概要文字只存在于正文的 `%%sum%%` 段，`SET_NODE_TEXT` 只改派生 data，下一轮同步就被正文覆盖回来（用户观感「打字一闪就没了」），与联系标签同一取舍
  * 观感：小一号字 + 恒 1px 虚线框（**不吃「边框」开关**——无边框档位下正文节点全透明，虚框是概要唯一的身份线索）；括号线与父子线同色同粗
  * 只读 `mindmap` 围栏块照样画概要（不接编辑入口）
  * 边界：中心主题不能作概要对象（可以当父节点）；不支持拖框调范围；不支持给概要加子主题（文件模型只有一行文字）
* **右键框选 → 选区菜单**：在空白处按住右键拉框，松手弹「概要（覆盖 N 个）」/「复制」（选区不成段时首项写「概要…」，进入两次点选），不再是那份与选区毫无关系的空白菜单
  * 判据：画布 **capture** 记右键按下点，`contextmenu` 到达时算位移，**> 5px 视为拖拽**；单击（≤ 5px）照旧弹节点 / 空白菜单
  * **为什么不在 `contextmenu` 里直接读选中**：引擎的框选在**防抖的 mousemove** 里落地，实测松手后约 150ms 才进 `activeNodeList` ⇒ 当场读到的是上一轮的选中（框住空白时会弹出一个「概要…」的假菜单）。改为一律挂起、等 `node_active` 到了再决定，另设 250ms 兜底（框出来的正好是原选中时引擎不发事件）
  * **为什么挂在 capture**：框选结束时指针常正压在节点上，节点自己的 `contextmenu` 处理器会把事件吞掉（既不 emit `node_contextmenu`、也不冒泡）⇒ 挂在冒泡阶段的判定永远轮不到，表现就是「框选完没反应」
  * 框选后随手右键空白：引擎在右键按下时清空选中，菜单会把这份选中复原——上半段是选区操作、分隔线之下是**空白菜单全套**（不必为了「新建节点」先取消选中）
  * 选区菜单只放作用于整个集合的条目：**没有「删除」**——`deleteActiveNode` 只删一个节点，多选下与「删除 3 个」的直觉不符
* **大图首帧提示**：≥1000 个节点时画布上显示「正在渲染 N 个节点…」，首帧结束即摘
  * 实测 5000 节点首帧是**单个 2.2s 的同步长任务**（全在引擎 `_render()` 内，插件侧处理链只占 5ms），此前就是空白画布 + 界面无响应；502 节点 47–103ms，低于阈值不弹——那点等待在「打开一个标签」的容差内，提示反而是一次闪现
* **导出进度提示**：首次导出要先预取数学字体（实测 385 节点含公式图 **24s**，同会话第二次 0.7s），此前整段没有任何反馈，用户会以为卡死并重复点击
  * 超过 400ms 才弹，完成 / 失败 / 视图被关都撤；小图（<120ms）不闪

<h3>变更</h3>

* **指令块一段一行**：`%%id%%` 与每条 `%%rel%%`（以及新的 `%%sum%%`）各占一行，写侧规范顺序 `id → rel → sum`——一条边一行，改哪条看哪行；枢纽节点不再出现 700 字符的长行。**旧的一行多段形态仍照读**，只在该节点下次被联系 / 概要操作改写时归一；改文本走原样回贴，不动用户手写的形态
* **指令行判定只认形状与已登记的 key**：写错的 value（`%%rel:xyz%%`）仍是指令行（隐藏、不产生语义），不再在画布上冒出一个空节点
* **联系与概要共用一套点选会话**：`node_click` / `draw_click` 各只有一个，两特性各持一份必然互相看不见、`Esc` 也只能取消其中一方；现在 `Esc` 取消的是当前正在进行的那个（联系或概要），引擎重建时统一清理
* **固定直线布局的连线开关置灰**：目录组织图 / 时间轴 / 鱼骨图的连线由布局类自绘，开关此前显示「直线」这类描述，现在按不可用处理（视觉仍只有图标，置灰即表达「不可切换」）
* **撤销 / 重做按钮按历史可用性置灰**：此前恒为可点态——刚打开时（`activeHistoryIndex` 停在 0）点「撤销」毫无反应，用户只会以为按钮坏了。现在没有可退的历史就置灰，编辑后亮起、撤销后转灰；判据与引擎 `UNDO` / `REDO` 自身的早退条件同一口径（`index - 1 >= 0` / `index + 1 < length`），按钮状态与「点了有没有用」永远一致
* **首次打开宽图自动适应画布**：没有保存视口时，若内容在 100% 下装不进画布就改走「适应画布」——实测 385 节点图此前首开只有约 1/10 可见，必须自己点「总览」；装得下的小图仍按 100% 居中，「打开就是原样」的观感不变（有保存视口时照旧恢复，不做任何自动调整）
* **选区菜单的「复制」报数量**：多选时写「复制 N 个节点」，与同菜单的「概要（覆盖 N 个）」同一口径——只写「复制节点」看不出复制的是整个选区还是单个节点
* **概要弹窗区分创建与编辑**：创建时标题「新建概要」、输入框**留空**（占位符「概要文字」）、按钮「创建」——此前复用编辑场景的「编辑概要文字」并预填「概要」，回车就会落盘一条名为「概要」的概要；编辑时仍是「编辑概要文字」/「应用」并预填当前文字

<h3>修复</h3>

* **只是打开看一眼，文件不再被重写**（K156）
  * 症状：把笔记切到导图看一眼（**不编辑**），空行被归一、松散列表变紧凑——实测打开后 1.1s 文件 mtime 就变了，此时**尚未关闭视图**
  * 成因：序列化带规范化，与磁盘原文天然不等；而「无差异就跳过写盘」比的是**磁盘当前内容**，规范化结果永远「有差异」⇒ 必写
  * 修法：加载完成、引擎建好后记一份序列化结果作**基线**，保存时本轮序列化与之**逐字相同**即跳过写盘。判据是「与**加载时**相同」而不是「与磁盘相同」——后者正是拦不住规范化的那一项；只比**正文**（文件头恒取磁盘当前值，只改属性 / 切布局不连带重排正文）；跳过写盘仍按磁盘当前内容建立外部改动检测的基线
  * 后台标签 / 折叠面板同样拦住：容器 0 尺寸时引擎先不建，基线改为「引擎就绪时消费」——此前直记会被空守卫静默吞掉，该文件此后每轮自动保存都不再算纯浏览
* **撤销：第一次编辑撤得掉，撤到原样也真的落盘**（K160）
  * 症状两条、互相掩盖：打开导图后**第一次**编辑按 `Ctrl+Z` 毫无反应（勾选任务、内联改字都一样）；编辑 → 撤销后屏上回到原样而**文件仍是改后内容**，关标签再重开又跳回改后
  * 成因：引擎创建后历史是空的，第一条快照只能落在第一次改动之后 ⇒ index 停在 0，`Ctrl+Z` 直接返回
  * 修法：首帧渲染结束时播种第 0 条快照。**时机必须在渲染之后**——创建瞬间的树还没被引擎规范化，早播会多出一条「按 `Ctrl+Z` 毫无反应」的历史；且必须用**非防抖**的 `originAddHistory`，否则与紧随的编辑合并成一条。另：本会话**写过盘之后**，「撤销回加载态」在磁盘上就是一次真实改动，守卫让路并写回**加载时的原样正文**（按 `wroteSinceLoad` 分辨，不能用「与磁盘比」代替——那会把「浏览时他处改了文件」也变成一次覆盖）
* **写完自检**（K158）：自动保存**真的写过盘**的轮次，排空收尾再用同一序列化算一次活快照，与刚写出的不同就补排（每路径最多 3 次，超限只留痕）；冲突跳过 / 写盘异常 / 显式保存三种收场**不补排**（补排会把冲突刷成重试风暴）
* **概要不会因文件被手改而静默失效**：越界 `count` 读到即夹到最后一个兄弟（文件里的数字原样保留，静默改写会破坏逐字保真）；反查哪条声明用**规划器自己的区间**，不按 `count` 对宽度——先给 4 个兄弟加概要、再删掉其中 1 个，按值认领会返回 null，表现是「右键概要 / 按 `Delete` 毫无反应」；反查失败给可见提示，不静默 no-op
* **竖栏两态开关补 `aria-pressed`**（K159）：视觉仍只由图标表达，但读屏器此前读到的只是一个普通按钮；按下态口径 = **图标所示那一档**（边框 = 有边框、连线 = 曲线），每次状态同步都重挂（官方 `setTooltip` 会重写 `aria-label`），置灰的连线开关不写
* **打开导图不再先闪一屏 Markdown 原文**：Obsidian 打开文件是**先**建 markdown 视图并渲染、之后插件才切视图。普通打开只差一两帧（实测 11 ms，人眼基本看不见），但**启动恢复**（重启 Obsidian / 重载库）此前要等首档 400 ms——实测满屏原文停留 **436 ms**，这才是「一闪而过」的来源。三处一起改：
  * 启动恢复首档提前到 **0 ms**：Obsidian 通常是先恢复完工作区、再加载社区插件，插件 onload 时叶子早已就绪，400 ms 纯粹白等；未就绪时仍有 400 / 1500 / 3500 三档兜底
  * `file-open` 按文件名**立即**切换（不等 50 ms 防抖的全量扫描）；叶子尚未绑定文件时（恢复的常见顺序）16 ms 后重试一次，用 `setTimeout` 而非 `requestAnimationFrame`——窗口最小化 / 被遮挡时 rAF 不执行，而启动恢复恰恰可能发生在那种状态
  * 切换期间给 `.workspace-leaf` 挂 `mindmap-view-switching`，把内容区藏起来（只改可见性、保留布局，不跳动），顺手盖住引擎初始化那段空白；成败都摘，失败时留着就是该标签永久空白
  * 实测：**436 ms → 10 ms**
* **同一个标签不会被切两次**：`active-leaf-change` 与 `file-open` 会同时命中同一个 leaf，不去重就会 `setViewState` 两遍——第二遍在遮罩摘掉之后，画面重新闪回 Markdown。现在按 leaf 存 in-flight Promise；另有 **3 s 兜底超时**：`setViewState` 真挂起时摘掉登记允许重试，否则该文件此后**永远**打不开导图（表现为「点了没反应」，控制台还干净）
* **导出成功后给出提示**：文件落在**系统下载目录**，此前成功与否没有任何界面反馈（快路径连进度条都不弹），用户不知道成没成、去哪找；现在完成时报「已导出 xxx.png（系统下载目录）」
* **状态栏节点数不再停在 0**：加载那一刻引擎还没建（`renderer.root` 尚为 null），`updateStatusBar` 算得 0，而此前没有后续刷新点——打开大图后状态栏一直显示「0 个节点」，切走再切回（`active-leaf-change`）才恢复。现在首帧渲染落地即刷新。**不能用「第一次渲染」去重**：引擎初始化会先发一轮 `node_tree_render_end`，那时渲染树尚未回填，去重就把修复吃掉了（实测仍显示 0）
* **无效的编辑项一律置灰（中心主题 + 首 / 末个兄弟）**：中心主题的「添加同级 / 上移 / 下移 / 删除」、首个兄弟的「上移」、末个兄弟的「下移」此前都照旧可点——它没有兄弟，删除也无意义，点了要么毫无反应、要么得到一句「已是第一个」的假话，与同菜单里已置灰的「联系 / 概要」自相矛盾。现在判据前置：中心主题按 `isRoot`，首 / 末按 `siblingMoveBlocker`（与动作层**同一份**实现，`moveNodeInSiblings` 内部也调它），菜单状态与「点了有没有用」不会各说各话
* **概要括号线不再从「＋」展开按钮上穿过**：引擎默认的括号起笔留白是 0（紧贴被覆盖节点的右缘），而展开按钮也挂在那里、垂直居中，线的凸起方向正好压在按钮上——想展开子节点时容易点到线。主题配置给 `generalizationLineMargin` 留出 12px，线改从按钮外侧起笔；概要框随之再外移 12px（它本来就在线外侧 20px），整幅观感不变
* **「返回 Markdown」说清它改了什么**：这一步会**持久改写文件属性**（`Mindmap: <布局>` → `Mindmap: Markdown`），此前静默完成，用户以为只是换了个视图；现在提示「已切回 Markdown；该文件属性已改为 Mindmap: Markdown」。降级本身不变（重开仍是普通笔记，只有显式命令才切回导图）

<h3>工程</h3>

* 新增模块：`src/domain/directive.ts`（指令块语法的唯一实现：段形状 / 行判定 / 尾块拆贴 / 规范顺序）、`src/domain/summary.ts`（值语义 + 范围规划 + 区间反查）、`src/engine/mindmap-summaries.ts`（引擎落点：父节点 `generalization`）、`src/features/node-pick.ts`（点选会话，联系与概要共用）、`src/features/view-node-summary.ts`、`src/ui/modal-summary-text.ts`
* `domain/relation` 只解释 `id` / `rel` 的 value，语法层与 `summary` 共用 `domain/directive`（`DIRECTIVE_KEYS` 是唯一关键字表；不登记的 key 按普通注释处理）
* `SavePipeline`：`markLoaded` 记基线（`loadedBody` / `loadedRawBody` / `wroteSinceLoad`）+ 收尾一致性自检；`DocumentService` 的加载结果带上原文正文
* `engine/mindmap-history.seedInitialHistory`：挂在**一次性**的 `node_tree_render_end` 上播种第 0 条快照（只读嵌入不播种）
* vendor 运行时**未改动**（只有 `simple-mind-map.d.cts` 的类型补齐）；删掉 7 个已无入口的文案键（6 个工具栏 tooltip + `lineStyle.fixedStraight`）
* 语法写进 `docs/markdown-mindmap-standard.md`（`sum` 段的读写规范，以及指令块「一段一行」与 `id → rel → sum` 的段序）；行为口径写进 `AGENTS.md` 决策表与 `docs/agents/conventions.md` 的 K156–K163
* `platform/mindmap-auto-open`：启动首档提到 0 ms、`file-open` 按文件名立即切换（16 ms 重试一次）、切换入口用 `Promise.resolve` 包一层（入口被替换成同步实现时不至于抛未捕获异常）；`markdown/md-open.openAsMindMap`：切换遮罩 + 同 leaf 并发去重（`WeakMap` + 3 s 兜底超时）；`engine/mindmap-history.readHistoryAvailability`：撤销/重做按钮的唯一判据
* 测试：新增 `summary-directive` / `engine-summaries` / `node-pick` 三个文件；全量 **102 文件 / 2760 例**（本轮补了历史可用性、中心主题与首末兄弟的置灰矩阵、括号留白、遮罩与并发去重、`file-open` 立即切换、启动四档）；门禁 `build` / `test` / `lint` / `lint:css` / `check:release` 均通过

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖；**`styles.css` 有变化**（大图首帧提示、自动打开切换期间的遮罩）——三件套（`main.js` / `manifest.json` / `styles.css`）请一起替换
* **没有概要指令的文件完全不受影响**：打开、编辑、保存都不产生新行；纯浏览在同一版里也根本不会写盘
* **没有新增命令、没有新增设置键**：命令 ID 与 `data.json` 结构不变；概要只有右键入口（节点 / 选区菜单），不占用快捷键
* **文件格式只有一个新增元素**：`%%sum:<count> | 文字%%`，与 `%%id%%` / `%%rel%%` 同处一个指令块（规范顺序 `id → rel → sum`）；概要文字写在指令里，节点正文一个字符都不加，未编辑行仍逐字回写
* **回滚到 0.3.0**：`%%sum%%` 行不再被识别为指令——挂在列表项下的那行按续行并进上一项，挂在标题 / 段落下的成为空节点（注释语法照旧隐藏）。**文件不会被改写**，重新升级即恢复；要彻底清理，删掉以 `%%sum:` 开头的整行即可
* **已知边界**：中心主题不能作概要对象；概要范围不支持拖框调整、不支持挂子主题；框选命中是**相交判定**（垂直排布时下沿擦到邻居会顺手带上）；`Ctrl`/`Cmd` + 左键拖也能框选，但那条路径不产生 `contextmenu`，因此没有选区菜单；切换遮罩按 Obsidian 的 `.workspace-leaf-content` / `.view-content` 类名生效，上游若再调整层级会退化成「闪一屏原文」的旧观感（只影响观感，不影响切换本身）

---

0.3.1 adds **summaries**: bracket a run of adjacent sibling topics under one sentence — the file grows one comment line (`%%sum:2 | Must ship this week%%`) and not a single character of the body changes. Hold the right button on empty canvas to box-select a run, and the menu that appears on release leads with it.

This release also tidies up **opening** a map: looking at one no longer rewrites the file (a load baseline), the undo chain starts at the moment you opened it, and startup restore no longer flashes a screenful of Markdown (436 ms → 10 ms); the first frame of a large map and the first export got something visible to show as well — five silent problems where nothing looked different, only felt worse.

<h3 id="en-v0.3.1">Added</h3>

* **Summaries**: right-click a node → "Summary"; create / edit / delete are each **one commit and one undo step**
  * The menu title says which path it takes: with **≥2 adjacent siblings** already selected (and no overlap with an existing summary) it reads "Summary ({count} topics)" and builds straight from the selection; otherwise it reads "Summary…" and enters **two-click picking** (the start is the node you right-clicked, then click the last topic; the end may be *before* the start, the range is between them)
  * Syntax: `%%sum:<count> | text%%` on the **first covered sibling**, where `count` is how many adjacent siblings are covered starting there (`1..999`). Anchoring the first sibling rather than the parent: a parent anchor would have to say "from index 3 to index 5", and inserting one sibling earlier shifts the whole range; with a first-sibling anchor only insertions *inside* the range change what is covered
  * A selection spanning branches **splits into several summaries** automatically (as XMind does); one segment per line, in the same directive block as `%%id%%` / `%%rel%%` — writing a relationship only replaces the `id` / `rel` segments, writing a summary only replaces `sum`, so the two features never erase each other
  * Cancelling the dialog writes not a single byte; once range and text are valid it lands as **one batch commit** (one render / one save / one undo)
  * Edit the text: double-click the summary node / select it and press `F2` / right-click → "Edit summary text"; delete: right-click → "Delete summary" / `Delete` / `Backspace`. A summary node has its **own** context menu (just those two entries) — the regular editing entries are all wrong for it
  * **Why not the engine's inline editor**: summary text lives only in the `%%sum%%` segment of the note; `SET_NODE_TEXT` touches derived data only, and the next sync overwrites it from the note (users saw "I type and it vanishes"), the same trade-off as relationship labels
  * Look: one size smaller plus a fixed 1 px dashed frame (**deliberately ignores the border toggle** — with borders off every body node is transparent, so the dashed frame is the only cue that this is a summary); the bracket line matches parent-child lines in colour and weight
  * Read-only `mindmap` fenced blocks draw summaries too (with no editing entries)
  * Limits: the central topic cannot be summarized (it can be the parent); no drag-to-resize; no child topics under a summary (the file model has one line of text)
* **Right-drag box selection → selection menu**: box-select on empty canvas and release, and the menu leads with "Summary ({count} topics)" / "Copy" (when the selection is not one contiguous run the first entry reads "Summary…" and starts two-click picking) instead of the blank-canvas menu that had nothing to do with the selection
  * Test: record the right-button press point on the canvas in the **capture** phase; on `contextmenu`, a displacement of **more than 5 px counts as a drag**, and a click (≤ 5 px) keeps the usual node / blank menus
  * **Why not read the selection inside `contextmenu`**: the engine lands box selection inside a **debounced `mousemove`** — about 150 ms after release, so the list still holds the *previous* selection (box an empty area and you would get a bogus "Summary…" menu). So the menu is always deferred until `node_active` arrives, with a 250 ms fallback (the engine emits nothing when the box selects exactly what was already selected)
  * **Why the capture phase**: at release the pointer usually sits **on a node**, and the node's own `contextmenu` handler swallows the event (no `node_contextmenu`, no bubbling) — a bubbling-phase test never runs, which looked like "boxing does nothing"
  * Right-clicking empty canvas afterwards clears the selection in the engine, so the menu restores it: selection actions on top, a divider, then the **full blank-canvas menu** (you should not have to deselect just to add a node)
  * The selection menu only lists entries that act on the whole set: **no "Delete"** — `deleteActiveNode` deletes one node, which contradicts "delete 3"
* **First-frame hint for large maps**: at ≥1000 nodes the canvas shows "Rendering {count} nodes…" until the first frame lands
  * Measured: a 5000-node first frame is **one 2.2 s synchronous task** (all inside the engine's `_render()`; the plugin's own handler chain is 5 ms), which used to mean a blank canvas and an unresponsive window; 502 nodes take 47–103 ms, below the threshold, where the hint would merely flash
* **Export progress**: the first export primes the math fonts (measured **24 s** for a 385-node map with formulas, 0.7 s on the second run in the same session) and used to show nothing at all, so users assumed a hang and clicked again
  * Appears only after 400 ms and is dismissed on success, failure and view close; small maps (<120 ms) never flash

<h3>Changed</h3>

* **One directive segment per line**: `%%id%%` and each `%%rel%%` (plus the new `%%sum%%`) get their own line, in the canonical order `id → rel → sum` — one edge per line, so a diff points at the exact edge, and hub nodes no longer produce 700-character lines. **The old multi-segment line is still read**, and is normalised only when that node is next edited by a relationship or summary action; editing text pastes the tail back verbatim and leaves hand-written shapes alone
* **Directive-line detection checks shape and registered keys only**: a bad value (`%%rel:xyz%%`) stays a directive line (hidden, no semantics) instead of turning into an empty node on the canvas
* **Relationships and summaries share one pick session**: there is exactly one `node_click` / `draw_click`, so two private sessions would be blind to each other and `Esc` could only cancel one of them; now `Esc` cancels whichever is active, and an engine rebuild clears it
* **The line-style toggle is disabled on fixed-straight layouts**: catalogue, timeline and fishbone draw their own connectors, so the toggle used to show a "Straight" description; it now reports itself as unavailable (the icon still carries the look, disabled expresses "cannot switch")
* **Undo / redo grey out when there is nothing to do**: they used to be always clickable — right after opening (`activeHistoryIndex` at 0) "Undo" did nothing and simply looked broken. They are now disabled without undoable history, light up after an edit and grey out again after an undo; the test matches the engine's own early-return conditions for `UNDO` / `REDO` (`index - 1 >= 0` / `index + 1 < length`), so the button state always agrees with "would clicking do anything"
* **Wide maps fit the canvas on first open**: without a saved viewport, content that does not fit at 100% now goes through "fit to canvas" — a 385-node map used to show roughly a tenth of itself on first open and required clicking "Fit"; small maps that do fit still open at 100% centred, so "it opens exactly as it is" is unchanged (a saved viewport is still restored verbatim, with no automatic adjustment)
* **The "Copy" entry in the selection menu reports a count**: with a multi-selection it reads "Copy {count} topics", matching "Summary ({count} topics)" — plain "Copy node" did not say whether the whole selection or a single node was copied
* **The summary dialog distinguishes create from edit**: on create the title is "New summary", the input is **empty** (placeholder "Summary text") and the button reads "Create" — it used to reuse the edit wording "Edit summary text" with "Summary" pre-filled, so pressing Enter wrote a summary literally named "Summary"; on edit it is still "Edit summary text" / "Apply" with the current text pre-filled

<h3>Fixed</h3>

* **Opening a map no longer rewrites the file** (K156)
  * Symptom: switching a note to the map view (no edits) normalised blank lines and turned a loose list into a tight one — on device the mtime changed 1.1 s after opening, **before the view was even closed**
  * Cause: serialisation normalises, so it never matches the bytes on disk, while "skip the write when nothing differs" compared against the **current file** — so there was always a difference
  * Fix: once loading finishes and the engine is up, the serialised result becomes a **baseline**; if a save round serialises **byte-identically**, nothing is written. The test is "same as at **load time**", not "same as on disk" — the latter is exactly what failed to stop normalisation. Only the **body** is compared (the frontmatter always comes from disk and the pipeline never changes it, so editing properties or switching layouts must not reflow the body). A skipped write still establishes the external-change baseline from the file's current content
  * Background tabs and collapsed panes are covered too: with a zero-sized container the engine is not created yet, so the baseline is now consumed when the engine becomes ready — recording it earlier was silently swallowed by an empty guard, and that file then never counted as "browsing only" again
* **Undo starts at the moment the map opened, and undoing to the original really reaches the disk** (K160)
  * Two symptoms masking each other: the **first** edit after opening could not be undone (`Ctrl+Z` did nothing — toggling a task, editing text inline, all the same); and after edit → undo the screen showed the original while the **file still held the edit**, so closing the tab and reopening jumped back to the edited state
  * Cause: the engine's history is empty once created, so the first snapshot could only appear *after* the first change — the index stayed at 0 and `Ctrl+Z` returned immediately
  * Fix: seed snapshot 0 when the first frame finishes rendering. **It has to be after rendering** — the tree is not yet normalised at creation time, and seeding early adds one history entry where `Ctrl+Z` does nothing; it also has to use the **non-debounced** `originAddHistory`, otherwise it merges with the edit that follows. Separately, once this session **has written to disk**, "back to the loaded state" is a real change on disk, so the guard steps aside and writes back the **original body as loaded** (keyed on `wroteSinceLoad`; comparing with the file instead would turn "someone else edited the note while you browsed" into an overwrite)
* **Post-write self-check** (K158): on auto-save rounds that **actually wrote**, the drain loop recomputes the live snapshot with the same serialiser and reschedules if it differs from what was just written (at most 3 times per path, then only a trace); conflict skips, write errors and explicit saves deliberately **do not** reschedule (retrying would turn a conflict into a retry storm)
* **Summaries no longer fail silently after hand edits**: an out-of-range `count` clamps to the last sibling on read (the number in the file is kept — rewriting it would break verbatim round-trip); the declaration is looked up by the **planner's own range**, not by matching `count` to width — add a summary over 4 siblings, delete one of them, and a value-based lookup returns null, which showed up as "right-clicking the summary or pressing `Delete` does nothing". A failed lookup now says so instead of being a silent no-op
* **Two-state toggles expose `aria-pressed`** (K159): the look is still carried by the icon alone, but a screen reader used to hear just "button"; the state reported follows **the tier the icon shows** (border = bordered, line = curve), it is re-applied on every state sync (the official `setTooltip` rewrites `aria-label`), and a disabled line toggle reports nothing
* **Opening a map no longer flashes a screenful of Markdown**: Obsidian opens a file by building the markdown view and rendering it **first**, and only then does the plugin switch views. A plain open is one or two frames (measured 11 ms — effectively invisible), but **startup restore** (restarting Obsidian / reloading the vault) used to wait for the first 400 ms step — measured **436 ms** of fully rendered Markdown, which is the flash users reported. Three changes together:
  * the first startup step now fires at **0 ms**: Obsidian normally restores the workspace before loading community plugins, so the leaves are already ready and the 400 ms was pure waiting; the 400 / 1500 / 3500 steps remain as fallbacks when they are not
  * `file-open` switches **immediately** by file name (no 50 ms debounced full scan); when the leaf has not bound the file yet (the common order during restore) it retries once after 16 ms, using `setTimeout` rather than `requestAnimationFrame` — rAF does not run while the window is minimised or covered, which is exactly when a restore can happen
  * while switching, `.workspace-leaf` carries `mindmap-view-switching`, hiding the content area (visibility only, layout preserved, nothing jumps) and covering the blank stretch while the engine initialises; the class is removed on success **and** on failure (leaving it behind would blank that tab forever)
  * measured: **436 ms → 10 ms**
* **The same tab is never switched twice**: `active-leaf-change` and `file-open` both hit the same leaf, and switching twice re-flashed Markdown after the mask had been removed. In-flight switches are now tracked per leaf, with a **3 s fallback timeout**: if `setViewState` really hangs the record is dropped so a later attempt can retry — otherwise that file would **never** open as a map again (it looked like "clicking does nothing", with a clean console)
* **Export now says it succeeded**: the file lands in the **system downloads folder** and there used to be no feedback at all (the fast path never even showed the progress notice), so users could not tell whether it worked or where the file went; it now reports "Exported {name} (system downloads folder)"
* **The node count no longer sticks at 0**: at load time the engine does not exist yet (`renderer.root` is still null), so `updateStatusBar` computed 0 and there was no later refresh point — a large map kept showing "0 nodes" until you switched away and back (`active-leaf-change`). It now refreshes when the first frame renders. **A "first render" flag does not work**: the engine emits one `node_tree_render_end` during initialisation, before the render tree is filled in, which would consume the flag (measured: still 0)
* **No-op edit entries are greyed out (central topic + first / last sibling)**: "Add sibling / Move up / Move down / Delete" on the central topic, "Move up" on the first sibling and "Move down" on the last one all stayed clickable — the central topic has no siblings, deleting it is meaningless, and clicking the others only produced a false "already the first" message, contradicting the "Relationship / Summary" entries that were already greyed out. The test now runs up front: `isRoot` for the central topic, `siblingMoveBlocker` for the ends (the **same** implementation the action uses — `moveNodeInSiblings` delegates to it), so the menu state and "would clicking do anything" can never drift apart
* **The summary bracket no longer runs through the "＋" expand button**: the engine's default bracket inset is 0 (flush against the right edge of the covered topics), while the expand button sits in exactly that spot, vertically centred — the curve's bulge lands on the button, so clicking to expand a child could hit the line instead. The theme now sets `generalizationLineMargin` to 12 px, so the line starts outside the button; the summary box moves out by the same 12 px (it already sat 20 px outside the line), leaving the overall look unchanged
* **"Back to Markdown" says what it changed**: that step **persistently rewrites the file property** (`Mindmap: <layout>` → `Mindmap: Markdown`) and used to do so silently, so it looked like a mere view switch; it now reports "Switched to Markdown; the file property is now Mindmap: Markdown". The downgrade itself is unchanged (reopening still gives a plain note, and only an explicit command brings the map back)

<h3>Engineering</h3>

* New modules: `src/domain/directive.ts` (the single implementation of directive-block grammar: segment shape / line test / tail split-and-paste / canonical order), `src/domain/summary.ts` (value semantics + range planning + reverse lookup), `src/engine/mindmap-summaries.ts` (engine mapping onto the parent's `generalization`), `src/features/node-pick.ts` (the pick session shared by relationships and summaries), `src/features/view-node-summary.ts`, `src/ui/modal-summary-text.ts`
* `domain/relation` now only interprets `id` / `rel` values; the grammar lives in `domain/directive` and is shared with `summary` (`DIRECTIVE_KEYS` is the only keyword table; unregistered keys stay ordinary comments)
* `SavePipeline`: `markLoaded` records the baseline (`loadedBody` / `loadedRawBody` / `wroteSinceLoad`) plus the post-write self-check; `DocumentService` load results carry the raw body
* `engine/mindmap-history.seedInitialHistory`: seeds snapshot 0 from a **one-shot** `node_tree_render_end` (read-only embeds do not seed)
* The vendored engine runtime is **unchanged** (only type additions in `simple-mind-map.d.cts`); seven dead translation keys were removed (six toolbar tooltips plus `lineStyle.fixedStraight`)
* The syntax is documented in `docs/markdown-mindmap-standard.md` (read/write rules for the `sum` segment, one segment per line and the `id → rel → sum` order); contracts are recorded in the `AGENTS.md` decision table and as K156–K163 in `docs/agents/conventions.md`
* `platform/mindmap-auto-open`: first startup step at 0 ms, `file-open` switches immediately by name (one 16 ms retry), the switch entry is wrapped in `Promise.resolve` (a synchronous implementation would otherwise throw an unhandled `undefined.catch`); `markdown/md-open.openAsMindMap`: switching mask + per-leaf in-flight de-duplication (`WeakMap` + a 3 s timeout); `engine/mindmap-history.readHistoryAvailability`: the single source for undo/redo availability
* Tests: three new files — `summary-directive` / `engine-summaries` / `node-pick`; full suite **102 files / 2760 cases** (this round added undo/redo availability, the disable matrix for the central topic and for first/last siblings, the bracket inset, mask and de-duplication, immediate `file-open` switching, and the four startup steps); gates `build` / `test` / `lint` / `lint:css` / `check:release` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies; **`styles.css` changed** (the large-map hint, plus the mask used while auto-opening switches views) — replace all three files (`main.js` / `manifest.json` / `styles.css`) together
* **Files without a summary directive are untouched**: opening, editing and saving produce no new lines — and on this version browsing alone does not write at all
* **No new commands and no new settings keys**: command IDs and the `data.json` shape are unchanged; summaries live only in context menus (node / selection) and claim no shortcut
* **The file format gains exactly one element**: `%%sum:<count> | text%%`, in the same directive block as `%%id%%` / `%%rel%%` (canonical order `id → rel → sum`); the summary text lives in the directive, the node body gains no characters, and untouched lines still round-trip verbatim
* **Rolling back to 0.3.0**: `%%sum%%` is no longer recognised as a directive — under a list item that line merges into the item as a continuation, under a heading or paragraph it becomes an empty node (comments are still hidden). **No file is rewritten**, and re-upgrading restores everything; to clean up for good, delete the whole lines starting with `%%sum:`
* **Known limits**: the central topic cannot be summarized; a summary's range cannot be dragged and cannot hold child topics; box selection is an **intersection** test (with vertical stacking the lower edge can catch the next sibling); `Ctrl`/`Cmd` + left-drag also boxes, but that path emits no `contextmenu` and therefore no selection menu; the switching mask keys off Obsidian's `.workspace-leaf-content` / `.view-content` class names, so a further layout change upstream degrades to the old "flashes a screenful of Markdown" look (cosmetic only — the switch itself still happens)
