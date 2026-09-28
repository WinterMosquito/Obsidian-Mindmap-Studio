[中文](#cn-v0.1.5) | [English](#en-v0.1.5)

0.1.5 聚焦**内容渲染、编辑体验与结构保真**：新增节点内代码块渲染与复制按钮、自绘节点内联编辑器、空节点保留；链接呈现统一为主题链接色；图片按自身原始大小展示（长边 480 封顶）并修复尺寸校正从未生效的缺陷；新建节点按层级回写为 Markdown 标题；数学通道三处实证修复。无破坏性变更。

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

<h3>性能</h3>

* 打开 500 / 5000 / 10000 节点约 420~432 / 952~979 / 1540~1760ms（较 0.1.4 继续下降）；单次编辑 5.3 → 4.0ms；长会话内存无泄漏

<h3>工程</h3>

* 测试全量 55 文件 / 1700 例（0.1.4 为 49 / 1578）；verify:visual 探针扩展至数学、代码块、图片回灌与层级回写场景

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`.mindmap.md` 格式、命令 ID 与设置项未变
* 请同时更新 `main.js` 与 `styles.css`（复制按钮外观已内联，仅更新 main.js 亦可，双更新避免旧样式残留）
* 图片 480px 长边上限为固定值；缩放只影响显示、不回写文件

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

<h3>Performance</h3>

* Opening 500 / 5000 / 10000 nodes at ~420~432 / 952~979 / 1540~1760 ms (further down from 0.1.4); a single edit 5.3 → 4.0 ms; no memory leak growth in long sessions

<h3>Engineering</h3>

* The full suite is 55 files / 1700 cases (0.1.4: 49/1578); verify:visual probes extended to math, code blocks, image write-back and level write-back

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; the `.mindmap.md` format, command IDs and settings are unchanged
* Update both `main.js` and `styles.css` (the copy-button appearance is inlined, so main.js alone works; updating both avoids stale styles)
* The 480px image long-edge cap is fixed; scaling affects display only and is never written back
