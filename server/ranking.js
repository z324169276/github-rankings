import { getRepos, getMeta, repoCount } from './store.js';

const DAY = 86400000;
const PERIODS = { '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY };
const PERIOD_DAYS = { '1d': 1, '7d': 7, '30d': 30 };

/** 找到最接近目标时间的快照作为对比基准 */
function baselineAt(history, targetMs, toleranceMs) {
  let best = null;
  let bestDiff = Infinity;
  for (const point of history) {
    if (point.t > targetMs + toleranceMs) continue;
    const diff = Math.abs(point.t - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = point;
    }
  }
  return best;
}

function toItem(rec, extra = {}) {
  return {
    owner: rec.owner,
    name: rec.name,
    fullName: rec.fullName,
    avatar: rec.avatar,
    desc: rec.desc,
    language: rec.language,
    stars: rec.stars,
    forks: rec.forks,
    issues: rec.issues,
    createdAt: rec.createdAt,
    pushedAt: rec.pushedAt,
    topics: rec.topics || [],
    url: rec.url,
    homepage: rec.homepage || '',
    license: rec.license,
    archived: !!rec.archived,
    ...extra,
  };
}

export function queryRanking({
  scope = 'total',
  lang = 'all',
  period = '7d',
  q = '',
  page = 1,
  pageSize = 20,
} = {}) {
  const now = Date.now();
  const periodMs = PERIODS[period] || PERIODS['7d'];

  let pool = Object.values(getRepos()).filter(Boolean);
  if (lang && lang !== 'all') pool = pool.filter((r) => r.language === lang);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    pool = pool.filter(
      (r) =>
        r.fullName.toLowerCase().includes(needle) ||
        (r.desc || '').toLowerCase().includes(needle) ||
        (r.topics || []).some((t) => t.toLowerCase().includes(needle)),
    );
  }

  let items = [];
  let estimated = false;

  if (scope === 'new') {
    items = pool
      .filter((r) => r.createdAt && now - r.createdAt <= 90 * DAY)
      .sort((a, b) => b.stars - a.stars)
      .map((r) => toItem(r));
  } else if (scope === 'trending') {
    const measured = [];
    for (const r of pool) {
      if (r.stars < 100) continue;
      const base = baselineAt(r.history || [], now - periodMs, periodMs * 0.6);
      if (!base || base.t > now - periodMs * 0.5) continue;
      const delta = r.stars - base.s;
      measured.push(
        toItem(r, {
          delta,
          deltaPct: base.s > 0 ? Number(((delta / base.s) * 100).toFixed(2)) : 0,
          estimated: false,
        }),
      );
    }

    if (measured.length >= 30) {
      items = measured.sort((a, b) => b.delta - a.delta || b.stars - a.stars);
    } else {
      // 历史快照不足（首次运行）：退化为「日均 star 增速」估算，并明确标记
      estimated = true;
      const days = PERIOD_DAYS[period] || 7;
      items = pool
        .filter((r) => r.stars >= 300 && r.pushedAt && now - r.pushedAt <= 14 * DAY)
        .map((r) => {
          const ageDays = Math.max((now - (r.createdAt || now)) / DAY, 1);
          const perDay = r.stars / ageDays;
          return toItem(r, {
            delta: Math.round(perDay * days),
            deltaPct: Number(((perDay / Math.max(r.stars / ageDays, 1)) * 100).toFixed(2)),
            estimated: true,
          });
        })
        .sort((a, b) => b.delta - a.delta);
    }
  } else {
    items = pool.sort((a, b) => b.stars - a.stars).map((r) => toItem(r));
  }

  const total = items.length;
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const offset = (current - 1) * size;
  const slice = items.slice(offset, offset + size).map((it, i) => ({ ...it, rank: offset + i + 1 }));

  return {
    items: slice,
    total,
    page: current,
    pageSize: size,
    hasMore: offset + size < total,
    estimated,
    updatedAt: getMeta().lastRunAt || 0,
  };
}

export function getRepoDetail(fullName) {
  const rec = getRepos()[fullName];
  if (!rec) return null;
  return {
    ...toItem(rec),
    firstSeenAt: rec.firstSeenAt,
    history: (rec.history || []).map((p) => ({ t: p.t, s: p.s, f: p.f })),
  };
}

export function getStats() {
  const repos = Object.values(getRepos());
  const byLang = new Map();
  for (const r of repos) {
    if (!r.language) continue;
    byLang.set(r.language, (byLang.get(r.language) || 0) + 1);
  }
  const languages = [...byLang.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const totalStars = repos.reduce((sum, r) => sum + (r.stars || 0), 0);
  const meta = getMeta();

  return {
    repoCount: repoCount(),
    totalStars,
    languages,
    lastRunAt: meta.lastRunAt || 0,
    lastRunOk: !!meta.lastRunOk,
    lastError: meta.lastError || null,
    tokenSource: meta.tokenSource || 'none',
  };
}
