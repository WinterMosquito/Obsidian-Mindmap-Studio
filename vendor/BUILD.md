# vendor/simple-mind-map 引擎维护说明

## 来源定性（已查明，原"fix 清单缺口"已关闭）

`simple-mind-map@0.14.0-fix.1 / -fix.2 / -fix.3` 是 **npm registry 上真实发布的第三方修订版**，
发布者「思绪思维导图」（https://sxmind.cn/ ，MIT，fork 自上游 wanglin2/mind-map 0.14.0），
并非本仓库自建的版本号。

`vendor/simple-mind-map.cjs`（406,580 B）= **fix.3 包源码的按需 tree-shake 重打包**：

- 入口仅导出 8 个符号：`MindMap, DoExport, Select, TouchEvent, AssociativeLine, KeyboardNavigation, Search, Drag`；
- 打包命令：`esbuild entry.mjs --bundle --format=cjs --minify --target=es2021 --legal-comments=inline`（entry 从
  `simple-mind-map` 与 `simple-mind-map/src/plugins/{Export,Select,TouchEvent,AssociativeLine,KeyboardNavigation,Search,Drag}` 具名导入）；
- **已验证**：按此配方从 fix.3 重建的产物与 vendor 产物在「字符串字面量集合」与
  「数字字面量袋」双锚点校验下完全一致，仅剩三处打包痕迹差异：
  ① vendor 带文件头 `"use strict";` 指令；② vendor 的模板字面量保留 CRLF（打包源码检出为
  Windows 行尾）；③ vendor 所用 @svgdotjs/svg.js 副本的 dist 无 `BUILT:` 时间戳横幅。
  三者均无行为影响。

| 文件 | 说明 |
| --- | --- |
| `vendor/simple-mind-map.cjs` | fix.3 重打包产物。**不可手工编辑**——一切修改必须从包源码重新打包。 |
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

## 升级流程（每次引擎升级）

本地无自有补丁——升级即「换上游源码 + 按上方配方重新打包」：

1. 选定目标：跟随 fork 的更新（`npm view simple-mind-map versions` 关注 `0.14.0-fix.N`
   或更高），或回到官方上游新版（需自行评估 fork 上述修订是否已被上游吸收）；
2. `npm install <目标版本> --no-save`，用上方 entry + esbuild 命令重打包
   `vendor/simple-mind-map.cjs`；
3. 审阅并更新 `vendor/simple-mind-map.d.cts`（新 API / 删除的 API / `ENGINE_COMMANDS`
   （`src/mindmap.ts`）命令名是否有效）；
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

- `src/mindmap.ts`：创建参数、插件注册（Select/TouchEvent/AssociativeLine/
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
