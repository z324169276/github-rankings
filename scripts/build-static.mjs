/**
 * 静态站构建：把 data/db.json 导出成一组静态 JSON，供 GitHub Pages 等纯静态托管使用。
 *
 * 产出 dist/
 *   index.html / style.css / app.js / vendor/marked.js   (来自 public/)
 *   data/stats.json                                      统计与语言列表
 *   data/meta.json                                       同步状态
 *   data/search.json                                     全量搜索索引
 *   data/ranking/{scope}-{lang}-{period}.json            榜单（每份最多 100 条）
 *   data/repo/{owner}__{name}.json                       单个仓库详情（含 Star 历史）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore, getRepos, getMeta, repoCount } from '../server/store.js';
import { queryRanking, getRepoDetail, getStats } from '../server/ranking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(DIST, 'data');

const SCOPES = ['total', 'new', 'trending'];
const PERIODS = ['1d', '7d', '30d'];
const MAX_ITEMS = 100;

const SITE_URL = 'https://z324169276.github.io/github-rankings/';
const REPO_URL = 'https://github.com/z324169276/github-rankings';
const API_DIR = path.join(DIST, 'api', 'v1');

const escXml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** 对外 API 用稳定的英文字段名，避免内部字段改名影响调用方 */
function toApiItem(it) {
  const out = {
    rank: it.rank,
    fullName: it.fullName,
    owner: it.owner,
    name: it.name,
    description: it.desc || '',
    url: it.url,
    avatar: it.avatar,
    language: it.language || null,
    stars: it.stars || 0,
    forks: it.forks || 0,
    issues: it.issues || 0,
    topics: it.topics || [],
    license: it.license || null,
    createdAt: it.createdAt ? new Date(it.createdAt).toISOString() : null,
    pushedAt: it.pushedAt ? new Date(it.pushedAt).toISOString() : null,
  };
  if (it.delta != null) {
    out.delta = it.delta;
    // 估算值没有可靠基准，不输出涨跌幅，避免误导调用方
    if (!it.estimated && it.deltaPct != null) out.deltaPct = it.deltaPct;
    out.estimated = !!it.estimated;
  }
  return out;
}

function buildRss({ file, title, payload }) {
  const items = payload.items.slice(0, 30);
  const itemXml = items
    .map((it) => {
      const badge = it.delta != null ? `+${it.delta}★ ` : '';
      const detail = `${SITE_URL}?repo=${encodeURIComponent(it.fullName)}`;
      const desc = `${it.description || '暂无简介'} · ${it.language || '未知语言'} · ${it.stars}★ / ${it.forks} forks`;
      return `    <item>
      <title>${escXml(badge + it.fullName)}</title>
      <link>${escXml(detail)}</link>
      <guid isPermaLink="false">${escXml(`${payload.scope}:${it.fullName}`)}</guid>
      <description>${escXml(desc)}</description>
      <category>${escXml(it.language || 'Other')}</category>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(title)}</title>
    <link>${escXml(SITE_URL)}</link>
    <description>${escXml('每日更新的 GitHub 开源趋势榜单')}</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date(payload.generatedAt).toUTCString()}</lastBuildDate>
    <atom:link href="${escXml(SITE_URL + file)}" rel="self" type="application/rss+xml" />
${itemXml}
  </channel>
</rss>
`;
}

/** 语言名转文件名：只保留字母数字，其余折叠为下划线（C++ → C，C# → C，需保证唯一） */
export function langKey(name) {
  if (name === 'all') return 'all';
  const base = String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  // C / C++ / C# 会撞车，用稳定后缀区分
  if (name === 'C++') return 'C_plusplus';
  if (name === 'C#') return 'C_sharp';
  if (name === 'Objective-C') return 'Objective_C';
  return base || 'other';
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function main() {
  initStore();
  if (repoCount() === 0) {
    console.error('data/db.json 为空，请先运行 npm run refresh');
    process.exit(1);
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(PUBLIC_DIR, DIST);

  // 注入静态模式标记：前端据此改用 JSON 文件而不是 /api
  const indexPath = path.join(DIST, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const injected = html.replace(
    '<script src="app.js" type="module"></script>',
    '<script>window.GH_STATIC = true;</script>\n  <script src="app.js" type="module"></script>',
  );
  if (injected === html) {
    console.error('index.html 中未找到 app.js 引用，无法注入静态标记');
    process.exit(1);
  }
  fs.writeFileSync(indexPath, injected, 'utf8');

  const meta = getMeta();
  const stats = getStats();

  // 语言列表与前端筛选规则保持一致：有品牌色或收录数 >= 5，取前 12
  const chips = [{ name: 'all', key: 'all', count: repoCount() }].concat(
    stats.languages
      .filter((l) => l.count >= 5)
      .slice(0, 12)
      .map((l) => ({ name: l.name, key: langKey(l.name), count: l.count })),
  );

  writeJson(path.join(DATA, 'stats.json'), {
    repoCount: stats.repoCount,
    totalStars: stats.totalStars,
    languages: chips,
    lastRunAt: meta.lastRunAt || 0,
    lastRunOk: !!meta.lastRunOk,
    lastError: meta.lastError || null,
  });

  const refreshHours = 24;
  writeJson(path.join(DATA, 'meta.json'), {
    progress: { running: false, done: 0, total: 0, message: '' },
    meta: {
      lastRunAt: meta.lastRunAt || 0,
      lastRunOk: !!meta.lastRunOk,
      lastError: meta.lastError || null,
      runCount: meta.runCount || 0,
      nextRunAt: (meta.lastRunAt || Date.now()) + refreshHours * 3600 * 1000,
    },
  });

  // 搜索索引：全量仓库的展示字段，按 Star 降序
  const repos = Object.values(getRepos()).filter((r) => r && r.fullName);
  const index = repos
    .map((r) => ({
      fullName: r.fullName,
      owner: r.owner,
      name: r.name,
      avatar: r.avatar,
      desc: r.desc,
      language: r.language,
      stars: r.stars || 0,
      forks: r.forks || 0,
      topics: r.topics || [],
    }))
    .sort((a, b) => b.stars - a.stars);
  writeJson(path.join(DATA, 'search.json'), index);

  // 榜单：每个 scope × 语言 × 周期一份，路径即公开 API
  const generated = new Map();
  let files = 0;
  for (const scope of SCOPES) {
    for (const chip of chips) {
      const periods = scope === 'trending' ? PERIODS : ['all'];
      for (const period of periods) {
        const result = queryRanking({
          scope,
          lang: chip.name,
          period: period === 'all' ? '7d' : period,
          page: 1,
          pageSize: MAX_ITEMS,
        });
        const payload = {
          scope,
          language: chip.name,
          languageKey: chip.key,
          period,
          generatedAt: meta.lastRunAt || Date.now(),
          source: REPO_URL,
          count: result.items.length,
          total: result.total,
          estimated: !!result.estimated,
          items: result.items.map(toApiItem),
        };
        generated.set(`${scope}-${chip.key}-${period}`, payload);
        writeJson(path.join(API_DIR, 'ranking', `${scope}-${chip.key}-${period}.json`), payload);
        files += 1;
      }
    }
  }

  // 三个最常用的固定入口，省去拼参数
  for (const [name, key] of [
    ['trending', 'trending-all-7d'],
    ['new', 'new-all-all'],
    ['top', 'total-all-all'],
  ]) {
    const payload = generated.get(key);
    if (payload) writeJson(path.join(API_DIR, `${name}.json`), payload);
  }

  writeJson(path.join(API_DIR, 'index.json'), {
    name: 'GitHub 榜单 API',
    version: 'v1',
    generatedAt: meta.lastRunAt || Date.now(),
    repoCount: repoCount(),
    source: REPO_URL,
    site: SITE_URL,
    scopes: SCOPES,
    periods: PERIODS,
    languages: chips.map((c) => ({ name: c.name, key: c.key })),
    ranking: 'api/v1/ranking/{scope}-{languageKey}-{period}.json',
    shortcuts: {
      trending: 'api/v1/trending.json',
      new: 'api/v1/new.json',
      top: 'api/v1/top.json',
    },
    feeds: ['feed.xml', 'feed/new.xml', 'feed/top.xml'],
    mirror: {
      provider: 'jsDelivr',
      base: 'https://cdn.jsdelivr.net/gh/z324169276/github-rankings@data/',
      note: '与本站同一份数据，带 CORS 头，可在浏览器直接 fetch；分支缓存约 12 小时',
      examples: [
        'https://cdn.jsdelivr.net/gh/z324169276/github-rankings@data/api/v1/trending.json',
        'https://cdn.jsdelivr.net/gh/z324169276/github-rankings@data/api/v1/index.json',
        'https://cdn.jsdelivr.net/gh/z324169276/github-rankings@data/feed.xml',
      ],
    },
  });

  // RSS：取各榜前 30 条
  const feeds = [
    { file: 'feed.xml', title: 'GitHub 榜单 · 热门榜', key: 'trending-all-7d' },
    { file: 'feed/new.xml', title: 'GitHub 榜单 · 新星榜', key: 'new-all-all' },
    { file: 'feed/top.xml', title: 'GitHub 榜单 · 总榜', key: 'total-all-all' },
  ];
  for (const feed of feeds) {
    const payload = generated.get(feed.key);
    if (!payload) continue;
    const out = path.join(DIST, feed.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buildRss({ ...feed, payload }), 'utf8');
  }

  // 仓库详情：每个仓库一份，按需加载
  let details = 0;
  for (const r of repos) {
    const detail = getRepoDetail(r.fullName);
    if (!detail) continue;
    writeJson(path.join(DATA, 'repo', `${r.fullName.replace(/\//g, '__')}.json`), detail);
    details += 1;
  }

  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}\n`,
    'utf8',
  );

  console.log(`构建完成 → ${DIST}`);
  console.log(`  仓库 ${repoCount()} 个，榜单 ${files} 份，详情 ${details} 份，语言 ${chips.length} 个`);
  console.log(`  API  api/v1/   RSS  ${feeds.map((f) => f.file).join(' / ')}`);
}

main();
