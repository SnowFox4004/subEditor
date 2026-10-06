import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  HISTORY_LIMIT,
} from '../src/state/history';

describe('撤销 / 重做栈', () => {
  it('初始状态不可撤销也不可重做', () => {
    const h = createHistory<number>();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('压入后可以撤销', () => {
    const h = pushHistory(createHistory<number>(), 1);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it('撤销后回到上一个状态，并可重做', () => {
    let h = createHistory<number>();
    h = pushHistory(h, 1);
    const undone = undoHistory(h, 2);
    expect(undone?.restored).toBe(1);
    expect(canRedo(undone!.history)).toBe(true);

    const redone = redoHistory(undone!.history, 1);
    expect(redone?.restored).toBe(2);
  });

  it('没有历史时撤销返回 null', () => {
    expect(undoHistory(createHistory<number>(), 1)).toBeNull();
    expect(redoHistory(createHistory<number>(), 1)).toBeNull();
  });

  it('新提交会清空重做栈', () => {
    let h = createHistory<number>();
    h = pushHistory(h, 1);
    const undone = undoHistory(h, 2)!;
    h = pushHistory(undone.history, 99);
    expect(canRedo(h)).toBe(false);
  });

  it('连续多次撤销与重做保持顺序', () => {
    let h = createHistory<number>();
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);

    let current = 4;
    const undo1 = undoHistory(h, current)!;
    expect(undo1.restored).toBe(3);
    const undo2 = undoHistory(undo1.history, undo1.restored)!;
    expect(undo2.restored).toBe(2);
    const undo3 = undoHistory(undo2.history, undo2.restored)!;
    expect(undo3.restored).toBe(1);
    expect(canUndo(undo3.history)).toBe(false);

    const redo1 = redoHistory(undo3.history, undo3.restored)!;
    expect(redo1.restored).toBe(2);
  });

  it('历史长度不超过上限', () => {
    const total = HISTORY_LIMIT + 30;
    let h = createHistory<number>();
    for (let i = 0; i < total; i++) h = pushHistory(h, i);

    expect(h.past.length).toBe(HISTORY_LIMIT);
    // 最新的一次保留在栈顶，最老的被丢弃
    expect(h.past[h.past.length - 1]).toBe(total - 1);
    expect(h.past[0]).toBe(total - HISTORY_LIMIT);
  });
});
