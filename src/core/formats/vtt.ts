/**
 * WebVTT (.vtt) 解析与序列化。
 */
import type { Cue, FormatCodec, ParsedSubtitle, SerializeOptions, SubtitleDoc, Warning } from '../types';
import { formatVttTime, parseTimecode } from '../timecode';
import { applyNewline } from '../encoding';
import { buildCue, decodeEntities, finalizeCues, splitLines, stripHtml } from './shared';

const TIME_LINE_RE = /^\s*(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/;

/** NOTE / STYLE / REGION 块不是字幕 */
function isMetadataBlock(firstLine: string): boolean {
  return /^(NOTE|STYLE|REGION)\b/i.test(firstLine.trim());
}

export function parseVtt(input: string): ParsedSubtitle {
  const lines = splitLines(input);
  const cues: Cue[] = [];
  const warnings: Warning[] = [];

  let i = 0;
  // 跳过 WEBVTT 头
  if (lines[0] && /^WEBVTT/i.test(lines[0].trim())) i = 1;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;

    if (isMetadataBlock(lines[i])) {
      // 跳到下一个空行
      while (i < lines.length && lines[i].trim() !== '') i++;
      continue;
    }

    // 可选 cue id
    let identifier: string | null = null;
    if (!TIME_LINE_RE.test(lines[i]) && i + 1 < lines.length && TIME_LINE_RE.test(lines[i + 1])) {
      identifier = lines[i].trim();
      i++;
    }

    const m = TIME_LINE_RE.exec(lines[i] ?? '');
    if (!m) {
      // 认不出来的行，跳过并记账
      warnings.push({
        level: 'warn',
        code: 'stray-text',
        cueIds: [],
        message: `第 ${i + 1} 行不是合法的 VTT 时间行，已跳过`,
      });
      i++;
      continue;
    }

    const start = parseTimecode(m[1]);
    const end = parseTimecode(m[2]);
    if (start === null || end === null) {
      warnings.push({
        level: 'warn',
        code: 'bad-timecode',
        cueIds: [],
        message: `第 ${i + 1} 行的时间码无法解析：${lines[i]}`,
      });
      i++;
      continue;
    }
    i++;

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }

    const cue = buildCue(cues.length + 1, start, end, stripHtml(textLines.join('\n')));
    if (identifier) cue.style = { vttId: identifier };
    cues.push(cue);

    if (end < start) {
      warnings.push({
        level: 'error',
        code: 'negative-duration',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条结束时间早于开始时间`,
      });
    }
  }

  if (cues.length === 0) {
    warnings.push({
      level: 'error',
      code: 'unparsed',
      cueIds: [],
      message: '未解析出任何 VTT 字幕条目',
    });
  }

  return { cues, meta: {}, warnings };
}

export function serializeVtt(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const renumber = opts.renumber ?? true;
  const blocks: string[] = ['WEBVTT'];

  doc.cues.forEach((cue, i) => {
    const index = renumber ? i + 1 : cue.index;
    const id = cue.style?.vttId;
    const head = id ? `${id}${newline}${index}` : `${index}`;
    const body = decodeEntities(cue.text).replace(/\r\n|\r|\n/g, '\n').replace(/\n+$/, '');
    blocks.push(
      `${head}${newline}${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}${newline}${body}`,
    );
  });

  return applyNewline(blocks.join(newline + newline) + newline, newline);
}

export const vttCodec: FormatCodec = {
  id: 'vtt',
  name: 'WebVTT (.vtt)',
  extensions: ['vtt', 'webvtt'],
  canImport: true,
  canExport: true,
  mimeType: 'text/vtt',
  detect(head, ext) {
    if (ext === 'vtt' || ext === 'webvtt') return 1;
    if (/^\s*WEBVTT/.test(head)) return 0.98;
    if (/^\s*\d{1,3}:\d{2}:\d{2}\.\d{1,3}\s*-->/.test(head)) return 0.6;
    return 0;
  },
  parse: (text) => parseVtt(text),
  serialize: (doc, opts) => serializeVtt(doc, opts),
};

export { finalizeCues };
