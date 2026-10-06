/**
 * 超长条目切分。
 *
 * 思路：把一条过长的字幕重新断行，再把若干行打包成若干条新字幕，
 * 时间按各段字符数比例分配 —— 也就是「说话多的那段占的时间长」。
 *
 * 纯函数，无 DOM / React 依赖，可脱离浏览器单测。
 */
import type { Cue, SubtitleDoc, TimeMs } from './types';
import { createCue, renumber, replaceCues } from './document';

/** 可作为断点的标点与空白。断点字符归属前一段 */
const BREAK_RE = /[，。！？；：、,.!?;:…—～"'”’）)】」』\]\s]/;

/** 兜底保护：单条最多切出这么多段 */
const MAX_PIECES = 60;

export interface SplitOptions {
  /** 每行最多字符数 */
  maxCharsPerLine: number;
  /** 每条最多行数 */
  linesPerCue: number;
  /** 切分后每条最短显示时长（毫秒）—— 时长不够时宁可不切 */
  minDurationMs: number;
  /** 是否优先在标点处断开 */
  breakOnPunctuation: boolean;
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = {
  maxCharsPerLine: 20,
  linesPerCue: 2,
  minDurationMs: 800,
  breakOnPunctuation: true,
};

export interface SplitPiece {
  text: string;
  start: TimeMs;
  end: TimeMs;
}

export interface SplitPlan {
  /** `${docId}::${cueId}`，用作采纳/拒绝的标识 */
  id: string;
  docId: string;
  cueId: string;
  /** 原序号，仅用于展示 */
  index: number;
  before: { text: string; start: TimeMs; end: TimeMs };
  pieces: SplitPiece[];
  /** 因为总时长不够，实际切出的段数少于理想段数 */
  durationLimited: boolean;
}

/* ------------------------------------------------------------------ */
/* 断行                                                                */
/* ------------------------------------------------------------------ */

function chunkLine(line: string, max: number, breakOnPunctuation: boolean): string[] {
  const limit = Math.max(4, Math.floor(max));
  if (line.length <= limit) return [line];

  const chunks: string[] = [];
  let rest = line;
  let guard = 0;

  while (rest.length > limit && guard++ < MAX_PIECES) {
    const window = rest.slice(0, limit);
    let cut = -1;

    if (breakOnPunctuation) {
      // 从窗口末尾往前找标点。限定最小切分长度，避免切出「嗯，」这种碎片
      const minCut = Math.max(1, Math.floor(limit * 0.5));
      for (let i = window.length - 1; i >= minCut; i--) {
        if (BREAK_RE.test(window[i])) {
          cut = i + 1;
          break;
        }
      }
    }

    if (cut <= 0) cut = limit;

    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

/** 先按原有换行硬切，再对每行做长度切分 */
export function splitTextIntoLines(
  text: string,
  maxCharsPerLine: number,
  breakOnPunctuation: boolean,
): string[] {
  const hardLines = text
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

  const out: string[] = [];
  for (const line of hardLines) {
    out.push(...chunkLine(line, maxCharsPerLine, breakOnPunctuation));
  }
  return out;
}

function groupArray<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) {
    groups.push(items.slice(i, i + step));
  }
  return groups;
}

/** 段数太多时，从尾部开始两两合并，直到不超过 maxCount */
function reduceGroups(groups: string[][], maxCount: number): string[][] {
  const out = groups.map((g) => [...g]);
  while (out.length > maxCount && out.length > 1) {
    const tail = out.pop() as string[];
    out[out.length - 1].push(...tail);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 时间分配                                                            */
/* ------------------------------------------------------------------ */

/**
 * 按权重（字符数）把 [start, end] 分配给 n 段。
 * 保证：每段 ≥ minDurationMs，首段从 start 开始，末段到 end 结束，中间无缝无叠。
 * 时长不够时返回 null。
 */
export function allocateTimes(
  start: TimeMs,
  end: TimeMs,
  weights: number[],
  minDurationMs: number,
): Array<{ start: TimeMs; end: TimeMs }> | null {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [{ start, end }];

  const span = end - start;
  if (span < minDurationMs * n) return null;

  const total = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const out: Array<{ start: TimeMs; end: TimeMs }> = [];
  let cursor = start;

  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push({ start: cursor, end });
      break;
    }
    const remaining = n - 1 - i;
    const share = Math.round((span * Math.max(0, weights[i])) / total);
    // 上限：给后面每段至少留 minDurationMs；下限：本段至少 minDurationMs
    const upper = end - remaining * minDurationMs;
    const lower = cursor + minDurationMs;
    const segEnd = Math.max(lower, Math.min(upper, cursor + share));
    out.push({ start: cursor, end: segEnd });
    cursor = segEnd;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* 生成切分方案                                                        */
/* ------------------------------------------------------------------ */

/**
 * 这条字幕是否真的会被切分。
 *
 * 必须和 planSplitForCue 完全等价 —— 否则「切分超长条目（N 条）」上的数字
 * 会和点进去之后的预览对不上（21~40 字的条目就能触发这种不一致：
 * 它确实超长，但重新断行后仍装得进一条，不值得拆成多条）。
 */
export function needsSplit(cue: Cue, opts: SplitOptions): boolean {
  if (cue.locked) return false;

  // 时长不够切成两条，切了也是看不清的碎条目
  if (cue.end - cue.start < opts.minDurationMs * 2) return false;

  const rawLines = cue.text.replace(/\r\n|\r/g, '\n').split('\n');
  const maxPerCue = opts.maxCharsPerLine * opts.linesPerCue;
  const overlongLine = rawLines.some((l) => l.length > opts.maxCharsPerLine);
  const tooManyLines = rawLines.length > opts.linesPerCue;
  const tooLongTotal = cue.text.replace(/\n/g, '').length > maxPerCue;

  if (!overlongLine && !tooManyLines && !tooLongTotal) return false;

  // 真的断行之后，必须能凑出超过 linesPerCue 行，才谈得上拆成多条
  const lines = splitTextIntoLines(cue.text, opts.maxCharsPerLine, opts.breakOnPunctuation);
  return lines.length > opts.linesPerCue;
}

export function planSplitForCue(
  cue: Cue,
  docId: string,
  opts: SplitOptions,
): SplitPlan | null {
  if (!needsSplit(cue, opts)) return null;

  const lines = splitTextIntoLines(cue.text, opts.maxCharsPerLine, opts.breakOnPunctuation);
  if (lines.length < 2) return null;

  const span = cue.end - cue.start;
  const maxPiecesByDuration = Math.floor(span / Math.max(1, opts.minDurationMs));
  if (maxPiecesByDuration < 2) return null; // 时长只够一条，不值得切

  let groups = groupArray(lines, opts.linesPerCue);
  if (groups.length < 2) return null;

  let durationLimited = false;
  if (groups.length > maxPiecesByDuration) {
    groups = reduceGroups(groups, maxPiecesByDuration);
    durationLimited = true;
  }

  const texts = groups.map((g) => g.join('\n'));
  const weights = texts.map((t) => t.replace(/\n/g, '').length);
  const times = allocateTimes(cue.start, cue.end, weights, opts.minDurationMs);
  if (!times) return null;

  return {
    id: `${docId}::${cue.id}`,
    docId,
    cueId: cue.id,
    index: cue.index,
    before: { text: cue.text, start: cue.start, end: cue.end },
    pieces: texts.map((text, i) => ({ text, start: times[i].start, end: times[i].end })),
    durationLimited,
  };
}

export function planSplits(docs: SubtitleDoc[], opts: SplitOptions = DEFAULT_SPLIT_OPTIONS): SplitPlan[] {
  const plans: SplitPlan[] = [];
  for (const doc of docs) {
    for (const cue of doc.cues) {
      const plan = planSplitForCue(cue, doc.id, opts);
      if (plan) plans.push(plan);
    }
  }
  return plans;
}

/** 按切分口径统计会被改动的条数（用于按钮上的计数） */
export function countSplittable(docs: SubtitleDoc[], opts: SplitOptions): number {
  let count = 0;
  for (const doc of docs) {
    for (const cue of doc.cues) {
      if (needsSplit(cue, opts)) count++;
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* 应用                                                                */
/* ------------------------------------------------------------------ */

export function applySplitPlans(
  doc: SubtitleDoc,
  plans: SplitPlan[],
  accepted: ReadonlySet<string>,
): SubtitleDoc {
  const byCue = new Map<string, SplitPlan>();
  for (const plan of plans) {
    if (plan.docId !== doc.id) continue;
    if (!accepted.has(plan.id)) continue;
    byCue.set(plan.cueId, plan);
  }
  if (byCue.size === 0) return doc;

  const cues: Cue[] = [];
  for (const cue of doc.cues) {
    const plan = byCue.get(cue.id);
    if (!plan) {
      cues.push(cue);
      continue;
    }
    for (const piece of plan.pieces) {
      cues.push(
        createCue({
          start: piece.start,
          end: piece.end,
          text: piece.text,
          speaker: cue.speaker,
          style: cue.style,
        }),
      );
    }
  }

  return renumber(replaceCues(doc, cues));
}

export interface SplitSummary {
  /** 会被改动的原条目数 */
  cueCount: number;
  /** 切分后新增的条目数 */
  addedCount: number;
  /** 涉及的文档数 */
  docCount: number;
  /** 其中因时长不足而未能切到理想的条数 */
  limitedCount: number;
}

export function summarizeSplits(plans: SplitPlan[]): SplitSummary {
  let added = 0;
  let limited = 0;
  for (const plan of plans) {
    added += plan.pieces.length - 1;
    if (plan.durationLimited) limited++;
  }
  return {
    cueCount: plans.length,
    addedCount: added,
    docCount: new Set(plans.map((p) => p.docId)).size,
    limitedCount: limited,
  };
}
