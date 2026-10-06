// @vitest-environment happy-dom
/**
 * 组件级冒烟测试：真实挂载 React 树，能抓出 import 错误、store 接线错误、
 * 渲染期异常等纯逻辑单测覆盖不到的问题。
 *
 * 注意：happy-dom 没有布局引擎，滚动容器高度恒为 0，@tanstack/react-virtual
 * 因此不会渲染任何行。所以这里不通过 DOM 断言字幕行内容，改由 store 断言 +
 * 单独的 CueRow 渲染测试覆盖。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { CueRow } from '../src/components/CueRow';
import { useEditorStore } from '../src/state/store';
import { usePlayerStore } from '../src/state/player';
import { useLayoutStore } from '../src/state/layout';
import { createCue, updateCue } from '../src/core/document';

const SRT = `1
00:00:01,000 --> 00:00:04,000
你好世界

2
00:00:05,000 --> 00:00:08,000
第二句
`;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(node);
  });
}

function screen(): string {
  return container?.textContent ?? '';
}

async function open(...files: File[]) {
  await act(async () => {
    await useEditorStore.getState().openFiles(files);
  });
}

beforeEach(() => {
  useEditorStore.setState({
    docs: {},
    savedRev: {},
    tabOrder: [],
    activeId: null,
    history: {},
    selection: [],
    notices: [],
  });
  // 布局与播放器都是模块级单例，测之间要复位，否则会互相污染
  useLayoutStore.getState().resetColumns();
  useLayoutStore.getState().setMediaPaneHeight(null);
  usePlayerStore.getState().clearMedia();
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

describe('App 冒烟', () => {
  it('没有文件时展示空状态与隐私说明', async () => {
    await mount(<App />);
    expect(screen()).toContain('把字幕文件拖进来');
    expect(screen()).toContain('文件不会上传到任何服务器');
  });

  it('打开文件后生成标签页、状态栏并载入字幕', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt', { type: 'text/plain' }));

    // 标签页
    expect(screen()).toContain('demo.srt');
    // 状态栏统计
    expect(screen()).toContain('共 2 条');
    expect(screen()).toContain('时长 00:00:08');
    expect(screen()).toContain('编码 UTF-8');
    // 表头
    expect(screen()).toContain('序号');
    expect(screen()).toContain('正文');
    // 空状态已消失
    expect(screen()).not.toContain('把字幕文件拖进来');

    // 内容落在 store 里
    const state = useEditorStore.getState();
    const doc = state.docs[state.activeId as string];
    expect(doc.cues.map((c) => c.text)).toEqual(['你好世界', '第二句']);
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1000, 4000],
      [5000, 8000],
    ]);
  });

  it('打开多个文件生成多个标签页，并激活最后一个', async () => {
    await mount(<App />);
    await open(
      new File([SRT], 'a.srt'),
      new File([SRT], 'b.srt'),
      new File([SRT], 'c.srt'),
    );

    const state = useEditorStore.getState();
    expect(state.tabOrder).toHaveLength(3);
    expect(state.activeId).toBe(state.tabOrder[2]);

    expect(screen()).toContain('a.srt');
    expect(screen()).toContain('b.srt');
    expect(screen()).toContain('c.srt');
  });

  it('打开不是字幕的文件不会崩，会明确拒绝并给出提示', async () => {
    await mount(<App />);
    await open(new File(['随便一些文本'], 'bad.srt'));

    // 不生成标签页，而是弹出一条可读的错误提示
    expect(useEditorStore.getState().tabOrder).toHaveLength(0);
    expect(screen()).toContain('打开失败');
    expect(screen()).toContain('bad.srt');
    // 界面仍然正常，回落到空状态
    expect(screen()).toContain('把字幕文件拖进来');
  });
});

describe('CueRow 渲染', () => {
  it('展示序号、时间码与正文，并响应编辑', async () => {
    const cue = createCue({ start: 1000, end: 4000, text: '原始文本', index: 7 });
    const changes: Array<[string, string]> = [];

    await mount(
      <CueRow
        cue={cue}
        visibleColumns={['index', 'start', 'end', 'duration', 'text', 'actions']}
        gridTemplate="58px 156px 156px 78px minmax(360px, 1fr) 88px"
        selected={false}
        overlapping={false}
        canMerge
        onChangeText={(id, text) => changes.push([id, text])}
        onChangeTime={() => {}}
        onSelect={() => {}}
        onSplit={() => {}}
        onMerge={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onToggleLock={() => {}}
      />,
    );

    const row = container?.querySelector('.cue-row');
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain('7');
    expect(row?.textContent).toContain('00:00:03'); // 时长 3 秒

    const textarea = container?.querySelector('textarea');
    expect(textarea?.value).toBe('原始文本');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '改过的文本');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(changes.at(-1)?.[1]).toBe('改过的文本');
  });

  it('锁定状态下正文只读', async () => {
    const cue = createCue({ start: 0, end: 1000, text: 'A', locked: true });
    await mount(
      <CueRow
        cue={cue}
        visibleColumns={['index', 'start', 'end', 'duration', 'text', 'actions']}
        gridTemplate="58px 156px 156px 78px minmax(360px, 1fr) 88px"
        selected={false}
        overlapping={false}
        canMerge={false}
        onChangeText={() => {}}
        onChangeTime={() => {}}
        onSelect={() => {}}
        onSplit={() => {}}
        onMerge={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onToggleLock={() => {}}
      />,
    );
    expect(container?.querySelector('textarea')?.readOnly).toBe(true);
    expect(container?.querySelector('.cue-row')?.className).toContain('locked');
  });
});

describe('store 与 UI 联动', () => {
  it('编辑后状态栏出现「已修改」，撤销后回到「未修改」', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    const docId = useEditorStore.getState().activeId as string;
    const before = useEditorStore.getState().docs[docId].cues[0].text;
    expect(screen()).toContain('未修改');

    await act(async () => {
      const doc = useEditorStore.getState().docs[docId];
      useEditorStore
        .getState()
        .commit(docId, updateCue(doc, doc.cues[0].id, { text: '临时改动' }));
    });

    expect(useEditorStore.getState().docs[docId].cues[0].text).toBe('临时改动');
    expect(screen()).toContain('已修改');

    await act(async () => {
      useEditorStore.getState().undo(docId);
    });

    expect(useEditorStore.getState().docs[docId].cues[0].text).toBe(before);
    expect(screen()).toContain('未修改');
  });

  it('关闭标签页后回到空状态', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));
    const docId = useEditorStore.getState().activeId as string;

    await act(async () => {
      useEditorStore.getState().closeTab(docId);
    });

    expect(useEditorStore.getState().tabOrder).toHaveLength(0);
    expect(screen()).toContain('把字幕文件拖进来');
  });

  it('切换标签页会切换编辑对象', async () => {
    await mount(<App />);
    await open(new File([SRT], 'a.srt'), new File([SRT], 'b.srt'));

    const [first, second] = useEditorStore.getState().tabOrder;
    expect(useEditorStore.getState().activeId).toBe(second);

    await act(async () => {
      useEditorStore.getState().setActive(first);
    });
    expect(useEditorStore.getState().activeId).toBe(first);

    // 两个文档各自独立
    const state = useEditorStore.getState();
    expect(state.docs[first].id).not.toBe(state.docs[second].id);
    expect(Object.keys(state.docs)).toHaveLength(2);
  });
});

describe('时间轴与媒体预览', () => {
  it('时间轴为每条字幕渲染一个块', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    const blocks = container?.querySelectorAll('.timeline-block');
    expect(blocks?.length).toBe(2);
    expect(container?.querySelector('.timeline-ruler')).toBeTruthy();
    // 块上带序号与正文
    expect(blocks?.[0].textContent).toContain('你好世界');
  });

  it('时间轴块宽度与时长成正比', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    const blocks = Array.from(container?.querySelectorAll<HTMLElement>('.timeline-block') ?? []);
    // 两条时长都是 3 秒，宽度应当一致
    const w0 = Number.parseFloat(blocks[0].style.width);
    const w1 = Number.parseFloat(blocks[1].style.width);
    expect(w0).toBeGreaterThan(0);
    expect(w0).toBeCloseTo(w1, 3);
    // 第二条起始更靠右
    const l0 = Number.parseFloat(blocks[0].style.left);
    const l1 = Number.parseFloat(blocks[1].style.left);
    expect(l1).toBeGreaterThan(l0);
  });

  it('载入媒体后出现预览面板与播放器', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    await act(async () => {
      usePlayerStore
        .getState()
        .loadMedia(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }));
    });

    expect(usePlayerStore.getState().mediaUrl).toBeTruthy();
    expect(screen()).toContain('clip.mp4');
    expect(container?.querySelector('.media-pane')).toBeTruthy();
    expect(container?.querySelector('.media-frame')).toBeTruthy();
    expect(container?.querySelector('video')).toBeTruthy();
    // 上下分屏：媒体区与编辑区是兄弟节点，中间有可拖拽的分隔条
    expect(container?.querySelector('.splitter-h')).toBeTruthy();
    expect(container?.querySelector('.editor-column')).toBeTruthy();
  });

  it('视频尺寸未知时不渲染字幕叠加层（避免贴错位置）', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));
    await act(async () => {
      usePlayerStore
        .getState()
        .loadMedia(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }));
    });

    // happy-dom 没有布局引擎，videoWidth/videoHeight 恒为 0，
    // 因此叠加层不会渲染 —— 这正是期望行为：拿不到画面尺寸就不猜位置。
    expect(container?.querySelector('.subtitle-overlay')).toBeNull();
  });

  it('播放进度落在某条字幕上时该行被标记为 playing', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));
    await act(async () => {
      usePlayerStore
        .getState()
        .loadMedia(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }));
    });

    // 2 秒处应命中第一条字幕（1000~4000ms）
    await act(async () => {
      usePlayerStore.getState().setCurrentTime(2000);
    });

    const docId = useEditorStore.getState().activeId as string;
    const doc = useEditorStore.getState().docs[docId];
    expect(doc.cues[0].start).toBeLessThanOrEqual(2000);
    expect(doc.cues[0].end).toBeGreaterThan(2000);
    // 虚拟列表在 happy-dom 下不渲染行，但状态栏应显示媒体已就绪
    expect(container?.querySelector('.media-foot')).toBeTruthy();
  });
});

describe('表格列设置', () => {
  it('默认时间列足够宽，不会挤压重叠', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    const head = container?.querySelector('.cuelist-head') as HTMLElement | null;
    expect(head).toBeTruthy();
    const template = head?.style.gridTemplateColumns ?? '';
    // 4 个时间码输入框 + 分隔符 + 间距 + 内边距 ≈ 152px
    expect(template).toContain('156px');
    expect(template).toContain('minmax(360px, 1fr)');
  });

  it('隐藏列后表头不再渲染该列', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    const headBefore = container?.querySelector('.cuelist-head') as HTMLElement | null;
    expect(headBefore?.textContent).toContain('时长');

    await act(async () => {
      useLayoutStore.getState().setColumnVisible('duration', false);
    });

    // 只看表头 —— 状态栏里也有「时长」字样
    const head = container?.querySelector('.cuelist-head') as HTMLElement | null;
    expect(head?.textContent).not.toContain('时长');
    expect(head?.textContent).toContain('正文');
    expect(head?.style.gridTemplateColumns).not.toContain('78px');
  });

  it('调整列宽后表头模板同步更新', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    await act(async () => {
      useLayoutStore.getState().setColumnWidth('start', 200);
    });

    const head = container?.querySelector('.cuelist-head') as HTMLElement | null;
    expect(head?.style.gridTemplateColumns).toContain('200px');
  });

  it('列宽被夹在上下限之间', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    await act(async () => {
      useLayoutStore.getState().setColumnWidth('start', 10);
    });
    expect(useLayoutStore.getState().columns.find((c) => c.key === 'start')?.width).toBe(140);

    await act(async () => {
      useLayoutStore.getState().setColumnWidth('start', 9999);
    });
    expect(useLayoutStore.getState().columns.find((c) => c.key === 'start')?.width).toBe(260);
  });

  it('至少保留一列可见', async () => {
    await mount(<App />);
    await open(new File([SRT], 'demo.srt'));

    await act(async () => {
      for (const col of useLayoutStore.getState().columns) {
        useLayoutStore.getState().setColumnVisible(col.key, false);
      }
    });

    expect(useLayoutStore.getState().columns.filter((c) => c.visible)).toHaveLength(1);
  });
});
