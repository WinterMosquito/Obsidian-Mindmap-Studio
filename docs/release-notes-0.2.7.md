[中文](#cn-v0.2.7) | [English](#en-v0.2.7)

0.2.7 把**布局**从插件数据搬进了文件属性：同一份 frontmatter 声明既表示「这是导图」，也表示「用哪种布局」——`Mindmap: Timeline` 打开就是时间轴，`Mindmap: Markdown` 就是终止（按普通笔记打开）。布局因此跟着文件走：换设备、同步、换主题、重装插件都不会丢，插件 `data.json` 里也不再存第二份。右键「布局」切换会**写进文件属性**（先排空正文，写失败则文件与画面都不动），属性被外部改写时已打开的图只跟随、不回写。`mindmap` 代码块还新增了块体首行的 `%%layout: <值>%%` 指令，可以给单个代码块指定布局。**这一版含破坏性变更**：旧的 `Type` / `类型` 键不再被识别（见「兼容性说明」）。

<h3 id="cn-v0.2.7">新增</h3>

* **布局写进文件属性**：frontmatter 的 `Mindmap` 值即布局，七值枚举——`LogicalStructure`（逻辑结构图）/ `Mindmap`（思维导图）/ `OrganizationStructure`（组织结构图）/ `CatalogOrganization`（目录组织图）/ `Timeline`（时间轴）/ `Fishbone`（鱼骨图）/ `Markdown`（**终止**：不渲染为导图）
  * **读侧宽容**：键名大小写不敏感；值先归一（trim → 小写 → 去掉 `-` / `_` 与空白），故 `mindMap` / `mind map` / `MIND-MAP` / `logical-structure` 都认；官方属性面板的多值形态**取第一项**
  * **未知值 = 不是导图**（静默、失败安全）：写错的值不会被当成导图渲染，一眼可见地按普通笔记打开
* **右键「布局」改写文件属性**：切换先**排空未落盘的正文** → 写 `Mindmap`（官方 `processFrontMatter`，只动这一个键）→ 成功之后才重排画面。写失败会提示「切换布局失败（文件属性未写入）」，**文件与画面都保持原样**，不做乐观应用
* **属性被外部改写时跟随**：属性面板 / 其它窗格 / 同步盘把值改掉后，已打开的导图会按新布局重排，但**不回写文件**（谁写谁负责）；值没变则不重排（幂等）
* **`mindmap` 代码块按块指定布局**：块体首行写 `%%layout: <值>%%`（允许其前有空行），该块按此布局渲染，指令行在解析前剥离、绝不会变成节点
  * 只认**首行**：其后的同形文本是正文（可能在讲这条语法）
  * 值为 `Markdown` 或无法识别 → 同样剥离该行，布局回退到设置里的「默认布局」，并在块内给一行提示（可见降级，不静默）
  * **空值不算指令**：`%%layout: %%` 与 `%%备注%%` 一样按普通注释原样留在块内（既不剥行，也不弹空提示）

<h3>变更</h3>

* **破坏性：声明键单键化**。判据只认 `Mindmap` 一个键；旧键 `Type` / `类型` **完全不认**——不读、不写、不删、不迁移、不提示。存量文件会表现为「普通笔记」：右键「以思维导图打开」点一次即补写标准键（旧键原样留在文件里，插件不再管它）
* **切换界面语言不再触碰任何文件**：原先「改语言就把全库声明键名改成当前语言」的全库迁移已删除（键名与语言无关，那套迁移没有存在理由了）
* **`data.json` 不再保存逐文件布局**：旧版的 `viewState[*].layout` 在启动时被剔除（只在该文件确实有残留时补写一次盘，无残留不写），同一条目里的连线 / 配色 / 边框 / 视口原样保留
* **「默认布局」语义收窄为种子值**：它只决定**新建 / 升级**文件时写进属性的初始值，改它不再影响任何已存在、已打开的图（因此也不在「即时刷新」的设置键里）
* **升级写种子布局**：手动「以思维导图打开」一篇普通笔记，写入的是设置「默认布局」对应的标准值（出厂 `Mindmap: Mindmap`），与「新建导图」得到同一个初始布局；已是导图声明的文件不重写 YAML
* **降级的短路条件收窄**：「以 Markdown 打开」只在值**已经是** `Markdown` 时免写，其余（含布局值与用户手写的未知值）一律改写——`Markdown` 是唯一明确的终止值

<h3>工程</h3>

* **判据仍只有一份**：`domain/mindmap-property.ts` 的 `readMindMapDeclaration`（`isMindMapProperty` 只是它的布尔包装）；「属性值 → 引擎 layout id」的唯一实现是 `layoutIdOfPropertyValue`，视图、升级入口与嵌入指令共用（嵌入不再自己判一遍）
* **布局的读 / 写各有唯一入口**：读 = `markdown/md-open.readDeclaredLayout`（同步读 MetadataCache；视图加载读完文档后会**再复问一次**，让缓存追赶的时间不至于让勾选态停在种子值上）；写 = `features/view.applyLayout`（排空正文 → 写属性 → 成功才动画面）
* **绕过保存管线的写入要作废基线**：新增 `SavePipeline.forgetBaseline`——属性写入后若不作废「上次写出的内容」基线，下一次自动保存会把它误判成「他处修改」而整轮跳过（表现为此后每次编辑都静默不落盘，直到一次显式保存成功）
* **竞态守卫**：`applyLayout` 写属性期间置「在途标记」，`changed` 触发的跟随侧据此让位并按值幂等——否则同一布局会被应用两次（双重重排 + 竖栏连建两次）
* **单一应用点**：`applyLayoutToEngine`（会话值 → 引擎 → 竖栏 → 小地图，顺序即契约）由「写属性成功后」与「跟随外部改写」两个入口共用
* 全量测试 **89 文件 / 2498 例**；门禁 `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `check:release` 均通过

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖；**`styles.css` 无变化**（本版只改逻辑与文档，替换 `main.js` 即可，`manifest.json` 请一并更新）
* **破坏性：旧键不再识别**。用 `类型: Mindmap` / `Type: Mindmap` 的老文件升级后按普通笔记打开——把键名改成 `Mindmap`（值 `Mindmap`）即可恢复；或在文件右键里点一次「以思维导图打开」，插件会补写标准键（旧键留着不动）。插件**不会**自动改写或删除任何旧键
* **回滚到 0.2.6 及更早**：需先把声明改回旧形态——键名 `Mindmap` 改成 `类型`（英文库 `Type`）、值保持 `Mindmap`。旧版本既不认 `Mindmap` 这个键名，也不认布局枚举值
* **新值语义**：`Mindmap: Mindmap` 现在是「思维导图布局」（不再只是布尔开关）；终止渲染要写 `Mindmap: Markdown`。想保留布局、只是临时看源码，没有轻量入口——`Markdown` 是持久的
* `data.json` 结构变化：`viewState` 里的逐文件 `layout` 被清理（自动、幂等）；其余字段与设置项原样保留。**没有新增设置键，也没有新命令**，命令 ID 与导图文件格式、往返保真契约均不变

---

0.2.7 moves the **layout** out of the plugin's data and into the file's own property. One frontmatter declaration now says both "this is a mind map" and "draw it like this" — `Mindmap: Timeline` opens as a timeline, `Mindmap: Markdown` terminates (opens as a plain note). The layout therefore travels with the file: new device, sync, theme switch or reinstall all keep it, and the plugin's `data.json` no longer holds a second copy. Switching a layout from the right-click menu **writes that property** (body flushed first; if the write fails, neither the file nor the canvas changes), and an external edit is followed without being written back. The `mindmap` code block also gains a first-line `%%layout: <value>%%` directive so a single block can pick its own layout. **This release contains a breaking change**: the legacy `Type` / `类型` keys are no longer recognised (see "Compatibility notes").

<h3 id="en-v0.2.7">Added</h3>

* **The layout lives in the file property**: the `Mindmap` value *is* the layout — a seven-value enum: `LogicalStructure`, `Mindmap`, `OrganizationStructure`, `CatalogOrganization`, `Timeline`, `Fishbone`, plus the terminator `Markdown` (**stop**: no map, open as a plain note)
  * **Tolerant reading**: the key is case-insensitive, and the value is normalised (trim → lowercase → drop `-`, `_` and whitespace), so `mindMap` / `mind map` / `MIND-MAP` / `logical-structure` all work; multi-value properties from the native property panel use the **first** item
  * **An unknown value means "not a mind map"** (silent, fail-closed): a mistyped value is never rendered as a map, so it is visible at a glance instead of looking like "the property did nothing"
* **The Layout menu writes the property**: switching flushes unsaved body edits first, then writes `Mindmap` through the official `processFrontMatter` (only that one key), and re-lays out only after the write succeeded. A failure shows "Could not switch layout (the file property was not written)" and leaves **both the file and the canvas untouched** — there is no optimistic application
* **External edits are followed**: when the property panel, another pane or a sync client changes the value, an open map re-lays out accordingly but is **never written back**; an unchanged value does nothing (idempotent)
* **Per-block layout in `mindmap` code blocks**: a first line `%%layout: <value>%%` (leading blank lines allowed) renders that block with the given layout; the directive line is stripped before parsing and can never become a node
  * Only the **first** line counts: the same shape further down is just text (the note may well be documenting this syntax)
  * A value of `Markdown` or an unrecognised one is still stripped, the layout falls back to the **Default layout** setting, and a one-line notice appears inside the block (visible degradation, never silent)
  * **An empty value is not a directive**: `%%layout: %%` stays in the block as an ordinary comment, exactly like `%%note%%` (the line is not stripped and no empty notice is shown)

<h3>Changed</h3>

* **Breaking: one declaration key**. Only `Mindmap` is recognised; the legacy `Type` / `类型` keys are **not read, written, deleted, migrated or reported**. Existing files show up as ordinary notes — one click on "Open as mind map" writes the standard key (the old key is left in the file, untouched and ignored)
* **Switching the UI language no longer touches any file**: the former vault-wide rename of declaration keys is gone (the key is language-independent, so that migration had no reason to exist)
* **`data.json` no longer stores a per-file layout**: a legacy `viewState[*].layout` is dropped at startup (one write-back only when such a leftover actually exists, none otherwise); the line style / palette / border / viewport in the same entry are untouched
* **"Default layout" now means the seed value only**: it decides the initial value written when **creating or upgrading** a file, and no longer affects any existing or open map (it therefore also left the "live refresh" settings set)
* **Upgrading writes the seed layout**: manually opening a plain note as a mind map writes the standard value of the **Default layout** setting (factory value `Mindmap: Mindmap`), i.e. the same initial layout as "Create new mind map"; files already declared are never re-serialised
* **Downgrading short-circuits less**: "Open as Markdown" skips the write only when the value **is already** `Markdown`; layout values and hand-written unknown values are rewritten — `Markdown` is the only explicit terminator

<h3>Engineering</h3>

* **Still one single predicate**: `domain/mindmap-property.readMindMapDeclaration` (`isMindMapProperty` is just its boolean wrapper); "property value → engine layout id" has exactly one implementation (`layoutIdOfPropertyValue`), shared by the view, the upgrade entry and the embed directive (the embed no longer decides on its own)
* **One reader and one writer for the layout**: read = `markdown/md-open.readDeclaredLayout` (synchronous MetadataCache; after the document is read the view **asks once more**, so metadata catch-up cannot leave the menu tick on the seed value); write = `features/view.applyLayout` (flush the body → write the property → touch the canvas only on success)
* **Writes that bypass the save pipeline must invalidate the baseline**: new `SavePipeline.forgetBaseline` — without it the next auto-save mistakes the property write for a foreign edit and skips the whole round (your later edits then silently stay unsaved until an explicit save succeeds)
* **Race guard**: while `applyLayout` is writing, an in-flight marker makes the follower (`syncDeclaredLayout`) stand down and stay idempotent — otherwise the same layout is applied twice (double re-layout and two toolbar rebuilds)
* **Single application point**: `applyLayoutToEngine` (session value → engine → toolbar → minimap; the order is the contract) is shared by "property written" and "external edit followed"
* Full suite: **89 files / 2498 cases**; gates `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `check:release` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies; **`styles.css` is unchanged** (this release is logic and docs only — replacing `main.js` is enough, but update `manifest.json` too)
* **Breaking: legacy keys are no longer recognised.** Files using `类型: Mindmap` / `Type: Mindmap` open as ordinary notes after the upgrade — rename the key to `Mindmap` (value `Mindmap`) to bring them back, or click "Open as mind map" once and the plugin writes the standard key (the old key is left as is). The plugin **never** rewrites or deletes a legacy key automatically
* **Rolling back to 0.2.6 or earlier**: restore the older declaration shape first — rename the key `Mindmap` to `类型` (or `Type` in English vaults) and keep the value `Mindmap`. Older versions recognise neither the `Mindmap` key nor the layout enum values
* **New value semantics**: `Mindmap: Mindmap` now means "mind map layout" (it is no longer a boolean switch); to stop rendering write `Mindmap: Markdown`. There is no lightweight "peek at the source" entry — `Markdown` is permanent
* `data.json` shape changes: the per-file `layout` under `viewState` is cleaned up (automatically, idempotently); every other field and setting is kept. **No new settings keys and no new commands**; command IDs, the mind map file format and the lossless round-trip contract are unchanged
