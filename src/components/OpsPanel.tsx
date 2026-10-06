import { useState } from 'react';
import type { SubtitleDoc } from '../core/types';
import {
  closeGaps,
  dropEmpty,
  fixOverlaps,
  mergeShortCues,
  removeCues,
  removeDuplicates,
  renumber,
  scaleAll,
  shiftAll,
  snapAllToFrame,
  stripSdh,
  stripTags,
} from '../core/document';
import { useEditorStore } from '../state/store';

interface Props {
  doc: SubtitleDoc | null;
  /** 打开「切分超长条目」对话框 */
  onOpenSplit: () => void;
}

export function OpsPanel({ doc, onOpenSplit }: Props) {
  const commit = useEditorStore((s) => s.commit);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);

  const [scale, setScale] = useState('1.0');
  const [fps, setFps] = useState('25');
  const [minDuration, setMinDuration] = useState('800');
  const [gap, setGap] = useState('40');
  const [shiftMs, setShiftMs] = useState('500');

  const disabled = !doc;

  const run = (fn: (d: SubtitleDoc) => SubtitleDoc) => {
    if (!doc) return;
    commit(doc.id, fn(doc));
  };

  return (
    <div className="panel-body">
      <div className="ops-group">
        <span className="ops-title">时间</span>
        <div className="ops-row">
          <input
            className="field"
            value={shiftMs}
            onChange={(e) => setShiftMs(e.target.value.replace(/[^\d-]/g, ''))}
            title="毫秒，可填负数"
          />
          <button className="btn" disabled={disabled} onClick={() => run((d) => shiftAll(d, -Number(shiftMs) || 0))}>
            提前
          </button>
          <button className="btn" disabled={disabled} onClick={() => run((d) => shiftAll(d, Number(shiftMs) || 0))}>
            延后
          </button>
        </div>
        <div className="ops-row">
          <input
            className="field"
            value={scale}
            onChange={(e) => setScale(e.target.value.replace(/[^\d.]/g, ''))}
            title="倍率，例如 0.98 表示整体压缩 2%"
          />
          <button
            className="btn"
            disabled={disabled}
            onClick={() => run((d) => scaleAll(d, Number.parseFloat(scale) || 1))}
          >
            时间缩放
          </button>
        </div>
        <div className="ops-row">
          <input
            className="field"
            value={fps}
            onChange={(e) => setFps(e.target.value.replace(/[^\d.]/g, ''))}
            title="帧率"
          />
          <button
            className="btn"
            disabled={disabled}
            onClick={() => run((d) => snapAllToFrame(d, Number.parseFloat(fps) || 25))}
          >
            对齐到帧
          </button>
        </div>
        <div className="ops-row">
          <input
            className="field"
            value={gap}
            onChange={(e) => setGap(e.target.value.replace(/[^\d]/g, ''))}
            title="小于该值的空隙会被抹平"
          />
          <button
            className="btn"
            disabled={disabled}
            onClick={() => run((d) => closeGaps(d, Number(gap) || 40))}
          >
            消除微小空隙
          </button>
        </div>
      </div>

      <div className="ops-group">
        <span className="ops-title">条目</span>
        <div className="ops-row">
          <input
            className="field"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value.replace(/[^\d]/g, ''))}
            title="时长低于该值的条目会被并入下一条"
          />
          <button
            className="btn"
            disabled={disabled}
            onClick={() => run((d) => mergeShortCues(d, Number(minDuration) || 800))}
          >
            合并过短条目
          </button>
        </div>
        <div className="ops-row">
          <button className="btn" disabled={disabled} onClick={() => run(fixOverlaps)}>
            修复重叠
          </button>
          <button className="btn" disabled={disabled} onClick={() => run(removeDuplicates)}>
            删除重复
          </button>
        </div>
        <div className="ops-row">
          <button
            className="btn"
            disabled={disabled}
            title="按标点与长度启发式地把过长的字幕拆成多条，时间按字数比例分配（可预览）"
            onClick={onOpenSplit}
          >
            切分超长条目…
          </button>
        </div>
        <div className="ops-row">
          <button className="btn" disabled={disabled} onClick={() => run(dropEmpty)}>
            删除空条目
          </button>
          <button className="btn" disabled={disabled} onClick={() => run(renumber)}>
            重新编号
          </button>
        </div>
        <div className="ops-row">
          <button
            className="btn danger"
            disabled={disabled || selection.length === 0}
            onClick={() => {
              if (!doc) return;
              commit(doc.id, removeCues(doc, selection));
              setSelection([]);
            }}
          >
            删除选中（{selection.length}）
          </button>
        </div>
      </div>

      <div className="ops-group">
        <span className="ops-title">文本清理</span>
        <div className="ops-row">
          <button className="btn" disabled={disabled} onClick={() => run(stripSdh)}>
            去 SDH 标注
          </button>
          <button className="btn" disabled={disabled} onClick={() => run(stripTags)}>
            去内联标签
          </button>
        </div>
        <span className="ops-hint">
          SDH 标注指 [音乐]、（笑声）、♪ 这类描述性文字；内联标签指 &lt;i&gt;、&lt;font&gt; 等。
        </span>
      </div>

      <div className="ops-group">
        <span className="ops-title">提示</span>
        <span className="ops-hint">
          所有批量操作都会进入撤销历史，误操作可以直接 Ctrl+Z 撤回。
          <br />
          锁定的条目不会被任何批量操作影响。
        </span>
      </div>
    </div>
  );
}
