const $ = (sel) => document.querySelector(sel);

const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8',
  Rust: '#dea584', Java: '#b07219', 'C++': '#f34b7d', C: '#555555', PHP: '#4F5D95',
  Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF', 'C#': '#178600', Shell: '#89e051',
  HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Dart: '#00B4AB', Jupyter: '#DA5B0B',
  'Jupyter Notebook': '#DA5B0B', Zig: '#ec915c', Lua: '#000080', Haskell: '#5e5086',
  Objective_C: '#438eff', SCSS: '#c6538c', Elixir: '#6e4a7e', Clojure: '#db5855',
  'Emacs Lisp': '#c065db', Vim_Script: '#199f4b', Solidity: '#AA6746', Nix: '#7e7eff',
};

const state = {
  scope: 'total',
  lang: 'all',
  period: '7d',
  q: '',
  page: 1,
  pageSize: 20,
  loading: false,
  hasMore: false,
  total: 0,
  wasRunning: false,
  empty: true,
};

/* ---------- 工具函数 ---------- */
const escapeHtml = (str = '') =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const langColor = (lang) => LANG_COLORS[lang] || '#8b8b96';

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(n);
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
  return Math.floor(diff / 86400e3) + ' 天前';
}

function timeUntil(ts) {
  if (!ts) return '—';
  const diff = ts - Date.now();
  if (diff <= 0) return '即将刷新';
  if (diff < 60e3) return '1 分钟内';
  if (diff < 3600e3) return Math.ceil(diff / 60e3) + ' 分钟后';
  return Math.ceil(diff / 3600e3) + ' 小时后';
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const STATIC = !!window.GH_STATIC;
const langKeys = { all: 'all' };
let searchIndexPromise = null;

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
  return res.json();
}

function loadSearchIndex() {
  if (!searchIndexPromise) searchIndexPromise = api('data/search.json');
  return searchIndexPromise;
}

/** 静态模式读构建产物，返回结构与服务端 /api/ranking 完全一致 */
async function fetchRanking({ scope, lang, period, q, page, pageSize }) {
  if (!STATIC) {
    const params = new URLSearchParams({
      scope,
      lang,
      period,
      q,
      page: String(page),
      pageSize: String(pageSize),
    });
    return api(`/api/ranking?${params}`);
  }

  let items;
  let estimated = false;
  let updatedAt = 0;

  if (q) {
    // 搜索走全量索引，不局限于当前榜单
    const index = await loadSearchIndex();
    const needle = q.toLowerCase();
    items = index.filter(
      (r) =>
        r.fullName.toLowerCase().includes(needle) ||
        (r.desc || '').toLowerCase().includes(needle) ||
        (r.topics || []).some((t) => t.toLowerCase().includes(needle)),
    );
  } else {
    const key = langKeys[lang] || lang;
    const periodKey = scope === 'trending' ? period : 'all';
    const payload = await api(`api/v1/ranking/${scope}-${key}-${periodKey}.json`);
    items = payload.items;
    estimated = !!payload.estimated;
    updatedAt = payload.updatedAt || 0;
  }

  const total = items.length;
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize).map((it, i) => ({ ...it, rank: offset + i + 1 })),
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
    estimated,
    updatedAt,
  };
}

/* ---------- 渲染 ---------- */
function rowHtml(item) {
  const rankClass = item.rank <= 3 && state.scope !== 'trending' ? `top r${item.rank}` : '';
  const deltaHtml =
    item.delta != null
      ? `<span class="delta ${item.estimated ? 'warm' : ''}">+${fmtNum(item.delta)}${item.estimated ? '<span class="tag">估算</span>' : ''}</span>`
      : '';
  const topics = (item.topics || []).slice(0, 3).map((t) => `<span class="topic">${escapeHtml(t)}</span>`).join('');
  const lang = item.language
    ? `<span class="metric lang"><span class="swatch" style="background:${langColor(item.language)}"></span><span class="label">${escapeHtml(item.language)}</span></span>`
    : '';

  return `
    <article class="row" data-full="${escapeHtml(item.fullName)}" style="animation-delay:${Math.min((item.rank % 10) * 18, 180)}ms">
      <div class="rank ${rankClass}">${item.rank}</div>
      <img class="avatar" src="${escapeHtml(item.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <div class="repo">
        <div class="repo-title">
          <span class="repo-owner">${escapeHtml(item.owner)} /</span>
          <span class="repo-name">${escapeHtml(item.name)}</span>
        </div>
        <p class="repo-desc">${escapeHtml(item.desc || '暂无项目简介')}</p>
        <div class="topics">${topics}</div>
      </div>
      <div class="repo-meta">
        ${deltaHtml}
        <span class="metric">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z"/></svg>
          ${fmtNum(item.stars)}
        </span>
        <span class="metric">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/></svg>
          ${fmtNum(item.forks)}
        </span>
        ${lang}
      </div>
    </article>`;
}

function renderList(items, { append = false } = {}) {
  const list = $('#list');
  if (!append) list.innerHTML = '';
  if (!items.length && !append) {
    list.innerHTML = state.empty
      ? `<div class="empty">正在首次抓取 GitHub 数据，请稍候…<br /><span style="font-size:12px">约需 1-2 分钟，完成后自动刷新列表</span></div>`
      : `<div class="empty">没有匹配的仓库<br /><span style="font-size:12px">试试切换榜单类型、语言或清空搜索</span></div>`;
    return;
  }
  list.insertAdjacentHTML('beforeend', items.map(rowHtml).join(''));
}

function showSkeleton() {
  $('#list').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
}

function renderNotice(estimated) {
  const notice = $('#notice');
  if (estimated) {
    notice.hidden = false;
    notice.innerHTML = `<span>⏱</span><span>增量快照仍在积累中，当前热门榜按「创建以来的日均 Star 增速」估算并标注「估算」。服务持续运行后会自动切换为真实区间增量。</span>`;
  } else {
    notice.hidden = true;
  }
}

/* ---------- 数据加载 ---------- */
async function loadRanking({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;

  const page = append ? state.page + 1 : 1;
  if (!append) showSkeleton();

  try {
    const data = await fetchRanking({
      scope: state.scope,
      lang: state.lang,
      period: state.period,
      q: state.q,
      page,
      pageSize: state.pageSize,
    });
    state.page = data.page;
    state.hasMore = data.hasMore;
    state.total = data.total;
    state.empty = state.total === 0;
    renderNotice(data.estimated);
    renderList(data.items, { append });
    $('#loadMoreWrap').hidden = !data.hasMore;
    if (!data.updatedAt) state.empty = true;
  } catch (err) {
    $('#list').innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`;
  } finally {
    state.loading = false;
  }
}

async function loadStats() {
  try {
    const s = await api(STATIC ? 'data/stats.json' : '/api/stats');
    for (const lang of s.languages || []) {
      if (lang.key) langKeys[lang.name] = lang.key;
    }
    $('#statRepos').textContent = fmtNum(s.repoCount);
    $('#statStars').textContent = fmtNum(s.totalStars);
    $('#statUpdated').textContent = s.lastRunAt ? timeAgo(s.lastRunAt) : '—';
    renderLangChips(s.languages || []);
  } catch {
    /* 忽略 */
  }
}

function renderLangChips(languages) {
  // 静态产物的语言列表已在构建时筛好，直接用；服务端模式按需再过滤
  const chips = STATIC
    ? languages.map((l) => ({ name: l.name, label: l.name === 'all' ? '全部语言' : l.name, count: l.count }))
    : [{ name: 'all', label: '全部语言', count: null }].concat(
        languages
          .filter((l) => LANG_COLORS[l.name] || l.count >= 5)
          .slice(0, 12)
          .map((l) => ({ name: l.name, label: l.name, count: l.count })),
      );

  $('#langChips').innerHTML = chips
    .map(
      (c) => `
      <button class="chip ${state.lang === c.name ? 'active' : ''}" data-lang="${escapeHtml(c.name)}" type="button">
        ${c.name === 'all' ? '' : `<span class="swatch" style="background:${langColor(c.name)}"></span>`}
        ${escapeHtml(c.label)}
        ${c.count ? `<span class="count">${c.count}</span>` : ''}
      </button>`,
    )
    .join('');
}

/* ---------- 抓取状态轮询 ---------- */
async function pollMeta() {
  if (STATIC) {
    try {
      const { meta } = await api('data/meta.json');
      $('#statusDot').className = meta.lastRunOk ? 'dot' : 'dot err';
      $('#statusText').textContent = meta.lastRunAt ? `已同步 · ${timeAgo(meta.lastRunAt)}` : '等待首次同步';
      $('#statUpdated').textContent = meta.lastRunAt ? timeAgo(meta.lastRunAt) : '—';
      $('#statNext').textContent = meta.nextRunAt ? timeUntil(meta.nextRunAt) : '—';
    } catch {
      /* 忽略 */
    }
    return;
  }

  try {
    const { progress, meta } = await api('/api/meta');
    const dot = $('#statusDot');
    const text = $('#statusText');

    if (progress.running) {
      dot.className = 'dot busy';
      text.textContent = `${progress.message} ${progress.done}/${progress.total}`;
      $('#refreshBtn').disabled = true;
    } else if (meta.lastRunOk) {
      dot.className = 'dot';
      text.textContent = `已同步 · ${timeAgo(meta.lastRunAt)}`;
      $('#refreshBtn').disabled = false;
    } else {
      dot.className = 'dot err';
      text.textContent = meta.lastError ? '同步异常' : '等待首次同步';
      $('#refreshBtn').disabled = false;
    }

    $('#statUpdated').textContent = meta.lastRunAt ? timeAgo(meta.lastRunAt) : '—';
    $('#statNext').textContent = meta.nextRunAt ? timeUntil(meta.nextRunAt) : '—';

    // 抓取从「进行中」变为「结束」时，刷新榜单
    if (state.wasRunning && !progress.running) {
      await loadStats();
      await loadRanking();
    }
    state.wasRunning = progress.running;
  } catch {
    /* 忽略轮询错误 */
  }
}

/* ---------- 详情弹窗 ---------- */
function sparkline(points) {
  if (!points || points.length < 2) {
    return `<div class="empty" style="padding:26px;border:0">Star 历史数据积累中，多运行几次后即可查看趋势曲线</div>`;
  }
  const w = 560;
  const h = 110;
  const pad = 6;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.s);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const coords = points.map((p) => [
    pad + ((p.t - minX) / spanX) * (w - pad * 2),
    h - pad - ((p.s - minY) / spanY) * (h - pad * 2),
  ]);
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${h - pad} L${coords[0][0].toFixed(1)} ${h - pad} Z`;

  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0a84ff" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#0a84ff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#sparkFill)"/>
    <path d="${line}" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

/* ---------- README（中文翻译 / 原文） ---------- */
const readmeState = { full: null, lang: 'zh', timer: null };

function stopReadmePolling() {
  if (readmeState.timer) {
    clearInterval(readmeState.timer);
    readmeState.timer = null;
  }
}

/** 渲染 Markdown，并做基础安全清洗与相对图片补全 */
function renderReadme(markdown, baseUrl) {
  const body = $('#readmeBody');
  if (!body) return;
  if (!window.marked) {
    body.innerHTML = `<pre class="readme-raw">${escapeHtml(markdown)}</pre>`;
    return;
  }

  const holder = document.createElement('div');
  holder.innerHTML = window.marked.parse(markdown, { gfm: true, breaks: false });

  holder.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach((n) => n.remove());
  holder.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*(javascript:|data:text\/html)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  // README 里的相对图片路径补全为 GitHub raw 地址
  holder.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    if (baseUrl && src && !/^(https?:|data:)/i.test(src)) {
      try {
        img.setAttribute('src', new URL(src.replace(/^\.?\//, ''), baseUrl).href);
      } catch {
        /* 忽略非法地址 */
      }
    }
  });

  body.innerHTML = holder.innerHTML;
  body.scrollTop = 0;
}

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README'];

/** 静态站没有后端，直接从 raw.githubusercontent.com 取原文（不受 API 限流影响） */
async function fetchRawReadme(full) {
  for (const name of README_CANDIDATES) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${full}/HEAD/${name}`);
      if (res.ok) {
        return {
          status: 'ready',
          markdown: await res.text(),
          baseUrl: `https://raw.githubusercontent.com/${full}/HEAD/`,
        };
      }
    } catch {
      /* 网络异常时继续尝试下一个文件名 */
    }
  }
  return { status: 'missing' };
}

async function loadReadme(lang, { poll = false } = {}) {
  const full = readmeState.full;
  if (!full) return;
  readmeState.lang = lang;

  const body = $('#readmeBody');
  const status = $('#readmeStatus');
  if (!body || !status) return;

  if (!poll) {
    stopReadmePolling();
    body.innerHTML = '<div class="skeleton" style="height:140px"></div>';
    status.textContent = lang === 'zh' ? '读取 README…' : '读取原文…';
    [...document.querySelectorAll('.rtab')].forEach((b) => b.classList.toggle('active', b.dataset.readme === lang));
  }

  if (STATIC) {
    const raw = await fetchRawReadme(full);
    if (readmeState.full !== full) return;
    if (raw.status === 'missing') {
      body.innerHTML = '<div class="empty" style="border:0">该仓库没有 README 文件</div>';
      status.textContent = '';
      return;
    }
    renderReadme(raw.markdown, raw.baseUrl);
    status.textContent = 'GitHub 原文';
    return;
  }

  let data;
  try {
    data = await api(`/api/readme?full=${encodeURIComponent(full)}&lang=${lang}`);
  } catch (err) {
    if (readmeState.full === full) {
      body.innerHTML = `<div class="empty" style="border:0">README 加载失败：${escapeHtml(err.message)}</div>`;
      status.textContent = '';
    }
    return;
  }
  if (readmeState.full !== full) return; // 弹窗已切换

  if (data.status === 'missing') {
    body.innerHTML = '<div class="empty" style="border:0">该仓库没有 README 文件</div>';
    status.textContent = '';
    return;
  }

  if (data.status === 'ready') {
    stopReadmePolling();
    renderReadme(data.markdown, data.baseUrl);
    status.textContent = lang === 'zh' ? '已翻译并缓存至本地' : 'GitHub 原文';
    return;
  }

  // 未就绪时先展示英文原文，避免空白等待
  if (!poll && data.markdown) renderReadme(data.markdown, data.baseUrl);

  if (data.status === 'translating') {
    const p = data.progress || {};
    status.innerHTML = `<span class="spin"></span>正在翻译 ${p.done || 0}/${p.total || '…'}`;
    if (!readmeState.timer) {
      readmeState.timer = setInterval(() => loadReadme('zh', { poll: true }), 2500);
    }
  } else if (data.status === 'no_key') {
    status.textContent = '未配置 DeepSeek Key，当前显示英文原文';
  } else if (data.status === 'error') {
    status.textContent = `翻译失败：${data.message}`;
  }
}

async function openDetail(fullName) {
  const overlay = $('#modalOverlay');
  overlay.hidden = false;
  stopReadmePolling();
  readmeState.full = fullName;
  $(`#modal`).innerHTML = `<div class="empty" style="border:0">加载中…</div>`;

  try {
    const d = STATIC
      ? await api(`data/repo/${fullName.replace(/\//g, '__')}.json`)
      : await api(`/api/repo?full=${encodeURIComponent(fullName)}`);
    const growth = d.history.length >= 2 ? d.stars - d.history[0].s : null;
    $('#modal').innerHTML = `
      <div class="modal-head">
        <img class="avatar" src="${escapeHtml(d.avatar)}" alt="" referrerpolicy="no-referrer" />
        <div>
          <div class="modal-title">${escapeHtml(d.fullName)}</div>
          <div class="modal-sub">${d.language ? escapeHtml(d.language) + ' · ' : ''}创建于 ${fmtDate(d.createdAt)} · 最近提交 ${timeAgo(d.pushedAt)}</div>
        </div>
      </div>
      <p class="modal-desc">${escapeHtml(d.desc || '暂无项目简介')}</p>
      <div class="grid-stats">
        <div class="cell"><div class="v">${fmtNum(d.stars)}</div><div class="k">Stars</div></div>
        <div class="cell"><div class="v">${fmtNum(d.forks)}</div><div class="k">Forks</div></div>
        <div class="cell"><div class="v">${fmtNum(d.issues)}</div><div class="k">Issues</div></div>
        <div class="cell"><div class="v">${growth == null ? '—' : '+' + fmtNum(growth)}</div><div class="k">观测期增长</div></div>
      </div>
      <div class="spark-card">
        <div class="spark-head"><span>Star 增长曲线</span><span>${d.history.length} 个采样点</span></div>
        ${sparkline(d.history)}
      </div>
      <div class="readme-block">
        <div class="readme-head">
          <div class="readme-tabs">
            ${STATIC ? '' : '<button class="rtab active" data-readme="zh" type="button">中文译文</button>'}
            <button class="rtab${STATIC ? ' active' : ''}" data-readme="en" type="button">${STATIC ? 'README 原文' : '英文原文'}</button>
          </div>
          <span class="readme-status" id="readmeStatus"></span>
        </div>
        <div class="readme-body" id="readmeBody"><div class="skeleton" style="height:140px"></div></div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close type="button">关闭</button>
        <a class="btn primary" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">在 GitHub 打开</a>
      </div>`;

    loadReadme(STATIC ? 'en' : 'zh');
  } catch (err) {
    $('#modal').innerHTML = `<div class="empty" style="border:0">${escapeHtml(err.message)}</div>`;
  }
}

/* ---------- URL 状态（支持分享链接） ---------- */
function readUrl() {
  const p = new URLSearchParams(location.search);
  const scope = p.get('scope');
  if (['total', 'new', 'trending'].includes(scope)) state.scope = scope;
  const period = p.get('period');
  if (['1d', '7d', '30d'].includes(period)) state.period = period;
  if (p.get('lang')) state.lang = p.get('lang');
  if (p.get('q')) state.q = p.get('q');
}

function syncUi() {
  [...$('#scopeTabs').children].forEach((b) => b.classList.toggle('active', b.dataset.scope === state.scope));
  [...$('#periodTabs').children].forEach((b) => b.classList.toggle('active', b.dataset.period === state.period));
  $('#periodTabs').hidden = state.scope !== 'trending';
  $('#searchInput').value = state.q;
}

function writeUrl() {
  const p = new URLSearchParams({ scope: state.scope, period: state.period });
  if (state.lang !== 'all') p.set('lang', state.lang);
  if (state.q) p.set('q', state.q);
  history.replaceState(null, '', `?${p.toString()}`);
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('#scopeTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn || btn.classList.contains('active')) return;
    state.scope = btn.dataset.scope;
    state.page = 1;
    [...$('#scopeTabs').children].forEach((b) => b.classList.toggle('active', b === btn));
    $('#periodTabs').hidden = state.scope !== 'trending';
    writeUrl();
    loadRanking();
  });

  $('#periodTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn || btn.classList.contains('active')) return;
    state.period = btn.dataset.period;
    [...$('#periodTabs').children].forEach((b) => b.classList.toggle('active', b === btn));
    writeUrl();
    loadRanking();
  });

  $('#langChips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.lang = btn.dataset.lang;
    [...$('#langChips').children].forEach((b) => b.classList.toggle('active', b === btn));
    writeUrl();
    loadRanking();
  });

  let timer = null;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value.trim();
      writeUrl();
      loadRanking();
    }, 320);
  });

  $('#loadMoreBtn').addEventListener('click', () => loadRanking({ append: true }));

  $('#list').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) openDetail(row.dataset.full);
  });

  $('#modal').addEventListener('click', (e) => {
    const tab = e.target.closest('.rtab');
    if (tab && !tab.classList.contains('active')) loadReadme(tab.dataset.readme);
  });

  const closeModal = () => {
    stopReadmePolling();
    readmeState.full = null;
    $('#modalOverlay').hidden = true;
  };

  $('#modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay' || e.target.closest('[data-close]')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modalOverlay').hidden) closeModal();
  });

  $('#refreshBtn').addEventListener('click', async () => {
    if (STATIC) return;
    $('#refreshBtn').disabled = true;
    try {
      await fetch('/api/refresh', { method: 'POST' });
      state.wasRunning = true;
    } catch {
      $('#refreshBtn').disabled = false;
    }
  });

  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('gh-rank-theme', next);
  });
}

/* ---------- 启动 ---------- */
async function boot() {
  const saved = localStorage.getItem('gh-rank-theme');
  if (saved) document.documentElement.dataset.theme = saved;

  readUrl();
  syncUi();
  bindEvents();
  if (STATIC) $('#refreshBtn').hidden = true;
  await loadStats();
  await loadRanking();
  await pollMeta();
  if (!STATIC) setInterval(pollMeta, 5000);

  const repoParam = new URLSearchParams(location.search).get('repo');
  if (repoParam) openDetail(repoParam);
}

boot();
