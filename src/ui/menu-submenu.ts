/**
 * 右键菜单的**级联子菜单**与「自定义颜色…」项（全仓唯一出处）。
 *
 * 四处菜单共用（布局 / 整篇配色 / 节点配色 / 联系线配色）：父项外观、原生级联的
 * 私有触点、无法级联时的回退、独占弹出与颜色弹窗的调用形态都只在这里写一遍。
 * 放 `ui/` 而不是 `features/`：`features/view-node-relation` 也要用它，而
 * `features/view-context-menu` 反过来依赖 `view-node-relation`（建边入口）——
 * 留在上层会成环（`tests/module-boundaries.test.ts` 断言组内无环）。
 */
import {
	Menu,
	type App,
	type MenuItem,
	type MenuPositionDef,
} from 'obsidian';
import { t, type Language, type TranslationKey } from '../core/i18n';
import { openColorInputModal } from './modal-color';

/**
 * 同一宿主（视图）同一时刻**只保留一个菜单**（K155）。
 *
 * 为什么必须自己管：Obsidian 只在自己收到 `mousedown` 时关闭已弹出的菜单，而引擎
 * 在节点上把 `mousedown` / `contextmenu` 都 `stopPropagation` 了（拖拽与右键语义）
 * ⇒ 在节点上连续右键时旧菜单**永不关闭**，新菜单直接叠上去（2026-10-31 实机：
 * 两次右键 = 两个一模一样的菜单，位置几乎重合）。菜单是我们 `new Menu()` 出来的，
 * 收场也只能由我们负责——引擎不会替我们关。
 */
const openMenus = new WeakMap<object, Menu>();

/**
 * 级联子菜单登记（父 → 子）。
 *
 * 子菜单是**独立的** `Menu`（自己的 `.menu` DOM），父菜单隐藏时未必连带收掉；
 * 反正每次右键都会重建菜单，这里一并关掉最省心（关已关过的是 no-op）。
 */
const cascaded = new WeakMap<Menu, Menu[]>();

/** 登记一个级联子菜单（父菜单隐藏时随它一起收） */
function trackCascade(parent: Menu, submenu: Menu): void {
	const subs = cascaded.get(parent);
	if (subs) {
		subs.push(submenu);
		return;
	}
	cascaded.set(parent, [submenu]);
}

/** 关掉整棵菜单（父 + 它的级联子菜单） */
function hideMenuTree(menu: Menu): void {
	for (const sub of cascaded.get(menu) ?? []) {
		hideMenuTree(sub);
	}
	menu.hide();
}

/** 关闭该宿主当前打开着的菜单（没有则 no-op；引擎重建 / Esc / 画布按下时调） */
export function closeOpenMenu(host: object): void {
	const menu = openMenus.get(host);
	openMenus.delete(host);
	if (menu) {
		hideMenuTree(menu);
	}
}

/**
 * 弹出菜单（**独占**：先关掉该宿主上一个菜单）。
 *
 * 替代裸的 `menu.showAtPosition(...)`：引擎把触发右键的那次 `mousedown` 吞掉了，
 * 宿主不会再替我们关闭旧菜单（见文件头）。
 */
export function showExclusiveMenu(
	host: object,
	menu: Menu,
	position: MenuPositionDef,
): void {
	const previous = openMenus.get(host);
	if (previous && previous !== menu) {
		hideMenuTree(previous);
	}
	openMenus.set(host, menu);
	// 用户点了条目 / 宿主自己关掉时同步记账（否则下次会把已关的菜单再关一遍）
	menu.onHide(() => {
		if (openMenus.get(host) === menu) {
			openMenus.delete(host);
		}
	});
	menu.showAtPosition(position);
}

/**
 * 原生级联子菜单的**私有触点**（规则 9 登记；唯一出处）。
 *
 * `MenuItem.setSubmenu` **不在** `obsidian.d.ts`，但 Obsidian 1.14.4 运行时确实
 * 有（主程序源码 `setSubmenu` + 实机核对）。真实语义：
 * - **无参调用**：内部 `new Menu()`、给条目加 `has-submenu` 与右向箭头，
 *   返回那个菜单——要往里 `addItem` 的是**返回值**；
 * - 展开与定位由宿主 `Menu` 负责：悬停约 250ms（或点击）展开，位置贴住父项右缘；
 * - 手机上改为整页切换（`isPhone` 分支），同样不需要我们干预。
 *
 * ⚠ 2026-10-23 曾记「挂上 setSubmenu 也不展开」——那是**用法错误**：把它当 setter
 * 传了自建 Menu（参数被忽略），条目加到了没人引用的那个菜单上。2026-10-27 订正。
 */
function createNativeSubmenu(item: MenuItem): Menu | null {
	const factory = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu;
	if (typeof factory !== 'function') {
		return null;
	}
	try {
		return factory.call(item);
	} catch (error) {
		console.warn('创建原生子菜单失败，回退为点击弹出', error);
		return null;
	}
}

/**
 * 追加一个**二级菜单**（「布局」「配色」）。
 *
 * 优先用宿主原生级联：条目右侧出现箭头，悬停/点击由宿主展开并贴住父项——与
 * Obsidian 自带菜单（如「切换编辑器」）同一套观感；运行时缺该方法时**回退**为
 * 「点击父项 → 在光标处弹出独立菜单」（键盘触发用条目矩形当锚点）。
 *
 * 勾选态一律**现算**（由调用方从当前生效值取），不缓存第二份状态。
 */
export function addCascadingMenu(
	menu: Menu,
	lang: Language,
	spec: {
		title: TranslationKey;
		icon: string;
		build: (submenu: Menu) => void;
	},
): void {
	menu.addItem((item) => {
		item.setTitle(t(lang, spec.title)).setIcon(spec.icon);
		const nativeSubmenu = createNativeSubmenu(item);
		if (nativeSubmenu) {
			trackCascade(menu, nativeSubmenu);
			spec.build(nativeSubmenu);
			return item;
		}
		// 回退：宿主没有原生级联时，点击后在光标处弹出（只用 d.ts 声明的 API）
		const submenu = new Menu();
		trackCascade(menu, submenu);
		spec.build(submenu);
		item.onClick((evt) => {
			if ('clientX' in evt) {
				submenu.showAtMouseEvent(evt);
				return;
			}
			// 键盘触发没有鼠标坐标：用**被激活的菜单项**矩形当锚点
			//（弹到 0,0 会跑到屏幕左上角，与操作位置脱节）
			const target = evt.target;
			const rect =
				target instanceof HTMLElement ? target.getBoundingClientRect() : null;
			submenu.showAtPosition(
				rect ? { x: rect.left, y: rect.bottom } : { x: 0, y: 0 },
			);
		});
		return item;
	});
}

/**
 * 「自定义…」项（整篇配色 / 节点配色 / 联系线配色共用）：分隔线 + 颜色弹窗 + 写回。
 *
 * 三处唯一的差别是「写到哪里」（`onPick`），输入与校验完全一致，勿各写一份。
 * `onPick` 只在用户提交了**合法颜色**时被调用：取消 / 关闭不回调，调用方不必判空。
 *
 * @param checked 当前值是否已是自定义色（勾选态的现算结果）
 * @param initial 弹窗预填值（null = 空输入框）
 */
export function addCustomColorItem(
	submenu: Menu,
	app: App,
	lang: Language,
	options: {
		checked: boolean;
		initial: string | null;
		onPick: (color: string) => void;
	},
): void {
	submenu.addSeparator();
	submenu.addItem((item) =>
		item
			.setTitle(t(lang, 'palette.custom'))
			.setChecked(options.checked)
			.onClick(() => {
				void openColorInputModal(app, lang, options.initial).then((color) => {
					if (color) {
						options.onPick(color);
					}
				});
			}),
	);
}
