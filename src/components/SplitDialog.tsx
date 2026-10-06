import { useCallback, useMemo, useState } from 'react';
import type { SubtitleDoc } from '../core/types';
import {
  DEFAULT_SPLIT_OPTIONS,
  applySplitPlans,
  planSplits,
  summarizeSplits,
  type SplitOptions,
  type SplitPlan,
} from '../core/split';
import { formatSrtTime } from '../core/timecode';
import { useEditorStore } from '../state/store';

interface Props {
  onClose: () => void;
}

type Scope = 'current' | 'all';

export function SplitDialog({ onClose }: Props) {
  const docs = useEditorStore((s) => s.docs);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const activeId = useEditorStore((s) => s.activeId);
  const commit = useEditorStore((s) => s.commit);
  const pushNotice = useEditorStore((s) => s.pushNotice);

  const [opts, setOpts] = useState<SplitOptions>(DEFAULT_SPLIT_OPTIONS);
  const [scope, setScope] = useState<Scope>('current');
  const [plans, setPlans] = useState<SplitPlan[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const targetDocs = useMemo(() => {
    if (scope === 'all') return tabOrder.map((id) => docs[id]).filter(Boolean);
    return activeId && docs[activeId] ? [docs[activeId]] : [];
  }, [scope, tabOrder, docs, activeId]);

  /** 规则或范围一变，旧预览立刻作废，避免误应用过期结果 */
  const invalidate = useCallback(() => {
    setPlans(null);
    setAccepted(new Set());
  }, []);

  const updateOpts = (patch: Partial<SplitOptions>) => {
    setOpts((prev) => ({ ...prev, ...patch }));
    invalidate();
  };

  const handlePreview = () => {
    const result = planSplits(targetDocs, opts);
    setPlans(result);
    setAccepted(new Set(result.map((p) => p.id)));
  };

  const toggleAccept = (id: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const acceptedPlans = useMemo(
    () => (plans ?? []).filter((p) => accepted.has(p.id)),
    [plans, accepted],
  );
  const summary = useMemo(() => summarizeSplits(acceptedPlans), [acceptedPlans]);

  const docNameOf = useCallback((docId: string) => docs[docId]?.name ?? docId, [docs]);

  const handleApply = () => {
    if (!plans || acceptedPlans.length === 0) {
      pushNotice('warn', '没有选中任何切分项');
      return;
    }

    const affected = new Set(acceptedPlans.map((p) => p.docId));
    let changed = 0;

    for (const docId of affected) {
      const doc: SubtitleDoc | undefined = docs[docId];
      if (!doc) continue;
      const next = applySplitPlans(doc, plans, accepted);
      if (next !== doc) {
        commit(docId, next);
        changed++;
      }
    }

    pushNotice(
      'info',
      `已切分 ${acceptedPlans.length} 条，新增 ${summary.addedCount} 条，涉及 ${changed} 个文件`,
    );
    onClose();
  };

  const maxCharsPerCue = opts.maxCharsPerLine * opts.linesPerCue;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal split-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          切分超长条目
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>

        <div className="split-body">
          {/* 左栏：参数 */}
          <div className="split-col options">
            <div className="ops-group">
              <span className="ops-title">切分口径</span>
              <div className="ops-row">
                <span style={{ width: 84, color: 'var(--text-secondary)' }}>每行最多</span>
                <input
                  className="field"
                  value={opts.maxCharsPerLine}
                  inputMode="numeric"
                  onChange={(e) =>
                    updateOpts({
                      maxCharsPerLine: Math.max(4, Number(e.target.value.replace(/[^\d]/g, '')) || 4),
                    })
                  }
                />
                <span style={{ color: 'var(--text-tertiary)' }}>字</span>
              </div>
              <div className="ops-row">
                <span style={{ width: 84, color: 'var(--text-secondary)' }}>每条最多</span>
                <input
                  className="field"
                  value={opts.linesPerCue}
                  inputMode="numeric"
                  onChange={(e) =>
                    updateOpts({
                      linesPerCue: Math.max(1, Number(e.target.value.replace(/[^\d]/g, '')) || 1),
                    })
                  }
                />
                <span style={{ color: 'var(--text-tertiary)' }}>行</span>
              </div>
              <div className="ops-row">
                <span style={{ width: 84, color: 'var(--text-secondary)' }}>最短时长</span>
                <input
                  className="field"
                  value={opts.minDurationMs}
                  inputMode="numeric"
                  onChange={(e) =>
                    updateOpts({
                      minDurationMs: Math.max(100, Number(e.target.value.replace(/[^\d]/g, '')) || 100),
                    })
                  }
                />
                <span style={{ color: 'var(--text-tertiary)' }}>ms</span>
              </div>
              <label className="check" style={{ marginTop: 2 }}>
                <input
                  type="checkbox"
                  checked={opts.breakOnPunctuation}
                  onChange={(e) => updateOpts({ breakOnPunctuation: e.target.checked })}
                />
                优先在标点处断开
              </label>
              <span className="ops-hint">
                即每条最多 <b>{maxCharsPerCue}</b> 字。超过这个量、或单行超过{' '}
                <b>{opts.maxCharsPerLine}</b> 字的条目会被列入切分范围。
              </span>
            </div>

            <div className="ops-group">
              <span className="ops-title">范围</span>
              <div className="ops-row">
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
              </div>
            </div>

            <div className="ops-group">
              <span className="ops-title">时间怎么分</span>
              <span className="ops-hint">
                按各段字符数占比分配原条目的时间区间 —— 字多的那段占的时间长。
                每段至少 {opts.minDurationMs}ms；如果总时长不够切成这么多段，
                会自动合并成更少的段，宁可不切也不切出看不清的碎条目。
              </span>
            </div>

            <div className="ops-group">
              <span className="ops-title">说明</span>
              <span className="ops-hint">
                预览只计算不改动。勾选后才写入，整次操作算一步，可以直接 Ctrl+Z 撤回。
                锁定的条目会被跳过。
              </span>
            </div>
          </div>

          {/* 右栏：预览 */}
          <div className="split-col preview">
            <div className="replace-col-head">
              <span>预览</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="btn primary" onClick={handlePreview}>
                {plans ? '重新计算' : '预览切分'}
              </button>
            </div>

            {!plans && (
              <div className="panel-empty">
                设好口径后点「预览切分」。
                <br />
                预览只是计算，不会改动任何内容。
              </div>
            )}

            {plans && plans.length === 0 && (
              <div className="panel-empty">
                按当前口径没有需要切分的条目。
                <br />
                可以把「每行最多」调小一点再试。
              </div>
            )}

            {plans && plans.length > 0 && (
              <>
                <div className="replace-summary">
                  <span>
                    共 <b>{summary.cueCount}</b> 条需要切分，切分后新增{' '}
                    <b>{summary.addedCount}</b> 条，涉及 <b>{summary.docCount}</b> 个文件
                    {summary.limitedCount > 0 && (
                      <span className="split-limit-tag">
                        （其中 {summary.limitedCount} 条因时长不足未能切到理想段数）
                      </span>
                    )}
                  </span>
                  <span className="spacer" style={{ flex: 1 }} />
                  <button
                    className="btn ghost"
                    onClick={() => setAccepted(new Set(plans.map((p) => p.id)))}
                  >
                    全选
                  </button>
                  <button className="btn ghost" onClick={() => setAccepted(new Set())}>
                    全不选
                  </button>
                </div>

                <div className="replace-scroll">
                  {plans.map((plan) => {
                    const isAccepted = accepted.has(plan.id);
                    return (
                      <div
                        key={plan.id}
                        className={`split-item ${isAccepted ? '' : 'rejected'}`}
                        onClick={() => toggleAccept(plan.id)}
                      >
                        <div className="split-item-head">
                          <input
                            type="checkbox"
                            checked={isAccepted}
                            onChange={() => toggleAccept(plan.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span>{docNameOf(plan.docId)}</span>
                          <span>#{plan.index}</span>
                          <span>
                            {plan.pieces.length} 条 · {plan.before.text.replace(/\n/g, '').length} 字
                          </span>
                          {plan.durationLimited && (
                            <span className="split-limit-tag">时长不足，已减少段数</span>
                          )}
                        </div>

                        <div className="split-before">
                          <span className="split-before-time">
                            {formatSrtTime(plan.before.start)}
                          </span>
                          <span className="split-before-text">
                            {plan.before.text.replace(/\n/g, ' / ')}
                          </span>
                        </div>

                        <div className="split-arrow">↓</div>

                        <div className="split-pieces">
                          {plan.pieces.map((piece, i) => (
                            <div className="split-piece" key={i}>
                              <span className="split-piece-time">
                                {formatSrtTime(piece.start)} → {formatSrtTime(piece.end)}
                              </span>
                              <span className="split-piece-text">
                                {piece.text.replace(/\n/g, ' / ')}
                              </span>
                            </div>
                          ))}
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
            {plans
              ? `已选 ${accepted.size} / ${plans.length} 条，应用后新增 ${summary.addedCount} 条`
              : '预览后可逐条勾选要切分的条目'}
          </span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={acceptedPlans.length === 0} onClick={handleApply}>
            切分选中的 {acceptedPlans.length} 条
          </button>
        </div>
      </div>
    </div>
  );
}
