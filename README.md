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

1. `node server/refresh.js` 调用 GitHub Search API 抓取 26 个查询
2. 写入 Star 快照，形成增量计算所需的历史
3. `node scripts/build-static.mjs` 导出 `dist/data/*.json`
4. 提交数据快照并发布到 GitHub Pages

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
