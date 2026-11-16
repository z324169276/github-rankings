/* 项目总表：读取 data/projects.json，按五个维度筛选 */

const $ = (sel) => document.querySelector(sel);

const ISSUE_PAGES = {
  1: '2026-11-16-个人可二次开发项目榜',
  2: '2026-11-16-第2期-许可证决定怎么收钱',
  3: '2026-11-16-第3期-按客户预算选项目',
  4: '2026-11-16-第4期-按交付难度选项目',
};

const LEVELS = ['一星', '二星', '三星', '四星'];
const BUDGETS = ['千元级', '万元级', '十万级', '百万级'];
const LICENSE_MODES = ['可做产品', '只能做服务', '需核对'];
const LEVEL_NUM = Object.fromEntries(LEVELS.map((l, i) => [l, i + 1]));
const BUDGET_NUM = Object.fromEntries(BUDGETS.map((b, i) => [b, i + 1]));

let DATA = [];
let state = { issue: 'all', level: 'all', budget: 'all', licenseMode: 'all', track: 'all', kw: '', sort: 'stars' };

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtNum = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0));

function fmtDate(ts) {
  const d = new Date(ts);
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

/* ---------- 筛选器 ---------- */
function groupOptions(key, fixed) {
  if (fixed) {
    return [
      { value: 'all', label: '全部' },
      ...fixed.map((v) => ({ value: v, label: v })),
    ];
  }
  const set = new Set(DATA.map((d) => d[key]));
  return [{ value: 'all', label: '全部' }, ...[...set].sort().map((v) => ({ value: v, label: v }))];
}

function renderSegmented(el, key, options) {
  el.innerHTML = options
    .map((o) => {
      const count = o.value === 'all' ? DATA.length : DATA.filter((d) => String(d[key]) === String(o.value)).length;
      return `<button class="seg${state[key] === o.value ? ' active' : ''}" data-value="${esc(o.value)}" type="button">
        ${esc(o.label)}<span class="seg-count">${count}</span>
      </button>`;
    })
    .join('');

  el.querySelectorAll('.seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      state[key] = btn.dataset.value;
      el.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
  });
}

/* ---------- 过滤与排序 ---------- */
function filterItems() {
  const kw = state.kw;
  let items = DATA.filter((d) => {
    if (state.issue !== 'all' && String(d.issue) !== state.issue) return false;
    if (state.level !== 'all' && d.level !== state.level) return false;
    if (state.budget !== 'all' && d.budget !== state.budget) return false;
    if (state.licenseMode !== 'all' && d.licenseMode !== state.licenseMode) return false;
    if (state.track !== 'all' && d.track !== state.track) return false;
    if (!kw) return true;
    const hay = `${d.fullName} ${d.desc} ${d.angle} ${d.price} ${d.track} ${d.language || ''} ${d.license || ''}`.toLowerCase();
    return hay.includes(kw);
  });

  const cmp = {
    stars: (a, b) => b.stars - a.stars,
    forks: (a, b) => b.forks - a.forks,
    level: (a, b) => LEVEL_NUM[a.level] - LEVEL_NUM[b.level] || b.stars - a.stars,
    budget: (a, b) => BUDGET_NUM[a.budget] - BUDGET_NUM[b.budget] || b.stars - a.stars,
    issue: (a, b) => a.issue - b.issue || LEVEL_NUM[a.level] - LEVEL_NUM[b.level],
  }[state.sort];

  return items.sort(cmp);
}

/* ---------- 渲染 ---------- */
function rowHtml(d) {
  const lic = !d.license ? '无' : d.license === 'NOASSERTION' ? '未识别' : d.license;
  const licClass = d.licenseMode === '需核对' ? ' class="lic-warn" title="GitHub 未识别为标准许可证，商用前需逐条核对"' : '';
  const levelNum = LEVEL_NUM[d.level] || 0;
  const page = ISSUE_PAGES[d.issue];

  return `
    <tr>
      <td>
        <a class="p-name" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.fullName)}</a>
        <span class="p-desc">${esc(d.desc || '暂无简介')}</span>
      </td>
      <td class="col-angle"><span class="p-angle">${esc(d.angle)}</span></td>
      <td class="col-issue"><a class="issue-link" href="reports/${encodeURIComponent(page)}.html">第 ${d.issue} 期</a></td>
      <td class="col-level"><span class="tag level-${levelNum}">${esc(d.level)}</span></td>
      <td class="col-budget"><span class="tag">${esc(d.budget)}</span></td>
      <td class="col-num">${fmtNum(d.stars)}</td>
      <td class="col-num col-forks">${fmtNum(d.forks)}</td>
      <td class="col-lic" title="${esc(d.licenseMode)}"><span${licClass}>${esc(lic)}</span></td>
      <td class="col-lang">${esc(d.language || '—')}</td>
      <td class="col-price">${esc(d.price)}</td>
    </tr>`;
}

function render() {
  const items = filterItems();
  $('#statShown').textContent = String(items.length);
  $('#projectBody').innerHTML = items.length
    ? items.map(rowHtml).join('')
    : '<tr><td colspan="10"><div class="empty" style="border:none">没有匹配的项目，换个条件或点重置</div></td></tr>';
}

/* ---------- 启动 ---------- */
async function boot() {
  initTheme();

  try {
    const res = await fetch('data/projects.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    DATA = payload.items || [];
    $('#statUpdated').textContent = fmtDate(payload.updatedAt);
  } catch (err) {
    const notice = $('#notice');
    notice.hidden = false;
    notice.textContent = `数据加载失败（${err.message}），请先执行 npm run build 生成 data/projects.json`;
    return;
  }

  if (!DATA.length) return;

  $('#statCount').textContent = String(DATA.length);
  $('#statTracks').textContent = String(new Set(DATA.map((d) => d.track)).size);

  renderSegmented($('#issueTabs'), 'issue', groupOptions('issue', ['1', '2', '3', '4']).map((o) => ({
    ...o,
    label: o.value === 'all' ? '全部' : `第 ${o.value} 期`,
  })));
  renderSegmented($('#levelTabs'), 'level', groupOptions('level', LEVELS));
  renderSegmented($('#budgetTabs'), 'budget', groupOptions('budget', BUDGETS));
  renderSegmented($('#licenseModeTabs'), 'licenseMode', groupOptions('licenseMode', LICENSE_MODES));
  renderSegmented($('#trackTabs'), 'track', groupOptions('track'));

  $('#searchInput').addEventListener('input', (e) => {
    state.kw = e.target.value.trim().toLowerCase();
    render();
  });

  $('#sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    render();
  });

  $('#resetBtn').addEventListener('click', () => {
    state = { issue: 'all', level: 'all', budget: 'all', licenseMode: 'all', track: 'all', kw: '', sort: 'stars' };
    $('#searchInput').value = '';
    $('#sortSelect').value = 'stars';
    document.querySelectorAll('.filters .segmented').forEach((group) => {
      group.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.value === 'all'));
    });
    render();
  });

  render();
}

boot();
