# 开发指南

面向开发者的文档：本地运行、命令、部署到 Cloudflare Pages、架构与技术栈。功能与使用说明见 [README.md](README.md)，测试说明见 [TESTING.md](TESTING.md)。

## 快速开始

```bash
npm install
npm run dev          # 本地开发，默认 http://localhost:5173
```

打开页面后把字幕文件拖进去（支持一次拖多个），或点「打开字幕」。
`samples/demo.srt` 是一个故意埋了重叠、超长行、SDH 标注的示例，可以直接拖进去试。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（HMR） |
| `npm run build` | 类型检查 + 生产构建，产物在 `dist/` |
| `npm run preview` | 本地预览构建产物 |
| `npm test` | 运行 Vitest 测试套件 |
| `npm run typecheck` | 只做类型检查 |
| `npm run deploy` | 构建并部署到 Cloudflare Pages |

## 部署到 Cloudflare Pages

> ⚠️ 这个 Pages 项目的**生产分支名是 `production`，不是 `main`**。
> 部署命令必须带 `--branch=production`，否则会被当成预览部署，生产域名不会更新。

### 方式一：命令行（最快）

```bash
npx wrangler login          # 首次需要，浏览器点一下授权
npm run deploy              # 已经带好了 --branch=production
```

### 方式二：接 GitHub 自动构建

仓库里已经有 `.github/workflows/deploy.yml`。在 GitHub 仓库设置里加两个 Secret：

- `CLOUDFLARE_API_TOKEN`（Cloudflare Dashboard → My Profile → API Tokens，权限选 `Cloudflare Pages: Edit`）
- `CLOUDFLARE_ACCOUNT_ID`（Dashboard 右侧栏可见）

之后每次 push 到 `main` 都会自动跑测试 + 构建 + 部署到生产。

> 免费套餐额度：无限请求与带宽、每月 500 次构建、单站点 20,000 个文件、单文件 25 MiB。
> 本项目产物只有 4 个文件（约 115KB gzip），日常使用完全碰不到上限。

## 架构

```
Cloudflare Pages（静态托管，全球 CDN）
        ↓
浏览器内：
  WebUI 应用层      React 19 + TypeScript
  核心逻辑层        纯 TS，零 React 依赖，可脱离 DOM 单测
  重计算            Web Worker（批量替换，防正则灾难性回溯）
  本地持久化        IndexedDB（工作区自动保存）+ localStorage（规则集、主题）
```

**设计约束（改动时请遵守）**

1. `src/core/` **禁止 import React**。这层是纯函数，必须能被 Vitest 脱离 DOM 直接跑。
2. **不引入任何服务端代码**。没有 `/api`、没有数据库、没有会话，所有状态在浏览器内。
3. 可能卡住主线程的计算（批量替换）必须走 **Web Worker**，并带超时。
4. 新增字幕格式 = 在 `src/core/formats/` 加一个文件 + 在 `formats/index.ts` 注册，**不改 UI**。
5. 文档模型 `SubtitleDoc` 全程不可变，撤销重做靠整份快照栈。

### 目录

```
src/
├── core/                纯逻辑层（无 React 依赖）
│   ├── types.ts             数据模型
│   ├── timecode.ts          时间码解析 / 格式化 / 帧对齐
│   ├── timeline.ts          时间轴几何、刻度、拖拽求值与吸附
│   ├── encoding.ts          编码探测与转换
│   ├── document.ts          文档级不可变操作
│   ├── validation.ts        质检规则
│   ├── openFile.ts          字节流 → SubtitleDoc（含格式自动识别）
│   ├── replace/             批量替换：diff.ts 字符级 diff、engine.ts 规则引擎
│   └── formats/             格式注册表 + 各格式 codec
├── workers/              Web Worker（批量替换）
├── state/                Zustand store（editor + player）+ 撤销重做 + IndexedDB 持久化
├── components/           UI 组件
├── lib/                  下载 / zip 等浏览器能力封装
└── styles/               设计令牌与全局样式
```

## 技术栈

Vite 8 · React 19 · TypeScript · Zustand · @tanstack/react-virtual · fflate · Vitest + happy-dom
