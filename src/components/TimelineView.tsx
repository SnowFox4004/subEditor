import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Cue, SubtitleDoc } from '../core/types';
import { getStats, replaceCues } from '../core/document';
import {
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
  type DragMode,
  type DragOptions,
} from '../core/timeline';
import { useEditorStore } from '../state/store';
import { usePlayerStore } from '../state/player';

interface Props {
  doc: SubtitleDoc;
}

interface DragState {
  ids: string[];
  mode: DragMode;
  startX: number;
  deltaMs: number;
  moved: boolean;
}

const RULER_H = 22;
const TRACK_H = 74;
const EDGE_PX = 7;
/** 拖拽时的吸附阈值（像素） */
const SNAP_PX = 6;

export function TimelineView({ doc }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const commit = useEditorStore((s) => s.commit);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const mediaUrl = usePlayerStore((s) => s.mediaUrl);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const seek = usePlayerStore((s) => s.seek);

  const [pxPerSecond, setPxPerSecond] = useState(12);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [viewportWidth, setViewportWidth] = useState(800);
  const fittedDocId = useRef<string | null>(null);

  const stats = useMemo(() => getStats(doc), [doc]);
  /** 时间轴至少铺 10 秒，空文档也能看出刻度 */
  const totalMs = Math.max(stats.duration, 10_000);

  // 记录可视宽度，用于「适应宽度」
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 切换文档时自动适应宽度（不覆盖用户手动缩放）
  useLayoutEffect(() => {
    if (fittedDocId.current === doc.id) return;
    fittedDocId.current = doc.id;
    setPxPerSecond(fitScale(stats.duration, scrollRef.current?.clientWidth ?? 800));
  }, [doc.id, stats.duration]);

  // 记录横向滚动位置，用于只渲染可见区间的块
  const [scrollLeft, setScrollLeft] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollLeft(el.scrollLeft);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const selectedSet = useMemo(() => new Set(selection), [selection]);

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

  const dragOpts = useMemo<DragOptions>(() => {
    const ids = drag?.ids ?? selection;
    return {
      minDurationMs: 100,
      fps: doc.fps ?? null,
      snapCandidates: collectSnapPoints(
        doc.cues,
        ids,
        mediaUrl ? [currentTimeMs] : [],
      ),
      snapThresholdMs: pxToMs(SNAP_PX, pxPerSecond),
    };
  }, [doc.cues, doc.fps, drag, selection, pxPerSecond, currentTimeMs, mediaUrl]);

  /** 拖拽期间用同一套纯函数算出预览，所见即所得 */
  const displayCues = useMemo(() => {
    if (!drag || drag.deltaMs === 0) return doc.cues;
    return applyDragToCues(doc.cues, drag.ids, drag.mode, drag.deltaMs, dragOpts);
  }, [doc.cues, drag, dragOpts]);

  const contentWidth = Math.max(viewportWidth, msToPx(totalMs, pxPerSecond) + 48);

  /**
   * 横向虚拟化：只渲染与可视区间相交的块（左右各留 200px 余量）。
   * 1 万条字幕的时间轴如果全量渲染会有 1 万个 DOM 节点，必须裁掉。
   */
  const visibleCues = useMemo(() => {
    const from = pxToMs(Math.max(0, scrollLeft - 200), pxPerSecond);
    const to = pxToMs(scrollLeft + viewportWidth + 200, pxPerSecond);
    return displayCues.filter((c) => c.end >= from && c.start <= to);
  }, [displayCues, scrollLeft, viewportWidth, pxPerSecond]);

  const ticks = useMemo(() => {
    const interval = chooseTickInterval(pxPerSecond) * 1000;
    return buildTicks(totalMs, pxPerSecond).map((t) => ({
      at: t,
      label: formatTickLabel(t, interval),
    }));
  }, [totalMs, pxPerSecond]);

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cue: Cue, mode: DragMode) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      const ids = selectedSet.has(cue.id) ? [...selection] : [cue.id];
      if (!selectedSet.has(cue.id)) setSelection([cue.id]);

      setDrag({ ids, mode, startX: e.clientX, deltaMs: 0, moved: false });
    },
    [selectedSet, selection, setSelection],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setDrag((cur) => {
        if (!cur) return cur;
        const deltaMs = Math.round(pxToMs(e.clientX - cur.startX, pxPerSecond));
        if (deltaMs === cur.deltaMs) return cur;
        return { ...cur, deltaMs, moved: true };
      });
    },
    [pxPerSecond],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setDrag((cur) => {
        if (cur && cur.moved && cur.deltaMs !== 0) {
          commit(doc.id, replaceCues(doc, applyDragToCues(doc.cues, cur.ids, cur.mode, cur.deltaMs, dragOpts)));
        }
        return null;
      });
    },
    [commit, doc, dragOpts],
  );

  /** 在空白处按下 → 取消选择；在刻度上按下 → 定位播放头 */
  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ms = Math.max(0, pxToMs(e.clientX - rect.left, pxPerSecond));
      if (mediaUrl) seek(ms);
      setSelection([]);
    },
    [mediaUrl, pxPerSecond, seek, setSelection],
  );

  /** Ctrl/⌘ + 滚轮缩放（用原生非 passive 监听，才能 preventDefault） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPxPerSecond((p) =>
        clamp(p * (e.deltaY < 0 ? 1.15 : 0.87), MIN_PX_PER_SECOND, MAX_PX_PER_SECOND),
      );
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const zoomBy = (factor: number) =>
    setPxPerSecond((p) => clamp(p * factor, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND));

  const fit = () => setPxPerSecond(fitScale(stats.duration, scrollRef.current?.clientWidth ?? 800));

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <span className="timeline-title">时间轴</span>
        <span className="timeline-hint">
          拖动块体平移 · 拖动两端调整起止 · Ctrl+滚轮缩放 · 双击定位播放头
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost icon" title="缩小" onClick={() => zoomBy(0.75)}>
          −
        </button>
        <button className="btn ghost icon" title="放大" onClick={() => zoomBy(1.34)}>
          ＋
        </button>
        <button className="btn ghost" title="适应宽度" onClick={fit}>
          适应
        </button>
      </div>

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ width: contentWidth }}>
          <div className="timeline-ruler" style={{ height: RULER_H }}>
            {ticks.map((t) => (
              <div
                key={t.at}
                className="timeline-tick"
                style={{ left: msToPx(t.at, pxPerSecond) }}
              >
                <span>{t.label}</span>
              </div>
            ))}
          </div>

          <div
            className="timeline-track"
            ref={trackRef}
            style={{ height: TRACK_H }}
            onPointerDown={onTrackPointerDown}
          >
            {ticks.map((t) => (
              <div
                key={t.at}
                className="timeline-gridline"
                style={{ left: msToPx(t.at, pxPerSecond) }}
              />
            ))}

            {visibleCues.map((cue) => {
              const left = msToPx(cue.start, pxPerSecond);
              const width = Math.max(3, msToPx(cue.end - cue.start, pxPerSecond));
              const isDragged = drag?.ids.includes(cue.id) ?? false;
              const classes = ['timeline-block'];
              if (selectedSet.has(cue.id)) classes.push('selected');
              if (overlapping.has(cue.id)) classes.push('overlap');
              if (isDragged) classes.push('dragging');
              if (cue.locked) classes.push('locked');
              if (mediaUrl && currentTimeMs >= cue.start && currentTimeMs < cue.end) {
                classes.push('playing');
              }

              return (
                <div
                  key={cue.id}
                  className={classes.join(' ')}
                  style={{ left, width }}
                  title={`#${cue.index}  ${cue.text.replace(/\n/g, ' / ')}`}
                  onPointerDown={(e) => startDrag(e, cue, 'move')}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (mediaUrl) seek(cue.start);
                  }}
                >
                  {!cue.locked && (
                    <>
                      <div
                        className="timeline-handle start"
                        style={{ width: EDGE_PX }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          startDrag(e, cue, 'start');
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                      <div
                        className="timeline-handle end"
                        style={{ width: EDGE_PX }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          startDrag(e, cue, 'end');
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                    </>
                  )}
                  <span className="timeline-block-label">
                    <b>{cue.index}</b>
                    {cue.text.replace(/\n/g, ' ')}
                  </span>
                </div>
              );
            })}

            {mediaUrl && (
              <div
                className="timeline-playhead"
                style={{ left: msToPx(currentTimeMs, pxPerSecond) }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
