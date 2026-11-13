import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = () => ({
  version: 1,
  meta: {
    lastRunAt: 0,
    lastRunOk: false,
    lastError: null,
    runCount: 0,
    tokenSource: 'none',
  },
  repos: {},
});

let db = EMPTY_DB();
let saveTimer = null;

export function initStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = { ...EMPTY_DB(), ...parsed, meta: { ...EMPTY_DB().meta, ...(parsed.meta || {}) } };
    } catch (err) {
      console.warn('[store] 数据文件损坏，已重建:', err.message);
      db = EMPTY_DB();
    }
  }
  return db;
}

export function getMeta() {
  return db.meta;
}

export function setMeta(patch) {
  db.meta = { ...db.meta, ...patch };
}

export function getRepos() {
  return db.repos;
}

export function repoCount() {
  return Object.keys(db.repos).length;
}

/** 原子写入，避免进程中断产生半截文件 */
export function persist() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/** 批量抓取过程中做节流落盘，防止数据丢失 */
export function persistSoon(delay = 4000) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      persist();
    } catch (err) {
      console.warn('[store] 落盘失败:', err.message);
    }
  }, delay);
}

const SNAPSHOT_MIN_GAP = 50 * 60 * 1000; // 同一仓库最多 50 分钟记一个点
const HISTORY_DAILY_DAYS = 45; // 超过 24 小时的样本按天聚合，保留 45 天
const HISTORY_RECENT_HOURS = 24; // 近 24 小时保留细粒度，才够算 24 小时增量
const HISTORY_MAX_POINTS = 80; // 硬上限，防止单个仓库体积失控

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 历史按天聚合：远期每天只留最后一个点，近期保留细粒度。
 * 不做这层压缩的话，150 个点 × 1400 多个仓库会让快照无限膨胀。
 */
function compactHistory(history, now) {
  const recentFrom = now - HISTORY_RECENT_HOURS * 60 * 60 * 1000;
  const cutoff = now - HISTORY_DAILY_DAYS * DAY_MS;
  const recent = [];
  const byDay = new Map();

  for (const point of history) {
    if (point.t < cutoff) continue;
    if (point.t >= recentFrom) {
      recent.push(point);
      continue;
    }
    // 同一 key 后写覆盖，等价于保留当天最后一个点
    byDay.set(Math.floor(point.t / DAY_MS), point);
  }

  const merged = [...byDay.values(), ...recent].sort((a, b) => a.t - b.t);
  return merged.length > HISTORY_MAX_POINTS ? merged.slice(-HISTORY_MAX_POINTS) : merged;
}

export function upsertRepo(item, now = Date.now()) {
  const key = item.full_name;
  let rec = db.repos[key];
  if (!rec) {
    rec = { firstSeenAt: now, history: [] };
    db.repos[key] = rec;
  }

  rec.id = item.id;
  rec.fullName = key;
  rec.name = item.name;
  rec.owner = item.owner?.login || key.split('/')[0];
  rec.avatar = item.owner?.avatar_url || '';
  rec.desc = item.description || '';
  rec.language = item.language || null;
  rec.stars = item.stargazers_count || 0;
  rec.forks = item.forks_count || 0;
  rec.issues = item.open_issues_count || 0;
  rec.createdAt = item.created_at ? Date.parse(item.created_at) : null;
  rec.pushedAt = item.pushed_at ? Date.parse(item.pushed_at) : null;
  rec.topics = Array.isArray(item.topics) ? item.topics.slice(0, 10) : [];
  rec.url = item.html_url;
  rec.homepage = item.homepage || '';
  rec.license = item.license?.spdx_id || null;
  rec.archived = !!item.archived;
  rec.seenAt = now;

  const last = rec.history[rec.history.length - 1];
  if (!last || now - last.t >= SNAPSHOT_MIN_GAP) {
    rec.history.push({ t: now, s: rec.stars, f: rec.forks });
  } else {
    // 同一时间窗口内只更新最新快照的值
    last.s = rec.stars;
    last.f = rec.forks;
  }
  rec.history = compactHistory(rec.history, now);

  return rec;
}
