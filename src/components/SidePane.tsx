import { useState } from 'react';
import type { SubtitleDoc } from '../core/types';
import { ValidationPanel } from './ValidationPanel';
import { OpsPanel } from './OpsPanel';

interface Props {
  doc: SubtitleDoc | null;
  /** 打开「切分超长条目」对话框 */
  onOpenSplit: () => void;
}

type Tab = 'validate' | 'ops';

export function SidePane({ doc, onOpenSplit }: Props) {
  const [tab, setTab] = useState<Tab>('validate');

  const errorCount = doc?.warnings.filter((w) => w.level === 'error').length ?? 0;
  const warnCount = doc?.warnings.filter((w) => w.level === 'warn').length ?? 0;
  const problemCount = errorCount + warnCount;

  return (
    <aside className="side-pane">
      <div className="side-tabs">
        <button
          className={`side-tab ${tab === 'validate' ? 'active' : ''}`}
          onClick={() => setTab('validate')}
        >
          校验{problemCount > 0 ? ` (${problemCount})` : ''}
        </button>
        <button
          className={`side-tab ${tab === 'ops' ? 'active' : ''}`}
          onClick={() => setTab('ops')}
        >
          批量操作
        </button>
      </div>
      {tab === 'validate' ? (
        <ValidationPanel doc={doc} onOpenSplit={onOpenSplit} />
      ) : (
        <OpsPanel doc={doc} onOpenSplit={onOpenSplit} />
      )}
    </aside>
  );
}
