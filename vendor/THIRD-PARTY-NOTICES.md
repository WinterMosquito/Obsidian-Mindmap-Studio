# 第三方组件与许可声明（vendor/）

本目录的 `simple-mind-map.cjs` 是**预打包产物**（不可手工编辑，
重建配方见 `BUILD.md`）。它内含第三方代码，许可与归属如下。

## 1. 引擎本体

| 组件 | 版本 | 许可 | 来源 |
|------|------|------|------|
| simple-mind-map（思绪思维导图 fork） | `0.14.0-fix.3` | MIT | npm `simple-mind-map`；上游 <https://github.com/wanglin2/mind-map>；发布方 <https://sxmind.cn/> |

## 2. 打包产物内含的第三方依赖

`simple-mind-map.cjs` 的入口只导入 `MindMap` 与 7 个插件
（`Export`/`Select`/`TouchEvent`/`AssociativeLine`/`KeyboardNavigation`/`Search`/`Drag`），
按需 tree-shake 后**实际进入产物**的第三方代码为：

| 组件 | 版本范围 | 许可 | 用途 |
|------|----------|------|------|
| `@svgdotjs/svg.js` | `3.2.0` | MIT | 引擎 SVG 渲染底层 |
| `katex` | `^0.16.8` | MIT | 节点公式渲染（Export 插件） |
| `quill` | `^2.0.3` | BSD-3-Clause | 富文本编辑（引擎内置能力，本插件未启用节点内 Markdown 渲染） |
| `mdast-util-from-markdown` | `^1.3.0` | MIT | Markdown AST 解析（富文本路径） |
| `deepmerge` | `^1.5.2` | MIT | 配置合并 |
| `eventemitter3` | `^4.0.7` | MIT | 事件总线 |
| `xml-js` | `^1.6.11` | MIT | XML 互转（Export 路径） |
| `uuid` | `^9.0.0` | MIT | 节点 uid |

> 完整依赖清单（含仅被非打包路径引用的 `jszip` / `pdf-lib` / `tern` / `ws` / `yjs` /
> `y-webrtc` 等）内嵌在 `simple-mind-map.cjs` 的包元数据片段中，可用
> `grep -o '"dependencies":{[^}]*}' vendor/simple-mind-map.cjs` 查看。
> 每个依赖的许可全文见其各自仓库的 `LICENSE`；本文件仅作归属与许可声明。

## 3. 许可保留说明

- **本文件是许可声明的主载体**：MIT 要求声明「包含在所有副本或实质性部分中」，
  BSD-3-Clause 要求以 binary form 再分发时在「随分发提供的文档和/或其他材料」中
  复现声明；`main.js` 经 bundle + minify 后逐库横幅不可得（见下条实测），故随
  release 资产附上的本文件与 `LICENSE` 即该义务的履行载体。
- 上游 `simple-mind-map` 以压缩产物分发，未携带逐文件版权横幅；`BUILD.md` 的重建命令
  已追加 `--legal-comments=inline`（**自 2026-09-25 重打包起**），保留工具链可识别的
  legal comment。**实测口径（2026-09-25）**：该机制只保留带 `@license` / `@preserve`
  或 `/*!` 标记的注释——`vendor/simple-mind-map.cjs` 与 `main.js` 中均仅存 **1 段**
  （svg.js 的 `@license MIT` 横幅），其余依赖均无内联声明。故内联注释为**补充
  佐证**，逐库声明义务由本文件承担。
- 2026-09-25 之前的历史产物（406,580 B）与当前产物（字节数 / sha256 见 `BUILD.md`
  「产物字节级身份」）均适用本条：逐库声明以本文件为准。
- 引擎自带的 `dist/simpleMindMap.esm.css`（纯 Quill 富文本样式）**不再随插件分发**
  （本插件不注册 RichText 插件，样式由引擎运行时注入；详见 `BUILD.md`），故产物中
  不含 Quill 的 CSS，也无需保留其样式横幅。上表 `quill` 一行仅说明引擎包声明了该
  依赖。
