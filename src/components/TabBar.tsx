import { useState } from 'react';
import { useEditorStore } from '../state/store';

export function TabBar() {
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const docs = useEditorStore((s) => s.docs);
  const activeId = useEditorStore((s) => s.activeId);
  const savedRev = useEditorStore((s) => s.savedRev);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const reorderTabs = useEditorStore((s) => s.reorderTabs);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [overSide, setOverSide] = useState<'before' | 'after'>('before');

  if (tabOrder.length === 0) return null;

  const dirtyMap = Object.fromEntries(
    tabOrder.map((id) => [id, docs[id]?.rev !== savedRev[id]]),
  );

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const target = overSide === 'before' ? index : index + 1;
    reorderTabs(dragIndex, target > dragIndex ? target - 1 : target);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="tabbar" role="tablist">
      {tabOrder.map((id, index) => {
        const doc = docs[id];
        if (!doc) return null;
        const dirty = dirtyMap[id];
        const classes = ['tab'];
        if (id === activeId) classes.push('active');
        if (dragIndex === index) classes.push('dragging');
        if (overIndex === index && dragIndex !== null) {
          classes.push(overSide === 'before' ? 'drop-before' : 'drop-after');
        }

        return (
          <div
            key={id}
            role="tab"
            aria-selected={id === activeId}
            className={classes.join(' ')}
            title={doc.name}
            draggable
            onClick={() => setActive(id)}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setOverIndex(index);
              setOverSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
            }}
            onDragLeave={() => setOverIndex((cur) => (cur === index ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(index);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(id);
            }}
          >
            {dirty && <span className="tab-dot" title="有未保存的修改" />}
            <span className="tab-name">{doc.name}</span>
            <span className="tab-count">{doc.cues.length}</span>
            <button
              className="tab-close"
              title="关闭标签页"
              onClick={(e) => {
                e.stopPropagation();
                if (dirty && !window.confirm(`「${doc.name}」有未保存的修改，确定关闭吗？`)) return;
                closeTab(id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
