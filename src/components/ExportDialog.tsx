import { useMemo, useState } from 'react';
import type { FormatId, SubtitleDoc } from '../core/types';
import { listExportFormats, serializeWithFormat } from '../core/formats';
import { DEFAULT_MICRODVD_FPS } from '../core/formats/misc';
import { ENCODING_OPTIONS, hasEncoder } from '../core/encoding';
import { downloadText, downloadZip, type ZipEntry } from '../lib/download';
import { useEditorStore } from '../state/store';

interface Props {
  doc: SubtitleDoc;
  onClose: () => void;
}

type NewlineMode = 'lf' | 'crlf';

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function ExportDialog({ doc, onClose }: Props) {
  const docs = useEditorStore((s) => s.docs);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const markSaved = useEditorStore((s) => s.markSaved);
  const pushNotice = useEditorStore((s) => s.pushNotice);

  const formats = useMemo(() => listExportFormats(), []);
  const [format, setFormat] = useState<FormatId>(
    formats.some((f) => f.id === doc.format) ? doc.format : (formats[0]?.id ?? 'srt'),
  );
  const [encoding, setEncoding] = useState(doc.bom ? 'utf-8-bom' : 'utf-8');
  const [newline, setNewline] = useState<NewlineMode>(doc.newline === '\r\n' ? 'crlf' : 'lf');
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [fps, setFps] = useState(String(doc.fps ?? DEFAULT_MICRODVD_FPS));

  const codec = formats.find((f) => f.id === format);
  const ext = codec?.extensions[0] ?? 'srt';
  const needsFps = format === 'microdvd';

  const buildText = (target: SubtitleDoc) =>
    serializeWithFormat(format, target, {
      newline: newline === 'crlf' ? '\r\n' : '\n',
      fps: Number.parseFloat(fps) || DEFAULT_MICRODVD_FPS,
    });

  const handleExport = () => {
    try {
      if (scope === 'current') {
        downloadText(buildText(doc), `${baseName(doc.name)}.${ext}`, encoding);
        markSaved(doc.id);
        pushNotice('info', `已导出 ${baseName(doc.name)}.${ext}`);
      } else {
        const entries: ZipEntry[] = tabOrder
          .map((id) => docs[id])
          .filter((d): d is SubtitleDoc => !!d)
          .map((d) => ({
            name: `${baseName(d.name)}.${ext}`,
            text: buildText(d),
            encoding,
          }));
        if (entries.length === 0) {
          pushNotice('warn', '没有可导出的文件');
          return;
        }
        downloadZip(entries, `subtitles-${ext}.zip`);
        tabOrder.forEach((id) => markSaved(id));
        pushNotice('info', `已打包导出 ${entries.length} 个文件`);
      }
      onClose();
    } catch (err) {
      pushNotice('error', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">导出字幕</div>
        <div className="modal-body">
          <div className="modal-row">
            <label>格式</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-row">
            <label>编码</label>
            <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
              {ENCODING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} disabled={!hasEncoder(o.value)}>
                  {o.label}
                  {hasEncoder(o.value) ? '' : '（尚未支持）'}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-row">
            <label>换行</label>
            <select value={newline} onChange={(e) => setNewline(e.target.value as NewlineMode)}>
              <option value="lf">LF（Unix / macOS）</option>
              <option value="crlf">CRLF（Windows）</option>
            </select>
          </div>

          {needsFps && (
            <div className="modal-row">
              <label>帧率</label>
              <input
                type="text"
                value={fps}
                onChange={(e) => setFps(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="23.976 / 25 / 29.97"
              />
            </div>
          )}

          <div className="modal-row">
            <label>范围</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as 'current' | 'all')}>
              <option value="current">仅当前文件</option>
              <option value="all">全部标签页（打包 zip）</option>
            </select>
          </div>

          <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 12 }}>
            文件名：{scope === 'current' ? `${baseName(doc.name)}.${ext}` : `subtitles-${ext}.zip`}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={handleExport}>
            导出
          </button>
        </div>
      </div>
    </div>
  );
}
