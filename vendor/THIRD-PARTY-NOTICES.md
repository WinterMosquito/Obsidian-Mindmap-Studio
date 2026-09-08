# 第三方组件与许可声明（vendor/）

本目录的 `simple-mind-map.cjs` / `simple-mind-map.css` 是**预打包产物**（不可手工编辑，
重建配方见 `BUILD.md`）。它们内含第三方代码，许可与归属如下。

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

- 上游 `simple-mind-map` 以压缩产物分发，未携带逐文件版权横幅；自 2026-09 起，
  `BUILD.md` 的重建命令已追加 `--legal-comments=inline`，**重新打包时**会把各依赖的
  许可注释内联进产物，满足 MIT/BSD 的「保留版权与许可声明」要求。
- 现有 `vendor/simple-mind-map.cjs`（406,580 B）为追加该参数**之前**的产物，故以本文件
  承担同样的声明作用。
- `vendor/simple-mind-map.css` 含 Quill 样式，随上述 `quill`（BSD-3-Clause）声明。
