/**
 * 编码探测与转换。
 *
 * 解码：依赖浏览器 / Node 内置的 TextDecoder（WHATWG Encoding 标准要求实现
 *       utf-8、gb18030、big5、shift_jis、euc-kr 等常见标签），零依赖。
 * 编码：utf-8 / utf-8-bom / utf-16le / utf-16be 原生支持；
 *       gb18030 / big5 等需要查表，由编码器注册表按需挂载（见 registerEncoder）。
 */

export interface DecodedText {
  text: string;
  /** 探测出的编码标签 */
  encoding: string;
  bom: boolean;
}

export type EncodeFn = (text: string) => Uint8Array;

interface BomSpec {
  bytes: number[];
  encoding: string;
}

const BOMS: BomSpec[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

/** CJK 候选编码，按中文场景命中概率排序 */
const CJK_CANDIDATES = ['gb18030', 'big5', 'shift_jis', 'euc-kr', 'windows-1252'];

function matchBom(bytes: Uint8Array): BomSpec | null {
  for (const spec of BOMS) {
    if (bytes.length < spec.bytes.length) continue;
    if (spec.bytes.every((b, i) => bytes[i] === b)) return spec;
  }
  return null;
}

export function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/**
 * 从字节流探测编码并解码。
 * 策略：BOM 优先 → 严格 UTF-8 → 严格 CJK 候选 → 宽松 UTF-8 兜底。
 */
export function decodeBytes(input: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = toUint8Array(input);

  const bom = matchBom(bytes);
  if (bom) {
    const body = bytes.subarray(bom.bytes.length);
    try {
      const text = new TextDecoder(bom.encoding).decode(body);
      return { text, encoding: bom.encoding, bom: true };
    } catch {
      /* 落到下面继续尝试 */
    }
  }

  // 严格 UTF-8：只有全部字节合法才会成功
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8', bom: false };
  } catch {
    /* 不是合法 UTF-8 */
  }

  for (const enc of CJK_CANDIDATES) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(bytes);
      return { text, encoding: enc, bom: false };
    } catch {
      /* 换下一个候选 */
    }
  }

  // 兜底：宽松 UTF-8，非法字节会变成 U+FFFD，由用户在 UI 里手动切换编码
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    encoding: 'utf-8',
    bom: false,
  };
}

/** 用指定编码重新解码（用户在 UI 手动切换编码时调用） */
export function decodeBytesAs(
  input: ArrayBuffer | Uint8Array,
  encoding: string,
  bom = false,
): string {
  const bytes = toUint8Array(input);
  let body = bytes;
  if (bom) {
    const spec = matchBom(bytes);
    if (spec) body = bytes.subarray(spec.bytes.length);
  }
  try {
    return new TextDecoder(encoding).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/* ------------------------------------------------------------------ */
/* 编码器注册表                                                        */
/* ------------------------------------------------------------------ */

const encoders = new Map<string, EncodeFn>();

/** 供后续按需挂载（如 M5 通过动态 import 引入 GBK 码表） */
export function registerEncoder(encoding: string, fn: EncodeFn): void {
  encoders.set(encoding.toLowerCase(), fn);
}

export function hasEncoder(encoding: string): boolean {
  return encoders.has(encoding.toLowerCase()) || NATIVE_ENCODINGS.has(encoding.toLowerCase());
}

export const NATIVE_ENCODINGS = new Set(['utf-8', 'utf8', 'utf-16le', 'utf-16be']);

/** UI 可选编码列表；可用性由 hasEncoder 决定 */
export const ENCODING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-8-bom', label: 'UTF-8 with BOM' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'gb18030', label: 'GB18030 / GBK' },
  { value: 'big5', label: 'BIG5' },
];

function encodeUtf8(text: string, withBom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!withBom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2 + 2);
  const view = new DataView(out.buffer);
  if (littleEndian) {
    out[0] = 0xff;
    out[1] = 0xfe;
  } else {
    out[0] = 0xfe;
    out[1] = 0xff;
  }
  for (let i = 0; i < text.length; i++) {
    view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian);
  }
  return out;
}

/**
 * 把文本编码为字节流。不支持的目标编码会抛错，由调用方提示用户。
 */
export function encodeText(text: string, encoding = 'utf-8'): Uint8Array {
  const enc = encoding.toLowerCase();
  if (enc === 'utf-8' || enc === 'utf8') return encodeUtf8(text, false);
  if (enc === 'utf-8-bom' || enc === 'utf8-bom') return encodeUtf8(text, true);
  if (enc === 'utf-16le') return encodeUtf16(text, true);
  if (enc === 'utf-16be') return encodeUtf16(text, false);

  const custom = encoders.get(enc);
  if (custom) return custom(text);

  throw new Error(
    `暂不支持导出为 ${encoding}。当前可用：UTF-8、UTF-8 with BOM、UTF-16 LE/LE、GB18030、BIG5。`,
  );
}

/** 把换行符统一成目标风格 */
export function applyNewline(text: string, newline: '\n' | '\r\n'): string {
  const normalized = text.replace(/\r\n|\r|\n/g, '\n');
  return newline === '\n' ? normalized : normalized.replace(/\n/g, '\r\n');
}
