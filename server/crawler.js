import { GitHubClient, resolveToken } from './github.js';
import { upsertRepo, persist, persistSoon, setMeta, getMeta, repoCount } from './store.js';

export const LANGS = [
  'JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java',
  'C++', 'C', 'PHP', 'Ruby', 'Swift', 'Kotlin',
];

const DAY = 86400000;
const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);

const state = {
  running: false,
  startedAt: 0,
  finishedAt: 0,
  done: 0,
  total: 0,
  message: '',
  error: null,
};

export function getProgress() {
  return { ...state };
}

/**
 * 抓取计划：
 *  - 总榜：全站 star 前 200
 *  - 新星榜：90 天内创建且 star>50 的前 200
 *  - 热门榜：3 天内有提交且 star>300 的前 200
 *  - 语言榜：12 个主流语言各取前 100
 */
function buildQueries() {
  const now = Date.now();
  const list = [
    { label: '总榜', q: 'stars:>5000', pages: [1, 2] },
    { label: '新星榜', q: `created:>=${dateStr(now - 90 * DAY)} stars:>50`, pages: [1, 2] },
    { label: '热门榜', q: `pushed:>=${dateStr(now - 3 * DAY)} stars:>300`, pages: [1, 2] },
  ];
  for (const lang of LANGS) {
    list.push({ label: `语言·${lang}`, q: `language:"${lang}" stars:>2000`, pages: [1] });
  }
  return list;
}

export async function runRefresh() {
  if (state.running) return { skipped: true, reason: '已有抓取任务进行中' };

  const { token, source } = resolveToken();
  const client = new GitHubClient(token);
  const queries = buildQueries();
  const totalPages = queries.reduce((n, q) => n + q.pages.length, 0);

  Object.assign(state, {
    running: true,
    startedAt: Date.now(),
    finishedAt: 0,
    done: 0,
    total: totalPages,
    message: '准备抓取…',
    error: null,
  });

  const startedAt = Date.now();
  const tasks = [];
  for (const spec of queries) for (const page of spec.pages) tasks.push({ spec, page });

  // 有 Token 时并发抓取（起始间隔仍由客户端节流保证），匿名时串行
  const concurrency = Math.min(token ? 4 : 1, tasks.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const res = await client.searchRepos({ q: task.spec.q, page: task.page, perPage: 100 });
      for (const item of res.items) upsertRepo(item);
      state.done += 1;
      state.message = `已完成 ${state.done}/${totalPages}（${task.spec.label}）`;
      persistSoon();
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    setMeta({
      lastRunAt: Date.now(),
      lastRunOk: true,
      lastError: null,
      runCount: getMeta().runCount + 1,
      tokenSource: source,
      lastDurationMs: Date.now() - startedAt,
      rateRemaining: client.rateInfo?.remaining ?? null,
    });
    persist();

    state.message = `完成，共 ${repoCount()} 个仓库`;
    return { ok: true, pages: totalPages, repos: repoCount() };
  } catch (err) {
    setMeta({
      lastRunAt: Date.now(),
      lastRunOk: false,
      lastError: err.message,
      tokenSource: source,
    });
    persist();
    state.error = err.message;
    state.message = `抓取失败：${err.message}`;
    console.error('[crawler]', err.message);
    return { ok: false, error: err.message };
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
  }
}
