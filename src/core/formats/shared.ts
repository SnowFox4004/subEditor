/**
 * 各格式 codec 共用的文本工具。
 */
import type { Cue, TimeMs } from '../types';
import { createCue } from '../document';

/** 统一换行为 \n，并去掉 BOM */
export function normalizeNewlines(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
}

export function splitLines(text: string): string[] {
  return normalizeNewlines(text).split('\n');
}

/** 去掉 HTML / XML 内联标签，把 <br> 换成换行 */
export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 去掉 HTML 标签与实体，得到纯文本（用于 SAMI / TTML 正文） */
export function plainText(html: string): string {
  return decodeEntities(stripHtml(html)).replace(/\u00a0/g, ' ').trim();
}

/** 统一构造 cue，保证各 codec 行为一致 */
export function buildCue(
  index: number,
  start: TimeMs,
  end: TimeMs,
  text: string,
  extra: Partial<Pick<Cue, 'speaker' | 'style'>> = {},
): Cue {
  return createCue({
    index,
    start,
    end,
    text,
    speaker: extra.speaker,
    style: extra.style,
    dirty: false,
  });
}

/** 按开始时间排序并重新编号，最后一条的 end 缺失时补一个合理值 */
export function finalizeCues(cues: Cue[], fallbackDurationMs = 3000): Cue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.map((cue, i) => ({
    ...cue,
    index: i + 1,
    end: cue.end > cue.start ? cue.end : cue.start + fallbackDurationMs,
  }));
}

/** 把多行正文压成单行（LRC / TXT 这类不支持换行的格式用） */
export function flattenText(text: string, separator = ' '): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(separator);
}
