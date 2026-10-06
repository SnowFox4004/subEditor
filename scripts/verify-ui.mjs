/**
 * 真实浏览器 UI 验证。
 *
 * 单元测试覆盖不到布局：列宽溢出、表头与行错位、分栏拖拽是否生效，
 * 这些只有在真浏览器里量出来才算数。改动布局后请重跑一遍。
 *
 * 用法：
 *   npm run build && npm run preview        # 另开一个终端
 *   npm i -D playwright-core                # 只在需要时装（不下载浏览器，用本机 Chrome）
 *   node scripts/verify-ui.mjs
 *
 * 环境变量：
 *   URL        预览地址，默认 http://localhost:4173/
 *   CHANNEL    浏览器通道，默认 chrome，可改 msedge
 *   SHOT_DIR   截图输出目录，默认 ./verify-shots
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.URL ?? 'http://localhost:4173/';
const CHANNEL = process.env.CHANNEL ?? 'chrome';
const OUT = process.env.SHOT_DIR ?? path.join(ROOT, 'verify-shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.empty', { timeout: 20000 });

/* ---------------- 打开示例字幕 ---------------- */
await page
  .locator('input[accept*=".srt"]')
  .first()
  .setInputFiles(path.join(ROOT, 'samples', 'demo.srt'));
await page.waitForSelector('.cue-row', { timeout: 20000 });
check('示例字幕打开后有字幕行', (await page.locator('.cue-row').count()) > 0);

/* ---------------- 表格列：时间码不溢出 ---------------- */
const cellFit = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cue-row .cue-cell')];
  let worst = null;
  for (const cell of cells) {
    const tc = cell.querySelector('.timecode');
    if (!tc) continue;
    const c = cell.getBoundingClientRect();
    const t = tc.getBoundingClientRect();
    const slack = c.right - t.right;
    if (!worst || slack < worst.slack) worst = { slack, cellW: c.width, tcW: t.width };
  }
  return worst;
});
check(
  '时间码完整落在单元格内（不重叠相邻列）',
  !!cellFit && cellFit.slack >= 0,
  cellFit
    ? `余量 ${cellFit.slack.toFixed(1)}px（单元格 ${cellFit.cellW.toFixed(0)}px / 内容 ${cellFit.tcW.toFixed(1)}px）`
    : '未找到时间码',
);

const align = await page.evaluate(() => {
  const head = document.querySelector('.cuelist-head');
  const row = document.querySelector('.cue-row');
  return head && row
    ? {
        head: getComputedStyle(head).gridTemplateColumns,
        row: getComputedStyle(row).gridTemplateColumns,
      }
    : null;
});
check('表头与数据行使用同一套列宽', !!align && align.head === align.row, align?.head ?? '');

const hScroll = await page.evaluate(() => {
  const el = document.querySelector('.cuelist-scroll');
  return el ? { scrollW: el.scrollWidth, clientW: el.clientWidth } : null;
});
check(
  '默认不出现横向滚动条',
  !!hScroll && hScroll.scrollW <= hScroll.clientW + 1,
  hScroll ? `内容 ${hScroll.scrollW}px / 视口 ${hScroll.clientW}px` : '',
);

await page.screenshot({ path: path.join(OUT, '01-table.png') });

/* ---------------- 拖动列宽 ---------------- */
const resizer = page.locator('.col-resizer').nth(1);
const rb = await resizer.boundingBox();
if (rb) {
  const before = align?.head;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 60, rb.y + rb.height / 2, { steps: 10 });
  await page.mouse.up();
  const after = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.cuelist-head')).gridTemplateColumns,
  );
  check('拖动分隔线可以加宽列', after !== before, `${before} → ${after}`);
} else {
  check('拖动分隔线可以加宽列', false, '找不到列宽手柄');
}

/* ---------------- 列设置对话框 ---------------- */
await page.click('button:has-text("列设置")');
await page.waitForSelector('.columns-row', { timeout: 5000 });
await page.locator('.columns-row', { hasText: '时长' }).locator('input[type=checkbox]').uncheck();
await page.screenshot({ path: path.join(OUT, '02-columns.png') });
await page.click('.modal-foot button:has-text("完成")');
await page.waitForTimeout(200);

const headText = (await page.locator('.cuelist-head').textContent()) ?? '';
check('隐藏「时长」列后表头不再渲染它', !headText.includes('时长'), headText);
check('其余列仍在', headText.includes('开始时间') && headText.includes('正文'));

/* ---------------- 媒体上下分屏 ---------------- */
await page.locator('input[accept*="video"]').first().setInputFiles({
  name: 'clip.mp4',
  mimeType: 'video/mp4',
  buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
});
await page.waitForSelector('.splitter-h', { timeout: 10000 });

const layout = await page.evaluate(() => {
  const slot = document.querySelector('.media-slot');
  const editor = document.querySelector('.editor-column');
  const main = document.querySelector('.main-column');
  if (!slot || !editor || !main) return null;
  const s = slot.getBoundingClientRect();
  const e = editor.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  return { slotH: s.height, editorH: e.height, mainH: m.height, slotTop: s.top, editorTop: e.top, slotW: s.width, mainW: m.width };
});
check(
  '媒体区在编辑区上方（上下分屏）',
  !!layout && layout.slotTop < layout.editorTop,
  layout ? `媒体 top=${layout.slotTop.toFixed(0)} / 编辑 top=${layout.editorTop.toFixed(0)}` : '',
);
check(
  '媒体区占满可用宽度（不再缩在一侧）',
  !!layout && layout.slotW >= layout.mainW - 1,
  layout ? `${layout.slotW.toFixed(0)} / ${layout.mainW.toFixed(0)}` : '',
);
check(
  '媒体区与编辑区高度之和等于主列',
  !!layout && Math.abs(layout.slotH + layout.editorH + 6 - layout.mainH) < 2,
  layout ? `${layout.slotH.toFixed(0)} + ${layout.editorH.toFixed(0)} + 6 = ${layout.mainH.toFixed(0)}` : '',
);

await page.screenshot({ path: path.join(OUT, '03-media-split.png') });

const sb = await page.locator('.splitter-h').boundingBox();
const beforeDrag = layout?.slotH ?? 0;
if (sb) {
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 160, { steps: 12 });
  await page.mouse.up();
  const afterDrag = await page.evaluate(
    () => document.querySelector('.media-slot')?.getBoundingClientRect().height ?? 0,
  );
  check('拖拽分隔条能放大媒体区', afterDrag > beforeDrag + 100, `${beforeDrag.toFixed(0)}px → ${afterDrag.toFixed(0)}px`);
} else {
  check('拖拽分隔条能放大媒体区', false, '找不到分隔条');
}

/* ---------------- 切分超长条目 ---------------- */
await page.click('.side-tab:has-text("校验")');
await page.waitForSelector('.panel-foot button', { timeout: 5000 });
const splitBtnText = (await page.locator('.panel-foot button').textContent()) ?? '';
check('校验面板出现切分入口且带条数', splitBtnText.includes('切分超长条目'), splitBtnText);

await page.click('.panel-foot button');
await page.waitForSelector('.split-modal', { timeout: 5000 });
await page.click('button:has-text("预览切分")');
await page.waitForTimeout(300);
const splitItems = await page.locator('.split-item').count();
check('切分预览产出结果', splitItems > 0, `${splitItems} 条待切分`);

const pieceTimes = await page.evaluate(() => {
  const item = document.querySelector('.split-item');
  if (!item) return null;
  return {
    pieces: [...item.querySelectorAll('.split-piece')].map((p) => ({
      time: p.querySelector('.split-piece-time')?.textContent?.trim() ?? '',
      text: p.querySelector('.split-piece-text')?.textContent?.trim() ?? '',
    })),
  };
});
check('预览展示了切分后的每段时间与文本', !!pieceTimes && pieceTimes.pieces.length >= 2, pieceTimes ? `${pieceTimes.pieces.length} 段` : '');

// 时间必须首尾相接、逐段推进，不能有空洞或倒挂
const timesOk =
  !!pieceTimes &&
  pieceTimes.pieces.every((p, i) => {
    if (i === 0) return true;
    const prevEnd = pieceTimes.pieces[i - 1].time.split('→')[1]?.trim();
    const curStart = p.time.split('→')[0]?.trim();
    return prevEnd === curStart;
  });
check('切分后各段首尾相接', timesOk, pieceTimes?.pieces.map((p) => p.time).join(' | ') ?? '');

await page.screenshot({ path: path.join(OUT, '04-split-preview.png') });

const cuesBefore = await page.evaluate(() =>
  Number(document.querySelector('.statusbar .num')?.textContent ?? 0),
);
await page.click('button:has-text("切分选中的")');
await page.waitForTimeout(400);
const cuesAfter = await page.evaluate(() =>
  Number(document.querySelector('.statusbar .num')?.textContent ?? 0),
);
check('应用后条目数增加', cuesAfter > cuesBefore, `${cuesBefore} → ${cuesAfter}`);

await page.screenshot({ path: path.join(OUT, '05-after-split.png') });

check('无控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log('\n────────────────────────────────');
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`);
  process.exitCode = 1;
}
console.log(`截图目录：${OUT}`);
