# AGENTS.md — srtEditor 仓库导览

> 面向新加入的协作者 / AI Agent：先读这一份，再动手。
> 目标是让你在 15 分钟内理解「这个仓库是什么、代码怎么分层、改哪里、改的时候必须遵守什么」。

---

## 1. 这是什么

**纯浏览器端的字幕编辑器（SPA）**。所有解析、编辑、批量替换、质检、导出**全部在用户浏览器内完成**，文件不上传任何服务器。

- 线上地址：`https://srteditor-azw.pages.dev`（自定义域 `srteditor.sfx4.dpdns.org`）
- 部署形态：Cloudflare Pages 免费套餐（纯静态托管，**零后端**）
- 支持 12 种格式导入 / 13 种格式导出、多标签页、表格 + 时间轴 + 媒体预览三视图、批量替换、批量操作、质检、PWA 离线、自动保存

**一句话架构**：Cloudflare Pages 只负责把静态文件送到全球边缘节点，所有业务逻辑都跑在浏览器里。

---

## 2. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 构建 | **Vite 8** + TypeScript | `base: './'`（相对路径，方便部署到任意子路径）；产物 `dist/` |
| UI 框架 | **React 19** | 编辑器是重交互 UI，组件化 + 生态最省事 |
| 状态管理 | **Zustand 5** | 轻量、无 Provider；多个独立 store |
| 虚拟滚动 | **@tanstack/react-virtual** | 表格纵向虚拟化，1 万条不卡 |
| 压缩 | **fflate** | 多标签页打包导出 zip |
| 测试 | **Vitest 5** + happy-dom | `environment: node`，`tests/setup.ts` 里开 `IS_REACT_ACT_ENVIRONMENT` |
| 部署 | **wrangler** / GitHub Actions | 见 `.github/workflows/deploy.yml` |

**关键取舍（与早期 PLAN 的偏差，均已记录理由）**

1. **撤销重做用「整份文档快照栈」，未用 immer patches**。core 层操作全不可变，未改动的 `Cue` 对象在快照间共享引用，1 万条约 80KB/快照，100 步约 8MB，实现极简且不会错。`immer` 已移除。
2. **IndexedDB 手写封装（~150 行），未引 Dexie**。只需「存一份 JSON / 读一份 JSON」，省一个依赖。
3. **i18n 未接入**，界面仅简体中文。
4. **GBK / BIG5 导出未实现**（需按需加载码表），UI 中已标「尚未支持」。**解码**侧 GBK/BIG5 已支持（浏览器原生 `TextDecoder`）。

---

## 3. 架构分层与数据流

```
Cloudflare Pages（静态托管 · 全球 CDN · 零后端）
        ↓ 首次加载后完全离线可用（Service Worker）
┌─────────────────────── 浏览器内 ────────────────────────┐
│  WebUI 应用层        React 19 组件（components/）        │
│        ↓ 订阅 / commit()                                │
│  状态层              Zustand store（state/）             │
│        ↓ 纯函数调用                                     │
│  核心逻辑层          纯 TS，零 React 依赖（core/）        │
│        ├─ 重计算 → Web Worker（workers/，带超时保护）    │
│        ↓                                                │
│  持久化层            IndexedDB（工作区）+ localStorage    │
└─────────────────────────────────────────────────────────┘
```

**单向数据流**：UI 事件 → 调 `core/` 纯函数算出**新文档** → `store.commit()` 写回（入历史栈 + 重算告警）→ React 订阅重渲染。

### ⚠️ 硬性设计约束（改动时必须遵守）

1. **`src/core/` 禁止 import React**。这层必须能被 Vitest 脱离 DOM 直接跑。目前 CI/单测大量依赖这一点。
2. **不引入任何服务端代码**。没有 `/api`、没有数据库、没有会话，所有状态在浏览器内。
3. **可能卡住主线程的计算（批量替换）必须走 Web Worker**，并带超时（`REPLACE_TIMEOUT_MS = 2500`），超时直接 `terminate`。
4. **新增字幕格式 = 在 `src/core/formats/` 加一个文件 + 在 `formats/index.ts` 注册，不改 UI**。
5. **`SubtitleDoc` 全程不可变**，撤销重做靠整份快照栈；不要就地 mutate。

---

## 4. 目录结构

```
srtEditor/
├── index.html                  # 挂载点 #root
├── vite.config.ts              # base:'./'，target es2022，Vitest 配置
├── tsconfig.json               # strict + noUnusedLocals/Parameters
├── wrangler.toml               # Cloudflare Pages：pages_build_output_dir = dist
├── package.json                # 命令见第 8 节
├── PLAN.md                     # 原始实现计划书（含决策与偏差记录）
├── README.md                   # 面向用户的说明（功能/快捷键/部署）
├── AGENTS.md                   # ← 本文件（面向协作者）
├── .github/workflows/deploy.yml
├── scripts/verify-ui.mjs       # 真实浏览器端到端验证（本机 Chrome）
├── public/                     # 原样拷进 dist/
│   ├── sw.js                   # Service Worker（离线可用）
│   ├── _headers                # Cloudflare 响应头（安全 + 缓存策略）
│   ├── manifest.webmanifest    # PWA
│   └── icon.svg
├── samples/demo.srt            # 故意埋了重叠/超长行/SDH 的示例
├── src/
│   ├── main.tsx                # 入口，仅生产构建注册 SW
│   ├── App.tsx                 # 顶层：布局、全局拖拽、快捷键、主题、自动保存
│   ├── core/                   # ★ 纯逻辑层（零 React，可单测）
│   │   ├── types.ts                # 全部数据模型与 codec 接口
│   │   ├── timecode.ts             # 时间码解析/格式化/帧对齐
│   │   ├── timeline.ts             # 时间轴几何、刻度、拖拽求值、吸附
│   │   ├── encoding.ts             # 编码探测/解码/编码 + 编码器注册表
│   │   ├── document.ts             # 文档级不可变操作（增删改拆合、批量操作）
│   │   ├── validation.ts           # 质检规则（只读，不修改数据）
│   │   ├── split.ts                # 超长条目切分（断行 + 时间按比例分配）
│   │   ├── openFile.ts             # 字节流 → SubtitleDoc（含格式自动识别）
│   │   ├── replace/
│   │   │   ├── engine.ts               # 多规则管线 + 安全上限 + 规则集存取
│   │   │   └── diff.ts                 # 字符级 diff（前缀/后缀剥离 + LCS）
│   │   └── formats/
│   │       ├── registry.ts             # 格式注册表（register/get/list/detect）
│   │       ├── index.ts                # 集中注册所有 codec + 统一 re-export
│   │       ├── shared.ts               # codec 共用文本工具
│   │       ├── srt.ts  vtt.ts  ass.ts  ttml.ts
│   │       ├── misc.ts                 # SBV / LRC / MicroDVD / SAMI
│   │       └── data.ts                 # JSON / CSV / TSV / TXT
│   ├── workers/
│   │   └── replace.worker.ts   # 批量替换 Worker（唯一 Worker）
│   ├── state/
│   │   ├── store.ts                # 编辑器主 store（docs/tabs/history/selection/notices）
│   │   ├── history.ts              # 撤销重做栈（整份快照）
│   │   ├── persist.ts              # IndexedDB 工作区存取 + 防抖自动保存
│   │   ├── player.ts               # 播放器 store + 媒体元素引用 + 播放/暂停
│   │   ├── layout.ts               # 列宽/列显隐/媒体区高度（localStorage）
│   │   └── replaceClient.ts        # 批量替换调度层（Worker + 超时，降级同步）
│   ├── components/                 # UI 组件（见第 6 节）
│   ├── lib/download.ts             # 下载 / zip 打包
│   └── styles/
│       ├── tokens.css              # 亮/暗主题 CSS 变量（设计令牌）
│       └── global.css              # 全局样式（约 1600 行）
└── tests/                      # Vitest（约 276 个用例）
    ├── setup.ts
    ├── srt.spec.ts  formats.spec.ts  timecode.spec.ts  timeline.spec.ts
    ├── operations.spec.ts  history.spec.ts  layout.spec.ts
    ├── replace.spec.ts  split.spec.ts  app.smoke.spec.tsx
```

---

## 5. 核心数据模型（`src/core/types.ts`）

```ts
type TimeMs = number;   // 内部统一毫秒整数，杜绝浮点误差

interface Cue {
  id: string;        // 稳定 UUID：React key / diff 定位 / 跨标签引用
  index: number;     // 显示序号；导出时统一重排
  start: TimeMs; end: TimeMs;
  text: string;      // 多行用 \n；保留 <i> <b> {\an8} 等标签
  speaker?: string;  // ASS / TTML 说话人
  style?: Record<string, string>;  // ASS 样式 / TTML region，尽量保留
  locked: boolean;   // 锁定后批量替换 / 批量操作跳过
  dirty: boolean;    // 相对导入时原始值是否被改过
}

interface SubtitleDoc {
  id; name; format: FormatId; encoding; bom;
  newline: '\n' | '\r\n';
  fps?: number;                 // MicroDVD
  cues: Cue[];
  meta: Record<string, unknown>;// ASS [Script Info]/[V4+ Styles] 等头信息
  warnings: Warning[];          // 解析告警，绝不擅自改用户数据
  rev: number;                  // 单调递增版本号：脏标记 & 撤销判定
}
```

**关键机制：脏标记靠 `rev`**。打开文件时把当前 `rev` 记进 `savedRev[docId]`；`doc.rev !== savedRev[docId]` 即「已修改」。撤销回到初始状态会自动变回未修改。

其他模型：`Warning`（level + code + cueIds + message）、`ReplaceRule`、`DiffSegment`、`Change`、`FormatCodec`、`SplitPlan`。

---

## 6. 实现细节（改代码前必读）

### 6.1 时间码 `core/timecode.ts`
- `parseTimecode` **永不抛异常**，无法解析返回 `null`。容错：`,`/`.` 混用、缺毫秒、全角标点、`HH:MM:SS`/`MM:SS`/`SS`、前后空格。
- 小数不足 3 位右补零（`,5` → 500ms），超 3 位截断。
- 各格式格式化器分离：`formatSrtTime`（`,`）、`formatVttTime`（`.`）、`formatAssTime`（厘秒、小时不补零）、`formatLrcTime`（累计分钟）、`formatDuration`（人读）。
- 帧相关：`snapToFrame` / `msToFrame` / `frameToMs`。

### 6.2 编码 `core/encoding.ts`
- 探测顺序：**BOM → 严格 UTF-8（fatal）→ CJK 候选（gb18030/big5/shift_jis/euc-kr/windows-1252）→ 宽松 UTF-8 兜底**。
- 导出编码：`utf-8` / `utf-8-bom` / `utf-16le` / `utf-16be` 原生支持；其余走 `registerEncoder` 注册表（目前为空，GBK/BIG5 导出未实现）。
- `ENCODING_OPTIONS` 供 UI 下拉；`hasEncoder` 决定某编码是否可选。

### 6.3 格式注册表 `core/formats/`
- 每个 codec 实现 `FormatCodec`：`id / name / extensions / canImport / canExport / detect(head, ext) / parse / serialize`。
- `detect` 返回 0~1 置信度；扩展名命中直接给 ≥0.95。
- **新增格式三步**：① 写 `formats/xxx.ts` 导出 codec；② 在 `formats/index.ts` 的 `ALL_CODECS` 数组加一行；③ 在 `types.ts` 的 `FormatId` 联合类型里加 id。**UI 无需改动**（导入/导出下拉都从注册表动态生成）。
- 各 codec 共用 `shared.ts` 的 `normalizeNewlines / stripHtml / decodeEntities / escapeXml / plainText / buildCue / finalizeCues / flattenText`。
- 解析原则：**绝不擅自修改用户数据**，异常只记 `Warning`。

### 6.4 文件打开 `core/openFile.ts`
- 流程：`decodeBytes` 解码 → `rankCandidates` 给所有 import codec 打分排序 → **逐个真试解析** → 第一个解析出 cue 的即采用。
- 扩展名缺失/写错时靠内容特征兜底。
- 一个 cue 都解析不出 → 判定「不是字幕文件」直接抛错（否则任意文本都会被当成「0 条 SRT」放进来）。
- 解析告警 + 质检告警合并去重。

### 6.5 文档操作 `core/document.ts`（全部纯函数、不可变）
- 基础：`createCue / createDoc / renumber / replaceCues / updateCue / insertCue / insertCueAfter / removeCue / removeCues / duplicateCue / moveCue`。
- `splitCue`：优先在换行处切，否则在标点附近切；时间按两侧字数比例分配。
- `mergeWithNext`：正文换行拼接，end 取两者较大值。
- 批量：`shiftAll / scaleAll / snapAllToFrame / fixOverlaps / dropEmpty / mergeShortCues / removeDuplicates / closeGaps / stripSdh / stripTags`。
- `getStats`：count / duration / totalCueDuration / firstStart。
- **注意**：`withCues()` 内部会推进 `rev` 并重算 `warnings`；`renumber` 只在顺序变化时调用。

### 6.6 批量替换（重点：安全 + 性能）
- **`core/replace/engine.ts`（纯函数）**：`compileRule`（字面量先转义；整词用 `(?<![\p{L}\p{N}_])(?:base)(?![\p{L}\p{N}_])`；优先带 `u` flag，失败退回不带 `u`）、`applyRuleToText`、`buildChangesForDocs`（多规则按顺序叠加，产出「一条字幕一个字段一项变更」，`ruleIds` 记录中间命中的所有规则）、`applyAcceptedChanges`（把采纳的写回）、规则集 `loadRulesets/saveRulesets`（localStorage）。
- **安全上限**：`MAX_PATTERN_LENGTH = 1000`、`MAX_MATCHES_PER_FIELD = 20000`；编译/执行全包 try/catch，单条规则出错不影响其它规则。
- **灾难性回溯兜底在 Worker**：`state/replaceClient.ts` 的 `runReplace` 优先用 Worker，**2.5s 超时直接 `terminate()` 并把 `worker` 置空**；环境不支持 Worker（单测）时同步执行。
- `core/replace/diff.ts`：先剥公共前缀/后缀（砍 90%+ 计算量），中间段 ≤400 字符走 LCS 精确 diff，超长则退化为「整段删 + 整段插」。**不变式：`diffToText(diffChars(a,b)) === b`**（单测核心断言）。

### 6.7 超长条目切分 `core/split.ts`
- `needsSplit(cue, opts)` **必须与 `planSplitForCue` 完全等价**——否则按钮上的计数会和预览对不上（21~40 字的条目就会触发不一致）。
- 断行：先按原换行硬切，再对每行按 `maxCharsPerLine` 切（可在标点处断，`minCut = limit*0.5` 避免切出碎片）。
- 时间分配 `allocateTimes`：按各段字符数比例，保证每段 ≥ `minDurationMs`、首段起于 start、末段止于 end、中间无缝无叠；时长不够返回 `null`。
- 段数受时长约束时自动减段并标 `durationLimited`。
- 应用：`applySplitPlans(doc, plans, accepted)` → `renumber(replaceCues(...))`。

### 6.8 质检 `core/validation.ts`
- 只读。规则：负时长(error)、时长过短/过长(info)、空正文(warn)、超长行(info, `MAX_LINE_LENGTH=42`)、相邻重叠(warn)。
- 阈值常量：`MIN_DURATION_MS=500`、`MAX_DURATION_MS=10000`。

### 6.9 时间轴 `core/timeline.ts`
- 几何：`msToPx / pxToMs / fitScale / chooseTickInterval / buildTicks`（刻度上限 500 个防爆）/ `formatTickLabel`。
- 拖拽：`applyDrag(orig, mode, deltaMs, opts)`，mode ∈ `move|start|end`；`normalize` 保证 ≥ `minDurationMs` 并按 fps 吸附。
- 吸附：`snapToNearest` + `collectSnapPoints`（其它条目首尾 + 0 + 播放头）；`applyDragToCues` 支持多选整体平移，吸附候选会**排除被拖拽条目自身**。
- 缩放范围：`MIN_PX_PER_SECOND=0.5` ~ `MAX_PX_PER_SECOND=400`。

### 6.10 状态层 `state/`
- **`store.ts`**：单一编辑器 store。`commit(docId, next, {history})` 是**唯一写入口**（自动入历史 + 刷新 rev/告警）；`replaceSilently` = 不入历史。选择器 `selectActiveDoc / isDirty / selectStats`；`exportDocText / newBlankDoc`。
- **`history.ts`**：`{past, future}` 快照栈，`HISTORY_LIMIT=100`。
- **`persist.ts`**：手写 IndexedDB（db `srteditor` / store `workspace` / key `current`）。`startAutosave` 用**状态指纹**判断是否真变了，`AUTOSAVE_DELAY_MS=1200` 防抖落盘；全部标签关掉时清空存档。恢复时过滤不在 tabOrder 里的脏数据。
- **`player.ts`**：播放器独立 store，避免播放进度高频更新触发编辑区重渲染。`findActiveCue` 线性查找。用模块级 `mediaElement` 引用让全局快捷键（空格）不必层层传 ref。
- **`layout.ts`**：列宽/显隐/媒体区高度，存 localStorage（`srteditor-layout`），与业务数据分离。列默认宽度是**按内容实测**的（时间列 156px），改列宽默认值前先量一下。`toggleColumn` 至少保留一列。

### 6.11 UI 组件 `components/`
| 组件 | 职责 |
|---|---|
| `TabBar` | 多标签：脏标记黄点、拖拽重排、中键关闭、关闭确认 |
| `Toolbar` | 打开/撤销重做/批量替换/批量操作/导出/列设置 |
| `CueList` + `CueRow` + `TimecodeInput` | 表格视图（虚拟滚动）+ 行内编辑 + 分段时间输入 |
| `TimelineView` | 时间轴轨道：拖拽/缩放/吸附/重叠标红/横向虚拟化（只渲染可视区间 ±200px） |
| `MediaPreview` | 视频/音频 + 字幕叠加（叠加层尺寸按视频**实际显示区域**算，黑边不让字幕跑偏） |
| `ReplacePanel` | 规则集 + diff 预览 + 逐条采纳 |
| `SplitDialog` | 切分超长条目（先预览再应用） |
| `OpsPanel` | 批量操作 |
| `ValidationPanel` | 告警列表，点击定位 |
| `SidePane` | 右侧面板容器（校验 / 批量操作 两个 tab） |
| `ExportDialog` | 格式/编码/换行选择，单文件下载或打包 zip |
| `ColumnSettingsDialog` | 列的显隐与精确宽度 |
| `StatusBar` / `NoticeStack` | 状态栏 / 通知栈 |

- `App.tsx` 负责：主题（跟随系统 + 手动，存 `srteditor-theme`）、全局拖拽（字幕进编辑器 / 媒体进播放器，用 `dragDepth` 计数避免抖动）、快捷键、媒体区高度分隔条、启动恢复工作区、`beforeunload` 未保存提醒。

### 6.12 下载 `lib/download.ts`
- `downloadBlob / downloadText`（按编码编码成字节）/ `downloadZip`（fflate，重名自动加 `(1)` 后缀）。

---

## 7. 常用改动入口（快速定位）

| 我想… | 去哪 |
|---|---|
| 加一种字幕格式 | `core/formats/xxx.ts` + `formats/index.ts` + `types.ts` 的 `FormatId` |
| 加一个批量操作 | `core/document.ts` 加纯函数 → `OpsPanel.tsx` 加入口 |
| 改批量替换规则能力 | `core/replace/engine.ts`（+ `types.ts` 的 `ReplaceRule`）→ `ReplacePanel.tsx` |
| 调质检规则/阈值 | `core/validation.ts` |
| 改表格列默认宽度 | `state/layout.ts` 的 `DEFAULT_COLUMNS`（**先按内容实测**） |
| 改时间轴交互 | `core/timeline.ts`（纯逻辑）+ `TimelineView.tsx`（渲染） |
| 改快捷键 | `App.tsx` 的 `onKeyDown` |
| 改持久化 | `state/persist.ts`（注意加版本号迁移） |
| 改样式/主题 | `styles/tokens.css`（变量）+ `styles/global.css` |

---

## 8. 开发流程

```bash
npm install
npm run dev          # 开发服务器 http://localhost:5173
npm run build        # tsc --noEmit && vite build（类型检查 + 构建，产物 dist/）
npm run preview      # 预览构建产物
npm test             # Vitest 全量（约 276 用例）
npm run test:watch   # 监听模式
npm run typecheck    # 只做类型检查
npm run deploy       # 构建并部署 Cloudflare Pages（已带 --branch=production）
```

### 测试
- 单测覆盖：时间码边界、SRT 容错、12 格式往返、编码探测、文档操作、撤销重做、时间轴几何与拖拽求值、批量替换（规则编译/整词/大小写/`$1` 反向引用/多规则叠加/逐条采纳）、diff 不变式、切分（断点/比例分配/无缝无叠/段数约束）、表格列布局、组件级冒烟。
- **改了布局/交互后建议重跑真实浏览器验证**：
  ```bash
  npm run build && npm run preview      # 一个终端跑着
  npm i -D playwright-core              # 按需装
  node scripts/verify-ui.mjs            # 截图输出到 verify-shots/
  ```
  它检查：时间码不溢出单元格、表头与数据列宽一致、默认无横向滚动、拖列宽生效、隐藏列后表头同步、媒体区在编辑区上方且占满宽度、拖分隔条改高度、切分预览→应用端到端。

### 部署（重要坑）
- **生产分支名是 `production`，不是 `main`**。部署命令必须带 `--branch=production`，否则会被当成预览部署，生产域名不更新。
- GitHub Actions 需两个 Secret：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。push 到 `main` 自动跑测试 + 构建 + 部署。

---

## 9. 编码约定

- **语言**：代码注释、UI 文案、commit 说明均用**简体中文**；界面目前仅中文。
- **类型**：`tsconfig` 开了 `strict` + `noUnusedLocals` + `noUnusedParameters`，提交前 `npm run typecheck` 必须过。
- **纯函数优先**：能放 `core/` 的逻辑不要放组件里——为了可单测。
- **不可变**：改文档一律产新对象，不要就地改 `cue`/`doc`。
- **写入口唯一**：UI 改文档只走 `store.commit()`，别绕过它直接 `setState`。
- **id 生成**：统一 `crypto.randomUUID()`。
- **不要引重依赖**：本项目刻意保持依赖极少（见第 2 节取舍），新增依赖前先想清楚能不能自己写 100 行搞定。

---

## 10. 已知限制（改动时注意，别当成 bug）

- GBK / BIG5 **导出**未实现（界面标「尚未支持」）；导入侧已支持。
- `.ssa` → `.ssa` 保留原样式表；但 `.ass` → `.ssa` 因字段定义不兼容会回退默认样式表。
- CSV / TSV 换行用字面量 `\n` 转义（保证 Excel/WPS/pandas 可读），正文里原本的 `\n` 两个字符无法与换行区分。
- 移动端只保证查看与轻编辑，拖拽交互需桌面端。
- GB18030 与 BIG5 的区分依赖 `TextDecoder` 严格模式，极少数文件可能误判；导出前可在状态栏核对。
- i18n 未接入，界面仅简体中文。

---

## 11. 相关文档

- `README.md` — 面向**用户**：功能、快捷键、部署步骤、边界行为。
- `PLAN.md` — 原始实现计划书：需求拆解、里程碑、风险对策、**技术选型偏差及理由**。
- 本文件 `AGENTS.md` — 面向**协作者/AI**：架构、实现细节、约定。
