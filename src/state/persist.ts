/**
 * 工作区持久化：零依赖 IndexedDB 封装。
 *
 * 为什么不引 Dexie：本项目只需要「存一份 JSON、读一份 JSON」，
 * 自己包一层不到 100 行，省掉一个依赖，也避免再拖一次安装。
 *
 * 存的是完整文档快照（含 cues），刷新或崩溃后能原样恢复，
 * 包括未保存的修改和「已修改」标记。
 */
import type { SubtitleDoc } from '../core/types';
import { createHistory, type HistoryEntry } from './history';

const DB_NAME = 'srteditor';
const DB_VERSION = 1;
const STORE = 'workspace';
const KEY = 'current';

export interface PersistedWorkspace {
  version: number;
  savedAt: number;
  docs: Record<string, SubtitleDoc>;
  savedRev: Record<string, number>;
  tabOrder: string[];
  activeId: string | null;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveWorkspace(payload: PersistedWorkspace): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const result = await withStore(db, 'readwrite', (store) => store.put(payload, KEY));
  db.close();
  return result !== null;
}

export async function loadWorkspace(): Promise<PersistedWorkspace | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await withStore<PersistedWorkspace>(db, 'readonly', (store) => store.get(KEY));
  db.close();
  if (!result || typeof result !== 'object') return null;
  if (!Array.isArray(result.tabOrder) || typeof result.docs !== 'object') return null;
  return result;
}

export async function clearWorkspace(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await withStore(db, 'readwrite', (store) => store.delete(KEY));
  db.close();
}

/* ------------------------------------------------------------------ */
/* 与 store 的对接                                                     */
/* ------------------------------------------------------------------ */

interface WorkspaceSlice {
  docs: Record<string, SubtitleDoc>;
  savedRev: Record<string, number>;
  tabOrder: string[];
  activeId: string | null;
}

/** 从 IndexedDB 恢复；返回是否真的恢复了内容 */
export async function restoreWorkspace(
  apply: (slice: WorkspaceSlice & { history: Record<string, HistoryEntry<SubtitleDoc>> }) => void,
): Promise<boolean> {
  const data = await loadWorkspace();
  if (!data || data.tabOrder.length === 0) return false;

  // 过滤掉已经不在 tabOrder 里的脏数据
  const docs: Record<string, SubtitleDoc> = {};
  const savedRev: Record<string, number> = {};
  const history: Record<string, HistoryEntry<SubtitleDoc>> = {};
  const tabOrder: string[] = [];

  for (const id of data.tabOrder) {
    const doc = data.docs[id];
    if (!doc || !Array.isArray(doc.cues)) continue;
    docs[id] = doc;
    savedRev[id] = data.savedRev?.[id] ?? doc.rev;
    history[id] = createHistory();
    tabOrder.push(id);
  }

  if (tabOrder.length === 0) return false;

  apply({
    docs,
    savedRev,
    tabOrder,
    activeId: data.activeId && docs[data.activeId] ? data.activeId : tabOrder[tabOrder.length - 1],
    history,
  });
  return true;
}

export const AUTOSAVE_DELAY_MS = 1200;

/** 生成一个便宜的状态指纹，用来判断「是不是真的变了」 */
function signature(slice: WorkspaceSlice): string {
  const parts: string[] = [slice.tabOrder.join('|'), slice.activeId ?? ''];
  for (const id of slice.tabOrder) {
    const doc = slice.docs[id];
    if (!doc) continue;
    parts.push(`${id}:${doc.rev}:${doc.cues.length}:${doc.name}`);
  }
  return parts.join(';');
}

/**
 * 订阅 store 变化并防抖落盘。返回取消订阅函数。
 */
export function startAutosave(
  subscribe: (listener: (slice: WorkspaceSlice) => void) => () => void,
  getSlice: () => WorkspaceSlice,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = signature(getSlice());

  const flush = () => {
    timer = null;
    const slice = getSlice();
    // 全部标签页都关掉了 → 清空存档，避免下次打开又莫名其妙恢复出来
    if (slice.tabOrder.length === 0) {
      void clearWorkspace();
      return;
    }
    void saveWorkspace({
      version: DB_VERSION,
      savedAt: Date.now(),
      docs: slice.docs,
      savedRev: slice.savedRev,
      tabOrder: slice.tabOrder,
      activeId: slice.activeId,
    });
  };

  const unsubscribe = subscribe(() => {
    const next = signature(getSlice());
    if (next === lastSignature) return;
    lastSignature = next;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
  });

  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
