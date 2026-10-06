import { useMemo } from 'react';
import type { SubtitleDoc } from '../core/types';
import { useEditorStore } from '../state/store';
import { DEFAULT_SPLIT_OPTIONS, countSplittable } from '../core/split';

interface Props {
  doc: SubtitleDoc | null;
  onOpenSplit: () => void;
}

const LEVEL_LABEL: Record<string, string> = {
  error: '!',
  warn: '!',
  info: 'i',
};

export function ValidationPanel({ doc, onOpenSplit }: Props) {
  const setSelection = useEditorStore((s) => s.setSelection);

  const warnings = doc?.warnings ?? [];

  // 按切分口径统计，而不是按质检阈值 —— 这样按钮上的数字就是点进去真正会处理的条数
  const splittable = useMemo(
    () => (doc ? countSplittable([doc], DEFAULT_SPLIT_OPTIONS) : 0),
    [doc],
  );

  return (
    <>
      <div className="panel-head">
        <span>校验</span>
        <span style={{ color: 'var(--text-tertiary)' }}>{warnings.length} 项</span>
      </div>
      <div className="panel-body">
        {warnings.length === 0 ? (
          <div className="panel-empty">
            {doc ? '未发现问题' : '打开文件后在此查看解析告警与质检结果'}
          </div>
        ) : (
          warnings.map((w, i) => (
            <div
              key={`${w.code}-${i}`}
              className="warn-item"
              onClick={() => {
                if (w.cueIds.length > 0) setSelection([w.cueIds[0]]);
              }}
            >
              <span className={`warn-badge ${w.level}`}>{LEVEL_LABEL[w.level] ?? 'i'}</span>
              <span className="warn-text">{w.message}</span>
            </div>
          ))
        )}
      </div>

      <div className="panel-foot">
        <button
          className="btn"
          disabled={!doc || splittable === 0}
          title={
            doc
              ? '按标点与长度启发式地把过长的字幕拆成多条，时间按字数比例分配'
              : '先打开一个字幕文件'
          }
          onClick={onOpenSplit}
        >
          {splittable > 0 ? `切分超长条目（${splittable} 条）` : '切分超长条目'}
        </button>
      </div>
    </>
  );
}
