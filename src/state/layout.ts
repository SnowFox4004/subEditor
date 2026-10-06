/**
 * 布局偏好：表格列宽 / 列显隐 / 媒体预览高度。
 * 存 localStorage，刷新后保留。与业务数据无关，所以不进 IndexedDB 工作区存档。
 */
import { create } from 'zustand';

export type ColumnKey = 'index' | 'start' | 'end' | 'duration' | 'text' | 'actions';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  visible: boolean;
  /** 该列吃掉剩余宽度（正文列） */
  flexible?: boolean;
}

/**
 * 时间列的宽度是按实际内容算出来的，不是拍脑袋定的：
 * 4 个输入框 (30+22+22+30) + 3 个分隔符 (~24) + 间距 (~12) + 单元格内边距 (12) ≈ 152px，
 * 留一点余量取 156，否则时间码会溢出到相邻列上。
 */
export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'index', label: '序号', width: 58, minWidth: 44, maxWidth: 120, visible: true },
  { key: 'start', label: '开始时间', width: 156, minWidth: 140, maxWidth: 260, visible: true },
  { key: 'end', label: '结束时间', width: 156, minWidth: 140, maxWidth: 260, visible: true },
  { key: 'duration', label: '时长', width: 78, minWidth: 62, maxWidth: 160, visible: true },
  { key: 'text', label: '正文', width: 360, minWidth: 160, maxWidth: 4000, visible: true, flexible: true },
  { key: 'actions', label: '操作', width: 88, minWidth: 74, maxWidth: 200, visible: true },
];

const STORAGE_KEY = 'srteditor-layout';
const PERSIST_DELAY_MS = 300;

/** 生成 grid-template-columns。正文列用 minmax 吃满剩余空间 */
export function gridTemplateOf(columns: ColumnDef[]): string {
  return columns
    .filter((c) => c.visible)
    .map((c) => (c.flexible ? `minmax(${c.width}px, 1fr)` : `${c.width}px`))
    .join(' ');
}

/** 表格内容的最小宽度：固定列之和 + 正文列的最小宽度 */
export function minTableWidthOf(columns: ColumnDef[]): number {
  const visible = columns.filter((c) => c.visible);
  if (visible.length === 0) return 320;
  return visible.reduce((sum, c) => sum + c.width, 0) + 16;
}

interface PersistedLayout {
  columns: ColumnDef[];
  mediaPaneHeight: number | null;
}

function clampColumn(col: ColumnDef, width: number): number {
  const w = Math.round(width);
  if (!Number.isFinite(w)) return col.width;
  return Math.max(col.minWidth, Math.min(col.maxWidth, w));
}

function loadPersisted(): PersistedLayout {
  const fallback: PersistedLayout = { columns: DEFAULT_COLUMNS, mediaPaneHeight: null };
  if (typeof localStorage === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const record = parsed as { columns?: unknown; mediaPaneHeight?: unknown };

    // 以默认列为准做合并：以后新增列时，老配置不会缺列
    const saved = new Map<string, { width?: number; visible?: boolean }>();
    if (Array.isArray(record.columns)) {
      for (const item of record.columns) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as { key?: unknown; width?: unknown; visible?: unknown };
        if (typeof entry.key !== 'string') continue;
        saved.set(entry.key, {
          width: typeof entry.width === 'number' ? entry.width : undefined,
          visible: typeof entry.visible === 'boolean' ? entry.visible : undefined,
        });
      }
    }

    const columns = DEFAULT_COLUMNS.map((col) => {
      const s = saved.get(col.key);
      return {
        ...col,
        width: typeof s?.width === 'number' ? clampColumn(col, s.width) : col.width,
        visible: typeof s?.visible === 'boolean' ? s.visible : col.visible,
      };
    });

    const height = record.mediaPaneHeight;
    return {
      columns,
      mediaPaneHeight:
        typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : null,
    };
  } catch {
    return fallback;
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon(get: () => LayoutState): void {
  if (typeof localStorage === 'undefined') return;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { columns, mediaPaneHeight } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          columns: columns.map((c) => ({ key: c.key, width: c.width, visible: c.visible })),
          mediaPaneHeight,
        }),
      );
    } catch {
      /* 隐私模式下写入可能失败，忽略 */
    }
  }, PERSIST_DELAY_MS);
}

interface LayoutState {
  columns: ColumnDef[];
  mediaPaneHeight: number | null;

  setColumnWidth: (key: ColumnKey, width: number) => void;
  toggleColumn: (key: ColumnKey) => void;
  setColumnVisible: (key: ColumnKey, visible: boolean) => void;
  resetColumns: () => void;
  setMediaPaneHeight: (height: number | null) => void;
}

const initial = loadPersisted();

export const useLayoutStore = create<LayoutState>((set, get) => ({
  columns: initial.columns,
  mediaPaneHeight: initial.mediaPaneHeight,

  setColumnWidth(key, width) {
    set((state) => ({
      columns: state.columns.map((c) =>
        c.key === key ? { ...c, width: clampColumn(c, width) } : c,
      ),
    }));
    persistSoon(get);
  },

  toggleColumn(key) {
    set((state) => {
      const target = state.columns.find((c) => c.key === key);
      if (!target) return state;
      // 至少保留一列可见
      const visibleCount = state.columns.filter((c) => c.visible).length;
      if (target.visible && visibleCount <= 1) return state;
      return {
        columns: state.columns.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)),
      };
    });
    persistSoon(get);
  },

  setColumnVisible(key, visible) {
    set((state) => {
      if (!visible && state.columns.filter((c) => c.visible).length <= 1) return state;
      return {
        columns: state.columns.map((c) => (c.key === key ? { ...c, visible } : c)),
      };
    });
    persistSoon(get);
  },

  resetColumns() {
    set({ columns: DEFAULT_COLUMNS.map((c) => ({ ...c })) });
    persistSoon(get);
  },

  setMediaPaneHeight(height) {
    set({ mediaPaneHeight: height });
    persistSoon(get);
  },
}));

export const MIN_MEDIA_PANE_HEIGHT = 120;
/** 编辑区至少留出这么高，否则没法用 */
export const MIN_EDITOR_HEIGHT = 200;

export function clampMediaPaneHeight(height: number, containerHeight: number): number {
  const max = Math.max(MIN_MEDIA_PANE_HEIGHT, containerHeight - MIN_EDITOR_HEIGHT);
  return Math.round(Math.max(MIN_MEDIA_PANE_HEIGHT, Math.min(max, height)));
}
