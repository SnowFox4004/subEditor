import { getStats } from '../core/document';
import { formatDuration } from '../core/timecode';
import type { SubtitleDoc } from '../core/types';

interface Props {
  doc: SubtitleDoc | null;
  dirty: boolean;
  savedAt: number | null;
}

export function StatusBar({ doc, dirty, savedAt }: Props) {
  if (!doc) {
    return (
      <div className="statusbar">
        <span>就绪 · 拖入或选择 .srt 文件开始</span>
        <span className="spacer" />
        <span>纯本地运行，文件不会上传</span>
      </div>
    );
  }

  const stats = getStats(doc);
  const errorCount = doc.warnings.filter((w) => w.level === 'error').length;
  const warnCount = doc.warnings.filter((w) => w.level === 'warn').length;

  return (
    <div className="statusbar">
      <span>
        共 <span className="num">{stats.count}</span> 条
      </span>
      <span>
        时长 <span className="num">{formatDuration(stats.duration)}</span>
      </span>
      <span>
        编码 <span className="num">{doc.encoding.toUpperCase()}</span>
      </span>
      <span>
        换行 <span className="num">{doc.newline === '\r\n' ? 'CRLF' : 'LF'}</span>
      </span>
      {errorCount > 0 && <span style={{ color: 'var(--danger)' }}>{errorCount} 个错误</span>}
      {warnCount > 0 && <span style={{ color: 'var(--warn)' }}>{warnCount} 个告警</span>}
      <span className="spacer" style={{ flex: 1 }} />
      {dirty ? (
        <span className="dirty">● 已修改</span>
      ) : (
        <span className="ok">✓ 未修改</span>
      )}
      {savedAt && !dirty && (
        <span style={{ color: 'var(--text-tertiary)' }}>
          已保存 {new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
      )}
      <span style={{ color: 'var(--text-tertiary)' }}>文件不出本机</span>
    </div>
  );
}
