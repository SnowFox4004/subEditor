import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Change, ReplaceRule } from '../core/types';
import {
  applyAcceptedChanges,
  createRule,
  loadRulesets,
  saveRulesets,
  summarizeChanges,
  validateRule,
  type Ruleset,
} from '../core/replace/engine';
import { runReplace } from '../state/replaceClient';
import { useEditorStore } from '../state/store';

interface Props {
  onClose: () => void;
}

type Scope = 'current' | 'all';

const FIELD_LABEL: Record<Change['field'], string> = {
  text: '正文',
  speaker: '说话人',
  start: '开始时间',
  end: '结束时间',
};

export function ReplacePanel({ onClose }: Props) {
  const docs = useEditorStore((s) => s.docs);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const activeId = useEditorStore((s) => s.activeId);
  const commit = useEditorStore((s) => s.commit);
  const pushNotice = useEditorStore((s) => s.pushNotice);

  const [rules, setRules] = useState<ReplaceRule[]>(() => [createRule()]);
  const [scope, setScope] = useState<Scope>('current');
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);

  useEffect(() => {
    setRulesets(loadRulesets());
  }, []);

  /** 变更集失效（规则或范围变了就作废，避免误应用过期结果） */
  const invalidate = useCallback(() => {
    setChanges(null);
    setAccepted(new Set());
    setError(null);
  }, []);

  const targetDocs = useMemo(() => {
    if (scope === 'all') {
      return tabOrder.map((id) => docs[id]).filter(Boolean);
    }
    return activeId && docs[activeId] ? [docs[activeId]] : [];
  }, [scope, tabOrder, docs, activeId]);

  const docNameOf = useCallback(
    (docId: string) => docs[docId]?.name ?? docId,
    [docs],
  );

  const ruleNameOf = useCallback(
    (ruleId: string) => {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return '';
      return rule.name || rule.pattern;
    },
    [rules],
  );

  const updateRule = (id: string, patch: Partial<ReplaceRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    invalidate();
  };

  const addRule = () => {
    setRules((prev) => [...prev, createRule()]);
    invalidate();
  };

  const removeRule = (id: string) => {
    setRules((prev) => (prev.length <= 1 ? [createRule()] : prev.filter((r) => r.id !== id)));
    invalidate();
  };

  const moveRule = (id: string, delta: number) => {
    setRules((prev) => {
      const at = prev.findIndex((r) => r.id === id);
      if (at < 0) return prev;
      const to = Math.max(0, Math.min(prev.length - 1, at + delta));
      if (to === at) return prev;
      const next = [...prev];
      const [item] = next.splice(at, 1);
      next.splice(to, 0, item);
      return next;
    });
    invalidate();
  };

  const activeRules = rules.filter((r) => r.enabled && r.pattern !== '');

  const handlePreview = async () => {
    const invalid = rules
      .map((r) => ({ rule: r, result: validateRule(r) }))
      .find((x) => x.rule.enabled && x.rule.pattern !== '' && !x.result.ok);
    if (invalid) {
      setError(`规则「${invalid.rule.name || invalid.rule.pattern}」有问题：${invalid.result.message}`);
      return;
    }
    if (activeRules.length === 0) {
      setError('至少需要一条填了「查找内容」且启用的规则');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await runReplace(targetDocs, activeRules);
      if (result.error) {
        setError(result.error);
        setChanges([]);
        setAccepted(new Set());
      } else {
        setChanges(result.changes);
        setAccepted(new Set(result.changes.map((c) => c.id)));
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleAccept = (changeId: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(changeId)) next.delete(changeId);
      else next.add(changeId);
      return next;
    });
  };

  const handleApply = () => {
    if (!changes || changes.length === 0) return;
    if (accepted.size === 0) {
      pushNotice('warn', '没有选中任何变更');
      return;
    }

    const affectedDocIds = new Set(
      changes.filter((c) => accepted.has(c.id)).map((c) => c.docId),
    );

    for (const docId of affectedDocIds) {
      const doc = docs[docId];
      if (!doc) continue;
      const next = applyAcceptedChanges(doc, changes, accepted);
      if (next !== doc) commit(docId, next);
    }

    pushNotice('info', `已应用 ${accepted.size} 处替换，涉及 ${affectedDocIds.size} 个文件`);
    onClose();
  };

  const handleSaveRuleset = () => {
    const name = window.prompt('规则集名称', `规则集 ${rulesets.length + 1}`);
    if (!name) return;
    const entry: Ruleset = {
      id: crypto.randomUUID(),
      name,
      rules: rules.map((r) => ({ ...r })),
      updatedAt: Date.now(),
    };
    const next = [entry, ...rulesets.filter((r) => r.name !== name)];
    setRulesets(next);
    saveRulesets(next);
    pushNotice('info', `规则集「${name}」已保存`);
  };

  const handleLoadRuleset = (id: string) => {
    const entry = rulesets.find((r) => r.id === id);
    if (!entry) return;
    // 重新分配 id，避免和当前列表里的规则撞车
    setRules(entry.rules.map((r) => ({ ...r, id: crypto.randomUUID() })));
    invalidate();
    pushNotice('info', `已载入规则集「${entry.name}」`);
  };

  const handleDeleteRuleset = (id: string) => {
    const entry = rulesets.find((r) => r.id === id);
    if (!entry) return;
    if (!window.confirm(`删除规则集「${entry.name}」？`)) return;
    const next = rulesets.filter((r) => r.id !== id);
    setRulesets(next);
    saveRulesets(next);
  };

  const summary = changes ? summarizeChanges(changes) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal replace-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          批量替换
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>

        <div className="replace-body">
          {/* 左栏：规则 */}
          <div className="replace-col rules">
            <div className="replace-col-head">
              <span>规则（按顺序叠加）</span>
              <button className="btn ghost" onClick={addRule}>
                ＋ 添加
              </button>
            </div>

            <div className="replace-scroll">
              {rules.map((rule, index) => {
                const validation = validateRule(rule);
                const showError = rule.pattern !== '' && !validation.ok;
                return (
                  <div key={rule.id} className={`rule-card ${rule.enabled ? '' : 'disabled'}`}>
                    <div className="rule-head">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        title="启用/停用"
                        onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                      />
                      <span className="rule-index">{index + 1}</span>
                      <input
                        className="field rule-name"
                        placeholder="规则名（可选）"
                        value={rule.name}
                        onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                      />
                      <button
                        className="btn ghost icon"
                        title="上移"
                        disabled={index === 0}
                        onClick={() => moveRule(rule.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn ghost icon"
                        title="下移"
                        disabled={index === rules.length - 1}
                        onClick={() => moveRule(rule.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="btn ghost icon danger"
                        title="删除规则"
                        onClick={() => removeRule(rule.id)}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="rule-row">
                      <select
                        className="field"
                        value={rule.mode}
                        onChange={(e) =>
                          updateRule(rule.id, { mode: e.target.value as ReplaceRule['mode'] })
                        }
                      >
                        <option value="literal">字面量</option>
                        <option value="regex">正则</option>
                      </select>
                      <select
                        className="field"
                        value={rule.scope}
                        onChange={(e) =>
                          updateRule(rule.id, { scope: e.target.value as ReplaceRule['scope'] })
                        }
                      >
                        <option value="text">正文</option>
                        <option value="speaker">说话人</option>
                        <option value="both">两者</option>
                      </select>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={rule.caseSensitive}
                          onChange={(e) => updateRule(rule.id, { caseSensitive: e.target.checked })}
                        />
                        区分大小写
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={rule.wholeWord}
                          onChange={(e) => updateRule(rule.id, { wholeWord: e.target.checked })}
                        />
                        整词
                      </label>
                    </div>

                    <div className="rule-row">
                      <input
                        className="field mono grow"
                        placeholder={rule.mode === 'regex' ? '查找（支持 $1 分组）' : '查找'}
                        value={rule.pattern}
                        onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
                      />
                      <span className="arrow">→</span>
                      <input
                        className="field mono grow"
                        placeholder={rule.mode === 'regex' ? '替换为（可用 $1）' : '替换为'}
                        value={rule.replacement}
                        onChange={(e) => updateRule(rule.id, { replacement: e.target.value })}
                      />
                    </div>

                    {showError && <div className="rule-error">{validation.message}</div>}
                  </div>
                );
              })}
            </div>

            <div className="replace-col-foot">
              <select
                className="field"
                value=""
                onChange={(e) => e.target.value && handleLoadRuleset(e.target.value)}
              >
                <option value="">载入规则集…</option>
                {rulesets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={handleSaveRuleset}>
                保存为规则集
              </button>
              {rulesets.length > 0 && (
                <button
                  className="btn ghost danger"
                  title="删除最近保存的规则集"
                  onClick={() => handleDeleteRuleset(rulesets[0].id)}
                >
                  删除
                </button>
              )}
            </div>
          </div>

          {/* 右栏：预览 */}
          <div className="replace-col preview">
            <div className="replace-col-head">
              <span>预览</span>
              <select
                className="field"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as Scope);
                  invalidate();
                }}
              >
                <option value="current">当前文件</option>
                <option value="all">全部标签页（{tabOrder.length}）</option>
              </select>
              <button className="btn primary" disabled={busy} onClick={handlePreview}>
                {busy ? '计算中…' : '预览改动'}
              </button>
            </div>

            {error && <div className="replace-error">{error}</div>}

            {!changes && !error && (
              <div className="panel-empty">
                填好规则后点「预览改动」。
                <br />
                预览只是计算，不会改动任何内容。
              </div>
            )}

            {changes && changes.length === 0 && !error && (
              <div className="panel-empty">没有命中任何内容</div>
            )}

            {changes && changes.length > 0 && summary && (
              <>
                <div className="replace-summary">
                  <span>
                    共 <b>{summary.total}</b> 处改动，涉及 <b>{summary.cueCount}</b> 条字幕、
                    <b>{summary.docCount}</b> 个文件
                  </span>
                  <span className="spacer" style={{ flex: 1 }} />
                  <button className="btn ghost" onClick={() => setAccepted(new Set(changes.map((c) => c.id)))}>
                    全选
                  </button>
                  <button className="btn ghost" onClick={() => setAccepted(new Set())}>
                    全不选
                  </button>
                </div>

                <div className="replace-scroll">
                  {changes.map((change) => {
                    const isAccepted = accepted.has(change.id);
                    return (
                      <div
                        key={change.id}
                        className={`change-item ${isAccepted ? 'accepted' : 'rejected'}`}
                        onClick={() => toggleAccept(change.id)}
                      >
                        <input
                          type="checkbox"
                          checked={isAccepted}
                          onChange={() => toggleAccept(change.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="change-main">
                          <div className="change-meta">
                            <span className="change-doc">{docNameOf(change.docId)}</span>
                            <span className="change-field">{FIELD_LABEL[change.field]}</span>
                            {change.ruleIds.length > 0 && (
                              <span className="change-rules">
                                命中：{change.ruleIds.map(ruleNameOf).join(' → ')}
                              </span>
                            )}
                          </div>
                          <div className="change-diff">
                            {change.segments.map((seg, i) =>
                              seg.type === 'equal' ? (
                                <span key={i}>{seg.text}</span>
                              ) : (
                                <span
                                  key={i}
                                  className={seg.type === 'delete' ? 'diff-del' : 'diff-ins'}
                                >
                                  {seg.text}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <span style={{ flex: 1, color: 'var(--text-tertiary)', fontSize: 12 }}>
            {changes ? `已选 ${accepted.size} / ${changes.length} 处` : '预览后可逐条勾选要应用的改动'}
          </span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!changes || accepted.size === 0}
            onClick={handleApply}
          >
            应用选中的 {accepted.size} 处
          </button>
        </div>
      </div>
    </div>
  );
}
