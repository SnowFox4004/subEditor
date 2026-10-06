import { describe, expect, it } from 'vitest';
import { createCue, createDoc, duplicateCue, getStats, insertCueAfter, mergeWithNext, moveCue, removeCue, renumber, shiftAll, splitCue, stripSdh, stripTags, dropEmpty, fixOverlaps, scaleAll, updateCue } from '../src/core/document';
import type { SubtitleDoc } from '../src/core/types';

interface CueInit {
  start?: number;
  end?: number;
  text?: string;
}

function doc(...cues: CueInit[]): SubtitleDoc {
  return createDoc({
    name: 't.srt',
    cues: cues.map((c, i) =>
      createCue({
        start: c.start ?? i * 3000,
        end: c.end ?? i * 3000 + 2000,
        text: c.text ?? `第${i + 1}条`,
      }),
    ),
  });
}

describe('文档操作', () => {
  it('shiftAll 整体平移', () => {
    const d = doc({ start: 1000, end: 2000 }, { start: 5000, end: 6000 });
    const out = shiftAll(d, 500);
    expect(out.cues.map((c) => [c.start, c.end])).toEqual([
      [1500, 2500],
      [5500, 6500],
    ]);
  });

  it('shiftAll 不会产生负数时间', () => {
    const d = doc({ start: 1000, end: 2000 });
    const out = shiftAll(d, -5000);
    expect(out.cues[0].start).toBe(0);
    expect(out.cues[0].end).toBe(0);
  });

  it('scaleAll 以 0 为锚点缩放', () => {
    const d = doc({ start: 1000, end: 2000 }, { start: 4000, end: 6000 });
    const out = scaleAll(d, 2);
    expect(out.cues.map((c) => [c.start, c.end])).toEqual([
      [2000, 4000],
      [8000, 12000],
    ]);
  });

  it('fixOverlaps 消除重叠', () => {
    const d = doc({ start: 1000, end: 5000 }, { start: 4000, end: 6000 });
    const out = fixOverlaps(d, 0);
    expect(out.cues[1].start).toBe(5000);
    for (let i = 1; i < out.cues.length; i++) {
      expect(out.cues[i].start).toBeGreaterThanOrEqual(out.cues[i - 1].end);
    }
  });

  it('updateCue 只改目标条目并标记 dirty', () => {
    const d = doc({ text: 'A' }, { text: 'B' });
    const target = d.cues[1].id;
    const out = updateCue(d, target, { text: 'B2' });
    expect(out.cues[0].text).toBe('A');
    expect(out.cues[1].text).toBe('B2');
    expect(out.cues[1].dirty).toBe(true);
    expect(d.cues[1].text).toBe('B'); // 原对象未被修改
  });

  it('removeCue 删除后重新编号', () => {
    const d = doc({}, {}, {});
    const out = removeCue(d, d.cues[1].id);
    expect(out.cues).toHaveLength(2);
    expect(out.cues.map((c) => c.index)).toEqual([1, 2]);
  });

  it('duplicateCue 复制到下一行', () => {
    const d = doc({ text: 'A' }, { text: 'B' });
    const out = duplicateCue(d, d.cues[0].id);
    expect(out.cues).toHaveLength(3);
    expect(out.cues[1].text).toBe('A');
    expect(out.cues[1].id).not.toBe(out.cues[0].id);
  });

  it('moveCue 调整顺序', () => {
    const d = doc({ text: 'A' }, { text: 'B' }, { text: 'C' });
    const out = moveCue(d, d.cues[0].id, 1);
    expect(out.cues.map((c) => c.text)).toEqual(['B', 'A', 'C']);
    expect(out.cues.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it('insertCueAfter 在指定条目之后插入', () => {
    const d = doc({ text: 'A' }, { text: 'B' });
    const out = insertCueAfter(d, d.cues[0].id);
    expect(out.cues).toHaveLength(3);
    expect(out.cues[1].text).toBe('');
    expect(out.cues[2].text).toBe('B');
  });

  it('insertCueAfter 传 null 时追加到末尾', () => {
    const d = doc({ text: 'A' });
    const out = insertCueAfter(d, null);
    expect(out.cues).toHaveLength(2);
    expect(out.cues[1].index).toBe(2);
  });

  it('renumber 重排序号', () => {
    const d = doc({}, {}, {});
    const scrambled = { ...d, cues: d.cues.map((c, i) => ({ ...c, index: 50 + i })) };
    expect(renumber(scrambled).cues.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it('dropEmpty 删除空正文', () => {
    const d = doc({ text: 'A' }, { text: '   ' }, { text: 'C' });
    const out = dropEmpty(d);
    expect(out.cues.map((c) => c.text)).toEqual(['A', 'C']);
  });

  it('stripTags 去掉内联标签', () => {
    const d = doc({ text: '<i>斜体</i>与<b>粗</b>' });
    expect(stripTags(d).cues[0].text).toBe('斜体与粗');
  });

  it('stripSdh 去掉标注与音符', () => {
    const d = doc({ text: '[音乐] 他说（笑声）♪' });
    const out = stripSdh(d).cues[0].text;
    expect(out).not.toContain('音乐');
    expect(out).not.toContain('笑声');
    expect(out).not.toContain('♪');
    expect(out).toContain('他说');
  });

  it('splitCue 按换行拆成两条且时间连续', () => {
    const d = doc({ start: 0, end: 4000, text: '上半段\n下半段' });
    const out = splitCue(d, d.cues[0].id);
    expect(out.cues).toHaveLength(2);
    expect(out.cues[0].text).toBe('上半段');
    expect(out.cues[1].text).toBe('下半段');
    expect(out.cues[0].end).toBe(out.cues[1].start);
    expect(out.cues[0].start).toBe(0);
    expect(out.cues[1].end).toBe(4000);
  });

  it('splitCue 对单行文本按字符中点切', () => {
    const d = doc({ start: 0, end: 4000, text: '你好，世界！' });
    const out = splitCue(d, d.cues[0].id);
    expect(out.cues).toHaveLength(2);
    expect(out.cues[0].text + out.cues[1].text).toBe('你好，世界！');
  });

  it('splitCue 对单字符文本不做任何事', () => {
    const d = doc({ text: 'A' });
    expect(splitCue(d, d.cues[0].id).cues).toHaveLength(1);
  });

  it('mergeWithNext 合并正文与时间', () => {
    const d = doc({ start: 0, end: 2000, text: 'A' }, { start: 2500, end: 4000, text: 'B' });
    const out = mergeWithNext(d, d.cues[0].id);
    expect(out.cues).toHaveLength(1);
    expect(out.cues[0].text).toBe('A\nB');
    expect(out.cues[0].start).toBe(0);
    expect(out.cues[0].end).toBe(4000);
  });

  it('mergeWithNext 对最后一条无效', () => {
    const d = doc({ text: 'A' }, { text: 'B' });
    expect(mergeWithNext(d, d.cues[1].id).cues).toHaveLength(2);
  });

  it('每次操作都会推进 rev', () => {
    const d = doc({ text: 'A' });
    expect(shiftAll(d, 100).rev).toBe(d.rev + 1);
  });

  it('操作不会修改传入的文档', () => {
    const d = doc({ start: 1000, end: 2000 });
    const before = JSON.stringify(d.cues);
    shiftAll(d, 9999);
    splitCue(d, d.cues[0].id);
    expect(JSON.stringify(d.cues)).toBe(before);
  });
});

describe('getStats', () => {
  it('统计条数、总时长与首条起点', () => {
    const d = doc({ start: 1000, end: 3000 }, { start: 5000, end: 9000 });
    const s = getStats(d);
    expect(s.count).toBe(2);
    expect(s.duration).toBe(9000);
    expect(s.firstStart).toBe(1000);
    expect(s.totalCueDuration).toBe(6000);
  });

  it('空文档不产生 Infinity', () => {
    const s = getStats(createDoc({ name: 'e.srt', cues: [] }));
    expect(s.count).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.firstStart).toBe(0);
  });
});
