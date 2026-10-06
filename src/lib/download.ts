import { zipSync } from 'fflate';
import { encodeText } from '../core/encoding';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, encoding: string): void {
  const bytes = encodeText(text, encoding);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), filename);
}

export interface ZipEntry {
  name: string;
  text: string;
  encoding: string;
}

/** 同名文件自动加 (1) (2) 后缀，避免 zip 内覆盖 */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  let candidate = `${base} (${i})${ext}`;
  while (used.has(candidate)) {
    i++;
    candidate = `${base} (${i})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export function downloadZip(entries: ZipEntry[], zipName = 'subtitles.zip'): void {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const entry of entries) {
    files[uniqueName(entry.name, used)] = encodeText(entry.text, entry.encoding);
  }
  const zipped = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), zipName);
}
