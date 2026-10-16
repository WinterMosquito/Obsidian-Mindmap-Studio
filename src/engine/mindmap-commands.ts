/**
 * 引擎命令名表与快捷键防腐收口（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 本模块是**叶子**（不依赖 engine/ 内其它模块）：`mindmap.ts` / `mindmap-nodes` /
 * `mindmap-clipboard` 都引用它——若留在 `mindmap.ts` 会与拆分后的子模块**构成环**。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';

/**
 * 引擎命令名常量：execCommand 的魔法字符串收口于此。
 * 此前命令名散布 7 个文件共 18 处，拼写错误只能运行期发现、
 * 引擎升级时无法编译期定位影响面；统一经本表引用后：
 * - 属性名拼错编译期即报错；
 * - 引擎升级改命令名时只改本表并按引用定位调用点。
 */
export const ENGINE_COMMANDS = {
	/** 撤销 */
	BACK: 'BACK',
	/** 重做 */
	FORWARD: 'FORWARD',
	/**
	 * 清除激活节点（引擎内部命令，**不进历史**——引擎 `setData`/撤销/主题切换
	 * 都用它；换树后旧节点引用作废，留着会让后续操作作用在游离节点上）。
	 */
	CLEAR_ACTIVE_NODE: 'CLEAR_ACTIVE_NODE',
	/** 插入子节点（可 appointNodes 指定父节点与初始数据） */
	INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
	/** 插入同级节点 */
	INSERT_NODE: 'INSERT_NODE',
	/**
	 * 上移节点：与**前一兄弟**交换顺序（`Render.upNode`，同时改实例数组与
	 * `parent.nodeData.children` 后整树 render）。
	 * 只作用于**第一个激活节点**——调用方应显式传 `appointNode`（画布委托
	 * 路径可能处于多选态，激活列表顺序不可依赖）。
	 * 无节点 / 根节点 / 已在首位时**静默 no-op**（用户可见提示由调用方给）。
	 */
	UP_NODE: 'UP_NODE',
	/** 下移节点：与后一兄弟交换；语义与边界同 UP_NODE（`Render.downNode`） */
	DOWN_NODE: 'DOWN_NODE',
	/** 删除激活节点 */
	REMOVE_NODE: 'REMOVE_NODE',
	/** 重置布局（清除自由拖拽位置，不打乱 children 顺序） */
	RESET_LAYOUT: 'RESET_LAYOUT',
	/** 更新节点数据字段 */
	SET_NODE_DATA: 'SET_NODE_DATA',
	/** 设置节点超链接（空串清除） */
	SET_NODE_HYPERLINK: 'SET_NODE_HYPERLINK',
	/** 设置节点图片（SetNodeImageOptions） */
	SET_NODE_IMAGE: 'SET_NODE_IMAGE',
	/**
	 * 剪切选中节点（引擎已完成「顶层去重 + 文档序排序 + **过滤根节点** +
	 * 从父节点数据移除 + 清激活 + 重绘」，并经回调交回被剪的数据）。
	 * 回调参数形态 = `MindMapTreeNode[]`（见 cutSelectedSubtrees）。
	 */
	CUT_NODE: 'CUT_NODE',
	/** 批量插入子节点（appointNodes, childList；childList 内可带 children 多层） */
	INSERT_MULTI_CHILD_NODE: 'INSERT_MULTI_CHILD_NODE',
} as const;

/**
 * 引擎快捷键的**前置闸门**（`customCheckEnableShortcut`：**整份替换**引擎默认
 * 实现，见 vendor `KeyCommand.onKeydown`）。
 *
 * 为什么要自定义：默认实现只在 `target === document.body` 或命中引擎
 * `editNodeClassList` 时放行。而本插件的自绘内容里存在**可聚焦元素**——代码块
 * 复制 `<button>`、外链 `<a>`——点过它们之后焦点留在按钮上，Ctrl+C/X/V 与其余
 * 画布快捷键**静默失效**，直到点回画布空白（2026-10-15 审计，选项 A）。
 *
 * 放行集合 = 引擎默认（body + 编辑类元素；编辑框挂在 `document.body` 或
 * `customInnerElsAppendTo` 下，**不一定**在画布内）∪ **本引擎画布内**
 * （`canvasEl.contains`）。画布内放行是安全的：剪贴板三键经 `beforeShortcutRun`
 * 由插件接管（引擎那份被取消），其余快捷键本就以画布为操作对象。
 *
 * 放宽的**副作用**（2026-10-15 登记，勿再「顺手收紧」而不读这段）：焦点落在
 * 自绘内容里时，生效的不止剪贴板三键——`Control+a`（引擎全选）、`Control+z/y`
 * （撤销重做）、`Control+g` 等凡引擎注册且以画布为操作对象的快捷键一并由
 * 「静默失效」变为生效；其中 `Control+a` 会压掉浏览器的页面全选。这是**有意**
 * 取舍（自绘内容里的可聚焦元素不应让整张画布的快捷键失灵）。
 *
 * @param owner 引擎实例（懒引用：构造期尚为 null，keydown 时必然就位）；
 *   仅用于读 `editNodeClassList`——与默认实现同一来源，不另抄类名表
 */
export function shortcutGateAllows(
	owner: object | null,
	canvasEl: HTMLElement,
	event: KeyboardEvent,
): boolean {
	const target = event.target as Node | null;
	if (!target) {
		return true; // 无目标（合成事件）：按默认放行
	}
	if (target === document.body) {
		return true;
	}
	const editClasses = (owner as { editNodeClassList?: unknown } | null)
		?.editNodeClassList;
	// `nodeType === ELEMENT_NODE` 而非 `instanceof Element`：后者跨窗口（popout）
	// 会假阴；本文件又必须能脱离 obsidian 打包（verify:visual 的浏览器 IIFE），
	// 不能用官方的 `instanceOf` 助手——故用等价且跨窗口安全的判据
	if (target.nodeType === 1 && Array.isArray(editClasses)) {
		const element = target as Partial<Element>;
		if (
			editClasses.some(
				(cls) =>
					typeof cls === 'string' && element.classList?.contains(cls) === true,
			)
		) {
			return true;
		}
	}
	return canvasEl.contains(target);
}

/**
 * 移除引擎自带的默认热键（本插件不定义默认热键）。
 *
 * `keyCommand` 未入 d.cts（引擎运行时字段）：经结构性类型访问，缺省或换版本时
 * 静默跳过——与现有防腐口径一致，不做类型断言穿透声明面。
 */
export function removeEngineShortcut(mindMap: MindMap, shortcut: string): void {
	const keyCommand = (
		mindMap as unknown as {
			keyCommand?: { removeShortcut?: (key: string) => void };
		}
	).keyCommand;
	keyCommand?.removeShortcut?.(shortcut);
}
