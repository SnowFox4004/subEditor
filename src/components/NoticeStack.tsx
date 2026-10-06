import { useEditorStore } from '../state/store';

export function NoticeStack() {
  const notices = useEditorStore((s) => s.notices);
  const dismiss = useEditorStore((s) => s.dismissNotice);

  if (notices.length === 0) return null;

  return (
    <div className="notices">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.level}`} onClick={() => dismiss(n.id)}>
          {n.message}
        </div>
      ))}
    </div>
  );
}
