import { memo, useLayoutEffect, useRef } from 'react';
import type { Cue } from '../core/types';
import type { ColumnKey } from '../state/layout';
import { formatDuration } from '../core/timecode';
import { TimecodeInput } from './TimecodeInput';

interface Props {
  cue: Cue;
  /** 当前可见的列，按顺序 */
  visibleColumns: ColumnKey[];
  /** 与表头共用的 grid-template-columns */
  gridTemplate: string;
  selected: boolean;
  overlapping: boolean;
  /** 该条正对应播放器的当前时间 */
  playing?: boolean;
  onChangeText: (id: string, text: string) => void;
  onChangeTime: (id: string, field: 'start' | 'end', ms: number) => void;
  onSelect: (id: string, additive: boolean) => void;
  onSplit: (id: string) => void;
  onMerge: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleLock: (id: string) => void;
  /** 双击整行时跳转播放位置 */
  onSeek?: (id: string) => void;
  canMerge: boolean;
}

function CueRowImpl({
  cue,
  visibleColumns,
  gridTemplate,
  selected,
  overlapping,
  playing,
  onChangeText,
  onChangeTime,
  onSelect,
  onSplit,
  onMerge,
  onDuplicate,
  onDelete,
  onToggleLock,
  onSeek,
  canMerge,
}: Props) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const hasTextColumn = visibleColumns.includes('text');

  // 高度自适应：内容变了、或者正文列被重新显示时，重新量一次
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [cue.text, hasTextColumn]);

  const className = [
    'cue-row',
    selected ? 'selected' : '',
    playing ? 'playing' : '',
    cue.locked ? 'locked' : '',
    overlapping ? 'overlap' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderCell = (key: ColumnKey) => {
    switch (key) {
      case 'index':
        return (
          <div className="cue-cell" key={key}>
            <span
              className="cue-index"
              onClick={(e) => onSelect(cue.id, e.metaKey || e.ctrlKey || e.shiftKey)}
              title="点击选中，按住 Ctrl / Cmd 可多选"
            >
              {cue.index}
            </span>
          </div>
        );

      case 'start':
        return (
          <div className="cue-cell" key={key}>
            <TimecodeInput
              value={cue.start}
              onChange={(ms) => onChangeTime(cue.id, 'start', ms)}
              disabled={cue.locked}
            />
          </div>
        );

      case 'end':
        return (
          <div className="cue-cell" key={key}>
            <TimecodeInput
              value={cue.end}
              onChange={(ms) => onChangeTime(cue.id, 'end', ms)}
              disabled={cue.locked}
            />
          </div>
        );

      case 'duration':
        return (
          <div className="cue-cell" key={key}>
            <span className="cue-duration">{formatDuration(Math.max(0, cue.end - cue.start))}</span>
          </div>
        );

      case 'text':
        return (
          <div className="cue-cell" key={key}>
            <textarea
              ref={textRef}
              className="cue-text"
              rows={1}
              value={cue.text}
              spellCheck={false}
              readOnly={cue.locked}
              placeholder="字幕正文…"
              onChange={(e) => onChangeText(cue.id, e.target.value)}
              onFocus={() => onSelect(cue.id, false)}
            />
          </div>
        );

      case 'actions':
        return (
          <div className="cue-cell" key={key}>
            <div className="cue-actions">
              <button className="btn ghost icon" title="拆分" onClick={() => onSplit(cue.id)}>
                ⑂
              </button>
              <button
                className="btn ghost icon"
                title="与下一条合并"
                disabled={!canMerge}
                onClick={() => onMerge(cue.id)}
              >
                ⇅
              </button>
              <button className="btn ghost icon" title="复制" onClick={() => onDuplicate(cue.id)}>
                ⧉
              </button>
              <button
                className="btn ghost icon"
                title={cue.locked ? '解锁' : '锁定'}
                onClick={() => onToggleLock(cue.id)}
              >
                {cue.locked ? '🔒' : '🔓'}
              </button>
              <button
                className="btn ghost icon danger"
                title="删除"
                onClick={() => onDelete(cue.id)}
              >
                ✕
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={className}
      style={{ gridTemplateColumns: gridTemplate }}
      onDoubleClick={(e) => {
        // 双击正文 / 时间输入时不触发跳转，避免打断编辑
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
        onSeek?.(cue.id);
      }}
    >
      {visibleColumns.map(renderCell)}
    </div>
  );
}

export const CueRow = memo(CueRowImpl);
