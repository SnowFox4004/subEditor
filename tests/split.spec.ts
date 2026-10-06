import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPLIT_OPTIONS,
  allocateTimes,
  applySplitPlans,
  countSplittable,
  needsSplit,
  planSplitForCue,
  planSplits,
  splitTextIntoLines,
  summarizeSplits,
  type SplitOptions,
} from '../src/core/split';
import { createCue, createDoc } from '../src/core/document';
import type { SubtitleDoc } from '../src/core/types';

const OPTS: SplitOptions = {
  maxCharsPerLine: 20,
  linesPerCue: 2,
  minDurationMs: 800,
  breakOnPunctuation: true,
};

function docWith(...cues: Array<{ text: string; start?: number; end?: number; locked?: boolean }>) {
  return createDoc({
    name: 't.srt',
    cues: cues.map((c, i) =>
      createCue({
        start: c.start ?? i * 10_000,
        end: c.end ?? i * 10_000 + 8000,
        text: c.text,
        index: i + 1,
        locked: c.locked,
      }),
    ),
  });
}

/* ================================================================== */
/* 断行                                                                */
/* ================================================================== */

describe('splitTextIntoLines', () => {
  it('短行原样返回', () => {
    expect(splitTextIntoLines('短句', 20, true)).toEqual(['短句']);
  });

  it('在标点处断开而不是硬切', () => {
    // 16 字，限制 10 字 → 应在「，」后断开
    expect(splitTextIntoLines('这是一句很长的话，需要被切分开来', 10, true)).toEqual([
      '这是一句很长的话，',
      '需要被切分开来',
    ]);
  });

  it('没有标点时按长度硬切', () => {
    expect(splitTextIntoLines('abcdefghijklmnop', 5, true)).toEqual([
      'abcde',
      'fghij',
      'klmno',
      'p',
    ]);
  });

  it('关闭标点断句后一律硬切', () => {
    expect(splitTextIntoLines('这是一句很长的话，需要被切分开来', 10, false)).toEqual([
      '这是一句很长的话，需',
      '要被切分开来',
    ]);
  });

  it('原有换行优先于长度切分', () => {
    expect(splitTextIntoLines('AB\nCD', 20, true)).toEqual(['AB', 'CD']);
  });

  it('忽略空行与首尾空白', () => {
    expect(splitTextIntoLines('  AB  \n\n  CD  ', 20, true)).toEqual(['AB', 'CD']);
  });

  it('标点太靠前时不会切出过短的碎片', () => {
    // 「，」在第 2 个字，低于最小切分长度（限长的一半），应当被忽略
    const lines = splitTextIntoLines('你，这是一句相当长的话需要切开', 10, true);
    expect(lines[0].length).toBe(10);
  });
});

/* ================================================================== */
/* 时间分配                                                            */
/* ================================================================== */

describe('allocateTimes', () => {
  it('按权重比例分配', () => {
    expect(allocateTimes(0, 4000, [1, 3], 100)).toEqual([
      { start: 0, end: 1000 },
      { start: 1000, end: 4000 },
    ]);
  });

  it('等权时均分', () => {
    expect(allocateTimes(0, 10_000, [1, 1], 800)).toEqual([
      { start: 0, end: 5000 },
      { start: 5000, end: 10_000 },
    ]);
  });

  it('首段从 start 开始，末段到 end 结束，中间无缝无叠', () => {
    const times = allocateTimes(1000, 9000, [3, 1, 2], 200)!;
    expect(times[0].start).toBe(1000);
    expect(times[times.length - 1].end).toBe(9000);
    for (let i = 1; i < times.length; i++) {
      expect(times[i].start).toBe(times[i - 1].end);
    }
  });

  it('每段都不低于最短时长', () => {
    const times = allocateTimes(0, 3000, [100, 1, 1], 900)!;
    for (const t of times) {
      expect(t.end - t.start).toBeGreaterThanOrEqual(900);
    }
  });

  it('时长不够时返回 null', () => {
    expect(allocateTimes(0, 1000, [1, 1], 800)).toBeNull();
  });

  it('只有一段时直接返回原区间', () => {
    expect(allocateTimes(500, 1500, [5], 800)).toEqual([{ start: 500, end: 1500 }]);
  });
});

/* ================================================================== */
/* 判定                                                                */
/* ================================================================== */

describe('needsSplit', () => {
  const cue = (text: string, locked = false) => createCue({ start: 0, end: 8000, text, locked });

  it('短条目不需要切', () => {
    expect(needsSplit(cue('短句'), OPTS)).toBe(false);
  });

  it('单行超长且重新断行后仍超一条的，需要切', () => {
    // 45 字 → 断成 20/20/5 三行，装不进「每条最多 2 行」，值得拆成多条
    expect(needsSplit(cue('一'.repeat(45)), OPTS)).toBe(true);
  });

  it('21~40 字的条目不算需要切分', () => {
    // 只是重新断成两行而已，不值得拆成多条 —— 否则按钮上的计数会和预览对不上
    expect(needsSplit(cue('一'.repeat(25)), OPTS)).toBe(false);
    expect(needsSplit(cue('一'.repeat(40)), OPTS)).toBe(false);
    expect(needsSplit(cue('一'.repeat(41)), OPTS)).toBe(true);
  });

  it('行数超过上限需要切', () => {
    expect(needsSplit(cue('短\n短\n短'), OPTS)).toBe(true);
  });

  it('总字数超过上限需要切', () => {
    expect(needsSplit(cue('一'.repeat(45)), OPTS)).toBe(true);
  });

  it('时长不足以切成两条时不切', () => {
    // 最短 800ms，切成两条至少需要 1600ms
    const short = createCue({ start: 0, end: 1500, text: '一'.repeat(60) });
    expect(needsSplit(short, OPTS)).toBe(false);
  });

  it('锁定的条目不切', () => {
    expect(needsSplit(cue('一'.repeat(45), true), OPTS)).toBe(false);
  });
});

/* ================================================================== */
/* 切分方案                                                            */
/* ================================================================== */

describe('planSplitForCue', () => {
  const longText = '这是一句非常长的字幕文本，需要被切分成多条，时间按比例分配，第二条也要足够长才能触发切分。';

  it('产出多条切分结果', () => {
    const cue = createCue({ start: 0, end: 12_000, text: longText, index: 1 });
    const plan = planSplitForCue(cue, 'doc', OPTS)!;
    expect(plan).not.toBeNull();
    expect(plan.pieces.length).toBeGreaterThanOrEqual(2);
    expect(plan.index).toBe(1);
    expect(plan.before.text).toBe(longText);
  });

  it('切分后文本与原文一致（去掉换行后）', () => {
    const cue = createCue({ start: 0, end: 12_000, text: longText, index: 1 });
    const plan = planSplitForCue(cue, 'doc', OPTS)!;
    const joined = plan.pieces.map((p) => p.text.replace(/\n/g, '')).join('');
    expect(joined).toBe(longText.replace(/\n/g, ''));
  });

  it('时间完整覆盖原区间且无缝无叠', () => {
    const cue = createCue({ start: 1000, end: 13_000, text: longText, index: 1 });
    const plan = planSplitForCue(cue, 'doc', OPTS)!;
    expect(plan.pieces[0].start).toBe(1000);
    expect(plan.pieces[plan.pieces.length - 1].end).toBe(13_000);
    for (let i = 1; i < plan.pieces.length; i++) {
      expect(plan.pieces[i].start).toBe(plan.pieces[i - 1].end);
    }
  });

  it('每段不超过「每行字数 × 行数」', () => {
    const cue = createCue({ start: 0, end: 20_000, text: longText, index: 1 });
    const plan = planSplitForCue(cue, 'doc', OPTS)!;
    for (const piece of plan.pieces) {
      expect(piece.text.replace(/\n/g, '').length).toBeLessThanOrEqual(
        OPTS.maxCharsPerLine * OPTS.linesPerCue,
      );
    }
  });

  it('时长不足时减少段数并标记', () => {
    // 12 秒 / 最短 800ms 最多 15 段，这里把最短时长拉到 3 秒 → 最多 4 段
    const cue = createCue({ start: 0, end: 12_000, text: '一'.repeat(200), index: 1 });
    const plan = planSplitForCue(cue, 'doc', { ...OPTS, minDurationMs: 3000 })!;
    expect(plan.pieces.length).toBeLessThanOrEqual(4);
    expect(plan.durationLimited).toBe(true);
  });

  it('时长只够一条时不切', () => {
    const cue = createCue({ start: 0, end: 1000, text: '一'.repeat(200), index: 1 });
    expect(planSplitForCue(cue, 'doc', OPTS)).toBeNull();
  });

  it('本来就合规的条目不产生方案', () => {
    const cue = createCue({ start: 0, end: 5000, text: '短句', index: 1 });
    expect(planSplitForCue(cue, 'doc', OPTS)).toBeNull();
  });

  it('锁定的条目不产生方案', () => {
    const cue = createCue({ start: 0, end: 12_000, text: longText, index: 1, locked: true });
    expect(planSplitForCue(cue, 'doc', OPTS)).toBeNull();
  });
});

describe('planSplits 与统计', () => {
  const longText = '这是一句非常长的字幕文本，需要被切分成多条，时间按比例分配，第二条也要足够长才能触发切分。';

  it('跨文档收集方案', () => {
    const a = docWith({ text: longText });
    const b = docWith({ text: longText }, { text: '短句' });
    const plans = planSplits([a, b], OPTS);
    expect(plans).toHaveLength(2);
    expect(summarizeSplits(plans).docCount).toBe(2);
    expect(summarizeSplits(plans).addedCount).toBeGreaterThan(0);
  });

  it('countSplittable 与 planSplits 数量一致', () => {
    const doc = docWith({ text: longText }, { text: '短句' }, { text: '一'.repeat(60) });
    expect(countSplittable([doc], OPTS)).toBe(planSplits([doc], OPTS).length);
  });

  it('countSplittable 在边界长度上也和实际方案严格一致', () => {
    // 25 / 30 字只是重新断行，不该计入；41 / 60 字才真的要拆
    const doc = docWith(
      { text: '一'.repeat(25) },
      { text: '一'.repeat(30) },
      { text: '一'.repeat(41) },
      { text: '一'.repeat(60) },
    );
    const count = countSplittable([doc], OPTS);
    const plans = planSplits([doc], OPTS);
    expect(count).toBe(plans.length);
    expect(count).toBe(2);
  });

  it('默认参数能处理典型中文长句', () => {
    const doc = docWith({ text: longText });
    expect(planSplits([doc], DEFAULT_SPLIT_OPTIONS).length).toBe(1);
  });
});

/* ================================================================== */
/* 应用                                                                */
/* ================================================================== */

describe('applySplitPlans', () => {
  const longText = '这是一句非常长的字幕文本，需要被切分成多条，时间按比例分配，第二条也要足够长才能触发切分。';

  function setup(): { doc: SubtitleDoc; planId: string } {
    const doc = docWith({ text: longText, start: 0, end: 12_000 }, { text: '短句', start: 20_000, end: 24_000 });
    const plans = planSplits([doc], OPTS);
    return { doc, planId: plans[0].id };
  }

  it('采纳后条目数增加且序号重排', () => {
    const { doc, planId } = setup();
    const plans = planSplits([doc], OPTS);
    const next = applySplitPlans(doc, plans, new Set([planId]));
    expect(next.cues.length).toBeGreaterThan(doc.cues.length);
    expect(next.cues.map((c) => c.index)).toEqual(next.cues.map((_, i) => i + 1));
  });

  it('未采纳的条目原样保留', () => {
    const { doc, planId } = setup();
    const plans = planSplits([doc], OPTS);
    const next = applySplitPlans(doc, plans, new Set([planId]));
    expect(next.cues.some((c) => c.text === '短句')).toBe(true);
  });

  it('一条都不采纳时返回同一个对象', () => {
    const { doc } = setup();
    const plans = planSplits([doc], OPTS);
    expect(applySplitPlans(doc, plans, new Set())).toBe(doc);
  });

  it('整段时间区间被完整保留', () => {
    const { doc, planId } = setup();
    const plans = planSplits([doc], OPTS);
    const next = applySplitPlans(doc, plans, new Set([planId]));
    const pieces = next.cues.filter((c) => c.end <= 12_000);
    expect(Math.min(...pieces.map((c) => c.start))).toBe(0);
    expect(Math.max(...pieces.map((c) => c.end))).toBe(12_000);
  });

  it('切分后 rev 推进（可撤销）', () => {
    const { doc, planId } = setup();
    const plans = planSplits([doc], OPTS);
    const next = applySplitPlans(doc, plans, new Set([planId]));
    expect(next.rev).toBeGreaterThan(doc.rev);
  });

  it('说话人与样式会被继承', () => {
    const doc = createDoc({
      name: 't.srt',
      cues: [
        createCue({
          start: 0,
          end: 12_000,
          text: longText,
          speaker: '张三',
          style: { assStyle: 'MyStyle' },
        }),
      ],
    });
    const plans = planSplits([doc], OPTS);
    const next = applySplitPlans(doc, plans, new Set(plans.map((p) => p.id)));
    for (const cue of next.cues) {
      expect(cue.speaker).toBe('张三');
      expect(cue.style?.assStyle).toBe('MyStyle');
    }
  });
});
