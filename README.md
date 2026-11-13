# GitHub 榜单 · 开源趋势追踪

定时抓取 GitHub 数据、本地累积 Star 快照，生成「总榜 / 新星榜 / 热门榜」三个维度的开源趋势榜单，可按语言筛选、搜索仓库、查看单个项目的 Star 增长曲线。

纯 Node.js，零依赖，数据每天由 GitHub Actions 自动更新。

## 功能

- **总榜**：按累计 Star 排序的全站头部项目
- **新星榜**：近 90 天创建、Star 增长迅猛的新项目
- **热门榜**：按区间内真实 Star 增量排序（24 小时 / 7 天 / 30 天）
- **语言筛选**：13 个主流语言分榜
- **关键词搜索**：匹配仓库名、简介与 topics
- **项目详情**：Star / Fork / Issue、许可证、Star 增长曲线、README 原文
- **深浅色主题**、分享链接（筛选状态写入 URL）

## 在线访问

部署在 GitHub Pages：<https://z324169276.github.io/github-rankings/>

## 订阅与数据接口

数据每天定时重新生成，全部公开、无需鉴权。

### RSS

| Feed | 地址 |
| --- | --- |
| 热门榜（近 7 天） | `/feed.xml` |
| 新星榜 | `/feed/new.xml` |
| 总榜 | `/feed/top.xml` |

### JSON API

| 接口 | 说明 |
| --- | --- |
| `/api/v1/index.json` | 元信息：可用榜单、语言键、更新时间 |
| `/api/v1/trending.json` | 热门榜（全部语言 / 近 7 天） |
| `/api/v1/new.json` | 新星榜（全部语言） |
| `/api/v1/top.json` | 总榜（全部语言） |
| `/api/v1/ranking/{scope}-{languageKey}-{period}.json` | 任意组合 |

- `scope`：`total` / `new` / `trending`
- `period`：`1d` / `7d` / `30d`，仅 `trending` 生效，其余固定为 `all`
- `languageKey`：取自 `index.json` 的 `languages`，如 `Python`、`C_plusplus`

响应结构：

```json
{
  "scope": "trending",
  "language": "all",
  "languageKey": "all",
  "period": "7d",
  "generatedAt": 1794489139428,
  "source": "https://github.com/z324169276/github-rankings",
  "count": 100,
  "total": 1028,
  "estimated": true,
  "items": [
    {
      "rank": 1,
      "fullName": "deepseek-ai/deepseek-harness",
      "owner": "deepseek-ai",
      "name": "deepseek-harness",
      "description": "DeepSeek Harness: Everything is a Plugin.",
      "url": "https://github.com/deepseek-ai/deepseek-harness",
      "avatar": "https://avatars.githubusercontent.com/u/148330874?v=4",
      "language": "TypeScript",
      "stars": 279542,
      "forks": 34417,
      "issues": 0,
      "topics": ["ai-agents", "cordis", "dsh"],
      "license": "MIT",
      "createdAt": "2026-08-13T11:56:32.000Z",
      "pushedAt": "2026-11-11T11:32:04.000Z",
      "delta": 21375,
      "estimated": true
    }
  ]
}
```

`delta` 只在 `trending` 榜单出现，表示区间 Star 增量。`estimated: true` 表示历史样本不足、该值按日均增速估算；此时不输出 `deltaPct`。

> GitHub Pages 不返回 `Access-Control-Allow-Origin`，浏览器里跨域 `fetch` 会被拦截。脚本、服务端、curl、RSS 阅读器不受影响；需要在浏览器直连时用下面的 jsDelivr 镜像。

### jsDelivr 镜像（支持跨域）

jsDelivr 会给仓库文件加上 `Access-Control-Allow-Origin: *`。API 产物每天同步到一个强制覆盖的 `data` 分支，因此仓库体积不会随历史累积：

```js
const res = await fetch('https://cdn.jsdelivr.net/gh/z324169276/github-rankings@data/api/v1/trending.json');
const { items } = await res.json();
```

| 文件 | 镜像地址 |
| --- | --- |
| 接口索引 | `https://cdn.jsdelivr.net/gh/z324169276/github-rankings@data/api/v1/index.json` |
| 热门榜 | `.../api/v1/trending.json` |
| 新星榜 | `.../api/v1/new.json` |
| 总榜 | `.../api/v1/top.json` |
| 任意组合 | `.../api/v1/ranking/{scope}-{languageKey}-{period}.json` |
| RSS | `.../feed.xml`、`.../feed/new.xml`、`.../feed/top.xml` |

`data` 分支每天被重写为单个提交。jsDelivr 对分支地址有约 12 小时缓存，刚更新后可能仍读到上一版。

## 本地运行

需要 Node.js 20 或更高版本。项目零依赖，无需 `npm install`。

```bash
# 完整站点（带实时抓取与 README）
npm start

# 仅抓取一次数据
npm run refresh

# 生成静态站到 dist/ 并本地预览
npm run build
npm run preview
```

默认地址 <http://localhost:5173>（服务端模式）或 <http://localhost:8080>（静态预览）。

## 数据更新机制

静态站的数据来自 `data/db.json`，由 GitHub Actions 每天定时执行：

1. 从 `data` 分支取回上一次的历史快照
2. `node server/refresh.js` 调用 GitHub Search API 抓取 26 个查询，写入 Star 快照
3. `node scripts/build-static.mjs` 导出 `dist/api/v1/*.json` 与 RSS
4. 发布到 GitHub Pages，并把最新快照和 API 产物强制推回 `data` 分支

`data` 分支每次都被覆盖成单个提交，所以仓库体积只取决于单次快照的大小，不会按天累积。历史样本本身也做了压缩：超过 24 小时的记录按天聚合，只保留最近 45 天；近 24 小时保留细粒度，用于计算 24 小时增量。单个仓库最多 80 个采样点。

如果工作流失败，会自动开一个标题形如 `[自动] 榜单数据更新失败 YYYY-MM-DD` 的 issue，站点继续提供上一版数据。

首次部署时历史样本不足，「热门榜」会退化为「按创建以来的日均增速估算」并标注「估算」；随着每日运行，样本积累够 30 个仓库后会自动切换为真实增量。

## 榜单口径

GitHub 官方没有公开 trending 接口，本项目用 Search API 构造：

| 榜单 | 查询 |
| --- | --- |
| 总榜 | `stars:>5000`，按 Star 排序 |
| 新星榜 | `created:>=90 天前 stars:>50` |
| 热门榜 | 用本地快照计算区间增量，`stars:>100` |
| 语言榜 | `language:"X" stars:>2000` |

热门榜要求目标时间点存在足够早的基准快照，找不到基准的仓库会被排除，因此榜单反映的是真实可测量的增量，而非估算值。

## 配置

复制 `config.example.json` 为 `config.json` 后填入（该文件已加入 `.gitignore`，不会入库）：

| 字段 | 说明 |
| --- | --- |
| `token` | GitHub Personal Access Token，仅需只读权限；也可用 `GITHUB_TOKEN` 环境变量 |
| `deepseekKey` | DeepSeek API Key，用于 README 中文翻译（仅服务端模式） |
| `feishuWebhook` / `feishuKeyword` | 飞书机器人推送每日榜单 |
| `refreshHours` | 服务端模式自动抓取间隔（小时） |

未配置 Token 也能运行，但 Search API 限额会降到 10 次/分钟。

## 目录结构

```
├─ server/               Node 服务与抓取逻辑
│  ├─ index.js           HTTP 服务：静态文件 + /api/*
│  ├─ crawler.js         抓取计划与并发控制
│  ├─ github.js          GitHub REST 客户端（节流、重试、限流等待）
│  ├─ ranking.js         榜单计算
│  ├─ readme.js          README 抓取与翻译缓存
│  ├─ store.js           JSON 快照存储
│  └─ translator.js      DeepSeek 分段翻译
├─ scripts/
│  ├─ build-static.mjs   导出静态站
│  └─ serve-static.mjs   本地预览 dist/
├─ public/               前端页面
├─ data/db.json          榜单数据快照
└─ .github/workflows/    每日定时更新与部署
```

## License

MIT
