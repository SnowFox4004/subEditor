/**
 * 格式注册表。
 * 新增一种格式 = 新增一个 formats/xxx.ts + 在这里 register 一行，UI 层完全不用改。
 */
import type { FormatCodec, FormatId, ParsedSubtitle, SerializeOptions, SubtitleDoc } from '../types';

const codecs = new Map<FormatId, FormatCodec>();

export function registerFormat(codec: FormatCodec): void {
  codecs.set(codec.id, codec);
}

export function getFormat(id: FormatId): FormatCodec | undefined {
  return codecs.get(id);
}

export function listFormats(): FormatCodec[] {
  return [...codecs.values()];
}

export function listImportFormats(): FormatCodec[] {
  return listFormats().filter((c) => c.canImport && c.parse);
}

export function listExportFormats(): FormatCodec[] {
  return listFormats().filter((c) => c.canExport && c.serialize);
}

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * 按「扩展名 + 内容特征」选出最合适的格式。
 * 扩展名命中直接给高分，内容特征用于扩展名缺失或写错的情况。
 */
export function detectFormat(text: string, filename = ''): FormatId | null {
  const ext = extensionOf(filename);
  const head = text.slice(0, 4096);

  let best: { id: FormatId; score: number } | null = null;
  for (const codec of listImportFormats()) {
    let score = codec.detect(head, ext);
    if (codec.extensions.includes(ext)) score = Math.max(score, 0.95);
    if (score > 0 && (!best || score > best.score)) {
      best = { id: codec.id, score };
    }
  }
  return best?.id ?? null;
}

export function parseWithFormat(
  id: FormatId,
  text: string,
  ctx: { filename?: string; fps?: number } = {},
): ParsedSubtitle {
  const codec = getFormat(id);
  if (!codec?.parse) {
    throw new Error(`不支持导入 ${id} 格式`);
  }
  return codec.parse(text, ctx);
}

export function serializeWithFormat(
  id: FormatId,
  doc: SubtitleDoc,
  opts: SerializeOptions = {},
): string {
  const codec = getFormat(id);
  if (!codec?.serialize) {
    throw new Error(`不支持导出 ${id} 格式`);
  }
  return codec.serialize(doc, opts);
}
