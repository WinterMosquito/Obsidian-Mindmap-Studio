# 开发资料索引

> 本文件维护随代码变化的清单与规模记录；入口规则保留在根目录 `AGENTS.md`。
> 新增/删除源码或测试、更新文件行数、增补 K 条目与文档入口时维护本文件，日常不改 `AGENTS.md`。
> **按需读取**：先用 `rg -n` 搜索模块路径或文件名，再读取对应段落；不要求通读索引、决策表或历史记录。

## 任务导航

| 需要的信息 | 位置 |
|---|---|
| 必须遵守的开发规则与检查入口 | 根目录 `AGENTS.md` |
| 具体实现约定与功能决策 | `decisions.md`（按场景/模块/K 编号定位） |
| 文件清单、规模终值和文档入口 | 本文件对应段落 |
| 决策依据和历史 | `conventions.md`（只读相关 K 条目） |
| 维护义务与发版流程 | `process.md` |

## 代码结构索引

> 每个文件独立登记；一级目录表示依赖层，子目录表示能力归属。完整路径由 `tests/contracts/agents-md-sync.test.ts` 校验（K210）。职责与依赖见 [architecture.md](architecture.md)。

- **src/**
  - **组合根**
    - [commands.ts](../../src/commands.ts)
    - [creation.ts](../../src/creation.ts)
    - [main.ts](../../src/main.ts)
    - [settings.ts](../../src/settings.ts)
  - **domain/**：纯领域逻辑
    - [callout.ts](../../src/domain/callout.ts)
    - [color.ts](../../src/domain/color.ts)
    - [directive.ts](../../src/domain/directive.ts)
    - [md-meta.ts](../../src/domain/md-meta.ts)
    - [md-task.ts](../../src/domain/md-task.ts)
    - [mindmap-property.ts](../../src/domain/mindmap-property.ts)
    - [node-edit-key.ts](../../src/domain/node-edit-key.ts)
    - [pipe-table.ts](../../src/domain/pipe-table.ts)
    - [relation-anchor.ts](../../src/domain/relation-anchor.ts)
    - [relation.ts](../../src/domain/relation.ts)
    - [summary.ts](../../src/domain/summary.ts)
    - [tree.ts](../../src/domain/tree.ts)
    - [url.ts](../../src/domain/url.ts)
    - [wiki-display.ts](../../src/domain/wiki-display.ts)
    - [wikilink.ts](../../src/domain/wikilink.ts)
  - **core/**：通用机制与共享词汇
    - [concurrency.ts](../../src/core/concurrency.ts)
    - [constants.ts](../../src/core/constants.ts)
    - [engine-types.ts](../../src/core/engine-types.ts)
    - [errors.ts](../../src/core/errors.ts)
    - [event-binder.ts](../../src/core/event-binder.ts)
    - [i18n.ts](../../src/core/i18n.ts)
    - [math-placeholder.ts](../../src/core/math-placeholder.ts)
    - [measure-cache.ts](../../src/core/measure-cache.ts)
    - [minimap-geometry.ts](../../src/core/minimap-geometry.ts)
    - [node-content-types.ts](../../src/core/node-content-types.ts)
    - [node-data.ts](../../src/core/node-data.ts)
    - [persistence.ts](../../src/core/persistence.ts)
  - **links/**：库内链接解析与引用更新
    - [file-lookup.ts](../../src/links/file-lookup.ts)
    - [links-resolve.ts](../../src/links/links-resolve.ts)
    - [links-tree.ts](../../src/links/links-tree.ts)
  - **markdown/**：Markdown 解析、序列化与文档打开
    - [links-rename.ts](../../src/markdown/links-rename.ts)
    - [links-split.ts](../../src/markdown/links-split.ts)
    - [markdown.ts](../../src/markdown/markdown.ts)
    - [md-footnote.ts](../../src/markdown/md-footnote.ts)
    - [md-heading-format.ts](../../src/markdown/md-heading-format.ts)
    - [md-heading-normalize.ts](../../src/markdown/md-heading-normalize.ts)
    - [md-heading-syntax.ts](../../src/markdown/md-heading-syntax.ts)
    - [md-line-write.ts](../../src/markdown/md-line-write.ts)
    - [md-open.ts](../../src/markdown/md-open.ts)
    - [md-outline-inline.ts](../../src/markdown/md-outline-inline.ts)
    - [md-outline-lines.ts](../../src/markdown/md-outline-lines.ts)
    - [md-outline.ts](../../src/markdown/md-outline.ts)
    - [md-serialize-anchors.ts](../../src/markdown/md-serialize-anchors.ts)
    - [md-serialize-inline.ts](../../src/markdown/md-serialize-inline.ts)
    - [md-serialize.ts](../../src/markdown/md-serialize.ts)
  - **media/**：图片与附件
    - [images-path.ts](../../src/media/images-path.ts)
    - [images-save.ts](../../src/media/images-save.ts)
  - **engine/**：导图引擎防腐层
    - [mindmap-arrange.ts](../../src/engine/mindmap-arrange.ts)
    - [mindmap-clipboard.ts](../../src/engine/mindmap-clipboard.ts)
    - [mindmap-colors.ts](../../src/engine/mindmap-colors.ts)
    - [mindmap-commands.ts](../../src/engine/mindmap-commands.ts)
    - [mindmap-editor.ts](../../src/engine/mindmap-editor.ts)
    - [mindmap-export.ts](../../src/engine/mindmap-export.ts)
    - [mindmap-history.ts](../../src/engine/mindmap-history.ts)
    - [mindmap-icons.ts](../../src/engine/mindmap-icons.ts)
    - [mindmap-minimap.ts](../../src/engine/mindmap-minimap.ts)
    - [mindmap-nodes.ts](../../src/engine/mindmap-nodes.ts)
    - [mindmap-palette.ts](../../src/engine/mindmap-palette.ts)
    - [mindmap-relations.ts](../../src/engine/mindmap-relations.ts)
    - [mindmap-search.ts](../../src/engine/mindmap-search.ts)
    - [mindmap-snapshot.ts](../../src/engine/mindmap-snapshot.ts)
    - [mindmap-summaries.ts](../../src/engine/mindmap-summaries.ts)
    - [mindmap-theme-presets.ts](../../src/engine/mindmap-theme-presets.ts)
    - [mindmap-theme.ts](../../src/engine/mindmap-theme.ts)
    - [mindmap-timers.ts](../../src/engine/mindmap-timers.ts)
    - [mindmap-viewport-canvas.ts](../../src/engine/mindmap-viewport-canvas.ts)
    - [mindmap-viewport.ts](../../src/engine/mindmap-viewport.ts)
    - [mindmap.ts](../../src/engine/mindmap.ts)
  - **platform/**：Obsidian 平台集成
    - **rendering/**
      - **code/**
        - [prism-code-color-probe.ts](../../src/platform/rendering/code/prism-code-color-probe.ts)
        - [prism-code.ts](../../src/platform/rendering/code/prism-code.ts)
      - **math/**
        - [math-jax-char-rules.ts](../../src/platform/rendering/math/math-jax-char-rules.ts)
        - [math-jax-export-clip.ts](../../src/platform/rendering/math/math-jax-export-clip.ts)
        - [math-jax-export.ts](../../src/platform/rendering/math/math-jax-export.ts)
        - [math-jax-fonts.ts](../../src/platform/rendering/math/math-jax-fonts.ts)
        - [math-jax.ts](../../src/platform/rendering/math/math-jax.ts)
      - [callout-icon.ts](../../src/platform/rendering/callout-icon.ts)
      - [mermaid.ts](../../src/platform/rendering/mermaid.ts)
    - **system/**
      - [clipboard.ts](../../src/platform/system/clipboard.ts)
      - [system-open.ts](../../src/platform/system/system-open.ts)
    - **workspace/**
      - [legacy-mindmap-migration.ts](../../src/platform/workspace/legacy-mindmap-migration.ts)
      - [mindmap-auto-open.ts](../../src/platform/workspace/mindmap-auto-open.ts)
      - [nav-history.ts](../../src/platform/workspace/nav-history.ts)
      - [tag-search.ts](../../src/platform/workspace/tag-search.ts)
      - [vault-prefs.ts](../../src/platform/workspace/vault-prefs.ts)
      - [vault-sync.ts](../../src/platform/workspace/vault-sync.ts)
    - [export-svg-postprocess.ts](../../src/platform/export-svg-postprocess.ts)
  - **ui/**：UI 组件、局部样式与弹窗
    - **node-content/**
      - [content-code.styles.ts](../../src/ui/node-content/content-code.styles.ts)
      - [content-code.ts](../../src/ui/node-content/content-code.ts)
      - [content-common.styles.ts](../../src/ui/node-content/content-common.styles.ts)
      - [content-context.ts](../../src/ui/node-content/content-context.ts)
      - [content-copy.styles.ts](../../src/ui/node-content/content-copy.styles.ts)
      - [content-footnote.styles.ts](../../src/ui/node-content/content-footnote.styles.ts)
      - [content-footnote.ts](../../src/ui/node-content/content-footnote.ts)
      - [content-link.styles.ts](../../src/ui/node-content/content-link.styles.ts)
      - [content-link.ts](../../src/ui/node-content/content-link.ts)
      - [content-math.ts](../../src/ui/node-content/content-math.ts)
      - [content-mermaid.styles.ts](../../src/ui/node-content/content-mermaid.styles.ts)
      - [content-mermaid.ts](../../src/ui/node-content/content-mermaid.ts)
      - [content-quote.styles.ts](../../src/ui/node-content/content-quote.styles.ts)
      - [content-quote.ts](../../src/ui/node-content/content-quote.ts)
      - [content-root.styles.ts](../../src/ui/node-content/content-root.styles.ts)
      - [content-root.ts](../../src/ui/node-content/content-root.ts)
      - [content-table.styles.ts](../../src/ui/node-content/content-table.styles.ts)
      - [content-table.ts](../../src/ui/node-content/content-table.ts)
      - [content-tag.styles.ts](../../src/ui/node-content/content-tag.styles.ts)
      - [content-tag.ts](../../src/ui/node-content/content-tag.ts)
      - [content-task.styles.ts](../../src/ui/node-content/content-task.styles.ts)
      - [content-task.ts](../../src/ui/node-content/content-task.ts)
      - [content-text.styles.ts](../../src/ui/node-content/content-text.styles.ts)
      - [content-text.ts](../../src/ui/node-content/content-text.ts)
    - **node-editor/**
      - [node-editor.styles.ts](../../src/ui/node-editor/node-editor.styles.ts)
      - [node-editor.ts](../../src/ui/node-editor/node-editor.ts)
    - **search/**
      - [search-bar.css](../../src/ui/search/search-bar.css)
      - [search-bar.ts](../../src/ui/search/search-bar.ts)
    - **styles/**
      - [global.css](../../src/ui/styles/global.css)
      - [index.css](../../src/ui/styles/index.css)
      - [view.css](../../src/ui/styles/view.css)
    - **toolbar/**
      - [toolbar.css](../../src/ui/toolbar/toolbar.css)
      - [toolbar.ts](../../src/ui/toolbar/toolbar.ts)
    - [menu-submenu.ts](../../src/ui/menu-submenu.ts)
    - [modal-color.ts](../../src/ui/modal-color.ts)
    - [modal-common.ts](../../src/ui/modal-common.ts)
    - [modal-image.ts](../../src/ui/modal-image.ts)
    - [modal-link.ts](../../src/ui/modal-link.ts)
    - [modal-name.ts](../../src/ui/modal-name.ts)
    - [modal-relation-label.ts](../../src/ui/modal-relation-label.ts)
    - [modal-summary-text.ts](../../src/ui/modal-summary-text.ts)
    - [modal-text.ts](../../src/ui/modal-text.ts)
  - **services/**：文档会话与视图服务
    - [document-service.ts](../../src/services/document-service.ts)
    - [document-session-history.ts](../../src/services/document-session-history.ts)
    - [document-session-registry.ts](../../src/services/document-session-registry.ts)
    - [document-session.ts](../../src/services/document-session.ts)
    - [engine-controller-deps.ts](../../src/services/engine-controller-deps.ts)
    - [engine-controller-options.ts](../../src/services/engine-controller-options.ts)
    - [engine-controller-viewport.ts](../../src/services/engine-controller-viewport.ts)
    - [engine-controller.ts](../../src/services/engine-controller.ts)
    - [status-bar.ts](../../src/services/status-bar.ts)
    - [view-state.ts](../../src/services/view-state.ts)
  - **features/**：特性编排与视图控制器
    - **canvas/**
      - [drag-session.ts](../../src/features/canvas/drag-session.ts)
      - [view-node-width.ts](../../src/features/canvas/view-node-width.ts)
      - [view-viewport.ts](../../src/features/canvas/view-viewport.ts)
    - **content/**
      - [content-remeasure.ts](../../src/features/content/content-remeasure.ts)
      - [node-codeblock.ts](../../src/features/content/node-codeblock.ts)
      - [node-content-factory.ts](../../src/features/content/node-content-factory.ts)
      - [node-content-write.ts](../../src/features/content/node-content-write.ts)
      - [node-inline-content.ts](../../src/features/content/node-inline-content.ts)
      - [node-inline-html.ts](../../src/features/content/node-inline-html.ts)
      - [node-inline-tokenize.ts](../../src/features/content/node-inline-tokenize.ts)
      - [view-footnote.ts](../../src/features/content/view-footnote.ts)
      - [view-node-task.ts](../../src/features/content/view-node-task.ts)
      - [view-tag.ts](../../src/features/content/view-tag.ts)
    - **editing/**
      - [node-inline-editor.ts](../../src/features/editing/node-inline-editor.ts)
      - [view-clipboard.ts](../../src/features/editing/view-clipboard.ts)
      - [view-dnd.ts](../../src/features/editing/view-dnd.ts)
      - [view-hotkeys.ts](../../src/features/editing/view-hotkeys.ts)
      - [view-node-actions.ts](../../src/features/editing/view-node-actions.ts)
      - [view-node-color.ts](../../src/features/editing/view-node-color.ts)
      - [view-paste.ts](../../src/features/editing/view-paste.ts)
      - [view-syntax.ts](../../src/features/editing/view-syntax.ts)
    - **media/**
      - [image-resize.ts](../../src/features/media/image-resize.ts)
      - [view-image-actions.ts](../../src/features/media/view-image-actions.ts)
      - [view-image-fullscreen.ts](../../src/features/media/view-image-fullscreen.ts)
    - **navigation/**
      - [view-link-navigator.ts](../../src/features/navigation/view-link-navigator.ts)
      - [view-node-link-plan.ts](../../src/features/navigation/view-node-link-plan.ts)
      - [view-split-links.ts](../../src/features/navigation/view-split-links.ts)
      - [view-title-renamer.ts](../../src/features/navigation/view-title-renamer.ts)
      - [view-wikilink.ts](../../src/features/navigation/view-wikilink.ts)
    - **relations/**
      - [node-pick.ts](../../src/features/relations/node-pick.ts)
      - [view-node-relation.ts](../../src/features/relations/view-node-relation.ts)
      - [view-node-summary.ts](../../src/features/relations/view-node-summary.ts)
      - [view-relation-anchor.ts](../../src/features/relations/view-relation-anchor.ts)
    - **view/**
      - [view-common.ts](../../src/features/view/view-common.ts)
      - [view-context-menu.ts](../../src/features/view/view-context-menu.ts)
      - [view-context.ts](../../src/features/view/view-context.ts)
      - [view-load-session.ts](../../src/features/view/view-load-session.ts)
      - [view-minimap.ts](../../src/features/view/view-minimap.ts)
      - [view-search.ts](../../src/features/view/view-search.ts)
      - [view-status.ts](../../src/features/view/view-status.ts)
      - [view-toolbar.ts](../../src/features/view/view-toolbar.ts)
      - [view.ts](../../src/features/view/view.ts)
    - [mindmap-codeblock.ts](../../src/features/mindmap-codeblock.ts)
    - [view-export.ts](../../src/features/view-export.ts)

- **tests/**：按主要被测模块对齐源码；组合入口测试与 `setup.ts` 留在根目录（K211）。
  - **contracts/**：工程契约、构建与工具链校验
    - [agents-md-sync.test.ts](../../tests/contracts/agents-md-sync.test.ts)
    - [check-gates.test.ts](../../tests/contracts/check-gates.test.ts)
    - [css-build.test.ts](../../tests/contracts/css-build.test.ts)
    - [docs-standard.test.ts](../../tests/contracts/docs-standard.test.ts)
    - [module-boundaries.test.ts](../../tests/contracts/module-boundaries.test.ts)
    - [plain-text-parser.test.ts](../../tests/contracts/plain-text-parser.test.ts)
    - [vendor-contract.test.ts](../../tests/contracts/vendor-contract.test.ts)
    - [version-bump.test.ts](../../tests/contracts/version-bump.test.ts)
  - **domain/**：领域规则
    - [callout.test.ts](../../tests/domain/callout.test.ts)
    - [color-directive.test.ts](../../tests/domain/color-directive.test.ts)
    - [domain.test.ts](../../tests/domain/domain.test.ts)
    - [md-frontmatter-trigger.test.ts](../../tests/domain/md-frontmatter-trigger.test.ts)
    - [node-edit-key.test.ts](../../tests/domain/node-edit-key.test.ts)
    - [pipe-table.test.ts](../../tests/domain/pipe-table.test.ts)
    - [relation-anchor.test.ts](../../tests/domain/relation-anchor.test.ts)
    - [relation-directive.test.ts](../../tests/domain/relation-directive.test.ts)
    - [summary-directive.test.ts](../../tests/domain/summary-directive.test.ts)
    - [url.test.ts](../../tests/domain/url.test.ts)
    - [wiki-display.test.ts](../../tests/domain/wiki-display.test.ts)
  - **core/**：通用机制
    - [concurrency.test.ts](../../tests/core/concurrency.test.ts)
    - [constants.test.ts](../../tests/core/constants.test.ts)
    - [errors.test.ts](../../tests/core/errors.test.ts)
    - [event-binder.test.ts](../../tests/core/event-binder.test.ts)
    - [math-placeholder.test.ts](../../tests/core/math-placeholder.test.ts)
    - [measure-cache.test.ts](../../tests/core/measure-cache.test.ts)
    - [minimap-geometry.test.ts](../../tests/core/minimap-geometry.test.ts)
    - [persistence.test.ts](../../tests/core/persistence.test.ts)
  - **links/**：链接与文件解析
    - [file-lookup.test.ts](../../tests/links/file-lookup.test.ts)
    - [links-resolve.test.ts](../../tests/links/links-resolve.test.ts)
    - [links-tree.test.ts](../../tests/links/links-tree.test.ts)
  - **markdown/**：Markdown 解析、写回与往返
    - [clipboard-outline.test.ts](../../tests/markdown/clipboard-outline.test.ts)
    - [footnote.test.ts](../../tests/markdown/footnote.test.ts)
    - [links-rename.test.ts](../../tests/markdown/links-rename.test.ts)
    - [links-split.test.ts](../../tests/markdown/links-split.test.ts)
    - [md-heading-syntax.test.ts](../../tests/markdown/md-heading-syntax.test.ts)
    - [md-inline.test.ts](../../tests/markdown/md-inline.test.ts)
    - [md-line-write.test.ts](../../tests/markdown/md-line-write.test.ts)
    - [md-open-trigger.test.ts](../../tests/markdown/md-open-trigger.test.ts)
    - [md-roundtrip-property.test.ts](../../tests/markdown/md-roundtrip-property.test.ts)
    - [md-roundtrip.test.ts](../../tests/markdown/md-roundtrip.test.ts)
    - [md-task.test.ts](../../tests/markdown/md-task.test.ts)
  - **media/**：图片与附件
    - [images-path.test.ts](../../tests/media/images-path.test.ts)
    - [pasted-name.test.ts](../../tests/media/pasted-name.test.ts)
  - **engine/**：引擎封装与真实 vendor 行为
    - [engine-drag-target.test.ts](../../tests/engine/engine-drag-target.test.ts)
    - [engine-editor.test.ts](../../tests/engine/engine-editor.test.ts)
    - [engine-history-limit.test.ts](../../tests/engine/engine-history-limit.test.ts)
    - [engine-image-size.test.ts](../../tests/engine/engine-image-size.test.ts)
    - [engine-measure-residue.test.ts](../../tests/engine/engine-measure-residue.test.ts)
    - [engine-minimap-capture.test.ts](../../tests/engine/engine-minimap-capture.test.ts)
    - [engine-node-move.test.ts](../../tests/engine/engine-node-move.test.ts)
    - [engine-refresh-nodes.test.ts](../../tests/engine/engine-refresh-nodes.test.ts)
    - [engine-relations.test.ts](../../tests/engine/engine-relations.test.ts)
    - [engine-session-snapshot.test.ts](../../tests/engine/engine-session-snapshot.test.ts)
    - [engine-subtree-clipboard.test.ts](../../tests/engine/engine-subtree-clipboard.test.ts)
    - [engine-summaries.test.ts](../../tests/engine/engine-summaries.test.ts)
    - [find-node-by-dom.test.ts](../../tests/engine/find-node-by-dom.test.ts)
    - [mindmap-theme.test.ts](../../tests/engine/mindmap-theme.test.ts)
    - [mindmap-wiki-icon.test.ts](../../tests/engine/mindmap-wiki-icon.test.ts)
    - [node-text-edit.test.ts](../../tests/engine/node-text-edit.test.ts)
    - [viewport.test.ts](../../tests/engine/viewport.test.ts)
  - **platform/**：Obsidian 平台集成
    - **rendering/**
      - **code/**
        - [prism-code.test.ts](../../tests/platform/rendering/code/prism-code.test.ts)
      - **math/**
        - [math-jax-export-pin.test.ts](../../tests/platform/rendering/math/math-jax-export-pin.test.ts)
        - [math-jax-fonts.test.ts](../../tests/platform/rendering/math/math-jax-fonts.test.ts)
        - [math-jax.test.ts](../../tests/platform/rendering/math/math-jax.test.ts)
      - [mermaid-render.test.ts](../../tests/platform/rendering/mermaid-render.test.ts)
    - **system/**
      - [clipboard.test.ts](../../tests/platform/system/clipboard.test.ts)
      - [system-open.test.ts](../../tests/platform/system/system-open.test.ts)
    - **workspace/**
      - [legacy-mindmap-migration.test.ts](../../tests/platform/workspace/legacy-mindmap-migration.test.ts)
      - [mindmap-auto-open.test.ts](../../tests/platform/workspace/mindmap-auto-open.test.ts)
      - [nav-history.test.ts](../../tests/platform/workspace/nav-history.test.ts)
      - [tag-search.test.ts](../../tests/platform/workspace/tag-search.test.ts)
      - [vault-prefs.test.ts](../../tests/platform/workspace/vault-prefs.test.ts)
    - [export-svg-postprocess.test.ts](../../tests/platform/export-svg-postprocess.test.ts)
  - **ui/**：UI 组件
    - **node-content/**
      - [node-content-components.test.ts](../../tests/ui/node-content/node-content-components.test.ts)
    - **node-editor/**
      - [node-editor.test.ts](../../tests/ui/node-editor/node-editor.test.ts)
    - [modal-common.test.ts](../../tests/ui/modal-common.test.ts)
    - [modal-input.test.ts](../../tests/ui/modal-input.test.ts)
  - **services/**：文档会话与视图服务
    - [document-session-history.test.ts](../../tests/services/document-session-history.test.ts)
    - [document-session.test.ts](../../tests/services/document-session.test.ts)
    - [engine-controller.test.ts](../../tests/services/engine-controller.test.ts)
    - [save-pipeline.test.ts](../../tests/services/save-pipeline.test.ts)
    - [view-state.test.ts](../../tests/services/view-state.test.ts)
  - **features/**：视图能力编排
    - **canvas/**
      - [drag-session.test.ts](../../tests/features/canvas/drag-session.test.ts)
      - [view-node-width.test.ts](../../tests/features/canvas/view-node-width.test.ts)
      - [view-viewport.test.ts](../../tests/features/canvas/view-viewport.test.ts)
    - **content/**
      - [content-remeasure.test.ts](../../tests/features/content/content-remeasure.test.ts)
      - [node-codeblock.test.ts](../../tests/features/content/node-codeblock.test.ts)
      - [node-content-write.test.ts](../../tests/features/content/node-content-write.test.ts)
      - [node-inline-content.test.ts](../../tests/features/content/node-inline-content.test.ts)
      - [node-inline-tag.test.ts](../../tests/features/content/node-inline-tag.test.ts)
      - [view-footnote.test.ts](../../tests/features/content/view-footnote.test.ts)
      - [view-node-task.test.ts](../../tests/features/content/view-node-task.test.ts)
      - [view-tag.test.ts](../../tests/features/content/view-tag.test.ts)
    - **editing/**
      - [node-inline-editor.test.ts](../../tests/features/editing/node-inline-editor.test.ts)
      - [view-clipboard.test.ts](../../tests/features/editing/view-clipboard.test.ts)
      - [view-dnd.test.ts](../../tests/features/editing/view-dnd.test.ts)
      - [view-hotkeys.test.ts](../../tests/features/editing/view-hotkeys.test.ts)
      - [view-node-actions.test.ts](../../tests/features/editing/view-node-actions.test.ts)
      - [view-paste.test.ts](../../tests/features/editing/view-paste.test.ts)
      - [view-syntax.test.ts](../../tests/features/editing/view-syntax.test.ts)
    - **media/**
      - [feature-helpers.test.ts](../../tests/features/media/feature-helpers.test.ts)
      - [feature-teardown.test.ts](../../tests/features/media/feature-teardown.test.ts)
    - **navigation/**
      - [view-split-links.test.ts](../../tests/features/navigation/view-split-links.test.ts)
      - [view-wikilink.test.ts](../../tests/features/navigation/view-wikilink.test.ts)
    - **relations/**
      - [node-pick.test.ts](../../tests/features/relations/node-pick.test.ts)
      - [view-node-relation.test.ts](../../tests/features/relations/view-node-relation.test.ts)
    - **view/**
      - [view-canvas-interaction.test.ts](../../tests/features/view/view-canvas-interaction.test.ts)
      - [view-context-menu.test.ts](../../tests/features/view/view-context-menu.test.ts)
      - [view-layout.test.ts](../../tests/features/view/view-layout.test.ts)
      - [view-md-back-mode.test.ts](../../tests/features/view/view-md-back-mode.test.ts)
      - [view-minimap.test.ts](../../tests/features/view/view-minimap.test.ts)
      - [view-resize.test.ts](../../tests/features/view/view-resize.test.ts)
      - [view-search.test.ts](../../tests/features/view/view-search.test.ts)
      - [view-status.test.ts](../../tests/features/view/view-status.test.ts)
      - [view-toolbar.test.ts](../../tests/features/view/view-toolbar.test.ts)
    - [mindmap-codeblock.test.ts](../../tests/features/mindmap-codeblock.test.ts)
    - [view-export.test.ts](../../tests/features/view-export.test.ts)
  - **helpers/**：共享测试辅助代码
    - [node-content-dom.ts](../../tests/helpers/node-content-dom.ts)
    - [node-editor-dom.ts](../../tests/helpers/node-editor-dom.ts)
  - **mocks/**：宿主替身
    - [obsidian.ts](../../tests/mocks/obsidian.ts)
  - **fixtures/**：共享测试样本
    - **roundtrip/**
      - [01-comprehensive.md](../../tests/fixtures/roundtrip/01-comprehensive.md)
      - [02-tables-quotes-html.md](../../tests/fixtures/roundtrip/02-tables-quotes-html.md)
      - [03-links-heavy.md](../../tests/fixtures/roundtrip/03-links-heavy.md)
      - [04-headings-multiroot.md](../../tests/fixtures/roundtrip/04-headings-multiroot.md)
      - [05-deep-lists.md](../../tests/fixtures/roundtrip/05-deep-lists.md)
      - [06-inline-syntax.md](../../tests/fixtures/roundtrip/06-inline-syntax.md)
      - [07-ordered-lists.md](../../tests/fixtures/roundtrip/07-ordered-lists.md)
      - [08-blank-lines.md](../../tests/fixtures/roundtrip/08-blank-lines.md)
  - [creation-folder.test.ts](../../tests/creation-folder.test.ts)
  - [file-menu-back-to-md.test.ts](../../tests/file-menu-back-to-md.test.ts)
  - [language-refresh.test.ts](../../tests/language-refresh.test.ts)
  - [settings-persist.test.ts](../../tests/settings-persist.test.ts)
  - [settings.test.ts](../../tests/settings.test.ts)
  - [setup.ts](../../tests/setup.ts)

## 工具配置与脚本

- **config/**：显式加载的构建与检查配置（K212）。
  - [esbuild.config.mjs](../../config/esbuild.config.mjs)
  - [knip.json](../../config/knip.json)
  - [stylelint.config.mjs](../../config/stylelint.config.mjs)
- **scripts/**：工具执行入口与共享工具逻辑。
  - [build-vendor.mjs](../../scripts/build-vendor.mjs)
  - [check-gates.d.mts](../../scripts/check-gates.d.mts)
  - [check-gates.mjs](../../scripts/check-gates.mjs)
  - [check-release-metadata.mjs](../../scripts/check-release-metadata.mjs)
  - [gen-perf-fixture.mjs](../../scripts/gen-perf-fixture.mjs)
  - [module-boundaries.mjs](../../scripts/module-boundaries.mjs)
  - [plain-text-parser.mjs](../../scripts/plain-text-parser.mjs)
  - [scanner-lint.mjs](../../scripts/scanner-lint.mjs)
  - [verify-visual.mjs](../../scripts/verify-visual.mjs)
  - [version-bump.mjs](../../scripts/version-bump.mjs)
  - [visual-node-content.mjs](../../scripts/visual-node-content.mjs)
  - [visual-ui.mjs](../../scripts/visual-ui.mjs)
- **根目录约定入口**
  - [package.json](../../package.json)
  - [package-lock.json](../../package-lock.json)
  - [tsconfig.json](../../tsconfig.json)
  - [eslint.config.mts](../../eslint.config.mts)
  - [vitest.config.ts](../../vitest.config.ts)
  - [.npmrc](../../.npmrc)
  - [.node-version](../../.node-version)
  - [.editorconfig](../../.editorconfig)
  - [.gitignore](../../.gitignore)

## 文件规模与豁免（超 300 行须登记；唯一登记处，行数流水见 docs/agents/line-count-log.md）

> **口径**：行数一律按 `tests/contracts/agents-md-sync.test.ts` 的 `countSourceLines`（按 `\n` 切分、末尾换行不计行）；**不要**用 PowerShell 的 `Measure-Object -Line` 或 `wc -l`——口径不同会使登记值与实测对不上。
>
> **批次史**（历次实测读数 / 回填记录 / 理由流水）已迁至 `docs/agents/line-count-log.md`（2026-10-26 迁出，逐字保留）：**新批次记录追加到该文件**，本文件只保留下方终值表——勿再往本节追加流水（终值与历史分开维护，便于按需定位）。改动豁免文件后用 `npm run check:gates -- --fix-lines` 对账回填本表（**唯一登记处**；`docs/agents/architecture.md` 自 2026-11-09 起不再复制）；`npm run check:gates` 每次都静态核对「未登记超限文件数」（硬规则 10 的机器核对）。
>
> **现状**（2026-11-18 目录整理）：登记豁免 **47** 条，**未登记**超限文件数 **0**（只允许递减）。豁免数量保持，理由按当前职责校正；历次规模变化见 [line-count-log.md](line-count-log.md)。

| 文件 | 行数 | 豁免理由 |
|---|---|---|
| `src/domain/color.ts` | 657 | 颜色纯逻辑的**单一落点**（2026-10-29 增至 355；2026-11-05 增至 504：`orphanSentinels` 无主哨兵判定、`tableLineTone` 深底网格线兜底、`hexToHsl`/`hslToHex` 供自定义配色按明度阶梯派生；2026-11-06 审核删掉 `NodeColorScale.line`——结构线要预设配对表，塞进 domain 只能是「线 = 填充」这一种退化答案）：十六进制 / RGB 解析、WCAG 亮度与对比、节点墨色、着色节点的内容色阶（码块 chip / 网格线）、**节点色阶（原色 → 填充 / 文字；结构线不在此，见 `mindmap-theme-presets.nodeLineColorOf`）**、配色指令的继承遍历。这些判定彼此引用（`nodeColorScale` = 归一 + `nodeInkColor`；`nodeContentTones` = `nodeInkColor` + `contrastRatio` + `mixHex`；继承遍历把哨兵折 null 的口径与「默认」落地同源），拆开必然逼出第二份「先归一再判色」的实现（硬规则 5）；全仓只有这一处对颜色做数学运算，拆分的唯一收益是行数。 |
| `src/domain/callout.ts` | 366 | 标注 / 引用块的**唯一判定面**（2026-11-11）：13 种类型的元数据表（图标 id + 兜底色 + 别名 + **宿主变量名偏差** `cssVar`，`Record<CalloutTypeId, …>` 编译期锁完整性）、别名 → 规范类型的无原型查表（用户可写 `[!toString]`，K172 ⑥ 同款加固）、头部解析（与宿主 `\[!([^\]]+)\]([+\-]?)(?:\s\|$)` 同口径：`\|` 元数据 / 折叠标记 / `[!info]标题` 不算）、标题 Title Case、颜色 `var()` 链、引用前缀剥离。拆开必然逼出第二份「哪些类型合法 / 前缀怎么剥」的实现（硬规则 5）：颜色与图标共用同一张类型表，变量名偏差也只允许在这里解释一次；行数全部来自数据表与取证注释，拆分的唯一收益是行数。 |
| `src/domain/md-meta.ts` | 332 | 渲染层 `md*` 元数据的**唯一类型与契约面**：`isNodeTextEdited`（「文本是否被编辑过」的唯一判据）、`nodeInlineSource`（渲染源 = 未编辑取 `mdRaw` / 已编辑取 `text` + 指令行）、`nodeContinuationIndents`（续行相对缩进表，与前者共用同一「是否已编辑」闸）。2026-11-12 增至 331：新增 `mdContinuationIndents` 字段与读口——脚注续行的判定依赖它（列表项续行在 `mdRaw` 里被 `trimStart`，绝对缩进只剩这一份），拆到别处就会逼出第二份「哪份原文才代表当前内容」的判断（硬规则 5）。 |
| `src/domain/relation.ts` | 459 | 联系（关系连线）指令的**唯一**语义落点（语法层在 `domain/directive`）：`relationStateOfSource` 同时认「末尾指令行」与「末行行尾段」两种真实形态；写侧只经 `relationSegmentsOf` 产出段、再由 `domain/directive.applyDirectiveBlock` 整体替换尾块——**只替换 `id` / `rel` 两种 key**，同节点的 `sum` 段逐字带回（原先的 `renderDirectiveLine` / `applyDirectiveLine` 已删：那是第二份「只认关系、自己拼尾块」的写入口，一经调用就把概要抹掉）；`resolveRelationGraph` 负责 id 权威性 / 悬空 / 重复 / 自环 / 边上限。拆开必然逼出第二份「哪些注释算指令」的判定（读写两侧口径一分叉，写出的指令读不回来），与 `domain/color` 同性质。 |
| `src/engine/mindmap-relations.ts` | 777 | 联系在引擎侧的**唯一**收口面：Markdown 边 → `associativeLineTargets` / `associativeLineText` 的映射（创建前与渲染后两时机共用同一份 `buildPlans`）、变化后补画（插件的 `renderAllLines` 绑在同一事件上但早于我们）、id 集合收集（生成新 id 避让冲突）、**引用集合收集**（`collectRelationTargets`，孤儿 `%%id%%` 回收的唯一判定面，K153）、**线色落地**（`associativeLineStyle[目标 uid].associativeLineColor`，渲染侧唯一的颜色写入面）、联系线命中判定（双击改标签的 capture 拦截）、**手绘锚定的画布收口**（`relationCanvasLayer` 取 `draw` 内容坐标层、`relationClientToContent` 反解指针、`relationNodeBox` 取节点盒）。这些都要访问 `mindMap.associativeLine` / `draw` / `el` / 节点 data 的引擎私有形态（硬规则 2），拆开就得在别处再开一个引擎触点。 |
| `src/features/relations/view-node-summary.ts` | 419 | 概要的**全部编辑入口**：两条建入口（选中集合够用 → 按 `collectRuns` 直接建；否则 → 两次点选）、改文字、删。为什么一个文件：建 / 改 / 删共用同一套「概要节点 → 正文条目」认领逻辑（`entryOfSummary`）与同一套区间校验（`planSummaryRanges` / `canPlaceRun`），拆开会让三处各写一份反查。2026-11-02 增至 395：新增 `startSummaryPicking`（两次点选，起点 = 右键节点）与 `planPickedRun`（可反向取区间、四种失败各给一条提示）。 |
| `src/features/relations/view-node-relation.ts` | 766 | 联系的**全部编辑入口**：建边（源/目标两行 + 手绘 `geo` 一次批量 raw 提交）、删边（目标再无入边时**一并回收它的 `%%id%%`**）、**线色（右键线「联系配色」，写 `%%rel%%` 的 `color=` 段）**、改标签、删节点清入边 + 回收它曾指向的孤儿 id（只改 data、并进删除那一步撤销；被删实例按身份排除——实例树滞后于数据树，K153）、点选模式与双击拦截。共用同一份「节点 → 新指令行 → raw」的合成（`rawWithState`）与「目标 id 显示名」的反查；拆开会让「谁负责改哪一行」跨文件漂移。 |
| `src/engine/mindmap.ts` | 834 | 引擎防腐层的**唯一对外入口（barrel）**，同时承接实例创建/销毁、主题配置、性能模式与生命周期编排。创建时的渲染监听、测量残渣清理、历史播种、主题刷新和销毁必须围绕同一实例收尾；各引擎能力实现已经分入层内子模块，vendor 私有形态仍限定在 engine 层。职责收口是层与入口契约，不按导出数量机械拆分。拆分前增长史及历次规模记录见 `line-count-log.md`。 |
| `src/engine/mindmap-viewport.ts` | 984 | 画布几何与视口防腐面（2026-10-16 自 `mindmap.ts` 拆出）：实时容器几何同步、数据层/DOM 双口径内容盒测量、fit、居中与「渲染落地后居中补正」、缩放/平移、视口状态读写与签名。与 `math-jax` 同性质——就绪/几何口径只此一处，拆开会让该口径跨文件漂移。2026-10-25：新增「内容原尺寸」（`readContentSizeInLayout`）与「100% 下是否装不下」（`contentExceedsCanvasAtFullScale`）；同批把数据层「全树节点盒并集」委托给 `core/minimap-geometry.measureMiniMapBounds`（该并集只留一份实现）。 |
| `src/engine/mindmap-nodes.ts` | 942 | 节点查询与工具 + 文本编辑防腐面（2026-10-16 自 `mindmap.ts` 拆出）：节点/DOM 反查、节点文本与图片尺寸、自绘内容重建、兄弟上/下移、`renderer.textEdit`/`node_dblclick` 收口。2026-11-11 增至 920：新增 `collectRenderNodeData`（渲染树节点 data 的文档序快照——**会话权威树没有 uid**，uid 由 `ensureUniqueUids` 补在建引擎前的克隆上，凡「按 uid 定位」的索引只能读引擎侧）与 `revealNodeByUid`（展开祖先 → 移到视口中心，**不选中**：按引擎三步自己组合、去掉 `active()`，避免高亮圈住表格 / chip；三件缺失才回退 `goTargetNode`；不写 data / 历史）。 |
| `src/engine/mindmap-theme-presets.ts` | 375 | 外观预设的**唯一数据表**（只放数据、零分支）：边框预设（`THEME_STYLE_PRESETS`）、整篇配色五档 × 亮暗（`PALETTES`）、节点级填充 / 线条成对表（`NODE_COLORS`）+ 反查 `nodeLineColorOf`。2026-11-05 由 191 行增至 369：节点指令色改「直出」后，线条必须是**同色相深一档**，配对表与整篇色板放在同一文件才能保证「同一套色的两种用途」不各写一份色值（拆开即逼出第二份色板，改色必然漂移）；`nodeLineColorOf` 与 `PALETTES` 共用 `domain/color` 的 HSL 阶梯，同一把尺子。与 `i18n` / `constants` 同性质：拆分的唯一收益是行数。 |
| `src/features/content/content-remeasure.ts` | 534 | 「自绘内容定稿 → 尺寸同步」会话：三条不变式（同帧合批 `setTimeout(0)` / 按 holder 反查真实节点 / 渲染窗口只重试一次）**加第四条可见性不变式**（2026-10-14）——「隐藏态不测量」与「由隐藏转可见的四路自愈」必须与前三者共享同一份回退链（holders → 产物反查 → 暂存重试），拆开会让 `flush` / `retryDeferred` / 字体批次各自维护一份可见性判定，必然漂移；文件头 ④ 记录实机证据与官方判据（`Element.isShown()`）。2026-10-14 增至 460：新增 ⑤ 未定稿修复（三钩子触发 + 宿主画布根作用域，见第十批）。**2026-10-14 十一批增至 492**：清理点改 `forgetEngine`（按引擎身份清，`pruneUnsettledMathOwnedBy`）；`resetNodes` **不再动登记面**（它跑在首帧渲染前，正是误清高危时刻）。**2026-10-14 十二批增至 502**：`recoverHidden` 补可见性守卫（自愈拍到期前又隐藏时不测量、脏标记保留——否则 0×0 写回且此后不再自愈）。 |
| `src/features/mindmap-codeblock.ts` | 766 | Markdown 代码块只读嵌入（语言键 `mindmap`）的**单一关注点**：块体解析 → 只读引擎装配（`readonly: true` + `enableViewDrag: false`）→ **容器高度随内容**（按宽度适配量测 + 写内联高度 + 请引擎重排）→ **容器宽度变化即重排**（观察器**先建且常驻**：首帧同步挂载成功也注册，否则高度口径锁死在首帧、内容被 `overflow: hidden` 裁掉；重排在**下一帧**落（`deferFit`），在 RO 回调里写布局会被 Chrome 记 `ResizeObserver loop…` 实机可见）→ 滚轮归宿主页面（capture 拦截；引擎 `onMousewheel` 无条件 preventDefault）→ 超限降级只读大纲 → 生命周期收尾（观察器/事件/尺寸会话/引擎/卸载即清 DOM）是一条不可分割的链；拆开会让「解析口径、零尺寸等待、尺寸反馈环、销毁顺序」四处漂移。**不写 data.json**（用户裁决 2026-10-13）。 |
| `src/markdown/md-footnote.ts` | 316 | 脚注的**唯一判定面**：定义语法（`parseFootnoteDefinition` / `isFootnoteDefinition`，解析层的链接引用定义豁免也委托它）、逐行分类（`forEachFootnoteLine` 同时服务渲染期剥离与全文索引——拆开必然出现「显示剥了、索引没剥」）、id 字符类（`FOOTNOTE_ID_SOURCE`，行内引用正则从它拼）。2026-11-12 增至 315：续行改按**相对内容起始列的缩进**判定（`indentOf`：优先解析层 `mdContinuationIndents`，否则行首空白），同列的非空行不再被当成续行隐藏；行分类与 id 语法各自只留一份实现（硬规则 5）。 |
| `src/markdown/md-serialize.ts` | 1074 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。**2026-11-08 增至 997**：「跟随兄弟风格」改为按**位置**判（`SerializeFrame.lastWasList`，层首仍看整层）——只看整层会让混排组里排在标题之后的新建节点写出列表项、重开被读成该标题的子节点（K172）。嵌入拼写走 `domain/wikilink.formatEmbedWikilink`，注意 `embedLabelSuffix` 返回值**带前导 `\|`** 需去前缀。2026-10-12 增至 1189：无显示名段（首图 / icon-only URL）的**锚点插入点**反查（`anchorInsertPoint` / `insertionForm`）与替换型 slot 共用同一遍行内拼装，拆开会让「文本定位」与「锚点定位」各持一份区间占用判定。2026-10-13 到 1191：`serializeMdBody` 内的 `nodeLines` 去掉遮蔽外层入参的冗余 `app` 形参 |
| `src/markdown/md-outline.ts` | 926 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则。2026-10-12 增至 1108：首图与 icon-only URL 也登记台账段并附**上下文锚点**（`tokenAnchors`）——不登记则合成只能尾插，图片被搬到行尾 |
| `src/markdown/md-outline-lines.ts` | 421 | 逐行分类的唯一实现（围栏状态机 / 自闭合围栏 / setext 与分隔线 / 空列表项 / 有序编号，零依赖）；拆开会把「行 → 分类」与「树装配」割成两份缩进与围栏口径（K164）。2026-11-08 增至 322：有序编号 `orderedNumber` 随行记录（K170），只加字段不拆文件；同批把编号限制为**安全整数**（`orderedNumberOf`，超长编号写回会成 `1e+21.` 让整行退化成段落，K172） |
| `src/core/minimap-geometry.ts` | 1503 | 小地图的**纯几何与绘制模型**（无 DOM、无引擎依赖）：面板尺寸（等比装入宽 220、宽 160–220、高上限＝画布高×0.6〔缺省 280，生产恒传比例值〕）、启用判据、标记提取（DFS + 抽样上限）、**按原图**的 SVG 拼装（节点方块 + 跟随画布的折线/曲线 + 配色清洗）、视口框投影、30s 节拍判定。六者共用同一套「内容盒 → 面板坐标」换算——拆开会让「图」与「框」各持一份变换（改一处必漂移），30s 节拍也就无处直测（2026-10-24，F12-M；同日曾试「密度块」抽象，用户判定太丑已回退，勿再引入）。**同日增至 743**：并入「布局固有连线形态」——`connectorModeForLayout`（布局 → 形态唯一映射）+ `fishboneConnectors`（骨干直段 + 斜脊折线，只依赖盒子几何、不复制引擎 `fishboneDeg` 三角换算）。放这一层而不是渲染层：脊线用的是同一套「内容盒 → 面板坐标」换算，且必须可直测。**2026-10-25 增至 1209**：连线形态从两态扩到五态（`branchH`/`busV`/`railLeft`/`chainRail`/`fishbone`），几何按画布逐段实测复刻（0.6/0.7 折点、左边界锚点、12px 轨距）；新增 `buildMiniMapLinks` 统一产出 `MiniMapLink`（直线 / 折点 / 多条折线三种端点描述），SVG 装配只剩「坐标映射 + 拼 path」一件事。**同日清理批**：`buildMiniMapMarks` 删掉恒真的根特判（根是 DFS 首访节点，`seen = 0` 使步长判定必保留它）。**2026-10-25 第三清理批**：删掉无人消费的 `MiniMapMeasure.firstLevel`（全量一级节点计数：算了、传了，生产侧没有读取方）；`MiniMapMark.parent` 的注释订正为「> `MINIMAP_MAX_MARKS` 的抽样可能抽掉父 ⇒ 该边画不出（`childrenIndex` / `branchLinks` 跳过）——是**可达路径**，不是防御」。 |
| `src/core/i18n.ts` | 849 | 纯词条表（无逻辑分支）。2026-10-14 增至 563：节点上/下移 5 条（双语），含中心节点与首/末位拒绝提示。 |
| `src/features/view/view-context-menu.ts` | 844 | 节点与空白画布右键菜单的**唯一装配面**：按落点形态分流链接/图片/文字动作与视图级外观项，共享右键时的选中快照、历史动作与分流规则。宿主级联菜单等通用 DOM 机制已移至 `ui/menu-submenu.ts`；本文件保留菜单语义与视图动作编排，继续拆分须避免复制落点/选中判据。行为依据见 K146/K154，历次增长与拆分流水见 `line-count-log.md`。 |
| `src/features/editing/view-node-color.ts` | 475 | 节点配色的**全部写入入口**（2026-11-06 越线并登记；2026-11-09 增至 468）：右键节点「配色」与空白右键「按分支自动上色」两个入口共用同一套「原文合成 → 一次批量落地」、同一份**作用范围**定义（`nodeColorScope`：含子节点＝只写有色节点、靠继承；仅本节点＝再给直接子节点补哨兵阻断，K167）、「默认」的两种落地（上层还在染色 ⇒ 写 `%%none%%`；否则 ⇒ 删指令）与撤色后的无主哨兵回收。2026-11-09 追加**一次性的旧哨兵清理**（`collectColorSentinelSessions` / `applyColorSentinelCleanup` / `offerColorSentinelCleanup`，K175）：判「哪行是自身哨兵」与删除仍复用 `colorDirectiveOf` / `setColorDirective`，与上色两条入口同源。拆开就会让「这次改色到底写哪几行（带不带 `%%none%%`）」跨文件漂移——而那正是本批反复踩到的地方：色源与哨兵必须**同批**落地，否则一次改色要付两轮整树重渲（K149 ⑥ / K167 ③）。 |
| `src/features/view/view-minimap.ts` | 797 | 小地图浮层的**单一关注点**：启用判据（通过即画首帧）→ 30s 节拍（仅约束后续换图）→ 无操作淡出 → 视口框本地投影 → 拖拽导航，是同一条不可分割的状态链（**五个布尔** enabled/ready/visible/dirty/hovering + 两个时间戳 + 一个定时器）；拆开会让「何时画、何时藏、何时跟手」跨文件失配。纯判定与几何已外置到 `core/minimap-geometry`，本文件只留副作用（2026-10-24，F12-M）。**同日增至 568**：切布局的引擎重排是**异步分片**（`setLayout` → `RESET_LAYOUT` → 80ms fit），在写入漏斗处立即取样只能拿到上一套布局、还会把 30s 刷新窗口消耗掉（实机：切布局小图最长 30s 不动）⇒ 新增 `drawAfterRender` 标记 + `drawWhenLanded` 补画点；「落地事件是否已产生新几何」的判据外置为 `core/minimap-geometry.sameMiniMapFrame`（纯函数、可直测）。**2026-10-25 补**：悬停保活（`hovering`）与滚轮转发两条浮层交互；判据/取图透传已测几何与画布尺寸。**清理批**：删掉 `reveal` / `wake(forceDraw)` 里重复的排帧调用（`applyFrame` 是唯一写入点且已排）。 |
| `src/features/view/view.ts` | 2000 | 视图 Controller：**第 6 步拆分后的编排壳**（见文件头契约）。数学校准会话已外置为 `features/content/content-remeasure.ts`（2026-10-11）；自绘内容装配（`InlineContentOptions` 的五项绑定）外置为 `features/content/node-content-factory.ts`（2026-10-13，与代码块嵌入共用同一份装配）。**2026-10-21 增至 1149**：连线样式两态收敛（读取侧归一存量 `auto`/`direct`；`applyLineStyle` 写入侧同样归一，防旧词汇回写 `data.json`）。**同日再增至 1249**：边框 / 配色改为按文件记（`applyPalette`/`applyThemeStyle`），四项「按文件偏好」的缺省值收进 `resolveFilePreferences`（此前 themeStyle 在 load 处回落硬编码 `default`，导致「默认边框样式」对新建导图无效）。**2026-10-23 复测 1223**：读取侧四个 `resolve*()` 收敛为 `resolvePreference(key: PreferenceKey)`（与写入侧 `commitPreference` 对称，`MindMapViewContext` 接口面 −3）；`onEngineReady` 删掉两个死参，改由本类自行 `refreshToolbar()`。**2026-10-29 增至 1337**：逐文件布局移入文件属性——`loadMindMapFromFile` 读 `readDeclaredLayout`（种子值只兜缓存滞后，且**读完文档再复问一次**——`vault.read` 给 MetadataCache 追赶时间，勾选态与引擎创建因此对齐磁盘真值而非停在种子值），`applyLayout` 改为「排空正文 → `processFrontMatter` → 成功后才动画面」的独立实现，新增 `syncDeclaredLayout`（跟外部改写、幂等、不回写）；`resolvePreference` 收窄为三项、新增 `resolveLayout()`，`SESSION_FIELDS` / `IN_PLACE_REFRESH_KEYS` 去掉布局。**2026-11-02 增至 1513**：大图首帧提示（`showLargeMapRenderHint` / `clearRenderHint`，阈值 `LARGE_MAP_RENDER_HINT_NODES`，理由见 K161）+ `markLoaded` 传入 `doc.body`（撤销回加载态按原样正文还原，K160⑤）。**同日再增至 1565**：「加载基线」与「大图首帧提示」改为**在引擎就绪时消费**——`initMindMap` 在容器 0 尺寸（后台标签/折叠面板）时只挂 ResizeObserver 等待、`getDataSnapshot()` 为 null，原来那一版会把 `markLoaded` 的空守卫吞掉（基线缺失 ⇒ 此后每轮自动保存都不再算「纯浏览」，打开即重排全文），提示则会绑不上 `node_tree_render_end` 而挂到 15 s 兜底（不透明遮罩盖住画布）。故新增 `recordLoadedBaseline(file)` + `LoadSession.pendingBaseline` / `pendingRenderHint`，由 `onEngineReady` 补记/补建（设置刷新重建不写 pending，不会把未落盘编辑误标成基线）。 |
| `src/services/engine-controller.ts` | 689 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法；导出 SVG 后处理链经 `deps.exportSvgTransforms` 由组合根注入（K51：services 不依赖 features）。2026-10-13：主题写入与 resize 改走 `engine/mindmap` 的 `applyThemeConfig` / `resizeMindMap`（视图与代码块嵌入共用同一入口）。 |
| `src/media/images-path.ts` | 758 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一）。`schedulePersistSizeCache` 是**第三种调度语义**（纯延迟落盘、窗口不重置、首调不立即执行），刻意不用 `createDebouncer`/`createThrottler`。 |
| `src/features/media/image-resize.ts` | 432 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链。窗口级会话（监听 + rAF 合帧 + 幂等收尾）已收口到 `drag-session`，本文件只留业务回调；`capture: true` 是「手势独占」的显式参数 |
| `src/features/content/view-footnote.ts` | 692 | 脚注交互**唯一入口**（视图 + 只读嵌入共用）：画布 capture 命中**外层** `sup.mindmap-node-footnote-ref`（不是内层 `a`，否则鼠标落在上标盒子行高 / padding 区域时静默失效）→ 点击 `revealNodeByUid` **只居中不选中**（导航而非选择，避免高亮圈住表格 / chip）/ 悬停浮层显示定义正文。索引从引擎渲染树现算（`collectRenderNodeData`），按 `node_tree_render_end` 失效；悬停调度按**元素身份**判重（同 id 可出现多次），渲染落地只收起浮层、**不清未决的 show**。三条实机缺陷（sup 命中 / 同 id 移动 / 渲染窗口吞 show）与未定义引用反馈由 `tests/features/content/view-footnote.test.ts` 的 DOM 桩直测钉死。**2026-11-11 第二批（用户视角打磨）**：浮层**可交互**（内部链接经宿主 `openLink` 打开、文字可选中、超长时浮层内滚动且滚轮不交给画布——`FOOTNOTE_PREVIEW_CLASS` 由 `view-viewport` 放行）；**编号后置**（`applyFootnoteLabels`：按首次引用顺序，构建期仍只写 id；**不写 `title` / `aria-label`**——前者弹浏览器原生提示、后者被 Obsidian 的全局 tooltip 委托读成黑框，鼠标停在徽标上会同时冒两个提示，语义改用不触发 tooltip 的 `role="doc-noteref"`）；**未定义弱化**（`is-unresolved` + 截断 id）；**汇总 chip**（纯定义节点渲染 **`脚注`**——刻意不报条数：`脚注 N` 会被读成「第 N 条脚注」；点击/悬停展开全部定义）。**点击不闪烁也不选中**（2026-11-11 实机裁决：定义行已折叠 / 剥离，跳过去看不到脚注正文，闪动与高亮圈住都只剩噪音；只保留「展开祖先 + 居中」）。K197 ⑨。 |
| `src/features/editing/view-node-actions.ts` | 718 | 节点操作（链接/文本/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export（含 2026-10-13 收口的建图入口 `createImageChildNode`）。剪贴板（复制/剪切/粘贴）已于 2026-10-13 收口到 `features/editing/view-clipboard.ts`，此前的视图级 WeakMap 剪贴板（`copyNode`/`pasteNodeAsChild`）整体删除——勿在此重建第二份。2026-10-15 复测 881：新增 `planDocLink` / `planAttachmentLink`——**拖入文档 / 附件的载荷与提示唯一判定点**（一次判定给出 `{ target, link, data, notice }`，载荷与提示**结构上同源**），附件字段集另收口为私有 `attachmentFields`；此前文档**五处**、附件**三处**各写一份载荷或提示写法，且「未选中 / 文件夹拖入」两路**不查官方设置**（违反硬规则 5）。 |
| `src/features/editing/view-dnd.ts` | 600 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配；2026-10-13 起未选中节点时的**图片**（库内拖入、以及「载荷全是图片」的系统拖入）在渲染根下新建图片节点（建图数据形态收口到 `view-image-actions.createImageChildNode`；含非图片的系统载荷仍要求先选中）。入库失败**不由本层二次提示**——入库通道（images-save）已逐条提示并返回 null，只留控制台计数痕迹。 |
| `src/main.ts` | 609 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。2026-10-13 增至 426：`registerMarkdownCodeBlockProcessor` 注册 + 把设置窄化成 `MindmapEmbedConfig` 传 getter（features 不引 `settings`）。2026-10-14 复测 422（**减法**）：文件夹右键新建导图的调用点改传 settings（落点解析移入 `creation.ts`）。2026-10-28 复测 511（**减法**）：删除语言切换的全库属性键迁移（`propertyKeyMigration` 串行队列 + `refreshLanguageUi` 里的调用）。 |
| `src/markdown/links-split.ts` | 500 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。 |
| `src/core/constants.ts` | 1021 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件）+ 代码块判定（缩进行 / 围栏语言码白名单 / 已渲染标记类）。2026-10-12 复测 480：新增导出格式选项表与唯一的 `ExportImageFormat` 类型。2026-10-13 增至 501：`CODE_BLOCK_LANGUAGE`（存量笔记的接口）与 `CODE_BLOCK_MAX_NODES`（嵌入上限，与 `PERFORMANCE_NODE_THRESHOLD` 语义不同故不复用）。2026-10-14 增至 529：新增 `SaveLocation` 类型与 `SAVE_LOCATION_OPTIONS`（设置面板下拉与 `sanitizeSettings` 白名单共用）。**2026-10-21 增至 585**：连线样式两态收敛——`LINE_STYLE_OPTIONS` 砍至 `straight`/`curve`、新增 `DEFAULT_LINE_STYLE` 与 `normalizeLineStylePreference`（旧词汇 `auto`/`direct` 归一唯一实现）。 |
| `src/settings.ts` | 662 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。2026-10-11 增至 398：校验器加「被回退/钳制键」的诊断出参 + `reportDroppedSettings` 汇总留痕（无痕退化治理，K33 同族）。2026-10-12 增至 422：新增「导出格式」设置项（`exportImageFormat`，类型引用 `ExportImageFormat`），并令 `pickFrom` 泛型化以返回选项 value 的联合类型。2026-10-14 增至 475：新增「新建导图的默认位置」四档设置（`saveLocation` / `saveFolder`，含 1.13 声明式 `type: 'folder'` 控件与 `visible` 条件项——切档后经 `refreshDomState()` 重算可见性〔2026-10-15 改：该官方入口（d.ts:9290，1.13.0 起）专为 `visible`/`disabled` 谓词变化而设、原地切 CSS 状态不重渲染；`update()` 只留给定义**结构**变化（语言切换属此类）〕）。 |
| `src/features/content/node-inline-tokenize.ts` | 1725 | 节点原文到段序列的**唯一解析面（纯逻辑，无 DOM）**：块扫描顺序（引用 → 围栏 → 表格 → 行内）、段缓存、接管判定 `resolveSelfDrawSource`、原子截断 `clampSegments`、预览及配色指令读写保持同源。共享段模型与平台注入契约已移至 `core/node-content-types.ts`（K209）；UI 经模型与窄回调消费解析结果，不复制扫描、缓存或截断判据。段型不再要求与解析实现同文件，约束是只有一份解析口径。历史扩展与拆分见 `line-count-log.md`。 |
| `src/features/navigation/view-wikilink.ts` | 449 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。 |
| `src/domain/mindmap-property.ts` | 459 | 「本文件是不是导图、用哪种布局」的**唯一判据面**（2026-11-07 双键化 + 旧值兼容读口后越线）：归一（`normalizePropertyToken`）、双向值表、读写对称（`setMindMapEnabled/Layout/Disabled` 顺带收敛同名变体）、旧值兼容（`legacyLayoutIdOfPropertyValue` / `readLegacyLayout`）共用同一份数据——拆开必然让「读判据 / 写值 / 存量兼容」三处口径漂移，而这三处正是同一张表的三副面孔。2026-11-08 增至 427：三张以用户数据为键的查表改走 `createLookup`（`Object.create(null)`）——字面量查表会命中原型方法，`normalizeLayoutId('toString')` 曾返回函数（K172） |
| `src/features/canvas/view-viewport.ts` | 414 | **画布手势的唯一接管面**（2026-10-26 滚轮平滑后越线）：注册面（画布祖先 capture + 非 passive）与让位链（`Ctrl/Cmd` 缩放优先、编辑中交引擎提交、指针不在画布内、连续输入小 delta、纯横向 delta）必须与「接管后怎么走」同处——Alt 横轴映射、rAF 指数趋近、收尾（mousedown / 缩放 / 引擎换代 / 到达画面边界）共用同一份平滑状态；拆开会把「该不该接管」与「接管了走多少」摊到两处，正是引擎那套「先 `stopPropagation` 再平移」当年把容器级监听变成死代码的翻版（K138 / K144）。 |
| `src/platform/export-svg-postprocess.ts` | 369 | 导出 SVG 后处理**唯一收口**（2026-10-17 由 export-svg-style / export-css-vars / export-foreign-object-padding 三文件合并）：foreignObject 几何余量（K106）→ Obsidian CSS 变量注入（K99/K105）→ `--pele-*` 与通用变量白名单（K173），共用 `appendSvgStyle` 注入原语。三步共享同一条前提「导出克隆里没有插件样式表」，拆开会让变量白名单与几何余量各持一份 CSSOM 读取（同 `math-jax` 性质）。2026-11-09 越线（338 行）并登记。2026-11-11：几何余量的**横向 12px 改为左右各半**（`x -= 6`）——只加 width 会把自绘内容的右内边距压到 4px（实拍"节点边框右边比左边窄"，K106 ④-b）。 |
| `src/platform/rendering/code/prism-code.ts` | 393 | 代码块语法高亮通道**单一落点**（全插件唯一 import `obsidian` 的代码高亮实现，`loadPrism`）：产品形态是「字面代码 → 异步 `Prism.tokenize` → token 元素（**不经 innerHTML**）→ 定稿（入产物缓存 + 通知重排）」；与数学通道的四点差异（tokenize 是同步纯函数，故**不搬**字体/flush/就绪判据/挂载补替换队列）必须成对阅读；token 颜色**探测宿主计算色后内联**（导出 SVG 无 app.css，K91/K99 口径）；主题切换走 `refreshPrismTokenColors`（清缓存 + 就地改色，不重建节点）。未登记语言 / `tokenize` 抛错 / 空产物一律保留字面（占位即回退）。 |
| `src/platform/rendering/math/math-jax.ts` | 870 | 数学渲染通道的**状态与就绪编排面**：字面占位、异步渲染/替换、flush、未定稿登记、产物缓存与按 owner 清理共享可变状态和落地时序；渲染就绪既要字符规则落盘，也要可见字符有宽度（兼容 MathJax 3/4，见 K85/K113）。字符规则判定与索引已在 `math-jax-char-rules.ts`，导出 DOM/CSSOM 后处理已在 `math-jax-export.ts`；本文件调用/转发这些能力，保留渲染生命周期，不能再把已拆出的规则索引或导出实现计作本文件职责。历次扩展与拆分见 `line-count-log.md`。 |
| `src/links/links-tree.ts` | 455 | 树内引用更新**单一遍历实现**：rename / clear 两模式共享待匹配形态派生（资源地址 + [[链接]] 双载体、回收站退化、跨文件夹移动取新位置、非 .md 文档带扩展名）与写回规则；拆开会让「重命名改写」与「删除清理」两条路径的匹配口径漂移。`renamedMdLinkDest` 把 md 目标绕回 `parseWikilink` 是**安全**的（上游 `mdTargetRenamed` 已排除空串与含 `\|`/`#` 的目标），勿误改为「直接构造 parts」 |
| `src/links/file-lookup.ts` | 376 | 全库文件索引（键形态 / 缓存新鲜度 / 增量补建）与**「新建引用路径形态」的唯一组合判定**（官方 `New link format` 三档 + basename 同名消歧 + `domain/wikilink.formatLinkPath` 拼接）。后者 2026-10-20 从 `features/editing/view-node-actions` 上收：文档链接与图片引用共用同一份——拆开会让「读设置 / 判同名 / 拼路径」在两处各写一遍（图片侧此前正是直接写 `file.path`，无视设置）。 |
| `src/links/links-resolve.ts` | 353 | 「任意地址形态 → TFile」的**统一解析入口**：远程拒绝 → `obsidian://` → 资源地址 → 路径直查 → `file://` 剥离 → 官方 `getFirstLinkpathDest` → 索引兜底——形态路由的**分支顺序本身即契约**（新增规则只改这一处）；拆开会重新引入本文件当初拆出要收敛的「双轨并存、覆盖形态互有盲区」问题 |
| `src/markdown/md-open.ts` | 352 | 声明模式文档的**唯一读写面**：启用判据读取（`isMindMapFile` / `readDeclaredLayout`）与以导图打开 / 以 Markdown 打开的属性写入（`processFrontMatter` + `setMindMapEnabled/Layout/Disabled`）——两者共享 domain 的同一份「谁启用 / 布局是什么」判据；拆开会让「读判据 / 写值」两处口径漂移（2026-10-28 单键化：全库键名迁移删除后 303 → 243）。**2026-10-29 增至 280**：布局进属性——新增 `readDeclaredLayout`（视图的同步布局来源），升级写**种子布局**（`declareAndOpenAsMindMap` 增 `seedLayout` 参数），降级的短路条件收窄为「值已经是 `Markdown`」。**2026-11-07 双键化**：启用值恒写 `Mindmap`、布局独立写 kebab 键；升级时布局取值顺序为「启用键里的旧值（`readLegacyLayout`）→ 布局键里的旧写法（`readLegacyMindMapLayout`）→ 种子值」，已有合法布局原样保留。**2026-11-03 增至 340 → 364**：`openAsMindMap` 加「切换期间遮罩」（在 `.workspace-leaf` 上加减 `mindmap-view-switching`，成败都摘；样式两条选择器并列覆 `.workspace-leaf-content` 与 `.view-content`，上游改层级不至于静默失效）与同 leaf 并发去重（`WeakMap` 存 in-flight Promise，**带 3s 兜底超时**：`setViewState` 真挂起时摘掉登记允许重试，否则该 leaf 永远进不去导图）——Obsidian 打开文件**先**渲染 markdown、之后才切视图，启动恢复时能隔数百毫秒（用户看到「先闪一屏原文再变导图」） |
| `src/services/document-service.ts` | 862 | md 文档读写数据面：**读**（`DocumentService.load` → `parseMdOutline` + `walkResolveImagePaths`）与**写**（`SavePipeline` → 2 秒防抖调度 + 串行排空 + 卸载快照兜底 + 无差异跳过 + `Vault.process` 原子写盘）成对。**2026-11-07 重写（691 → 583）**：保存策略照搬 Obsidian `TextFileView`——删掉「自动保存开关 / P1a 外部改动检测 / P1b 连续失败挂起 / `forgetBaseline`」，写入改为 `Vault.process`（运行时缺失时回退 `cachedRead` + `modify`），文件头恒取磁盘现值、正文取本视图序列化结果。 |
| `src/services/document-session.ts` | 805 | **Level B 的会话本体**（2026-11-09）：一个文件的权威树、单游标历史、唯一保存管线、跨视图广播、外部写入重载是**同一条不可分割的状态链**——`commit` 必须同时改树 / 入历史 / 排广播 / 排保存（少一处就双写或丢历史）；由它持有的 `SavePipeline` 与 `SessionViewPort` 端口又必须共享同一份 `applying`/`loading` 闩锁（回声守卫）。拆开会让「提交一次编辑到底发生了什么」跨文件漂移，与 `document-service` 的拆分理由同性质；纯逻辑的栈已外置为 `document-session-history.ts`、注册表外置为 `document-session-registry.ts`，本文件只剩状态机与编排。 |
| `src/services/view-state.ts` | 341 | 按文件路径的视图状态**单一存储面**（连线样式 / 配色 / 边框 / 视口）：`hydrate` 的形状校验（含旧版逐文件布局 `layout` 的残留剔除、空壳条目整条丢弃，并返回 `boolean` 让调用方补一次写盘）、`getPreference`/`setPreference` 的取值归一、`resolveFilePreferences` 的「按文件 ?? 默认」合成、防抖写盘与 `flushNow` 共用同一份状态——拆开会让「读出来的值 / 存进去的值 / 缺省怎么给」三处分家（2026-10-21 的 `themeStyle` 硬编码回落就是这种分家的产物）。**2026-10-29 越线并登记**：hydrate 增加旧布局清理后 299 → 302；**2026-11-11**：只写变化（`isSamePathState` 同值不落盘、默认视口不落盘）→ 341 |

## 参考文档

以下具体文档链接由 `agents-md-sync` 校验存在性：

- **docs/**
  - [markdown-mindmap-standard.md](../markdown-mindmap-standard.md)：Markdown ↔ 思维导图映射规则（权威标准）
  - [markdown-mindmap-history.md](../markdown-mindmap-history.md)：标准文档的历史修订存档
  - **agents/**
    - [index.md](index.md)：文件、测试、文档清单与规模豁免的唯一登记处
    - [decisions.md](decisions.md)：实现决策，按场景定位
    - [README.md](README.md)：按需阅读、权威边界与文档规模
    - [architecture.md](architecture.md)：模块职责、数据流与依赖层
    - [baseline-metrics.md](baseline-metrics.md)：可复现基线与静态指标
    - [conventions.md](conventions.md)：关键约定 K1–K212，按编号读取
    - [line-count-log.md](line-count-log.md)：历次规模与验证记录，只追加
    - [testing.md](testing.md)：测试分层、CI 与验证流程
    - [process.md](process.md)：维护义务与发布流程
  - `release-notes-<tag>.md`：各版本发布说明（文件模式，不作为具体文档链接）

| 我要查 | 去哪 |
|---|---|
| 某个模块归哪层、能依赖什么 | `docs/agents/architecture.md` |
| 「为什么这里要这么写」（含历史踩坑） | `docs/agents/conventions.md`（按 K 编号搜） |
| 豁免表的历次行数读数 / 批次流水 | `docs/agents/line-count-log.md` |
| 某个测试该加在哪一层、CI 怎么跑 | `docs/agents/testing.md` |
| 改 Markdown 映射规则的权威定义 | `docs/markdown-mindmap-standard.md` |
| 发布流程、版本号、资产清单 | `docs/agents/process.md` |

> 决定「要不要通读某份」时看 `docs/agents/README.md`：它给规模、权威边界（冲突听谁的）、
> `conventions.md` 的五组划分，以及四条已被踩过的误读。
