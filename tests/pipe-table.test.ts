/**
 * GFM 管道表识别（`domain/pipe-table`）回归。
 *
 * 覆盖两类事实：
 * ① **正例**：外框管道可有可无、列对齐四态、`\|` 还原、数据行列数归一；
 * ② **负例**（本模块的存在意义）：`标题\n---`（setext H2 下划线）与 `---`
 *    分隔线绝不能被当成单列表；列数不等、分隔行含非法字符、全空表头一律不算表。
 *
 * 渲染侧（DOM 装配 / 内联样式 / 围栏内不识别）由 `tests/node-inline-content.test.ts`
 * 与 `npm run verify:visual` 的 table 场景覆盖。
 */
import { describe, expect, it } from 'vitest';
import { matchPipeTable } from '../src/domain/pipe-table';

/** 便于复用的调用包装：整段文本按行切分后从第 0 行识别 */
function match(text: string) {
	return matchPipeTable(text.split('\n'), 0);
}

describe('matchPipeTable（识别）', () => {
	it('带外框管道：表头 / 对齐 / 数据行', () => {
		const hit = match(
			['| 名称 | 数量 | 备注 |', '| :--- | ---: | :---: |', '| 甲 | 2 | 说明 |'].join(
				'\n',
			),
		);
		expect(hit).not.toBeNull();
		expect(hit?.lineCount).toBe(3);
		expect(hit?.table.header).toEqual(['名称', '数量', '备注']);
		expect(hit?.table.align).toEqual(['left', 'right', 'center']);
		expect(hit?.table.rows).toEqual([['甲', '2', '说明']]);
	});

	it('不带外框管道（官方帮助：两侧管道可有可无）', () => {
		const hit = match(['a | b', '--- | ---', '1 | 2'].join('\n'));
		expect(hit?.table.header).toEqual(['a', 'b']);
		expect(hit?.table.align).toEqual([null, null]);
		expect(hit?.table.rows).toEqual([['1', '2']]);
	});

	it('单列表：分隔行含管道即成立（不得与 setext 下划线混为一谈）', () => {
		const hit = match(['| 只有一列 |', '| --- |', '| 值 |'].join('\n'));
		expect(hit?.table.header).toEqual(['只有一列']);
		expect(hit?.table.rows).toEqual([['值']]);
	});

	it('单元格文本 trim；空单元格保留为空串', () => {
		const hit = match(['|  甲  |  |', '| --- | --- |'].join('\n'));
		expect(hit?.table.header).toEqual(['甲', '']);
		expect(hit?.table.rows).toEqual([]);
	});

	it('数据行列数归一：不足补空串、超出截断（GFM 同）', () => {
		const hit = match(['| a | b |', '| --- | --- |', '| 1 |', '| 1 | 2 | 3 |'].join('\n'));
		expect(hit?.table.rows).toEqual([
			['1', ''],
			['1', '2'],
		]);
	});

	it('数据行在空行处结束（空行之后的行不进表）', () => {
		const hit = match(['| a | b |', '| --- | --- |', '| 1 | 2 |', '', '| 3 | 4 |'].join('\n'));
		expect(hit?.lineCount).toBe(3);
		expect(hit?.table.rows).toEqual([['1', '2']]);
	});

	it('数据行在不含未转义管道的行处结束（不吞后续段落）', () => {
		const hit = match(['| a | b |', '| --- | --- |', '| 1 | 2 |', '普通段落'].join('\n'));
		expect(hit?.lineCount).toBe(3);
		expect(hit?.table.rows).toEqual([['1', '2']]);
	});

	it('`\\|` 还原为字面 `|`（别名 / 图片缩放场景，官方帮助明写）', () => {
		const hit = match(
			['| 链接 | 图片 |', '| --- | --- |', '| [[笔记\\|别名]] | ![[x.png\\|200]] |'].join(
				'\n',
			),
		);
		expect(hit?.table.rows).toEqual([['[[笔记|别名]]', '![[x.png|200]]']]);
	});

	it('`\\\\|` 成对跳过：转义的反斜杠其后管道仍是分隔符', () => {
		// 源码里写作 a\\|b（两字符反斜杠 + 管道）⇒ 两格：`a\\` 与 `b`
		const hit = match(['a\\\\|b', '--- | ---'].join('\n'));
		expect(hit?.table.header).toEqual(['a\\\\', 'b']);
	});

	it('对齐只认 `:?-+:?`；列数不等即不是表', () => {
		expect(match(['| a | b |', '| --- |'].join('\n'))).toBeNull();
		expect(match(['| a |', '| --- | --- |'].join('\n'))).toBeNull();
	});
});

describe('matchPipeTable（负例：绝不误判解析层的既有语义）', () => {
	it('setext H2 下划线（`标题\\n---`）不是表', () => {
		expect(match(['标题', '---'].join('\n'))).toBeNull();
		expect(match(['标题', '------------'].join('\n'))).toBeNull();
	});

	it('分隔线 / 强调线（`---` / `***` / `___`）不是表', () => {
		expect(match(['正文', '***'].join('\n'))).toBeNull();
		expect(match(['正文', '___'].join('\n'))).toBeNull();
	});

	it('分隔行含非法字符（字母 / 反引号 / 空格单元格）即不是表', () => {
		expect(match(['| a | b |', '| --- | x |'].join('\n'))).toBeNull();
		expect(match(['| a | b |', '| --- | `x` |'].join('\n'))).toBeNull();
		expect(match(['| a | b |', '| :-- -- | :-: |'].join('\n'))).toBeNull();
	});

	it('全空表头不算表', () => {
		expect(match(['| | |', '| --- | --- |'].join('\n'))).toBeNull();
		expect(match(['|   |   |', '| --- | --- |'].join('\n'))).toBeNull();
	});

	it('无管道行 / 只有一行的管道文本都不是表', () => {
		expect(match(['只有一行 | 有管道'].join('\n'))).toBeNull();
		expect(match(['普通段落', '普通段落二'].join('\n'))).toBeNull();
		// 表头行之后缺分隔行（文件末尾）
		expect(match(['| a | b |'].join('\n'))).toBeNull();
	});

	it('错位的表头（分隔行在数据行之后）不成立', () => {
		expect(match(['| 1 | 2 |', '| a | b |', '| --- | --- |'].join('\n'))).toBeNull();
	});

	it('从 start 行识别：前一行不参与判定', () => {
		const lines = ['正文', '| a | b |', '| --- | --- |'];
		expect(matchPipeTable(lines, 0)).toBeNull();
		expect(matchPipeTable(lines, 1)?.table.header).toEqual(['a', 'b']);
	});
});
