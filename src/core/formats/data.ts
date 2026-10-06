/**
 * 数据交换格式：JSON / CSV / TSV / 纯文本。
 * 这些格式主要给「导出给别的程序处理」和「审阅」用，不承载样式信息。
 */
import type { Cue, FormatCodec, ParsedSubtitle, SerializeOptions, SubtitleDoc, Warning } from '../types';
import { formatSrtTime, parseTimecode } from '../timecode';
import { applyNewline } from '../encoding';
import { buildCue, finalizeCues, flattenText, splitLines } from './shared';

/* ================================================================== */
/* JSON                                                               */
/* ================================================================== */

interface JsonCue {
  index?: number;
  start?: number | string;
  end?: number | string;
  text?: string;
  speaker?: string | null;
  locked?: boolean;
}

function coerceTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') return parseTimecode(value);
  return null;
}

export function parseJson(input: string): ParsedSubtitle {
  const warnings: Warning[] = [];
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch (err) {
    return {
      cues: [],
      meta: {},
      warnings: [
        {
          level: 'error',
          code: 'unparsed',
          cueIds: [],
          message: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  let list: unknown[] = [];
  let meta: Record<string, unknown> = {};

  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.cues)) list = obj.cues;
    else if (Array.isArray(obj.subtitles)) list = obj.subtitles;
    meta = { jsonGenerator: obj.generator, jsonVersion: obj.version };
  }

  const cues: Cue[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as JsonCue;
    const start = coerceTime(record.start);
    const end = coerceTime(record.end);
    if (start === null || end === null) continue;
    const cue = buildCue(cues.length + 1, start, end, String(record.text ?? ''), {
      speaker: record.speaker ?? undefined,
    });
    if (record.locked) cue.locked = true;
    cues.push(cue);
  }

  if (cues.length === 0) {
    warnings.push({
      level: 'error',
      code: 'unparsed',
      cueIds: [],
      message: 'JSON 里没有找到可用的字幕条目（需要 cues 数组，且每条含 start/end/text）',
    });
  }

  return { cues: finalizeCues(cues), meta, warnings };
}

export function serializeJson(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const payload = {
    generator: 'srtEditor',
    version: 1,
    encoding: 'milliseconds',
    cues: doc.cues.map((cue, i) => ({
      index: opts.renumber === false ? cue.index : i + 1,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      speaker: cue.speaker ?? null,
    })),
  };
  return applyNewline(JSON.stringify(payload, null, 2) + newline, newline);
}

export const jsonCodec: FormatCodec = {
  id: 'json',
  name: 'JSON (.json)',
  extensions: ['json'],
  canImport: true,
  canExport: true,
  mimeType: 'application/json',
  detect(head, ext) {
    if (ext === 'json') return 1;
    if (/^\s*[[{]/.test(head) && /"(cues|subtitles|start)"\s*:/.test(head)) return 0.7;
    return 0;
  },
  parse: (text) => parseJson(text),
  serialize: (doc, opts) => serializeJson(doc, opts),
};

/* ================================================================== */
/* CSV / TSV                                                          */
/* ================================================================== */

/**
 * 正文里的换行统一写成字面量 `\n` 转义。
 * 理由：CSV 虽然允许引号内换行，但 Excel、WPS、pandas 默认都不按 RFC4180 处理，
 * 会直接把一行拆成两行；用转义序列则所有工具都能正确读到。
 */
function escapeCell(value: string, delimiter: string): string {
  const text = value.replace(/\r\n|\r|\n/g, '\\n');
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function unescapeCell(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}

/** 最小 RFC4180 解析器，支持引号包裹与 "" 转义 */
function parseDelimited(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const COLUMN_ALIASES: Record<string, string> = {
  index: 'index',
  序号: 'index',
  start: 'start',
  开始: 'start',
  开始时间: 'start',
  begin: 'start',
  end: 'end',
  结束: 'end',
  结束时间: 'end',
  text: 'text',
  正文: 'text',
  内容: 'text',
  content: 'text',
  speaker: 'speaker',
  说话人: 'speaker',
};

export function makeDelimitedParser(delimiter: string) {
  return function parse(input: string): ParsedSubtitle {
    const rows = parseDelimited(input, delimiter);
    const cues: Cue[] = [];
    const warnings: Warning[] = [];

    if (rows.length === 0) {
      warnings.push({ level: 'error', code: 'unparsed', cueIds: [], message: '文件是空的' });
      return { cues, meta: {}, warnings };
    }

    // 第一行是表头，把列名映射成标准字段
    const header = rows[0].map((h) => COLUMN_ALIASES[h.trim().toLowerCase()] ?? h.trim());
    const hasHeader = header.includes('start') && header.includes('end');
    const columns = hasHeader
      ? header
      : ['index', 'start', 'end', 'text'];
    const dataRows = hasHeader ? rows.slice(1) : rows;

    for (const [i, row] of dataRows.entries()) {
      if (row.length === 0 || (row.length === 1 && row[0].trim() === '')) continue;
      const record: Record<string, string> = {};
      columns.forEach((name, ci) => {
        record[name] = unescapeCell(row[ci] ?? '');
      });

      const start = parseTimecode(record.start ?? '') ?? Number.parseInt(record.start ?? '', 10);
      const end = parseTimecode(record.end ?? '') ?? Number.parseInt(record.end ?? '', 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        warnings.push({
          level: 'warn',
          code: 'bad-timecode',
          cueIds: [],
          message: `第 ${i + (hasHeader ? 2 : 1)} 行的时间无法解析，已跳过`,
        });
        continue;
      }

      cues.push(
        buildCue(cues.length + 1, start, end, record.text ?? '', {
          speaker: record.speaker || undefined,
        }),
      );
    }

    if (cues.length === 0) {
      warnings.push({
        level: 'error',
        code: 'unparsed',
        cueIds: [],
        message: '没有解析出任何条目，请确认表头包含 start / end / text 列',
      });
    }

    return { cues: finalizeCues(cues), meta: {}, warnings };
  };
}

export function makeDelimitedSerializer(delimiter: string) {
  return function serialize(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
    const newline = opts.newline ?? doc.newline ?? '\n';
    const header = ['index', 'start', 'end', 'speaker', 'text'];
    const lines = [header.join(delimiter)];

    doc.cues.forEach((cue, i) => {
      const cells = [
        String(i + 1),
        formatSrtTime(cue.start),
        formatSrtTime(cue.end),
        cue.speaker ?? '',
        cue.text,
      ];
      lines.push(cells.map((c) => escapeCell(c, delimiter)).join(delimiter));
    });

    return applyNewline(lines.join(newline) + newline, newline);
  };
}

export const csvCodec: FormatCodec = {
  id: 'csv',
  name: 'CSV (.csv)',
  extensions: ['csv'],
  canImport: true,
  canExport: true,
  mimeType: 'text/csv',
  detect(head, ext) {
    if (ext === 'csv') return 1;
    const first = (head.split('\n')[0] ?? '').toLowerCase();
    if (first.includes(',') && first.includes('start') && first.includes('end')) return 0.6;
    return 0;
  },
  parse: makeDelimitedParser(','),
  serialize: makeDelimitedSerializer(','),
};

export const tsvCodec: FormatCodec = {
  id: 'tsv',
  name: 'TSV (.tsv)',
  extensions: ['tsv'],
  canImport: true,
  canExport: true,
  mimeType: 'text/tab-separated-values',
  detect(head, ext) {
    if (ext === 'tsv') return 1;
    const first = (head.split('\n')[0] ?? '').toLowerCase();
    if (first.includes('\t') && first.includes('start') && first.includes('end')) return 0.6;
    return 0;
  },
  parse: makeDelimitedParser('\t'),
  serialize: makeDelimitedSerializer('\t'),
};

/* ================================================================== */
/* 纯文本                                                             */
/* ================================================================== */

export function serializeTxt(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const lines = doc.cues.map((cue) => flattenText(cue.text, ' '));
  return applyNewline(lines.join(newline) + newline, newline);
}

export const txtCodec: FormatCodec = {
  id: 'txt',
  name: '纯文本 (.txt)',
  extensions: ['txt'],
  // 纯文本没有时间信息，导入无从下手，所以只支持导出
  canImport: false,
  canExport: true,
  mimeType: 'text/plain',
  detect(head, ext) {
    return ext === 'txt' && !/[{}]/.test(head) ? 0.1 : 0;
  },
  serialize: (doc, opts) => serializeTxt(doc, opts),
};

export { splitLines };
