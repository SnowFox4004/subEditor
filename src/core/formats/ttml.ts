/**
 * TTML / DFXP 解析与序列化。
 *
 * 说明：core 层不能依赖 DOMParser（单测跑在 Node 环境），而 TTML 的结构
 * 非常简单（body/div/p），所以这里用正则抽取 <p> 元素。对标准交付文件足够，
 * 对带命名空间前缀（如 `<tt:p>`）的写法也做了兼容。
 */
import type { Cue, FormatCodec, ParsedSubtitle, SerializeOptions, SubtitleDoc, Warning } from '../types';
import { formatSrtTime, parseTimecode } from '../timecode';
import { applyNewline } from '../encoding';
import { buildCue, escapeXml, finalizeCues, normalizeNewlines, plainText } from './shared';

const DEFAULT_FPS = 25;

/**
 * 解析 TTML 时间表达式。
 * 支持 clock 形式 `HH:MM:SS.mmm` / `HH:MM:SS:FF`，
 * 以及 offset 形式 `1.5s` / `1500ms` / `2m` / `1h` / `25f` / `10t`。
 */
export function parseTtmlTime(raw: string | undefined, fps = DEFAULT_FPS): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value === '') return null;

  // clock 形式（含帧号）
  if (value.includes(':')) {
    const clockFrames = /^(\d+):(\d{2}):(\d{2}):(\d{1,3})$/.exec(value);
    if (clockFrames) {
      const [, h, m, s, f] = clockFrames;
      const base = ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
      return base + Math.round((Number(f) / fps) * 1000);
    }
    return parseTimecode(value);
  }

  const offset = /^(\d+(?:\.\d+)?)\s*(h|m|s|ms|f|t)$/i.exec(value);
  if (offset) {
    const n = Number.parseFloat(offset[1]);
    if (!Number.isFinite(n)) return null;
    switch (offset[2].toLowerCase()) {
      case 'h':
        return Math.round(n * 3_600_000);
      case 'm':
        return Math.round(n * 60_000);
      case 's':
        return Math.round(n * 1000);
      case 'ms':
        return Math.round(n);
      case 'f':
        return Math.round((n / fps) * 1000);
      case 't':
        // tick：TTML 默认 1 tick = 1/10 秒（未声明 ttp:tickRate 时）
        return Math.round(n * 100);
      default:
        return null;
    }
  }

  // 纯数字按毫秒处理
  const plain = Number.parseFloat(value);
  return Number.isFinite(plain) ? Math.round(plain) : null;
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tag);
  if (!m) return undefined;
  return m[2] ?? m[3];
}

export function parseTtml(input: string): ParsedSubtitle {
  const text = normalizeNewlines(input);
  const cues: Cue[] = [];
  const warnings: Warning[] = [];

  const fpsAttr = /ttp:frameRate\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(text);
  const fps = fpsAttr ? Number.parseFloat(fpsAttr[1]) : DEFAULT_FPS;

  const langAttr = /xml:lang\s*=\s*["']([^"']+)["']/i.exec(text);
  const lang = langAttr?.[1] ?? 'zh-CN';

  const pRe = /<(?:\w+:)?p\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?p\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pRe.exec(text)) !== null) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';

    const begin = parseTtmlTime(attr(attrs, 'begin'), fps);
    const explicitEnd = parseTtmlTime(attr(attrs, 'end'), fps);
    const dur = parseTtmlTime(attr(attrs, 'dur'), fps);

    if (begin === null) {
      warnings.push({
        level: 'warn',
        code: 'bad-timecode',
        cueIds: [],
        message: `存在没有 begin 属性的 <p>，已跳过：${inner.slice(0, 40)}`,
      });
      continue;
    }

    const body = plainText(inner);
    const cue = buildCue(cues.length + 1, begin, explicitEnd ?? begin, body);
    const region = attr(attrs, 'region');
    const style = attr(attrs, 'style');
    const id = attr(attrs, 'id');
    const styleMap: Record<string, string> = {};
    if (region) styleMap.region = region;
    if (style) styleMap.style = style;
    if (id) styleMap.ttmlId = id;
    if (Object.keys(styleMap).length > 0) cue.style = styleMap;

    if (explicitEnd === null && dur === null) {
      warnings.push({
        level: 'info',
        code: 'bad-timecode',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条缺少 end/dur，结束时间将由下一条推断`,
      });
    } else if (explicitEnd === null && dur !== null) {
      cue.end = begin + dur;
    }

    cues.push(cue);
  }

  // 缺 end 的条目用下一条的 begin 补齐；最后一条给 3 秒
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].end <= cues[i].start) {
      cues[i].end = cues[i + 1] ? cues[i + 1].start : cues[i].start + 3000;
    }
  }

  if (cues.length === 0) {
    warnings.push({
      level: 'error',
      code: 'unparsed',
      cueIds: [],
      message: '未解析出任何 TTML 字幕条目',
    });
  }

  return { cues: finalizeCues(cues), meta: { ttmlLang: lang, fps }, warnings };
}

export function serializeTtml(doc: SubtitleDoc, opts: SerializeOptions = {}): string {
  const newline = opts.newline ?? doc.newline ?? '\n';
  const lang = (doc.meta.ttmlLang as string | undefined) ?? 'zh-CN';

  const body = doc.cues
    .map((cue) => {
      const lines = cue.text.split('\n').map((l) => escapeXml(l));
      const inner = lines.join('<br/>');
      const region = cue.style?.region ? ` region="${escapeXml(cue.style.region)}"` : '';
      return `      <p begin="${formatSrtTime(cue.start)}" end="${formatSrtTime(cue.end)}"${region}>${inner}</p>`;
    })
    .join(newline);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter"',
    `    ttp:frameRate="${doc.fps ?? 25}" xml:lang="${escapeXml(lang)}">`,
    '  <head>',
    '    <styling>',
    '      <style xml:id="default" tts:fontSize="100%" tts:textAlign="center"/>',
    '    </styling>',
    '  </head>',
    '  <body>',
    '    <div>',
    body,
    '    </div>',
    '  </body>',
    '</tt>',
  ];

  return applyNewline(lines.filter((l) => l !== '').join(newline) + newline, newline);
}

export const ttmlCodec: FormatCodec = {
  id: 'ttml',
  name: 'TTML / DFXP (.ttml / .xml / .dfxp)',
  extensions: ['ttml', 'dfxp', 'xml'],
  canImport: true,
  canExport: true,
  mimeType: 'application/ttml+xml',
  detect(head, ext) {
    if (ext === 'ttml' || ext === 'dfxp') return 1;
    if (/<(?:\w+:)?tt[\s>]/i.test(head) && /ttml/i.test(head)) return 0.9;
    if (/<tt\b/i.test(head) && /<p\b/i.test(head)) return 0.6;
    if (ext === 'xml' && /<tt\b/i.test(head)) return 0.7;
    return 0;
  },
  parse: (text) => parseTtml(text),
  serialize: (doc, opts) => serializeTtml(doc, opts),
};

export type { Cue };
