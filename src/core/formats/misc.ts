/**
 * 几种「一次性写清楚」的格式：SBV / LRC / MicroDVD / SAMI。
 * 放在同一个文件里，因为它们各自都只有百来行，拆开反而难找。
 */
import type { Cue, FormatCodec, FormatId, ParsedSubtitle, SerializeOptions, SubtitleDoc, Warning } from '../types';
import { formatLrcTime, formatSrtTime, parseTimecode, splitTime } from '../timecode';
import { applyNewline } from '../encoding';
import { buildCue, decodeEntities, finalizeCues, flattenText, splitLines, stripHtml } from './shared';

/* ================================================================== */
/* YouTube SBV                                                        */
/* ================================================================== */

const SBV_TIME_RE = /^\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})\s*,\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})\s*$/;

/** SBV 的小时位不补零：`0:00:01.000` */
export function formatSbvTime(ms: number): string {
  const { h, m, s, ms: msec } = splitTime(ms);
  const pad = (n: number, len = 2) => String(Math.abs(Math.trunc(n))).padStart(len, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(msec, 3)}`;
}

export function parseSbv(input: string): ParsedSubtitle {
  const lines = splitLines(input);
  const cues: Cue[] = [];
  const warnings: Warning[] = [];

  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;

    const m = SBV_TIME_RE.exec(lines[i]);
    if (!m) {
      warnings.push({
        level: 'warn',
        code: 'stray-text',
        cueIds: [],
        message: `第 ${i + 1} 行不是合法的 SBV 时间行，已跳过`,
      });
      i++;
      continue;
    }

    const start = parseTimecode(m[1]);
    const end = parseTimecode(m[2]);
    i++;

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }

    if (start === null || end === null) continue;
    cues.push(buildCue(cues.length + 1, start, end, stripHtml(textLines.join('\n'))));
  }

  if (cues.length === 0) {
    warnings.push({ level: 'error', code: 'unparsed', cueIds: [], message: '未解析出任何 SBV 条目' });
  }
  return { cues, meta: {}, warnings };
}

export function serializeSbv(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const blocks = doc.cues.map((cue) => {
    const body = cue.text.replace(/\r\n|\r|\n/g, '\n').replace(/\n+$/, '');
    return `${formatSbvTime(cue.start)},${formatSbvTime(cue.end)}${newline}${body}`;
  });
  return applyNewline(blocks.join(newline + newline) + newline, newline);
}

export const sbvCodec: FormatCodec = {
  id: 'sbv',
  name: 'YouTube SBV (.sbv)',
  extensions: ['sbv'],
  canImport: true,
  canExport: true,
  mimeType: 'text/plain',
  detect(head, ext) {
    if (ext === 'sbv') return 1;
    if (SBV_TIME_RE.test(head.split('\n')[0] ?? '')) return 0.85;
    return 0;
  },
  parse: (text) => parseSbv(text),
  serialize: (doc, opts) => serializeSbv(doc, opts),
};

/* ================================================================== */
/* LRC 歌词                                                            */
/* ================================================================== */

const LRC_TAG_RE = /\[([a-zA-Z]+):([^\]]*)\]/g;
const LRC_TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(input: string): ParsedSubtitle {
  const lines = splitLines(input);
  const raw: Array<{ start: number; text: string }> = [];
  const meta: Record<string, unknown> = {};
  const warnings: Warning[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // 元信息标签
    LRC_TAG_RE.lastIndex = 0;
    let tag: RegExpExecArray | null;
    while ((tag = LRC_TAG_RE.exec(trimmed)) !== null) {
      meta[tag[1].toLowerCase()] = tag[2];
    }

    // 正文 = 去掉元信息标签与所有时间戳标签之后剩下的部分
    const content = trimmed.replace(LRC_TAG_RE, '').replace(LRC_TIME_RE, '').trim();
    const times: number[] = [];
    LRC_TIME_RE.lastIndex = 0;
    let t: RegExpExecArray | null;
    while ((t = LRC_TIME_RE.exec(trimmed)) !== null) {
      const min = Number.parseInt(t[1], 10);
      const sec = Number.parseInt(t[2], 10);
      const fracStr = t[3] ?? '';
      const frac = fracStr ? Number.parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) : 0;
      times.push((min * 60 + sec) * 1000 + frac);
    }

    if (times.length === 0) continue;
    for (const start of times) raw.push({ start, text: content });
  }

  // [offset:+/-ms]：正值表示歌词提前显示
  const offsetRaw = meta.offset;
  const offset = typeof offsetRaw === 'string' ? Number.parseInt(offsetRaw, 10) : 0;
  if (Number.isFinite(offset) && offset !== 0) {
    for (const item of raw) item.start = Math.max(0, item.start - offset);
  }

  raw.sort((a, b) => a.start - b.start);

  const cues: Cue[] = raw.map((item, i) => {
    const next = raw[i + 1];
    const end = next ? next.start : item.start + 3000;
    return buildCue(i + 1, item.start, end, item.text);
  });

  if (cues.length === 0) {
    warnings.push({ level: 'error', code: 'unparsed', cueIds: [], message: '未解析出任何 LRC 歌词行' });
  }

  return { cues: finalizeCues(cues), meta, warnings };
}

export function serializeLrc(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const metaLines: string[] = [];
  for (const key of ['ti', 'ar', 'al', 'by']) {
    const value = doc.meta[key];
    if (typeof value === 'string' && value !== '') metaLines.push(`[${key}:${value}]`);
  }

  const lines = doc.cues.map((cue) => `${formatLrcTime(cue.start)}${flattenText(cue.text, ' ')}`);
  const all = [...metaLines, ...lines];
  return applyNewline(all.join(newline) + newline, newline);
}

export const lrcCodec: FormatCodec = {
  id: 'lrc',
  name: 'LRC 歌词 (.lrc)',
  extensions: ['lrc'],
  canImport: true,
  canExport: true,
  mimeType: 'text/plain',
  detect(head, ext) {
    if (ext === 'lrc') return 1;
    if (/^\s*(\[[a-zA-Z]+:[^\]]*\]\s*)+/.test(head) && /\[\d{1,3}:\d{1,2}/.test(head)) return 0.8;
    return 0;
  },
  parse: (text) => parseLrc(text),
  serialize: (doc, opts) => serializeLrc(doc, opts),
};

/* ================================================================== */
/* MicroDVD                                                           */
/* ================================================================== */

export const DEFAULT_MICRODVD_FPS = 23.976;

const MICRODVD_LINE_RE = /^\{(\d+)\}\{(\d+)\}(.*)$/;

function frameToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}

function msToFrame(ms: number, fps: number): number {
  return Math.max(0, Math.round((ms / 1000) * fps));
}

export function parseMicrodvd(input: string, fpsHint?: number): ParsedSubtitle {
  const lines = splitLines(input);
  const cues: Cue[] = [];
  const warnings: Warning[] = [];
  let fps = fpsHint ?? DEFAULT_MICRODVD_FPS;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const m = MICRODVD_LINE_RE.exec(line);
    if (!m) {
      warnings.push({
        level: 'warn',
        code: 'stray-text',
        cueIds: [],
        message: `第 ${i + 1} 行不是合法的 MicroDVD 行，已跳过`,
      });
      continue;
    }

    const startFrame = Number.parseInt(m[1], 10);
    const endFrame = Number.parseInt(m[2], 10);
    const body = m[3];

    // 首行的 {1}{1}25.000 是帧率声明，不是字幕
    if (cues.length === 0 && startFrame === endFrame && /^\d+(\.\d+)?$/.test(body.trim())) {
      fps = Number.parseFloat(body.trim());
      continue;
    }

    const text = body
      .replace(/\{[^}]*\}/g, '') // {y:i} 这类样式标签
      .replace(/\|/g, '\n')
      .trim();

    cues.push(buildCue(cues.length + 1, frameToMs(startFrame, fps), frameToMs(endFrame, fps), text));
  }

  if (cues.length === 0) {
    warnings.push({
      level: 'error',
      code: 'unparsed',
      cueIds: [],
      message: '未解析出任何 MicroDVD 条目',
    });
  }

  return { cues: finalizeCues(cues), meta: {}, fps, warnings };
}

export function serializeMicrodvd(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const fps = opts.fps ?? doc.fps ?? DEFAULT_MICRODVD_FPS;
  const lines = [`{1}{1}${fps.toFixed(3)}`];

  for (const cue of doc.cues) {
    const body = cue.text.replace(/\r\n|\r|\n/g, '|');
    lines.push(`{${msToFrame(cue.start, fps)}}{${msToFrame(cue.end, fps)}}${body}`);
  }

  return applyNewline(lines.join(newline) + newline, newline);
}

export const microdvdCodec: FormatCodec = {
  id: 'microdvd',
  name: 'MicroDVD (.sub)',
  extensions: ['sub'],
  canImport: true,
  canExport: true,
  mimeType: 'text/plain',
  detect(head, ext) {
    if (ext === 'sub' && /^\{\d+\}\{\d+\}/m.test(head)) return 0.95;
    if (/^\{\d+\}\{\d+\}/m.test(head)) return 0.8;
    return 0;
  },
  parse: (text, ctx) => parseMicrodvd(text, ctx.fps),
  serialize: (doc, opts) => serializeMicrodvd(doc, opts),
};

/* ================================================================== */
/* SAMI                                                               */
/* ================================================================== */

const SAMI_SYNC_RE = /<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync\b|<\/body>|$)/gi;

export function parseSami(input: string): ParsedSubtitle {
  const text = input.replace(/\r\n|\r/g, '\n');
  const cues: Cue[] = [];
  const warnings: Warning[] = [];

  const blocks: Array<{ start: number; body: string }> = [];
  SAMI_SYNC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SAMI_SYNC_RE.exec(text)) !== null) {
    blocks.push({ start: Number.parseInt(m[1], 10), body: m[2] ?? '' });
  }

  for (let i = 0; i < blocks.length; i++) {
    const body = stripHtml(blocks[i].body).replace(/&nbsp;/gi, ' ').trim();
    if (body === '') continue; // 空 SYNC 表示上一条结束
    const next = blocks[i + 1];
    const end = next ? next.start : blocks[i].start + 3000;
    cues.push(buildCue(cues.length + 1, blocks[i].start, Math.max(end, blocks[i].start + 1), decodeEntities(body)));
  }

  if (cues.length === 0) {
    warnings.push({ level: 'error', code: 'unparsed', cueIds: [], message: '未解析出任何 SAMI 条目' });
  }

  return { cues: finalizeCues(cues), meta: {}, warnings };
}

export function serializeSami(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const out: string[] = [
    '<SAMI>',
    '<HEAD>',
    '<STYLE TYPE="text/css">',
    '<!--',
    'P { font-family: Arial, sans-serif; font-size: 20pt; color: white; text-align: center; }',
    '.ZH { Name: Chinese; lang: zh-CN; SAMIType: CC; }',
    '-->',
    '</STYLE>',
    '</HEAD>',
    '<BODY>',
  ];

  doc.cues.forEach((cue, i) => {
    const body = cue.text
      .split('\n')
      .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .join('<br>');
    out.push(`<SYNC Start=${Math.round(cue.start)}><P Class=ZH>${body}`);
    const next = doc.cues[i + 1];
    // 只有下一条没有紧接着开始时，才需要显式清屏
    if (!next || next.start > cue.end) {
      out.push(`<SYNC Start=${Math.round(cue.end)}><P Class=ZH>&nbsp;`);
    }
  });

  out.push('</BODY>', '</SAMI>');
  return applyNewline(out.join(newline) + newline, newline);
}

export const samiCodec: FormatCodec = {
  id: 'sami',
  name: 'SAMI (.smi)',
  extensions: ['smi', 'sami'],
  canImport: true,
  canExport: true,
  mimeType: 'application/smil',
  detect(head, ext) {
    if (ext === 'smi' || ext === 'sami') return 1;
    if (/<sami\b/i.test(head) || /<sync\b[^>]*start=/i.test(head)) return 0.9;
    return 0;
  },
  parse: (text) => parseSami(text),
  serialize: (doc, opts) => serializeSami(doc, opts),
};

export { formatSrtTime };
export type { FormatId };
