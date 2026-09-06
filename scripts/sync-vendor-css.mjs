#!/usr/bin/env node
/**
 * styles.css vendor 段同步脚本。
 *
 * 背景：styles.css 的前半部分是 simple-mind-map 引擎样式（含 Quill），
 * 由 vendor/simple-mind-map.css 手工合并而来（约占全文 69%）。引擎升级
 * 时该段需要整体替换——此前只能手工编辑，易漏易错。
 *
 * 用法：npm run sync-vendor-css
 *
 * 行为：
 * - 用 vendor/simple-mind-map.css 重建 styles.css 中 START/END 标记之间的
 *   vendor 段（BOM 剥除、CRLF 归一为 LF、去掉与 START 重复的文件首行）；
 * - 许可证声明（Quill/simple-mind-map 的 MIT 版权信息）必须随段保留：
 *   从旧段中原样提取带回，不得丢失；
 * - 首次运行时若 END 标记不存在，以「Obsidian plugin styles」标记为边界
 *   引入 END 标记（引导模式），此后每次整体重建标记之间内容。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const START = '/* ===== simple-mind-map library styles ===== */';
const END = '/* ===== End simple-mind-map library styles ===== */';
const PLUGIN_STYLES = '/* ===== Obsidian plugin styles ===== */';

const stylesPath = new URL('../styles.css', import.meta.url);
const vendorPath = new URL('../vendor/simple-mind-map.css', import.meta.url);

function fail(message) {
	console.error(`sync-vendor-css: ${message}`);
	process.exit(1);
}

const styles = readFileSync(stylesPath, 'utf8');

// vendor 文件：BOM 剥除 + CRLF 归一；首行是与 START 重复的段头，剥掉，
// 保留其后的来源注释与正文
const vendorLines = readFileSync(vendorPath, 'utf8')
	.replace(/^\uFEFF/, '')
	.replace(/\r\n/g, '\n')
	.split('\n');
const payloadStart = vendorLines[0]?.includes('simple-mind-map library styles')
	? 1
	: 0;
const vendorPayload = vendorLines.slice(payloadStart).join('\n').trimEnd();

const startIdx = styles.indexOf(START);
if (startIdx === -1) {
	fail('styles.css 缺少 vendor 段起始标记');
}
const endIdx = styles.indexOf(END);
const boundaryIdx = endIdx !== -1 ? endIdx : styles.indexOf(PLUGIN_STYLES);
if (boundaryIdx === -1 || boundaryIdx < startIdx) {
	fail('无法定位 vendor 段结束边界（END 标记或 plugin styles 标记均未找到）');
}

const head = styles.slice(0, startIdx);
const oldSection = styles.slice(startIdx, boundaryIdx);
// 许可证声明随段保留（MIT 合规：不得丢失上游版权信息）
const license =
	oldSection.match(/\/\*! Bundled license information[\s\S]*?\*\//)?.[0] ?? '';

const section = [
	START,
	'/* 来源：vendor/simple-mind-map.css —— 本段由 `npm run sync-vendor-css` 重新生成，勿手工编辑 */',
	vendorPayload,
	...(license ? [license] : []),
	END,
].join('\n');

const tailStart = endIdx !== -1 ? endIdx + END.length : boundaryIdx;
const tail = styles.slice(tailStart);
const separator = tail.startsWith('\n') ? '' : '\n';

writeFileSync(stylesPath, `${head}${section}${separator}${tail}`);
console.log('styles.css vendor 段已从 vendor/simple-mind-map.css 同步完成');
