/**
 * 时间轴几何计算与拖拽求值。纯函数，方便单测。
 */
import type { Cue, TimeMs } from './types';
import { snapToFrame } from './timecode';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 时间 → 像素 */
export function msToPx(ms: TimeMs, pxPerSecond: number): number {
  return (ms / 1000) * pxPerSecond;
}

/** 像素 → 时间 */
export function pxToMs(px: number, pxPerSecond: number): number {
  return (px / pxPerSecond) * 1000;
}

export const MIN_PX_PER_SECOND = 0.5;
export const MAX_PX_PER_SECOND = 400;

/**
 * 让整条时间轴刚好铺满视口所需的每秒像素数。
 * totalMs 为 0 时返回一个便于手工编辑的默认值。
 */
export function fitScale(totalMs: TimeMs, viewportPx: number, paddingPx = 32): number {
  const usable = Math.max(120, viewportPx - paddingPx * 2);
  if (totalMs <= 0) return 12;
  return clamp(usable / (totalMs / 1000), MIN_PX_PER_SECOND, MAX_PX_PER_SECOND);
}

/** 刻度候选间隔（秒） */
const TICK_CANDIDATES = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
];

/** 选出使相邻刻度间距不小于 minPxPerTick 的最小间隔（秒） */
export function chooseTickInterval(pxPerSecond: number, minPxPerTick = 72): number {
  for (const c of TICK_CANDIDATES) {
    if (c * pxPerSecond >= minPxPerTick) return c;
  }
  return TICK_CANDIDATES[TICK_CANDIDATES.length - 1];
}

/** 生成刻度位置（毫秒） */
export function buildTicks(
  totalMs: TimeMs,
  pxPerSecond: number,
  minPxPerTick = 72,
): number[] {
  const interval = chooseTickInterval(pxPerSecond, minPxPerTick) * 1000;
  const ticks: number[] = [];
  if (totalMs <= 0 || interval <= 0) return ticks;
  // 上限保护：视口极宽 + 缩放到极限时避免生成几十万个刻度
  const maxTicks = 500;
  for (let t = 0; t <= totalMs + interval && ticks.length < maxTicks; t += interval) {
    ticks.push(Math.round(t));
  }
  return ticks;
}

/**
 * 吸附：在阈值范围内找最近的候选点，找不到就原样返回。
 */
export function snapToNearest(
  value: TimeMs,
  candidates: TimeMs[],
  thresholdMs: number,
): TimeMs {
  let best = value;
  let bestDist = thresholdMs;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export type DragMode = 'move' | 'start' | 'end';

export interface DragOptions {
  /** 允许的最短显示时长 */
  minDurationMs?: number;
  /** 若提供，则时间吸附到帧 */
  fps?: number | null;
  /** 吸附候选点（其它条目的首尾、播放头、0） */
  snapCandidates?: TimeMs[];
  /** 吸附阈值（毫秒），通常由像素阈值换算而来 */
  snapThresholdMs?: number;
}

function normalize(start: number, end: number, opts: DragOptions): { start: number; end: number } {
  const minDuration = opts.minDurationMs ?? 100;
  let s = Math.max(0, Math.round(start));
  let e = Math.max(0, Math.round(end));
  if (e - s < minDuration) e = s + minDuration;
  if (opts.fps) {
    s = snapToFrame(s, opts.fps);
    e = snapToFrame(e, opts.fps);
    if (e - s < minDuration) e = s + minDuration;
  }
  return { start: s, end: e };
}

/**
 * 计算拖拽后的新起止时间。
 * - move：整体平移，保持时长
 * - start：只改开始时间，不允许越过结束时间
 * - end：只改结束时间，不允许越过开始时间
 */
export function applyDrag(
  orig: { start: TimeMs; end: TimeMs },
  mode: DragMode,
  deltaMs: number,
  opts: DragOptions = {},
): { start: TimeMs; end: TimeMs } {
  const minDuration = opts.minDurationMs ?? 100;
  const threshold = opts.snapThresholdMs ?? 0;
  const candidates = opts.snapCandidates ?? [];

  if (mode === 'move') {
    let start = Math.max(0, orig.start + deltaMs);
    if (candidates.length > 0 && threshold > 0) {
      start = snapToNearest(start, candidates, threshold);
    }
    const duration = orig.end - orig.start;
    return normalize(start, start + duration, { ...opts, minDurationMs: minDuration });
  }

  if (mode === 'start') {
    let start = clamp(orig.start + deltaMs, 0, orig.end - minDuration);
    if (candidates.length > 0 && threshold > 0) {
      start = clamp(snapToNearest(start, candidates, threshold), 0, orig.end - minDuration);
    }
    return normalize(start, orig.end, { ...opts, minDurationMs: minDuration });
  }

  let end = Math.max(orig.start + minDuration, orig.end + deltaMs);
  if (candidates.length > 0 && threshold > 0) {
    end = Math.max(orig.start + minDuration, snapToNearest(end, candidates, threshold));
  }
  return normalize(orig.start, end, { ...opts, minDurationMs: minDuration });
}

/**
 * 把拖拽结果应用到一组条目上（支持多选整体平移），返回新的 cues 数组。
 * 只改动时间与 dirty 标记，其余字段原样保留。
 */
export function applyDragToCues(
  cues: Cue[],
  ids: string[],
  mode: DragMode,
  deltaMs: number,
  opts: DragOptions = {},
): Cue[] {
  const target = new Set(ids);
  // 吸附候选排除被拖拽的条目自身
  const candidates = (opts.snapCandidates ?? []).filter((c) => Number.isFinite(c));
  const excluded = new Set<TimeMs>();
  for (const cue of cues) {
    if (target.has(cue.id)) {
      excluded.add(cue.start);
      excluded.add(cue.end);
    }
  }
  const usableCandidates =
    candidates.length > 0 && excluded.size > 0
      ? candidates.filter((c) => !excluded.has(c))
      : candidates;

  return cues.map((cue) => {
    if (!target.has(cue.id)) return cue;
    const next = applyDrag(cue, mode, deltaMs, { ...opts, snapCandidates: usableCandidates });
    if (next.start === cue.start && next.end === cue.end) return cue;
    return { ...cue, start: next.start, end: next.end, dirty: true };
  });
}

/** 收集可作为吸附点的位置：其它条目的首尾、0、以及可选的播放头 */
export function collectSnapPoints(
  cues: Cue[],
  excludeIds: string[] = [],
  extra: TimeMs[] = [],
): TimeMs[] {
  const exclude = new Set(excludeIds);
  const points: TimeMs[] = [0, ...extra];
  for (const cue of cues) {
    if (exclude.has(cue.id)) continue;
    points.push(cue.start, cue.end);
  }
  return points;
}

function pad2(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(2, '0');
}

/** 时间轴刻度文字；间隔小于 1 秒时补上一位小数 */
export function formatTickLabel(ms: TimeMs, intervalMs: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  const base = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  return intervalMs < 1000 ? `${base}.${Math.floor(frac / 100)}` : base;
}
