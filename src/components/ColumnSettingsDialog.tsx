import { useEffect, useState } from 'react';
import { useLayoutStore, type ColumnDef } from '../state/layout';

interface Props {
  onClose: () => void;
}

/** 宽度输入用本地草稿 + 失焦/回车提交，避免每敲一个数字就被夹到最小值 */
function WidthInput({ col }: { col: ColumnDef }) {
  const setColumnWidth = useLayoutStore((s) => s.setColumnWidth);
  const [draft, setDraft] = useState(String(col.width));

  useEffect(() => {
    setDraft(String(col.width));
  }, [col.width]);

  const commit = () => {
    const value = Number.parseInt(draft, 10);
    if (Number.isFinite(value)) setColumnWidth(col.key, value);
    else setDraft(String(col.width));
  };

  return (
    <input
      className="field"
      value={draft}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function ColumnSettingsDialog({ onClose }: Props) {
  const columns = useLayoutStore((s) => s.columns);
  const setColumnVisible = useLayoutStore((s) => s.setColumnVisible);
  const resetColumns = useLayoutStore((s) => s.resetColumns);

  const visibleCount = columns.filter((c) => c.visible).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">列设置</div>
        <div className="modal-body">
          <div className="columns-list">
            {columns.map((col) => (
              <div className="columns-row" key={col.key}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    disabled={col.visible && visibleCount <= 1}
                    onChange={(e) => setColumnVisible(col.key, e.target.checked)}
                  />
                  {col.label}
                </label>
                <WidthInput col={col} />
                <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>px</span>
              </div>
            ))}
          </div>
          <p className="columns-hint">
            也可以直接在表头的列分隔线上拖动调整宽度，双击分隔线恢复该列默认宽度。
            至少保留一列可见。
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={resetColumns}>
            恢复默认
          </button>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
