/**
 * 批量替换规则引擎。纯函数，无 DOM / React 依赖，可脱离浏览器单测。
 *
 * 安全策略：
 *  1. 限制 pattern 长度，避免超长正则带来的编译开销
 *  2. 限制单字段匹配次数上限，防止病态正则产生海量匹配
 *  3. 编译与执行全部包在 try/catch 里，单条规则出错不影响其它规则
 *  4. 真正的「灾难性回溯导致卡死」由外层 Web Worker + 超时兜底（见 replaceClient.ts）
 */
import type { Change, ReplaceRule, SubtitleDoc } from '../types';
import { replaceCues } from '../document';
import { diffChars } from './diff';

/** 正则 pattern 最大长度 */
export const MAX_PATTERN_LENGTH = 1000;
/** 单个字段单条规则的匹配次数上限 */
export const MAX_MATCHES_PER_FIELD = 20_000;

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 字面量替换时，`$` 必须转义，否则 `$1` 会被当成捕获组引用 */
function escapeReplacement(text: string): string {
  return text.replace(/\$/g, '$$$$');
}

export interface RuleValidation {
  ok: boolean;
  message?: string;
}

export function validateRule(rule: ReplaceRule): RuleValidation {
  if (!rule.pattern) return { ok: false, message: '查找内容不能为空' };
  if (rule.pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, message: `查找内容过长（上限 ${MAX_PATTERN_LENGTH} 字符）` };
  }
  if (rule.mode === 'regex') {
    try {
      compileRule(rule);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '正则表达式无效' };
    }
  }
  return { ok: true };
}

/**
 * 编译规则为正则。字面量模式会先转义，整词模式会加上前后边界断言。
 * 抛异常表示规则无效，调用方需先 validateRule。
 */
export function compileRule(rule: ReplaceRule): RegExp {
  const base = rule.mode === 'literal' ? escapeLiteral(rule.pattern) : rule.pattern;
  const body = rule.wholeWord
    ? `(?<![\\p{L}\\p{N}_])(?:${base})(?![\\p{L}\\p{N}_])`
    : base;

  const flags = 'g' + (rule.caseSensitive ? '' : 'i');
  try {
    return new RegExp(body, flags + 'u');
  } catch {
    // 有些合法但不符合 unicode 模式的写法（如多余的转义）会在这里失败，
    // 退回不带 u 的模式再试一次
    return new RegExp(body, flags);
  }
}

export interface ApplyResult {
  text: string;
  count: number;
  /** 命中次数超过上限被截断 */
  truncated?: boolean;
}

/** 对单个字符串应用一条规则 */
export function applyRuleToText(text: string, rule: ReplaceRule): ApplyResult {
  if (!rule.enabled || !rule.pattern) return { text, count: 0 };

  let re: RegExp;
  try {
    re = compileRule(rule);
  } catch {
    return { text, count: 0 };
  }

  let count = 0;
  try {
    for (const _match of text.matchAll(re)) {
      void _match;
      count++;
      if (count > MAX_MATCHES_PER_FIELD) break;
    }
  } catch {
    return { text, count: 0 };
  }

  if (count === 0) return { text, count: 0 };

  const replacement =
    rule.mode === 'literal' ? escapeReplacement(rule.replacement) : rule.replacement;

  try {
    const next = text.replace(re, replacement);
    return { text: next, count: Math.min(count, MAX_MATCHES_PER_FIELD) };
  } catch {
    return { text, count: 0 };
  }
}

/**
 * 计算变更集：对每条字幕按规则顺序叠加应用，最终产出「一条字幕一个字段一项变更」。
 * 这样预览里看到的是「原文 → 最终结果」，而 ruleIds 记录中间命中了哪些规则。
 */
export function buildChangesForDocs(docs: SubtitleDoc[], rules: ReplaceRule[]): Change[] {
  const active = rules.filter((r) => r.enabled && r.pattern !== '');
  if (active.length === 0) return [];

  const wantsText = active.some((r) => r.scope === 'text' || r.scope === 'both');
  const wantsSpeaker = active.some((r) => r.scope === 'speaker' || r.scope === 'both');
  const changes: Change[] = [];

  for (const doc of docs) {
    for (const cue of doc.cues) {
      // 锁定的条目不参与批量替换
      if (cue.locked) continue;

      const fields: Array<'text' | 'speaker'> = [];
      if (wantsText) fields.push('text');
      if (wantsSpeaker && cue.speaker) fields.push('speaker');

      for (const field of fields) {
        const original = (field === 'text' ? cue.text : cue.speaker) ?? '';
        if (original === '') continue;

        let working = original;
        const hitRules: string[] = [];

        for (const rule of active) {
          if (rule.scope !== 'both' && rule.scope !== field) continue;
          const result = applyRuleToText(working, rule);
          if (result.count > 0 && result.text !== working) {
            working = result.text;
            hitRules.push(rule.id);
          }
        }

        if (working === original) continue;

        changes.push({
          id: `${doc.id}::${cue.id}::${field}`,
          docId: doc.id,
          cueId: cue.id,
          field,
          before: original,
          after: working,
          segments: diffChars(original, working),
          ruleId: hitRules[hitRules.length - 1] ?? null,
          ruleIds: hitRules,
        });
      }
    }
  }

  return changes;
}

/** 把用户采纳的变更写回文档 */
export function applyAcceptedChanges(
  doc: SubtitleDoc,
  changes: Change[],
  accepted: ReadonlySet<string>,
): SubtitleDoc {
  const byCue = new Map<string, Change[]>();

  for (const change of changes) {
    if (change.docId !== doc.id) continue;
    if (!accepted.has(change.id)) continue;
    const list = byCue.get(change.cueId);
    if (list) list.push(change);
    else byCue.set(change.cueId, [change]);
  }

  if (byCue.size === 0) return doc;

  const cues = doc.cues.map((cue) => {
    const list = byCue.get(cue.id);
    if (!list) return cue;
    let next = cue;
    for (const change of list) {
      if (change.field === 'text') next = { ...next, text: change.after, dirty: true };
      else if (change.field === 'speaker') next = { ...next, speaker: change.after, dirty: true };
    }
    return next;
  });

  return replaceCues(doc, cues);
}

export interface ChangeSummary {
  /** 变更条数（一条字幕一个字段算一项） */
  total: number;
  /** 涉及的文档数 */
  docCount: number;
  /** 涉及的字幕条数 */
  cueCount: number;
}

export function summarizeChanges(changes: Change[]): ChangeSummary {
  return {
    total: changes.length,
    docCount: new Set(changes.map((c) => c.docId)).size,
    cueCount: new Set(changes.map((c) => c.cueId)).size,
  };
}

/* ------------------------------------------------------------------ */
/* 规则工厂与规则集                                                    */
/* ------------------------------------------------------------------ */

export function createRule(partial: Partial<ReplaceRule> = {}): ReplaceRule {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? '',
    mode: partial.mode ?? 'literal',
    pattern: partial.pattern ?? '',
    replacement: partial.replacement ?? '',
    caseSensitive: partial.caseSensitive ?? true,
    wholeWord: partial.wholeWord ?? false,
    scope: partial.scope ?? 'text',
    enabled: partial.enabled ?? true,
  };
}

export interface Ruleset {
  id: string;
  name: string;
  rules: ReplaceRule[];
  updatedAt: number;
}

const RULESET_KEY = 'srteditor-rulesets';

export function loadRulesets(): Ruleset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RULESET_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Ruleset =>
        !!r && typeof r === 'object' && typeof (r as Ruleset).name === 'string',
    );
  } catch {
    return [];
  }
}

export function saveRulesets(rulesets: Ruleset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RULESET_KEY, JSON.stringify(rulesets));
  } catch {
    /* 隐私模式下可能写入失败，忽略 */
  }
}
