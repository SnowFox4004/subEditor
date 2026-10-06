/**
 * 全局状态。所有文档都存在内存里，浏览器刷新后由 persist 层恢复（M6）。
 */
import { create } from 'zustand';
import type { SubtitleDoc } from '../core/types';
import { openSubtitleFile } from '../core/openFile';
import { createDoc, getStats, renumber } from '../core/document';
import { serializeWithFormat } from '../core/formats';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryEntry,
} from './history';

export interface Notice {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface OpenReport {
  name: string;
  ok: boolean;
  cueCount?: number;
  encoding?: string;
  format?: string;
  warnings?: number;
  error?: string;
}

interface EditorState {
  docs: Record<string, SubtitleDoc>;
  /** 打开时的 rev，用于判定「已修改」；撤销回到初始状态会自动变回未修改 */
  savedRev: Record<string, number>;
  tabOrder: string[];
  activeId: string | null;
  history: Record<string, HistoryEntry<SubtitleDoc>>;
  /** 当前文档中选中的 cue（单选/多选） */
  selection: string[];
  notices: Notice[];

  openFiles: (files: File[]) => Promise<OpenReport[]>;
  closeTab: (id: string) => void;
  closeAll: () => void;
  setActive: (id: string) => void;
  reorderTabs: (from: number, to: number) => void;

  /** 提交一次修改：自动入历史栈、刷新 rev 与质检告警 */
  commit: (docId: string, next: SubtitleDoc, options?: { history?: boolean }) => void;
  /** 不改历史地替换（例如批量替换预览时的高亮） */
  replaceSilently: (docId: string, next: SubtitleDoc) => void;

  undo: (docId?: string) => void;
  redo: (docId?: string) => void;
  canUndo: (docId?: string) => boolean;
  canRedo: (docId?: string) => boolean;

  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  markSaved: (docId: string) => void;

  pushNotice: (level: Notice['level'], message: string) => void;
  dismissNotice: (id: string) => void;
}

function fileNameOf(file: File): string {
  return file.name || 'untitled.srt';
}

export const useEditorStore = create<EditorState>((set, get) => ({
  docs: {},
  savedRev: {},
  tabOrder: [],
  activeId: null,
  history: {},
  selection: [],
  notices: [],

  async openFiles(files) {
    const reports: OpenReport[] = [];

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const { doc, detectedFormat, detectedEncoding } = openSubtitleFile(
          fileNameOf(file),
          new Uint8Array(buffer),
        );

        set((state) => ({
          docs: { ...state.docs, [doc.id]: doc },
          savedRev: { ...state.savedRev, [doc.id]: doc.rev },
          tabOrder: [...state.tabOrder, doc.id],
          history: { ...state.history, [doc.id]: createHistory<SubtitleDoc>() },
          activeId: doc.id,
          selection: [],
        }));

        reports.push({
          name: doc.name,
          ok: true,
          cueCount: doc.cues.length,
          encoding: detectedEncoding,
          format: detectedFormat ?? 'srt',
          warnings: doc.warnings.length,
        });
      } catch (err) {
        reports.push({
          name: fileNameOf(file),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const failed = reports.filter((r) => !r.ok);
    if (failed.length > 0) {
      get().pushNotice(
        'error',
        `${failed.length} 个文件打开失败：${failed.map((f) => `${f.name}（${f.error}）`).join('；')}`,
      );
    }
    const withWarn = reports.filter((r) => r.ok && (r.warnings ?? 0) > 0);
    if (withWarn.length > 0) {
      get().pushNotice(
        'warn',
        `${withWarn.length} 个文件存在解析告警，可在右侧「校验」面板查看`,
      );
    }

    return reports;
  },

  closeTab(id) {
    set((state) => {
      const tabOrder = state.tabOrder.filter((t) => t !== id);
      const docs = { ...state.docs };
      delete docs[id];
      const savedRev = { ...state.savedRev };
      delete savedRev[id];
      const history = { ...state.history };
      delete history[id];
      const activeId =
        state.activeId === id ? (tabOrder[tabOrder.length - 1] ?? null) : state.activeId;
      return { tabOrder, docs, savedRev, history, activeId, selection: [] };
    });
  },

  closeAll() {
    set({
      docs: {},
      savedRev: {},
      tabOrder: [],
      activeId: null,
      history: {},
      selection: [],
    });
  },

  setActive(id) {
    set({ activeId: id, selection: [] });
  },

  reorderTabs(from, to) {
    set((state) => {
      const tabOrder = [...state.tabOrder];
      if (from < 0 || from >= tabOrder.length) return state;
      const [item] = tabOrder.splice(from, 1);
      tabOrder.splice(Math.max(0, Math.min(tabOrder.length, to)), 0, item);
      return { tabOrder };
    });
  },

  commit(docId, next, options) {
    const state = get();
    const prev = state.docs[docId];
    if (!prev) return;
    const useHistory = options?.history ?? true;

    set({
      docs: { ...state.docs, [docId]: next },
      history: useHistory
        ? { ...state.history, [docId]: pushHistory(state.history[docId] ?? createHistory(), prev) }
        : state.history,
    });
  },

  replaceSilently(docId, next) {
    get().commit(docId, next, { history: false });
  },

  undo(docId) {
    const state = get();
    const id = docId ?? state.activeId;
    if (!id) return;
    const doc = state.docs[id];
    const entry = state.history[id];
    if (!doc || !entry) return;
    const result = undoHistory(entry, doc);
    if (!result) return;
    set({
      docs: { ...state.docs, [id]: result.restored },
      history: { ...state.history, [id]: result.history },
    });
  },

  redo(docId) {
    const state = get();
    const id = docId ?? state.activeId;
    if (!id) return;
    const doc = state.docs[id];
    const entry = state.history[id];
    if (!doc || !entry) return;
    const result = redoHistory(entry, doc);
    if (!result) return;
    set({
      docs: { ...state.docs, [id]: result.restored },
      history: { ...state.history, [id]: result.history },
    });
  },

  canUndo(docId) {
    const state = get();
    const id = docId ?? state.activeId;
    return id ? canUndo(state.history[id]) : false;
  },

  canRedo(docId) {
    const state = get();
    const id = docId ?? state.activeId;
    return id ? canRedo(state.history[id]) : false;
  },

  setSelection(ids) {
    set({ selection: ids });
  },

  toggleSelection(id, additive) {
    set((state) => {
      if (!additive) return { selection: [id] };
      return state.selection.includes(id)
        ? { selection: state.selection.filter((s) => s !== id) }
        : { selection: [...state.selection, id] };
    });
  },

  markSaved(docId) {
    const doc = get().docs[docId];
    if (!doc) return;
    set((state) => ({ savedRev: { ...state.savedRev, [docId]: doc.rev } }));
  },

  pushNotice(level, message) {
    const id = crypto.randomUUID();
    set((state) => ({ notices: [...state.notices, { id, level, message }] }));
    setTimeout(() => get().dismissNotice(id), level === 'error' ? 8000 : 4500);
  },

  dismissNotice(id) {
    set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }));
  },
}));

/* ------------------------------------------------------------------ */
/* 选择器                                                              */
/* ------------------------------------------------------------------ */

export function selectActiveDoc(state: EditorState): SubtitleDoc | null {
  return state.activeId ? (state.docs[state.activeId] ?? null) : null;
}

export function isDirty(state: EditorState, docId: string): boolean {
  const doc = state.docs[docId];
  if (!doc) return false;
  return doc.rev !== state.savedRev[docId];
}

export function selectStats(state: EditorState) {
  const doc = selectActiveDoc(state);
  return doc ? getStats(doc) : null;
}

/** 导出为文本（供下载 / 打包 zip 复用） */
export function exportDocText(doc: SubtitleDoc, format = doc.format): string {
  return serializeWithFormat(format, doc, { newline: doc.newline });
}

/** 新建空白文档 */
export function newBlankDoc(name = '未命名.srt'): SubtitleDoc {
  return renumber(createDoc({ name, format: 'srt', cues: [] }));
}
