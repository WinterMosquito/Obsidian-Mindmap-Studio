/**
 * 【一次性迁移，**0.4.0 删除**】旧属性值 → 新契约。
 *
 * 旧契约（≤0.3.x）：`Mindmap` 的值即布局（`LogicalStructure` /
 * `Mindmap` / `OrganizationStructure` / `CatalogOrganization` / `Timeline` /
 * `Fishbone`）。新契约：`Mindmap: Mindmap` 是启用信号，布局在独立键
 * `Mindmap Layout`（kebab 短 id）。
 *
 * ## 只改写「已是声明」的文件（2026-11-09 订正）
 *
 * 迁移的职责是**换写法**，不是**造声明**。故「启用键是否存在」是判定前提：
 * - 启用键里是旧布局值（`Mindmap: Timeline`）→ 改写成 `Mindmap: Mindmap`，
 *   旧值搬进布局键；
 * - 启用键已是 `Mindmap` → **只**补 / 归一布局键：
 *   - 无布局键 ⇒ 旧契约里 `Mindmap` 表示思维导图布局 → 写 `mindmap`；
 *   - 布局键是旧写法（`Mindmap Layout: LogicalStructure`）→ 归一成 kebab
 *     （保住用户选过的布局）；
 *   - 布局键是认不出的值（`toString` / 手写中文）→ **原样留着**，读侧
 *     fail-closed 回落默认布局（2026-11-08 实机：曾把它静默改成 `mindmap`）。
 * - **没有启用键** / 值是 `Markdown` / 未知值 → **不碰文件**：前者是普通笔记
 *   （只带一个布局键是删键后的残渣），后者是用户主动「切换为 Markdown」的
 *   结果。早期实现无论启用键如何都调 `setMindMapEnabled`，会把这两类文件
 *   静默变成导图（2026-11-09 实机）。
 *
 * 幂等：迁移后文件已有合法布局键，`legacyMigrationPlanOf` 的幂等闸直接返回 null；
 * 不存「已迁移」标记，0.4.0 删除本文件后无任何残留状态。按项目约定，**大版本更新
 * 时删去迁移逻辑**：0.4.0 删除本文件、`main.ts` 的调用、
 * `tests/legacy-mindmap-migration.test.ts` 与 `AGENTS.md` 两处清单
 * （见 `docs/agents/process.md`「迁移逻辑的生命周期」）。
 */
import type { App } from 'obsidian';
import {
	isMindMapEnabled,
	isMindMapLayoutKey,
	layoutPropertyValue,
	readLegacyLayout,
	readLegacyMindMapLayout,
	readMindMapLayout,
	setMindMapEnabled,
	setMindMapLayout,
} from '../domain/mindmap-property';

/** 启动后延迟多久执行迁移（让启动恢复先跑完；一次性逻辑，不占常量表） */
export const LEGACY_MIGRATION_DELAY_MS = 1500;

/**
 * 一个文件的迁移动作（`null` = 不动它）。
 *
 * 拆成「布局」与「是否改写启用键」两件事，是为了让「只归一布局写法」的文件
 * 不被顺手启用——见文件头的两类误伤。
 */
export interface LegacyMigrationPlan {
	/** 目标布局值（kebab 短 id，可直接写进 `Mindmap Layout`） */
	readonly layout: string;
	/** 启用键里是旧布局值：还要改写成启用信号 `Mindmap` */
	readonly enable: boolean;
}

/**
 * 该 frontmatter 的迁移动作；不需要迁移时返回 `null`。
 *
 * 判据复用 domain 的唯一表（`readLegacyLayout` 读启用键的旧布局值、
 * `readLegacyMindMapLayout` 读布局键的旧写法、`readMindMapLayout` 作幂等闸），
 * 不另抄一份归一或值表；纯函数（只读 frontmatter），供测试直测。
 */
export function legacyMigrationPlanOf(
	frontmatter: unknown,
): LegacyMigrationPlan | null {
	if (!frontmatter || typeof frontmatter !== 'object') {
		return null;
	}
	const record = frontmatter as Record<string, unknown>;
	// 幂等闸，**必须排在读旧值之前**：布局键已是合法 kebab ⇒ 视为新契约，一个字都不改。
	// 它同时挡掉「旧启用值 `Mindmap` + 合法布局」这一类（由 ⑤ 的兜底会把它判成
	// 待迁移，每轮启动都把用户选的布局重写成 `mindmap`）；也是「迁移只补写法、
	// 不改选择」的唯一落点。
	if (readMindMapLayout(record) !== null) {
		return null;
	}
	// ① 旧契约把布局写在启用键里（唯一一个键）：改写启用键 + 搬走布局。
	//    这一支优先于布局键——旧契约**不看**布局键，它若是脏值不构成用户选择。
	const legacyEnable = readLegacyLayout(record);
	if (legacyEnable !== null) {
		return { layout: layoutPropertyValue(legacyEnable), enable: true };
	}
	// ② 启用键不是启用信号（无键 / `Markdown` / 未知值）：不是导图，不碰。
	//    「只有布局键」的普通笔记也在这里被挡下（残渣不该长出启用键）。
	if (!isMindMapEnabled(record)) {
		return null;
	}
	// ③ 已是启用信号：只归一布局键的旧写法，不重写启用键。
	const legacyLayout = readLegacyMindMapLayout(record);
	if (legacyLayout !== null) {
		return { layout: layoutPropertyValue(legacyLayout), enable: false };
	}
	// ④ 布局键在、值认不出：原样留着（读侧 fail-closed 回落默认布局），
	//    不能拿「思维导图」覆盖用户手写的东西（2026-11-08 实机）。
	if (Object.keys(record).some(isMindMapLayoutKey)) {
		return null;
	}
	// ⑤ 启用信号 + 无布局键 ⇒ 旧契约的 `Mindmap`（＝思维导图布局）或手写启用
	//    文件。两者不可分，按旧语义补布局键（0.4.0 迁移删除后新建的
	//    `Mindmap: Mindmap` 不再被钉住布局，直接跟随「默认布局」设置）。
	return { layout: layoutPropertyValue('mindMap'), enable: false };
}

/**
 * 扫描全库并迁移旧属性值，返回**实际改写**的文件数。
 *
 * 单个文件失败不阻断（`console.warn` 留痕，下次启动重试）。只在启动后调用一次
 * （`main.ts` 的 `onLayoutReady`，延迟 {@link LEGACY_MIGRATION_DELAY_MS}）。
 * 缓存先行过滤，`processFrontMatter` 回调内再判一次（缓存可能滞后）。
 */
export async function migrateLegacyMindmapProperties(
	app: App,
): Promise<number> {
	let migrated = 0;
	for (const file of app.vault.getMarkdownFiles()) {
		const cached = app.metadataCache.getFileCache(file)?.frontmatter;
		if (legacyMigrationPlanOf(cached) === null) {
			continue;
		}
		try {
			let changed = false;
			await app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					// 权威判据（缓存可能滞后）：只迁移仍带旧值的文件
					const plan = legacyMigrationPlanOf(frontmatter);
					if (plan === null) {
						return;
					}
					if (plan.enable) {
						setMindMapEnabled(frontmatter);
					}
					setMindMapLayout(frontmatter, plan.layout);
					changed = true;
				},
			);
			if (changed) {
				migrated += 1;
			}
		} catch (error) {
			console.warn(
				'迁移旧思维导图属性失败，将在下次启动重试:',
				file.path,
				error,
			);
		}
	}
	return migrated;
}
