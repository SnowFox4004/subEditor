/// <reference lib="webworker" />
/**
 * 批量替换 Worker。
 * 存在的唯一理由：正则灾难性回溯会把主线程锁死，浏览器连「无响应」提示都弹不出来。
 * 放进 Worker 后主线程始终可用，超时可以直接 terminate 掉。
 */
import type { Change, ReplaceRule, SubtitleDoc } from '../core/types';
import { buildChangesForDocs } from '../core/replace/engine';

export interface ReplaceRequest {
  id: number;
  docs: SubtitleDoc[];
  rules: ReplaceRule[];
}

export type ReplaceResponse =
  | { id: number; ok: true; changes: Change[] }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<ReplaceRequest>) => {
  const { id, docs, rules } = event.data;
  try {
    const changes = buildChangesForDocs(docs, rules);
    ctx.postMessage({ id, ok: true, changes } satisfies ReplaceResponse);
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ReplaceResponse);
  }
};
