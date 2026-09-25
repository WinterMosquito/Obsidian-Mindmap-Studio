# vendor/simple-mind-map 引擎维护说明

## 来源定性（已查明，原"fix 清单缺口"已关闭）

`simple-mind-map@0.14.0-fix.1 / -fix.2 / -fix.3` 是 **npm registry 上真实发布的第三方修订版**，
发布者「思绪思维导图」（https://sxmind.cn/ ，MIT，fork 自上游 wanglin2/mind-map 0.14.0），
并非本仓库自建的版本号。**2026-09-25 起，本仓库在其上维护自有补丁**（性能轮，共 3 处，
见「补丁清单」节）：vendor 产物 = fix.3 源码（`vendor/upstream/`）+ `vendor/patches/`，
经 `npm run build:vendor` 重打包。

`vendor/simple-mind-map.cjs`（411,297 B）= **fix.3 源码 + 自有补丁的按需 tree-shake 重打包**（2026-09-25 起）：

- 源码仓：`vendor/upstream/`（fix.3 原样入仓：`src/` 74 文件 + `index.js` + `full.js` + `package.json`）
  ＋ `vendor/patches/`（引擎侧自有补丁，见「补丁清单」节）；
- 重打包脚本：`npm run build:vendor`（= `node scripts/build-vendor.mjs`，`--check` 为只比对不写入模式）——
  不再依赖 node_modules 里临时安装的包，重打包在本仓库内完全可复现；
- 入口仅导出 8 个符号：`MindMap, DoExport, Select, TouchEvent, AssociativeLine, KeyboardNavigation, Search, Drag`；
- 打包命令（脚本内固化）：`esbuild entry.mjs --bundle --format=cjs --minify --target=es2021 --legal-comments=inline`（entry 从
  `./vendor/upstream/` 与 `./vendor/patches/` 以本地相对路径具名/副作用导入）；
- **打包面依赖**（须已安装，缺失时 esbuild 直接报解析错误；不改 package.json）：`simple-mind-map@0.14.0-fix.3`
  的依赖树——`npm install simple-mind-map@0.14.0-fix.3 --no-save` 即可满足；
- **已验证**：按此配方从 fix.3 重建的产物与 2026-09 前的旧 vendor 产物在「字符串字面量集合」
  与「数字字面量袋」双锚点校验下完全一致（1018/1018 字符串零增减、数字仅新增许可注释年份），
  差异仅 `--legal-comments=inline` 内联的许可注释本身。旧产物与重建产物的历史差异（三处打包
  痕迹：① 文件头 `"use strict";` 指令；② 模板字面量 CRLF；③ svg.js 副本无 `BUILT:` 横幅）
  已在 **2026-09-25 重打包**中随产物替换一并消除——当前 vendor 即「配方直出」产物。
- **2026-09-25 起产物内联第三方许可注释**（`--legal-comments=inline` 的实际落地）：
  `vendor/THIRD-PARTY-NOTICES.md` 仍承担归属与许可声明（双重保障），其 §3 已同步更新。

**产物字节级身份**（2026-09-25 性能补丁 ×9 后）：`vendor/simple-mind-map.cjs` 的 sha256（**按 LF 归一后**计算）=
`ce3bbadd973a9cbbedcd65140394265f6f4ae73cf6c28b55a14f6425cd9d5f77`（411,297 B），
由 `tests/vendor-contract.test.ts` 断言。**重新打包后必须同步更新此处与该测试里的常量**——
它是最外层护栏：其余契约断言（导出类 / 原型方法 / 命令名 / 事件名令牌）都只钉在
**API 面**上，对字节改动无感。（缺口来源：本文件第 22 行要求「不可手工编辑」，
但此前没有任何机械保障。）

> **哈希为何必须按 LF 归一**（2026-09-17 实测踩坑，勿「修正」回原始字节）：
> 仓库没有 `.gitattributes`，检出侧 `core.autocrlf=true`（Windows）把该文件写成
> **CRLF**，而 CI 的 Linux 检出得到的是索引里的 **LF** —— **同一提交的原始字节
> 跨平台不同**。实测（2026-09-17，重打包前产物）：本地原始字节哈希 = `a97b0caa…`（CRLF，96 处），
> CI = `dca4cead…`（LF；该值即 2026-09-25 重打包前的登记值）。故断言若不归一，必然**本地绿、CI 红**。
> 代价是纯换行符改动不再被发现；但那是检出方式的产物、不是内容改动，不作为漂移处理。
>
> 另：**不要**为此添加 `vendor/** -text` 之类的 `.gitattributes` —— 在既有 CRLF
> 工作副本上，那会让下一次 `git add` 把 CRLF 原样写进索引，等于**静默改掉** vendor 产物。

| 文件 | 说明 |
| --- | --- |
| `vendor/simple-mind-map.cjs` | fix.3 + 自有补丁的重打包产物。**不可手工编辑**——一切修改必须改 `vendor/upstream/`（或其上的已登记补丁）或 `vendor/patches/`，再 `npm run build:vendor` 重打包。 |
| `vendor/upstream/` | fix.3 源码入仓（2026-09-25）：打包源；承载已登记本地补丁（见「补丁清单」节）。 |
| `vendor/patches/` | 引擎侧自有补丁模块（经打包 entry 副作用导入注入，如 svg.js 包装）。 |
| `vendor/simple-mind-map.d.cts` | **手写**类型声明，只声明本插件用到的 API 面，引擎升级时人工审阅更新。 |

> **不再 vendor 引擎 CSS**（2026-09 清理）：上游 `dist/simpleMindMap.esm.css` 的内容
> **100% 是 Quill 富文本样式**（`.ql-*`，240 条选择器，无元素/全局选择器），而引擎本体
> 样式由 bundle 在运行时注入——`Render.appendCss()` 把内置 CSS 文本
> （`joinCss()` 的 `bo` 常量）写入 `document.head`。本插件从不注册 RichText 插件
> （`mindmap.ts` 只注册 Select/TouchEvent/AssociativeLine/KeyboardNavigation/
> DoExport/Search/Drag），bundle 中亦无 Quill 代码（`ql-` 仅出现在
> `if (this.mindMap.richText)` 守卫的导出分支与富文本文本提取助手里），故该 CSS
> 永不匹配任何元素。删除 `styles.css` 的 vendor 段后 `npm run verify:visual`
> 七项断言与节点测宽逐字节不变（已实测）。
> 升级引擎时若发现 `dist/*.css` 含非 `.ql-*` 规则（引擎把注入样式改回文件分发），
> 再按下方流程重新 vendor 并恢复 `scripts/sync-vendor-css.mjs`（见 git 历史）。

## 补丁清单（本仓库自有，2026-09-25 性能轮引入）

**原则**：vendor 产物的一切改动必须落在 `vendor/upstream/` 的已登记补丁或 `vendor/patches/`，
经 `npm run build:vendor` 重打包产出——产物本身永不手工编辑（sha256 护栏钉住）。
升级引擎（换 upstream 源码）时须逐条重放/复核本清单。

**补丁 1｜`upstream/src/core/render/node/MindMapNode.js` · O(n) 兄弟查找 → O(1) 父判断**
`render()` 的复用分支原用 `this.nodeDraw.has(this.group)` 判断组是否已在容器内——svg.js 的
`has → index` 实现是 `[].slice.call(childNodes).indexOf(node)`：**每节点每轮把全部兄弟节点
拷进新数组再线性查找**。500 节点图实测该项独占约 **27ms/轮**（`--perf-ops=rendertick` 空 render
落地 26–27ms，`--perf-ops=nodeupdate/noderenderline` 各 ≤1ms 形成排除链）。改为
`this.group.node.parentNode !== this.nodeDraw.node`（语义等价：`has` 只判直接子，节点 group
在 nodeDraw 下平铺）。**实测收益**（生产口径，`selfDrawPlain: true` 负载；见 AGENTS.md K73 ⑤）：
**空 render 落地 28.1ms → 3.0ms（-89%）；一次编辑 29.4ms → 5.3ms（-82%）。**
（旧口径负载读数：26.1→2.7ms / 47.6→21.4ms——口径差异与原因见 K73 ⑤。）

**补丁 2｜`upstream/src/utils/index.js` + `layouts/Base.js` + `MindMapNode.js` · 快照去 JSON 化**
节点数据快照原为 `JSON.stringify` 产出的字符串，布局脏值比较（`Base.checkIsNodeDataChange`）
再对两端各做 parse/stringify——**每节点每轮 1 parse + 3 stringify**。新增值级工具
`cloneNodeData`（深拷贝快照）与 `isNodeDataChanged`（深比较，忽略 `isActive`/`expand`，
NaN 对齐全 JSON 语义），替换两处快照生成（`MindMapNode.update` 与 `Base` 的 lru 复用分支）
及比较逻辑。单补丁收益约 1.4ms（在补丁 1 之上）；保留理由：值级比较是**零写点依赖**的
安全实现（任何数据变化都反映在值上），且消除每轮整树序列化分配（大图边际收益随节点数放大）。

**补丁 3｜`patches/svg-attr-shortcircuit.js` · svg.js 属性写同值短路**
包装 svg.js `Dom.prototype.attr`：单属性、原始值（string/number）的写路径先读后写，
字符串级同值则短路。空 render 实测 **2495 次同值 setAttribute ⇒ 0 mutation**
（`--perf-ops=mutation` 采集口径），编辑路径同值空写 1997 → 0。绝对值收益约 1.4ms；
保留理由：消除无效 mutation 与 Style/Layout 重算噪声，大图与低端设备边际更大；
保守边界见该文件头注释（对象/数组/getter/remove/ns 路径一律交还原实现）。

**补丁 4｜`upstream/src/core/render/node/nodeCreateContents.js` + `nodeLayout.js` · 自绘内容尺寸测量缓存**
`measureCustomNodeContentSize` 原 = 清空离屏容器 + appendChild + getBoundingClientRect——
**每节点一次强制 reflow**（5000 节点打开实测测量段 ≈ 700ms，K72）。改为**内容寻址缓存**：
自绘内容全部内联样式（K53 ⑤）⇒ `outerHTML` 即完整尺寸 key（模块级、跨引擎实例存活；
命中时连 `cloneNode` 一并省——调用方改传源元素）；**字体未就绪（`document.fonts.status
!== 'loaded'`）不写缓存**（防 fallback 度量污染）；容量 16384。
**实测收益（`BENCH_TWICE=1` 同页销毁重建通道）**：单次打开 1276ms ⇒ **第二次打开 ≈810ms
（-37%；容量 200000 对照 758ms/-41%）**。首次打开不变（缓存冷）。**容量教训**：4096
容量下「顺序重扫 + 淘汰」把命中率击穿，收益仅 20%（省 261ms）——容量须 ≥ 工作集。

**补丁 5｜`upstream/src/core/render/preMeasure.js`（新增）+ `index.js` + `MindMapNode.js` + `nodeCreateContents.js` · 首帧前预测量 + 元素复用 + 门禁实例化**
① **预测量**：`new MindMap` 之后、首帧 `setTimeout(0)` 前，经
`MindMap.preMeasureCustomContents(mindMap, buildContent)`（index.js 挂静态方法；buildContent
由 `engine/mindmap.ts` 绑定 doc/style/lang 注入——与 `customCreateNodeContent` 同一条
构建链）walk 数据树、用轻量代理节点预生成内容 → clone 集中挂载（`width: max-content`
wrapper 保持块级宽度语义）→ **一次 reflow** → 尺寸写入补丁 4 缓存。
② **元素复用（A2）**：预测量构建的元素按 uid 存入 `mindMap.__preMeasuredContentMap`，
`MindMapNode` 内容创建点优先取用（取用即删）⇒ 首帧只剩一遍内容构建。
③ **门禁实例化**：`checkEnableDragModifyNodeWidth` 由 opt 开关改为**实例事实**
（`isUseCustomNodeContent()`）——A2 后内容可不经构建回调创建，opt 口径会给出死手柄；
实例口径与拖宽内部三重检查（nodeModifyWidth）一致。
④ **实测（5000 节点）**：基线 1258ms → **1151ms（-8%）**；正式测量缓存命中
**4750/4750**。**重要教训**：只预测量不保留元素（A1 形态）实测**净零**——预测量构建
+ 正式构建构成两遍构建，抵消测量节省；`twice` 通道（K74）的 -37% 中主体是**热页红利**
（同页第二张图整体更快），**测量段真实成本 ≈100–150ms**（K72/K74 的「700ms」高估约 5 倍）。
⑤ **诊断常驻**：`__PREMEASURE_STATS__`（构建/命中/写入）与 `__MEASURE_STATS__`
（正式测量命中/未命中）页面全局，`--bench-open` 打印——测量缓存健康度的长期观测。

**补丁 6｜`upstream/src/core/render/Render.js` + `MindMapNode.js` · 打开分片渲染（async 通道激活）**
`_render` 的整树渲染调用原为同步（`root.render(cb)`）；激活引擎**既有** async 通道
（`MindMapNode.render` 第三参数——每子节点一个宏任务。**非新机制**：性能模式视口变化
路径 `onViewDataChange` 一直以 async=true 运行，见 `Render.js` bindEvent）：
`opt.renderAsync` 为真时改走 `root.render(cb, false, true)`。打开/重建大图时主线程
最坏阻塞从「整树单块」（5000 节点 ≈ 1137ms）降到「单节点块」（≈0.2ms）。
**实测代价**（`--bench-open` + `BENCH_RENDER_ASYNC=0/1` 对照，同 bundle 仅页内变量不同）：
500 节点 473→489ms（+3.4%）｜5000 节点 1137→1164ms（**+2.4%**）｜10000 节点
2255→2287ms（+1.4%）——相对代价随规模下降；正确性指标（DOM .smm-node / 自绘锚点 /
截断数）三规模**全一致**。安全前提（专项审计结论）：重入由 `hasWaitRendering` 排队
兜底、`node_tree_render_end` 仍在整树完成时 emit、渲染分片段 `renderer.root` 已回填
（引擎 12 处消费点全为交互触发，group=null 形态与性能模式视口外同构）；本补丁附带
**销毁断链守卫**（async 派发前检查 `mindMap.el`，destroy 后不再在游离 DOM 上白跑）。
插件侧注入：`RENDER_ASYNC_NODE_THRESHOLD`（1000，`core/constants.ts`）；
显式覆盖通道 `CreateMindMapOptions.renderAsync`（对照实验专用）。

**补丁 7｜`upstream/src/core/render/node/nodeModifyWidth.js` · 拖宽监听器惰性注册 + 会话解绑**
原实现**每个节点构造时**往 `window` 挂 `mousemove`/`mouseup`、往 `mindMap` 挂
`node_mouseup`——5000 个自绘节点（`checkEnableDragModifyNodeWidth` 实例口径恒真，
补丁 5 ③）= **15000 个监听器**，且**全库无任何解绑**。三重代价：① 打开期注册
**实测 ≈174ms**（5000 节点 A/B/B/A 交替对照：基线 min 1327ms vs 补丁 min 1153ms，
**-13%**——此前被 K77 误归入「引擎固有」）；② 运行期每次鼠标移动 10000 个 window
监听器全部被调用后靠 `!isDragHandleMousedown` 早退；③ **节点销毁后实例被 window
监听器永久持有**（潜伏内存缺陷：每开一次大图 +10000 个 window 监听器 + 实例滞留）。
改为**惰性注册**：`initDragHandle` 只 bind；手柄 `mousedown` 开始拖拽会话才注册、
`mouseup` 收尾（新增 `unbindDragHandleGlobalEvents`）即解——常态零全局监听，会话内
行为与原实现一致（同函数引用重复 `addEventListener` 被浏览器去重，天然幂等）；
`mouseup` 收尾补 `!this.group` 守卫（会话中节点被删除/撤销时安全解绑）。
**回归**：1578 测试 / 全部视觉探针（`history` 拖宽全流程、`handle` 手柄显隐）/ lint。

**补丁 8/9｜`upstream/src/layouts/Base.js` + `LogicalStructure.js` · 布局平移字段快路径 + 延迟物化**
`adjustTopValue`（兄弟子树对齐）原实现逐次对兄弟子树**立即全量平移**，5000 节点
逻辑结构图首帧实测 `updateChildren` **平移 293 万节点次**（约节点数的 584 倍：同一
子树被多级祖先的 `updateBrothers` 反复平移；计数探针 `BENCH_VARIANT=count-layout`
常驻，`--bench-open` 打印）。两步改造：**补丁 8**——`Base.updateChildren` /
`updateChildrenPro` / `updateBrothers` 的直接平移走**字段快路径**（`item[prop] +=
offset` 的 getter/setter 是 `customTop || _top` 读 + 写 `_top`；已核实 `_top`/`_left`
全库唯一读点在 getter 内部，「分量自定义位置为 undefined」时字段直写严格等价，
其余节点走原路径；单独收益 ≈23ms）；**补丁 9**——`LogicalStructure.adjustTopValue`
**延迟物化**：difference 判定只读 childrenAreaHeight2/height/margin（不读 top）、
task 内无外部观察者 ⇒ `updateBrothers` 改为记账（子树根 + 累计 offset；`:137`
跳过双分量自定义位置的既有语义保留）、task 末尾自顶向下一次物化（O(n)；**继承**
在 hasCustomPosition 处截断、**遍历**不截断——严格对齐原 `updateChildren` 递归
语义，含「记账根位于自定义位置祖先之下」的边界）。
**实测**（同批 A/B）：5000 节点 **1161→1091ms（-70ms / -6%）**；10000 节点
**2255→1741ms**（含补丁 7 的复合改善）。几何正确性：`layout` 探针（六布局渲染 ×
连线分派 × 根连线起点）+ 全部视觉探针 + 1578 测试全绿。

**方法论备注**：以上收益均由 `verify:visual --perf --perf-ops=<变体>` 的真实墙钟差分
（A/B/B/A 取最小，口径见脚本头注释）测得；页内时钟在 `--virtual-time-budget` 下被虚拟化，
不可用于计时。变体全表：`edit / editnohist / idle / rendertick / rendernocb / rootrender /
nodeupdate / noderenderline / nodedrawhas / layoutonly / themetick / rafonly / mutation /
copy / stringify / compare / history`。

## fix.3 相对上游 0.14.0 的修订清单（权威，源码 diff）

涉及 8 个源文件；打 ★ 者进入 vendor 打包面：

1. ★ `src/core/render/node/nodeLayout.js`
   - 新增 `customNodeContentRealtimeLayout()`：完全自定义节点内容的实时重排——重建形状节点、
     `shapeNode.back()` 置底避免遮挡 foreignObject、更新 foreignObject 尺寸；
   - 提取 `addHoverNode(width, height)` 公共助手；
   - `getNodeRect()` 对自定义内容改用 `cloneNode(true)` 测量，避免测量污染真实 DOM。
2. ★ `src/core/render/Render.js`
   - 新增 API `renderByCustomNodeContentNode(node)`：自定义节点内容变化后实时更新该节点
     尺寸并整体重渲染。
3. ★ `src/plugins/Export.js`
   - PNG 导出：canvas 超过像素上限被钳制时引入**每轴缩放因子**（`scaleX/scaleY`，初始 1），
     所有 drawImage 坐标与尺寸按因子补偿——修复大图导出被裁切/变形。
4. ★ `src/core/render/node/nodeCreateContents.js`
   - 新增 `getImageUrl()`：注册 NodeBase64ImageStorage 插件时节点图片字段存的是 id，
     经 `renderTree.data.imgMap` 反查真实 url；`createImgNode` 改用之。
5. ★ `src/layouts/Base.js`
   - `resetRichText` 触发重排的条件对自定义内容节点豁免（避免自定义内容节点被反复重排）。
6. ★ `src/parse/markdownTo.js`
   - `getNodeText()` 对 `list` 类型节点返回空串（修复列表节点文本重复）。
7. （不在 vendor 打包面）`src/plugins/RichText.js`：`isInserting` 分支退出时重置标志位。
8. （不在 vendor 打包面）`src/plugins/Demonstrate.js`：演示模式监听 `after_update_config` 同步配置。
9. 元数据：`version = 0.14.0-fix.3`、`authors = 思绪思维导图 / https://sxmind.cn/`
   （随包自带；bundle 内嵌的作者/版本字符串即来源于此，插件 UI 不展示这些字段）。

## 上游版本核对结论（2026-09-25）

**结论：核心库无更新版本可升级——当前 vendored `0.14.0-fix.3` 即上游核心库最新代码；
「0.15.0 ~ 0.20.0」为客户端发布，核心库源码零变更。**

证据链（均可复现）：

1. **npm 全版本线**（140 个，`npm view simple-mind-map versions`）最高 = `0.14.0-fix.3`
   （`latest`，2026-07-07 发布）；官方线止于 `0.14.0`（2025-04-08）。`0.14.1 / 0.14.2 /
   0.15.0 / 0.19.12 / 0.21.5` 等均**不存在**（registry 逐一 404；早期核对残留的
   `p-0.14.1/0.14.2/0.15.0.tgz` 实为 21 字节的 registry 404 响应体，非包产物）。
2. **上游 GitHub 整仓 tag 最高 `0.20.0`**（2026-08-03），但属**客户端发布**：release
   资产为 exe/dmg/AppImage，更新日志全部为客户端功能（AI / RSS / OPML / 网格 /
   历史版本等），**无核心库 API 变更 / Breaking / 性能项**；其 `simple-mind-map/package.json`
   的 `version` 仍为 `0.14.0-fix.3`，`src/` 74 文件 + `index.js` + `full.js` + `package.json`
   与本仓库 vendor 源（npm fix.3 包）**逐字节一致**（全量 md5 对比，零差异）。
3. **旁证**：官方 web 客户端（`thoughts`，0.20.0 tag 下 `web/package.json`）依赖
   `^0.14.0-fix.3`；`probe-0.19.12.cjs / probe-0.21.5.cjs` 为同体积（405,597 B）
   工具链探针产物，非新版本核心库。

**升级触发条件（满足任一再启动「升级流程」）**：

- npm `simple-mind-map` 出现 ≥ `0.14.0-fix.4` 或更高新版本；
- 上游仓库 `simple-mind-map/package.json` 的 `version` 字段变更（**整仓 tag 升级 ≠
  核心库升级**，必须以子包 `src/` 源码 diff 为准）；
- 需要跟进上游核心库某项修复（先做 `src/` diff 评估，再按需升级或 fork）。

## 升级流程（每次引擎升级）

升级 = 「换上游源码 + 逐条重放自有补丁 + 按上方配方重新打包」：

1. 选定目标：跟随 fork 的更新（`npm view simple-mind-map versions` 关注 `0.14.0-fix.N`
   或更高），或回到官方上游新版（需自行评估 fork 上述修订是否已被上游吸收）；
2. `npm install <目标版本> --no-save` → 用新包源码**替换 `vendor/upstream/`**（src/ 74 文件 +
   index.js + full.js + package.json）→ **逐条重放「补丁清单」节的自有补丁**（若上游已吸收某项，
   删补丁并同步更新清单与相关说明注释）→ `npm run build:vendor` 重打包；
3. 审阅并更新 `vendor/simple-mind-map.d.cts`（新 API / 删除的 API / `ENGINE_COMMANDS`
   （`src/engine/mindmap.ts`）命令名是否有效）；
4. 核对目标版本的 `dist/*.css`：仍为纯 `.ql-*`（Quill）则**不 vendor**（引擎样式由 bundle
   运行时注入，见上方说明）；若出现非 Quill 规则，则 vendor 该 CSS 并恢复
   `scripts/sync-vendor-css.mjs` 与 `package.json` 的 `sync-vendor-css` 脚本；
5. `npm run build && npm test && npm run lint` 全量验证；其中
   `tests/vendor-contract.test.ts`（vendor 契约冒烟）自动执行——它锁定
   「导出类 ↔ d.cts 双向一致 / d.cts 声明的方法 ↔ bundle 原型 / ENGINE_COMMANDS
   全表命令名、防腐层触碰的内部字段、插件依赖的引擎事件名 ↔ bundle 令牌」三层
   契约，任何断言失败即契约漂移：先对照更新 `d.cts` 与 `mindmap.ts` 防腐层，再继续；
6. 更新 `AGENTS.md` 引擎行，并在下方历史登记追加记录。

## 插件侧的引擎接缝（升级时重点核对）

- `src/engine/mindmap.ts`：创建参数、插件注册（Select/TouchEvent/AssociativeLine/
  KeyboardNavigation/DoExport/Search/Drag）、`ENGINE_COMMANDS` 常量表、
  全部防腐收口函数（renderer/view/search/doExport/opt 的内部访问只允许出现在这里）；
- `src/services/engine-controller.ts`：初始化代际锁、视口存取、引用更新预检；
- `vendor/simple-mind-map.d.cts`：手写类型的导出面。

已核实的「非契约」事实（升级时勿按漂移处理）：

- 引擎**不在节点 DOM 上写 `data-uid` 属性**（bundle 全文零处，`.smm-node` group
  为 nodeDraw 层兄弟节点互不嵌套）——`findNodeByDom` 已改为「group 包含目标元素」
  的对象身份匹配（2026-09-07），勿再依赖任何 DOM uid 属性；
- bundle 顶层求值即触碰 `document.documentElement`（全屏 API 探测），纯 Node
  环境加载 vendor 需先打最小 document 桩（见 tests/vendor-contract.test.ts 顶部）。

## 历史登记

| 日期 | 引擎版本 | 变更 |
| --- | --- | --- |
| （vendoring 时） | 0.14.0-fix.3 | 采用思绪思维导图发布的第三方修订版（fix 清单见上），按需 tree-shake 重打包 |
| 2026-09-06 | 0.14.0-fix.3 | 查明来源与完整修订清单（上游 0.14.0 ↔ fix.3 源码 diff + 产物双锚点校验）；本文档重写 |
| 2026-09-25 | 0.14.0-fix.3 | ① 上游版本核对（结论：无新版可升级，证据链见「上游版本核对结论」节）；② 按配方含 `--legal-comments=inline` 重打包替换 vendor（406,583 B，第三方许可注释内联进产物）；③ 与旧产物双锚点校验（字符串字面量 1018/1018 零增减、数字仅新增注释年份 2 个，差异仅注释）；④ sha256 常量同步更新（本文件 + `tests/vendor-contract.test.ts`）；⑤ `THIRD-PARTY-NOTICES.md` §3 同步 |
| 2026-09-25 | 0.14.0-fix.3 + 补丁 | **性能轮**：① fix.3 源码入仓 `vendor/upstream/` + 建 `scripts/build-vendor.mjs`（`npm run build:vendor`），无补丁重打包与现产物**字节一致**（入仓可信校验）；② 引入 3 处自有补丁（见「补丁清单」节）；③ 真实墙钟实测：空 render 落地 **26.1ms → 2.7ms**、一次编辑 **47.6ms → 21.4ms**（`--perf-ops` 变体链）；④ 重打包产物 408,032 B、sha256 更新（本文件 + 契约测试）；⑤ 全量回归：1578 测试 / 全部视觉探针 / lint / 打开基准 5000 节点 1298ms |
| 2026-09-25 | 0.14.0-fix.3 + 补丁 ×4 | 补丁 4（自绘测量缓存）入册：**重复打开** 5000 节点 **1276→≈810ms（-37%）**；`verify:visual` 新增 `clockcheck`（页内时钟定论：不可用）与 `BENCH_TWICE` 同页销毁重建通道；sha256/字节数同步（`09718fde…` / 408,449 B）；生产口径追加实测：一次编辑 29.4→**5.3ms（-82%）**、空 render 落地 28.1→**3.0ms（-89%）** |
| 2026-09-25 | 0.14.0-fix.3 + 补丁 ×5 | 补丁 5（首帧前预测量 + 元素复用 + 门禁实例化）：首次打开 5000 节点 **1258→1151ms（-8%）**；**负结论与修正入册**——只预测量不保留元素（A1）净零（两遍构建抵消），测量段真实成本 ≈100–150ms（K72/K74 高估约 5 倍，twice 的 -37% 主体为热页红利）；sha256/字节数同步（`48300fb2…` / 410,217 B） |
| 2026-09-25 | 0.14.0-fix.3 + 补丁 ×6 | 补丁 6（打开分片渲染 = 激活引擎既有 async 通道）：专项审计（两窗口模型 / root 消费 12 处 / 重入与销毁竞态 / `isRendering` 读点全名单）通过后实施；**代价实测 +1.4%~+3.4%**（三规模，正确性指标全一致）——5000 节点打开主线程阻塞 **1137ms 单块 → 5000 个 ~0.2ms 块**；附销毁断链守卫；新增 `BENCH_RENDER_ASYNC` 对照通道与 `RENDER_ASYNC_NODE_THRESHOLD`（1000）；sha256/字节数同步（`8c0a6d83…` / 410,276 B） |
| 2026-09-25 | 0.14.0-fix.3 + 补丁 ×7 | 补丁 7（拖宽监听器惰性注册 + 会话解绑）：5000 自绘节点 15000 个监听器（构造期注册、全库无解绑）→ 常态零全局监听；**A/B/B/A 交替对照：5000 节点打开 1327→1153ms（-174ms / -13%）**——该成本此前被 K77 误归入「引擎固有」；顺带修复「节点实例被 window 永久持有」的潜伏泄漏与每次 mousemove 10000 次空调用；sha256/字节数同步（`1e335f8f…` / 410,692 B） |
| 2026-09-25 | 0.14.0-fix.3 + 补丁 ×9 | 补丁 8/9（布局平移字段快路径 + 延迟物化）：「固有」段第二战——`adjustTopValue` 实测 **293 万次子树平移**（节点数 584 倍）→ 记账 + O(n) 物化（几何逐字节等价）；5000 节点 **1161→1091ms（-6%）**、10000 节点 **2255→1741ms**；新增 `count-layout` 计数探针；sha256/字节数同步（`ce3bbadd…` / 411,297 B） |
