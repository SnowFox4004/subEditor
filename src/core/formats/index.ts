/**
 * 格式模块入口：集中注册所有 codec。
 * 新增一种格式只需要：写一个 formats/xxx.ts，然后在这里 import + 加进数组。
 */
import { registerFormat } from './registry';
import { srtCodec } from './srt';
import { vttCodec } from './vtt';
import { assCodec, ssaCodec } from './ass';
import { ttmlCodec } from './ttml';
import { lrcCodec, microdvdCodec, samiCodec, sbvCodec } from './misc';
import { csvCodec, jsonCodec, tsvCodec, txtCodec } from './data';

const ALL_CODECS = [
  srtCodec,
  vttCodec,
  assCodec,
  ssaCodec,
  ttmlCodec,
  sbvCodec,
  lrcCodec,
  microdvdCodec,
  samiCodec,
  jsonCodec,
  csvCodec,
  tsvCodec,
  txtCodec,
];

for (const codec of ALL_CODECS) registerFormat(codec);

export * from './registry';
export { parseSrt, serializeSrt, srtCodec } from './srt';
export { parseVtt, serializeVtt, vttCodec } from './vtt';
export { parseAss, serializeAss, serializeSsa, assCodec, ssaCodec } from './ass';
export { parseTtml, serializeTtml, parseTtmlTime, ttmlCodec } from './ttml';
export {
  parseSbv,
  serializeSbv,
  parseLrc,
  serializeLrc,
  parseMicrodvd,
  serializeMicrodvd,
  parseSami,
  serializeSami,
  sbvCodec,
  lrcCodec,
  microdvdCodec,
  samiCodec,
  DEFAULT_MICRODVD_FPS,
} from './misc';
export {
  parseJson,
  serializeJson,
  serializeTxt,
  jsonCodec,
  csvCodec,
  tsvCodec,
  txtCodec,
} from './data';
