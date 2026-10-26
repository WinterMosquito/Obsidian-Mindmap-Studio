/**
 * `scripts/check-gates.mjs` 的最小类型声明（仅供 `tests/check-gates.test.ts` 直测）。
 *
 * 脚本是给 `node` 直接跑的 `.mjs`（不参与打包），因此不迁 TS；声明只覆盖测试
 * 依赖的两个纯函数，避免把脚本内部形态阔进公共类型面。新增导出时同步这里。
 */
export interface GatePlan {
	args: string[];
	label: string;
	why: string;
}

export interface SkippedGate {
	label: string;
	note: string;
}

export interface GatesPlan {
	gates: GatePlan[];
	skipped: SkippedGate[];
}

export interface ExemptionRow {
	declared: number;
	stale: boolean;
}

/**
 * 变更集 → 门禁清单。
 *
 * @param changed git 变更集（posix 相对路径）；`null` = 不可读 ⇒ 附加门禁保守全跑
 * @param options.all 不看变更集，附加门禁全跑
 */
export function buildPlan(
	changed: string[] | null,
	options?: { all?: boolean },
): GatesPlan;

/** 解析一张豁免表：路径 → { 登记行数, 文件是否已不存在 } */
export function parseExemptionRows(text: string): Map<string, ExemptionRow>;
