# 节点内插件内容渲染桥

- **范围**
  - 当前适配 `tikz`（TikZJax）与 `tab`（配套 CodeTab 宿主接口）；普通 Prism 与 Mermaid 保留原有通道。
  - 文件仍保存原始 Markdown 围栏；打开、切页与尺寸变化不写盘。
  - 桥共享挂载、迁移、重测、导出与清理；各插件的完成信号和保存语义由适配器声明。任意第三方处理器仍需逐类核对，不自动保证所有插件兼容。

## 模块与生命周期

- `src/core/plugin-content-types.ts`：槽位、渲染请求与活动组件事件判定。
- `src/ui/node-content/content-plugin.ts`：预测量只登记槽位并放冻结副本，保留代码回退。
- `src/platform/rendering/plugins/`
  - `native.ts`：官方 `MarkdownRenderer.render()` 与可选宿主协议；声明静态/活动模式和完成事件。
  - `owner.ts`：真实 foreignObject 槽位出现后才创建组件。重排迁移同一活动 DOM，保留按钮事件与编辑器焦点。
  - `bridge.ts`：唯一登记与导出入口；节点删除、引擎销毁时释放组件、观察器及产物登记。
  - `snapshot.ts`、`fonts.ts`：冻结计算样式和可读 Canvas；内联 SVG 实际使用的已加载 data 字体。
- `src/features/content/`
  - `content-remeasure.ts`：ResizeObserver 接原有合批重测；渲染树临时为空时不误删组件。
  - `plugin-content-session.ts`：按 UID 与围栏顺序改节点原文，经文档会话、自动保存和共享撤销提交。
- `src/markdown/md-codeblocks.ts`：复用围栏判据；写回前核对预期源码，保留外围正文、信息行、引用前缀与换行格式；新正文包含同长闭合围栏时只延长外层标记。

## TikZJax

- 安装并启用 TikZJax；本批使用本机 0.5.2 验证，没有复制或修改其运行时。
- 脱离文档时调用官方 Markdown 渲染，再一次性挂载，避免 TikZJax 观察器重复处理同一脚本。
- 等 `tikzjax-load-finished` 后的微任务取得优化 SVG；尺寸变化走原有重测。
- 失败或超过 60 秒保留源码；重新打开可重试。导出前等待产物准备，将最终 SVG 和已加载字体写入副本。

## CodeTab 的可选宿主协议

CodeTab 普通 Markdown 处理器按文件位置直接写盘。节点片段没有可靠的原文件行号，因此活动组件采用双方约定的 DOM 事件；它不是 Obsidian 内置 API，也不读取另一插件的内部对象。

- 在容器所属 `Document` 派发 `obsidian-codeblock-render`；请求为 `CustomEvent.detail`。
  - `version: 1`、`language: 'tab'`。
  - `source`：完整块体，不含外层围栏；`sourcePath`：真实笔记路径，供相对链接与嵌入解析。
  - `id`：本引擎会话内稳定组 ID，不依赖片段行号。
  - `container`、`component`：真实容器与已加载 Obsidian Component；子组件和监听随它清理。
  - `readOnly`：只读模式；无保存回调时同样只读。
  - `onChange(expected, next)`：异步正文提交；`next: null` 删除围栏块。Promise 兑现表示宿主接受提交，磁盘保存沿原管线继续执行。
  - `onEditingChange(editing)`：通知宿主保护正在编辑的组件。
  - `handled`：初始 false，处理器同步置 true；`completion`：处理器同步提供初次渲染 Promise。
- 宿主模式的正文编辑、增删标签、改名和排序都调用 `onChange`，不调用 CodeTab 原有 Vault 写入路径。
- 控件与编辑区域处理自己的鼠标和键盘事件，其余节点区域交给导图；只读嵌入可切页，禁用内容编辑和标签管理。
- 旧 CodeTab 无接口时保留代码回退，并在控制台说明原因；完整功能需同时安装配套分支的 CodeTab 产物。

## 扩展与验证

- 新适配器登记在 `DEFAULT_PLUGIN_ADAPTERS` 或构造桥时传入，定义语言、静态/活动模式及完成事件或宿主协议。
- 静态内容通过官方 Markdown 渲染调用已注册处理器；带写回组件必须注入保存回调，避免绕过文档会话。
- 已登记的插件围栏接收完整源码，不在展示预算中截成半个组件；普通代码保留原有展示预算。
- `npm run check:gates` 包含纯逻辑与真实 Chrome 替身处理器回归。
- 构建两个仓库后，可验证实际第三方插件：

```sh
CODE_TAB_PLUGIN='/path/to/obsidian-code-tab/dist' \
TIKZJAX_PLUGIN='/path/to/vault/.obsidian/plugins/obsidian-tikzjax' \
node scripts/verify-plugin-obsidian.mjs
```

- 脚本使用独立临时配置与 vault，不复制日常插件设置；结束后关闭自己的进程，保留截图、Markdown、SVG 和报告。
- `TIKZ_SOURCE` 可指定 `.tex` 样本；`MINDMAP_OBSIDIAN_BIN`、`MINDMAP_OBSIDIAN_DATA` 可指定程序与更新目录，默认路径为 macOS。
- 导出冻结当前活动标签展示，不携带交互；不可读取的 Canvas 与未内联的远程资源不保证离线导出。
