import { loadConfig } from './settings.js';
import { execFileSync } from 'node:child_process';

const API_BASE = 'https://api.github.com';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GitHub REST 客户端
 * - 未认证：Search API 限制 10 次/分钟，这里按 6.6s 间隔排队
 * - 已认证：30 次/分钟，按 2.2s 间隔排队
 * - 自动读取 x-ratelimit-* 响应头，额度耗尽时等待重置
 */
export class GitHubClient {
  constructor(token = '') {
    this.token = token || '';
    // 已认证时留有余量，避免踩到 30 次/分钟上限
    this.minInterval = this.token ? 2200 : 6600;
    this.lastRequestAt = 0;
    this.rate = null;
    this.paceQueue = Promise.resolve();
  }

  get rateInfo() {
    return this.rate;
  }

  /** 串行化的节流排队，保证并发请求时起始间隔仍然达标 */
  #pace() {
    const task = async () => {
      // 额度耗尽：等到重置时间
      if (this.rate && this.rate.remaining <= 0) {
        const waitMs = this.rate.resetAt - Date.now() + 2000;
        if (waitMs > 0) await sleep(Math.min(waitMs, 10 * 60 * 1000));
      }
      const waitMs = this.lastRequestAt + this.minInterval - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      this.lastRequestAt = Date.now();
    };
    const queued = this.paceQueue.then(task).catch(() => {});
    this.paceQueue = queued;
    return queued;
  }

  async #request(url, retries = 3) {
    await this.#pace();

    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'github-rankings-local',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      if (retries > 0) {
        await sleep(3000);
        return this.#request(url, retries - 1);
      }
      throw new Error(`网络请求失败: ${err.message}`);
    }

    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(remaining) && Number.isFinite(reset)) {
      this.rate = {
        remaining,
        limit: Number(res.headers.get('x-ratelimit-limit')) || null,
        resetAt: reset * 1000,
        resource: res.headers.get('x-ratelimit-resource') || 'core',
      };
    }

    if (res.status === 403 || res.status === 429) {
      if (retries > 0) {
        const waitMs = this.rate ? this.rate.resetAt - Date.now() + 2000 : 60000;
        await sleep(Math.max(2000, Math.min(waitMs, 10 * 60 * 1000)));
        return this.#request(url, retries - 1);
      }
      throw new Error(`GitHub 限流：${res.status}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }

    return res.json();
  }

  /** 仓库搜索（Search API，单查询最多返回 1000 条） */
  async searchRepos({ q, sort = 'stars', order = 'desc', page = 1, perPage = 100 }) {
    const url = new URL(`${API_BASE}/search/repositories`);
    url.searchParams.set('q', q);
    url.searchParams.set('sort', sort);
    url.searchParams.set('order', order);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    return this.#request(url.toString());
  }
}

/** 优先级：环境变量 > 本地配置 > gh CLI 登录态 */
export function resolveToken() {
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: 'env' };

  if (loadConfig().token) return { token: loadConfig().token, source: 'config.json' };

  try {
    const out = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 4000 }).trim();
    if (out) return { token: out, source: 'gh-cli' };
  } catch {
    /* 未安装 gh 或未登录 */
  }

  return { token: '', source: 'none' };
}
