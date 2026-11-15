/* 商业化雷达：读取 data/radar.json 渲染精选卡片与候选表 */

const $ = (sel) => document.querySelector(sel);

let DATA = null;
let activeTrack = 'all';
let keyword = '';

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtStars(n) {
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- 主题 ---------- */
function initTheme() {
  const saved = localStorage.getItem('gh-rank-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('gh-rank-theme', next);
  });
}

/* ---------- 数据加载 ---------- */
async function loadData() {
  const res = await fetch('data/radar.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------- 渲染 ---------- */
function renderStats(data) {
  $('#statRepos').textContent = data.totalRepos.toLocaleString('zh-CN');
  $('#statEligible').textContent = data.eligible.toLocaleString('zh-CN');
  $('#statFeatured').textContent = String(data.featured.length);
  $('#statUpdated').textContent = fmtDate(data.generatedAt);
}

function renderTracks(data) {
  const counts = new Map();
  for (const item of data.featured) {
    counts.set(item.trackId, (counts.get(item.trackId) || 0) + 1);
  }
  const tabs = [{ id: 'all', name: '全部', count: data.featured.length }];
  for (const [id, count] of counts) {
    const found = data.featured.find((x) => x.trackId === id);
    tabs.push({ id, name: found.track, count });
  }

  $('#trackTabs').innerHTML = tabs
    .map(
      (t) => `<button class="seg${t.id === activeTrack ? ' active' : ''}" data-track="${esc(t.id)}" type="button">
        ${esc(t.name)}<span class="seg-count">${t.count}</span>
      </button>`,
    )
    .join('');

  $('#trackTabs').querySelectorAll('.seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTrack = btn.dataset.track;
      $('#trackTabs').querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
      renderFeatured();
    });
  });
}

function matches(item) {
  if (activeTrack !== 'all' && item.trackId !== activeTrack) return false;
  if (!keyword) return true;
  const hay = `${item.fullName} ${item.desc} ${(item.topics || []).join(' ')} ${item.angle || ''}`.toLowerCase();
  return hay.includes(keyword);
}

function cardHtml(item) {
  const homepage = item.homepage && /^https?:\/\//.test(item.homepage)
    ? `<a class="pcard-link" href="${esc(item.homepage)}" target="_blank" rel="noopener">官网</a>`
    : '';
  return `
    <article class="pcard">
      <div class="pcard-top">
        <div>
          <a class="pcard-name" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.fullName)}</a>
          <div class="pcard-track">${esc(item.track)}</div>
        </div>
        <span class="pcard-score">${item.score} 分</span>
      </div>
      <p class="pcard-desc">${esc(item.desc || '暂无简介')}</p>
      <div class="pcard-meta">
        <span><b>${fmtStars(item.stars)}</b> 星</span>
        <span><b>${fmtStars(item.forks)}</b> fork</span>
        <span>${esc(item.license)}</span>
        <span>${esc(item.language || '未知语言')}</span>
        ${homepage}
      </div>
      <div class="pcard-rows">
        <div class="prow"><span class="lab">切入点</span><span class="val">${esc(item.angle)}</span></div>
        <div class="prow money"><span class="lab">怎么收钱</span><span class="val">${esc(item.money)}</span></div>
        <div class="prow risk"><span class="lab">注意</span><span class="val">${esc(item.risk)}</span></div>
      </div>
    </article>`;
}

function renderFeatured() {
  const items = DATA.featured.filter(matches);
  const grid = $('#featuredGrid');
  grid.innerHTML = items.length
    ? items.map(cardHtml).join('')
    : '<div class="empty">没有匹配的项目，换个关键词或赛道试试</div>';
  renderCandidates();
}

function renderCandidates() {
  const featuredNames = new Set(DATA.featured.map((x) => x.fullName));
  const rows = DATA.top
    .filter((x) => !featuredNames.has(x.fullName))
    .filter(matches);

  const body = $('#candidateBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty" style="border:none">没有匹配的项目</div></td></tr>';
    return;
  }

  body.innerHTML = rows
    .map(
      (x, i) => `
      <tr>
        <td class="col-rank">${i + 1}</td>
        <td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.fullName)}</a></td>
        <td class="col-num">${fmtStars(x.stars)}</td>
        <td class="col-num">${fmtStars(x.forks)}</td>
        <td class="col-lic">${esc(x.license)}</td>
        <td class="col-lang">${esc(x.language || '—')}</td>
        <td class="col-num">${x.score}</td>
      </tr>`,
    )
    .join('');
}

/* ---------- 启动 ---------- */
async function boot() {
  initTheme();

  $('#searchInput').addEventListener('input', (e) => {
    keyword = e.target.value.trim().toLowerCase();
    renderFeatured();
  });

  try {
    DATA = await loadData();
  } catch (err) {
    const notice = $('#notice');
    notice.hidden = false;
    notice.textContent = `数据加载失败（${err.message}），请先执行 npm run build 生成 data/radar.json`;
    return;
  }

  renderStats(DATA);
  renderTracks(DATA);
  renderFeatured();
}

boot();
