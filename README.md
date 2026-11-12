**English | [中文](README.zh-CN.md)**

<div align="center">

# 🧠 MindMap Studio

**Read and edit your notes as mind maps — the notes stay Markdown.**

Add `Mindmap: Mindmap` to a note's frontmatter (with the layout in `Mindmap Layout`) and it opens as a mind map; any note can also be opened as one from its context menu. Nothing is converted and nothing is duplicated: the outline *is* the file, and every edit is written back into it.

Powered by the [simple-mind-map](https://github.com/wanglin2/mind-map) engine · by [WinterMosquito](https://github.com/WinterMosquito)

<p align="center">
  <a href="https://github.com/WinterMosquito/Obsidian-Mindmap-Studio/releases"><img src="https://img.shields.io/github/v/release/WinterMosquito/Obsidian-Mindmap-Studio?label=Release&color=blue" alt="Latest release" /></a>
  <a href="https://github.com/WinterMosquito/Obsidian-Mindmap-Studio/blob/main/LICENSE"><img src="https://img.shields.io/github/license/WinterMosquito/Obsidian-Mindmap-Studio?label=License&color=green" alt="License" /></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/Obsidian-1.13.0%2B-purple" alt="Obsidian version" /></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/Platform-Desktop-blue" alt="Platform" /></a>
</p>

</div>

![A note declared as a mind map, shown as a mind map in Obsidian](assets/mindmap.png)

## ✨ What it is — and what it isn't

MindMap Studio is a **rendering layer**, not a file-format converter. It reads a note's Markdown outline, draws it as a mind map, and writes your edits back as Markdown — so the note stays 100% standard Markdown, and links, backlinks, search and Git all work as usual.

| It is | It isn't |
|---|---|
| A mind-map **view** for notes you already have | A new note format or a separate app |
| **Markdown in, Markdown out** — frontmatter, headings and lists are the whole model | A converter that moves your content into `.xmind`-style files |
| The note as the single source of truth; the map is a way of looking at it | A second database that can drift from the file |

## 🚀 Features

### The file stays Markdown

- **Markdown-native**: a mind map is ordinary Markdown (a frontmatter declaration + headings + lists). No proprietary format, no special extension.
- **Round-trip fidelity**: unedited lines are written back verbatim (frontmatter preserved; blank lines between paragraphs and standalone `---` separators are normalised); headings `#`–`######` map to node levels 1–6, nested lists to deeper levels. **The indent unit follows the document**: a note written with tabs or four spaces keeps its style after editing and is never rewritten to two spaces.
- **Central node ↔ filename**: editing the central node renames the file (Obsidian updates links/backlinks) — for **declared** mind maps only.
- **Persistence**: line style, palette, border and viewport are kept per file (in plugin data); the **layout** lives in the file's **own frontmatter** (`Mindmap Layout` — switching it rewrites that key). "Is this a mind map" (`Mindmap`) and "which layout" are two keys in one file, so there is no second source of truth.

### Nodes look like your notes

- **Obsidian-native wikilinks**: `[[note]]` shows as its link text, with hover preview and graded modifier clicks (matching Obsidian).
  - **Modifier clicks**: plain click = current tab, `Ctrl`/`Command`+click = new tab, `+Alt` = new tab group, plus `Shift` = new window
  - **What the add-link dialog searches**: notes and other documents (`.canvas` / `.base`) plus non-image vault files (attachments); images go through **Add image**
  - **Links whose target does not exist yet** render in a **muted colour** (like Obsidian's reading view), resolved by the plugin from Obsidian's metadata cache; hover/click is left to Obsidian core (no pre-check on that path)
  - **New document links and images** follow Obsidian's own settings (the official **Use \[\[Wikilinks\]\]** governs links *and* images): with it on (the official default) they are written as `[[wikilinks]]` / `![[image]]` (document wikilinks render as clickable link text — no engine icon); with it off they are written as `[label](path.md)` / `![alt](path.png)`, and the document path form follows **New link format**. **Attachments** (PDFs, audio/video, archives — anything that is neither a document nor an image) always keep the wikilink embed form (`![[report.pdf]]` / `[[archive.zip]]`). **Existing** references keep the form they were written in — the setting never rewrites them (all three drop paths — with a node selected, with nothing selected, and folder drops — follow it; consolidated 2026-10-15)
  - **A node shows the alias** (the note name when there is none); editing the text of a pure wikilink node edits that alias and writes back `[[note|new alias]]`
  - **Dropping a vault file onto a node** (notes / images / attachments, **any type**), or picking one in the add-link dialog: a **completely empty node** is turned into a pure wikilink by writing the link's display name as its text; a node that already has **any content** (text, an image or an existing link — a pure-wikilink node included) keeps it, and the new link becomes a **child node**. A URL **on its own node** renders as **clickable address text** (the node has no text; the file still writes `<url>`)
- **Rich node content (clickable links + inline syntax)**: links inside a node render as **clickable text** — click to open, `Ctrl`/`Command`+click for a new tab (`+Alt` for a new tab group, plus `Shift` for a new window); **every link on a line is clickable** (no longer only the first one).
  - **Hover preview has two levels**: hovering **a specific link text** previews that link (important for multi-link lines and when the first link is an external URL); hovering **anywhere else on the node** previews the link the node carries (vault targets only)
  - **A URL mixed with other content is shown as a clickable address** instead of a bare icon
  - **Inline syntax** renders inside nodes the way Obsidian's reading view shows it: `**bold**` / `__bold__`, `*italic*` / `_italic_`, `` `inline code` `` (including double-backtick spans), `~~strikethrough~~`, `==highlight==`, `***bold italic***`; inline math `$…$` renders via MathJax, and `$$…$$` renders as a block (centred) formula — **multi-line** is supported too (falls back to the literal text until loaded); `\*escaped\*` / `\$` consume the backslash and show the literal character, and `%%comments%%` are hidden inside the node (kept in the file; a line that is nothing but a comment stays literal); a **GFM pipe table** (header row + separator row) renders as a real table — cells wrap within the node's content box and the table never overflows it (tables inside fenced code or block math stay literal)
  - **Task checkboxes**: a leading `- [ ]` / `- [x]` / `[X]` in a list item draws a checkbox inside the node that **toggles on a single click** (no edit mode needed); the write-back touches only the first three characters, keeps `[X]` as typed, and never triggers automatic link splitting. A body-less task still gets its checkbox; **nodes containing an image get none**, and no toggle entry either
  - **Tags**: `#tags` (including nested forms such as `#project/sub`) render as clickable pills that open Obsidian's tag search (`tag:#name`); only **top-level prose** counts (inline code / fenced code / math / comments / link internals excluded), and `foo#bar` / `#2024` are not tags; they are clickable in read-only embeds too, and **nothing is written back**
  - **Per-node colours**: right-click a node → **Palette** to recolour that node (whether its children follow is up to the **Color scope** setting; "With children" by default) — **the colour in the directive is the fill on the canvas** (what you write is what you see), the border and connectors take the **same hue one step darker**, text colour is picked from the fill's luminance (dark text on light fills, white on dark ones), **inline code, tables and links are recoloured to match**, and the **minimap follows**. The colour is written into that line as `%%#89CFF0%%`, **wins over** the file-wide palette, and a child's own directive **overrides** its ancestors'. **Default** returns the node to the **map palette** (even when a parent is coloured): if an ancestor is still coloured it writes `%%none%%` to block the inheritance, otherwise it simply removes the directive — `%%none%%` is the only non-colour value. With a multi-selection only the top-most nodes get a directive (with "Node only" every selected node gets one). **Custom** accepts a hex colour (`#89CFF0`) or RGB (`137, 207, 240`), with the darker line colour derived at the same ratio. The directive itself stays hidden (still a comment) and lives in the file; the same shape inside fenced/inline code or maths is not a directive, and invalid values stay plain comments. Right-clicking **empty canvas** → Palette changes the map-wide scheme instead (stored in `data.json`), and it also offers **Custom**; the same submenu ends with **Colour by branch** (absent on single-chain documents, which have no branch layer)
  - **Callouts and blockquotes**: `>` lines inside a node render as one box — a `[!type]` first line makes it a **callout** (all 13 official types and their aliases; type colour and icon come from the host theme and follow light/dark instantly; unknown types render as `note`), otherwise a **plain quote** (left rule from the host's `--blockquote-*`). The body renders **recursively** (tables / code blocks / mermaid / maths / links all work, nesting up to 2 levels), `|metadata` is preserved but not displayed, and `+` / `-` fold markers are markers only (the body always stays expanded). **No writes**: `>` and `[!type]` are consumed by the display layer only — `text` / `mdRaw` are untouched; exported images get the real `--callout-*` / `--blockquote-*` values, so a dark theme does not export as a light box
  - **Footnotes**: `text[^1]` renders as a **superscript number** (numbered by first appearance across the document, same as the reading view; named footnotes show a number too); hover opens a popover with the definition body (links clickable, text selectable, long definitions scroll inside the popover without zooming the canvas); clicking jumps to the definition node (**expands and centres, never selects or flashes**). Definition lines no longer take up space (a node holding only definitions collapses into a **Footnotes** chip), and unresolved references are dimmed with a notice. **No new syntax**: `[^id]` / `[^id]: …` are plain Markdown, `text` / `mdRaw` stay byte-identical, and browsing never saves
  - The raw text stays verbatim in the file; **links inside paragraph (multi-line) nodes are clickable too**
  - **Very long nodes** (> 2000 chars) show the beginning plus `…` (with a hover explanation) — the full text stays in the file, which also keeps oversized text from slowing the canvas down. Double-clicking such a node edits **the actual line from the file** (wikilink, URL and inline syntax stay visible and editable)
  - **Mermaid diagrams**: a fenced ` ```mermaid ` block inside a node draws as a real diagram, using the **same Pele renderer** Obsidian's reading view uses (identical output; colours follow the light/dark theme, and exported images keep them). Per-node colours **never** recolour a diagram — the same source looks the same in a red, blue or plain node (colours come from your own `classDef`/`style` or from the light/dark theme), and the diagram sits on its own paper so a coloured node cannot bleed through. Diagrams are **clickable**: `click A "[[note]]"` / `click A "https://…"` links open through Obsidian's own link handling (with the usual modifier keys); hovering shows a copy-source button. A diagram is never truncated — a source that cannot be rendered (syntax error, unsupported type, oversized) falls back to a plain code block, and the text always stays in the file
- **Images**: vault image suggestions, uniform sizing (a natural-size cap of 320 px; images with an explicit size are unaffected), `![[path]]` round-trip; drag the corner handle to resize a node image — the size is written back as Obsidian's official embed syntax (`![[img.png|300]]` width-only, `|300x150` explicit, `![alt|300](url)` for external images); clear a node's text and the node becomes image-exclusive — an image-exclusive node has no text, so node search never matches it. Inline images also render in **text/paragraph nodes** (its first line; links inside a paragraph are clickable too, see above). **With nothing selected**, pasting or dropping an image no longer asks you to select a node — each image becomes its own node under the central node.

### Read-only maps inside notes

- **Embedded read-only mind maps**: a fenced code block with the `mindmap` language renders in place as a read-only map (the block body uses the very same outline syntax as a mind map file). It behaves like Obsidian's built-in Mermaid: the container **fits the content** (scaled down to the note width, **never up**), **not draggable / zoomable / resizable** (a **Read-only** badge sits in the top-right corner), and the wheel keeps scrolling the note. The preview writes neither the file nor plugin state; links inside nodes stay clickable and in-node code blocks stay copyable; above 500 nodes it degrades to a **read-only outline** with an in-block notice (see the [embedding section](#embedding-a-read-only-mind-map-in-a-note)).

### The canvas works like a canvas

- **Clipboard & node order**: `Ctrl`/`Cmd`+`C` / `X` / `V` copy, cut and paste a subtree as **plain Markdown outline text on the system clipboard** — the outline moves between the map and any editor (indentation encodes levels; headings flatten to `-` items; ordered items keep `1.`). The node context menu also has **Move node up** / **Move node down** — swap with the adjacent sibling, with a notice at the first/last position (one `Ctrl`/`Cmd`+`Z` undoes it). **With nothing selected**, `Ctrl`/`Cmd`+`C` copies the **whole map** (central topic as the first line) instead of asking you to select a node — the clipboard never keeps the previous, stale text.
- **Opens at 100%** with the whole map centred; **Reset zoom** returns to 100% while keeping the visible content in place (auto-arrange only re-lays out nodes and **keeps the current viewport** — use **fit to canvas** to see everything).
- **Controls sit on the map itself instead of a bar**: the right edge carries a vertical rail of icon buttons in four groups — back to Markdown / export image, **border** and **line style** (click to toggle; the icon *is* the current state), zoom in / reset zoom / fit to canvas / **auto arrange** / zoom out, undo / redo. Anything that **picks a value** lives in the **context menu**: right-click the canvas or a node → **Layout** / **Palette**, a cascading list with the current choice ticked. **Switching the layout writes it into the file's property** (six layouts — `Mindmap Layout: logical | mindmap | organization | catalog | timeline | fishbone`; switching auto-arranges and fits the map), while **palette** (Default / Teal / Azure / Purple / Crimson / Orange / Gold / Green / Grey / Mist, plus a custom colour) is remembered per file in the plugin data, and so are **border** (Bordered / Borderless, bordered by default for new maps; maps switched explicitly keep their value, everything never switched follows the default) and **line style** (Elbow / Curve, Elbow by default; Catalog organization / Timeline / Fishbone draw native straight connectors, so that toggle is disabled there). The **Palette** submenu on empty canvas also ends with **Colour by branch** — one colour per branch, committed as one batch and undone in one step.
- **Node search** is built in: `Ctrl`/`Cmd`+`F` opens a floating search bar with a live `current/matches` count (`Enter` next, `Shift+Enter` previous).
- **Large maps stay fast**: **performance mode** kicks in automatically (500+ nodes draws only the nodes in view — no setting) and **fast text node rendering** renders every text node through the plugin (large maps open several times faster; double-click then opens the inline editor).
- **Image export**: PNG or SVG, per the *Export format* setting; **maths survives export** — the MathJax faces the exported SVG actually uses are inlined on demand, so matrix rules, radicals, fraction lines and `cases` braces are not lost, at the cost of a larger file, and maps without maths are unaffected.
- **Drag reparenting**: drop a node onto another node to nest it as its child, or between two siblings to insert it in between (native engine hit-testing).
- **Relationships**: right-click a node → **Relationship** → click the target node, then **place a start and an end handle** on the canvas — the route is exactly where you put it (the plugin deliberately does not pick one), and both clicks land as one commit: a lazily added `%%id:xxxxxx%%` on the target and `%%rel:xxxxxx | label%%` on the source. Only **relative geometry** is stored (`geo=…`), so moving nodes or switching layouts keeps the line, and dragging an endpoint or control point writes it back 200 ms later. Right-click the line for **Relationship colour** / **Edit relationship label** / deletion; exported lines always carry an arrowhead, so the direction is "who points at whom". Read-only embeds draw them too.
- **Summaries**: bracket a run of **adjacent sibling** topics under one sentence — right-click a node → **Summary…** and click the last topic, or **right-drag** a box on empty canvas and take the first entry of the menu (adjacent siblings are offered as **Summary ({count} topics)** and build straight away). The text lives in `%%sum:2 | text%%` on the first covered topic, so the note gains a comment line and not a character of body; double-click a summary to edit its text, right-click or `Delete` to remove it. Read-only embeds draw them too.
- **On maps with more than 2000 nodes, Fit to canvas has a readable floor**: when the true fit scale would be below 10%, the map is centred at 10% with a notice that not all nodes are shown (a multi-thousand-node fit lands around 0.03 — text under 1px).
- **Minimap**: when the map **does not fit the canvas at 100%**, a thumbnail fades in at the bottom-left (it disappears as soon as the map fits — **no button, command or setting**, and nothing is written to `data.json`): nodes are shaded by depth, connectors **follow the current layout's shape**, and colours follow the map. The box is the current viewport — drag it (or the empty area of the panel) to navigate, and it follows every pan/zoom frame. It fades out after 30 s without activity, stays while the pointer is over it, and wheel events over the minimap are forwarded to the canvas (plain wheel pans, `Ctrl`/`Cmd`+wheel zooms — same as on the map).
- **Status bar**: while the mind-map view is active the status bar shows "N nodes" plus the save state (`Saving…` / `Saved` / `Unsaved`), refreshed as you edit, and clears when you switch away or close the view; only **write failures** keep "Unsaved" visible until the next successful write — an external change now means "skip this write and load the latest version" instead (see *Saving & persistence*).

## 🖼️ Feature gallery

**In the app**

**Task checkboxes and tags** — a leading `- [ ]` draws a checkbox inside the node (one click toggles it, and the write-back touches only the three leading characters), while `#tags` in the body render as clickable pills that open Obsidian's global search; shapes such as `foo#bar` and `#2024` stay plain text:

<p align="center">
  <a href="assets/Tasks%20and%20Tags%20Example.png"><img src="assets/Tasks%20and%20Tags%20Example.png" width="85%" alt="Task checkboxes and tags: checkboxes on the left of nodes and tag pills inside the body"></a>
</p>

**Minimap** — it fades in when the map does not fit at 100%; the box is the current viewport, so drag it (or the empty area of the panel) to navigate:

<p align="center">
  <a href="assets/minimap.png"><img src="assets/minimap.png" width="85%" alt="Minimap: thumbnail with the viewport box at the bottom-left, icon rail on the right"></a>
</p>

**Read-only embed** — a fenced block tagged `mindmap` renders in place in any note; it only scales down, cannot be dragged, and the wheel scrolls the page:

<p align="center">
  <a href="assets/Embed example.png"><img src="assets/Embed example.png" width="85%" alt="Read-only embed: a mindmap fenced block rendered inside a plain note"></a>
</p>

## 📖 Usage

### 1) Create & open a mind map
- Run **Create new mind map** (command palette or ribbon) → a naming dialog appears (default = prefix + date; duplicates get a numeric suffix) → the `MindMap2026-10-13.md` file is created and opens in the mind-map view. The folder follows the **Default location for new mind maps** setting — by default Obsidian's own "Default location for new notes". You can also **right-click any folder → Create new mind map** to create it right there.
- **Turn any note into a mind map**: add `Mindmap: Mindmap` to its frontmatter (the key is case-insensitive) and the note opens as a mind map as soon as it is opened. **The layout is a second key**, `Mindmap Layout`:

  | `Mindmap` value | Meaning |
  |---|---|
  | `Mindmap` (`mindMap` / `mind map` too) | **Enabled**: rendered as a mind map |
  | `Markdown` | **Not enabled**: plain Markdown (what *Switch to Markdown* writes) |
  | Anything else (including the six legacy layout names) | **Not enabled**: the plugin leaves the file alone |

  | `Mindmap Layout` | Layout |
  |---|---|
  | `logical` | Logical structure |
  | `mindmap` | Mind map |
  | `organization` | Organization chart |
  | `catalog` | Catalog organization |
  | `timeline` | Timeline |
  | `fishbone` | Fishbone |

  Both keys share **one normalisation** (`trim` → lowercase → drop `-` / `_` / whitespace, so `mindmap-layout` and `logical-structure` work); an array value uses its first item. A missing or unrecognised layout falls back to the **Default layout** setting while **the file keeps its original text**. Remove the enable key (or set it to `Markdown`) to stop. **No renaming, no new file, no format conversion.** The legacy keys `Type` / `类型` are **no longer recognised** (since 2026-10-28); the six legacy layout values in `Mindmap` **no longer enable** the plugin — about 1.5 s after startup a **one-shot migration** rewrites them as `Mindmap: Mindmap` + `Mindmap Layout: <matching value>` (spelling only, no declarations invented, idempotent; the migration is removed in 0.4.0).
- **Any note becomes a mind map**: any `.md` file opens from its **context menu → Open as mind map** (or the same command), can be edited and saved back; the **first open writes the declaration** into the frontmatter — `Mindmap: Mindmap` + `Mindmap Layout: <the Default layout setting>` — so the note is now officially a mind map and opens as one on its own next time (a note already declared is left untouched). A *declared* file instead shows **Open as Markdown** (which rewrites the enable key to `Markdown` and **keeps the layout key**, permanently; switching back restores the layout).
- The command palette also lists **Create mind map in current folder**, **Search nodes**, **Fit to canvas**, **Arrange mind map** and **Export image** — the same actions as the on-map rail and the context menu.

### 2) How Markdown becomes a map
A mind map file is 100% standard Markdown — the plugin renders it as a mind map and writes your edits back. **The central node *is* the file name** (a virtual document root that corresponds to no line in the file); `#` headings start at **level 1**:

```markdown
---
Mindmap: Mindmap            ← enable declaration (same key in every UI language)
Mindmap Layout: logical     ← layout (six kebab values; falls back to the Default layout setting)
---
# Project plan              ← level-1 node (#)
## Goals                    ← level-2 node (##)
- Milestone 1               ← child node (list)
- Milestone 2
###### Details              ← level-6 heading
- Seventh-level item        ← list nested under a heading → level 7
```

> `#`–`######` → node levels 1–6 · nested lists go deeper · `[[note]]` / `[[note|alias]]` → clickable link (the node shows the alias) · bare URLs → clickable address · inline syntax renders inside nodes (`**bold**` / `__bold__`, `*italic*` / `_italic_`, `` `inline code` ``, `~~strikethrough~~`, `==highlight==`, `***bold italic***`; `$…$` inline math and `$$…$$` block formulas (multi-line included) render via MathJax; `\*escaped\*` / `\$` show literally and `%%comments%%` are hidden (a hex colour inside becomes a per-node colour directive — see above) — a comment-only line stays literal; a GFM pipe table renders as a real table) · `![[img]]` → image (`|300` sets the size) · paragraphs & fenced code stay as text (**links inside paragraphs are clickable too**).
>
> Non-image embeds such as `![[report.pdf]]` render as **clickable text** (the file name) — alone on a node or mixed with other descriptive text alike: click the text to open it (PDF, audio, video), `Ctrl`/`Command`+click for a new tab; hovering the text triggers Obsidian's native preview as well. Neither is rendered inline — a mind-map node cannot host Obsidian's inline media view.
>
> **Files dragged in from your system** (images / PDFs / audio & video / notes / any other file): **images** work with or without a selected node — with one they become that node's image, with nothing selected each image gets its own node under the central node; **other files need a selected node first** (a notice appears otherwise) and are copied into the "default location for new attachments" and attached to that node (embeddable types are written as embeds `![[report.pdf]]`, everything else as links `[[archive.zip]]`); holding **`Ctrl` (Windows/Linux) / `Option` (macOS)** instead **skips the copy** and inserts an absolute link to the original location `[file name](file:///…)` (wrapped in `<…>` only when the path contains spaces or brackets; clicking opens it in your system's default app) — the same behaviour as Obsidian's drag & drop.

#### Embedding a read-only mind map in a note

The same outline can live **inside a note**: write a fenced code block with the `mindmap` language and the reading view / live preview renders the block body as a **read-only mind map**.

````md
```mindmap
# Project plan
## Goals
- Milestone 1
- Milestone 2
```
````

- **One syntax**: the block body is identical to a mind map file's body (headings + lists, one parser) — no second format, no new setting
- **Shaped like the built-in Mermaid**: the container **grows with its content** — scaled down to the note width (**never up**), so nothing is clipped and a small map leaves no empty frame; **not draggable, zoomable or resizable**; **the wheel still scrolls the note** (even with the pointer over the map)
- **Read-only, no side effects**: it writes neither the file nor the plugin's `data.json`; links inside nodes **stay clickable** (all three click channels are handled, and non-whitelisted protocols such as `javascript:` / `data:` are blocked without opening) and in-node code blocks stay copyable; **callouts / blockquotes, footnotes (numbering + hover + click-to-jump) and mermaid diagrams work inside the block too**
- **Appearance follows the defaults**: the border uses the **Default border style** setting, the palette stays **Default**, and whether node colours tint the connectors follows the global **Color scope** — an embed has no current-file identity, so it ignores the per-map choices made from the rail and the context menu
- **Fallbacks are always visible**: above **500** nodes the block shows a read-only outline with an in-block notice; an empty block body or a render failure gets its own one-line notice — never silent
- The language key stays `mindmap` from 0.0.1, so **existing notes work again with no edits**; which plugin wins when two register the same key is undocumented upstream

### 3) Everyday actions (in the mind-map view)
| Want to | Do |
|---|---|
| Edit a node's text | Double-click the node (or press **F2**; text inputs keep F2; with **no node selected F2 belongs to Obsidian** = rename the file) to open the **inline editor**: every text node is plugin-rendered (**fast text node rendering** is always on, no setting) and you edit **the actual line from the file** — `[[wikilink]]`, URL and `**bold**` syntax stay visible and editable; `Enter` commits, `Shift+Enter` adds a line, `Esc` stops and keeps (clicking outside the editor or wheeling the canvas commits too), and saving writes that line back verbatim. **Right-click → Edit in dialog is the second entry point**: a multi-line dialog (`Ctrl`/`Cmd`+`Enter` confirms, `Esc` cancels) with a live "**the node will show**" preview; a **pure wikilink** node edits its **alias** there (saving writes `[[note\|new alias]]`) |
| Follow a link in a node | Click the link text (current tab); `Ctrl`/`Command`+click (new tab — anywhere on the node works, falling back to the node's own link), add `Alt` for a new tab group, add `Shift` for a new window; **middle-clicking** a link opens it in a new tab too; hover **that** link for Obsidian's native preview (unresolved targets are not previewed) |
| Add a child / sibling | Right-click the node → **Add child node** / **Add sibling node** (siblings also via Enter) |
| Delete a node | Right-click → **Delete node** |
| Add a link | Right-click the node → **Add link** (pick a vault note or paste a URL). A wikilink fills a **completely empty** node (text = display name); a node with any existing content (text, image or link) gets a linked child node; a URL on its own node renders as **clickable address text** (the file still writes `<url>`) |
| Add an image | Select a node → **Add image** (from vault, clipboard, or a file) |
| Paste an image | `Ctrl`/`Cmd`+`V` on the canvas: with a **selected node** it becomes that node's image; with **nothing selected** a new image node is created under the central node |
| Copy / cut / paste nodes | `Ctrl`/`Cmd`+`C` / `X` / `V` with a node selected: the subtree is written to the **system clipboard** as a plain Markdown outline (indentation = levels; headings flatten to `-`; ordered items keep `1.`) — paste it into any editor, or paste an outline back as child nodes of the selection. The central node is never cut (silent no-op). With **nothing selected**, `Ctrl`/`Cmd`+`V` pastes an outline as a new node under the central node (an image on the clipboard still wins — see above) |
| Attach by drag & drop | Drag **any vault file** from the file explorer onto a selected node — it becomes the node's link (completely empty node: text becomes the display name; a node with any existing content: a linked child node is created); dragging an image sets the node image. With nothing selected, each file gets its own node under the central node — **images included** (a dropped image becomes its own image node) |
| Drag files in from your system | **Images** can be dropped with or without a selected node: with one, they become that node's image; with nothing selected, each image gets its own node under the central node. **Other files** need a selected node first (otherwise a notice asks you to) — they are copied into the vault and attached by type (notes → wikilink, everything else → attachment; embeddable types are written as `![[report.pdf]]`). Hold **`Ctrl` (Win/Linux) / `Option` (mac)** to **skip the copy** and insert an absolute link `[file name](file:///…)` instead (wrapped in `<…>` only when the path contains spaces or brackets) |
| Rearrange | Drag onto another node (pointer inside it) to nest it as its child; drag between two siblings to insert in between (native engine hit-testing) |
| Add a relationship | Right-click a node → **Relationship** → click the target → **place the start and end handles** on the canvas (nothing is written until both land; `Esc` or a click on empty canvas cancels). Drag an endpoint or control point to reroute it — the result is written back 200 ms after you let go. Right-click the line for **Relationship colour** / **Edit relationship label**, or to delete it (click the line to activate, then `Delete` / `Backspace`) |
| Add a summary | Right-click a node → **Summary…** → click the last covered topic (you may click backwards). With adjacent siblings already multi-selected the entry reads **Summary ({count} topics)** and builds straight away. Double-click a summary to edit its text; right-click → **Delete summary**, or `Delete` / `Backspace` |
| Move a node up / down | Right-click the node → **Move node up** / **Move node down** — swaps it with the adjacent sibling and goes through the normal auto-save (one `Ctrl`/`Cmd`+`Z` undoes it). The central node and the first/last position show a notice instead |
| Resize a node image | Hover the image, drag its bottom-right handle (aspect ratio preserved) |
| Resize a node's width | Drag the left/right edge of a **text node** (the cursor turns into a double arrow); the node's height is recomputed for the new width on release. Empty and image nodes have no such handle |
| View an image full screen | **Click a node image** (or right-click → **View image full screen**) for a window-filling lightbox: click anywhere / `Esc` closes it, the wheel zooms |
| Copy a node's code block | Hover a block-level code block → click **Copy code** (a brief ✓ appears; the fence info line is not included) |
| Make a node image-only | Clear the node's text: double-click → empty, or right-click → **Remove text** |
| Work on empty canvas | **Double-click** the canvas = create a node under the central node and start editing it (Obsidian Canvas' "double-click to add a card"); **right-click** the canvas = new node / paste node / reset zoom / fit to canvas / auto arrange / layout / palette (incl. **Colour by branch**) / **syntax** / undo / redo; **right-drag** = box-select, and releasing shows the selection menu (summary / copy) |
| Change the hierarchy syntax | Right-click empty canvas → **Syntax**: bullet list / headings (level 1) / headings (level 2) — a **whole-document rewrite in one undo step**. If a level holds nodes that cannot become headings (multi-line / task / ordered list / fenced code), that whole level stays a list and the first blocker is named (never half-converted). Converting to headings keeps the original list marker (`*` / `+` survive a round trip) and keeps ordered numbers; an edit-time guard catches structure-changing drops (a list after headings, increasing heading levels, a heading under a list parent…) by normalising in place or rolling the edit back with a reason, and **legal mixes (list before heading) are never touched** |
| Clean the layout | **Right-hand rail (four groups)**: back to Markdown / export; **border** / **line style** one-click toggles (the icon *is* the current state); zoom in / reset zoom (100%) / fit to canvas / **auto arrange** / zoom out; undo / redo. **Right-click menu**: **layout** / **palette** as cascading lists (the current choice is ticked), plus reset zoom / fit to canvas / auto arrange / undo / redo. Line style / palette / border are remembered per file; the layout is written into the file's `Mindmap Layout` property |
| Find a node | Search bar (`Ctrl`/`Cmd`+`F`, or the **Search nodes** command) — it opens as a floating bar at the bottom: typing searches as you go (180 ms debounce) and the box shows a `current/matches` count; `Enter` next, `Shift+Enter` previous, `Esc` closes; zero matches shows "No matches" |
| Split a node's links | **Auto-split mixed links is off by default**; once enabled, editing such a node **splits automatically** — document/attachment links mixed with text move into child nodes (the node keeps its text; images and external URLs stay). Command **Split all mixed links in document** batch-processes the whole file, including untouched notes — the whole batch counts as one step, so **one `Ctrl`/`Command`+`Z` undoes it** |
| Export | Rail **export** (or the **Export image** command) — PNG or SVG, per the *Export format* setting; a map containing maths keeps its structures (fonts inlined on demand, so the file is larger) |
| Back to Markdown | **Switch to Markdown** (restores source/preview mode) |

**Keyboard shortcuts (in the mind-map view)**

| Keys | Action | When it is *not* intercepted |
|---|---|---|
| `Ctrl`/`Cmd`+`F` | Open the search box | — |
| `Ctrl`/`Cmd`+`Z` | Undo | — |
| `Ctrl`/`Cmd`+`Shift`+`Z` | Redo | — |
| `Ctrl`+`Y` | Redo | Windows/Linux only — macOS leaves `Cmd`+`Y` alone |
| `Ctrl`/`Cmd`+`C` / `X` | Copy / cut the selected node (system clipboard, Markdown outline) | Inside a text input, or with no node selected |
| `Ctrl`/`Cmd`+`V` | Paste as child node(s) of the selection — with nothing selected, as a new node under the central node (an image on the clipboard still becomes an image node, see the actions table) | Inside a text input |
| `F2` | Edit the selected node | With **no node selected** F2 belongs to Obsidian (rename the file); inside a text input F2 is left alone |
| `Delete` / `Backspace` | Delete the selected node | Inside a text input, while a node is being edited, or with no node selected |
| `Shift`+`1` | Fit to canvas | Inside a text input |
| `Shift`+`2` | Zoom to the selection (falls back to fit-to-canvas when nothing is selected) | Inside a text input |
| `Tab` / `Enter` | Add a child / sibling node | Handled by the engine, not by the plugin |

Undo/redo are driven by the **document session** (views of the same file share one timeline; `Ctrl+Z` also undoes raw-text edits such as colours, checkboxes and summaries). Very large maps keep fewer undo steps, because the history is capped by a fixed memory budget rather than a fixed step count.

**Context menus** — right-click the canvas for view-level actions, right-click a node for node-level actions. Menus follow the plugin's UI language (English shown here, Chinese in [`README.zh-CN.md`](README.zh-CN.md)).

| Canvas (empty area) | Node |
|---|---|
| ![Context menu on the canvas](assets/Right-click%20menu.png) | ![Context menu on a node](assets/Right-click%20node%20menu.png) |

### 4) Saving & persistence
- Unedited lines are written back **verbatim** (frontmatter preserved; blank lines between paragraphs and standalone `---` separators are normalised); editing a **pure wikilink** node (the whole line is one wikilink) edits its **alias**, written back as `[[note|new alias]]` (clearing the text drops the alias and keeps the link; nodes that mix text and a link still round-trip as "text + link").
- **The layout lives in the file's own property** (`Mindmap Layout` — switching it from the context menu rewrites that key and never touches the body); line style, palette, border and viewport are kept per file in the plugin `data.json`. Whether a file **is** a mind map is the enable key `Mindmap`, so there is no second source of truth. Node image sizes go into the note itself as official embed syntax (`![[img|300]]`).
- Editing the **central node** renames the file (Obsidian updates links/backlinks); declared mind maps only.
- **The same map can be open in several tabs** (since 2026-11-09): they share **one document session** — one content tree, one undo timeline, one save pipeline — so edits and undo/redo stay in sync (no engine rebuild, and neither viewport nor selection jumps). Closing any tab saves immediately; the session is destroyed when the last one closes, and renaming / moving the file only migrates the session key. The note's reading view can still be open next to the mind map.
- **Save cadence follows the official `TextFileView`**: a **2-second** debounce after content changes (there is no "Auto-save" setting), plus an immediate save on close / file switch / plugin unload; **browsing never writes** (a round whose body equals the load baseline is skipped), and the EOL form (CRLF / LF) and trailing double spaces are preserved.
- If the file is changed **outside** Obsidian (sync folder, another window): before writing, the plugin notices the body on disk changed, so it **skips the write** and loads the latest version; an unsaved draft is kept as **one undoable step** (`Ctrl+Z` brings it back) with a notice. A failed write only reports "Unsaved"; the next edit simply retries.
- Config is local; no telemetry, and the plugin makes **no outbound network requests** — nothing is sent anywhere. The only fetch it performs is a **local** `app://obsidian.md` read of the MathJax font files when you export a map that contains maths (see *image export* above); nothing leaves your machine.
- **Files outside the vault** are only ever touched when *you* ask for it: an absolute `file:///` link (created by holding `Ctrl`/`Option` while dropping a file) is handed to your system's default app when you click it. The plugin does not read, copy or upload those files.

### 5) Deliberate differences from Obsidian

The mind-map view is a **third kind of view** (neither reading nor editing view), so a few interactions follow this view's semantics. All of them are registered (see `AGENTS.md` K56 ⑤; the multi-view and side-button rows are K180 / K111):

| Item | Obsidian | This plugin |
|---|---|---|
| `F2` | Renames the current file | Same: with **no node selected** F2 goes to Obsidian (rename the file); with a node selected it edits that node (selecting the central node amounts to renaming the file, since its text *is* the file name) |
| Auto-update links on rename | Setting "Automatically update internal links" (on by default) | **Follows Obsidian's setting** (the plugin has no toggle of its own): with it off, links are left untouched (they become unresolved) and deleting no longer clears references; Obsidian itself already asks whether to update links after a rename, so the plugin no longer repeats that prompt (it only logs to the console) |
| Link syntax for new links | Follows the "Use \[\[Wikilinks\]\]" / "New link format" settings | Same, for **document links and images** (the official setting governs links *and* images): with Wikilinks on (the official default) it writes `[[wikilinks]]` / `![[image]]`; with Wikilinks off it writes `[label](path.md)` / `![alt](path.png)`; rewrites keep your existing path prefix. **Attachments** always keep the wikilink embed form (`![[report.pdf]]` / `[[archive.zip]]`) |
| `[[` suggestions | Inline suggestions in the editor | The source-line dialog is a plain textarea (no inline suggestions) → use the vault-file suggestions in the **Add link** dialog |
| Backlinks / Outgoing links / Unlinked mentions panes | Core plugins | Not duplicated — Obsidian's own panes act on the current file and work while the mind-map view is open |
| Clicking a non-renderable vault file (zip / docx / …) | Opens in the default system app | Same |
| Same file in a second tab | Allowed — "open as many tabs as you want"; `Ctrl`+clicking a link to a file that is already open makes a new tab | **Same here**: the mind-map views share one document session (one content tree + one undo line + one save pipeline), so edits and undo/redo stay in sync; each tab keeps its own engine and viewport/selection. The note's reading view can still be open alongside |
| Mouse side-button back / forward | Follows the navigation history | Same: side buttons follow Obsidian's navigation history in the mind-map view; switching views is **not** a navigation point — back goes straight to the previous navigation point (usually the previous note). Use **Switch to Markdown** (the rail's back button or the command palette), or **Open as Markdown** from the file context menu, to return to the note's Markdown view |

The full Markdown ↔ mind-map mapping rules live in [`docs/markdown-mindmap-standard.md`](docs/markdown-mindmap-standard.md).

## ⚙️ Settings

Everything lives in **Settings → MindMap Studio** (stored locally in the plugin's `data.json`; the table below follows the panel order):

| Setting | Default | Notes |
|---|---|---|
| Language | 中文 | UI language for the plugin's own labels and messages. It **never touches your files**: the mind-map declaration key is always `Mindmap`, whatever the UI language |
| Default layout | Logical structure | Seed value written into `Mindmap Layout` when creating / upgrading a note (six layouts: Logical structure / Mind map / Organization chart / Catalog organization / Timeline / Fishbone); existing maps keep their own property and are unaffected |
| Default line style | Elbow | Used when creating a new mind map (Elbow / Curve; switchable only for Logical structure / Mind map / Organization chart — the other three layouts draw native straight connectors) |
| Default border style | Bordered | Border style for new mind maps (Bordered / Borderless; each map can toggle it anytime with the *border* button on its rail). A per-map value only exists **once the rail toggle has been used explicitly**: switched maps keep their value, everything never switched (embeds included) follows this default |
| Theme | Follow Obsidian | Light/dark palette for maps: Follow Obsidian / Force light / Force dark |
| Color scope | With children | Whether a node colour picked from the right-click **Palette** menu also applies to the children: *With children* colours the whole subtree (connectors included); *Node only* colours just the selected nodes (writing `%%none%%` on their direct children to block inheritance) and keeps the connectors untinted. The colour itself always comes from the note's `%%#hex%%` |
| Default location for new mind maps | Follow Obsidian setting | Where **Create new mind map** puts the file: Follow Obsidian setting / Vault folder / Same folder as current file / In the folder specified below |
| Target folder | (empty) | Used by the "specified folder" mode above only (**only visible for that mode**); an unresolvable folder falls back to the vault root (no folders are auto-created) |
| Syntax for new mind maps | Bullet list | Body syntax for new maps: bullet list / headings (level 1) / headings (level 2). A **seed only** — existing maps keep their own spelling and can be converted any time from the blank-canvas **Syntax** menu |
| Auto-split mixed links | Off | When enabled, an edited node that mixes links with description text moves document/attachment links into child nodes (images and external URLs stay) — it rewrites the file structure, so it only happens once you opt in; use the command "Split all mixed links in document" for a whole file |
| Enable node dragging | On | Drag nodes to change hierarchy and order |
| Export image scale | 2 | PNG export resolution multiplier (slider 1–4; SVG export is vector and unaffected by it) |
| Export format | PNG | Format used by the **Export image** command and the rail's export button: PNG raster or SVG vector (SVG output is vector, so the scale above does not apply) |

> **Palette and border are not settings**: both are remembered per file and switched on the map itself — **border** from the rail, **palette** from the right-click menu (layout and line style work the same way; the layout lands in `Mindmap Layout`); the settings panel only holds **Default border style**, **Default layout** and **Syntax for new mind maps** (the initial values for **new** maps) plus **Color scope**, which only decides whether a node colour also tints the connectors (the colour itself always comes from the note).
>
> **The following are now always on and no longer exposed as settings**: performance mode (500+ nodes draws only the nodes in view) and fast text node rendering (every text node is plugin-rendered; double-click opens the inline editor) — i.e. the previous "best default", so any earlier toggle choice is ignored. Reference updating (rename / delete) also lost its own toggle and now **follows Obsidian's "Automatically update internal links"** (on by default).

## 📦 Install

- **Community plugins**: **Settings → Community plugins** → search *MindMap Studio*.
- **From GitHub releases**: download the latest release assets (`main.js`, `manifest.json`, `styles.css`) from the repo [Releases](https://github.com/WinterMosquito/Obsidian-Mindmap-Studio/releases) page, copy them into `<vault>/.obsidian/plugins/mindmap-studio/`, reload Obsidian, then enable the plugin in **Settings → Community plugins**. (Each release also attaches `LICENSE` and `THIRD-PARTY-NOTICES.md` for licence compliance — no need to copy those into the plugin folder.)
- **Build from source**: `npm install && npm run build` produces `main.js`; copy it together with `manifest.json` and `styles.css` into the plugin folder.

> Release notes for each version live on the repo's [Releases](https://github.com/WinterMosquito/Obsidian-Mindmap-Studio/releases) page (their text comes from [`docs/release-notes-<version>.md`](docs/)).

> Requires Obsidian 1.13.0 or later. Desktop only (Windows, macOS, Linux). Config is stored locally (plugin `data.json`); no telemetry and no outbound network requests. `main.js` is built in CI and attached to each GitHub Release (it is not committed to the repo).

## 🛠 Development

```bash
npm install
npm run dev      # watch mode
npm run build    # type-check + production bundle (main.js)
npm test         # regression suite (vitest)
npm run lint     # ESLint (the official obsidianmd ruleset, warnings are errors)
npm run lint:css # stylesheet rules — mirrors the community-directory scanner's stylelint set
npm run check:release   # release metadata guard (versions.json / manifest / README)
npm run verify:visual   # headless-Chrome render & contract checks (add `-- --require-chrome` in CI; `-- --bench-open` for the open-time baseline, `-- --perf` for the memory probe)
```

The engine (`vendor/simple-mind-map.cjs`) is vendored and must not be hand-edited; rebuild from upstream source when upgrading. Bundled third-party licences are listed in [`vendor/THIRD-PARTY-NOTICES.md`](vendor/THIRD-PARTY-NOTICES.md).

## ⚖️ License

MIT — see the `LICENSE` file in the repository root. The plugin bundles the [simple-mind-map](https://github.com/wanglin2/mind-map) engine and its dependencies under their own licences (MIT / BSD-3-Clause), plus [Pele](https://github.com/obsidianmd/pele) (MIT) for Mermaid rendering; those notices live in [`vendor/THIRD-PARTY-NOTICES.md`](vendor/THIRD-PARTY-NOTICES.md) and are attached — together with `LICENSE` — to every GitHub release, so the declarations accompany each distributed copy of the bundle.
