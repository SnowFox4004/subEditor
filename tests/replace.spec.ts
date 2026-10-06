import { describe, expect, it } from 'vitest';
import { diffChars, summarizeDiff, diffToText } from '../src/core/replace/diff';
import {
  applyAcceptedChanges,
  applyRuleToText,
  buildChangesForDocs,
  compileRule,
  createRule,
  summarizeChanges,
  validateRule,
} from '../src/core/replace/engine';
import { createCue, createDoc } from '../src/core/document';
import type { ReplaceRule, SubtitleDoc } from '../src/core/types';

function doc(...texts: string[]): SubtitleDoc {
  return createDoc({
    name: 't.srt',
    cues: texts.map((text, i) =>
      createCue({ start: i * 3000, end: i * 3000 + 2000, text, index: i + 1 }),
    ),
  });
}

function rule(partial: Partial<ReplaceRule>): ReplaceRule {
  return createRule(partial);
}

/* ================================================================== */
/* diff                                                                */
/* ================================================================== */

describe('diffChars', () => {
  it('完全相同只有一段 equal', () => {
    expect(diffChars('abc', 'abc')).toEqual([{ type: 'equal', text: 'abc' }]);
  });

  it('两个空串返回空数组', () => {
    expect(diffChars('', '')).toEqual([]);
  });

  it('纯插入', () => {
    const segs = diffChars('ab', 'axb');
    expect(segs.map((s) => s.type)).toEqual(['equal', 'insert', 'equal']);
    expect(diffToText(segs)).toBe('axb');
  });

  it('纯删除', () => {
    const segs = diffChars('axb', 'ab');
    expect(segs.map((s) => s.type)).toEqual(['equal', 'delete', 'equal']);
    expect(diffToText(segs)).toBe('ab');
  });

  it('中文替换只标出改动部分', () => {
    const segs = diffChars('你好世界', '您好世界');
    expect(segs).toContainEqual({ type: 'delete', text: '你' });
    expect(segs).toContainEqual({ type: 'insert', text: '您' });
    // 公共部分应当被保留为 equal
    expect(segs.some((s) => s.type === 'equal' && s.text.includes('世界'))).toBe(true);
  });

  it('拼接结果永远等于 after', () => {
    const cases: Array<[string, string]> = [
      ['', 'abc'],
      ['abc', ''],
      ['abc', 'abc'],
      ['你好，世界！', '您好，世界。'],
      ['a'.repeat(500), 'a'.repeat(400) + 'b'.repeat(100)],
      ['C:\\Users\\test', 'C:\\Users\\demo'],
    ];
    for (const [before, after] of cases) {
      expect(diffToText(diffChars(before, after))).toBe(after);
    }
  });

  it('超长文本退化为整段替换但结果仍正确', () => {
    const before = 'x'.repeat(600);
    const after = 'y'.repeat(600);
    const segs = diffChars(before, after);
    expect(diffToText(segs)).toBe(after);
    expect(segs.some((s) => s.type === 'delete')).toBe(true);
    expect(segs.some((s) => s.type === 'insert')).toBe(true);
  });

  it('相邻同类片段会被合并', () => {
    const segs = diffChars('abc', 'xyz');
    // 不应该出现连续两段都是 delete
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].type).not.toBe(segs[i - 1].type);
    }
  });

  it('summarizeDiff 统计增删字数', () => {
    const segs = diffChars('你好世界', '您好世界');
    const s = summarizeDiff(segs);
    expect(s.changed).toBe(true);
    expect(s.inserts).toBe(1);
    expect(s.deletes).toBe(1);
  });
});

/* ================================================================== */
/* 规则校验与编译                                                      */
/* ================================================================== */

describe('validateRule', () => {
  it('空 pattern 不合法', () => {
    expect(validateRule(rule({ pattern: '' })).ok).toBe(false);
  });

  it('正则语法错误会被指出', () => {
    const result = validateRule(rule({ mode: 'regex', pattern: '([' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it('超长 pattern 不合法', () => {
    expect(validateRule(rule({ pattern: 'a'.repeat(1001) })).ok).toBe(false);
  });

  it('正常规则合法', () => {
    expect(validateRule(rule({ pattern: '你好', replacement: '您好' })).ok).toBe(true);
    expect(validateRule(rule({ mode: 'regex', pattern: '(\\d+)', replacement: '$1' })).ok).toBe(true);
  });
});

describe('compileRule', () => {
  it('字面量模式会转义正则元字符', () => {
    const re = compileRule(rule({ pattern: 'a.b' }));
    expect(re.test('a.b')).toBe(true);
    expect(re.test('axb')).toBe(false);
  });

  it('默认区分大小写，关掉后不区分', () => {
    expect(compileRule(rule({ pattern: 'Abc' })).test('abc')).toBe(false);
    expect(compileRule(rule({ pattern: 'Abc', caseSensitive: false })).test('abc')).toBe(true);
  });

  it('整词模式不会匹配更长的词', () => {
    const re = compileRule(rule({ pattern: 'cat', wholeWord: true }));
    expect(re.test('a cat here')).toBe(true);
    expect(re.test('category')).toBe(false);
  });

  it('整词模式对中文同样生效', () => {
    const re = compileRule(rule({ pattern: '好', wholeWord: true }));
    expect(re.test('好')).toBe(true);
    expect(re.test('你好')).toBe(false);
  });
});

describe('applyRuleToText', () => {
  it('字面量替换并统计命中次数', () => {
    const result = applyRuleToText('你好你好', rule({ pattern: '你好', replacement: '您好' }));
    expect(result.text).toBe('您好您好');
    expect(result.count).toBe(2);
  });

  it('字面量替换里的 $ 不会被当成捕获组', () => {
    const result = applyRuleToText('价格 100', rule({ pattern: '100', replacement: '$1元' }));
    expect(result.text).toBe('价格 $1元');
  });

  it('正则支持 $1 反向引用', () => {
    const result = applyRuleToText(
      '时长 1.5 秒',
      rule({ mode: 'regex', pattern: '(\\d+)\\.(\\d+)', replacement: '$1,$2' }),
    );
    expect(result.text).toBe('时长 1,5 秒');
  });

  it('没有命中时原样返回', () => {
    const result = applyRuleToText('abc', rule({ pattern: 'zzz', replacement: 'x' }));
    expect(result.text).toBe('abc');
    expect(result.count).toBe(0);
  });

  it('停用的规则不生效', () => {
    const result = applyRuleToText('你好', rule({ pattern: '你好', replacement: '您好', enabled: false }));
    expect(result.text).toBe('你好');
    expect(result.count).toBe(0);
  });

  it('非法正则会安全地原样返回而不是抛异常', () => {
    const result = applyRuleToText('abc', rule({ mode: 'regex', pattern: '([' }));
    expect(result.text).toBe('abc');
    expect(result.count).toBe(0);
  });
});

/* ================================================================== */
/* 变更集                                                              */
/* ================================================================== */

describe('buildChangesForDocs', () => {
  it('产出「原文 → 最终结果」的变更', () => {
    const changes = buildChangesForDocs(
      [doc('你好世界')],
      [rule({ pattern: '你好', replacement: '您好' })],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].before).toBe('你好世界');
    expect(changes[0].after).toBe('您好世界');
  });

  it('多条规则按顺序叠加', () => {
    const changes = buildChangesForDocs(
      [doc('你好，世界')],
      [
        rule({ id: 'r1', pattern: '你好', replacement: '您好' }),
        rule({ id: 'r2', pattern: '世界', replacement: '地球' }),
      ],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].after).toBe('您好，地球');
    expect(changes[0].ruleIds).toEqual(['r1', 'r2']);
  });

  it('锁定的条目会被跳过', () => {
    const d = doc('你好');
    d.cues[0].locked = true;
    expect(buildChangesForDocs([d], [rule({ pattern: '你好', replacement: '您好' })])).toHaveLength(0);
  });

  it('只改正文时不碰说话人', () => {
    const d = doc('你好');
    d.cues[0].speaker = '你好';
    const changes = buildChangesForDocs([d], [rule({ pattern: '你好', replacement: '您好', scope: 'text' })]);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('text');
  });

  it('scope 为 speaker 时只改说话人', () => {
    const d = doc('你好');
    d.cues[0].speaker = '你好';
    const changes = buildChangesForDocs([d], [rule({ pattern: '你好', replacement: '您好', scope: 'speaker' })]);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('speaker');
    expect(changes[0].after).toBe('您好');
  });

  it('没有命中时返回空数组', () => {
    expect(buildChangesForDocs([doc('abc')], [rule({ pattern: 'zzz', replacement: 'x' })])).toHaveLength(0);
  });

  it('没有可用规则时返回空数组', () => {
    expect(buildChangesForDocs([doc('abc')], [rule({ pattern: '', replacement: 'x' })])).toHaveLength(0);
  });

  it('跨多个文档一起计算', () => {
    const changes = buildChangesForDocs(
      [doc('你好'), doc('你好你好')],
      [rule({ pattern: '你好', replacement: '您好' })],
    );
    expect(changes).toHaveLength(2);
    expect(summarizeChanges(changes)).toEqual({ total: 2, docCount: 2, cueCount: 2 });
  });

  it('变更带上字符级 diff 片段', () => {
    const changes = buildChangesForDocs([doc('你好世界')], [rule({ pattern: '你好', replacement: '您好' })]);
    expect(changes[0].segments.length).toBeGreaterThan(0);
    expect(diffToText(changes[0].segments)).toBe('您好世界');
  });
});

describe('applyAcceptedChanges', () => {
  const rules = [rule({ pattern: '你好', replacement: '您好' })];

  it('采纳后写入文档', () => {
    const d = doc('你好', '你好你好');
    const changes = buildChangesForDocs([d], rules);
    const accepted = new Set(changes.map((c) => c.id));
    const next = applyAcceptedChanges(d, changes, accepted);
    expect(next.cues[0].text).toBe('您好');
    expect(next.cues[1].text).toBe('您好您好');
  });

  it('只采纳其中一条时另一条保持不变', () => {
    const d = doc('你好', '你好你好');
    const changes = buildChangesForDocs([d], rules);
    const next = applyAcceptedChanges(d, changes, new Set([changes[0].id]));
    expect(next.cues[0].text).toBe('您好');
    expect(next.cues[1].text).toBe('你好你好');
  });

  it('一条都不采纳时原样返回同一个对象', () => {
    const d = doc('你好');
    const changes = buildChangesForDocs([d], rules);
    expect(applyAcceptedChanges(d, changes, new Set())).toBe(d);
  });

  it('应用后 rev 推进', () => {
    const d = doc('你好');
    const changes = buildChangesForDocs([d], rules);
    const next = applyAcceptedChanges(d, changes, new Set(changes.map((c) => c.id)));
    expect(next.rev).toBeGreaterThan(d.rev);
  });

  it('说话人字段也能写回', () => {
    const d = doc('正文');
    d.cues[0].speaker = '你好';
    const changes = buildChangesForDocs([d], [rule({ pattern: '你好', replacement: '您好', scope: 'speaker' })]);
    const next = applyAcceptedChanges(d, changes, new Set(changes.map((c) => c.id)));
    expect(next.cues[0].speaker).toBe('您好');
    expect(next.cues[0].text).toBe('正文');
  });
});
