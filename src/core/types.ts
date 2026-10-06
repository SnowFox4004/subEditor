/**
 * 核心数据模型。
 * 本文件及 src/core/ 下所有模块禁止 import React —— 保证 Vitest 可脱离 DOM 直接运行。
 */

/** 内部统一用毫秒整数，杜绝浮点误差与格式歧义 */
export type TimeMs = number;

export type FormatId =
  | 'srt'
  | 'vtt'
  | 'ass'
  | 'ssa'
  | 'ttml'
  | 'sbv'
  | 'lrc'
  | 'microdvd'
  | 'sami'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'txt';

export interface Cue {
  /** 稳定 UUID：React key / diff 定位 / 跨标签引用都靠它 */
  id: string;
  /** 显示序号；导出时统一重排 */
  index: number;
  start: TimeMs;
  end: TimeMs;
  /** 多行用 \n；保留 <i> <b> {\an8} 等标签 */
  text: string;
  /** ASS / TTML 的说话人 */
  speaker?: string;
  /** ASS 样式、TTML region 等，尽量原样保留不丢 */
  style?: Record<string, string>;
  /** 锁定后批量替换 / 批量操作跳过此条 */
  locked: boolean;
  /** 相对导入时的原始值是否被改过 */
  dirty: boolean;
}

export type WarningCode =
  | 'overlap'
  | 'negative-duration'
  | 'bad-timecode'
  | 'duplicate-index'
  | 'missing-index'
  | 'empty-text'
  | 'too-long-line'
  | 'stray-text'
  | 'unparsed';

export type WarningLevel = 'error' | 'warn' | 'info';

export interface Warning {
  level: WarningLevel;
  code: WarningCode;
  cueIds: string[];
  message: string;
}

export interface SubtitleDoc {
  id: string;
  /** 原始文件名 */
  name: string;
  /** 源格式，决定默认导出格式 */
  format: FormatId;
  /** 源编码（utf-8 / gbk / big5 / utf-16le…） */
  encoding: string;
  bom: boolean;
  newline: '\n' | '\r\n';
  /** MicroDVD 帧率 */
  fps?: number;
  cues: Cue[];
  /** ASS 的 [Script Info] / [V4+ Styles] 等头信息，导出时回写 */
  meta: Record<string, unknown>;
  /** 解析告警。绝不擅自修改用户数据，只记录 */
  warnings: Warning[];
  /** 单调递增版本号，用于撤销重做与冲突检测 */
  rev: number;
}

/* ------------------------------------------------------------------ */
/* 格式编解码                                                          */
/* ------------------------------------------------------------------ */

export interface ParseContext {
  /** 文件名（含扩展名） */
  filename?: string;
  /** 已解析出的 fps，MicroDVD 需要 */
  fps?: number;
}

export interface ParsedSubtitle {
  cues: Cue[];
  meta: Record<string, unknown>;
  fps?: number;
  warnings: Warning[];
}

export interface SerializeOptions {
  /** 换行符 */
  newline?: '\n' | '\r\n';
  /** 是否重新编号（默认 true） */
  renumber?: boolean;
  /** MicroDVD 帧率 */
  fps?: number;
  /** 输出编码标签，仅用于 UI 展示；实际编码在 encoding.ts 处理 */
  encoding?: string;
}

export interface FormatCodec {
  id: FormatId;
  /** 人类可读名称 */
  name: string;
  extensions: string[];
  canImport: boolean;
  canExport: boolean;
  mimeType: string;
  /**
   * 置信度打分，0~1。用于在多个 codec 都能解析时选出最合适的那个。
   * head 为文件前若干字符，ext 为小写扩展名（不含点）。
   */
  detect: (head: string, ext: string) => number;
  parse?: (text: string, ctx: ParseContext) => ParsedSubtitle;
  serialize?: (doc: SubtitleDoc, opts: SerializeOptions) => string;
}

/* ------------------------------------------------------------------ */
/* 批量替换                                                            */
/* ------------------------------------------------------------------ */

export interface ReplaceRule {
  id: string;
  name: string;
  mode: 'literal' | 'regex';
  pattern: string;
  /** 正则模式支持 $1 / $<name> 反向引用 */
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: 'text' | 'speaker' | 'both';
  enabled: boolean;
}

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface Change {
  id: string;
  docId: string;
  cueId: string;
  field: 'text' | 'speaker' | 'start' | 'end';
  before: string;
  after: string;
  /** 字符级 diff，用于高亮 */
  segments: DiffSegment[];
  /** 最后一条改动该字段的规则 */
  ruleId: string | null;
  /** 所有命中该字段的规则（按应用顺序） */
  ruleIds: string[];
}

/** 批量替换的作用范围 */
export type ReplaceScope =
  | { kind: 'current' }
  | { kind: 'docs'; docIds: string[] }
  | { kind: 'all' };
