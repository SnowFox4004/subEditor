import { useEffect, useRef, useState } from 'react';
import { splitTime } from '../core/timecode';

interface Props {
  value: number;
  onChange: (ms: number) => void;
  disabled?: boolean;
}

function pad(n: number, len = 2): string {
  return String(Math.max(0, Math.trunc(n))).padStart(len, '0');
}

function toFields(ms: number): string[] {
  const p = splitTime(ms);
  return [pad(p.h), pad(p.m), pad(p.s), pad(p.ms, 3)];
}

const LIMITS = [999, 59, 59, 999];
const WIDTHS = ['wide', '', '', 'wide'];

/**
 * 分段式时间码输入：`HH : MM : SS , mmm`
 * 失焦或回车时提交；支持 ↑/↓ 按字段步进。
 */
export function TimecodeInput({ value, onChange, disabled }: Props) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  // 外部值变化时清掉草稿，保持同步
  useEffect(() => {
    setDraft(null);
  }, [value]);

  const fields = draft ?? toFields(value);

  const commit = (next: string[]) => {
    const h = Number.parseInt(next[0] || '0', 10) || 0;
    const m = Number.parseInt(next[1] || '0', 10) || 0;
    const s = Number.parseInt(next[2] || '0', 10) || 0;
    const ms = Number.parseInt((next[3] || '0').padEnd(3, '0').slice(0, 3), 10) || 0;
    setDraft(null);
    onChange(((h * 60 + m) * 60 + s) * 1000 + ms);
  };

  const handleChange = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, i === 3 ? 3 : 2);
    const next = [...fields];
    next[i] = digits;
    setDraft(next);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(fields);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === 'Escape') {
      setDraft(null);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.key === 'ArrowUp' ? 1 : -1;
      const cur = Number.parseInt(fields[i] || '0', 10) || 0;
      const max = LIMITS[i];
      let nextVal = cur + step;
      if (nextVal < 0) nextVal = max;
      if (nextVal > max) nextVal = 0;
      const next = [...fields];
      next[i] = pad(nextVal, i === 3 ? 3 : 2);
      setDraft(next);
      commit(next);
      return;
    }
    if (e.key === ':' || e.key === ',' || e.key === '.') {
      e.preventDefault();
      refs.current[Math.min(i + 1, 3)]?.focus();
      refs.current[Math.min(i + 1, 3)]?.select();
    }
  };

  const seps = [':', ':', ','];

  return (
    <div className="timecode">
      {fields.map((f, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={WIDTHS[i]}
            value={f}
            disabled={disabled}
            inputMode="numeric"
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            onBlur={() => draft && commit(fields)}
          />
          {i < 3 && <span className="sep">{seps[i]}</span>}
        </span>
      ))}
    </div>
  );
}
