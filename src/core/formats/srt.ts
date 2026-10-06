/**
 * SubRip (.srt) 解析与序列化。
 *
 * 解析器的设计原则：**绝不擅自修改用户数据**。所有异常都只记 warning，
 * 能读出来的内容原样保留（包括正文里的空行、HTML 标签、奇怪的时间码）。
 */
import type {
  Cue,
  FormatCodec,
  ParsedSubtitle,
  SerializeOptions,
  SubtitleDoc,
  Warning,
} from '../types';
import { formatSrtTime, parseTimecode } from '../timecode';
import { applyNewline } from '../encoding';

/** 时间码行：`00:00:01,000 --> 00:00:04,000`（允许 1~3 个短横、VTT 的 `.` 与行尾定位参数） */
const TIME_LINE_RE = /^\s*(\S+)\s*-{1,3}>\s*(\S+)(?:\s+.*)?$/;

function isTimecodeLine(line: string): boolean {
  const m = TIME_LINE_RE.exec(line);
  if (!m) return false;
  return parseTimecode(m[1]) !== null && parseTimecode(m[2]) !== null;
}

function parseTimecodeLine(line: string): { start: number; end: number } | null {
  const m = TIME_LINE_RE.exec(line);
  if (!m) return null;
  const start = parseTimecode(m[1]);
  const end = parseTimecode(m[2]);
  if (start === null || end === null) return null;
  return { start, end };
}

function makeCue(index: number, start: number, end: number, text: string): Cue {
  return {
    id: crypto.randomUUID(),
    index,
    start,
    end,
    text,
    locked: false,
    dirty: false,
  };
}

/**
 * 解析 SRT 文本。
 * 容错覆盖：序号缺失/乱序/重复、`--->` 双箭头、`,`/`.` 混用、缺毫秒、
 * 正文含空行、缺少块间空行、文件尾无空行、游离文本。
 */
export function parseSrt(input: string): ParsedSubtitle {
  const text = input.replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\r|\n/);
  const cues: Cue[] = [];
  const warnings: Warning[] = [];

  const seenIndexes = new Set<number>();
  let strayCount = 0;
  let i = 0;

  while (i < lines.length) {
    // 跳过块间空行
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;

    // 序号行（可选）
    let declaredIndex: number | null = null;
    if (
      /^\s*\d+\s*$/.test(lines[i]) &&
      i + 1 < lines.length &&
      isTimecodeLine(lines[i + 1])
    ) {
      declaredIndex = Number.parseInt(lines[i].trim(), 10);
      i++;
    }

    if (!isTimecodeLine(lines[i])) {
      // 既不是序号也不是时间码 —— 游离文本，跳过但记账
      strayCount++;
      i++;
      continue;
    }

    const times = parseTimecodeLine(lines[i]);
    if (!times) {
      strayCount++;
      i++;
      continue;
    }
    i++;

    // 收集正文，直到遇到下一个块边界
    const textLines: string[] = [];
    let blankRun = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === '') {
        // 向后看：空行之后是不是新块的开头？
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j >= lines.length) {
          i = j;
          break;
        }
        const nextIsTimecode = isTimecodeLine(lines[j]);
        const nextIsIndexThenTimecode =
          /^\s*\d+\s*$/.test(lines[j]) &&
          j + 1 < lines.length &&
          isTimecodeLine(lines[j + 1]);
        if (nextIsTimecode || nextIsIndexThenTimecode) {
          i = j;
          break;
        }
        // 否则空行属于本条正文（多行字幕里的空行），继续
        textLines.push('');
        blankRun++;
        i++;
        continue;
      }

      // 缺少块间空行时，时间码行直接视为新块的开始
      if (isTimecodeLine(line)) break;

      // 同理：`序号 + 时间码行` 也说明上一块到此为止（否则序号会被吞进正文）
      if (
        /^\s*\d+\s*$/.test(line) &&
        i + 1 < lines.length &&
        isTimecodeLine(lines[i + 1])
      ) {
        break;
      }

      textLines.push(line);
      i++;
    }

    // 去掉尾部空行，但保留中间空行
    while (textLines.length > 0 && textLines[textLines.length - 1].trim() === '') {
      textLines.pop();
    }

    const cueText = textLines.join('\n');
    const cue = makeCue(declaredIndex ?? cues.length + 1, times.start, times.end, cueText);

    if (declaredIndex === null) {
      warnings.push({
        level: 'info',
        code: 'missing-index',
        cueIds: [cue.id],
        message: `第 ${cues.length + 1} 条缺少序号，已自动补正`,
      });
    } else if (seenIndexes.has(declaredIndex)) {
      warnings.push({
        level: 'warn',
        code: 'duplicate-index',
        cueIds: [cue.id],
        message: `序号 ${declaredIndex} 重复出现`,
      });
    }
    if (declaredIndex !== null) seenIndexes.add(declaredIndex);

    if (cueText.trim() === '') {
      warnings.push({
        level: 'warn',
        code: 'empty-text',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条正文为空`,
      });
    }

    if (times.end < times.start) {
      warnings.push({
        level: 'error',
        code: 'negative-duration',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条结束时间早于开始时间`,
      });
    }

    const prev = cues[cues.length - 1];
    if (prev && times.start < prev.end) {
      warnings.push({
        level: 'warn',
        code: 'overlap',
        cueIds: [prev.id, cue.id],
        message: `第 ${prev.index} 条与第 ${cue.index} 条时间重叠 ${prev.end - times.start}ms`,
      });
    }

    cues.push(cue);
  }

  if (strayCount > 0) {
    warnings.push({
      level: 'warn',
      code: 'stray-text',
      cueIds: [],
      message: `有 ${strayCount} 行无法归属到任何字幕块，已跳过`,
    });
  }

  if (cues.length === 0) {
    warnings.push({
      level: 'error',
      code: 'unparsed',
      cueIds: [],
      message: '未解析出任何字幕条目，请确认文件格式或手动切换编码',
    });
  }

  return { cues, meta: {}, warnings };
}

/**
 * 序列化为 SRT 文本。
 * 序号统一重排（1 起），条目之间空一行，末尾留一个换行。
 */
export function serializeSrt(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const renumber = opts.renumber ?? true;
  const blocks: string[] = [];

  doc.cues.forEach((cue, i) => {
    const index = renumber ? i + 1 : cue.index;
    const body = cue.text.replace(/\r\n|\r|\n/g, '\n').replace(/\n+$/, '');
    blocks.push(`${index}${newline}${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}${newline}${body}`);
  });

  const joined = blocks.join(newline + newline);
  return applyNewline(joined + newline, newline);
}

export const srtCodec: FormatCodec = {
  id: 'srt',
  name: 'SubRip (SRT)',
  extensions: ['srt'],
  canImport: true,
  canExport: true,
  mimeType: 'application/x-subrip',
  detect(head, ext) {
    if (ext === 'srt') return 1;
    if (/^\s*\d+\s*\r?\n\s*\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}\s*-{1,2}>/.test(head)) return 0.9;
    return 0;
  },
  parse: (text) => parseSrt(text),
  serialize: (doc, opts) => serializeSrt(doc, opts),
};
