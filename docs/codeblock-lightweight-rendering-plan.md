# 实现方案：思维导图节点的代码块轻量渲染（Obsidian 同款复制）

> 状态：**待确认**（按工作区规则，确认后开工）。
> 已裁决范围（2026-09-28 用户确认）：① 复制 = Obsidian 阅读视图同款**悬停复制按钮**；
> ② 视觉 = **无语法高亮**的纯轻量形态（等宽 + `--code-background` + 保留换行缩进 + 超宽横向滚动）。
> 上游调研：`docs/codeblock-rendering-research.md`（Obsidian 代码块渲染机制全景）。

---

## 0. 目标与范围

在**思维导图视图**的节点内，把围栏代码块（`​```​…​```​`）从现状的「行内代码样式」升级为
**块级轻量代码块**，并提供 Obsidian 同款的复制交互：

| 维度 | 裁决 |
|---|---|
| 渲染位置 | 节点 foreignObject 内（自绘内容层） |
| 视觉 | 等宽 + 代码底色 + 保留换行/缩进 + 横向滚动；**不做 Prism 高亮** |
| 交互 | 悬停右上角复制按钮；点击复制**不含围栏**的代码内容；短暂 ✓ 反馈 |
| 覆盖面 | 仅自绘节点（`selfDrawPlainNodes` 默认开，与数学同口径）；混排节点（文字+代码块）自然支持 |
| 不做 | 回写编辑、语言标签、语法高亮、实时预览 CM6 定制 |

---

## 1. 现状与差距

- **现状**（K89）：fence 分支已把围栏块切为 `style:'code'` 段（`node-inline-content.ts:416`），
  经 `buildTextElement` 按**行内码**渲染（`MARKUP_STYLES.code`：`<code>` + 0.95em + 3px 圆角底）。
- **差距一（块级缺失）**：无独立底色块、无块级 padding、无横向滚动、无复制交互。
- **差距二（保真缺陷，本轮必须一并修，否则"代码块"观感不成立）**：
  1. **语言行混入**：fence 正则 `(?<fence>```+)(?<fenceCode>[\s\S]*?)\k<fence>` 不切信息行——
     ` ```js\ncode ` 的显示/复制内容会带上首行 `js`；
  2. **缩进塌陷**：`buildInlineSegmentsUncached.pushText` 在切段**前**对全文执行
     `replace(/[ \t]{2,}/g, ' ')`（prose 连续空格归一）——代码的 2+ 空格缩进与 Tab 会在
     **显示层**被压扁（mdRaw 无损，但渲染失真）。

---

## 2. 设计

### 2.1 数据层：段模型与缩进保真

- `InlineSegment` 增加 `block?: true`（仅 fence 分支设置）；`pushText` 装配时随段传播
  （对齐 `display` 字段的「重建段对象必须保留」约定，`node-inline-content.ts:610-612` 同款注释）。
  内联行内码与嵌套 children **不带** `block`。
- **语言行剥离用「展示时切分」，不改 fence 正则**（零回归）：

  ```
  splitFenceInfo(fenceCode):
    无 '\n'          → { lang:'', code:原文 }            // 单行形态 ```code```
    首行 trim 为空   → { lang:'', code:去掉首个换行 }     // ``` \n 内容
    首行非空         → { lang:首行trim, code:去掉首行 }   // ```js \n 内容（CommonMark：必为信息行）
  ```

- **缩进保真：归一化下沉**——`[ \t]{2,} → ' '` 从「切段前全文归一」改为「段装配时按段豁免」：
  `block` 段与 math 段**原文保留**，prose 文本段照旧归一（保持 pre-wrap 下的多空格观感不变）。
  归一化时机变化属行为敏感面，由现有 1630 例全量单测护航。

### 2.2 渲染层：`buildCodeBlockElement`

`buildTextElement` 分流：`style==='code' && segment.block` → 新构建器；行内码路径不动。

```
<div class="tmm-codeblock" style="position:relative; …内联样式表…">
  <button class="tmm-code-copy" aria-label="{t(lang,'codeBlock.copy')}"
          style="opacity:0; position:absolute; top:6px; right:6px; …"></button>
  <pre style="margin:0; white-space:pre; overflow-x:auto; max-height:…; overflow-y:auto">
    <code>{code 文本（已剥语言行、原始缩进）}</code>
  </pre>
</div>
```

- **全内联样式**（导出保真口径，同 `CONTENT_STYLES`/锚点先例）：容器
  `display:block; background:var(--code-background, 字面兜底); color:var(--code-normal, 兜底);
  font-family:var(--font-monospace, monospace); border-radius:6px; padding:10px 12px;
  max-width:100%; margin:4px 0`；`pre` 不另设背景。
- **max-height 封顶**：`CODE_BLOCK_MAX_HEIGHT_PX = 360`（`core/constants.ts` 新常量）——
  防超长代码块炸开导图版面；超出纵向滚动。
- **复制按钮默认 `opacity:0` 内联**：屏上 hover 由 styles.css 提亮；**导出 SVG 里没有
  styles.css → 按钮天然不可见**（无需导出特判，与本文件「导出图无主题上下文」的既有口径一致）。
- builder 保持**零 Obsidian 依赖、零监听**（`InlineContentDocument` 面不扩）——交互全走视图层（2.3）。

### 2.3 交互层：复制点击（方案对比）

| 方案 | 做法 | 评估 |
|---|---|---|
| **A. 视图层委托（推荐）** | 新 `features/node-codeblock.ts`：`registerCodeBlockInteractions(view)` 监听引擎 `node_click`（携带原始 MouseEvent，`view-wikilink.ts:203` 同款模式），`event.target.closest('.tmm-code-copy')` 命中 → 定位同块 `pre>code` 的 `textContent` → 复制 | 与锚点点击契约同构（`findAnchorInNode` 先例）；builder 零监听、测试桩面不变；注册点在 `view.ts:439` 旁一行 |
| B. builder 直挂监听 | 构建时 `addEventListener` | 被否：破坏「零依赖可单测」契约（测试桩需补事件面）；且与引擎合成派发的关系需额外验证 |

- 复制：`navigator.clipboard.writeText(text)`（app:// 安全上下文 + 用户手势内调用；
  拒绝/失败 `console.warn`，不弹错）。纯函数 `resolveCodeCopyTarget(target): string | null`
  收在 node-codeblock.ts 内（可单测）。
- ✓ 反馈：命中后按钮 `textContent='✓'` + `is-copied` 类 1.2s 后还原；重复点击重置计时器；
  定时器取 `btn.ownerDocument.defaultView.setTimeout`（prefer-window-timers 口径）。

### 2.4 styles.css 增量（仅交互态，不承载体量样式）

```css
.tmm-codeblock:hover .tmm-code-copy { opacity: 1; }
.tmm-code-copy { background: url("data:image/svg+xml,…copy 图标…") center/12px no-repeat;
                  color: var(--text-muted); }
.tmm-code-copy.is-copied { background: none; color: var(--text-success, var(--text-accent)); }
```

（图标用 data-URI 而非 `setIcon`：builder 零依赖；`is-copied` 态由视图层置 `textContent='✓'`。）

### 2.5 i18n 与常量

- `core/i18n.ts`：`'codeBlock.copy': '复制代码'` / `'codeBlock.copied': '已复制'`（EN 同步）。
- `core/constants.ts`：`CODE_BLOCK_MAX_HEIGHT_PX = 360`。

---

## 3. 边界与回退

| 场景 | 行为 |
|---|---|
| 非自绘节点（含图） | 引擎 SVG 文本 → 字面显示（数学同口径，不改） |
| `selfDrawPlainNodes` 关闭时的纯代码节点 | 现状不接管 → 字面。**建议顺带**：`needsHiddenSyntax` 增加 fence 判定（`segments.some(s => s.style==='code' && s.block)`），使代码块节点与数学同级「必须自绘」 |
| 超长节点（`MAX_INLINE_CONTENT_CHARS` 截断） | 沿用 `clampSegments`：代码块可能被截断 + `…` 尾标（既有口径） |
| 导出 SVG/PNG | 按钮不可见（opacity:0 内联 + 导出无 styles.css）；代码块底色/字体随内联样式保留（var 兜底字面） |
| 复制内容 | 剥语言行后的 `code` 文本原样（尾随换行是否 trim 对齐官方 [待实测]） |
| 段缓存 | `block` 随段进缓存（按原文内容寻址，无状态漂移） |

性能：纯同步 DOM 构建，零异步、零引擎加载、零新依赖——「轻量」的兑现。

---

## 4. 测试与验收

- **单测**（`tests/node-inline-content.test.ts` 增补）：
  ① fence 段带 `block:true`、行内码/嵌套 children 不带；缓存命中后标记仍在；
  ② `buildCodeBlockElement` 结构断言（容器/pre/code/button/aria-label/内联样式关键项：底色 var、
     white-space:pre、max-height 常量、按钮 opacity:0）；
  ③ `splitFenceInfo` 三形态（无 lang / 有 lang / 单行）；
  ④ 缩进保真：4 空格缩进的代码段文本不被归一，prose 双空格仍归一（回归锚）。
- **单测**（新 `tests/node-codeblock.test.ts`）：`resolveCodeCopyTarget`（命中/未命中/无 code）。
- **verify:visual**：新增探针——代码块节点渲染后断言 `.tmm-codeblock`/`.tmm-code-copy` 存在且
  `<pre>` 携带原文缩进；引擎合成 `node_click` 派发后 `event.target` 命中按钮（复用锚点点击契约机制）。
- **全链**：`npm run build` → `npm test` → `npm run lint` → `npm run verify:visual` 全绿 →
  构建 `main.js` 部署 vault（哈希核对）。
- **实机验收清单**：悬停显按钮 / 点击复制（粘贴验证不含围栏与语言行）/ ✓ 反馈 / 混排节点 /
  长行横向滚动 / >360px 纵向滚动 / 导出图无按钮 / 深浅主题切换底色跟随 / 缩进保留。

---

## 5. 风险与待实测

1. **引擎点击穿透**：非锚点内容上的点击是否始终以真实 target 进入 `node_click`（wikilink 先例
   支持成立，风险低）；若按钮命中失效 → 回退方案 B（builder 直挂监听）。
2. **测宽**：`pre` 的 scrollWidth 是否影响引擎内容测宽（期望 clientWidth 钳制在内容盒内）——
   verify-visual 探针覆盖；异常时给 `pre` 加 `min-width:0` / `contain`。
3. **单行围栏形态变化**：```code``` 由行内码变块级盒（对齐 CommonMark/Obsidian，属预期视觉变化）。
4. **归一化下沉**的 prose 回归面——全量单测 + verify-visual 护航。

---

## 6. 实施顺序（确认后执行）

1. `node-inline-content.ts`：`block` 标记 + `splitFenceInfo` + `buildCodeBlockElement` + 归一化下沉；
2. `core/constants.ts`（高度常量）+ `core/i18n.ts`（两个 key）；
3. `features/node-codeblock.ts`（新）+ `view.ts` 注册一行；`needsHiddenSyntax` 补 fence 判定；
4. `styles.css`：hover 提亮 + 图标/copy 态；
5. 单测 + verify-visual 探针 + 全链 + 部署。

涉及文件：`node-inline-content.ts`、`node-codeblock.ts`（新）、`view.ts`、`core/constants.ts`、
`core/i18n.ts`、`styles.css`、`tests/node-inline-content.test.ts`、`tests/node-codeblock.test.ts`（新）、
`scripts/verify-visual.mjs`（探针）、`AGENTS.md`（代码结构清单登记，agents-md-sync 强制）。
