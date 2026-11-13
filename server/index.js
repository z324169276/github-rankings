import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore, getMeta, repoCount } from './store.js';
import { runRefresh, getProgress } from './crawler.js';
import { queryRanking, getRepoDetail, getStats } from './ranking.js';
import { getReadme } from './readme.js';
import { loadConfig } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 5173;
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS) || Number(loadConfig().refreshHours) || 6;
const REFRESH_MS = REFRESH_HOURS * 3600 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/ranking') {
      const result = queryRanking({
        scope: url.searchParams.get('scope') || 'total',
        lang: url.searchParams.get('lang') || 'all',
        period: url.searchParams.get('period') || '7d',
        q: url.searchParams.get('q') || '',
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('pageSize') || 20,
      });
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/repo') {
      const full = url.searchParams.get('full') || '';
      const detail = getRepoDetail(full);
      if (!detail) return sendJson(res, 404, { error: '仓库不存在或尚未收录' });
      return sendJson(res, 200, detail);
    }

    if (pathname === '/api/readme') {
      const full = url.searchParams.get('full') || '';
      if (!full.includes('/')) return sendJson(res, 400, { status: 'missing' });
      const result = await getReadme(full, url.searchParams.get('lang') || 'zh');
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/stats') {
      return sendJson(res, 200, getStats());
    }

    if (pathname === '/api/meta') {
      return sendJson(res, 200, {
        progress: getProgress(),
        meta: { ...getMeta(), nextRunAt: (getMeta().lastRunAt || Date.now()) + REFRESH_MS },
      });
    }

    if (pathname === '/api/refresh' && req.method === 'POST') {
      if (getProgress().running) {
        return sendJson(res, 202, { ok: false, message: '抓取任务已在进行中', progress: getProgress() });
      }
      runRefresh(); // 后台执行，立即返回
      return sendJson(res, 202, { ok: true, message: '已开始抓取' });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: '未知接口' });
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server]', err);
    sendJson(res, 500, { error: err.message });
  }
});

initStore();

const meta = getMeta();
const stale = !meta.lastRunAt || Date.now() - meta.lastRunAt > REFRESH_MS;

server.listen(PORT, () => {
  console.log(`\n  GitHub 榜单服务已启动 → http://localhost:${PORT}`);
  console.log(`  缓存仓库: ${repoCount()} 个`);
  console.log(`  自动刷新: 每 ${REFRESH_HOURS} 小时（下次约 ${new Date(Date.now() + REFRESH_MS).toLocaleString('zh-CN', { hour12: false })}）\n`);
  if (stale) {
    console.log('  数据为空或已过期，开始首次抓取（约 1-2 分钟）…');
    setTimeout(() => runRefresh(), 1200);
  }
});

setInterval(() => {
  if (!getProgress().running) runRefresh();
}, REFRESH_MS);
