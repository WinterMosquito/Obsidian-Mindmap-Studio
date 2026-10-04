# 测试与 CI（详录）

> 本文件由 AGENTS.md 迁出（2026-10-04 瘦身）。AGENTS.md 只保留硬规则、决策表、命令与索引；
> 本文是**详录**，改代码前按需查阅，改约定时**同步更新 AGENTS.md 索引**。

## 测试与 CI

```bash
npm test            # vitest run（CI 在 build 后、lint 前执行）
npm run test:coverage  # vitest run --coverage（v8 provider，报告出 coverage/；CI 主矩阵版本执行并归档产物）
npm run lint:css    # stylelint：styles.css 的 CSS 检查（规则面照抄官方 scanner，见下方「CSS 检查」）
npm run check:release # 发布元数据护栏（versions.json 形状 / 当前版本与 minAppVersion 一致 / README 非空 / License：缺失 error、非 OSI warn，见 K109）
npm run check:dead-code # knip 死代码检查（未使用文件/导出/类型；见 K57）
npm run verify:visual  # 无头 Chrome 渲染契约验证（scripts/verify-visual.mjs）
```

CI（`.github/workflows/lint.yml`）执行顺序：`check:release` → build → `npm test -- --reporter=verbose --bail=1` →
coverage（主矩阵版本，并上传 coverage 产物）→ lint → `lint:css` → `check:dead-code`（knip，见 K57）→
`verify:visual -- --require-chrome --keep --log-dir verify-visual-logs`（主矩阵版本）。

发布流程（`.github/workflows/release.yml`）**自带门禁**：tag push **不会**触发 `lint.yml`
（其 `on.push` 只匹配 branches，不匹配 tag），故 `release.yml` 在构建前先跑
`check:release` + `npm test` + `npm run lint` + `npm run lint:css`——任一失败即不产出 release。
（官方 `obsidianmd/obsidian-workflows` 的 release 模式同样在 tag 上强制跑一遍校验；
本项目用自有脚本等价承接，不引入 scanner 那套被钉死的依赖版本。）

**CSS 检查（stylelint）**：`styles.css` 是发布资产，而官方目录 scanner 在 release 模式
**强制**对该文件跑 stylelint（`obsidian-workflows/src/lint.ts:246-329`、`:565`，目标 `**/*.css`）。
本地配置在 `stylelint.config.mjs`，规则面照抄官方 `SCANNER_STYLELINT_CONFIG`
（`src/lint.ts:10-123`），其中**唯一 error 级**规则是 `function-url-scheme-disallowed-list`
（禁止 `url()` 里出现 `http`/`https`/`file`，只允许 `data:`）——这是「主题/插件不得从网络
加载资源」的机械落点。三条维护要点：
① `browsers: ['electron >= 39']` 由 `minAppVersion: 1.13.0` 经官方 `ELECTRON_VERSIONS`
映射表推得（`src/lint.ts:126-160`）——**改 `minAppVersion` 时必须同步该值**；
② `ignoreFiles` 必须排除 `coverage/**`（lcov 报告里的 `base.css` / `prettify.css` 是生成物，
不属插件资产，纳入即误报）；
③ 该配置是**独立配置、无 `extends`**（与官方那份一致），故未被列出的规则一律不启用，
检查面与 scanner 相同。

**发布元数据护栏（`scripts/check-release-metadata.mjs`）**：本仓库 eslint 把 `versions.json`
放进 `globalIgnores`，而官方对它有 **error 级**形状校验（JSON 非法或非对象即阻断其 release）
⇒ 此前没有任何替代检查。脚本校验四项：`versions.json` 形状与 semver、`manifest.version`
在表内、**当前版本**的值 == `manifest.minAppVersion`、README 有有效内容。
**不要**把它改成「所有版本的值都等于 `minAppVersion`」——历史版本可以合法地要求更低的
app 版本，唯一正确的不变式是「当前版本」那一条。

`verify:visual` 这一步标了 `continue-on-error: true`（**非阻断**），因为它曾在 Linux 无头
环境偶发失败，而当时既读不到失败日志、又无 token 调 API 定位，最终被回退（见 commit
`7930d62`）。重新接入的前提就是「失败必须留下证据」，故同时加了 `--log-dir`：日志与
`--dump-dom` 快照经 `if: always()` 步骤归档成 artifact，失败时可直接下载定位。
浏览器缺失仍然直接失败（`--require-chrome`），不静默跳过。

- `verify:visual`：把 `src/engine/mindmap.ts`（纯模块）esbuild 成浏览器 IIFE，配仓库真实
  `styles.css` 在无头 Chrome 里渲染 10 个场景并断言 `--dump-dom`——三类链接图标分流与
  图标尺寸（18×18）、回形针标题、画布铺满容器、节点测宽随文本（不被容器拉平）、
  仅轻标记（无链接）节点也走自绘（`markup` 场景）、**轻标记扩展与隐藏语法**（`syntax`
  场景：`==高亮==`→`<mark>`、`__粗__`→`<strong>`、`\*转义\*` 消费反斜杠、
  `%%注释%%` 不进显示、未解析链接带 `is-unresolved` 且对照组不加标记）、段落（多行）
  节点里的链接同样可点且多行结构保留（`paragraph` 场景，对应 README 的对外承诺）、
  超长单行 20k 字必须接管并截断（`hugeline` 场景；若回归成「回落引擎」，该场景既会
  断言失败，也会因吃掉 `--virtual-time-budget` 而让后续探针集体失败），
  外加**十六个**探针：viewport（20 层深链大图必须 100% 缩放、整体内容居中，且重置缩放漂移
  ≤1px）、perf-box（121 节点性能模式大图 + 800×300 视口：`centerContentAtFullScale` 前后
  `.smm-node` 数均 < 总数 50%＝不装配全量 DOM、内容中心 = 画布中心 ±2px、数据层几何并集与
  DOM 全量盒尺寸差 ≤8px——钉住 K70 的打开路径性能契约；探针规模须取「刚过阈值的最小量」，
  641 节点版本会因分片渲染任务链推后其余探针的读取窗口而连锁失败）、anchor（SVG 节点补齐 `offsetWidth/offsetHeight`，弹窗锚定矩形
  `bottom/right` 必须为有限数，否则预览只会出现在上方）、inline（**方案 B**：
  自绘节点内容必须落在 foreignObject 内、引擎离屏克隆测宽与渲染宽度同源、`**重点**`
  渲染为 `<strong>`，且合成 click 后 `node_click` 的 `event.target` 就是锚点本体、
  `data-href` 为原始 linkpath——即 `view-wikilink.findAnchorInNode` 的前置判据；
  纯文本节点不得出现自绘锚点）、history（调宽写入通道：帧内 0 历史 / 0 保存调度、
  收尾各 1，等过 `addHistoryTime=100ms` 防抖窗口再读数）、handle（宽度手柄只留在
  自绘节点上）、undo（插入 → BACK 的 DOM 精确还原 × 节点实例同一性）、export（导出
  SVG `svgHTML` 里自绘根元素 / 锚点 / 轻标记元素必须带**内联样式**——引擎导出不注入
  插件 CSS，见 K53 ⑤）、scale（30 个自绘节点的大图：全部渲染、节点总数 67、离屏
  测宽元素恒为 1＝无测量垃圾累积）、perf（DOM 规模：同形状两棵 30 子节点地图，
  自绘侧 foreignObject 必须 30、引擎文本侧 0，**每节点元素预算**≤12（引擎文本）
  /≤20（自绘）；实测 8.2 vs 7.5/节点 ⇒ **自绘不比引擎文本更重**；另断言空 render
  构建器调用 0、改文本恰好 1——自绘成本模型按编辑数线性而非按帧，及
  `countTreeNodes` 对数据树可用=1000 节点）、image（图片尺寸回灌：生产同款流程
  「解析器不产 imageSize → ensureDefaultImageSizes 填默认 → 首帧 → 回灌」后渲染
  尺寸确实从默认值变到校正值，且对照组「不填默认值」整图不渲染）、count（性能
  模式阈值 1 强制开启的 151 节点地图：渲染树计数仍 151 / DOM 仅 11 组——
  `removeNodeWhenOutCanvas` 只摘 DOM、渲染树结构完整，状态栏计数不漏计）、edit（编辑成本基线：
  500 节点非性能模式图走生产路径 `setNodeText`，断言**布局落地恰好 1 次**；并记录 DOM 变更的类型
  拆分——空 render 对照实测「真变化 0 + 同值空写 2495」，证明引擎整树渲染无脏值比对，见 K58）、
  perf-switch（性能模式运行时切换：151 节点图 DOM 组数 **151 → 开启 11 → 关闭 151**，渲染树恒 151，
  见 K60）、render-eco（渲染经济：8 条动作的布局落地次数，包装函数恰好 1 次、开启性能模式 2 次为有意，
  见 K61）与 layout（六种布局各渲一遍：
  节点数、连线样式分派——曲线布局的连线必须全含 C/Q、四种直线布局必须零曲线——
  以及**根节点连线起点必须落在节点边缘**（从中心起画＝「斜戳」衔接回归）；
  连线路径统计须排除 `class="smm-node-shape"` 的节点形状路径，否则圆角命令会被
  误判成曲线；并断言引擎快捷键表非空且**不含 `Control+l`**——自动整理不得留默认热键）。
  **所有探针不做耗时断言**——脚本跑在 `--virtual-time-budget` 下，时钟被虚拟化；
  且引擎 `render()` 经 rAF 调度 ⇒ **计数类测量必须等 settle 再读**（同步读恒为 0
  是异步假象，不是「没发生」）。
  **运行注意（2026-09-20 实测，排查「打开卡顿」时踩到）**：① **不要与 CPU 密集任务并行跑**——
  同机并行 `npm test`（48 文件）时 perf / image / count / layout 探针出现 14 项假失败，
  单独复跑即全绿；虚拟时间只在**空闲**时推进，真实 CPU 被抢占会让「固定延时后读取」的探针
  读到未渲染完的中间态（`renderer.root` 为 null）。② **`--perf` 对环境负载敏感**：同一份
  代码曾连续 3 次失败、机器空闲后 1 次通过；失败归因务必先做「同页旧行为对照实验」（临时
  恢复旧实现跑同一命令），不要直接怀疑改动。③ 四个固定延时型探针（perf / image / count /
  layout）已于 **2026-09-21 复查完成同款加固**（`whenMapReady`：`node_tree_render_end` 事件 +
  `.smm-node` / `renderer.root` 轮询，上限 1200ms；image 回灌后的读取改为「轮询到目标宽或超时」）
  ——它们在负载机上曾**稳定**假失败（探针读到 `renderer.root` 为 null 的中间态），加固后同一
  环境全绿。失败时仍先按 ①② 排除环境（本轮已用「同页旧行为对照 + 加固后转绿」双重确证根因）。
  ④ 加固过程中的两个衍生修复（2026-09-21，同轮）：a) 读 DOM 结构 / 计数的探针必须用
  `whenMapReady` 的 **strict 模式**（只认 `node_tree_render_end`）——`.smm-node` / `renderer.root`
  兜底在「首个节点已创建」时就为真，此时调 `render()` 会把部分渲染变成全量重建（实测「空 render
  构建器调用 500 次」vs 期望 0）；b) perf 探针的构建器计数器**不得装在共享 options 上**（页内
  所有图共用同一 options 对象，邻图首帧会把 151 次调用记进本探针的空 render 窗口）——现装在本
  探针两张图的 options 浅拷贝上。**附**：本轮两次踩到「模板字符串内注释不得出现反引号」（K69 已
  记录该坑）——在 `buildEntrySource` 模板段内新增/修改注释后应立即扫描确认（解析模板段、找
  注释行中的反引号），不要等运行报 `SyntaxError` / `ReferenceError: node is not defined`。
  **真实耗时走另一通道（opt-in）**：`npm run verify:visual -- --perf [--perf-edits N]`——同一页跑
  「空跑 / 负载」两种入口、按**进程墙钟差**给真实成本（虚拟时钟下页内计时不可用，见 K63）。
  **负向自检已做**：`rootLineStartPositionKeepSameInCurve` 改回 false 报出 4 项失败；
  临时停用 `removeEngineShortcut` 报出「Ctrl+L 仍注册」1 项失败。
  这类「引擎运行时 DOM 装配」行为单测覆盖不到（单测只能验证数据字段）。
  无 Chrome 时跳过（`--require-chrome` 改为失败；`--keep` 保留临时目录；
  `--log-dir <dir>` 把环境信息、每次 Chrome 尝试的退出码与 stderr、完整 `--dump-dom`
  以及逐场景失败片段写进该目录——CI 靠它归档失败证据；
  `CHROME_PATH` 指定浏览器，路径不存在时自动回落到平台默认安装位置）。
- vitest 配置 `vitest.config.ts`：`obsidian` → `tests/mocks/obsidian.ts` alias（包仅有类型声明，无运行时 JS）。
  coverage 含 `src/**`（排除 `core/i18n`、`core/constants` 纯文案与常量表），vendor 为预打包产物不纳入。
- `tsconfig.json` 纳入 `src/`、`tests/`、`vendor/**/*.d.cts`，**以及三个发布相关配置
  （`eslint.config.mts` / `stylelint.config.mjs` / `manifest.json`）**；`npm run build` 先
  `tsc -noEmit` 类型检查全部。2026-10-04 为此开了 `checkJs`（否则 `.mjs` 只过语法
  不过是语义）与 `resolveJsonModule`（让 manifest 进项目文件集，JSON 语法错即 build 失败），
  并因此**退役了 ESLint 的 `allowDefaultProject`**——那三个文件不再靠「默认工程」兜底，
  `projectService: true` 直接命中 tsconfig。`scripts/**` 仍不在 include（纯 Node 工具链，
  已在 `globalIgnores`）；但 `eslint.config.mts` import 的 `scripts/plain-text-parser.mjs`
  会被 TS 沿 import 图带入，故该文件同样受 strict 约束（已加 `LineToken` typedef 收敛形状）。
  **边界**：`tsc` 只做 JSON **语法**校验，不做 manifest **schema** 校验——后者由
  `scripts/check-release-metadata.mjs` 与官方 scanner 负责，两条门禁互补。
- `moduleResolution` 用 **`bundler`**（2026-10-04 从 `node` 迁出）：TS 6 起 `node`(node10)
  报 deprecation、TS 7 移除，IDE 会持续报错。`bundler` 同样允许无扩展名相对 import
  （`./concurrency` 而非 `./concurrency.js`），故 400+ 处 import 无需改动，实测
  `tsc --noEmit` 0 错误。⚠ **不要用 `ignoreDeprecations` 静音**——项目锁定 TypeScript
  5.9.3，不接受 `"6.0"` 这个值，会报 `TS5103: Invalid value` 并真的阻断 `npm run build`。
  ⚠ 官方 `obsidian-sample-plugin` 仍是 `node`（模板未跟进），本项目主动迁移，勿因
  「与模板不一致」而改回。
- Lint 基线：`eslint-plugin-obsidianmd ^0.4.2`（与官方 eslint-plugin 仓库同版）。其
  `configs.recommended` 自包含（ESLint core + tseslint recommendedTypeChecked +
  全部 obsidianmd 规则 + sdl/import/depend/no-unsanitized 等三方插件 + package.json
  检查），**勿再展开 `tseslint.configs.recommended`**（plugin 重定义冲突）。
  项目自有覆盖：domain 零依赖边界（含「裸说明符」闭包，2026-09-17 加；用 `regex` 而非
  `group: ['*']`——后者按 `allowRelativePaths: true` 匹配，会误伤 `./md-meta` 这类组内相对引用）、
  统一解析入口强制（全部插件代码直调
  getAbstractFileByPath 拦截；豁免清单 = `src/links/links-resolve.ts`（**唯一真实收口点**）
  + `src/links/file-lookup.ts`（**陈旧豁免**，该文件已无此调用，待清理——见审计报告 V18），
  存在性检查特例 eslint-disable 注明理由）、模块依赖矩阵 zone（K51）、
  **官方 7 条依赖禁令**（axios / superagent / got / ofetch / ky / node-fetch / moment；
  2026-09-17 补回——模块边界块用的是 `{ patterns }` 形式，会**替换**而非合并官方那份
  legacy 数组形式的禁令，故必须自带）、`tests/**` 仅关两条 obsidianmd 规则
  （`no-global-this` 与 `rule-custom-message`）、
  system-open 的裸 `require` **未声明 globals**——它能通过只是因为 `isDesktopOnly: true`
  带进了 `globals.node`（**cwd 相关**，见 K43；属待补的 V18）……
  manifest.json 与 LICENSE 显式纳入 lint（官方 recommended 不自动拾取两者：
  validate-manifest 自挂 files 块 + ts parser；validate-license 依赖官方内置未导出的
  plain-text parser，等价实现在 scripts/plain-text-parser.mjs——该实现的唯一有意差异是
  **剥离行尾 `\r`**：官方只按 `\n` 切分，CRLF 检出（`core.autocrlf=true`）下残留的 `\r`
  会让版权行正则 `(.+)$` 匹配失败、规则静默失效，故加固之，勿改回逐字一致）。
- lint 的 cwd 依赖（manifest 读取）与 `no-unsupported-api` 的静默失效路径已上收至
  「关键约定」K43 / K44（工具链行为与其它承重配置同处维护，避免两处副本漂移）。
