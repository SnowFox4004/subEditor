/**
 * 字符级 diff。
 *
 * 先用「公共前缀 + 公共后缀」把无变化的头尾剥掉 —— 字幕批量替换绝大多数改动
 * 都集中在中间很小一段，这一步能砍掉 90% 以上的计算量。
 * 剩下的中间段如果够短就走 LCS 精确比对，过长则退化为「整段删除 + 整段插入」，
 * 避免 O(n·m) 的 DP 在超长行上把主线程拖死。
 */
import type { DiffSegment } from '../types';

/** 中间段超过这个长度就不再走 LCS，直接整段替换 */
const LCS_LIMIT = 400;

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    if (seg.text === '') continue;
    const last = out[out.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

function push(out: DiffSegment[], type: DiffSegment['type'], ch: string): void {
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += ch;
  else out.push({ type, text: ch });
}

/** 经典 LCS 动态规划，仅用于较短的中间段 */
function lcsDiff(a: string, b: string): DiffSegment[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b ? [{ type: 'insert', text: b }] : [];
  if (m === 0) return a ? [{ type: 'delete', text: a }] : [];

  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(out, 'equal', a[i]);
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      push(out, 'delete', a[i]);
      i++;
    } else {
      push(out, 'insert', b[j]);
      j++;
    }
  }
  while (i < n) push(out, 'delete', a[i++]);
  while (j < m) push(out, 'insert', b[j++]);
  return out;
}

export function diffChars(before: string, after: string): DiffSegment[] {
  if (before === after) return before === '' ? [] : [{ type: 'equal', text: before }];

  // 1) 剥掉公共前缀
  const minLen = Math.min(before.length, after.length);
  let start = 0;
  while (start < minLen && before[start] === after[start]) start++;

  // 2) 剥掉公共后缀（注意不要越过前缀边界）
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }

  const segments: DiffSegment[] = [];
  if (start > 0) segments.push({ type: 'equal', text: before.slice(0, start) });

  const midB = before.slice(start, endB);
  const midA = after.slice(start, endA);

  if (midB.length <= LCS_LIMIT && midA.length <= LCS_LIMIT) {
    segments.push(...lcsDiff(midB, midA));
  } else {
    if (midB) segments.push({ type: 'delete', text: midB });
    if (midA) segments.push({ type: 'insert', text: midA });
  }

  if (endB < before.length) {
    segments.push({ type: 'equal', text: before.slice(endB) });
  }

  return mergeAdjacent(segments);
}

/** diff 摘要：改动了几处、删了多少字、加了多少字 */
export interface DiffSummary {
  inserts: number;
  deletes: number;
  changed: boolean;
}

export function summarizeDiff(segments: DiffSegment[]): DiffSummary {
  let inserts = 0;
  let deletes = 0;
  for (const s of segments) {
    if (s.type === 'insert') inserts += s.text.length;
    else if (s.type === 'delete') deletes += s.text.length;
  }
  return { inserts, deletes, changed: inserts > 0 || deletes > 0 };
}

/**
 * 重建替换后的文本，即 after。
 * 跳过 delete 段 —— 因此恒有 `diffToText(diffChars(a, b)) === b`，
 * 这个不变式本身也是单测里最好用的正确性断言。
 */
export function diffToText(segments: DiffSegment[]): string {
  return segments
    .filter((s) => s.type !== 'delete')
    .map((s) => s.text)
    .join('');
}

/** 把两侧都带上（删除段用 - 前缀）的完整文本，用于日志排查 */
export function diffToAnnotated(segments: DiffSegment[]): string {
  return segments
    .map((s) => {
      if (s.type === 'equal') return s.text;
      if (s.type === 'delete') return `[-${s.text}-]`;
      return `[+${s.text}+]`;
    })
    .join('');
}
