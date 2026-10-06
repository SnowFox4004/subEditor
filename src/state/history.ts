/**
 * 撤销 / 重做栈。
 *
 * 采用「整份文档快照」而非 patch diff：因为 core 层的所有操作都是不可变的，
 * 未改动的 Cue 对象在快照之间是共享引用，一次快照的实际开销只是指针数组
 * （1 万条约 80KB），100 步历史约 8MB，完全可接受，换来的是实现极简且不会出错。
 */

export interface HistoryEntry<T> {
  past: T[];
  future: T[];
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(): HistoryEntry<T> {
  return { past: [], future: [] };
}

/** 提交一次新状态：压入 past，清空 future */
export function pushHistory<T>(history: HistoryEntry<T>, snapshot: T): HistoryEntry<T> {
  const past = [...history.past, snapshot];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function canUndo<T>(history: HistoryEntry<T> | undefined): boolean {
  return !!history && history.past.length > 0;
}

export function canRedo<T>(history: HistoryEntry<T> | undefined): boolean {
  return !!history && history.future.length > 0;
}

/**
 * 撤销：弹出 past 栈顶作为恢复目标，当前状态压入 future。
 * 返回 null 表示没有可撤销的历史。
 */
export function undoHistory<T>(
  history: HistoryEntry<T>,
  current: T,
): { history: HistoryEntry<T>; restored: T } | null {
  if (history.past.length === 0) return null;
  const past = [...history.past];
  const restored = past.pop() as T;
  return {
    history: { past, future: [current, ...history.future] },
    restored,
  };
}

export function redoHistory<T>(
  history: HistoryEntry<T>,
  current: T,
): { history: HistoryEntry<T>; restored: T } | null {
  if (history.future.length === 0) return null;
  const [restored, ...future] = history.future;
  return {
    history: { past: [...history.past, current], future },
    restored,
  };
}
