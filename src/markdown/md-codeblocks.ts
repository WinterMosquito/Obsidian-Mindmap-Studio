/** 节点内围栏块定位与原文替换：复用 Markdown 围栏判据，保留前缀与换行。 */
import { fenceMarker, isFenceCloseLine } from './md-outline-lines';
import { normalizeFenceLanguage } from '../core/constants';

export interface FencedNodeBlock {
	index: number;
	language: string;
	source: string;
	start: number;
	end: number;
	bodyStart: number;
	bodyEnd: number;
	prefix: string;
	eol: string;
}

/** 调用方将冲突转换为当前界面语言；纯 Markdown 层不持有视图或语言设置。 */
export class FencedBlockConflictError extends Error {
	constructor() { super('The code block changed before this edit was committed'); }
}

export function normalizeBlockSource(source: string): string {
	return source.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

export function fencedNodeBlocks(raw: string): FencedNodeBlock[] {
	const lines: { text: string; start: number; end: number; eol: string }[] = [];
	const pattern = /([^\r\n]*)(\r\n|\n|$)/g;
	for (let match = pattern.exec(raw); match && match[0].length; match = pattern.exec(raw)) {
		lines.push({ text: match[1]!, start: match.index, end: pattern.lastIndex, eol: match[2]! });
	}
	const blocks: FencedNodeBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const opening = lines[i]!;
		const prefix = opening.text.match(/^[ \t]*(?:>[ \t]*)*/)?.[0] ?? '';
		const bare = opening.text.slice(prefix.length);
		const marker = fenceMarker(bare);
		if (!marker) continue;
		const language = normalizeFenceLanguage(bare.slice(marker.length));
		for (let j = i + 1; j < lines.length; j++) {
			const closing = lines[j]!;
			const closeBare = closing.text.startsWith(prefix) ? closing.text.slice(prefix.length) : closing.text;
			if (!isFenceCloseLine(closeBare, { ...marker, column: 0 })) continue;
			const source = lines.slice(i + 1, j).map(line =>
				line.text.startsWith(prefix) ? line.text.slice(prefix.length) : line.text,
			).join('\n');
			blocks.push({ index: blocks.length, language, source, start: opening.start,
				end: closing.end, bodyStart: opening.end, bodyEnd: closing.start,
				prefix, eol: opening.eol || '\n' });
			i = j;
			break;
		}
	}
	return blocks;
}

export function replaceFencedNodeBlock(
	raw: string, index: number, expected: string, next: string | null,
): string {
	const block = fencedNodeBlocks(raw)[index];
	if (!block || normalizeBlockSource(block.source) !== normalizeBlockSource(expected)) {
		throw new FencedBlockConflictError();
	}
	if (next === null) return raw.slice(0, block.start) + raw.slice(block.end);
	const lines = normalizeBlockSource(next).split('\n');
	const body = lines.map(line => block.prefix + line).join(block.eol);
	const opening = raw.slice(block.start, block.bodyStart);
	const marker = fenceMarker(opening.slice(block.prefix.length))!;
	let length = marker.length;
	for (const line of lines) {
		if (isFenceCloseLine(line, { ...marker, column: 0 })) {
			length = Math.max(length, fenceMarker(line)!.length + 1);
		}
	}
	if (length === marker.length) return raw.slice(0, block.bodyStart) + body + block.eol + raw.slice(block.bodyEnd);
	// 新正文若含同长闭合围栏，仅延长外层标记，避免正文逃出代码块。
	const closing = raw.slice(block.bodyEnd, block.end);
	const fence = marker.char.repeat(length);
	return raw.slice(0, block.start) + opening.replace(marker.char.repeat(marker.length), fence) +
		body + block.eol + closing.replace(marker.char.repeat(marker.length), fence) + raw.slice(block.end);
}
