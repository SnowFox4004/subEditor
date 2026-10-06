import { useEffect, useRef, useState } from 'react';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { CueList } from './components/CueList';
import { TimelineView } from './components/TimelineView';
import { MediaPreview } from './components/MediaPreview';
import { StatusBar } from './components/StatusBar';
import { SidePane } from './components/SidePane';
import { NoticeStack } from './components/NoticeStack';
import { ExportDialog } from './components/ExportDialog';
import { ReplacePanel } from './components/ReplacePanel';
import { SplitDialog } from './components/SplitDialog';
import { ColumnSettingsDialog } from './components/ColumnSettingsDialog';
import { useEditorStore } from './state/store';
import { togglePlayback, usePlayerStore } from './state/player';
import { restoreWorkspace, startAutosave } from './state/persist';
import { clampMediaPaneHeight, useLayoutStore } from './state/layout';
import { insertCueAfter, moveCue, removeCues } from './core/document';

type Theme = 'light' | 'dark';

const MEDIA_EXT_RE = /\.(mp4|webm|mkv|mov|avi|m4v|mp3|wav|m4a|aac|flac|ogg|opus)$/i;

function isMediaFile(file: File): boolean {
  return (
    file.type.startsWith('video/') ||
    file.type.startsWith('audio/') ||
    MEDIA_EXT_RE.test(file.name)
  );
}

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem('srteditor-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const docs = useEditorStore((s) => s.docs);
  const activeId = useEditorStore((s) => s.activeId);
  const savedRev = useEditorStore((s) => s.savedRev);
  const openFiles = useEditorStore((s) => s.openFiles);
  const commit = useEditorStore((s) => s.commit);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setSelection = useEditorStore((s) => s.setSelection);

  const mediaUrl = usePlayerStore((s) => s.mediaUrl);
  const loadMedia = usePlayerStore((s) => s.loadMedia);

  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  /* ---------------- 媒体预览区高度 ---------------- */

  const columnRef = useRef<HTMLDivElement | null>(null);
  const storedMediaHeight = useLayoutStore((s) => s.mediaPaneHeight);
  const setMediaPaneHeight = useLayoutStore((s) => s.setMediaPaneHeight);
  const [mediaHeight, setMediaHeight] = useState<number | null>(storedMediaHeight);
  const [columnHeight, setColumnHeight] = useState(800);
  const [resizingMedia, setResizingMedia] = useState(false);
  const mediaDragRef = useRef<{ startY: number; startH: number; current: number } | null>(null);

  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const update = () => setColumnHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 没手动调过就按 38% 给个默认高度
  const effectiveMediaHeight =
    mediaHeight ?? Math.max(140, Math.round(columnHeight * 0.38));

  const onSplitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    mediaDragRef.current = {
      startY: e.clientY,
      startH: effectiveMediaHeight,
      current: effectiveMediaHeight,
    };
    setResizingMedia(true);
  };

  const onSplitterMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = mediaDragRef.current;
    if (!drag) return;
    const next = clampMediaPaneHeight(drag.startH + (e.clientY - drag.startY), columnHeight);
    drag.current = next;
    setMediaHeight(next);
  };

  const onSplitterUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = mediaDragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    mediaDragRef.current = null;
    setResizingMedia(false);
    setMediaPaneHeight(drag.current);
  };
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dragDepth = useRef(0);

  const doc = activeId ? (docs[activeId] ?? null) : null;
  const dirty = doc ? doc.rev !== savedRev[doc.id] : false;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('srteditor-theme', theme);
  }, [theme]);

  /* 启动时恢复上次未关闭的工作区 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await restoreWorkspace((slice) => {
        if (cancelled) return;
        useEditorStore.setState(slice);
      });
      if (!cancelled && restored) {
        useEditorStore.getState().pushNotice('info', '已恢复上次未关闭的工作区');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* 自动保存到 IndexedDB */
  useEffect(
    () =>
      startAutosave(
        (listener) =>
          useEditorStore.subscribe((s) =>
            listener({
              docs: s.docs,
              savedRev: s.savedRev,
              tabOrder: s.tabOrder,
              activeId: s.activeId,
            }),
          ),
        () => {
          const s = useEditorStore.getState();
          return {
            docs: s.docs,
            savedRev: s.savedRev,
            tabOrder: s.tabOrder,
            activeId: s.activeId,
          };
        },
      ),
    [],
  );

  /* 全局拖拽：字幕文件进编辑器，媒体文件进播放器 */
  useEffect(() => {
    const handleFiles = (files: File[]) => {
      const media = files.filter(isMediaFile);
      const subs = files.filter((f) => !isMediaFile(f));
      if (media.length > 0) loadMedia(media[0]);
      if (subs.length > 0) void openFiles(subs);
    };

    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(Array.from(e.dataTransfer.files));
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFiles, loadMedia]);

  /* 关闭前提醒未保存 */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const state = useEditorStore.getState();
      const hasDirty = state.tabOrder.some(
        (id) => state.docs[id] && state.docs[id].rev !== state.savedRev[id],
      );
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /* 快捷键 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const state = useEditorStore.getState();
      const id = state.activeId;
      const current = id ? state.docs[id] : null;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (current) setExporting(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (current) setReplacing(true);
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (current && id) commit(id, insertCueAfter(current, state.selection[0] ?? null));
        return;
      }

      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (typing) return;

      // 空格播放 / 暂停
      if (e.code === 'Space' && usePlayerStore.getState().mediaUrl) {
        e.preventDefault();
        togglePlayback();
        return;
      }

      if (!current || !id) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection.length > 0) {
          e.preventDefault();
          commit(id, removeCues(current, state.selection));
          setSelection([]);
        }
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const first = state.selection[0];
        if (!first) return;
        commit(id, moveCue(current, first, e.key === 'ArrowUp' ? -1 : 1));
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (current.cues.length === 0) return;
        e.preventDefault();
        const first = state.selection[0];
        const idx = first ? current.cues.findIndex((c) => c.id === first) : -1;
        const next = Math.max(
          0,
          Math.min(current.cues.length - 1, idx + (e.key === 'ArrowDown' ? 1 : 0)),
        );
        setSelection([current.cues[next].id]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit, redo, setSelection, undo]);

  return (
    <div className="app">
      <TabBar />
      <Toolbar
        doc={doc}
        onExport={() => {
          if (!doc) return;
          setExporting(true);
          setSavedAt(Date.now());
        }}
        onLoadMedia={loadMedia}
        onOpenReplace={() => setReplacing(true)}
        onOpenColumns={() => setColumnsOpen(true)}
      />

      <div className="workspace">
        <div className="main-column" ref={columnRef}>
          {mediaUrl && (
            <>
              <div className="media-slot" style={{ height: effectiveMediaHeight }}>
                <MediaPreview />
              </div>
              <div
                className={`splitter-h ${resizingMedia ? 'dragging' : ''}`}
                title="拖动调整预览与编辑区的高度，双击恢复默认比例"
                onPointerDown={onSplitterDown}
                onPointerMove={onSplitterMove}
                onPointerUp={onSplitterUp}
                onPointerCancel={onSplitterUp}
                onDoubleClick={() => {
                  setMediaHeight(null);
                  setMediaPaneHeight(null);
                }}
              />
            </>
          )}

          <div className="editor-column">
            {doc ? (
              <>
                <CueList doc={doc} />
                <TimelineView doc={doc} />
              </>
            ) : (
              <div className="empty">
                <h2>把字幕文件拖进来</h2>
                <p>
                  支持一次拖入多个文件，每个文件一个标签页。也可以顺手把对应的
                  <strong>视频或音频</strong>一起拖进来，字幕会按时间叠加显示。
                </p>
                <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                  解析、编辑、导出全部在你的浏览器里完成，
                  <strong>文件不会上传到任何服务器</strong>。
                </p>
                <label className="btn primary" style={{ height: 32, padding: '0 16px' }}>
                  选择字幕文件
                  <input
                    type="file"
                    multiple
                    accept=".srt,.vtt,.ass,.ssa,.ttml,.xml,.dfxp,.sbv,.lrc,.sub,.smi,.json,.csv,.tsv"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 0) void openFiles(files);
                      e.target.value = '';
                    }}
                  />
                </label>
                <span className="hint">
                  支持 SRT / VTT / ASS / SSA / TTML / DFXP / SBV / LRC / MicroDVD / SAMI / JSON /
                  CSV / TSV 的导入，导出还额外支持纯文本
                </span>
              </div>
            )}
          </div>
        </div>

        <SidePane doc={doc} onOpenSplit={() => setSplitting(true)} />
      </div>

      <StatusBar doc={doc} dirty={dirty} savedAt={savedAt} />

      <div className="theme-toggle">
        <button
          className="btn ghost"
          title="切换亮/暗主题"
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
      </div>

      <NoticeStack />
      {dragging && (
        <div className="drop-overlay">松开鼠标：字幕文件进编辑器，视频/音频进预览窗口</div>
      )}
      {exporting && doc && (
        <ExportDialog
          doc={doc}
          onClose={() => {
            setExporting(false);
            setSavedAt(Date.now());
          }}
        />
      )}
      {replacing && <ReplacePanel onClose={() => setReplacing(false)} />}
      {splitting && <SplitDialog onClose={() => setSplitting(false)} />}
      {columnsOpen && <ColumnSettingsDialog onClose={() => setColumnsOpen(false)} />}
    </div>
  );
}
