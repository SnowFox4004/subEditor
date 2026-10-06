/**
 * 时间码解析与格式化。
 * 容错目标：`,` 与 `.` 混用、缺毫秒、全角冒号、多余空格、只有 MM:SS 甚至只有 SS。
 */
import type { TimeMs } from './types';

export interface TimeParts {
  neg: boolean;
  h: number;
  m: number;
  s: number;
  ms: number;
}

function pad(n: number, len = 2): string {
  return String(Math.abs(Math.trunc(n))).padStart(len, '0');
}

/**
 * 解析时间码为毫秒。无法解析返回 null（绝不抛异常）。
 * 支持：`01:23:45,678` / `01:23:45.678` / `23:45.678` / `45.678` / `45`
 */
export function parseTimecode(raw: string | null | undefined): TimeMs | null {
  if (typeof raw !== 'string') return null;

  let s = raw.trim();
  if (!s) return null;

  // 全角标点归一化
  s = s
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/[．。]/g, '.')
    .replace(/\s+/g, '');

  // 小数分隔符统一为 '.'
  s = s.replace(',', '.');

  const parts = s.split(':');
  if (parts.length === 0 || parts.length > 3) return null;

  const last = parts[parts.length - 1];
  const dot = last.indexOf('.');
  let secStr = last;
  let fracStr = '';
  if (dot >= 0) {
    secStr = last.slice(0, dot);
    fracStr = last.slice(dot + 1);
  }

  if (!/^\d*$/.test(secStr) || !/^\d*$/.test(fracStr)) return null;
  if (secStr === '' && fracStr === '') return null;

  const seconds = secStr === '' ? 0 : Number.parseInt(secStr, 10);

  let frac = 0;
  if (fracStr) {
    // 超过 3 位直接截断；不足 3 位右侧补零（`,5` → 500ms）
    const f = fracStr.length > 3 ? fracStr.slice(0, 3) : fracStr.padEnd(3, '0');
    frac = Number.parseInt(f, 10);
  }

  let totalSeconds = 0;
  if (parts.length === 3) {
    const h = Number.parseInt(parts[0], 10);
    const m = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    totalSeconds = (h * 60 + m) * 60 + seconds;
  } else if (parts.length === 2) {
    const m = Number.parseInt(parts[0], 10);
    if (!Number.isFinite(m)) return null;
    totalSeconds = m * 60 + seconds;
  } else {
    totalSeconds = seconds;
  }

  return totalSeconds * 1000 + frac;
}

/** 毫秒拆成时分秒毫秒 */
export function splitTime(ms: TimeMs): TimeParts {
  const neg = ms < 0;
  let t = Math.abs(Math.round(ms));
  const msPart = t % 1000;
  t = (t - msPart) / 1000;
  const s = t % 60;
  t = (t - s) / 60;
  const m = t % 60;
  t = (t - m) / 60;
  return { neg, h: t, m, s, ms: msPart };
}

/** `01:23:45,678`（SRT / MicroDVD 之外的主流格式） */
export function formatSrtTime(ms: TimeMs): string {
  const { neg, h, m, s, ms: msec } = splitTime(ms);
  return `${neg ? '-' : ''}${pad(h)}:${pad(m)}:${pad(s)},${pad(msec, 3)}`;
}

/** `01:23:45.678`（WebVTT） */
export function formatVttTime(ms: TimeMs): string {
  const { neg, h, m, s, ms: msec } = splitTime(ms);
  return `${neg ? '-' : ''}${pad(h)}:${pad(m)}:${pad(s)}.${pad(msec, 3)}`;
}

/** `1:23:45.67`（ASS 用厘秒，且小时不补零） */
export function formatAssTime(ms: TimeMs): string {
  const { h, m, s, ms: msec } = splitTime(ms);
  return `${h}:${pad(m)}:${pad(s)}.${pad(Math.floor(msec / 10))}`;
}

/** `[mm:ss.xx]`（LRC 的分钟为累计分钟，可超过 59） */
export function formatLrcTime(ms: TimeMs): string {
  const { h, m, s, ms: msec } = splitTime(ms);
  return `[${pad(h * 60 + m)}:${pad(s)}.${pad(Math.floor(msec / 10))}]`;
}

/** 人读时长：`01:42:07`，超过 100 小时也不截断 */
export function formatDuration(ms: TimeMs): string {
  const { h, m, s } = splitTime(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** 毫秒差值的带符号可读文本，如 `+500ms` / `-1.20s` */
export function formatDelta(ms: TimeMs): string {
  const sign = ms >= 0 ? '+' : '-';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${abs}ms`;
  return `${sign}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 2)}s`;
}

/** 把毫秒吸附到指定帧率的最近一帧 */
export function snapToFrame(ms: TimeMs, fps: number): TimeMs {
  if (!Number.isFinite(fps) || fps <= 0) return ms;
  const frameMs = 1000 / fps;
  return Math.round(ms / frameMs) * frameMs;
}

/** 毫秒 → 帧号 */
export function msToFrame(ms: TimeMs, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round((ms / 1000) * fps);
}

/** 帧号 → 毫秒 */
export function frameToMs(frame: number, fps: number): TimeMs {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round((frame / fps) * 1000);
}
