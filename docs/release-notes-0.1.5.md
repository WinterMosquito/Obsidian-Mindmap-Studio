[中文](#cn-v0.1.5) | [English](#en-v0.1.5)

0.1.5 聚焦**内容渲染、编辑体验与结构保真**：新增节点内代码块渲染与复制按钮、自绘节点内联编辑器、空节点保留；链接呈现统一为主题链接色；图片按自身原始大小展示（长边 480 封顶）并修复尺寸校正从未生效的缺陷；新建节点按层级回写为 Markdown 标题；数学通道三处实证修复。此外，本轮把**导出 PNG 的保真度**（与屏上渲染一致）和**编辑/保存通道的可靠性**（中心主题改名、混排双链自动拆分、外部修改保护、重复打开保护）一并收紧。无破坏性变更。

<h3 id="cn-v0.1.5">新增</h3>

* **节点内代码块渲染**：围栏代码块渲染为块级盒子（等宽 + 代码背景、保留换行缩进、双轴滚动），语言信息行不进显示与复制；附 Obsidian 同款复制按钮（外观全内联、导出图隐身）；按「轻量渲染」裁决不做语法高亮
* **自绘节点内联编辑器**：双击 / F2 / 右键「编辑文本」直接在节点内编辑原文——`Esc` 保留、点击外部提交、`Shift+Enter` 换行；弹窗保留为右键「在弹窗中编辑」备选入口
* **空节点保留**：新建的空节点渲染为可见小方块，可点击编辑，不再退化为普通段落

<h3>改进</h3>

* **链接呈现口径统一**：自绘节点内链接一律为主题链接色超链接文本（不再显示图标）；URL 显示为地址文本；未解析链接弱化色
* **图片按自身原始大小展示**：未设置尺寸的图按 1:1 自然尺寸渲染，长边超过 480px 等比缩小（只缩不放）；显式参数（`![[图|300]]`）不受限；自动尺寸不回写文件
* **新建节点按层级回写标题**：第 1~6 层分别回写为 `#`~`######`（与解析对称）；第 7 层起写列表。保护：已有节点不改类型；列表/段落之下、同层有列表项、显式选列表标记的新节点 → 写列表

<h3>修复</h3>

* **图片尺寸校正从未生效**：引擎对树数据做包装拷贝导致回灌匹配永远落空（所有图片停在默认尺寸）；改为双通道匹配（身份 + uid）并新增首帧渲染完成补灌
* **数学通道**：含 `\sin` 等命名函数的公式不再退回字面（不可见操作符 U+2061 不再误判）；`$$ … $$` 开侧带空格正常进块级渲染、块内 `\\` 保真；孤立 `$` 与反引号配对边界与官方逐条一致（不修改）
* **首次渲染时公式节点的尺寸**：含行内/块级公式的节点首帧尺寸不再与最终尺寸不一致（按产物元素反查重排）
* **导出 PNG 与屏上渲染不一致（多轮修复，最终收敛）**：依次修复「多行节点第二行被裁」「LaTeX 节点文字不全」「临界节点换行后被裁」「数学节点末行文字压到节点底边框」——导出 SVG 注入宿主实际生效的字体/颜色变量（度量与屏上一致）、变量值校验改为结构性字符校验（放行中文环境字体栈）、导出侧 foreignObject 保留几何余量（宽 +12 / 高 +20）、导出侧数学容器按屏上实测高度钉扎
* **中心主题改名不重命名文件**：默认渲染下编辑中心主题后文件未随之改名；现改为重命名 `新名字.mindmap.md`，并由 Obsidian 原生更新链接与反链
* **编辑混排节点不自动拆分双链**：节点同时含「描述文字 + 文档/附件链接」时，编辑后未自动把链接拆为子节点（批量命令却正常）；现已与批量行为一致（图片与外链仍留在原节点）
* **同一导图重复打开**：同一 `.mindmap.md` 在多个标签页打开会互相覆盖保存、丢失编辑；现在第二个标签会提示并让位，只保留一个编辑实例
* **外部修改保护**：导图被外部改动（同步盘/其它窗口）时，自动保存会跳过并提示一次，避免覆盖他处改动；连续写盘失败达到阈值会挂起自动保存并提示（手动保存不受影响）
* **外链安全**：节点内链接仅允许安全协议（`http/https/mailto/ftp(s)/obsidian/file`），`javascript:` 等危险写法不会被写成可点击链接

<h3>性能</h3>

* 打开 500 / 5000 / 10000 节点约 420~432 / 952~979 / 1540~1760ms（较 0.1.4 继续下降）；单次编辑 5.3 → 4.0ms；长会话内存无泄漏

<h3>工程</h3>

* 测试全量 57 文件 / 1739 例（0.1.4 为 49 / 1578）；verify:visual 探针扩展至数学、代码块、图片回灌与层级回写场景

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`.mindmap.md` 格式、命令 ID 与设置项未变
* 请同时更新 `main.js` 与 `styles.css`（复制按钮外观已内联，仅更新 main.js 亦可，双更新避免旧样式残留）
* 图片 480px 长边上限为固定值；缩放只影响显示、不回写文件
* 同一 `.mindmap.md` 只保留一个导图编辑实例：在第二个标签页再打开会提示并让位（避免保存互踩、丢失编辑）

---

<h3 id="en-v0.1.5">New</h3>

* **Code blocks inside nodes**: fenced blocks render as a box (monospace + code background, line breaks/indentation preserved, two-axis scrolling); the language info line stays out of display and copy; with an Obsidian-style copy button (fully inlined appearance, hidden in exports); no syntax highlighting by design
* **Inline editor for self-drawn nodes**: double-click / F2 / context-menu "Edit text" edits the original line in place — `Esc` keeps changes, clicking outside commits, `Shift+Enter` for a newline; the dialog remains as the "Edit in dialog" fallback
* **Empty nodes preserved**: newly created empty nodes render as a visible square (clickable, editable) instead of degrading into a paragraph

<h3>Improved</h3>

* **Unified link presentation**: links in self-drawn nodes render as themed hyperlink text (no icons); URLs show as address text; unresolved links are dimmed
* **Images at natural size**: images without a size render 1:1, proportionally capped at a 480px long edge (shrink-only); explicit parameters (`![[img|300]]`) are honored; automatic sizing never writes back
* **New nodes write back as headings by level**: levels 1~6 map to `#`~`######` (symmetric with parsing); level 7+ falls back to lists. Guards: existing nodes keep their type; nodes created under a list/paragraph, with list-item siblings, or with an explicit list marker stay lists

<h3>Fixed</h3>

* **Image size correction never worked**: the engine wraps tree data so identity-based write-back never matched (all images stuck at the default size); now dual-channel matching (identity + uid) plus a first-frame flush path
* **Math pipeline**: formulas with `\sin` etc. no longer fall back to literal text (invisible operator U+2061 no longer misjudged); `$$ … $$` with a leading space renders as a block and `\\` is preserved; the lone-`$`/backtick pairing boundary matches the official behavior case by case (left as-is)
* **First-frame size of math nodes**: nodes containing inline/block formulas no longer render at a size that differs from the settled one (re-measure by product elements)
* **Exported PNG no longer diverges from the on-screen render (multi-round fix)**: fixes "second line of a multi-line node clipped", "LaTeX node text incomplete", "borderline node clipped after re-wrap" and "last text line of a math node crossing the bottom border" — the export SVG now gets the host's effective font/color variables injected (same metrics as on screen), the variable-value guard rejects only structural characters (so CJK font stacks pass), foreignObjects keep a geometry margin (width +12 / height +20), and math containers are pinned to their measured on-screen height
* **Renaming the central topic did not rename the file**: with the default rendering, editing the central topic left the file untouched; it now renames to `NewName.mindmap.md`, with Obsidian updating links and backlinks natively
* **Editing a mixed node did not auto-split links**: a node mixing "description text + document/attachment links" kept its links after editing (while the batch command worked); editing now behaves like the batch command (images and external URLs stay put)
* **Opening the same map twice**: opening one `.mindmap.md` in several tabs could overwrite each other's saves and lose edits; the second tab now shows a notice and steps aside so a single editing instance remains
* **External-change protection**: when the map is modified outside Obsidian (sync folder / another window) auto-save is skipped with a one-time notice instead of overwriting; after repeated write failures auto-save is suspended with a notice (manual save still works)
* **Link safety**: in-node links are limited to safe protocols (`http/https/mailto/ftp(s)/obsidian/file`); `javascript:` and similar are never written as clickable links

<h3>Performance</h3>

* Opening 500 / 5000 / 10000 nodes at ~420~432 / 952~979 / 1540~1760 ms (further down from 0.1.4); a single edit 5.3 → 4.0 ms; no memory leak growth in long sessions

<h3>Engineering</h3>

* The full suite is 57 files / 1739 cases (0.1.4: 49/1578); verify:visual probes extended to math, code blocks, image write-back and level write-back

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; the `.mindmap.md` format, command IDs and settings are unchanged
* Update both `main.js` and `styles.css` (the copy-button appearance is inlined, so main.js alone works; updating both avoids stale styles)
* The 480px image long-edge cap is fixed; scaling affects display only and is never written back
* Only one mind-map editing instance per `.mindmap.md`: opening the same file in a second tab shows a notice and steps aside (prevents conflicting saves and lost edits)
