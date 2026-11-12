[中文](#cn-v0.3.3) | [English](#en-v0.3.3)

0.3.2 是外观版，0.3.3 是**写法与协作**版：Markdown 的层级语法（标题 / 无序列表）可以整篇双向互转、编辑时还有一层守卫兜住「会改结构的落点」；同一张导图终于能在两个标签页里打开并共享同一份内容、撤销线与保存；节点里可以直接画 mermaid，`>` 引用与 `[!type]` 标注会还原成盒子（类型色 / 图标 / 正文递归）；属性拆成「启用 + 布局」两个键并配一次性迁移。

三件「一直别扭」的事在这一版解决：标题节点的配色指令被 Obsidian 算进标题文本（`[[#标题]]` 失效）——改为独立成行；外部改过文件后插件的旧内容会覆盖它——改为放弃写盘、载入外部版本、把你的草稿留成一步撤销；自动保存是自研的 800 ms 防抖且可关——照搬官方 `TextFileView` 的固定 2 秒。

升级时注意两点：**文件会被迁移**（旧六种布局值 → `Mindmap` + `Mindmap Layout`，只换写法、不造声明，幂等，0.4.0 删除该迁移）；**自动保存开关消失**（节奏固定 2 s，关闭 / 换文件仍立即保存）。

<h3 id="cn-v0.3.3">新增</h3>

* **层级语法：标题与无序列表双向可逆**
  * 空白处右键 →「层级语法」：无序列表 / 标题（一级）/ 标题（二级），**整篇重排**、一条撤销；勾选态取自正文实测，不存第二份状态
  * **组原子**：某一层有转不了的节点（多行 / 任务项 / 有序列表 / 围栏代码）时整层保持列表，提示点名第一个阻挡者，不做「转一半」
  * **数据保真**：转标题保留原列表标记（`*` / `+` 转回列表可恢复）；转列表时无前缀段落一并降为列表项（否则层级丢失）；有序编号按解析期记下的原值回写（`5.` 仍是 `5.`，新建项才按前一项 + 1）；行尾注释 / 链接 / 图片 / 指令行随行保留
  * **粘贴先换算**：往标题语法的层里粘贴时，能转的子树就地转成同级标题；含多行 / 任务项 / 有序列表的子树会让整次粘贴被拒绝并说明原因（不擅自改结构）
  * **新建语法设置**：「新建导图的层级语法」（无序列表 / 标题一级 / 标题二级，出厂列表）。只决定新建文件与「空文档」的种子；存量文件一律按正文自身回写，改设置不回头影响它们
* **编辑期一致性守卫**（不是每次打开都跑，只在**你编辑之后**判「这一改会不会让重开的结构变样」）
  * 列表排在标题之后 ⇒ 就地升为同级标题（转不了则撤回这次编辑并说明原因）
  * 同级标题级别递增 / 不深于父级 ⇒ 就地重定级（提示「已按该层语法调整「…」的标题级别」）
  * 标题挂在列表父下 ⇒ 整支就地降为列表；父级已是第 6 级却挂标题子节点 ⇒ 该子节点降为列表（第 7 级没有标题）；段落父下挂标题 ⇒ 撤回
  * 降级提示会报出**因此失去锚点的标题总数**（指向它们的 `[[#标题]]` 链接会失效）——一次 `Ctrl+Z` 整体复原
  * **合法的混排（列表在前、标题在后）一律不动**——手写文件打开后逐字不变；空的新建节点也不换算（不弹「已改为标题」）
* **节点内 mermaid**
  * ` ```mermaid ` 围栏在节点里直接画图：内嵌 `pele@1.13.0`（与 Obsidian 阅读视图同款渲染器），16 类图（flowchart / sequence / class / state / er / mindmap / timeline / pie / gantt / journey / gitGraph / sankey / xychart / kanban / block…）输出与宿主**逐字节相同**
  * **同步渲染**：首帧即最终尺寸，不占位、不二次重排；缓存按源码内容寻址，重建 / 重排 / 多视图不重复画
  * 悬停出现「复制源码」按钮（复制的是围栏里的原文，不是图）
  * **图内链接可点**：mermaid 的 `click A "…"` 支持库内 `[[双链]]` 与 URL——左键当前标签、`Ctrl`/`Cmd`+点击新标签、**中键也是新标签**（三条通道都拦掉了 Electron 的默认导航）
  * 图是「不透明贴纸」：底色只跟明暗，不吃节点色；主题切换同一份 SVG 即时变色（不重渲染）；导出图会带上 `--pele-*` 变量，暗色主题不会导出成白底黑字
  * 画不了就回退：语法错误 / 未注册类型 / 源码超过 20000 字符 → 回落普通代码块（控制台只留一次痕）
* **脚注（footnote）**
  * `文本[^1]` 里的引用渲染成**上标编号**：按全文首次引用顺序编号，与阅读视图一致；命名脚注（`[^note]`）同样显示数字，不再把长 id 摊在节点里
  * **悬停**浮一层定义正文，正文与节点内容同一套渲染（粗体 / 双链 / 行内码 / 表格都在）；浮层里的链接能点、文字能选中、超长时在浮层内滚动，滚轮不会把画布缩掉
  * **点击**徽标跳到定义所在节点：只展开祖先并居中，**不选中、不闪烁**——定义通常已被折叠，高亮圈住的只是一个胶囊，反而干扰
  * **定义行不再占版面**：与正文混排时只渲染正文；整节点只有定义时折叠成 **「脚注」胶囊**，点开 / 悬停看全部定义
  * **未写定义的引用**弱化显示（半透明 + 截断 id），点击提示「未找到脚注定义」，不静默失败
  * **零写盘、零字段**：`[^id]` / `[^id]: …` 在文件里仍是普通 Markdown，`text` / `mdRaw` 一字不动，浏览与交互不产生保存，也没有新增属性键
  * 只读嵌入（```` ```mindmap ````）同权：编号、悬停、点击都在块内生效
  * 边界：围栏代码块 / 缩进代码行里的同形行不算定义；行内脚注 `^[正文]` 暂不支持（Obsidian 也只在阅读视图支持）
* **标注（callout）与引用块**
  * 节点里的 `>` 行不再字面外露：连续引用行渲染成一个盒子，**块首行是 `[!type]` 即标注**（带类型色、图标、标题），否则是普通引用（左侧竖线取宿主 `--blockquote-*`）
  * **13 种官方类型与全部别名**（`abstract` / `summary` / `tldr`、`tip` / `hint` / `important`、`success` / `check` / `done`、`failure` / `fail` / `missing`、`danger` / `error`、`question` / `help` / `faq`、`warning` / `caution` / `attention`、`quote` / `cite`…）；类型标识大小写不敏感、空白归一为 `-`，未登记的类型按 `note` 呈现；不写标题时显示类型标识的 Title Case
  * **颜色与图标跟宿主**：类型色走 `--callout-*` 变量、图标走宿主 `getIcon`，切主题即时变色；`|` 之后的 callout metadata 原样保留但不显示
  * **正文递归**：标注里的表格 / 代码块 / mermaid / 数学 / 链接 / 标签全部走同一套渲染管线；嵌套至多 2 层，更深的按字面铺开（内容不丢）
  * **零写盘**：`>` 前缀、`[!type]`、`+` / `-` 折叠标记都只在显示层消费，`text` / `mdRaw` 一字不动；导出图会注入 `--callout-*` / `--blockquote-*` 的真值，暗色主题不会导出成亮色底
  * 只读嵌入（```` ```mindmap ````）同权；折叠标记只作标记（正文恒展开——导图节点是概要面，藏起来像内容丢失）
* **同文件多视图（Level B）**
  * 同一张导图可以开两个标签页：编辑、撤销 / 重做、保存都是**一条线**，两侧内容即时同步（小图即时、>600 节点 60 ms 合并）；引擎不重建、视口与选中不跳
  * **外部改动不再被覆盖**：写盘前发现磁盘正文已变 → 放弃本轮写盘，载入外部版本；若你有未保存草稿，它会留成**一步可撤销的快照**（`Ctrl+Z` 回到草稿），有草稿时提示一次
  * **过期提交不覆盖**：某个视图还没收到另一侧的最新内容就提交时，这次编辑会被拒绝并载入最新版本（提示一次），而不是用整树快照盖掉对方的修改
  * 关闭任一标签页立即保存（无差异则跳过）；最后一个关闭才销毁会话
  * 重命名 / 移动文件只迁移会话键，视图与历史不重建
* **首次打开导图不再「保存中…」**：打开文件的引擎自检不再被当成用户编辑，状态栏只在真正改动后显示保存状态
* **清理旧的不继承标记**：作用范围从「仅本节点」切回「含子节点」时询问是否删掉已打开导图里的 `%%none%%`（删掉会让这些节点重新继承上层颜色）。只动当前打开的文件，可 `Ctrl+Z`

<h3>变更</h3>

* **属性契约拆成双键**：`Mindmap: Mindmap` 只表示「本文件是导图」，布局单独写 `Mindmap Layout: logical | mindmap | organization | catalog | timeline | fishbone`。读侧只认 kebab（脏值回落默认布局，不再长期生效），写侧恒写新键，与界面语言无关
  * 旧六值（`Mindmap: LogicalStructure` 等）由**一次性迁移**搬到新键（只换写法、不造声明，幂等，0.4.0 删除）
  * 旧值读口只保留三个真实场景：嵌入指令 `%%layout: LogicalStructure%%`（正文不迁移）、启动迁移、「以导图打开」升级入口
* **自动保存照搬官方 `TextFileView`**：固定 **2 秒**防抖（原 800 ms 且可关），设置里的「自动保存」开关移除；关闭 / 切换文件 / 切回 Markdown 仍是立即保存
* **视图状态只写变化**：`data.json` 不再随每次打开增长——同值不落盘；打开后没动过视口、没切过偏好就关掉时什么都不写（此前会把当时的窗口尺寸固化成一份视口）；同一文件两个视图并排时，关掉平移过的一侧也不会把另一侧的视口带走
* **移除「连续保存失败挂起自动保存」**：磁盘满 / 权限类失败不再累积告警并静默挂起，下一次编辑照常重试
* **不再提示「该导图已在其他标签页打开」**：同文件多视图是正常形态，不再互相抢标签页
* **标题节点的配色指令写独立行**（`# 标题` 的下一行 `%%#hex%%`）：行尾形态会被 Obsidian 的 heading 缓存算进标题文本，`[[#标题]]` 与 `^block-id` 会失效；其它节点仍写行内（避免每次上色都多一行 diff）
* **清理旧 `%%none%%` 按文档计一次**：同一文件多个标签页共享一棵树，不再按标签页重复计数 / 重复写盘
* **配色作用范围切换会多一步确认**：反向（切到「仅本节点」）不询问——旧哨兵正是该档的机制

<h3>修复</h3>

* **迁移不再「造声明」**：没有启用键、值是 `Markdown` 或未知值的文件一个字都不碰（此前启动 1.5 s 后会把「只剩一个布局键」的普通笔记、以及用户主动切回 Markdown 的文件静默变成导图）
* **升级不丢用户布局**：「以导图打开」按「启用键里的旧值 → 布局键里的旧写法 → 种子值」取值，迁移尚未跑到的窗口里先手动打开也不会被默认布局覆盖
* **语法守卫的结果会落盘**：守卫只改引擎活数据、不发编辑事件，此前「屏上已改成标题、文件没写」；现在它与那次编辑同属一条撤销快照
* **会话撤销真正生效**：视图侧方法名与接口名对齐（此前 `Ctrl+Z` 仍走每视图一条引擎历史，与侧栏按钮分叉），与侧栏 / 右键 / 语法守卫共用同一条时间线
* **打开导图不再做无用功**：不再空报「保存中…」两秒、不再在引擎就绪时重放一次整树
* **mermaid 图内链接**：中键不再被浏览器默认行为接管（否则会另开窗口 / 外部浏览器）；独立窗口（popout）里的锚点点击、中键、悬停恢复
* **配色清理在多视图下不再重复计数**：此前 4 个标签页会报「4 个导图 4 处」，实际只有 1 处
* **列表项里缩进的代码围栏不再吞掉后续节点**：闭合行此前按「行首 ≤3 空格」判定，而列表项里的定界符本就在第 4 列 ⇒ 围栏永不闭合，其后的兄弟节点与标题整段被当成代码内容；改为按「不超过定界符所在列 +3」判定（CommonMark 的相对口径，闭合行**可以更浅**；围栏内各行按定界符所在列计入缩进，顶格闭合行不会掉出所属列表项）
* **含链接 / URL 的代码围栏不再被拆散**：围栏内容此前先被行内链接切碎，`MARKUP_RE` 的围栏分支再也配不上——`click A "https://…"` 的 mermaid 会整张退化成字面文本；现在围栏先整段消费，行内语义只在围栏之外生效
* **围栏里的指令行不再被抽走**：代码块里的 `%%#hex%%` / `%%rel:…%%` 是代码，不再被当成配色 / 联系指令挂到上一个节点
* **空行分隔的两个标注仍是两个盒子**：解析层会吃掉段落之间的空行，到渲染层是「一整段连续的 `>` 行」——同层的 `[!type]` 头部行现在恒起新块（此前第二个标注会退化成前一个的正文文字）
* **导出图不再压窄右内边距**：`foreignObject` 的宽度余量 12px 改为**左右各 6px**（总量不变，K106 的防裁切能力照旧）
* **属性读侧 fail-closed**：布局值认不出时回落默认布局，但**文件里的原值保持原样**（迁移不覆盖手写内容）
* **关闭 / 切文件不再丢最后一次内联编辑**：提交闸此前先于编辑器收尾关闭，`commitSession` 静默失败；现在先 `closeInlineEditor`、后关闸（2026-11-11 实机复现）
* **CRLF 文件编辑后不再整篇变 LF，行尾两空格也逐字回写**：序列化按加载时探测的换行形态输出，正文与文件头不再混合换行（2026-11-11 实机）
* **多行节点续行里的链接不再被吞**：未编辑判定只对首行做「链接已清除」检查，引用块 / callout 正文里的双链与 URL 不再变成纯文本（2026-11-11 实机）
* **给标题上色后仍能参与层级语法互转**：独立行 `%%#hex%%` 与 id/rel/sum 一样先从可转判据里剥掉，不再被判成多行（2026-11-11 实机）
* **视口 / 会话收尾**：已恢复保存视口时 150 ms 兜底不再重读 store；写盘期间的 `modify` 回声被忽略；`await detach` 期间新文件接管时不再销毁新引擎；过期提交同一版本只提示一次；快照应用在接口缺失时不再走必然失败的 `updateData` 降级
* **只读嵌入里的链接可点，也不再导航整个窗口**：`mindmap` 代码块的锚点走与文件视图同一套修饰键（左键当前标签 / Ctrl+Cmd 新标签 / 中键新标签）；`javascript:` / `data:` 等非白名单协议只拦不打开；mermaid 产物挂载前移除 `script`、`on*` 与不安全 href（2026-11-12 实机）
* **脚注在轻标记里也能正确编号**：`**粗[^1]**` 的徽标此前退化成字面文本；定义续行（含 `[^2]`）不再被渲染成引用，定义行与续行一起隐藏（2026-11-12 实机）
* **脚注定义的范围按「相对缩进」判定**：定义行之后**同列**的非空行是另一段正文——`- 正文 / [^1]: 定义 / 接着的正文` 的第三行此前被当成续行一起隐藏（节点上少一段、文件里还在）；缩进 4 列才是定义正文（2026-11-12 实机）
* **标注标题里的轻标记照常渲染**：标题中的 `[[双链]]` / 粗体 / 行内码与阅读视图一致（此前全是字面字符）；标题以 `>` 或围栏定界符起首时整段按纯文本，不再在标题里长出一个引用盒子（2026-11-12 实机）
* **脚注 id 允许含逗号**：汇总 chip 的 id 列表改为换行分隔（逗号分隔会把 `[^a,b]` 拆成两条、都判「未定义」）；同一 id 重复定义时 chip 不再重复列，展开不重复显示同一段正文
* **徽标固定宽度**：引擎在字体就绪前测宽，数字宽度随字体变化 ⇒ 窄节点上的第二枚徽标原本被挤到第二行、内容盒变宽后溢出压住下方节点
* **未闭合围栏之后的内容按代码处理**：编辑器里刚敲下开栏、还没闭合时，其中的 `> [!note]` 不再被提成标注盒、定界符不再露成字面
* **转义的反斜杠按奇偶判定**：`\\[^1]`（两个反斜杠）里的引用是真引用，`\[^1]` 才是字面——此前一律判字面，引用会消失
* **围栏闭合按 CommonMark 相对口径**：开 3 闭 4 仍是整块代码；**闭合行可以比开栏更浅**（`  ```js` + 顶格闭合不再把后续节点吞进代码）；围栏内各行按定界符所在列计入缩进，顶格闭合行不再单独变成一个节点；脚注的围栏状态机与解析层共用同一闭合判定（含相对列 / 行尾空白），同行自闭合围栏（` ```code``` `）不再让它后面的定义既不剥离也不进索引（2026-11-12 实机）
* **CRLF 文件的「纯浏览不写盘」守卫恢复生效**：加载基线此前在记录换行形态**之前**算出（恒为 LF），而此后每轮比较都用 CRLF ⇒ 判据永不成立，同内容只差换行的两份文件里只有 CRLF 那份「打开一次就被重写」（尾部空行被吃掉）；同时 `hasUnsavedChanges` 打开即为真，外部写入会多弹一次「已重新载入」（2026-11-12 实机）
* **只改首行时，未编辑的续行逐字回写**：`rawOk` 因首行改动失效后，续行原本取自 `text`（剥壳显示文本）⇒ 续行里的 `[[双链]]` / `![[图]]` / 行尾指令在编辑一次后全部丢失；现在按「续行是否与解析期快照逐行相同」分流：没动过就用 `mdRaw` 原文，动过才用 `text`（2026-11-12 审核）
* **导出图的标注类型色名单只有一份**：`--callout-*` 的 13 个变量名此前在 `domain/callout` 与 `export-svg-postprocess` 各手抄一份，改一处另一处会静默回落到兜底色；现由 `CALLOUT_CSS_VARS` 现算
* **mermaid 的失败留痕按原因各一条**：此前共用一个 `createWarnOnce` 实例（整实例只输出一次），先发生的超长告警会永久吞掉语法错误 / 产物异常等其它根因；消毒说明同时改为如实描述「黑名单」并补齐 `iframe` / `object` / `embed` 等活动元素

<h3>工程</h3>

* 新增模块：`services/document-session{,-history,-registry}`（会话 / 撤销栈 / 注册表）、`engine/mindmap-snapshot`（跨视图应用快照，`updateData` 去掉 `addHistory`）、`markdown/md-heading-{syntax,normalize,format}`、`features/view-syntax`（守卫与整篇重排）、`platform/mermaid`、`platform/legacy-mindmap-migration`、`markdown/md-footnote`（定义语法 / 索引 / 渲染期剥离）、`features/view-footnote`（徽标交互、浮层、编号）、`domain/callout`（13 类型元数据 / 别名 / 头部解析 / 引用前缀剥离）、`platform/callout-icon`（宿主 `getIcon` + 模板缓存 + 内联尺寸配色）
* 保存管线：`SavePipeline` 走 `Vault.process` 原子读改写（文件头恒取磁盘当前值、正文与文件头之间的空行原样保留）、无差异跳过、写前检测外部改动、收尾一致性自检；`AUTO_SAVE_DEBOUNCE_MS` 800 → 2000
* 视图状态：`ViewStateStore.patch` 按序列化结果逐字比较（同值不排写盘），`persistViewport` 对「打开时自动设置的默认视口」直接不写；`persistViewport` 必须排在 `invalidateInit` / `destroyInstance` **之前**（两者 `viewport.reset()` 会清空判据，实机首轮即因此失效）
* 门禁：`npm run check:gates` 一条命令按 git 变更集执行（`--dry-run` / `--all` / `--fix-lines`），豁免表**只**在 `AGENTS.md` 登记一处（`architecture.md` 不再复制，两张表并行时必然漂移）；新增「规模观察」只打印不红灯
* lint：撤销 `src/links/file-lookup.ts` 的过期豁免（已无直调），`src/platform/system-open.ts` 的裸 `require` 显式声明 `globals.require`（不再依赖 `isDesktopOnly` 顺带注入的 `globals.node`）
* 依赖：新增 `pele@1.13.0`（打进 `main.js`，产物 **1,485,329 B / 约 1.42 MB**）；`vendor/THIRD-PARTY-NOTICES.md` 新增「直接内嵌的 npm 依赖」一节（该包零运行时依赖；升级时核对宿主 `Credits.md` 里的 Pele 版本）
* 解析层新增 `mdContinuationIndents`（逐行续行**相对缩进**；只读、不落盘、不进正文），定义行剥离与全文索引共用这一份判据
* 测试：全量 **113 文件 / 3141 用例**；`verify:visual` **16** 个渲染场景（含 syntax / callout 场景）；门禁 `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `verify:visual --require-chrome` / `check:release` 全部通过
* 文档：`AGENTS.md` 决策表同步（层级语法、Level B 会话、节点内 mermaid、标注 / 引用块、属性双键、保存节奏、视图状态写盘判据、脚注只读渲染）；标准文档新增 §3.7 层级语法与 mermaid / 配色口径，§2.2 / §3.5 补标注与引用块的显示口径；`docs/agents/conventions.md` 新增 K168–K197

<h3>兼容性说明</h3>

* 需要 Obsidian **1.13.0+**，仅桌面端；`minAppVersion` 保持 1.13.0；`styles.css` 与 `main.js` 都有变化——三件套（`main.js` / `manifest.json` / `styles.css`）请一起替换
* **文件会被迁移**：启动 1.5 s 后把旧六种布局值改成 `Mindmap` + `Mindmap Layout`（只换写法、不造声明、幂等；0.4.0 删除该迁移）。迁移**不碰正文**，`%%layout: …%%` 嵌入指令与手写 `toString` 之类认不出的值原样保留
* **新增设置项「新建导图的层级语法」**，出厂「无序列表」＝本特性引入前的行为；**「自动保存」开关移除**（固定 2 s 防抖），旧 `data.json` 里的 `autoSave` 字段不再被读取（留着无害，无需手改）
* **正文语法会变的地方只有一处**：标题节点的配色指令从行尾改到下一行（否则 `[[#标题]]` 失效）；其余编辑仍逐字回写
* **脚注是纯渲染能力**：文件里没有写入任何新语法——`[^id]` / `[^id]: …` 本来就是标准 Markdown，`text` / `mdRaw` 一字不动，也没有新增属性键；回滚到 0.3.2 时它们按字面显示（定义行会重新变回节点里的文字），文件内容与导图结构都不受影响
* **标注 / 引用块同样是纯渲染能力**：`>` / `[!type]` / `|metadata` / 折叠标记都是标准 Markdown，插件只剥显示层，没有任何新语法、新属性键或新语法值；回滚到 0.3.2 时 `>` 与 `[!type]` 会重新露在节点里，文件内容与结构不受影响；`data.json` 也不因这一能力新增字段
* **回滚到 0.3.2**：文件不会被重写；但旧版只读 `Mindmap`、不读 `Mindmap Layout` ⇒ 布局回落默认（重装 0.3.3 即恢复，因为文件里存的是新键）；mermaid 围栏回落普通代码块；`%%none%%` 与新写的独立行指令旧版仍当注释处理；同文件多视图会退回「已在其他标签页打开」的单视图策略；层级语法的 `#` / `-` 是纯 Markdown，旧版照常解析
* **已知边界**：Markdown 只有 6 级标题，第 7 层起回落列表；把带行内色注释的节点转成标题后，注释仍在该行（Obsidian 会把它算进标题文本，建议重新应用一次颜色以改到独立行）；标题自动降为列表会删掉大纲条目与 `[[#标题]]` 锚点（`Ctrl+Z` 可整体复原）；mermaid 不接管缩放 / 交互插件，图内 `$$…$$` 按纯文本处理；「仅本节点」作用范围会给每个直接子节点写一条 `%%none%%`，切回「含子节点」时询问是否清理；行内脚注 `^[正文]` 不渲染，围栏 / 缩进代码里的同形行既不是引用也不是定义；标注嵌套至多 2 层（更深的按字面铺开），标注正文里的列表 / 标题按字面行显示（与普通节点同口径），表格单元格里的 `>` 行不成盒，折叠标记不改变展开态，自定义类型（CSS 片段）按 `note` 取色，标注标题以 `>` / 围栏定界符起首时整段按纯文本（与宿主一致）；脚注定义的续行必须比内容起始列更深（同列即另一段正文，与阅读视图一致），未闭合围栏之后整段视为代码；只读嵌入里的链接**悬停预览**仍不接管（点击三通道已覆盖；嵌入不是注册的 hover 源）

---

[English](#en-v0.3.3)

0.3.2 was about looks. 0.3.3 is about **how the file is written and how two views share it**: heading / bullet hierarchy can be converted in either direction for the whole document (with a guard that catches structure-changing drops while you edit); the same map can be open in two tabs sharing one document, one undo line and one save pipeline; nodes can render mermaid diagrams, and `>` quotes / `[!type]` callouts become boxes (type colour, icon, recursive body); and the frontmatter contract is split into "enabled" plus "layout" with a one-shot migration.

Three long-standing annoyances are gone: a heading node's colour directive was counted as part of the heading text (breaking `[[#heading]]`) — it now lives on its own line; an external edit used to be overwritten by stale view content — the plugin now backs off, loads the external version and keeps your draft as an undoable step; auto-save was a bespoke 800 ms debounce with a toggle — it now follows Obsidian's `TextFileView` at a fixed 2 seconds.

Two upgrade notes: **files are migrated** (six legacy layout values → `Mindmap` + `Mindmap Layout`, spelling only, idempotent, migration removed in 0.4.0); the **auto-save toggle is gone** (fixed 2 s; closing or switching files still saves immediately).

<h3 id="en-v0.3.3">Added</h3>

* **Heading / bullet hierarchy, reversible both ways**
  * Blank right-click → "Syntax": bullet list / headings (level 1) / headings (level 2). Whole document, one undo step; the checked state comes from the file itself
  * **Atomic per level**: if any node on a level cannot become a heading (multi-line / task / ordered list / fenced code), the whole level stays a list and the first blocker is named
  * **Lossless**: converting to headings keeps the list marker (`*` / `+` survive a round trip); converting to a list also demotes prefix-less paragraphs (otherwise levels are lost); ordered numbers keep their parsed values (`5.` stays `5.`); trailing comments / links / images / directives stay on the line
  * **Paste converts too**: pasting into a heading-syntax level turns the subtrees that can become headings into siblings first; a subtree with multi-line / task / ordered-list nodes makes the whole paste be refused with an explanation (no silent structure change)
  * **New setting** "Syntax for new maps" (list / h1 / h2, default list). Seed only: existing files always follow their own body
* **Edit-time consistency guard** (runs after *your* edit, not on open)
  * A list item placed after a heading becomes a sibling heading (or the edit is rolled back with a reason)
  * Sibling heading levels that increase, or that are not deeper than the parent, are re-levelled
  * A heading dropped under a list parent is demoted with its whole branch; a heading child under a level-6 parent becomes a list item (there is no level 7); a heading under a plain paragraph rolls back
  * A demotion notice reports **how many headings lose their anchor** (the `[[#Heading]]` links pointing at them will break) — one `Ctrl+Z` restores everything
  * **Legal mixes (list before heading) are never touched** — a hand-written file round-trips verbatim; freshly created empty nodes are not converted
* **Mermaid inside nodes**
  * A ` ```mermaid ` fence renders as a diagram in the node (embedded `pele@1.13.0`, the same renderer Obsidian's reading view uses; 16 diagram types match the host byte for byte)
  * **Synchronous**: final size on the first frame — no placeholder, no second layout pass; cached by source, so rebuilds / re-layouts / extra views do not re-render
  * Hover reveals "Copy Mermaid source" (copies the fence body, not the picture)
  * **Links inside diagrams work**: `click A "…"` supports `[[wikilinks]]` and URLs — left click opens in the current tab, `Ctrl`/`Cmd`+click in a new tab, and **middle click also opens a new tab** (all three paths suppress Electron's default navigation)
  * The diagram is an opaque sticker: its paper follows light/dark only, never the node colour; switching themes recolours the same SVG without re-rendering; exported SVGs carry the `--pele-*` variables so dark themes do not export as white-on-black
  * Failure falls back: syntax errors / unknown types / sources over 20000 characters become a normal code block (one console warning, once)
* **Footnotes**
  * A reference such as `text[^1]` renders as a **superscript number**, numbered by first appearance across the document (same as the reading view); named footnotes (`[^note]`) also show a number instead of spilling a long id into the node
  * **Hover** opens a popover with the definition body, rendered exactly like node content (bold / wikilinks / inline code / tables all work); links inside it are clickable, text is selectable, and long definitions scroll inside the popover without zooming the canvas
  * **Click** jumps to the definition node: ancestors expand and the node is centred — **no selection, no flash** (the definition is usually collapsed, so highlighting a capsule is just noise)
  * **Definition lines no longer take up space**: mixed with body text they are simply hidden; when a node holds only definitions it collapses into a **"Footnotes" capsule** that lists them all on click or hover
  * **Unresolved references** are dimmed (semi-transparent + truncated id) and a click explains that no definition exists — no silent failure
  * **No writes, no extra fields**: `[^id]` / `[^id]: …` stay plain Markdown, `text` / `mdRaw` are untouched byte for byte, browsing and interacting never save, and no frontmatter key is added
  * Read-only embeds (```` ```mindmap ````) get the same behaviour: numbering, hover and click all work inside the block
  * Limits: look-alikes inside fenced or indented code are not definitions; inline footnotes `^[text]` are not supported (Obsidian only supports them in the reading view too)
* **Callouts and blockquotes**
  * `>` lines no longer show up literally: consecutive quote lines render as one box — a `[!type]` first line makes it a **callout** (type colour, icon, title), otherwise a plain quote (left rule from the host's `--blockquote-*`)
  * **All 13 official types and every alias** (`abstract` / `summary` / `tldr`, `tip` / `hint` / `important`, `success` / `check` / `done`, `failure` / `fail` / `missing`, `danger` / `error`, `question` / `help` / `faq`, `warning` / `caution` / `attention`, `quote` / `cite`, …); type ids are case-insensitive with whitespace folded to `-`, unknown types render as `note`, and a callout without a title shows the type id in Title Case
  * **Colours and icons come from the host**: type colour via the `--callout-*` variables, icon via the host's `getIcon`, so switching themes recolours immediately; callout metadata after `|` is preserved but not displayed
  * **Recursive body**: tables / code blocks / mermaid / maths / links / tags inside a callout go through the same pipeline; nesting is capped at 2 levels, deeper ones are laid out literally (nothing is lost)
  * **No writes**: the `>` prefix, `[!type]` and the `+` / `-` fold markers are consumed only by the display layer — `text` / `mdRaw` stay untouched; exported images get the real `--callout-*` / `--blockquote-*` values injected, so a dark theme does not export as a light box
  * Read-only embeds (```` ```mindmap ````) get the same behaviour; fold markers stay markers (the body is always expanded — a map node is a summary surface, hiding it reads as missing content)
* **Multiple views of one file (Level B)**
  * The same map can be open in two tabs: editing, undo/redo and saving share one timeline, and both sides stay in sync (instant for small maps, 60 ms merge above 600 nodes); the engine is not rebuilt and neither viewport nor selection jumps
  * **External edits are no longer overwritten**: if the body changed on disk, the plugin skips the write and loads the external version; an unsaved draft is kept as **one undoable step** (`Ctrl+Z` brings it back) and a notice is shown once
  * **Stale commits never overwrite**: if a view has not received the other side's latest content yet, its commit is rejected and the latest version is loaded (with one notice) instead of the whole-tree snapshot wiping the other edit
  * Closing any tab saves immediately (no diff, no write); the session is destroyed when the last tab closes
  * Renaming / moving a file only migrates the session key — views and history survive
* **No more "saving…" on open**: the engine's first-frame self-check is no longer treated as a user edit, so the status bar only reports saving after a real change
* **Cleanup of stale "do not inherit" markers**: switching "Colour scope" from "Node only" back to "With children" now offers to remove the old `%%none%%` markers from open maps (removing them lets those nodes inherit again). Only open files are touched, and it is undoable

<h3>Changed</h3>

* **Frontmatter split into two keys**: `Mindmap: Mindmap` only says "this file is a map"; the layout lives in `Mindmap Layout: logical | mindmap | organization | catalog | timeline | fishbone`. Readers accept kebab only (dirty values fall back to the default layout instead of staying effective), writers always emit the new keys, independent of UI language
  * The six legacy values (`Mindmap: LogicalStructure` etc.) are moved by a **one-shot migration** (spelling only, no declarations invented, idempotent, removed in 0.4.0)
  * Legacy readers remain only where old values really exist: the embed directive `%%layout: LogicalStructure%%` (bodies are never migrated), the startup migration, and the "open as mind map" upgrade path
* **Auto-save follows `TextFileView`**: fixed **2 seconds** (was a bespoke 800 ms with a toggle); the "Auto-save" setting is gone. Closing / switching files / switching back to Markdown still saves immediately
* **View state only writes what changed**: `data.json` no longer grows on every open — identical values are not written, and closing a map whose viewport and preferences were never touched writes nothing (it used to freeze the window size into a stored viewport); with two views of one file side by side, closing the panned one no longer drags the other one's viewport along
* **The "suspend auto-save after repeated failures" state is gone**: disk-full / permission failures no longer accumulate warnings and silently suspend; the next edit simply retries
* **"Already open in another tab" is no longer reported**: multiple views of one file are a supported shape now
* **A heading node's colour directive moves to its own line** (the line after `# heading`): the trailing form is counted into the heading text by Obsidian's heading cache and breaks `[[#heading]]` and `^block-id`. Other nodes keep the inline form to avoid an extra line of diff per colour
* **Stale `%%none%%` cleanup counts per document**, not per tab (views share one tree, so neither the count nor the write repeats)
* **Switching colour scope asks once**: only in the "Node only" → "With children" direction (the markers are that mode's mechanism, so the reverse does not ask)

<h3>Fixed</h3>

* **The migration no longer invents declarations**: files without an enable key, or whose value is `Markdown` / unknown, are left byte-identical (previously a note with only a layout key, or a file the user had explicitly switched back to Markdown, silently became a mind map 1.5 s after startup)
* **The upgrade path no longer loses the chosen layout**: "open as mind map" resolves "legacy value in the enable key → legacy spelling in the layout key → seed layout", so opening a file before the migration ran cannot overwrite the user's choice
* **Guard results are persisted**: the guard only touched live engine data and emitted no edit event, so the screen showed headings while the file kept the old spelling; it now shares one undo step with that edit
* **Session undo actually runs**: the view's method names now match the interface (previously `Ctrl+Z` kept using the per-view engine history while the side rail used the session)
* **Opening a map no longer does wasted work**: no phantom "saving…" for two seconds, and no full-tree re-apply when the engine becomes ready
* **Mermaid links**: middle click is no longer handled by the browser default (which opened a window / external browser), and anchor click / middle click / hover work again in popout windows
* **Colour cleanup no longer double-counts in multi-view**: four tabs used to report "4 maps, 4 markers" for a single marker
* **An indented fence inside a list item no longer swallows the following nodes**: the closing line used to be matched against "≤3 leading spaces", while a fence inside a list item starts at column 4, so it never closed and every following sibling / heading was read as code; the closing indent is now compared relatively (0–3 columns from the delimiter)
* **Fences containing links / URLs are no longer torn apart**: fence content used to be split by the inline link pass first, so the fence branch could never match again — a mermaid `click A "https://…"` degraded the whole diagram to literal text; fences are now consumed as a whole, and inline semantics only apply outside them
* **Directives inside fences are no longer pulled out**: `%%#hex%%` / `%%rel:…%%` inside a code block are code, so they are no longer treated as colour / relation directives and attached to the previous node
* **Two callouts separated by a blank line stay two boxes**: the parser drops blank lines between paragraphs, so the display layer receives one continuous run of `>` lines — a same-level `[!type]` header line now always starts a new block (previously the second callout degraded into body text of the first)
* **Export no longer squeezes the right padding**: the `foreignObject` width margin of 12 px is now split **6 px on each side** (same total, so K106's anti-clipping behaviour is unchanged)
* **Readers are fail-closed**: an unrecognised layout value falls back to the default layout while the file keeps its original text (the migration never overwrites hand-written values)
* **Closing / switching files no longer loses the last inline edit**: the commit gate used to close before the editor was committed, so `commitSession` failed silently; `closeInlineEditor` now runs first (reproduced on a real vault, 2026-11-11)
* **CRLF files stay CRLF after an edit and trailing two-space hard breaks survive**: serialisation follows the EOL detected on load, so the body no longer mixes LF into a CRLF file (reproduced on a real vault, 2026-11-11)
* **Links on continuation lines are no longer swallowed**: the "link cleared" check now only looks at the first line, so wikilinks / URLs inside quote and callout bodies stay in the file (reproduced on a real vault, 2026-11-11)
* **Coloured headings can still change syntax**: a standalone `%%#hex%%` line is stripped from the convertibility check just like id/rel/sum directives (reproduced on a real vault, 2026-11-11)
* **Viewport / session teardown**: the 150 ms fallback no longer re-reads the store once a saved viewport is restored; `modify` echoes during writes are ignored; a new file taking over during `await detach` is no longer destroyed; repeated stale commits notify once; snapshot apply no longer falls back to a doomed `updateData`
* **Links inside read-only embeds are clickable and no longer navigate the whole window**: anchors in a `mindmap` code block follow the same modifiers as the file view (left = current tab, Ctrl/Cmd = new tab, middle = new tab); `javascript:` / `data:` protocols are blocked without opening; mermaid output is stripped of `script`, `on*` and unsafe hrefs before mounting (real vault, 2026-11-12)
* **Footnotes inside emphasis are numbered correctly**: `**bold[^1]**` used to degrade to literal text; definition continuation lines (including a `[^2]` inside them) are no longer rendered as references, and both the definition and its continuation are hidden (real vault, 2026-11-12)
* **A footnote definition ends where the indentation ends**: a non-empty line at the **same column** after a definition line is another paragraph — the third line of `- body / [^1]: definition / more body` used to be hidden as a continuation (a paragraph missing from the node while the file kept it); only a line indented 4 columns belongs to the definition (real vault, 2026-11-12)
* **Inline markup inside a callout title renders**: links / bold / inline code in the title now match the reading view (they used to be literal characters); a title starting with `>` or a fence delimiter stays plain text instead of growing a quote box inside the title (real vault, 2026-11-12)
* **Footnote ids may contain commas**: the summary chip stores its id list newline-separated (a comma-separated list split `[^a,b]` into two ids, both reported as undefined); a duplicated id is listed once, so expanding the chip no longer shows the same body twice
* **Badges have a fixed width**: the engine measures before the font is ready and digit widths vary with it, so a second badge in a narrow node wrapped to a second line and the wider content box overflowed onto the node below
* **Content after an unclosed fence is code**: while a fence is still being typed, a `> [!note]` inside it is no longer promoted to a callout box and its delimiters stay literal
* **Escaped backslashes count by parity**: a reference in `\\[^1]` (two backslashes) is a real reference and only `\[^1]` is literal — it used to be treated as literal, so the reference vanished
* **Fences close by the CommonMark relative rule**: 3 opening / 4 closing backticks still form one code block; **the closing fence may be shallower than the opening one** (`  ```js` closed flush left no longer swallows the following nodes), and fence lines are indented by the delimiter's column so a flush-left closing fence no longer becomes a node of its own; the footnote fence state machine shares the parser's closing predicate (relative column / trailing whitespace), and a same-line self-closed fence (` ```code``` `) no longer hides the definitions that follow from both the display and the index (real vault, 2026-11-12)
* **"Browsing never writes" works again for CRLF files**: the load baseline was computed *before* the EOL was recorded (so it was always LF) while every later comparison used CRLF, so the predicate never held — of two files differing only by EOL, only the CRLF one was rewritten the first time it was opened (trailing blank lines dropped); `hasUnsavedChanges` was also true right after opening, which made an external write show the "reloaded" notice once (real vault, 2026-11-12)
* **Editing the first line keeps the untouched continuation lines verbatim**: once `rawOk` failed, continuation lines came from `text` (the stripped display text), so `[[wikilinks]]` / `![[images]]` / trailing directives in them disappeared after a single edit; they are now taken from `mdRaw` unless the continuation itself changed (2026-11-12 review)
* **The exported callout colour list has a single source**: the 13 `--callout-*` names used to be hand-copied in both `domain/callout` and `export-svg-postprocess`, so drifting one silently fell back to the hard-coded colours; they are now derived from `CALLOUT_CSS_VARS`
* **Mermaid warnings are kept per cause**: all four used to share one `createWarnOnce` instance (one output for the whole instance), so the first over-long-source warning permanently muted syntax errors and malformed output; the sanitizer documentation now describes the blacklist honestly and also drops `iframe` / `object` / `embed` and friends

<h3>Engineering</h3>

* New modules: `services/document-session{,-history,-registry}` (session / undo stack / registry), `engine/mindmap-snapshot` (cross-view apply: `updateData` without `addHistory`), `markdown/md-heading-{syntax,normalize,format}`, `features/view-syntax` (guard and whole-document rewrite), `platform/mermaid`, `platform/legacy-mindmap-migration`, `markdown/md-footnote` (definition syntax / index / render-time stripping), `features/view-footnote` (badge interaction, popover, numbering), `domain/callout` (13 type metadata / aliases / header parsing / quote-prefix stripping), `platform/callout-icon` (host `getIcon` + template cache + inline size and colour)
* Save pipeline: `Vault.process` for atomic read-modify-write (frontmatter always from disk, blank line between frontmatter and body preserved), skip identical writes, external-change detection before writing, trailing consistency self-check; `AUTO_SAVE_DEBOUNCE_MS` 800 → 2000
* View state: `ViewStateStore.patch` compares serialised results verbatim (identical values never schedule a write) and `persistViewport` skips the viewport that was auto-fitted on open; `persistViewport` must run **before** `invalidateInit` / `destroyInstance` (both call `viewport.reset()` and clear the predicate — the first real-machine round failed exactly this way)
* Gates: `npm run check:gates` drives the whole chain from the git change set (`--dry-run` / `--all` / `--fix-lines`); the exemption table now lives **only** in `AGENTS.md` (two tables meant one always drifted); a "scale observation" line is printed without failing the build
* Lint: dropped the stale `src/links/file-lookup.ts` exemption (no direct calls left) and declared `globals.require` for `src/platform/system-open.ts` instead of relying on `globals.node` leaking in via `isDesktopOnly`
* Dependencies: adds `pele@1.13.0` (bundled into `main.js`; **1,485,329 B / ~1.42 MB** artifact), and `vendor/THIRD-PARTY-NOTICES.md` gains a "npm dependencies bundled directly" section (the package has no runtime dependencies; check the host's `Credits.md` for the Pele version when upgrading)
* Parser: a new `mdContinuationIndents` field records the **relative indentation** of each continuation line (read-only, never written to disk or into the body); definition stripping and the document-wide index share that one predicate
* Tests: **113 files / 3141 cases**; `verify:visual` covers **16** render scenarios (including the syntax and callout scenes); gates `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `verify:visual --require-chrome` / `check:release` all pass
* Docs: `AGENTS.md` decision table updated (hierarchy syntax, Level B session, in-node mermaid, callouts / blockquotes, frontmatter split, save cadence, view-state write predicate, read-only footnotes); the standard document gains §3.7 plus the mermaid / colour rules and the callout / blockquote display rules in §2.2 / §3.5; `docs/agents/conventions.md` gains K168–K197

<h3>Compatibility notes</h3>

* Requires Obsidian **1.13.0+**, desktop only; `minAppVersion` stays 1.13.0; both `styles.css` and `main.js` change — replace the three files (`main.js` / `manifest.json` / `styles.css`) together
* **Files are migrated**: 1.5 s after startup the six legacy layout values are rewritten as `Mindmap` + `Mindmap Layout` (spelling only, idempotent, removed in 0.4.0). The body is never touched; `%%layout: …%%` embed directives and unrecognised hand-written values are kept as-is
* **New setting** "Syntax for new maps", default "bullet list" (= behaviour before this feature); **the "Auto-save" toggle is removed** (fixed 2 s debounce) and the old `autoSave` field in `data.json` is no longer read (harmless, no hand editing needed)
* **The only body change** is the heading-node colour directive moving to its own line (otherwise `[[#heading]]` breaks); every other edit still round-trips verbatim
* **Footnotes are render-only**: nothing new is written to files — `[^id]` / `[^id]: …` are plain Markdown, `text` / `mdRaw` stay untouched, and no frontmatter key is added; rolling back to 0.3.2 shows them literally (definition lines reappear as node text) and neither the file nor the tree structure changes
* **Callouts / blockquotes are render-only too**: `>` / `[!type]` / `|metadata` / fold markers are all standard Markdown; only the display layer strips them, with no new syntax, key or value; rolling back to 0.3.2 shows `>` and `[!type]` literally in the node again, and neither the file nor the structure changes — no new `data.json` field either
* **Rolling back to 0.3.2**: no file is rewritten, but the old build reads only `Mindmap` and ignores `Mindmap Layout`, so layouts fall back to the default (reinstalling 0.3.3 restores them, since the file keeps the new key); mermaid fences fall back to code blocks; `%%none%%` and the new standalone-line directives are treated as plain comments; multi-view returns to the old "already open elsewhere" single-view policy; heading / bullet syntax is plain Markdown and parses as before
* **Known limits**: Markdown has six heading levels, so level 7 and below fall back to lists; converting a node that already carries an inline colour comment to a heading leaves the comment on the same line (Obsidian counts it into the heading text — re-apply the colour once to move it); demoting a heading to a list drops its outline entry and `[[#heading]]` anchor (`Ctrl+Z` restores both); mermaid does not take over zoom / interaction plugins and treats `$$…$$` as plain text; "Node only" writes a `%%none%%` onto every direct child, and switching back offers to clean them up; inline footnotes `^[text]` are not rendered, and footnote look-alikes inside fenced / indented code are neither references nor definitions; callout nesting stops at 2 levels (deeper ones are laid out literally), lists / headings inside a callout body stay literal lines (same as any node), `>` lines inside table cells do not become boxes, fold markers do not change the expanded state, and custom types (CSS snippets) take the `note` colour; a callout title starting with `>` / a fence delimiter stays plain text (same as the host); a footnote definition's continuation line must be indented deeper than the content column (the same column means another paragraph, same as the reading view), and everything after an unclosed fence is code; link **hover preview** inside read-only embeds is not taken over (the three click channels are covered; an embed is not a registered hover source)
