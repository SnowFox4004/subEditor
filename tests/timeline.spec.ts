import { describe, expect, it } from 'vitest';
import {
  applyDrag,
  applyDragToCues,
  buildTicks,
  chooseTickInterval,
  clamp,
  collectSnapPoints,
  fitScale,
  formatTickLabel,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  msToPx,
  pxToMs,
  snapToNearest,
} from '../src/core/timeline';
import { createCue } from '../src/core/document';
import { findActiveCue } from '../src/state/player';

describe('坐标换算', () => {
  it('时间与像素可往返', () => {
    expect(msToPx(1000, 10)).toBe(10);
    expect(pxToMs(10, 10)).toBe(1000);
    expect(pxToMs(msToPx(3723456, 7.3), 7.3)).toBeCloseTo(3723456, 6);
  });

  it('clamp 正常夹取', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe('fitScale', () => {
  it('让总时长铺满视口', () => {
    // 60 秒铺进 632px 可用宽度 → 约 10.5 px/s
    expect(fitScale(60_000, 696)).toBeCloseTo(10.53, 1);
  });

  it('空文档返回默认值', () => {
    expect(fitScale(0, 800)).toBe(12);
  });

  it('结果被夹在上下限之间', () => {
    expect(fitScale(1, 100000)).toBeLessThanOrEqual(MAX_PX_PER_SECOND);
    expect(fitScale(10_000_000, 100)).toBeGreaterThanOrEqual(MIN_PX_PER_SECOND);
  });
});

describe('刻度', () => {
  it('间隔随缩放变化，保证刻度不挤在一起', () => {
    expect(chooseTickInterval(10)).toBe(10);
    expect(chooseTickInterval(100)).toBe(1);
    expect(chooseTickInterval(0.5)).toBe(300);
  });

  it('刻度位置从 0 开始且单调递增', () => {
    const ticks = buildTicks(60_000, 10);
    expect(ticks[0]).toBe(0);
    expect(ticks.length).toBeGreaterThan(2);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });

  it('时长为 0 时不产生刻度', () => {
    expect(buildTicks(0, 10)).toEqual([]);
  });

  it('极端缩放下不会生成海量刻度', () => {
    expect(buildTicks(3_600_000, MAX_PX_PER_SECOND).length).toBeLessThanOrEqual(500);
  });

  it('刻度文字按间隔决定是否带小数', () => {
    expect(formatTickLabel(65_000, 1000)).toBe('1:05');
    expect(formatTickLabel(65_000, 500)).toBe('1:05.0');
    expect(formatTickLabel(3_665_000, 1000)).toBe('1:01:05');
  });
});

describe('snapToNearest', () => {
  it('阈值内吸附到最近候选', () => {
    expect(snapToNearest(1030, [1000, 2000], 50)).toBe(1000);
    expect(snapToNearest(1960, [1000, 2000], 50)).toBe(2000);
  });

  it('超出阈值保持原值', () => {
    expect(snapToNearest(1500, [1000, 2000], 50)).toBe(1500);
  });

  it('没有候选点时保持原值', () => {
    expect(snapToNearest(1234, [], 100)).toBe(1234);
  });
});

describe('applyDrag', () => {
  const orig = { start: 1000, end: 2000 };

  it('move 保持时长整体平移', () => {
    expect(applyDrag(orig, 'move', 500)).toEqual({ start: 1500, end: 2500 });
  });

  it('move 不会把时间推到负数', () => {
    expect(applyDrag(orig, 'move', -5000)).toEqual({ start: 0, end: 1000 });
  });

  it('start 只改开始时间', () => {
    expect(applyDrag(orig, 'start', 500)).toEqual({ start: 1500, end: 2000 });
  });

  it('start 不会越过结束时间', () => {
    const r = applyDrag(orig, 'start', 9999);
    expect(r.start).toBe(1900); // end - minDuration(100)
    expect(r.end).toBe(2000);
  });

  it('end 只改结束时间', () => {
    expect(applyDrag(orig, 'end', 500)).toEqual({ start: 1000, end: 2500 });
  });

  it('end 不会越过开始时间', () => {
    const r = applyDrag(orig, 'end', -9999);
    expect(r.end).toBe(1100);
    expect(r.start).toBe(1000);
  });

  it('支持自定义最短时长', () => {
    const r = applyDrag(orig, 'end', -9999, { minDurationMs: 500 });
    expect(r.end).toBe(1500);
  });

  it('move 时会吸附到候选点', () => {
    const r = applyDrag(orig, 'move', 1900, {
      snapCandidates: [3000],
      snapThresholdMs: 200,
    });
    expect(r.start).toBe(3000);
    expect(r.end).toBe(4000);
  });

  it('start 吸附后仍不会越过结束时间', () => {
    const r = applyDrag(orig, 'start', 950, {
      snapCandidates: [3000],
      snapThresholdMs: 200,
    });
    expect(r.start).toBeLessThanOrEqual(r.end - 100);
  });

  it('提供 fps 时吸附到帧', () => {
    const r = applyDrag({ start: 0, end: 1000 }, 'move', 1017, { fps: 25 });
    // 1017ms 在 25fps 下应吸到 1000ms（第 25 帧）
    expect(r.start % 40).toBe(0);
    expect(r.end - r.start).toBe(1000);
  });
});

describe('applyDragToCues', () => {
  const cues = [
    createCue({ start: 0, end: 1000, text: 'A', index: 1 }),
    createCue({ start: 2000, end: 3000, text: 'B', index: 2 }),
    createCue({ start: 4000, end: 5000, text: 'C', index: 3 }),
  ];

  it('只改动被拖拽的条目', () => {
    const out = applyDragToCues(cues, [cues[1].id], 'move', 500);
    expect(out[0]).toEqual(cues[0]);
    expect(out[1].start).toBe(2500);
    expect(out[2]).toEqual(cues[2]);
  });

  it('多选时整体平移', () => {
    const out = applyDragToCues(cues, [cues[0].id, cues[2].id], 'move', 500);
    expect(out[0].start).toBe(500);
    expect(out[1].start).toBe(2000); // 未选中的不动
    expect(out[2].start).toBe(4500);
  });

  it('会标记 dirty', () => {
    const out = applyDragToCues(cues, [cues[0].id], 'move', 500);
    expect(out[0].dirty).toBe(true);
  });

  it('没有实际变化时不产生新对象', () => {
    const out = applyDragToCues(cues, [cues[0].id], 'move', 0);
    expect(out[0]).toBe(cues[0]);
  });

  it('吸附候选会排除被拖拽条目自身', () => {
    // 候选里含 B 的 2000/3000，拖 A 时应该能吸附过去
    const points = collectSnapPoints(cues, [cues[0].id]);
    expect(points).toContain(0); // 时间轴原点始终保留
    expect(points).not.toContain(1000); // A 自己的结束点被排除
    expect(points).toContain(2000);
    expect(points).toContain(3000);

    const out = applyDragToCues(cues, [cues[0].id], 'move', 1980, {
      snapCandidates: points,
      snapThresholdMs: 50,
    });
    expect(out[0].start).toBe(2000);
  });

  it('collectSnapPoints 总是包含 0 与额外传入的点', () => {
    const points = collectSnapPoints(cues, [], [7777]);
    expect(points).toContain(0);
    expect(points).toContain(7777);
    expect(points).toContain(1000);
    expect(points).toContain(5000);
  });
});

describe('findActiveCue', () => {
  const cues = [
    { id: 'a', start: 1000, end: 2000 },
    { id: 'b', start: 3000, end: 4000 },
  ];

  it('命中区间返回对应条目', () => {
    expect(findActiveCue(cues, 1500)?.id).toBe('a');
    expect(findActiveCue(cues, 3500)?.id).toBe('b');
  });

  it('区间左闭右开', () => {
    expect(findActiveCue(cues, 1000)?.id).toBe('a');
    expect(findActiveCue(cues, 2000)).toBeNull();
  });

  it('空隙与开头返回 null', () => {
    expect(findActiveCue(cues, 0)).toBeNull();
    expect(findActiveCue(cues, 2500)).toBeNull();
    expect(findActiveCue(cues, 99999)).toBeNull();
  });

  it('空数组不报错', () => {
    expect(findActiveCue([], 100)).toBeNull();
  });
});
