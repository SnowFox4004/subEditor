import { describe, expect, it } from 'vitest';
import {
  formatAssTime,
  formatDuration,
  formatLrcTime,
  formatSrtTime,
  formatVttTime,
  parseTimecode,
  snapToFrame,
  splitTime,
} from '../src/core/timecode';

describe('parseTimecode', () => {
  it('解析标准 SRT 时间码', () => {
    expect(parseTimecode('00:00:01,000')).toBe(1000);
    expect(parseTimecode('01:02:03,004')).toBe(((1 * 60 + 2) * 60 + 3) * 1000 + 4);
  });

  it('兼容句点作为小数分隔符', () => {
    expect(parseTimecode('00:00:01.500')).toBe(1500);
  });

  it('兼容全角冒号与逗号', () => {
    expect(parseTimecode('00：00：02，250')).toBe(2250);
  });

  it('兼容多余空格', () => {
    expect(parseTimecode('  00 : 00 : 03 , 500  ')).toBe(3500);
  });

  it('缺毫秒时按 0 处理', () => {
    expect(parseTimecode('00:00:05')).toBe(5000);
  });

  it('不足 3 位的小数右侧补零', () => {
    expect(parseTimecode('00:00:01,5')).toBe(1500);
    expect(parseTimecode('00:00:01,05')).toBe(1050);
  });

  it('超过 3 位的小数截断', () => {
    expect(parseTimecode('00:00:01,1234')).toBe(1123);
  });

  it('支持 MM:SS 与纯秒', () => {
    expect(parseTimecode('02:03')).toBe(123000);
    expect(parseTimecode('07')).toBe(7000);
  });

  it('无法解析时返回 null 而不是抛异常', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
    expect(parseTimecode(null)).toBeNull();
    expect(parseTimecode(undefined)).toBeNull();
    expect(parseTimecode('::')).toBeNull();
  });
});

describe('格式化', () => {
  it('SRT 用逗号分隔毫秒', () => {
    expect(formatSrtTime(3723456)).toBe('01:02:03,456');
  });

  it('VTT 用句点分隔毫秒', () => {
    expect(formatVttTime(3723456)).toBe('01:02:03.456');
  });

  it('ASS 用厘秒且小时不补零', () => {
    expect(formatAssTime(3723456)).toBe('1:02:03.45');
  });

  it('LRC 用 [mm:ss.xx]', () => {
    expect(formatLrcTime(3723456)).toBe('[62:03.45]');
  });

  it('时长格式化补零', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3723000)).toBe('01:02:03');
  });

  it('splitTime 处理负值', () => {
    const p = splitTime(-1500);
    expect(p.neg).toBe(true);
    expect(p.s).toBe(1);
    expect(p.ms).toBe(500);
  });

  it('格式化为可往返的字符串', () => {
    const cases = [0, 1, 999, 1000, 59999, 3600000, 3723456];
    for (const ms of cases) {
      expect(parseTimecode(formatSrtTime(ms))).toBe(ms);
    }
  });
});

describe('snapToFrame', () => {
  it('吸附到最近的一帧', () => {
    expect(snapToFrame(1000, 25)).toBe(1000);
    expect(snapToFrame(1010, 25)).toBe(1000);
    expect(snapToFrame(1030, 25)).toBe(1040);
  });

  it('帧率非法时原样返回', () => {
    expect(snapToFrame(1234, 0)).toBe(1234);
    expect(snapToFrame(1234, Number.NaN)).toBe(1234);
  });
});
