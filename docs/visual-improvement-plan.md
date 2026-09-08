# 思维导图渲染视觉改进方案

> 依据：用户截图（DeepSeek Harness 导图，亮色主题，logicalStructure 布局）。
> 关联实现：`src/mindmap-theme.ts`（主题配置）、`styles.css`（节点/富文本样式）、`vendor/simple-mind-map.cjs`（引擎）。
> 状态：**P1 已终版闭环（§2.1 证据链定案 + URL-label 漏网形态已修）；P2 已实施；P3 已实施（三类图标 + 单击打开链接文本）**。验证记录见 §6。

---

## 1. 截图问题清单

| # | 现象 | 级别 | 状态 |
|---|------|------|------|
| 1 | **全部子节点等宽（≈415px）**：「API key」6 字符也占满整框，右侧大片空白；根节点却正常自适应 | P1（缺陷级） | ✅ 终版闭环（§2：URL 顶满换行上限 + 会话旧构建；URL-label 漏网形态已修） |
| 2 | **视觉噪音均质**：根/二级/三级全用蓝系（#4a90d9 边线 + 蓝框），连线、边框、图标全是同一主蓝，无视觉重心 | P2 | ✅ 已实施（§3） |
| 3 | **布局松散**：框高 ~26px 而行间距 ~20px+，间距/内容比失衡，一屏信息量低 | P2 | ✅ 已实施（§3） |
| 4 | **连线生硬且过重**：2px 直角折线 + 饱和蓝，抢过节点内容的戏 | P2 | ✅ 已实施（§3） |
| 5 | **链接双重表达**：URL 全文文本 + 尾部外链图标，长 URL 撑宽节点、重复传达同一信息 | P3 | ↩️ 书写建议已撤回（§4） |
| 6 | 外链图标每节点必现、常亮，重复元素多 | P3 | ✅ 已实施（URL icon-only 后仅 URL 节点带图标；三类图标两两可辨） |

## 2. P1｜子节点等宽异常：诊断结论（已闭环）

### 实证方法

将 `vendor/simple-mind-map.cjs` 以 esbuild 打包为浏览器 IIFE，在真实 Chrome（headless）中加载引擎 + 插件样式，构造 6 种节点形态直接测量 `foreignObject` 宽度。实验页保留于 `D:\Obsidian\.workbuddy-tmp\minimal.html`（可复现）。

### 实验数据（引擎原生行为，全部自适应）

| 节点内容 | foreignObject 宽度 |
|----------|-------------------|
| 「API key」（6 字符纯文本） | **51px** |
| 「API key」+ `hyperlink` 字段（图标节点） | **51px**（图标未撑宽） |
| 「指令」+ 超长 hyperlink URL | **29px**（URL 长度不影响） |
| 「API + 长链接文本」 | 322px |
| 「插件市场 + 链接」 | 212px |
| 纯文本长句 | 289px |

### 结论（v2 终版，2026-09-08 反编译 + 修复复核）

1. **引擎测宽无缺陷（7 项假设全部证伪）**：测量代码（`measureRichtextNodeTextSizeEl`，`position:fixed` shrink-to-fit + `maxWidth = textAutoWrapWidth(500)`）在纯文本、`<a>` 富文本、`hyperlink` 字段三种路径下均正确输出自然宽度。历次证伪：block 级 wrap、`customTextWidth` 直设、`openPerformance`、插件 styles.css（无宽度规则）、vendor CSS（无 richtext 规则）、data.json（viewState 仅存 layout+视口，不缓存树）、测宽元素样式残留（`Ha` 每次全量覆盖 7 键）。
2. **`customTextWidth` 路径彻底排除（修正 v1 推断）**：反编译确认 `hasCustomWidth() = checkEnableDragModifyNodeWidth() && customTextWidth !== undefined`，而 `checkEnableDragModifyNodeWidth()` 要求 opt `enableDragModifyNodeWidth`——该键**不在引擎默认值中、插件也从不设置**，故拖宽手柄永不激活、该字段既写不进也不生效。「拖宽状态残留」假设不成立。
3. **等宽的真实机制**：测宽结果 `f = min(ceil(f)+1, textAutoWrapWidth)`——**当节点测量输入含超长不可断行内容（完整 URL）时全部被钳到 500px 上限 → 视觉等宽**（截图 415px ≈ 500px × 缩放比）；根节点无 URL 故自适应。与第 3 轮截图「URL 全文文本」状态完全吻合。
4. **URL-label 漏网形态已修（本轮）**：`[https://…](https://…)`（label 本身是 URL，复制粘贴常见）此前 label 不在剥离范围（负向回顾仅排除括号目标），节点文本仍含完整 URL → 继续顶满上限。现已按 icon-only 规范剥离（`buildInlineData` 不推送 + `stripMarkdownInline` 同口径置空），rawOk 双侧一致，无损往返保持（测试锁定：md-inline/md-roundtrip/url 三处新增用例）。
5. **用户侧动作**：完整重载插件（禁用再启用，或 Ctrl+P → Reload app without saving）使新 main.js 生效后重开文件——URL 不再进节点文本，宽度随内容。若个别节点仍异常等宽，提供该 `.mindmap.md` 片段走数据侧排查。

## 3. P2｜主题配置改进（`src/mindmap-theme.ts`）——已实施

设计原则：**视觉重量随层级递减**——根最重、二级次之、三级最素；连线退为背景层。亮色落地值（暗色同步：`border` `#555`→`#3f3f3f`、`line` `#555`→`#4a4a4a`、`nodeText` `#c0c0c0`→`#a0a0a0`）：

```ts
const LIGHT_COLORS: ThemeColors = {
	primary: '#4a90d9',
	rootFill: '#4a90d9',        // 保留品牌主蓝（视觉重心）
	rootText: '#ffffff',
	secondFill: '#f1f5f9',      // was #e8f0fe：去蓝底改中性淡灰蓝
	secondText: '#1e293b',      // was #333333：加深对比
	nodeFill: '#f8fafc',        // was #ffffff：与画布微区分
	nodeText: '#64748b',        // was #333333：层级递减，三级最素
	border: '#cbd5e1',          // was #4a90d9：边框去主蓝改灰
	line: '#94a3b8',            // was #4a90d9：连线退为背景层
};
```

`buildThemeConfig` 同步追加（引擎运行时已验证支持，d.cts 未声明——经 `Record<string, unknown>` 透传，与现有防腐口径一致）：

```ts
lineWidth: 1.5,               // was 2
lineStyle: 'curve',           // was 默认直角：圆滑曲线更柔和
marginX: 60,                  // 收紧水平间距（引擎默认偏大）
marginY: 24,                  // 收紧行距，提升一屏信息量
```

### 备选路线（可选增强，二期）

**分支着色**：二级节点按所属分支循环 4-6 色色板（XMind 彩虹风格）。引擎主题仅支持 root/second/node 三档全局配色，按分支着色需渲染后遍历二级节点逐个 `setStyle`，涉及 `features/` 层新逻辑，建议一期落地验收后再评估。

## 4. P3｜链接与图标展示优化

1. **图标三类区分（已实施，2026-09-08 第二轮）**：外部 URL → 引擎原生链接图标；双链指向附件 → 引擎 `attachmentUrl` 通道（原生回形针，`node_attachmentClick` 事件由视图接管按 Obsidian 语义打开）；双链指向文档 → 自绘文档页图标（最初走 `addCustomContentToNode` 钩子，后改为 `opt.createNodePrefixContent` 前缀内容——前者把 el 放进 `foreignObject`，裸 `<g>` 实测 0×0 不可见，且不参与测宽；现实现见 `src/mindmap.ts`，行为规格已同步 `docs/markdown-mindmap-standard.md` §2.2/§2.3）。
2. **URL icon-only（已实施）**：裸 URL（`https://` 等）token 化为 `bareUrl`，与 `<url>` 同语义——URL 本体不渲染进节点文本；richText 渲染输入经 `stripUrlTokensForDisplay` 同步剥离（负向回顾排除 `[t](url)` 括号内目标）；未编辑逐字回写、编辑后合成为 `<url>`。
3. **图标淡化（缓实施）**：实验中未定位到图标的稳定 DOM 选择器；需在 Obsidian DevTools 中确认图标元素与选择器后，再于 `styles.css` 追加淡化规则（预期 `opacity: .45` + hover 恢复）。
4. **书写建议（已撤回，用户决定）**：不引导用户书写形态，见上轮记录。

## 5. 实施状态与验证记录

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | §2 诊断，锁定 P1 根因 | ✅ 引擎证清白，根因 = `customTextWidth` 拖宽状态 |
| 2 | P1 CSS 修复 | ⊘ 证伪后取消（引擎无缺陷） |
| 3 | §3 主题色板/间距/曲线（亮+暗） | ✅ 已实施 |
| 4 | §4 标准文档书写建议 | ↩️ 已撤回（用户决定，标准文档恢复原状） |
| 5 | §4 图标淡化 | ⏸ 待 DevTools 实测选择器 |
| 6 | `npm test && npm run lint && npm run build` | 见提交前运行记录（要求全绿） |

## 6. 测试补齐（P1-1）过程中发现的待办

补 `tests/view-dnd.test.ts` / `tests/modal-common.test.ts` 等用例时暴露的行为问题；**已修 8 条**（见下「已修」），其余**仅记录、未修改实现**（按严重度排列）。

### 已修

- `view-dnd` 拖入失败原为纯 `console.error`（用户无感知），已改为 `notifyError`（新增文案 `common.dropFailed`）——与 AGENTS.md「用户可见错误统一走 notifyError」一致。
- `styles.css` 中「`> div { width:100% }` 会导致节点等宽 500px」的注释与实测不符（已证伪，见 §2），注释已改写为准确结论，避免后人按错误机制「修复」。
- `view-search` **「无匹配」不可达**（补测发现的真实缺陷）：`runSearch` 只靠引擎回调刷新计数，而引擎 `Search.searchNext` 在 `matchNodeList.length <= 0` 时提前 return，回调根本不触发 → `common.noMatch` 文案与 `mindmap-search-no-result` 类永远不出现，计数停留在上一次结果。修法：`searchMindMap` 之后**无条件** `updateSearchCount`（引擎搜索为同步执行，此刻 `matchNodeList`/`currentIndex` 已就位；有命中时与回调重复刷新同值）。
- `view-search` **防抖窗口内跳转作用于陈旧结果**：`searchNext`/`searchPrev` 不 flush 未决防抖，输入后 180ms 内按 Enter 会先按上一次关键词的 `matchNodeList` 跳转。修法：新增 `flushPendingSearch`，未决时先落地搜索并**不再额外跳转**（引擎搜索本身已定位首个命中）。
- `modal-name` **空白确认「死按钮」**：原 `!input.value.trim()` 时只 `input.focus(); return;`——不 settle、不关闭、无任何反馈，用户会以为「确定」坏了。修法：确认按钮随输入**实时置灰**（`syncConfirmState`，`ButtonComponent.setDisabled`），Enter 路径仍由 `confirm` 内守卫兜住（只重新聚焦）。
- `modal-link` **手输别名不同步节点文本**：原 `commitRaw` 只返回 `{link}`，无 `label`，与文件头「label = 笔记名/别名/文件名」的契约不符（只有联想选择路径有 label）。修法：`commitRaw` 解析 `[[目标|别名]]` 的别名作为 `label`。
- `view-node-actions.applyAttachmentLink` **附件别名被丢弃**：`name = label ?? 末段文件名` 会忽略 `[[报告.pdf|说明]]` 的别名（文档双链经 `linkDisplayText` 已支持别名，附件通道没有）。修法：可见名优先级改为「显式 label > 双链别名 > 末段文件名」，与解析侧 `tokenDisplay`（别名优先）同口径。
- `view-dnd.handleExternalFilesDrop` **多图拖入只保留最后一张**：循环对同一节点反复 `applyNodeImage`（`SET_NODE_IMAGE` 覆盖图片字段），却弹 N 次「已设置节点图片」+ 汇总「已导入 N 张」——静默丢图。修法：**首张仍挂所选节点**（单图行为不变），**其余各新建一个承载图片的子节点**（`INSERT_CHILD_NODE` 初始数据直接携带 `image/imageTitle/imageSize`，图片独占语义无文本），汇总提示改单条并说明归属（新文案 `common.imagesPlaced`）；同时**逐张容错**（单张保存失败不中断其余，失败经 `notifyError` 汇总上报，新文案 `common.importImageFailed`）。
- `modal-common.createModalSettle` **覆写 modal.onClose**：原实现 `modal.onClose = () => settle(null)` 会盖掉调用方/子类已有的 `onClose`。修法：改用官方 `Modal.setCloseCallback`（1.10+，minAppVersion 1.13.0 已满足）注册兜底，与 `onClose` 并存；`tests/modal-common.test.ts` 增「调用方 onClose 仍被调用」用例（变异测试证明：改回覆写实现即失败）。

### 待定（需产品决策或另立任务）

| # | 位置 | 现象 | 影响 |
|---|------|------|------|
| 1 | `view-dnd.handleFileDrop` | `resolveDroppedFile` 只返回首个库内文件，多选拖入其余静默忽略 | 无提示 |
| 2 | `i18n.common.onlySupportedFiles` | 文案说「仅支持 Markdown 笔记或图片」，实际 pdf/epub/zip/音视频走附件分支 | 文案与行为不一致 |
| 3 | `view-dnd` 未选中节点分支 | 图片 → 提示；`.md`/附件 → 静默挂到根节点 | 行为不一致（可能有意） |
| 4 | `view-dnd` dragleave | `canvas.contains(event.relatedTarget as Node)` 未做类型守卫（非 Node 目标会抛 TypeError） | 低概率 |
| 5 | `modal-common.VaultFileSuggest.getSuggestions` | 只匹配 `basename`，界面显示名（附件含扩展名）/路径/文件夹名搜不到 | 联想可用性 |
| 6 | `modal-common.VaultFileSuggest.renderSuggestion` | 根目录文件仍渲染空路径 span | 无用 DOM |
| 7 | `modal-common.MAX_SUGGESTIONS` | 未导出，测试只能硬编码 20 | 覆盖缺口 |
| 8 | `view-search.closeSearchBar` | `searchBarEl` 为 null 时提前返回，跳过 `endMindMapSearch` 与防抖取消（当前不可达：view.ts 只在 onOpen 建一次且不清空） | 潜伏 |
| 9 | `view-search.openSearchBar` | 以 `!view.mindMap` 为守卫，引擎就绪前 Mod+F 静默无反应（搜索栏本身不依赖引擎） | 低 |
| 10 | `modal-link` 重名消歧 | 用含 `.md` 的 `file.path` 生成 `[[目录B/笔记甲.md\|笔记甲]]`（Obsidian 自身插入不带扩展名） | 可解析，风格不一致 |
| 11 | `modal-link` Enter 与联想浮层 | input 的 Enter 直接提交原始文本并 `preventDefault`，官方 `AbstractInputSuggest` 浮层打开时也用 Enter 选候选——空桩环境无法判定是否冲突 | 可能提交原始文本而非选中项 |
| 12 | `modal-name` / `modal-link` 细节 | name 的 Esc 分支不 `preventDefault()`；link 输入框缺 `spellcheck:'false'`（中文别名可能被标红）；选择联想即 settle+close（无法再改 label），且不写入 input.value | 低 |

上述 1-2 若确认要支持批量，建议：一次拖入 N 张 → 逐张建子节点（而非覆盖同节点），并把失败逐项容错后再汇总提示。

## 7. P1 列表执行记录（代码质量改进轮次）

| 项 | 内容 | 证据 |
|---|------|------|
| P1-1 | 补齐 `view-*` / `modal-*` 单测 | 新增 7 个测试文件（`view-status`/`view-wikilink`/`view-context-menu`/`view-search`/`view-dnd`/`modal-common`/`modal-input`，清单见 AGENTS.md `tests/`）；`npm test` 308 → 420 例 / 30 文件全绿；覆盖率 statements 43.56% → 59.65%，branches 86.01% → 86.53%（`modal-common`/`modal-link`/`modal-name`/`view-status` 100%，`view-context-menu` 99%，`view-search`/`view-wikilink` 97%，`view-dnd` 95%） |
| P1-2 | 交互会话（拖拽换父/图片调宽）临时 window 监听随视图关闭收尾 | `teardownDragTargetAssist` / `teardownImageResize` 导出并在 `view.ts onClose` 调用（先于 `savePipeline.save()`）；`tests/feature-teardown.test.ts` 5 例 |
| P1-3 | 浮动 Promise 不再产生未处理拒绝；静默吞错分级 | `addLinkToActiveNode` / `addImageToActiveNode` 自兜错误（`notifyError` + `console.error`）；`view-dnd` 拖入失败由纯 `console.error` 改为 `notifyError`；`engine-controller.persistViewport` / `setNodeText` / `walkCorrectImageSizesByAspect` 三处静默 catch 降级为 `console.warn`（批量探测按次数汇总一次）；`tests/view-node-actions.test.ts` 增 2 例锁定「不外抛」 |
| P1-4 | 节点引用字段单一来源 | `node-data.ts` 的 `NODE_REFERENCE_FIELDS` / `hasNodeReference` / `nodeReferenceHaystack`（`links-tree` 与 `engine-controller` 引用预检共用） |
| P1-5 | 设置值域校验 | `settings.sanitizeSettings` 的 `pickFrom`（布局/主题白名单）+ `pickClampedInt`（导出倍率/性能阈值钳制），`tests/settings.test.ts` 覆盖 |
| P1-6 | 无头渲染契约验证固化 | `scripts/verify-visual.mjs` + `npm run verify:visual`（5 场景断言图标三类分流/图标尺寸/画布铺满/测宽；无 Chrome 跳过、`--require-chrome` 失败、`--keep` 保留现场）；**已反向验证**：临时禁用图标注入 → 退出码 1 且定位到 doc 场景 |

验证命令（提交前须全绿）：`npm run build && npm run lint && npm test && npm run verify:visual`。
