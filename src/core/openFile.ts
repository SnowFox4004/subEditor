/**
 * 打开本地文件：字节流 → 解码 → 识别格式 → 解析 → SubtitleDoc。
 * 整个过程完全在本地完成，文件不出浏览器。
 */
import type { FormatId, ParsedSubtitle, SubtitleDoc } from './types';
import { decodeBytes } from './encoding';
import { extensionOf, getFormat, listImportFormats, parseWithFormat } from './formats';
import { createDoc } from './document';
import { validateDoc } from './validation';

export interface OpenResult {
  doc: SubtitleDoc;
  /** 实际解析成功的格式 */
  detectedFormat: FormatId;
  /** 探测到的编码 */
  detectedEncoding: string;
  /** 原文长度（字符） */
  length: number;
}

function detectNewline(text: string): '\n' | '\r\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * 把候选格式按「扩展名 + 内容特征」打分排序。
 * 排在前面不代表一定对，后面还会真的逐个试解析，以「解析出内容」为准。
 */
function rankCandidates(text: string, filename: string): FormatId[] {
  const ext = extensionOf(filename);
  const head = text.slice(0, 8192);

  const scored = listImportFormats().map((codec) => {
    let score = codec.detect(head, ext);
    if (codec.extensions.includes(ext)) score = Math.max(score, 0.95);
    return { id: codec.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.filter((s) => s.score > 0).map((s) => s.id);

  // 兜底：全都不像时按最常见的顺序试一遍
  for (const id of ['srt', 'vtt', 'ass', 'ttml', 'json'] as FormatId[]) {
    if (!ranked.includes(id)) ranked.push(id);
  }
  return ranked;
}

function attempt(
  id: FormatId,
  text: string,
  filename: string,
  fps?: number,
): ParsedSubtitle | null {
  const codec = getFormat(id);
  if (!codec?.parse) return null;
  try {
    return parseWithFormat(id, text, { filename, fps });
  } catch {
    return null;
  }
}

export function openSubtitleFile(name: string, bytes: Uint8Array): OpenResult {
  const { text, encoding, bom } = decodeBytes(bytes);
  const ranked = rankCandidates(text, name);

  let best: { id: FormatId; parsed: ParsedSubtitle } | null = null;

  for (const id of ranked) {
    const parsed = attempt(id, text, name);
    if (!parsed) continue;
    // 解析出内容就立刻采用
    if (parsed.cues.length > 0) {
      best = { id, parsed };
      break;
    }
    // 都没内容时先留着，至少能给出最像的那个格式的告警信息
    if (!best) best = { id, parsed };
  }

  // 一个条目都没解析出来 → 判定为「不是字幕文件」，直接拒绝打开。
  // 否则任何随机文本都会被当成「0 条字幕的 SRT」放进来，反而让人困惑。
  if (!best || best.parsed.cues.length === 0) {
    const hint = best?.parsed.warnings.find((w) => w.level === 'error')?.message;
    throw new Error(
      hint ? `「${name}」解析失败：${hint}` : `无法识别「${name}」的字幕格式，请确认文件内容`,
    );
  }

  const doc = createDoc({
    name,
    format: best.id,
    encoding,
    bom,
    newline: detectNewline(text),
    fps: best.parsed.fps,
    cues: best.parsed.cues,
    meta: best.parsed.meta,
    warnings: best.parsed.warnings,
  });

  // 解析告警 + 质检告警合并去重
  const merged = [...doc.warnings, ...validateDoc(doc)];
  const seen = new Set<string>();
  const deduped = merged.filter((w) => {
    const key = `${w.code}|${w.cueIds.join(',')}|${w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    doc: { ...doc, warnings: deduped },
    detectedFormat: best.id,
    detectedEncoding: encoding,
    length: text.length,
  };
}
