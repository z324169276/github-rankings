/**
 * 构建期抓取仓库 README 并压成一段纯文本摘要。
 *
 * 数据源按顺序尝试：
 *   1. raw.githubusercontent.com —— CI 环境稳定；国内本地常被 DNS 拦截
 *   2. cdn.jsdelivr.net（@main / @master）—— 但 .md 文件会 301 跳回 raw，本地多半随之失败
 *   3. api.github.com /repos/{full}/readme —— 需要 token（GITHUB_TOKEN 或 config.json 的 token），
 *      不依赖 raw 域名，本地网络受限时的兜底；一次请求自动匹配默认分支与任意 README 文件名
 *
 * 源熔断规则：连续 5 次网络层失败才禁用（瞬时错误不一票否决），成功即清零计数。
 * API 源走节流队列（间隔 150ms）+ 403 等待重试一次，避免并发触发二级限流。
 * 只取前 60KB，失败返回 null，详情页照常生成。excerptSources() 供构建日志报告命中数。
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README.rst', 'README.txt'];
const MAX_SOURCE = 60000;
const MAX_EXCERPT = 320;
const MAX_CONSECUTIVE_FAILS = 5;
const API_GAP = 150; // api.github.com 请求最小间隔，防止并发触发二级限流

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stats = { raw: 0, mirror: 0, api: 0 };
export function excerptSources() {
  const down = [];
  for (const [name, state] of Object.entries(SOURCES)) {
    if (!state.up) down.push(name);
  }
  return { ...stats, down };
}

const SOURCES = {
  raw: { up: true, fails: 0 },
  mirror: { up: true, fails: 0 },
  api: { up: true, fails: 0 },
};

/** 网络层失败计入连续失败，达到阈值禁用该源；成功清零 */
function noteResult(name, up) {
  const state = SOURCES[name];
  if (up) {
    state.fails = 0;
    return true;
  }
  state.fails += 1;
  if (state.fails >= MAX_CONSECUTIVE_FAILS) state.up = false;
  return false;
}

let tokenCache = null;
let mirrorProbed = false;

/** 首次调用时探活 mirror 源：3 秒内同时探 3 个仓库，**全部**返回 OK 才启用 */
async function probeMirror() {
  if (mirrorProbed) return;
  mirrorProbed = true;
  const probeRepos = ['ollama/ollama', 'facebook/react', 'vercel/next.js'];
  const probes = probeRepos.map((full) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    return fetch(`https://cdn.jsdelivr.net/gh/${full}@main/README.md`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'github-rankings', 'Range': 'bytes=0-100' },
    }).finally(() => { clearTimeout(timer); });
  });
  try {
    const results = await Promise.all(probes);
    // 全部返回 OK(2xx) 才认为 mirror 健康
    if (!results.every((r) => r.ok)) SOURCES.mirror.up = false;
  } catch {
    SOURCES.mirror.up = false; // 任何一个超时或 DNS 失败 → 禁用
  }
}

function loadToken() {
  if (tokenCache !== null) return tokenCache;
  if (process.env.GITHUB_TOKEN) {
    tokenCache = process.env.GITHUB_TOKEN;
    return tokenCache;
  }
  try {
    const file = fileURLToPath(new URL('../config.json', import.meta.url));
    if (existsSync(file)) {
      const cfg = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof cfg.token === 'string' && cfg.token && !/^YOUR_/.test(cfg.token)) {
        tokenCache = cfg.token;
        return tokenCache;
      }
    }
  } catch {
    /* 配置不存在或损坏，按无 token 处理 */
  }
  tokenCache = '';
  return tokenCache;
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Markdown → 一段可读纯文本，去掉徽章、图片、代码块、标题、表格线与链接语法 */
export function toExcerpt(md, limit = MAX_EXCERPT) {
  if (typeof md !== 'string' || !md.trim()) return null;

  let text = md.replace(/\r\n?/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ');
  // 逐行去掉推广行（带跟踪参数）与“只有一个链接”的导航行，README 开头常见这类噪音
  text = text
    .split('\n')
    .filter((line) => {
      if (/utm_|\baffiliate\b|ref=producthunt/i.test(line)) return false;
      // 表格行（含两个以上竖线）读起来是碎片，直接丢掉
      if ((line.match(/\|/g) || []).length >= 2) return false;
      if (!/\]\(https?:/.test(line)) return true;
      const plain = line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
      return plain.length >= 40;
    })
    .join('\n');
  text = text.replace(/^\s*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*$/gm, ' ');
  text = text.replace(/^\s*!\[[^\]]*\]\([^)]*\)\s*$/gm, ' ');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/<[^>]+>/g, ' ');
  // 标题多为项目名或导航，去掉避免摘要开头重复仓库名
  text = text.replace(/^\s*#{1,6}\s.*$/gm, ' ');
  text = text.replace(/^\s*[>|]\s?/gm, ' ');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ');
  text = text.replace(/[*_~`]/g, '');
  for (const [entity, char] of Object.entries(ENTITIES)) text = text.split(entity).join(char);

  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !/^(table of contents|contents|目录|badges?)$/i.test(line));

  // README 开头常是赞助商、推广或导航，连续跳过，最多看前 8 行
  const PROMO = /^(check out|elevate|my open source|special thanks|thanks|sponsor|supported|support us|support me|become a|fork our|try |get started|sign up)/i;
  let start = 0;
  while (start < Math.min(lines.length, 8) && PROMO.test(lines[start])) start += 1;
  const content = lines.slice(start);

  const joined = content.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length < 40) return null;

  // 开头就是赞助商/推广的 README，宁可不出摘要，也不把广告搬到详情页
  if (/\bsponsors?\b|sponsored|special thanks|patreon|buy me a|supercharge/i.test(joined.slice(0, 120))) {
    return null;
  }

  if (joined.length <= limit) return joined;

  const head = joined.slice(0, limit);
  const stop = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('.'),
    head.lastIndexOf('!'),
    head.lastIndexOf('?'),
    head.lastIndexOf(';'),
  );
  if (stop >= limit * 0.5) return head.slice(0, stop + 1).trim();

  const space = head.lastIndexOf(' ');
  const cut = space >= limit * 0.6 ? space : limit;
  return `${head.slice(0, cut).replace(/[,;:，、\-–—\s]+$/, '')}…`;
}

/**
 * 返回 { status, text, rateRemaining, retryAfter }；网络层失败（DNS、超时、连接重置）时 status 为 0
 * options.redirect: 'follow'(默认) | 'manual' —— mirror 源用 'manual' 防止 jsDelivr 301 跳回 raw.githubusercontent.com
 */
async function request(url, headers, timeout, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: options.redirect || 'follow',
      headers: { 'User-Agent': 'github-rankings', ...headers },
    });
    return {
      status: res.status,
      text: res.ok ? (await res.text()).slice(0, MAX_SOURCE) : '',
      rateRemaining: Number(res.headers.get('x-ratelimit-remaining') ?? '1'),
      retryAfter: Number(res.headers.get('retry-after') ?? '0'),
    };
  } catch {
    return { status: 0, text: '', rateRemaining: 1, retryAfter: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** api.github.com 串行节流队列：所有 API 请求按 150ms 间隔错开 */
let apiQueueTail = Promise.resolve();
let lastApiStart = 0;

function queuedApi(url, headers, timeout) {
  const run = async () => {
    const gap = lastApiStart + API_GAP - Date.now();
    if (gap > 0) await sleep(gap);
    lastApiStart = Date.now();
    return request(url, headers, timeout);
  };
  const p = apiQueueTail.then(run, run);
  apiQueueTail = p.catch(() => {});
  return p;
}

/** 依次尝试常见 README 文件名；{ up: false } 表示该源网络层不可达 */
async function tryCandidates(base, timeout, options = {}) {
  for (const name of CANDIDATES) {
    const res = await request(`${base}/${name}`, { Range: `bytes=0-${MAX_SOURCE}` }, timeout, options);
    if (res.status === 0) return { up: false, excerpt: null };
    if (res.status === 404) continue;
    if (res.ok) return { up: true, excerpt: toExcerpt(res.text) || null };
    // 301/302 等重定向：mirror 源禁用自动跟随，直接跳过这个 branch 的剩余候选
    if (res.status >= 300 && res.status < 400) return { up: true, excerpt: null };
    // 其他状态码（限流、5xx）：该源这轮放弃
    return { up: true, excerpt: null };
  }
  return { up: true, excerpt: null };
}

/** GitHub API 的 /readme 端点：自动匹配默认分支与任意 README 文件名；403 等待后重试一次 */
async function apiExcerpt(fullName, token, timeout) {
  const url = `https://api.github.com/repos/${fullName}/readme`;
  const headers = { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}` };

  let res = await queuedApi(url, headers, timeout);
  if (res.status === 403) {
    // 主额度耗尽（remaining=0）直接放弃；二级限流等 retry-after 或 3 秒后重试一次
    if (res.rateRemaining <= 0) return { up: false, excerpt: null };
    await sleep(Math.max(res.retryAfter * 1000, 3000));
    res = await queuedApi(url, headers, timeout);
  }
  if (res.status === 0) return { up: false, excerpt: null };
  if (res.status === 401) return { up: false, excerpt: null }; // token 无效
  if (res.status === 200) return { up: true, excerpt: toExcerpt(res.text) || null };
  return { up: true, excerpt: null }; // 404 = 仓库确实没有 README
}

export async function fetchReadmeExcerpt(fullName, { timeout = 8000 } = {}) {
  await probeMirror(); // 首次探活 mirror 源，失败直接禁用

  if (SOURCES.raw.up) {
    const r = await tryCandidates(`https://raw.githubusercontent.com/${fullName}/HEAD`, timeout);
    noteResult('raw', r.up);
    if (r.excerpt) {
      stats.raw += 1;
      return r.excerpt;
    }
  }

  if (SOURCES.mirror.up) {
    // mirror 超时更短，只试 main 分支——不稳定就直接跳过，靠 API 兜底
    const r = await tryCandidates(`https://cdn.jsdelivr.net/gh/${fullName}@main`, Math.min(timeout, 3000), { redirect: 'manual' });
    noteResult('mirror', r.up);
    if (r.excerpt) {
      stats.mirror += 1;
      return r.excerpt;
    }
    if (!SOURCES.mirror.up) return null; // mirror 被探活禁用或熔断 → 不让它浪费 API 队列
  }

  if (SOURCES.api.up) {
    const token = loadToken();
    if (!token) {
      SOURCES.api.up = false; // 没有 token 就不碰 API：未认证只有 60 次/小时，撑不起全量构建
    } else {
      const r = await apiExcerpt(fullName, token, timeout);
      noteResult('api', r.up);
      if (r.excerpt) {
        stats.api += 1;
        return r.excerpt;
      }
    }
  }

  return null;
}
