import { describe, expect, it } from 'vitest';
import { parseSrt, serializeSrt } from '../src/core/formats/srt';
import { createDoc } from '../src/core/document';
import { decodeBytes } from '../src/core/encoding';
import { detectFormat } from '../src/core/formats';

const BASIC = `1
00:00:01,000 --> 00:00:04,000
第一条字幕

2
00:00:05,500 --> 00:00:08,000
第二条
分两行
`;

function docOf(text: string) {
  const parsed = parseSrt(text);
  return createDoc({ name: 'test.srt', cues: parsed.cues, warnings: parsed.warnings });
}

describe('parseSrt 基本能力', () => {
  it('解析条数、时间与多行正文', () => {
    const { cues } = parseSrt(BASIC);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1000);
    expect(cues[0].end).toBe(4000);
    expect(cues[0].text).toBe('第一条字幕');
    expect(cues[1].text).toBe('第二条\n分两行');
  });

  it('CRLF 换行同样可解析', () => {
    const { cues } = parseSrt(BASIC.replace(/\n/g, '\r\n'));
    expect(cues).toHaveLength(2);
    expect(cues[1].text).toBe('第二条\n分两行');
  });

  it('忽略 UTF-8 BOM', () => {
    const { cues } = parseSrt(`\uFEFF${BASIC}`);
    expect(cues).toHaveLength(2);
  });

  it('缺少序号时自动补正并记 info 告警', () => {
    const text = `00:00:01,000 --> 00:00:02,000
没有序号
`;
    const { cues, warnings } = parseSrt(text);
    expect(cues).toHaveLength(1);
    expect(cues[0].index).toBe(1);
    expect(warnings.some((w) => w.code === 'missing-index')).toBe(true);
  });

  it('序号重复会记告警但不丢数据', () => {
    const text = `1
00:00:01,000 --> 00:00:02,000
A

1
00:00:03,000 --> 00:00:04,000
B
`;
    const { cues, warnings } = parseSrt(text);
    expect(cues).toHaveLength(2);
    expect(warnings.some((w) => w.code === 'duplicate-index')).toBe(true);
  });

  it('正文中的空行不会被当作块分隔符', () => {
    const text = `1
00:00:01,000 --> 00:00:02,000
上半段

下半段

2
00:00:03,000 --> 00:00:04,000
第二条
`;
    const { cues } = parseSrt(text);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('上半段\n\n下半段');
  });

  it('块之间缺少空行也能切分', () => {
    const text = `1
00:00:01,000 --> 00:00:02,000
A
2
00:00:03,000 --> 00:00:04,000
B
`;
    const { cues } = parseSrt(text);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('A');
    expect(cues[1].text).toBe('B');
  });

  it('双箭头 ---> 也能识别', () => {
    const text = `1
00:00:01,000 ---> 00:00:02,000
A
`;
    expect(parseSrt(text).cues).toHaveLength(1);
  });

  it('时间码用句点也接受', () => {
    const text = `1
00:00:01.000 --> 00:00:02.000
A
`;
    expect(parseSrt(text).cues[0].start).toBe(1000);
  });

  it('正文为空会记告警', () => {
    const text = `1
00:00:01,000 --> 00:00:02,000


2
00:00:03,000 --> 00:00:04,000
B
`;
    const { cues, warnings } = parseSrt(text);
    expect(cues).toHaveLength(2);
    expect(warnings.some((w) => w.code === 'empty-text')).toBe(true);
  });

  it('时间重叠会记告警且不修改数据', () => {
    const text = `1
00:00:01,000 --> 00:00:05,000
A

2
00:00:04,000 --> 00:00:06,000
B
`;
    const { cues, warnings } = parseSrt(text);
    expect(cues[1].start).toBe(4000);
    expect(warnings.some((w) => w.code === 'overlap')).toBe(true);
  });

  it('结束早于开始会记 error 告警', () => {
    const text = `1
00:00:05,000 --> 00:00:02,000
A
`;
    const { warnings } = parseSrt(text);
    expect(warnings.some((w) => w.code === 'negative-duration' && w.level === 'error')).toBe(true);
  });

  it('保留正文里的 HTML 标签', () => {
    const text = `1
00:00:01,000 --> 00:00:02,000
<i>斜体</i>与<font color="#fff">彩色</font>
`;
    expect(parseSrt(text).cues[0].text).toBe('<i>斜体</i>与<font color="#fff">彩色</font>');
  });

  it('完全解析不出内容时给出 error 告警', () => {
    const { cues, warnings } = parseSrt('这不是字幕文件\n随便几行文本\n');
    expect(cues).toHaveLength(0);
    expect(warnings.some((w) => w.code === 'unparsed')).toBe(true);
  });

  it('文件末尾没有空行也能正常结束', () => {
    const text = `1
00:00:01,000 --> 00:00:02,000
A`;
    expect(parseSrt(text).cues).toHaveLength(1);
  });
});

describe('serializeSrt', () => {
  it('往返解析后内容一致', () => {
    const doc = docOf(BASIC);
    const out = serializeSrt(doc);
    const again = parseSrt(out);
    expect(again.cues).toHaveLength(2);
    expect(again.cues.map((c) => c.text)).toEqual(doc.cues.map((c) => c.text));
    expect(again.cues.map((c) => [c.start, c.end])).toEqual(
      doc.cues.map((c) => [c.start, c.end]),
    );
  });

  it('序号统一重排为从 1 连续', () => {
    const doc = docOf(BASIC);
    const scrambled = { ...doc, cues: doc.cues.map((c, i) => ({ ...c, index: 100 + i })) };
    const out = serializeSrt(scrambled);
    expect(out.startsWith('1\n00:00:01,000')).toBe(true);
    expect(out).toContain('\n2\n00:00:05,500');
  });

  it('CRLF 选项生效', () => {
    const doc = docOf(BASIC);
    const out = serializeSrt(doc, { newline: '\r\n' });
    expect(out).toContain('\r\n');
    expect(out.includes('\n\n')).toBe(false);
  });

  it('空文档输出为空字符串', () => {
    const doc = createDoc({ name: 'empty.srt', cues: [] });
    expect(serializeSrt(doc).trim()).toBe('');
  });
});

describe('编码探测', () => {
  it('识别 GBK 字节流', () => {
    // "你好" 的 GBK 编码
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    const result = decodeBytes(bytes);
    expect(result.text).toBe('你好');
    expect(result.encoding).toBe('gb18030');
  });

  it('识别 UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]);
    const result = decodeBytes(bytes);
    expect(result.text).toBe('你好');
    expect(result.bom).toBe(true);
    expect(result.encoding).toBe('utf-8');
  });

  it('无 BOM 的 UTF-8 正常识别', () => {
    const bytes = new TextEncoder().encode('你好');
    const result = decodeBytes(bytes);
    expect(result.text).toBe('你好');
    expect(result.encoding).toBe('utf-8');
    expect(result.bom).toBe(false);
  });
});

describe('格式识别', () => {
  it('按扩展名识别', () => {
    expect(detectFormat('随便什么内容', 'movie.srt')).toBe('srt');
  });

  it('扩展名缺失时按内容识别', () => {
    expect(detectFormat(BASIC, 'unknown')).toBe('srt');
  });

  it('完全不像字幕时返回 null', () => {
    expect(detectFormat('hello world', 'notes.txt')).toBeNull();
  });
});
