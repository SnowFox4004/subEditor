/**
 * 文档层操作。全部为纯函数：接收 SubtitleDoc，返回新的 SubtitleDoc（不可变）。
 * 不可变的好处：撤销/重做直接复用 immer patches，无需手写逆操作。
 */
import type { Cue, SubtitleDoc, TimeMs } from './types';
import { snapToFrame } from './timecode';
import { validateDoc } from './validation';

export function createCue(partial: Partial<Cue> & { start: TimeMs; end: TimeMs }): Cue {
  return {
    id: partial.id ?? crypto.randomUUID(),
    index: partial.index ?? 1,
    start: partial.start,
    end: partial.end,
    text: partial.text ?? '',
    speaker: partial.speaker,
    style: partial.style,
    locked: partial.locked ?? false,
    dirty: partial.dirty ?? true,
  };
}

export function createDoc(init: Partial<SubtitleDoc> & { name: string }): SubtitleDoc {
  return {
    id: init.id ?? crypto.randomUUID(),
    name: init.name,
    format: init.format ?? 'srt',
    encoding: init.encoding ?? 'utf-8',
    bom: init.bom ?? false,
    newline: init.newline ?? '\n',
    fps: init.fps,
    cues: init.cues ?? [],
    meta: init.meta ?? {},
    warnings: init.warnings ?? [],
    rev: init.rev ?? 0,
  };
}

/** 按数组顺序重排序号（1 起），并推进 rev */
export function renumber(doc: SubtitleDoc): SubtitleDoc {
  const cues = doc.cues.map((c, i) => (c.index === i + 1 ? c : { ...c, index: i + 1 }));
  return { ...doc, cues, rev: doc.rev + 1 };
}

function withCues(doc: SubtitleDoc, cues: Cue[]): SubtitleDoc {
  const next: SubtitleDoc = { ...doc, cues, rev: doc.rev + 1 };
  return { ...next, warnings: validateDoc(next) };
}

/**
 * 用一组新的 cues 整体替换（时间轴拖拽等批量时间修改用）。
 * 不做重新编号 —— 顺序没变，序号也不该变。
 */
export function replaceCues(doc: SubtitleDoc, cues: Cue[]): SubtitleDoc {
  return withCues(doc, cues);
}

export function updateCue(
  doc: SubtitleDoc,
  cueId: string,
  patch: Partial<Pick<Cue, 'start' | 'end' | 'text' | 'speaker' | 'locked'>>,
): SubtitleDoc {
  const cues = doc.cues.map((c) =>
    c.id === cueId ? { ...c, ...patch, dirty: true } : c,
  );
  return withCues(doc, cues);
}

export function insertCue(doc: SubtitleDoc, atIndex: number, cue?: Cue): SubtitleDoc {
  const prev = doc.cues[atIndex - 1];
  const start = cue?.start ?? (prev ? prev.end + 40 : 0);
  const end = cue?.end ?? start + 2000;
  const fresh =
    cue ??
    createCue({
      start,
      end,
      text: '',
    });
  const cues = [...doc.cues.slice(0, atIndex), fresh, ...doc.cues.slice(atIndex)];
  return withCues(doc, renumber({ ...doc, cues }).cues);
}

/** 在指定位置之后插入一条（表格里按「新增下一条」时用） */
export function insertCueAfter(doc: SubtitleDoc, cueId: string | null, cue?: Cue): SubtitleDoc {
  const at = cueId ? doc.cues.findIndex((c) => c.id === cueId) + 1 : doc.cues.length;
  const prev = doc.cues[at - 1];
  const start = cue?.start ?? (prev ? prev.end + 40 : 0);
  const fresh = cue ?? createCue({ start, end: start + 2000, text: '' });
  const cues = renumber({ ...doc, cues: [...doc.cues.slice(0, at), fresh, ...doc.cues.slice(at)] }).cues;
  return withCues(doc, cues);
}

export function removeCue(doc: SubtitleDoc, cueId: string): SubtitleDoc {
  const cues = doc.cues.filter((c) => c.id !== cueId);
  return withCues(doc, renumber({ ...doc, cues }).cues);
}

export function removeCues(doc: SubtitleDoc, cueIds: string[]): SubtitleDoc {
  const drop = new Set(cueIds);
  const cues = doc.cues.filter((c) => !drop.has(c.id));
  return withCues(doc, renumber({ ...doc, cues }).cues);
}

export function duplicateCue(doc: SubtitleDoc, cueId: string): SubtitleDoc {
  const at = doc.cues.findIndex((c) => c.id === cueId);
  if (at < 0) return doc;
  const src = doc.cues[at];
  const copy = createCue({ ...src, id: crypto.randomUUID(), index: src.index + 1 });
  const cues = renumber({ ...doc, cues: [...doc.cues.slice(0, at + 1), copy, ...doc.cues.slice(at + 1)] }).cues;
  return withCues(doc, cues);
}

/** 上移 / 下移（改变顺序，不改时间） */
export function moveCue(doc: SubtitleDoc, cueId: string, delta: number): SubtitleDoc {
  const at = doc.cues.findIndex((c) => c.id === cueId);
  if (at < 0) return doc;
  const to = Math.max(0, Math.min(doc.cues.length - 1, at + delta));
  if (to === at) return doc;
  const cues = [...doc.cues];
  const [item] = cues.splice(at, 1);
  cues.splice(to, 0, item);
  return withCues(doc, renumber({ ...doc, cues }).cues);
}

/**
 * 拆分一条字幕。优先在正文中间最近的换行处切，否则按字符中点切；
 * 时间按两侧文本长度比例分配，保证视觉节奏不跳。
 */
export function splitCue(doc: SubtitleDoc, cueId: string): SubtitleDoc {
  const at = doc.cues.findIndex((c) => c.id === cueId);
  if (at < 0) return doc;
  const cue = doc.cues[at];

  const raw = cue.text.replace(/\r\n|\r|\n/g, '\n');
  let leftText = raw;
  let rightText = '';

  if (raw.includes('\n')) {
    const lines = raw.split('\n');
    const mid = Math.ceil(lines.length / 2);
    leftText = lines.slice(0, mid).join('\n');
    rightText = lines.slice(mid).join('\n');
  } else if (raw.length > 1) {
    // 在中间附近找标点或空格作为切点
    const mid = Math.floor(raw.length / 2);
    let cut = -1;
    for (let d = 0; d <= mid; d++) {
      const candidates = [mid - d, mid + d];
      for (const c of candidates) {
        if (c <= 0 || c >= raw.length) continue;
        if (/[\s，。！？、,.!?;；:：]/.test(raw[c])) {
          cut = c + 1;
          break;
        }
      }
      if (cut > 0) break;
    }
    if (cut <= 0) cut = mid;
    leftText = raw.slice(0, cut).trim();
    rightText = raw.slice(cut).trim();
  } else {
    return doc; // 太短，不拆
  }

  if (!leftText || !rightText) return doc;

  const ratio = leftText.length / (leftText.length + rightText.length);
  const span = Math.max(0, cue.end - cue.start);
  const splitAt = cue.start + Math.round(span * ratio);

  const left = { ...cue, end: splitAt, text: leftText, dirty: true };
  const right = createCue({ start: splitAt, end: cue.end, text: rightText, index: cue.index + 1 });

  const cues = renumber({
    ...doc,
    cues: [...doc.cues.slice(0, at), left, right, ...doc.cues.slice(at + 1)],
  }).cues;
  return withCues(doc, cues);
}

/** 与下一条合并：正文用换行拼接，结束时间取下一条的结束时间 */
export function mergeWithNext(doc: SubtitleDoc, cueId: string): SubtitleDoc {
  const at = doc.cues.findIndex((c) => c.id === cueId);
  if (at < 0 || at >= doc.cues.length - 1) return doc;
  const a = doc.cues[at];
  const b = doc.cues[at + 1];
  const merged: Cue = {
    ...a,
    end: Math.max(a.end, b.end),
    text: [a.text, b.text].filter((t) => t !== '').join('\n'),
    dirty: true,
  };
  const cues = renumber({
    ...doc,
    cues: [...doc.cues.slice(0, at), merged, ...doc.cues.slice(at + 2)],
  }).cues;
  return withCues(doc, cues);
}

/** 全局时间平移 */
export function shiftAll(doc: SubtitleDoc, deltaMs: number): SubtitleDoc {
  const cues = doc.cues.map((c) => ({
    ...c,
    start: Math.max(0, c.start + deltaMs),
    end: Math.max(0, c.end + deltaMs),
    dirty: true,
  }));
  return withCues(doc, cues);
}

/** 时间缩放，anchorMs 为不动点 */
export function scaleAll(doc: SubtitleDoc, factor: number, anchorMs = 0): SubtitleDoc {
  const cues = doc.cues.map((c) => ({
    ...c,
    start: Math.max(0, Math.round(anchorMs + (c.start - anchorMs) * factor)),
    end: Math.max(0, Math.round(anchorMs + (c.end - anchorMs) * factor)),
    dirty: true,
  }));
  return withCues(doc, cues);
}

/** 按帧率吸附所有时间码 */
export function snapAllToFrame(doc: SubtitleDoc, fps: number): SubtitleDoc {
  const cues = doc.cues.map((c) => ({
    ...c,
    start: snapToFrame(c.start, fps),
    end: snapToFrame(c.end, fps),
    dirty: true,
  }));
  return withCues(doc, cues);
}

/**
 * 修复重叠：把与前一条重叠的起始时间推到前一条结束时间之后。
 * gapMs 为保留的最小间隔。
 */
export function fixOverlaps(doc: SubtitleDoc, gapMs = 0): SubtitleDoc {
  const cues: Cue[] = [];
  let prevEnd = -Infinity;
  for (const c of doc.cues) {
    let start = c.start;
    let end = c.end;
    if (start < prevEnd + gapMs) start = prevEnd + gapMs;
    if (end < start) end = start;
    cues.push(start !== c.start || end !== c.end ? { ...c, start, end, dirty: true } : c);
    prevEnd = end;
  }
  return withCues(doc, cues);
}

/** 删除正文为空的条目 */
export function dropEmpty(doc: SubtitleDoc): SubtitleDoc {
  const cues = doc.cues.filter((c) => c.text.trim() !== '');
  return withCues(doc, renumber({ ...doc, cues }).cues);
}

/**
 * 合并过短条目：显示时长低于 minDurationMs 的条目会被并入下一条。
 * 常用于把「嗯」「啊」这种一闪而过的碎条目并回主句。
 */
export function mergeShortCues(doc: SubtitleDoc, minDurationMs = 800): SubtitleDoc {
  const out: Cue[] = [];
  for (const cue of doc.cues) {
    const prev = out[out.length - 1];
    if (prev && prev.end - prev.start < minDurationMs) {
      out[out.length - 1] = {
        ...prev,
        end: Math.max(prev.end, cue.end),
        text: [prev.text, cue.text].filter((t) => t !== '').join('\n'),
        dirty: true,
      };
    } else {
      out.push(cue);
    }
  }
  return withCues(doc, renumber({ ...doc, cues: out }).cues);
}

/** 删除起止时间与正文完全相同的重复条目 */
export function removeDuplicates(doc: SubtitleDoc): SubtitleDoc {
  const seen = new Set<string>();
  const cues = doc.cues.filter((cue) => {
    const key = `${cue.start}|${cue.end}|${cue.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return withCues(doc, renumber({ ...doc, cues }).cues);
}

/**
 * 按顺序把相邻条目的首尾对齐，消除微小空隙。
 * gapMs 为允许保留的空隙；小于它的空隙会被抹平。
 */
export function closeGaps(doc: SubtitleDoc, gapMs = 40): SubtitleDoc {
  const cues = doc.cues.map((cue, i) => {
    const prev = doc.cues[i - 1];
    if (!prev) return cue;
    const gap = cue.start - prev.end;
    if (gap <= 0 || gap > gapMs) return cue;
    return { ...cue, start: prev.end, dirty: true };
  });
  return withCues(doc, cues);
}

/** 去掉 SDH 标注，如 [音乐]、〔掌声〕、（笑声）、♪ 歌词符号 */
export function stripSdh(doc: SubtitleDoc): SubtitleDoc {
  const re = /[\[【〔（(][^\]】〕）)]{0,20}[\]】〕）)]|♪/g;
  const cues = doc.cues.map((c) => {
    const next = c.text.replace(re, '').replace(/[ \t]{2,}/g, ' ').trim();
    return next !== c.text ? { ...c, text: next, dirty: true } : c;
  });
  return withCues(doc, cues);
}

/** 去掉 <i> <b> <font> 等内联标签 */
export function stripTags(doc: SubtitleDoc): SubtitleDoc {
  const cues = doc.cues.map((c) => {
    const next = c.text.replace(/<\/?[^>]+>/g, '');
    return next !== c.text ? { ...c, text: next, dirty: true } : c;
  });
  return withCues(doc, cues);
}

export interface DocStats {
  count: number;
  /** 最后一条的结束时间 */
  duration: TimeMs;
  /** 所有条目时长之和 */
  totalCueDuration: TimeMs;
  firstStart: TimeMs;
}

export function getStats(doc: SubtitleDoc): DocStats {
  let duration = 0;
  let totalCueDuration = 0;
  let firstStart = Number.POSITIVE_INFINITY;
  for (const c of doc.cues) {
    duration = Math.max(duration, c.end);
    firstStart = Math.min(firstStart, c.start);
    totalCueDuration += Math.max(0, c.end - c.start);
  }
  return {
    count: doc.cues.length,
    duration,
    totalCueDuration,
    firstStart: Number.isFinite(firstStart) ? firstStart : 0,
  };
}
