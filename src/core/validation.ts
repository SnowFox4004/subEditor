/**
 * 文档质检。纯计算，不做任何修改 —— 只告诉用户哪里可能有问题。
 */
import type { SubtitleDoc, Warning } from './types';

/** 单行超过该字符数提示过长（中文场景约 2 行满屏） */
export const MAX_LINE_LENGTH = 42;
/** 显示时长低于该值提示过短（人眼读不完） */
export const MIN_DURATION_MS = 500;
/** 单条显示时长上限 */
export const MAX_DURATION_MS = 10_000;

export function validateDoc(doc: SubtitleDoc): Warning[] {
  const warnings: Warning[] = [];
  let prev: SubtitleDoc['cues'][number] | null = null;

  for (const cue of doc.cues) {
    if (cue.end < cue.start) {
      warnings.push({
        level: 'error',
        code: 'negative-duration',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条结束时间早于开始时间`,
      });
    }

    const duration = cue.end - cue.start;
    if (duration >= 0 && duration < MIN_DURATION_MS) {
      warnings.push({
        level: 'info',
        code: 'too-long-line',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条显示时长仅 ${duration}ms，可能来不及阅读`,
      });
    }
    if (duration > MAX_DURATION_MS) {
      warnings.push({
        level: 'info',
        code: 'too-long-line',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条显示时长 ${(duration / 1000).toFixed(1)}s，建议拆分`,
      });
    }

    if (cue.text.trim() === '') {
      warnings.push({
        level: 'warn',
        code: 'empty-text',
        cueIds: [cue.id],
        message: `第 ${cue.index} 条正文为空`,
      });
    } else {
      const tooLong = cue.text.split('\n').find((l) => l.length > MAX_LINE_LENGTH);
      if (tooLong) {
        warnings.push({
          level: 'info',
          code: 'too-long-line',
          cueIds: [cue.id],
          message: `第 ${cue.index} 条存在超长行（${tooLong.length} 字）`,
        });
      }
    }

    if (prev && cue.start < prev.end) {
      warnings.push({
        level: 'warn',
        code: 'overlap',
        cueIds: [prev.id, cue.id],
        message: `第 ${prev.index} 条与第 ${cue.index} 条时间重叠 ${prev.end - cue.start}ms`,
      });
    }

    prev = cue;
  }

  return warnings;
}
