import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Cue, SubtitleDoc } from '../core/types';
import { CueRow } from './CueRow';
import {
  duplicateCue,
  mergeWithNext,
  removeCue,
  splitCue,
  updateCue,
} from '../core/document';
import { useEditorStore } from '../state/store';
import { findActiveCue, usePlayerStore } from '../state/player';
import {
  DEFAULT_COLUMNS,
  gridTemplateOf,
  minTableWidthOf,
  useLayoutStore,
  type ColumnDef,
  type ColumnKey,
} from '../state/layout';

interface Props {
  doc: SubtitleDoc;
}

export function CueList({ doc }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const commit = useEditorStore((s) => s.commit);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const toggleSelection = useEditorStore((s) => s.toggleSelection);

  const columns = useLayoutStore((s) => s.columns);
  const setColumnWidth = useLayoutStore((s) => s.setColumnWidth);

  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible).map((c) => c.key),
    [columns],
  );
  const gridTemplate = useMemo(() => gridTemplateOf(columns), [columns]);
  const minWidth = useMemo(() => minTableWidthOf(columns), [columns]);

  /* ---------------- 列宽拖拽 ---------------- */

  const resizeRef = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);
  const [resizingKey, setResizingKey] = useState<ColumnKey | null>(null);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, col: ColumnDef) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = { key: col.key, startX: e.clientX, startWidth: col.width };
      setResizingKey(col.key);
    },
    [],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      setColumnWidth(r.key, r.startWidth + (e.clientX - r.startX));
    },
    [setColumnWidth],
  );

  const endResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    resizeRef.current = null;
    setResizingKey(null);
  }, []);

  /* ---------------- 播放器同步 ---------------- */

  const mediaUrl = usePlayerStore((s) => s.mediaUrl);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const seek = usePlayerStore((s) => s.seek);

  const playingCueId = useMemo(
    () => (mediaUrl ? (findActiveCue(doc.cues, currentTimeMs)?.id ?? null) : null),
    [mediaUrl, doc.cues, currentTimeMs],
  );

  const playingIndex = useMemo(
    () => (playingCueId ? doc.cues.findIndex((c) => c.id === playingCueId) : -1),
    [playingCueId, doc.cues],
  );

  // 时间重叠的 cue（用于左侧红条提示）
  const overlapping = useMemo(() => {
    const set = new Set<string>();
    let prev: Cue | null = null;
    for (const cue of doc.cues) {
      if (prev && cue.start < prev.end) {
        set.add(prev.id);
        set.add(cue.id);
      }
      prev = cue;
    }
    return set;
  }, [doc.cues]);

  const virtualizer = useVirtualizer({
    count: doc.cues.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    overscan: 10,
    getItemKey: (index) => doc.cues[index]?.id ?? index,
  });

  // 切换文档时回到顶部
  useEffect(() => {
    virtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // 选中项滚动到可视区
  useEffect(() => {
    const first = selection[0];
    if (!first) return;
    const idx = doc.cues.findIndex((c) => c.id === first);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, doc.cues]);

  // 播放中自动跟随滚动
  useEffect(() => {
    if (playingIndex >= 0) virtualizer.scrollToIndex(playingIndex, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingIndex]);

  // 列宽变化会改变行高（正文换行），需要重新测量
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridTemplate]);

  const handleChangeText = useCallback(
    (id: string, text: string) => {
      commit(doc.id, updateCue(doc, id, { text }));
    },
    [commit, doc],
  );

  const handleChangeTime = useCallback(
    (id: string, field: 'start' | 'end', ms: number) => {
      commit(doc.id, updateCue(doc, id, { [field]: ms }));
    },
    [commit, doc],
  );

  const handleSplit = useCallback((id: string) => commit(doc.id, splitCue(doc, id)), [commit, doc]);

  const handleMerge = useCallback((id: string) => commit(doc.id, mergeWithNext(doc, id)), [
    commit,
    doc,
  ]);

  const handleDuplicate = useCallback((id: string) => commit(doc.id, duplicateCue(doc, id)), [
    commit,
    doc,
  ]);

  const handleDelete = useCallback(
    (id: string) => {
      commit(doc.id, removeCue(doc, id));
      setSelection(selection.filter((s) => s !== id));
    },
    [commit, doc, selection, setSelection],
  );

  const handleToggleLock = useCallback(
    (id: string) => {
      const cue = doc.cues.find((c) => c.id === id);
      if (!cue) return;
      commit(doc.id, updateCue(doc, id, { locked: !cue.locked }));
    },
    [commit, doc],
  );

  const items = virtualizer.getVirtualItems();
  const defaultWidthOf = (key: ColumnKey) =>
    DEFAULT_COLUMNS.find((c) => c.key === key)?.width ?? 120;

  return (
    <div className="cuelist">
      <div className={`cuelist-scroll ${resizingKey ? 'resizing' : ''}`} ref={parentRef}>
        <div className="cuelist-inner" style={{ minWidth }}>
          <div className="cuelist-head" style={{ gridTemplateColumns: gridTemplate }}>
            {columns
              .filter((c) => c.visible)
              .map((col) => (
                <div className="cuelist-head-cell" key={col.key}>
                  <span className="cuelist-head-label">{col.label}</span>
                  <div
                    className="col-resizer"
                    title="拖动调整列宽，双击恢复默认"
                    onPointerDown={(e) => startResize(e, col)}
                    onPointerMove={onResizeMove}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setColumnWidth(col.key, defaultWidthOf(col.key));
                    }}
                  />
                </div>
              ))}
          </div>

          <div className="cuelist-body" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const cue = doc.cues[item.index];
              if (!cue) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <CueRow
                    cue={cue}
                    visibleColumns={visibleColumns}
                    gridTemplate={gridTemplate}
                    selected={selectedSet.has(cue.id)}
                    overlapping={overlapping.has(cue.id)}
                    playing={playingCueId === cue.id}
                    canMerge={item.index < doc.cues.length - 1}
                    onChangeText={handleChangeText}
                    onChangeTime={handleChangeTime}
                    onSeek={(id) => {
                      const target = doc.cues.find((c) => c.id === id);
                      if (target) seek(target.start);
                    }}
                    onSelect={(id, additive) => {
                      if (additive) toggleSelection(id, true);
                      else setSelection([id]);
                    }}
                    onSplit={handleSplit}
                    onMerge={handleMerge}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDelete}
                    onToggleLock={handleToggleLock}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
