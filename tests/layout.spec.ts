import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  MIN_EDITOR_HEIGHT,
  MIN_MEDIA_PANE_HEIGHT,
  clampMediaPaneHeight,
  gridTemplateOf,
  minTableWidthOf,
  type ColumnDef,
} from '../src/state/layout';

describe('列布局', () => {
  it('默认列包含时间列，且宽度足够放下时间码输入框', () => {
    const start = DEFAULT_COLUMNS.find((c) => c.key === 'start')!;
    const end = DEFAULT_COLUMNS.find((c) => c.key === 'end')!;
    // 4 个输入框 + 3 个分隔符 + 间距 + 单元格内边距 ≈ 152px
    expect(start.width).toBeGreaterThanOrEqual(152);
    expect(end.width).toBeGreaterThanOrEqual(152);
  });

  it('gridTemplateOf 只为可见列生成轨道', () => {
    const columns: ColumnDef[] = [
      { key: 'index', label: '序号', width: 58, minWidth: 44, maxWidth: 120, visible: true },
      { key: 'start', label: '开始时间', width: 156, minWidth: 140, maxWidth: 260, visible: false },
      { key: 'text', label: '正文', width: 300, minWidth: 160, maxWidth: 4000, visible: true, flexible: true },
    ];
    expect(gridTemplateOf(columns)).toBe('58px minmax(300px, 1fr)');
  });

  it('正文列用 minmax 吃掉剩余宽度', () => {
    expect(gridTemplateOf(DEFAULT_COLUMNS)).toContain('minmax(360px, 1fr)');
  });

  it('隐藏列后模板里不再出现该列', () => {
    const hidden = DEFAULT_COLUMNS.map((c) =>
      c.key === 'duration' ? { ...c, visible: false } : c,
    );
    const template = gridTemplateOf(hidden);
    // 时长列的默认宽度是 78px，隐藏后不该再出现
    expect(template).not.toContain('78px');
    expect(template).toContain('minmax(360px, 1fr)');
    expect(minTableWidthOf(hidden)).toBeLessThan(minTableWidthOf(DEFAULT_COLUMNS));
  });

  it('minTableWidthOf 随隐藏列变小', () => {
    const fewer = DEFAULT_COLUMNS.map((c) =>
      c.key === 'duration' ? { ...c, visible: false } : c,
    );
    expect(minTableWidthOf(fewer)).toBeLessThan(minTableWidthOf(DEFAULT_COLUMNS));
  });

  it('没有任何可见列时给出兜底宽度', () => {
    const none = DEFAULT_COLUMNS.map((c) => ({ ...c, visible: false }));
    expect(minTableWidthOf(none)).toBeGreaterThan(0);
  });
});

describe('媒体区高度夹取', () => {
  it('不低于最小值', () => {
    expect(clampMediaPaneHeight(10, 1000)).toBe(MIN_MEDIA_PANE_HEIGHT);
  });

  it('给编辑区留出最小高度', () => {
    expect(clampMediaPaneHeight(5000, 900)).toBe(900 - MIN_EDITOR_HEIGHT);
  });

  it('正常范围内原样返回', () => {
    expect(clampMediaPaneHeight(400, 1000)).toBe(400);
  });

  it('容器比最小值还小时不会返回负数', () => {
    expect(clampMediaPaneHeight(300, 100)).toBeGreaterThanOrEqual(MIN_MEDIA_PANE_HEIGHT);
  });
});
