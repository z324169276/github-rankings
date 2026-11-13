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

  // 榜单：每个 scope × 语言 × 周期一份
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
        writeJson(path.join(DATA, 'ranking', `${scope}-${chip.key}-${period}.json`), {
          items: result.items,
          total: result.total,
          estimated: result.estimated,
          updatedAt: result.updatedAt,
        });
        files += 1;
      }
    }
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
    'User-agent: *\nAllow: /\n',
    'utf8',
  );

  console.log(`构建完成 → ${DIST}`);
  console.log(`  仓库 ${repoCount()} 个，榜单 ${files} 份，详情 ${details} 份，语言 ${chips.length} 个`);
}

main();
