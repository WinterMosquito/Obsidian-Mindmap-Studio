/**
 * 会话级撤销 / 重做栈（纯逻辑，无 Obsidian / 引擎依赖）。
 *
 * ## 为什么需要它
 * Level B 之前，撤销链由引擎自带（每视图一条 `command.history`）。同一文件
 * 开两个视图时两条链互不相干：B 按 Ctrl+Z 撤不掉 A 的修改，A 保存后 B 还会
 * 因为引擎重建丢掉全部历史（2026-11-09 实机。
 *
 * 会话化后**一个文件只有一条时间线**：所有视图的编辑都提交到同一个栈，
 * 撤销 / 重做由它驱动、再把结果广播给每个视图。
 *
 * ## 与引擎历史的差异（有意）
 * 官方 Obsidian 的「共享撤销线」是把改动流复制给每个编辑器、各留一份历史
 * 镜像与游标——实测会漂移（A=5 / B=4），且在一侧撤销后另一侧再撤销会把
 * 撤销「撤回去」（`undo` 掉别人的 `undo`）。本实现用**单游标**：线性、
 * 可预测，Ctrl+Y 在任意视图都可用。差异登记见 K180。
 *
 * ## 语义
 * - `push` 截断当前游标之后的 redo 分支（与常规编辑器一致）；
 * - 与当前状态**逐字相同**的不入栈（引擎 `addHistory` 同口径，避免
 *   `seedInitialHistory` 这类「只读打开也发 data_change」的路径造出幽灵历史）；
 * - 超上限从**最旧**一端丢弃（`shift`），游标始终指向最后一项。
 */
export class SessionHistory<T> {
	/** 快照序列（按时间正序） */
	private states: T[] = [];
	/** 当前游标：指向 `states` 中「屏上此刻」的那一项 */
	private index = -1;

	/**
	 * @param limit 上限计算函数（按当前节点数现算，每次 push 取一次）。
	 *   缺省 500（引擎默认 `maxHistoryCount`）；生产侧传 `resolveHistoryLimit`。
	 */
	constructor(private readonly limit: () => number = () => 500) {}

	/** 重置为单条初始状态（会话首次加载 / 换文件） */
	reset(state: T): void {
		this.states = [state];
		this.index = 0;
	}

	/** 当前状态；尚未 reset 时为 null */
	get current(): T | null {
		return this.index >= 0 ? (this.states[this.index] ?? null) : null;
	}

	/** 快照条数（含初始态） */
	get length(): number {
		return this.states.length;
	}

	/** 当前游标（0 起） */
	get position(): number {
		return this.index;
	}

	canUndo(): boolean {
		return this.index > 0;
	}

	canRedo(): boolean {
		return this.index >= 0 && this.index + 1 < this.states.length;
	}

	/**
	 * 追加一条快照（截断 redo 分支）。
	 *
	 * @param state  新状态（调用方保证是深拷贝，之后不再就地修改）
	 * @param equals 判等；与当前状态相同则不入栈
	 * @param knownDistinct 调用方**已经**证明它与当前状态不同（省一次判等：
	 *   大图一次 `sameTree` 是两份整树 JSON，能省则省）
	 * @returns 是否真的入栈
	 */
	push(
		state: T,
		equals: (left: T, right: T) => boolean,
		knownDistinct = false,
	): boolean {
		const current = this.current;
		if (!knownDistinct && current !== null && equals(current, state)) {
			return false;
		}
		this.states = this.states.slice(0, this.index + 1);
		this.states.push(state);
		const max = Math.max(1, this.limit());
		while (this.states.length > max) {
			this.states.shift();
		}
		this.index = this.states.length - 1;
		return true;
	}

	/**
	 * **就地改写当前快照**（不新增历史、不动游标）。
	 *
	 * 用途只有一个：编辑之后的**派生归一**——层级语法守卫在引擎里就地改 md
	 * 字段（不进撤销栈，用户的 Ctrl+Z 仍一步撤掉「拖拽 + 换算」），权威树
	 * 必须跟着改，否则保存写的是归一前的快照（2026-11-09 实机：守卫把
	 * `- 列表乙` 升成 `# 列表乙`，屏上正确、文件没写，重开又变回列表项，
	 * 树形与屏上不一致）。`push` 会多一条历史（Ctrl+Z 要按两次），故单列。
	 *
	 * @returns 是否真的改写（尚未 reset 时不成立）
	 */
	replaceCurrent(state: T): boolean {
		if (this.index < 0) {
			return false;
		}
		this.states[this.index] = state;
		return true;
	}

	/** 后退一步；已在起点返回 null（不改状态） */
	undo(): T | null {
		if (!this.canUndo()) {
			return null;
		}
		this.index--;
		return this.states[this.index] ?? null;
	}

	/** 前进一步；已在末端返回 null（不改状态） */
	redo(): T | null {
		if (!this.canRedo()) {
			return null;
		}
		this.index++;
		return this.states[this.index] ?? null;
	}
}
