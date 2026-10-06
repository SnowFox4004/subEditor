/**
 * SubStation Alpha (.ass) 与 SubStation Alpha v4 (.ssa) 的解析与序列化。
 *
 * 设计取舍：导入时把 `[Events]` 之前的全部内容原样存进 `meta.assHeader`，
 * 导出时再原样写回 —— 这样样式表、分辨率、脚本信息都不会在往返中丢失。
 * 只有在「导入 v4+ 却要导出 .ssa」这种格式本身不兼容的情况下才退回默认头。
 */
import type { Cue, FormatCodec, ParsedSubtitle, SerializeOptions, SubtitleDoc, Warning } from '../types';
import { formatAssTime, parseTimecode } from '../timecode';
import { applyNewline } from '../encoding';
import { buildCue, splitLines } from './shared';

const DEFAULT_EVENT_FORMAT =
  'Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

const ASS_HEADER = [
  '[Script Info]',
  'Title: srtEditor 导出',
  'ScriptType: v4.00+',
  'WrapStyle: 0',
  'ScaledBorderAndShadow: yes',
  'PlayResX: 1920',
  'PlayResY: 1080',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1',
];

const SSA_HEADER = [
  '[Script Info]',
  'Title: srtEditor 导出',
  'ScriptType: v4.00',
  'Collisions: Normal',
  'PlayDepth: 0',
  '',
  '[V4 Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding',
  'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,1,2,2,2,10,10,10,0,1',
];

/**
 * 按字段数拆分 Dialogue 行。
 * 关键点：Text 是最后一个字段，里面可能包含逗号，所以只切前 n-1 个逗号。
 */
function splitAssFields(text: string, count: number): string[] {
  const parts: string[] = [];
  let rest = text;
  for (let i = 0; i < count - 1; i++) {
    const idx = rest.indexOf(',');
    if (idx < 0) {
      parts.push(rest);
      rest = '';
      break;
    }
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  parts.push(rest);
  return parts;
}

/** ASS 正文 → 纯文本：去掉 {\an8} 这类覆盖标签，还原换行 */
export function assTextToPlain(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

/** 纯文本 → ASS 正文 */
export function plainToAssText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\\N');
}

export function parseAss(input: string): ParsedSubtitle {
  const lines = splitLines(input);
  const cues: Cue[] = [];
  const warnings: Warning[] = [];

  const header: string[] = [];
  let inEvents = false;
  let sawEvents = false;
  let scriptType = 'v4.00+';
  let eventFormat = DEFAULT_EVENT_FORMAT;

  for (const raw of lines) {
    const trimmed = raw.trim();

    const section = /^\[(.+?)\]$/.exec(trimmed);
    if (section) {
      const name = section[1].toLowerCase();
      if (name === 'events') {
        inEvents = true;
        sawEvents = true;
        continue;
      }
      inEvents = false;
      if (!sawEvents) header.push(raw);
      continue;
    }

    if (!sawEvents) {
      header.push(raw);
      const st = /^ScriptType:\s*(.+)$/i.exec(trimmed);
      if (st) scriptType = st[1].trim();
      continue;
    }

    if (!inEvents) continue;

    const fmt = /^Format:\s*(.+)$/i.exec(trimmed);
    if (fmt) {
      eventFormat = fmt[1].trim();
      continue;
    }

    const dialogue = /^Dialogue:\s*(.*)$/i.exec(trimmed);
    if (!dialogue) continue;

    const fields = eventFormat.split(',').map((f) => f.trim());
    const values = splitAssFields(dialogue[1], Math.max(fields.length, 10));
    const record: Record<string, string> = {};
    fields.forEach((name, i) => {
      record[name] = values[i] ?? '';
    });

    const start = parseTimecode(record.Start ?? '');
    const end = parseTimecode(record.End ?? '');
    if (start === null || end === null) {
      warnings.push({
        level: 'warn',
        code: 'bad-timecode',
        cueIds: [],
        message: `Dialogue 时间码无法解析，已跳过：${dialogue[1].slice(0, 60)}`,
      });
      continue;
    }

    const text = assTextToPlain(record.Text ?? '');
    const cue = buildCue(cues.length + 1, start, end, text, {
      speaker: record.Name || undefined,
    });
    if (record.Style) cue.style = { assStyle: record.Style };
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
      message: '未在 [Events] 段中找到任何 Dialogue 行',
    });
  }

  return {
    cues,
    meta: {
      assHeader: header,
      assScriptType: scriptType,
      assEventFormat: eventFormat,
    },
    warnings,
  };
}

function isSsaScriptType(scriptType: string): boolean {
  const s = scriptType.toLowerCase();
  return s.includes('v4.00') && !s.includes('+');
}

function headerFor(doc: SubtitleDoc, target: 'v4+' | 'v4'): string[] {
  const stored = doc.meta.assHeader as string[] | undefined;
  const storedType = (doc.meta.assScriptType as string | undefined) ?? '';
  if (stored && stored.length > 0 && isSsaScriptType(storedType) === (target === 'v4')) {
    return stored;
  }
  return target === 'v4' ? SSA_HEADER : ASS_HEADER;
}

function serializeAssLike(
  doc: SubtitleDoc,
  opts: SerializeOptions,
  target: 'v4+' | 'v4',
): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const header = headerFor(doc, target);
  const eventFormat =
    (doc.meta.assEventFormat as string | undefined) ?? DEFAULT_EVENT_FORMAT;
  const fieldNames = eventFormat.split(',').map((f) => f.trim());

  const lines: string[] = [...header];
  if (!lines.some((l) => /^\[Events\]$/i.test(l.trim()))) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('[Events]');
  }
  lines.push(`Format: ${eventFormat}`);

  for (const cue of doc.cues) {
    const values: Record<string, string> = {
      Layer: '0',
      Marked: 'Marked=0',
      Start: formatAssTime(cue.start),
      End: formatAssTime(cue.end),
      Style: cue.style?.assStyle ?? 'Default',
      Name: cue.speaker ?? '',
      MarginL: '0000',
      MarginR: '0000',
      MarginV: '0000',
      Effect: '',
      Text: plainToAssText(cue.text),
    };
    const body = fieldNames.map((name) => values[name] ?? '').join(',');
    lines.push(`Dialogue: ${body}`);
  }

  return applyNewline(lines.join(newline) + newline, newline);
}

export function serializeAss(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  return serializeAssLike(doc, opts, 'v4+');
}

export function serializeSsa(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  return serializeAssLike(doc, opts, 'v4');
}

export const assCodec: FormatCodec = {
  id: 'ass',
  name: 'SubStation Alpha (.ass)',
  extensions: ['ass'],
  canImport: true,
  canExport: true,
  mimeType: 'text/x-ssa',
  detect(head, ext) {
    if (ext === 'ass') return 1;
    if (/\[Script Info\]/i.test(head) && /v4\.00\+/i.test(head)) return 0.95;
    if (/\[Script Info\]/i.test(head)) return 0.7;
    return 0;
  },
  parse: (text) => parseAss(text),
  serialize: (doc, opts) => serializeAss(doc, opts),
};

export const ssaCodec: FormatCodec = {
  id: 'ssa',
  name: 'SubStation Alpha v4 (.ssa)',
  extensions: ['ssa'],
  canImport: true,
  canExport: true,
  mimeType: 'text/x-ssa',
  detect(head, ext) {
    if (ext === 'ssa') return 1;
    if (/\[Script Info\]/i.test(head) && /ScriptType:\s*v4\.00\s*$/im.test(head)) return 0.9;
    return 0;
  },
  parse: (text) => parseAss(text),
  serialize: (doc, opts) => serializeSsa(doc, opts),
};
