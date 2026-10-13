[中文](#cn-v0.2.1) | [English](#en-v0.2.1)

0.2.1 把**导图嵌入笔记**带回来：任意笔记里写一个语言标识为 `mindmap` 的围栏代码块，阅读视图 / 实时预览就地把块体渲染为**只读导图**（形态对齐 Obsidian 内置的 Mermaid：容器随内容、内容完整可见、不可拖动、不可调节）。同时**图片不再要求先选中节点**——粘贴、库内拖入、系统拖入的图片未选中节点时各自新建一个图片节点。另含若干可见性与健壮性修复（无扩展名文件的附件重名、重命名失败提示带根因、复制链接失败留痕等）。

<h3 id="cn-v0.2.1">新增</h3>

* **笔记内嵌入只读导图（```` ```mindmap ```` 代码块）**：在**任意笔记**里写语言标识为 `mindmap` 的围栏块，阅读视图与实时预览会把它**就地渲染为只读导图**。块体语法与导图文件正文**完全一致**（标题 + 列表，同一份解析器），**不存在第二套格式**；语言键沿用 0.0.1 的 `mindmap`，**存量旧笔记无需改动即重新可用**（该能力曾在 0.0.3 移除）
* **形态对齐内置 Mermaid**：容器**高度随内容**——按笔记宽度等比缩放（**只缩不放**），内容完整可见、小图**不再留一片空白框**；**不可拖动、不可缩放、不可调节大小**（无 resize 手柄、无平移）；**滚轮照常滚动笔记**（指针悬在图上时也一样）；节点内链接**仍可点**（由 Obsidian 自身的链接委托处理，当前标签打开、不会双开）；块内代码块的复制按钮可用
* **超限降级为只读大纲**：块内节点数超过 **500** 时**不建引擎**，改为只读缩进大纲并在块内提示「导图节点数 N 超过嵌入上限 500，此处仅显示大纲」——一篇笔记可有多个块，避免打开成本随块数线性叠加。**空块体**与**渲染失败**同样各有一行可见提示，不静默
* **嵌入不产生任何副作用**：**不回写文件**、**不写插件 `data.json`**（布局 / 视口每次按当前设置重算），只读预览用完即走
* **图片未选中节点也能贴入导图**：粘贴剪贴板图片、从文件列表拖入库内图片、拖入**系统图片文件**——未选中节点时各在**中心节点下新建一个图片节点**（选中节点时行为不变：设为该节点图片）。此前粘贴与系统拖入会提示「请先选择一个节点再粘贴图片」，该提示已移除；库内非图片文件（文档 / 附件）未选中时的行为不变

<h3>修复</h3>

* **无扩展名文件的附件重名后缀不再产生非法名**：附件入库遇重名时此前会生成 `Makefile 1.` 这类**尾随裸点**的名字（Windows 与 Obsidian 均非法）；现在无扩展名时只追加序号
* **按中心节点重命名失败时提示带根因**：与保存 / 新建 / 附件同口径，通知里显示具体原因，不再只有一句泛化文案（控制台同样留痕）
* **「复制链接」失败不再静默**：节点右键复制链接失败时，除提示外还在控制台记录错误
* **区块链接（`[[笔记#区块]]`）的改写口径统一**：链接改写不再自行查找并切分 `#`，改用解析器给出的区块段——消除「调用方与解析器各持一份切分口径」的漂移面
* **文档修正：`#` 标题不是中心节点**——中心节点是**文件名**（虚拟文档根，**不占文件里的任何一行**），`#` 起为第 1 级节点；README 的映射示例此前与此不符（权威口径见 `docs/markdown-mindmap-standard.md` §2），已订正

<h3>工程</h3>

* **自绘内容装配收口 `features/node-content-factory.ts`**：平台通道（官方 MathJax / Prism + 两处产物缓存）→ `InlineContentOptions` 的绑定**只此一处**，视图与代码块嵌入共用同一份装配（此前各写一遍，新增渲染通道会单边漂移）；宿主差异只剩 `isResolvedLink` 与 `onSettled`
* **链接导航收窄为最窄宿主面**：`openHyperlink` / `isResolvedWikiLinkpath` 的入参由整张视图装配面收窄为 `MindMapLinkHost { app, file.path, lang }`——嵌入因此能复用同一份跳转与未解析弱化判定，而不必另写一份
* **引擎防腐层新增四个具名入口**：`applyThemeConfig`（`isDarkTheme` + `getThemeConfig` 的合成只此一处，视图与嵌入共用）、`resizeMindMap`、`measureContentFitToWidth`（按宽度适配量测，只缩不放）、`centerContentAtScale`（由 `centerContentAtFullScale` 泛化，视图仍只走 `scale = 1`）；另新增 `readonly` / `enableViewDrag` 两个**引擎原生**通道入参
* **两处地址 / 交互收口**：地址比对形态收口为 `domain/url.urlComparisonForms`（此前三处逐字同构）；代码块交互入参由整张视图装配面窄化为 `CodeBlockInteractionHost { mindMap, engineEvents }`（块内复制按钮与视图共用同一实现）
* **性能**：尺寸同步会话的节点去重由 `Array.includes` 改为 `Set`（去掉 O(n²)，含大量图片 / 公式的批次明显）；拖入文件的库内解析不再无条件全量拷贝全库文件列表（只在真正需要的分支取）；编辑态判据收敛为 `isAnyNodeEditing`
* **冗余与文档清理**：`mindmap-property` 的键判定复用 `isMindMapPropertyKey`；`i18n` 删除永不触发的 `EN[key] ?? ZH[key]` 死分支并订正「EN 缺失回退 ZH」的过时说明；`math-jax` 删除同值别名 `MATH_CONTAINER_CLASS` 与重复 JSDoc、字符规则读取失败改走 `createWarnOnce`（**只告警一次**，不再每条数学都刷控制台）；`md-serialize` 去掉遮蔽外层入参的冗余 `app` 形参
* **门禁与回归**：`verify:visual` 新增 `embed` 探针（4 节点真渲染、**挂载点高度随内容**、无节点越出挂载点、`resize: none`、左键拖画布后节点位移 0、**合成 wheel 不被 preventDefault**、**容器收窄即按新宽度重排**、601 条降级大纲），并做 `obsidian dev:errors` 实机复核（无错误、嵌入渲染前后 `data.json` 哈希不变）；新增 `tests/mindmap-codeblock.test.ts`
* **发版前实机复核（专用测试库，含 0.0.1 时代的存量嵌入笔记与 500 / 5000 节点夹具）**：存量 `mindmap` 代码块**零改动即只读渲染**（挂载点随内容 700×123、`resize: none`、3 节点）；容器压到 240px 高度随宽度降到 69 且**无节点越界**、回弹复原；601 行块体**不建引擎**、降级只读大纲并提示「602 超过上限 500」；**未选中节点**时拖入库内图片与粘贴剪贴板图片**各自新建图片节点**并回写（`# ![[附件/图|480]]`，480 为自然尺寸长边封顶）；500 节点夹具打开为 500 节点 / 39 个 DOM 组（虚拟渲染生效）；全程 `obsidian dev:errors` 无条目，`data.json` 中**没有任何嵌入键**（嵌入不写插件状态）
* 测试全量 **71 文件 / 1998 例**

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* ⚠ **`styles.css` 有变化**：新增代码块嵌入样式（`.tmm-embed` 一族）——**必须与 `main.js` 一并替换**，否则嵌入会缺少边框 / 提示行与大纲的形态
* **设置项无变更**；导图文件格式、命令 ID、往返保真契约均不变
* **嵌入是纯预览**：不写 `data.json`、不回写文件；语言键 `mindmap` 与第三方插件抢注同键的行为官方未文档化（已登记为已知风险）
* **本版起可在社区插件目录直接安装**：**设置 → 第三方插件 → 浏览** → 搜索 *MindMap Studio*（README 已同步去掉「上架后」字样）

---

<h3 id="en-v0.2.1">Added</h3>

* **Read-only maps embedded in notes (a ```` ```mindmap ```` code block)**: write a fenced block with the language key `mindmap` in **any note** and reading view / live preview renders the block body **in place as a read-only mind map**. The block body uses **exactly the same outline syntax** as a mind map file (headings + lists, one shared parser) — there is **no second format**; the language key stays `mindmap` from 0.0.1, so **existing notes work again with no edits** (the capability was removed in 0.0.3)
* **Shaped like Obsidian's built-in Mermaid**: the container **grows with its content** — the map is scaled down to the note width (**never scaled up**), content stays fully visible and a small map **no longer leaves a big empty box**; **not draggable, not zoomable, not resizable** (no resize handle, no pan); **the wheel still scrolls the note** (even with the pointer over the map); links inside nodes **stay clickable** (handled by Obsidian's own link delegation — opens in the current tab, never twice); the copy button of code blocks inside nodes works
* **Over-limit fallback to a read-only outline**: above **500** nodes the block builds **no engine** and renders a read-only indented outline with an in-block notice ("The map has N nodes, above the embed limit of 500; showing an outline instead") — a note can hold several blocks, so open cost must not grow with the block count. **Empty block bodies** and **render failures** each get a one-line in-block notice, never silently
* **No side effects**: the embed **never writes the file** and **never writes `data.json`** (layout / viewport are recomputed from current settings on every render)
* **Images no longer require a selected node**: pasting a clipboard image, dropping a vault image from the file list, or dropping an **external image file** with **no node selected** now **creates an image node under the central node** (with a node selected, behaviour is unchanged: the image is set on that node). The old "Please select a node before pasting an image" notice is gone; non-image vault files (documents / attachments) behave as before when nothing is selected

<h3>Fixed</h3>

* **Attachment name collisions no longer produce illegal names**: when an incoming attachment collides, the plugin used to generate names like `Makefile 1.` with a **trailing bare dot** (illegal on Windows and in Obsidian); without an extension only the counter is appended now
* **Rename failures show the root cause**: renaming the file by its central node now reports the concrete reason, matching the save / create / attachment wording, instead of one generic message (and still logs to the console)
* **"Copy link" failures are no longer silent**: a failed node context-menu copy link is logged to the console in addition to the notice
* **One way to rewrite block links (`[[note#block]]`)**: link rewriting no longer looks for and splits `#` itself but uses the block segment parsed by the parser — removing the "caller and parser each own a splitting rule" drift
* **Docs correction: a `#` heading is not the central node** — the central node is the **file name** (a virtual document root occupying **no line in the file**), and `#` headings start at level 1. The README's mapping example contradicted this (the authoritative statement is in `docs/markdown-mindmap-standard.md` §2) and has been corrected

<h3>Engineering</h3>

* **Inline content assembly consolidated into `features/node-content-factory.ts`**: binding platform channels (official MathJax / Prism plus the two product caches) to `InlineContentOptions` happens in **exactly one place**, shared by the view and the code block embed (previously written twice, so a new rendering channel could drift on one side); host differences are down to `isResolvedLink` and `onSettled`
* **Link navigation narrowed to the smallest host face**: `openHyperlink` / `isResolvedWikiLinkpath` take `MindMapLinkHost { app, file.path, lang }` instead of the whole view assembly, so the embed reuses the same open/unresolved-dimming logic instead of a second copy
* **Four named anti-corruption entries added to `engine/mindmap`**: `applyThemeConfig` (`isDarkTheme` + `getThemeConfig` composed in one place, shared by the view and the embed), `resizeMindMap`, `measureContentFitToWidth` (fit-to-width measurement, shrink only) and `centerContentAtScale` (generalised from `centerContentAtFullScale`; the view still uses the `scale = 1` entry); plus `readonly` / `enableViewDrag` passed through to the **native** engine channels
* **Two address / interaction consolidations**: URL comparison forms consolidated into `domain/url.urlComparisonForms` (three verbatim copies before); code block interaction parameters narrowed from the whole view assembly to `CodeBlockInteractionHost { mindMap, engineEvents }` (the in-node copy button shares one implementation with the view)
* **Performance**: content remeasure node dedup switched from `Array.includes` to a `Set` (dropping the O(n²) scan for batches heavy in images / math); dropped-file vault resolution no longer copies the full vault file list unconditionally (fetched in the branch that needs it); the "is editing" predicate collapsed into `isAnyNodeEditing`
* **Redundancy and doc clean-up**: `mindmap-property` reuses `isMindMapPropertyKey`; `i18n` drops the never-taken `EN[key] ?? ZH[key]` dead branch and corrects the stale "EN falls back to ZH" note; `math-jax` drops the same-value alias `MATH_CONTAINER_CLASS` and a duplicated JSDoc, and routes an unreadable character rule through `createWarnOnce` (**warns once** instead of on every math render); `md-serialize` drops a redundant `app` parameter that shadowed the outer one
* **Gates and regressions**: `verify:visual` gains an `embed` probe (4-node real render, **mount height follows content**, no node outside the mount box, `resize: none`, zero node displacement after a left-button canvas drag, **synthetic wheel not preventDefault-ed**, **re-layout on container narrowing**, 601 flat items falling back to an outline), verified on a real vault with `obsidian dev:errors` (no new entries, `data.json` hash unchanged across embed renders); new `tests/mindmap-codeblock.test.ts`
* **Pre-release pass in a dedicated test vault** (holding a 0.0.1-era note with an embedded map plus 500 / 5000-node fixtures): the legacy `mindmap` block renders **read-only with no edits** (mount sized to content at 700×123, `resize: none`, 3 nodes); narrowing the container to 240px drops the height to 69 with **no node outside the box**, and it springs back; a 601-line block builds **no engine**, degrading to a read-only outline with the "602 above the 500 limit" notice; with **nothing selected**, dropping a vault image and pasting a clipboard image each **create an image node** and write it back (`# ![[attachments/img|480]]`, 480 being the natural-size long-side cap); the 500-node fixture opens as 500 nodes / 39 DOM groups (virtual rendering active); no `obsidian dev:errors` entries throughout, and **no embed keys at all** in `data.json` (the embed writes no plugin state)
* Full test suite: **71 files / 1998 cases**

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* ⚠ **`styles.css` changed**: new code block embed styles (the `.tmm-embed` family) — **replace it together with `main.js`**, otherwise the embed loses its border, notice line and outline styling
* **No settings changed**; the mind map file format, all command IDs and the lossless round-trip contract are unchanged
* **The embed is a pure preview**: it writes neither `data.json` nor the file; sharing the `mindmap` language key with third-party plugins is undocumented upstream (logged as a known risk)
* **Installable from the community plugin catalog as of this release**: **Settings → Community plugins → Browse** → search *MindMap Studio* (the README no longer says "once listed")
