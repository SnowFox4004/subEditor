import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  listExportFormats,
  listImportFormats,
  parseWithFormat,
  serializeWithFormat,
} from '../src/core/formats';
import { openSubtitleFile } from '../src/core/openFile';
import { createCue, createDoc } from '../src/core/document';
import type { FormatId, SerializeOptions, SubtitleDoc } from '../src/core/types';

function makeDoc(texts: string[], starts?: number[]): SubtitleDoc {
  return createDoc({
    name: 'x',
    cues: texts.map((text, i) => {
      const start = starts?.[i] ?? i * 4000 + 1000;
      return createCue({ start, end: start + 3000, text, index: i + 1 });
    }),
  });
}

function roundTrip(
  format: FormatId,
  source: SubtitleDoc,
  opts: SerializeOptions = {},
): { doc: SubtitleDoc; text: string } {
  const text = serializeWithFormat(format, source, opts);
  const parsed = parseWithFormat(format, text, { filename: `x.${format}` });
  return {
    text,
    doc: createDoc({
      name: `x.${format}`,
      format,
      cues: parsed.cues,
      meta: parsed.meta,
      fps: parsed.fps,
    }),
  };
}

const BASIC = ['第一条', '第二条', '第三条'];
const BASIC_STARTS = [1000, 5000, 9000];

describe('格式注册表', () => {
  it('注册了全部导入导出格式', () => {
    expect(listImportFormats().map((f) => f.id).sort()).toEqual(
      ['ass', 'csv', 'json', 'lrc', 'microdvd', 'sami', 'sbv', 'srt', 'ssa', 'tsv', 'ttml', 'vtt'].sort(),
    );
    // txt 只有导出
    expect(listExportFormats().map((f) => f.id)).toContain('txt');
    expect(listImportFormats().map((f) => f.id)).not.toContain('txt');
  });

  it('按扩展名识别格式', () => {
    const cases: Array<[string, FormatId]> = [
      ['a.srt', 'srt'],
      ['a.vtt', 'vtt'],
      ['a.ass', 'ass'],
      ['a.ssa', 'ssa'],
      ['a.ttml', 'ttml'],
      ['a.dfxp', 'ttml'],
      ['a.sbv', 'sbv'],
      ['a.lrc', 'lrc'],
      ['a.sub', 'microdvd'],
      ['a.smi', 'sami'],
      ['a.json', 'json'],
      ['a.csv', 'csv'],
      ['a.tsv', 'tsv'],
    ];
    for (const [name, expected] of cases) {
      expect(detectFormat('', name), name).toBe(expected);
    }
  });

  it('按内容识别格式（扩展名缺失或写错时）', () => {
    expect(detectFormat('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n', 'unknown')).toBe('vtt');
    expect(detectFormat('[Script Info]\nScriptType: v4.00+\n', 'unknown')).toBe('ass');
    expect(detectFormat('<tt xmlns="http://www.w3.org/ns/ttml"><body/></tt>', 'unknown')).toBe('ttml');
    expect(detectFormat('{100}{200}hello', 'unknown')).toBe('microdvd');
    expect(detectFormat('<SAMI><BODY><SYNC Start=1000>x</SYNC></BODY></SAMI>', 'unknown')).toBe('sami');
    expect(detectFormat('{"cues":[{"start":0,"end":1,"text":"a"}]}', 'unknown')).toBe('json');
  });
});

describe('WebVTT', () => {
  it('往返保持文本与时间', () => {
    const { doc, text } = roundTrip('vtt', makeDoc(BASIC, BASIC_STARTS));
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text).toContain('-->');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1000, 4000],
      [5000, 8000],
      [9000, 12000],
    ]);
  });

  it('跳过 NOTE 与 STYLE 块', () => {
    const text = `WEBVTT

NOTE 这是一条注释
跨行注释

STYLE
::cue { color: white }

1
00:00:01.000 --> 00:00:02.000
真正的字幕
`;
    const parsed = parseWithFormat('vtt', text, {});
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0].text).toBe('真正的字幕');
  });

  it('支持没有序号只有时间行的写法', () => {
    const text = `WEBVTT

00:00:01.000 --> 00:00:02.000
无序号
`;
    expect(parseWithFormat('vtt', text, {}).cues).toHaveLength(1);
  });

  it('保留多行正文', () => {
    const { doc } = roundTrip('vtt', makeDoc(['上\n下']));
    expect(doc.cues[0].text).toBe('上\n下');
  });
});

describe('ASS / SSA', () => {
  it('往返保持文本与时间', () => {
    const { doc, text } = roundTrip('ass', makeDoc(BASIC, BASIC_STARTS));
    expect(text).toContain('[Script Info]');
    expect(text).toContain('[Events]');
    expect(text).toContain('Dialogue:');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1000, 4000],
      [5000, 8000],
      [9000, 12000],
    ]);
  });

  it('换行写成 \\N 并能还原', () => {
    const { doc, text } = roundTrip('ass', makeDoc(['上\n下']));
    expect(text).toContain('上\\N下');
    expect(doc.cues[0].text).toBe('上\n下');
  });

  it('去掉 {\\an8} 这类覆盖标签', () => {
    const text = `[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\an8}居中的字幕
`;
    const parsed = parseWithFormat('ass', text, {});
    expect(parsed.cues[0].text).toBe('居中的字幕');
  });

  it('正文里的逗号不会被字段切分搞坏', () => {
    const text = `[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,你好，世界，再见
`;
    expect(parseWithFormat('ass', text, {}).cues[0].text).toBe('你好，世界，再见');
  });

  it('导入时保留 [Events] 之前的头部，导出时原样写回', () => {
    const text = `[Script Info]
Title: 我的样式表
ScriptType: v4.00+
PlayResX: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: MyStyle,思源黑体,40

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,MyStyle,张三,0,0,0,,台词
`;
    const parsed = parseWithFormat('ass', text, {});
    const doc = createDoc({ name: 'x.ass', format: 'ass', cues: parsed.cues, meta: parsed.meta });
    const out = serializeWithFormat('ass', doc, {});
    expect(out).toContain('Title: 我的样式表');
    expect(out).toContain('Style: MyStyle,思源黑体,40');
    expect(out).toContain('MyStyle');
    expect(doc.cues[0].speaker).toBe('张三');
    expect(doc.cues[0].style?.assStyle).toBe('MyStyle');
  });

  it('SSA 导出使用 V4 Styles 段', () => {
    const { text } = roundTrip('ssa', makeDoc(BASIC));
    expect(text).toContain('[V4 Styles]');
    expect(text).toContain('ScriptType: v4.00');
  });
});

describe('TTML / DFXP', () => {
  it('往返保持文本与时间', () => {
    const { doc, text } = roundTrip('ttml', makeDoc(BASIC, BASIC_STARTS));
    expect(text).toContain('<?xml version="1.0"');
    expect(text).toContain('<tt ');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1000, 4000],
      [5000, 8000],
      [9000, 12000],
    ]);
  });

  it('换行写成 <br/> 并能还原', () => {
    const { doc, text } = roundTrip('ttml', makeDoc(['上\n下']));
    expect(text).toContain('<br/>');
    expect(doc.cues[0].text).toBe('上\n下');
  });

  it('XML 特殊字符会被转义', () => {
    const { doc, text } = roundTrip('ttml', makeDoc(['a < b & c > d']));
    expect(text).toContain('&lt;');
    expect(text).toContain('&amp;');
    expect(doc.cues[0].text).toBe('a < b & c > d');
  });

  it('支持 offset 形式的时间表达式', () => {
    const text = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="1.5s" dur="2s">A</p>
<p begin="5000ms" end="8s">B</p>
</div></body></tt>`;
    const parsed = parseWithFormat('ttml', text, {});
    expect(parsed.cues[0].start).toBe(1500);
    expect(parsed.cues[0].end).toBe(3500);
    expect(parsed.cues[1].start).toBe(5000);
    expect(parsed.cues[1].end).toBe(8000);
  });

  it('缺 end 时用下一条的 begin 补齐', () => {
    const text = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:00:01.000">A</p>
<p begin="00:00:05.000">B</p>
</div></body></tt>`;
    const parsed = parseWithFormat('ttml', text, {});
    expect(parsed.cues[0].end).toBe(5000);
  });

  it('兼容带命名空间前缀的写法', () => {
    const text = `<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div>
<tt:p begin="00:00:01.000" end="00:00:02.000">带前缀</tt:p>
</tt:div></tt:body></tt:tt>`;
    const parsed = parseWithFormat('ttml', text, {});
    expect(parsed.cues[0].text).toBe('带前缀');
  });
});

describe('SBV', () => {
  it('往返保持文本与时间', () => {
    const { doc, text } = roundTrip('sbv', makeDoc(BASIC, BASIC_STARTS));
    expect(text).toMatch(/^0:00:01\.000,0:00:04\.000$/m);
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1000, 4000],
      [5000, 8000],
      [9000, 12000],
    ]);
  });
});

describe('LRC', () => {
  it('往返保持文本与开始时间', () => {
    const { doc, text } = roundTrip('lrc', makeDoc(BASIC, BASIC_STARTS));
    expect(text).toContain('[00:01.00]第一条');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => c.start)).toEqual(BASIC_STARTS);
  });

  it('多行正文压成一行', () => {
    const { doc } = roundTrip('lrc', makeDoc(['上\n下']));
    expect(doc.cues[0].text).toBe('上 下');
  });

  it('解析元信息标签', () => {
    const text = '[ti:歌名]\n[ar:歌手]\n[00:01.00]第一句\n[00:05.00]第二句\n';
    const parsed = parseWithFormat('lrc', text, {});
    expect(parsed.meta.ti).toBe('歌名');
    expect(parsed.meta.ar).toBe('歌手');
    expect(parsed.cues).toHaveLength(2);
  });

  it('一行多个时间戳会展开成多条', () => {
    const text = '[00:01.00][00:05.00]重复的歌词\n';
    expect(parseWithFormat('lrc', text, {}).cues).toHaveLength(2);
  });

  it('offset 标签会整体平移', () => {
    const text = '[offset:500]\n[00:01.00]A\n';
    expect(parseWithFormat('lrc', text, {}).cues[0].start).toBe(500);
  });
});

describe('MicroDVD', () => {
  it('往返保持文本与时间（帧率来自文件声明）', () => {
    const source = { ...makeDoc(BASIC, BASIC_STARTS), fps: 25 };
    const { doc, text } = roundTrip('microdvd', source, { fps: 25 });
    expect(text.startsWith('{1}{1}25.000')).toBe(true);
    expect(doc.fps).toBe(25);
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => c.start)).toEqual(BASIC_STARTS);
  });

  it('竖线表示换行', () => {
    const source = { ...makeDoc(['上\n下']), fps: 25 };
    const { doc, text } = roundTrip('microdvd', source, { fps: 25 });
    expect(text).toContain('上|下');
    expect(doc.cues[0].text).toBe('上\n下');
  });

  it('去掉 {y:i} 这类样式标签', () => {
    const text = '{1}{1}25.000\n{100}{200}{y:i}斜体台词\n';
    expect(parseWithFormat('microdvd', text, {}).cues[0].text).toBe('斜体台词');
  });
});

describe('SAMI', () => {
  it('往返保持文本与时间', () => {
    const { doc, text } = roundTrip('sami', makeDoc(BASIC, BASIC_STARTS));
    expect(text).toContain('<SAMI>');
    expect(text).toContain('<SYNC Start=1000>');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1000, 4000],
      [5000, 8000],
      [9000, 12000],
    ]);
  });
});

describe('JSON', () => {
  it('往返完全无损（毫秒精度）', () => {
    const { doc, text } = roundTrip('json', makeDoc(BASIC, [1001, 5002, 9003]));
    expect(text).toContain('"generator": "srtEditor"');
    expect(doc.cues.map((c) => [c.start, c.end])).toEqual([
      [1001, 4001],
      [5002, 8002],
      [9003, 12003],
    ]);
  });

  it('能读裸数组', () => {
    const text = '[{"start":1000,"end":2000,"text":"A"}]';
    expect(parseWithFormat('json', text, {}).cues[0].text).toBe('A');
  });

  it('能读时间码字符串', () => {
    const text = '[{"start":"00:00:01,000","end":"00:00:02,000","text":"A"}]';
    expect(parseWithFormat('json', text, {}).cues[0].start).toBe(1000);
  });

  it('非法 JSON 会给出可读错误而不是抛异常', () => {
    const parsed = parseWithFormat('json', '{不是 json', {});
    expect(parsed.cues).toHaveLength(0);
    expect(parsed.warnings[0].message).toContain('JSON 解析失败');
  });
});

describe('CSV / TSV', () => {
  it('往返保持文本与时间', () => {
    const { doc, text } = roundTrip('csv', makeDoc(BASIC, BASIC_STARTS));
    expect(text.split('\n')[0]).toBe('index,start,end,speaker,text');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
    expect(doc.cues.map((c) => c.start)).toEqual(BASIC_STARTS);
  });

  it('逗号、引号、换行都能正确往返', () => {
    const tricky = '你好, "世界"\n第二行';
    const { doc } = roundTrip('csv', makeDoc([tricky]));
    expect(doc.cues[0].text).toBe(tricky);
  });

  it('TSV 用制表符分隔', () => {
    const { doc, text } = roundTrip('tsv', makeDoc(BASIC));
    expect(text.split('\n')[0]).toBe('index\tstart\tend\tspeaker\ttext');
    expect(doc.cues.map((c) => c.text)).toEqual(BASIC);
  });

  it('能识别中文表头', () => {
    const text = '序号,开始时间,结束时间,正文\n1,00:00:01.000,00:00:04.000,你好\n';
    const parsed = parseWithFormat('csv', text, {});
    expect(parsed.cues[0].text).toBe('你好');
    expect(parsed.cues[0].start).toBe(1000);
  });
});

describe('纯文本', () => {
  it('每条字幕一行', () => {
    const text = serializeWithFormat('txt', makeDoc(BASIC), {});
    expect(text.trim().split('\n')).toEqual(BASIC);
  });

  it('多行正文压成一行', () => {
    const text = serializeWithFormat('txt', makeDoc(['上\n下']), {});
    expect(text.trim()).toBe('上 下');
  });
});

describe('openSubtitleFile 端到端', () => {
  const encode = (s: string) => new TextEncoder().encode(s);

  it('识别 SRT', () => {
    const result = openSubtitleFile('a.srt', encode('1\n00:00:01,000 --> 00:00:02,000\n你好\n'));
    expect(result.detectedFormat).toBe('srt');
    expect(result.doc.cues).toHaveLength(1);
  });

  it('识别 WebVTT', () => {
    const result = openSubtitleFile('a.vtt', encode('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n你好\n'));
    expect(result.detectedFormat).toBe('vtt');
    expect(result.doc.cues[0].text).toBe('你好');
  });

  it('识别 ASS', () => {
    const ass = `[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,你好
`;
    const result = openSubtitleFile('a.ass', encode(ass));
    expect(result.detectedFormat).toBe('ass');
    expect(result.doc.cues[0].text).toBe('你好');
  });

  it('扩展名写错时按内容兜底识别', () => {
    const result = openSubtitleFile('a.txt', encode('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n你好\n'));
    expect(result.detectedFormat).toBe('vtt');
  });

  it('GBK 编码的 SRT 能正确解码并解析', () => {
    // "你好" 的 GBK 字节 + SRT 骨架
    const head = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n');
    const tail = new TextEncoder().encode('\n');
    const bytes = new Uint8Array([...head, 0xc4, 0xe3, 0xba, 0xc3, ...tail]);
    const result = openSubtitleFile('a.srt', bytes);
    expect(result.detectedEncoding).toBe('gb18030');
    expect(result.doc.cues[0].text).toBe('你好');
  });

  it('无法识别的内容会抛错', () => {
    expect(() => openSubtitleFile('a.srt', encode('完全不是字幕的随机内容'))).toThrow();
  });
});
