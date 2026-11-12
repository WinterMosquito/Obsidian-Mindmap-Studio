/**
 * 节点级配色：右键「配色」→ 某个颜色 → 把 `%%#hex%%` 写进该节点的 Markdown 行。
 *
 * ## 为什么走「原文提交」而不是直接改样式
 * 颜色只存在于正文，插件侧样式是派生结果（`engine/mindmap-colors`）。所以改色 =
 * **改那一行原文**，交给既有编辑通道 `applyRawNodeContent`：重解析 → 样式同步 →
 * 保存调度 → 提交通知（K108）全部复用，不另开写盘/渲染管线。
 *
 * ## 三条口径
 * - **多选只写最上层**：颜色沿子树继承，给被包含的子孙各写一条只会堆重复注释
 *   （作用范围为「仅本节点」时不折叠——那时每个被选中的节点都要有自己的指令）；
 * - **重复改色是替换**：`setColorDirective` 复用解析侧的保护区语义；
 * - **「默认」= 回到整篇配色**（2026-10-27 用户裁决）：不再看祖先的节点色。落地
 *   有两种、效果等价——上层还在染色就写哨兵 `%%none%%` 挡住继承，否则直接删指令
 *   （不给文件添注释）。**不能一律删指令**：那正是旧语义的坑（删完照旧继承父色）；
 * - **撤色时顺手清掉无主哨兵**（2026-11-04）：本支的色源一没，后代里当初只为挡它
 *   的 `%%none%%` 就再没有可挡的东西（`domain/color.orphanSentinels` 判定）；
 * - **作用范围由设置项决定**（2026-11-06）：`nodeColorScope` 为 `subtree`（出厂）
 *   时只给选中节点写指令、后代靠继承；为 `node` 时**再给直接子节点补一条
 *   `%%none%%`**，让颜色停在这一层（`domain/color.scopeSentinels` 判定落点）。
 *   差别主要落在**正文写法**上；渲染侧只额外读它决定**连接线**是否跟着节点色
 *   （填充 / 描边 / 文字仍恒由正文继承决定，见 `core/constants.NODE_COLOR_SCOPE_OPTIONS`）。
 *
 * 落点：无指令时追加到末行行尾；末行是块级语法行（围栏定界符 / 表格行）时另起
 * 一行——缘由见 `node-inline-tokenize.appendColorDirective`。
 */
import { Notice } from 'obsidian';
import {
	branchLayerOf,
	getRenderRoot,
	paletteNodeColor,
	topMostNodes,
} from '../engine/mindmap';
import type { PaletteId } from '../core/constants';
import {
	isNodeOnlyColorScope,
	PALETTE_OPTIONS,
} from '../core/constants';
import { t, tf, type TranslationKey } from '../core/i18n';
import type { MindMapNode } from '../core/engine-types';
import type { MdNodeData } from '../core/node-data';
import {
	COLOR_DIRECTIVE_NONE,
	inheritedColorOf,
	orphanSentinels,
	scopeSentinels,
} from '../domain/color';
import { splitDirectiveTail } from '../domain/directive';
import { nodeInlineSource } from '../domain/md-meta';
import { walkTree } from '../domain/tree';
import { composeNodeContent } from '../markdown/md-serialize';
import { createButton, openFormModal } from '../ui/modal-common';
import { applyRawNodeContents } from './node-inline-editor';
import { colorDirectiveOf, setColorDirective } from './node-inline-tokenize';
import { refreshMiniMapAfterRender } from './view-minimap';
import type { MindMapViewContext } from './view-context';

/** 菜单里的一个「颜色」选项：调色板的 id + 它对应的填充色 + 文案键 */
export interface NodeColorOption {
	value: PaletteId;
	label: TranslationKey;
	/**
	 * 写进 Markdown 的十六进制 = `paletteNodeColor`（`NODE_COLORS[id].fill`，不随
	 * 明暗变），也是**画布上的填充色本体**（2026-11-04 起直出，见
	 * `domain/color.nodeColorScale`）；勾选态与正文指令做等值比较，所以这里必须是
	 * **写进文件的那一个值**。配套的线条 / 描边色由 `nodeLineColorOf` 反查。
	 */
	color: string;
}

/**
 * 节点配色菜单的选项表（顺序＝菜单顺序）。
 *
 * 颜色值取 `paletteNodeColor`（`NODE_COLORS[id].fill`），**原样落在填充上**
 * （2026-11-04 用户裁决：不再由 `nodeColorScale` 洗淡成浅底）。节点颜色不随明暗
 * 切换（写进文件的就是用户选的色）。
 *
 * **不含「默认」配色**（即那枚蓝）：首项「默认」已经表达「跟随整篇」，
 * 再列一枚蓝色会让节点菜单比空白右键的整篇菜单多一项（2026-10-27 用户裁决
 * 「两处样式一致」）。存量文件里若已写着 `%%#4a90d9%%`，它按**自定义色**显示
 * （勾在「自定义」项上），语义正确。
 *
 * **惰性构建**（首次建菜单时才算）：模块导入期不触碰引擎模块——大量测试把
 * `engine/mindmap` 整体桩掉，导入期取色会让「只想加载视图」的用例连模块都起不来。
 */
let cachedOptions: readonly NodeColorOption[] | null = null;

export function nodeColorOptions(): readonly NodeColorOption[] {
	cachedOptions ??= PALETTE_OPTIONS.filter(
		(option) => option.value !== 'default',
	).map((option) => ({
		value: option.value,
		label: `nodeColor.${option.value}` as TranslationKey,
		color: paletteNodeColor(option.value),
	}));
	return cachedOptions;
}

/** 节点**自身**的配色指令（`#rrggbb` / 哨兵 `none` / 未写则 null）；内部用 */
function nodeColorOf(node: MindMapNode): string | null {
	const data = node.getData?.() as MdNodeData | null | undefined;
	if (!data) {
		return null;
	}
	return colorDirectiveOf(nodeInlineSource(data));
}

/**
 * 节点**生效**的颜色：自身指令 → 最近祖先指令 → null（＝跟随整篇配色）。
 *
 * 菜单的勾选态用它，不用 `nodeColorOf`：颜色沿子树继承，子节点视觉上已是琥珀、
 * 自身却没有指令——只读自身会让菜单勾在「默认」上，而屏上明明是一片彩色。
 * 哨兵 `none` 原样返回（`'none'` 非空，不会继续往上找），菜单把它与 null 一起
 * 算作「默认」（见 `addNodeColorMenu` 的 `isDefault`）。
 */
export function effectiveNodeColorOf(node: MindMapNode): string | null {
	return nodeColorOf(node) ?? inheritedColorOf(node, nodeColorOf);
}

/**
 * 「把该节点的配色指令写成 `directive`（null ＝ 整条删掉）」之后的原文；
 * 无可写 / 无变化则 null（调用方据此跳过该节点）。
 *
 * 上色、落哨兵、撤色三条路径共用它：三者只差一个 `directive`，各自抄一遍
 * 「剥尾部 → 改内容 → 贴回」就会让 `%%rel%%` 的落点判定出现第二份。
 *
 * **必须先剥尾部**：`%%#hex%%` 不能落在整行都是 `%%id%%` / `%%rel%%` 的指令行上
 * （那会让整行不再是指令行，该节点的联系全部消失）。
 * 删完只剩空白（整行就只有指令）时不写——那会把节点内容清空。
 */
function rawWithColorDirective(
	view: MindMapViewContext,
	node: MindMapNode,
	directive: string | null,
): string | null {
	const data = node.getData() as MdNodeData;
	// 原文 = 「下次写盘会写出的内容」的唯一来源（未编辑 = mdRaw，已编辑 = 合成）
	const { content, tail } = splitDirectiveTail(
		composeNodeContent(data, view.app),
	);
	// 标题节点的指令写**独立行**（K174）：行尾会被 heading 缓存算进标题文本，
	// `[[#标题]]` 失效。其它节点仍行内（避免每次上色都多一行 diff）。
	const next = setColorDirective(content, directive, {
		ownLine: data.mdType === 'heading',
	});
	if (next === content || next.trim() === '') {
		return null;
	}
	return tail ? `${next}\n${tail}` : next;
}

/**
 * 「仅本节点」作用域：把阻断继承的哨兵并进**同一批**写入（判定在
 * `domain/color.scopeSentinels`，这里只负责落笔）。
 *
 * 两个上色入口（节点右键 / 按分支自动上色）共用它——作用范围的定义只有一份，
 * 否则同一个设置会在其中一处静默失效。
 */
function appendScopeSentinels(
	view: MindMapViewContext,
	entries: { node: MindMapNode; raw: string }[],
	roots: readonly MindMapNode[],
): void {
	for (const blocker of scopeSentinels(roots, nodeColorOf, new Set(roots))) {
		const raw = rawWithColorDirective(view, blocker, COLOR_DIRECTIVE_NONE);
		if (raw !== null) {
			entries.push({ node: blocker, raw });
		}
	}
}

/**
 * 给这些节点（及各自子树）上色。
 *
 * `color`：`#rrggbb` 的**填充色**（原样落地，`nodeColorScale` 只算文字色）；
 * `null` ＝「默认」，即回到**整篇配色**。
 * 「默认」按节点分别落地（用户无感，结果等价）：上层还在染色就写哨兵
 * `%%none%%` 挡住继承，否则直接删自身指令（不给文件添注释）。
 *
 * 只处理**最上层**的非根节点：根节点没有正文行（写进去会当场丢失，还会撞上
 * 「中心主题改名文件」），它的颜色由整篇配色决定；被包含的子孙靠继承拿到颜色。
 * **作用范围为「仅本节点」时不折叠**：那时每个被选中的节点都得有自己的指令
 * （折叠会把「父子同选」里的子节点变成一条哨兵）。
 *
 * 重复点同一个颜色不写盘也不渲染：原文没变就跳过。
 *
 * **一次批量落地**（2026-11-06）：多选上色只改原文注释、不改结构，故与
 * `applyBranchColors` 同一条通道——`applyRawNodeContents` 让渲染 / 存盘 / 历史
 * 各只发生一次（此前逐节点调 `applyRawNodeContent`，选 10 个节点 = 整树重渲 10 次，
 * 大图上就是十几秒冻结）。阻断继承的哨兵也在**同一批**里（见 `scopeSentinels`）。
 *
 * **撤色时的无主哨兵也在这一批里**（2026-11-06 二次收敛）：清理的判据由
 * `orphanSentinels` 的 `rootDirective` 显式告知（「本节点即将变成什么」），于是
 * 不必先落地主改动再读回自己写的数据——一次改色只付**一轮**整树重渲，
 * 历史也不再依赖 `addHistory` 的 100ms 防抖去合并两批。
 */
export function applyNodeColor(
	view: MindMapViewContext,
	nodes: readonly MindMapNode[],
	color: string | null,
): void {
	if (!view.mindMap || nodes.length === 0) {
		return;
	}
	const candidate = nodes.filter((node) => !node.isRoot);
	if (candidate.length === 0) {
		return;
	}
	/**
	 * 「仅本节点」＝上色后还要给子节点补哨兵。只在**上色**时判——「默认」按节点
	 * 各判各的（有没有上层色源），与作用范围无关。
	 */
	const nodeOnly =
		color !== null &&
		isNodeOnlyColorScope(view.plugin.settings.nodeColorScope);
	const targets = nodeOnly
		? // 父子同选时两个都要有自己的指令；Set 只去重、不折叠层级
			[...new Set(candidate)]
		: topMostNodes(candidate);
	/** 一次批量落地的全部写入（主改动 + 阻断继承的哨兵 + 无主哨兵清理） */
	const entries: { node: MindMapNode; raw: string }[] = [];
	/** 「默认」时记下「本节点即将没有自身色源」——子孙哨兵的判据跟着它走 */
	const cleared: { node: MindMapNode; directive: string | null }[] = [];
	for (const node of targets) {
		const target =
			color ??
			(inheritedColorOf(node, nodeColorOf) ? COLOR_DIRECTIVE_NONE : null);
		const raw = rawWithColorDirective(view, node, target);
		if (raw === null) {
			continue;
		}
		entries.push({ node, raw });
		if (!color) {
			cleared.push({ node, directive: target });
		}
	}
	if (nodeOnly) {
		// 让颜色停在选中节点这一层：直接子节点各写一条哨兵（只补一层，再往下靠
		// 哨兵自己把 null 传下去）
		appendScopeSentinels(view, entries, targets);
	}
	if (entries.length === 0) {
		return;
	}
	// 撤色把本支的色源拿掉了：后代里当初只为挡它的 `%%none%%` 已无意义。只在
	// 「默认」（`color === null`）时清——换成某个颜色时那些哨兵挡的正是新颜色，
	// 删掉会让子孙反而吃到它（判据在 `orphanSentinels` 里，这里只给「即将写入的
	// 指令」，不读实时数据、不另判一次）。
	if (!color) {
		for (const { node, directive } of cleared) {
			for (const orphan of orphanSentinels(node, nodeColorOf, directive)) {
				const raw = rawWithColorDirective(view, orphan, null);
				if (raw !== null) {
					entries.push({ node: orphan, raw });
				}
			}
		}
	}
	// 跳过后置编排：只往行尾加注释，不改标题、不产生新链接（同 applyBranchColors）
	applyRawNodeContents(view, entries, { afterCommit: false });
	// 必须等渲染落地：本函数只改原文，节点 data 的 fillColor / borderColor 要等
	// `node_tree_render_end` 里的同步才写入；当场采样只能画出一张没变化的图，
	// 还把 30s 窗口白耗掉（K147）。
	//
	// **只清哨兵的那一轮不存在**：`entries` 非空才会走到这里（早退在上方），
	// 而「节点本无指令、只是后代挂着无意义 `%%none%%`」会在早退处返回、**故意
	// 不动**——那一轮什么都没变，顺手改写用户没选中的子节点属于越权。
	refreshMiniMapAfterRender(view);
}

/** 这篇文档有没有可分色的分支层（`view-context-menu` 据此决定是否上菜单项） */
export function hasBranchLayer(view: MindMapViewContext): boolean {
	// `branchLayerOf` 只返回「0 个」或「≥2 个」（分支层按定义有多个兄弟），
	// 故判空即判多，不必再比 1
	return branchLayerOf(getRenderRoot(view.mindMap)?.children ?? []).length > 0;
}

/**
 * 按分支自动上色：把节点配色菜单里的**填充色**依次写进每个分支节点的正文。
 *
 * 为什么写文件而不是直接改样式（2026-11-05）：
 * - 颜色只存在于正文是既有契约——勾选态、小地图、导出、撤销、跨端重开全都
 *   自动一致；走渲染期注入就得再解释「勾在默认上但屏上是彩色」。
 * - 写作仍是 `applyRawNodeContents` 批量通道：一次渲染 / 一次存盘 / 一条历史。
 *
 * 已有指令的分支会被**覆盖**（这是显式动作，`Ctrl+Z` 可整体回退）；联系指令行
 * 原样贴回，不会把 `%%rel%%` 那行的语义弄丢。**子节点已有的指令（含哨兵
 * `%%none%%`）一律不改写**：那是用户先前显式点的「默认」，现在挡的是新色源，
 * 属于「后代重新染色的分支整支保留」的同一条口径（见 `domain/color.orphanSentinels`）；
 * `node` 档补哨兵时也跳过它们（判据在 `scopeSentinels`），只给没有自身指令的
 * 直接子节点补。
 *
 * **跟随设置项 `nodeColorScope`**（2026-11-06）：这是「给节点上色」的第二个入口，
 * 作用范围的定义只有一份——`node` 档同样给每个分支的直接子节点补哨兵，否则同一
 * 个设置在这处静默不生效，用户只会看到「设置没管到这里」。
 */
export function applyBranchColors(view: MindMapViewContext): void {
	const branches = branchLayerOf(getRenderRoot(view.mindMap)?.children ?? []);
	const options = nodeColorOptions();
	if (branches.length === 0 || options.length === 0) {
		return;
	}
	const nodeOnly = isNodeOnlyColorScope(view.plugin.settings.nodeColorScope);
	const entries: { node: MindMapNode; raw: string }[] = [];
	for (const [index, node] of branches.entries()) {
		const color = options[index % options.length]!.color;
		const raw = rawWithColorDirective(view, node, color);
		if (raw !== null) {
			entries.push({ node, raw });
		}
	}
	if (nodeOnly) {
		appendScopeSentinels(view, entries, branches);
	}
	if (entries.length === 0) {
		return;
	}
	// 跳过后置编排：只往行尾加注释，不改标题、不产生新链接
	applyRawNodeContents(view, entries, { afterCommit: false });
	refreshMiniMapAfterRender(view);
}

/** 一次「清理旧哨兵」会话：`path` 用于落地前确认视图仍停在同一文件 */
export interface ColorSentinelSession {
	readonly view: MindMapViewContext;
	readonly path: string;
	readonly count: number;
}

/**
 * 扫描一棵渲染树里带**自身** `%%none%%` 的节点（清理判定的唯一实现）。
 *
 * 用 `nodeInlineSource`（渲染同源：未编辑读 `mdRaw`、已编辑读 `text`），不做第二份
 * 「哪行是指令」的判断。整行只剩这条指令的节点**不清**——删完会把节点内容清空
 * （与 `rawWithColorDirective` 同口径）。
 */
function colorSentinelEntries(
	view: MindMapViewContext,
): { node: MindMapNode; raw: string }[] {
	const root = getRenderRoot(view.mindMap);
	if (!root) {
		return [];
	}
	const entries: { node: MindMapNode; raw: string }[] = [];
	walkTree(root, (node) => {
		const data = node.getData?.() as MdNodeData | null | undefined;
		if (!data) {
			return;
		}
		const source = nodeInlineSource(data);
		if (colorDirectiveOf(source) !== COLOR_DIRECTIVE_NONE) {
			return;
		}
		const raw = setColorDirective(source, null);
		if (raw === source || raw.trim() === '') {
			return;
		}
		entries.push({ node, raw });
	});
	return entries;
}

/**
 * 扫描已打开导图里的旧 `%%none%%`（K175）：返回非空会话，供弹窗文案与落地共用。
 *
 * 只收**有文件、引擎已建**的视图——改写必须经活引擎的原文通道
 * （`applyRawNodeContents`），数据快照换不回节点实例。
 *
 * **按路径去重**（2026-11-09 实机，Level B 交互）：同一文件允许多视图，它们共享
 * 一份会话树 —— 逐个视图扫描会把同一个 `%%none%%` 算成 N 处（文案报「4 个导图
 * 4 处」而实际只有 1 个文件 1 处），落地时还会对同一棵树重复 `applyRawNodeContents`
 * N 次（N 次重渲 + N 条历史）。这里一个文件只留一个代表视图。
 */
export function collectColorSentinelSessions(
	views: readonly MindMapViewContext[],
): ColorSentinelSession[] {
	const sessions: ColorSentinelSession[] = [];
	const seen = new Set<string>();
	for (const view of views) {
		const path = view.file?.path;
		if (!path || !view.mindMap || seen.has(path)) {
			continue;
		}
		seen.add(path);
		const count = colorSentinelEntries(view).length;
		if (count > 0) {
			sessions.push({ view, path, count });
		}
	}
	return sessions;
}

/**
 * 落地清理：每个会话**重新扫描**（弹窗期间别的视图可能已改文件），并确认视图仍停在
 * 同一文件（切走了就不能把新文件的内容当成旧文件的清理结果）。
 *
 * 每棵树一次 `applyRawNodeContents` —— 一次渲染 / 一次存盘 / 一条撤销。
 * @returns 实际删除的处数
 */
export function applyColorSentinelCleanup(
	sessions: readonly ColorSentinelSession[],
): number {
	let removed = 0;
	for (const session of sessions) {
		const { view, path } = session;
		if (view.file?.path !== path) {
			continue;
		}
		const entries = colorSentinelEntries(view);
		if (entries.length === 0) {
			continue;
		}
		applyRawNodeContents(view, entries, { afterCommit: false });
		removed += entries.length;
	}
	return removed;
}

/**
 * 从「仅本节点」切回「含子节点」后的**一次性询问**（K175）：是否清掉已打开导图里
 * 旧的 `%%none%%`。
 *
 * 为什么问而不是自动清：哨兵是**正文内容**（换库、发给别人同样生效），其中既有上次
 * 「仅本节点」上色的产物，也有用户显式点「默认」写下的；删掉会让这些节点重新继承
 * 上层颜色。故必须由用户确认，且只动**当前打开**的文件（没有视图就无法经原文通道
 * 安全改写）。
 */
export async function offerColorSentinelCleanup(
	views: readonly MindMapViewContext[],
): Promise<void> {
	const sessions = collectColorSentinelSessions(views);
	if (sessions.length === 0) {
		return;
	}
	const lang = sessions[0]!.view.lang;
	const count = sessions.reduce((sum, session) => sum + session.count, 0);
	const confirmed = await openFormModal<boolean>({
		app: sessions[0]!.view.app,
		title: t(lang, 'modal.colorScopeCleanup.title'),
		rootCls: 'mindmap-color-scope-cleanup',
		build: ({ root, submit }) => {
			// `\n` 分段：弹窗正文默认把换行折叠成空格（设置页那套 `pre-line` 只管设置页）
			for (const line of tf(lang, 'modal.colorScopeCleanup.body', {
				files: sessions.length,
				count,
			}).split('\n')) {
				root.createEl('p', { text: line });
			}
			const buttons = root.createDiv();
			buttons.addClass(
				'mindmap-modal-action-row',
				'mindmap-modal-action-row--mt',
			);
			createButton(
				buttons,
				t(lang, 'modal.colorScopeCleanup.keep'),
				'secondary',
				() => submit(false),
			);
			createButton(
				buttons,
				t(lang, 'modal.colorScopeCleanup.confirm'),
				'primary',
				() => submit(true),
			);
		},
	});
	if (confirmed !== true) {
		return;
	}
	const removed = applyColorSentinelCleanup(sessions);
	if (removed > 0) {
		new Notice(tf(lang, 'colorScope.cleanupDone', { count: removed }));
	}
}
