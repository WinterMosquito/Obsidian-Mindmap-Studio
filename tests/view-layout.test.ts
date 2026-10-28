/**
 * 布局跟随的**编排契约**（`features/view.ts` 的 `applyLayout` / `syncDeclaredLayout`）。
 *
 * 为什么用源码契约而不是直测：`MindMapView` 继承 Obsidian 的 `FileView`，实例化需要
 * 完整 workspace / leaf / 引擎，单测里跑不起来（与 `mindmap-codeblock.test.ts` 对
 * `embedLayout` 的做法同一口径）。而这里要锁的四件事恰好都**不可观测、却会静默回归**：
 *
 * ① **竞态守卫**（`pendingLayoutWrite` 的置位 / 让位 / 清空）——写属性必然触发
 *    `metadataCache.changed`，漏掉任一环就变「同一布局应用两次」（双重重排 + 竖栏
 *    连建两次）；漏掉 `finally` 清空则跟随被**永久**挡住（更严重）。
 * ② **入口归一**——`applyLayout` 在 `MindMapViewContext` 上对任意字符串开放；非法
 *    id 若照旧传入，会「把默认值写进文件」+「把未知布局交给引擎」，两者都错。
 * ③ **单一应用点**——两个入口共用 `applyLayoutToEngine`；各写一份时，新增第四步
 *    就只能改一处、漏一处（顺序本身是契约：会话值 → 引擎 → 竖栏 → 小地图）。
 * ④ **加载期复问声明**——读完文档再读一次 `readDeclaredLayout`（`vault.read` 给了
 *    MetadataCache 追赶的时间），且必须早于 `initMindMap`：漏掉就回到「勾选态与
 *    画面先停在种子值、等 changed 再跳」的老样子。
 *
 * 断言里的字符串**就是契约**：重命名或改写等于改语义，必须同时改本文件。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VIEW_SOURCE = readFileSync(
	new URL('../src/features/view.ts', import.meta.url),
	'utf8',
);

describe('布局跟随：竞态守卫（pendingLayoutWrite）', () => {
	it('写属性前置位、跟随侧让位、收尾清空三处齐全', () => {
		// 置位必须在 `save()` 之前：排空一旦开始，写盘触发的 changed 就可能先到
		expect(VIEW_SOURCE).toContain('this.pendingLayoutWrite = layoutId;');
		// 让位：跟随侧见到「在途值」直接返回，交给 applyLayout 收尾统一应用
		expect(VIEW_SOURCE).toContain(
			'declared === null || declared === this.pendingLayoutWrite',
		);
		// 清空在 finally 里、且**只清自己那一项**：成功与失败都要清，否则之后的跟随
		// 永远早退；无条件清则两次切换交叠时前者会放走后者仍在途的窗口
		expect(VIEW_SOURCE).toContain('if (this.pendingLayoutWrite === layoutId) {');
		expect(VIEW_SOURCE).toContain('this.pendingLayoutWrite = null;');
	});
});

describe('布局入口归一（applyLayout）', () => {
	it('入参先过 layoutIdOfPropertyValue，非法 id 直接忽略并留痕', () => {
		expect(VIEW_SOURCE).toContain(
			'const layoutId = layoutIdOfPropertyValue(engineLayoutId);',
		);
		expect(VIEW_SOURCE).toContain('if (layoutId === null) {');
		expect(VIEW_SOURCE).toContain('未知的布局 id，已忽略');
	});

	it('写属性与设引擎都用归一值，不再直接消费入参', () => {
		expect(VIEW_SOURCE).toContain('layoutPropertyValue(layoutId)');
		expect(VIEW_SOURCE).not.toContain('layoutPropertyValue(engineLayoutId)');
		expect(VIEW_SOURCE).not.toContain('this.engine.setLayout(engineLayoutId)');
	});
});

describe('单一应用点（applyLayoutToEngine）', () => {
	it('定义一次、两个入口各调用一次，engine.setLayout 只在该方法内出现', () => {
		expect(VIEW_SOURCE.match(/private applyLayoutToEngine\(/g) ?? []).toHaveLength(1);
		expect(VIEW_SOURCE.match(/this\.applyLayoutToEngine\(/g) ?? []).toHaveLength(2);
		expect(VIEW_SOURCE.match(/this\.engine\.setLayout\(/g) ?? []).toHaveLength(1);
	});
});

describe('加载期复问声明（MetadataCache 追赶）', () => {
	it('读完文档再读一次声明，且早于引擎创建', () => {
		const reread = VIEW_SOURCE.indexOf(
			'const declaredNow = readDeclaredLayout(this.app, file);',
		);
		const create = VIEW_SOURCE.indexOf('this.engine.initMindMap(tree);');
		expect(reread, '缺失：加载后复问声明').toBeGreaterThan(-1);
		expect(create, '缺失：引擎创建点').toBeGreaterThan(-1);
		// 顺序即契约：复问必须在 initMindMap 之前，否则引擎仍按种子值布局
		expect(reread).toBeLessThan(create);
	});
});
