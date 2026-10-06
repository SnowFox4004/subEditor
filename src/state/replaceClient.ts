/**
 * 批量替换的调度层：优先丢进 Web Worker 并加超时保护，
 * 环境不支持 Worker（单测 / 老浏览器）时同步执行。
 */
import type { Change, ReplaceRule, SubtitleDoc } from '../core/types';
import { buildChangesForDocs } from '../core/replace/engine';
import type { ReplaceRequest, ReplaceResponse } from '../workers/replace.worker';

export const REPLACE_TIMEOUT_MS = 2500;

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/replace.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    worker = null;
  }
  return worker;
}

export interface ReplaceRunResult {
  changes: Change[];
  mode: 'worker' | 'sync';
  timedOut?: boolean;
  error?: string;
}

export async function runReplace(
  docs: SubtitleDoc[],
  rules: ReplaceRule[],
  timeoutMs = REPLACE_TIMEOUT_MS,
): Promise<ReplaceRunResult> {
  const w = getWorker();

  // 没有 Worker 可用 → 同步跑（单测环境走这条路）
  if (!w) {
    try {
      return { changes: buildChangesForDocs(docs, rules), mode: 'sync' };
    } catch (err) {
      return {
        changes: [],
        mode: 'sync',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const id = ++seq;

  return new Promise<ReplaceRunResult>((resolve) => {
    let settled = false;

    const finish = (result: ReplaceRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(result);
    };

    const timer = setTimeout(() => {
      // 超时几乎一定是灾难性回溯，直接杀掉 worker 免得它继续吃 CPU
      w.terminate();
      worker = null;
      finish({
        changes: [],
        mode: 'worker',
        timedOut: true,
        error: `替换超时（超过 ${timeoutMs}ms），已中止。请检查正则是否过于复杂。`,
      });
    }, timeoutMs);

    const onMessage = (event: MessageEvent<ReplaceResponse>) => {
      const data = event.data;
      if (!data || data.id !== id) return;
      if (data.ok) finish({ changes: data.changes, mode: 'worker' });
      else finish({ changes: [], mode: 'worker', error: data.error });
    };

    w.addEventListener('message', onMessage);

    const request: ReplaceRequest = { id, docs, rules };
    try {
      w.postMessage(request);
    } catch (err) {
      finish({
        changes: [],
        mode: 'worker',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
