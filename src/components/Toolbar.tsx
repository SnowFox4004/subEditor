import { useRef, useState } from 'react';
import type { SubtitleDoc } from '../core/types';
import {
  dropEmpty,
  fixOverlaps,
  insertCueAfter,
  mergeWithNext,
  removeCues,
  shiftAll,
  splitCue,
  stripSdh,
  stripTags,
  updateCue,
} from '../core/document';
import { useEditorStore } from '../state/store';

interface Props {
  doc: SubtitleDoc | null;
  onExport: () => void;
  onLoadMedia: (file: File) => void;
  onOpenReplace: () => void;
  onOpenColumns: () => void;
}

export function Toolbar({ doc, onExport, onLoadMedia, onOpenReplace, onOpenColumns }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const [shiftMs, setShiftMs] = useState('500');

  const openFiles = useEditorStore((s) => s.openFiles);
  const commit = useEditorStore((s) => s.commit);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const selection = useEditorStore((s) => s.selection);
  const history = useEditorStore((s) => s.history);
  const activeId = useEditorStore((s) => s.activeId);

  const entry = activeId ? history[activeId] : undefined;
  const canUndo = !!entry && entry.past.length > 0;
  const canRedo = !!entry && entry.future.length > 0;

  const primaryId = selection[0] ?? null;
  const primaryIndex = doc && primaryId ? doc.cues.findIndex((c) => c.id === primaryId) : -1;

  const disabled = !doc;

  const applyShift = (sign: number) => {
    if (!doc) return;
    const delta = Number.parseInt(shiftMs, 10);
    if (!Number.isFinite(delta) || delta === 0) return;
    commit(doc.id, shiftAll(doc, sign * delta));
  };

  return (
    <div className="toolbar">
      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,.vtt,.ass,.ssa,.ttml,.xml,.dfxp,.sbv,.lrc,.sub,.smi,.json,text/plain"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void openFiles(files);
          e.target.value = '';
        }}
      />

      <input
        ref={mediaInputRef}
        type="file"
        accept="video/*,audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoadMedia(file);
          e.target.value = '';
        }}
      />

      <div className="toolbar-group">
        <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
          打开字幕
        </button>
        <button
          className="btn"
          title="载入本地视频或音频，用于字幕对轴预览"
          onClick={() => mediaInputRef.current?.click()}
        >
          载入媒体
        </button>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <button
          className="btn icon"
          title="撤销 (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => undo()}
        >
          ↶
        </button>
        <button
          className="btn icon"
          title="重做 (Ctrl+Y)"
          disabled={!canRedo}
          onClick={() => redo()}
        >
          ↷
        </button>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <button
          className="btn"
          disabled={disabled}
          title="在当前选中项之后插入一条空白字幕 (Ctrl+Enter)"
          onClick={() => doc && commit(doc.id, insertCueAfter(doc, primaryId))}
        >
          ＋ 新增
        </button>
        <button
          className="btn"
          disabled={disabled || primaryIndex < 0}
          title="拆分选中的字幕"
          onClick={() => doc && primaryId && commit(doc.id, splitCue(doc, primaryId))}
        >
          拆分
        </button>
        <button
          className="btn"
          disabled={disabled || primaryIndex < 0 || primaryIndex >= (doc?.cues.length ?? 0) - 1}
          title="与下一条合并"
          onClick={() => doc && primaryId && commit(doc.id, mergeWithNext(doc, primaryId))}
        >
          合并
        </button>
        <button
          className="btn danger"
          disabled={disabled || selection.length === 0}
          title="删除选中条目"
          onClick={() => doc && selection.length > 0 && commit(doc.id, removeCues(doc, selection))}
        >
          删除
        </button>
        <button
          className="btn"
          disabled={disabled || primaryId === null}
          title="锁定 / 解锁选中条目"
          onClick={() => {
            if (!doc || !primaryId) return;
            const cue = doc.cues.find((c) => c.id === primaryId);
            if (!cue) return;
            commit(doc.id, updateCue(doc, primaryId, { locked: !cue.locked }));
          }}
        >
          锁定
        </button>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <span style={{ color: 'var(--text-tertiary)' }}>整体平移</span>
        <input
          className="field"
          style={{ width: 74 }}
          value={shiftMs}
          onChange={(e) => setShiftMs(e.target.value.replace(/[^\d-]/g, ''))}
          title="毫秒，可填负数"
        />
        <button className="btn" disabled={disabled} title="提前" onClick={() => applyShift(-1)}>
          −
        </button>
        <button className="btn" disabled={disabled} title="延后" onClick={() => applyShift(1)}>
          ＋
        </button>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <button
          className="btn"
          disabled={disabled}
          title="把重叠的起始时间推到前一条结束之后"
          onClick={() => doc && commit(doc.id, fixOverlaps(doc, 1))}
        >
          修复重叠
        </button>
        <button
          className="btn"
          disabled={disabled}
          title="删除正文为空的条目"
          onClick={() => doc && commit(doc.id, dropEmpty(doc))}
        >
          去空
        </button>
        <button
          className="btn"
          disabled={disabled}
          title="去掉 [音乐]（笑声）♪ 等 SDH 标注"
          onClick={() => doc && commit(doc.id, stripSdh(doc))}
        >
          去 SDH
        </button>
        <button
          className="btn"
          disabled={disabled}
          title="去掉 <i> <b> <font> 等内联标签"
          onClick={() => doc && commit(doc.id, stripTags(doc))}
        >
          去标签
        </button>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <button
          className="btn"
          disabled={disabled}
          title="批量替换：多规则叠加、diff 预览、逐条采纳 (Ctrl+H)"
          onClick={onOpenReplace}
        >
          批量替换
        </button>
      </div>

      <span className="spacer" />

      <div className="toolbar-group">
        <button className="btn" onClick={onOpenColumns} title="选择显示哪些列、调整列宽">
          列设置
        </button>
        <button className="btn primary" disabled={disabled} onClick={onExport}>
          导出
        </button>
      </div>
    </div>
  );
}
