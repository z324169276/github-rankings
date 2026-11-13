import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateMarkdown } from './translator.js';
import { getDeepSeekKey } from './settings.js';
import { resolveToken } from './github.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'readmes');
const MAX_CHARS = 120000;

/** 进行中的翻译任务：fullName -> { status, progress, message } */
const jobs = new Map();

const cacheFile = (full) => path.join(CACHE_DIR, `${full.replace(/[\\/]/g, '__')}.json`);

function readCache(full) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(full), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(full, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = cacheFile(full);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

/** 通过 GitHub API 拉取 README 原文 */
async function fetchReadme(full) {
  const { token } = resolveToken();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-rankings-local',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${full}/readme`, { headers });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`GitHub README 读取失败（${res.status}）`);

  const data = await res.json();
  const raw = Buffer.from(data.content || '', 'base64').toString('utf8');
  const truncated = raw.length > MAX_CHARS;
  const markdown = truncated ? `${raw.slice(0, MAX_CHARS)}\n\n> （内容过长，已截断）` : raw;
  const downloadUrl = data.download_url || '';
  const baseUrl = downloadUrl ? downloadUrl.slice(0, downloadUrl.lastIndexOf('/') + 1) : '';

  return { markdown, baseUrl, truncated, path: data.path };
}

function startJob(full, apiKey, cache) {
  const job = { status: 'running', progress: { done: 0, total: 0 }, message: '' };
  jobs.set(full, job);

  (async () => {
    try {
      const zh = await translateMarkdown(cache.en, {
        apiKey,
        onProgress: (done, total) => {
          job.progress = { done, total };
        },
      });
      cache.zh = zh;
      cache.translatedAt = Date.now();
      writeCache(full, cache);
      jobs.delete(full);
      console.log(`[readme] 翻译完成 ${full}（${zh.length} 字符）`);
    } catch (err) {
      job.status = 'error';
      job.message = err.message;
      console.warn(`[readme] 翻译失败 ${full}: ${err.message}`);
      setTimeout(() => jobs.delete(full), 60000);
    }
  })();
}

/**
 * 获取 README
 * @param {'zh'|'en'} lang
 * @returns 缓存命中则返回原文/译文；未命中时按需启动翻译任务
 */
export async function getReadme(full, lang = 'zh') {
  if (!full || !full.includes('/')) return { status: 'missing' };

  let cache = readCache(full) || {};
  if (!cache.en) {
    const fetched = await fetchReadme(full);
    if (fetched.missing) return { status: 'missing' };
    Object.assign(cache, {
      en: fetched.markdown,
      baseUrl: fetched.baseUrl,
      truncated: fetched.truncated,
      fetchedAt: Date.now(),
    });
    writeCache(full, cache);
  }

  const base = { baseUrl: cache.baseUrl || '', truncated: !!cache.truncated };

  if (lang === 'en') return { status: 'ready', lang: 'en', markdown: cache.en, ...base };
  if (cache.zh) return { status: 'ready', lang: 'zh', markdown: cache.zh, translatedAt: cache.translatedAt, ...base };

  const job = jobs.get(full);
  if (job) {
    return job.status === 'error'
      ? { status: 'error', message: job.message, markdown: cache.en, ...base }
      : { status: 'translating', progress: job.progress, markdown: cache.en, ...base };
  }

  const apiKey = getDeepSeekKey();
  if (!apiKey) return { status: 'no_key', markdown: cache.en, ...base };

  startJob(full, apiKey, cache);
  return { status: 'translating', progress: { done: 0, total: 0 }, markdown: cache.en, ...base };
}

export function readmeJobCount() {
  return jobs.size;
}
