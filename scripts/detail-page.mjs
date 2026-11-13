/** 生成单个仓库的静态详情页（纯 HTML + 内联 SVG，无 JS，便于搜索引擎收录） */

const DAY = 86400000;

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

const fmtDate = (ts) =>
  Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString().slice(0, 10) : '—';

/** owner/name → repo/owner/name.html */
export function detailPagePath(fullName) {
  return `repo/${fullName.replace(/^\/+|\/+$/g, '')}.html`;
}

/**
 * Star 增量：在最近 7 天内取最老的采样点当基准，得到可观测的最长窗口。
 * 样本跨度不足 1 天时返回 null，不编造数字。
 */
function growth(history) {
  const points = (history || []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.s));
  if (points.length < 2) return null;
  const now = Date.now();
  const last = points[points.length - 1];
  const base = points.find((p) => last.t - p.t >= DAY && now - p.t <= 7 * DAY);
  if (!base) return null;
  return {
    delta: Math.max(last.s - base.s, 0),
    days: Math.max(1, Math.round((last.t - base.t) / DAY)),
  };
}

function chart(history) {
  const points = (history || []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.s));
  if (points.length < 2) {
    return '<div class="empty">历史样本不足，暂时画不出 Star 走势</div>';
  }

  const W = 640;
  const H = 170;
  const PAD = 12;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const s0 = Math.min(...points.map((p) => p.s));
  const s1 = Math.max(...points.map((p) => p.s));
  const spanT = t1 - t0 || 1;
  const spanS = s1 - s0 || 1;

  const x = (t) => PAD + ((t - t0) / spanT) * (W - PAD * 2);
  const y = (s) => H - PAD - ((s - s0) / spanS) * (H - PAD * 2);

  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.s).toFixed(1)}`).join(' ');
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Star 走势，${points.length} 个采样点">
        <title>Star 走势</title>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0a84ff" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#0a84ff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <polygon points="${area}" fill="url(#fill)" />
        <polyline points="${line}" fill="none" stroke="#0a84ff" stroke-width="2.4"
          stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${x(points[points.length - 1].t).toFixed(1)}" cy="${y(points[points.length - 1].s).toFixed(1)}" r="3.6" fill="#0a84ff" />
      </svg>`;
}

export function renderDetailPage({ detail, related = [], siteUrl, langLabel, excerpt = '' }) {
  const canonical = `${siteUrl}${detailPagePath(detail.fullName)}`;
  const grow = growth(detail.history);
  const lang = detail.language || langLabel || '未知语言';
  const title = `${detail.fullName} · Star ${fmtNum(detail.stars)} · GitHub 开源榜单`;
  const rawDesc = detail.desc ? detail.desc.trim() : '';
  const shortDesc = rawDesc.length > 100 ? `${rawDesc.slice(0, 100).trimEnd()}…` : rawDesc;
  const baseDesc = shortDesc || excerpt;
  const fullDesc = baseDesc
    ? `${baseDesc}（${detail.fullName}，${lang}，${fmtNum(detail.stars)} Star）`
    : `${detail.fullName} 的 Star、Fork、活跃度与语言信息。${lang} 项目，${fmtNum(detail.stars)} Star。`;
  const description = fullDesc.length > 160 ? `${fullDesc.slice(0, 157).trimEnd()}…` : fullDesc;

  const topics = (detail.topics || [])
    .map((t) => `<span class="badge">${esc(t)}</span>`)
    .join('');

  const relatedHtml = related.length
    ? `<ul class="related">${related
        .map(
          (r) => `<li><a href="../../${detailPagePath(r.fullName)}">
          <span>${esc(r.fullName)}</span>
          <span class="stars">${fmtNum(r.stars)} ★</span>
        </a></li>`,
        )
        .join('')}</ul>`
    : '<div class="empty">暂无同语言推荐</div>';

  // 仓库级分享卡：GitHub 自己为每个仓库生成的 1200×630 预览图，比统一品牌图更能说明内容
  const ogImage = `https://opengraph.githubassets.com/1/${detail.fullName}`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: detail.fullName,
    description: detail.desc || undefined,
    codeRepository: detail.url,
    programmingLanguage: lang,
    dateCreated: Number.isFinite(detail.createdAt) ? fmtDate(detail.createdAt) : undefined,
    license: detail.license || undefined,
    url: canonical,
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:site_name" content="GitHub 榜单" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(`${detail.fullName} 的 GitHub 仓库卡片`)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
  <link rel="alternate" type="application/rss+xml" href="../../feed.xml" title="GitHub 榜单 · 热门榜" />
  <link rel="stylesheet" href="../../detail.css" />
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <a href="../../">← GitHub 榜单</a>
      <a href="../../feed.xml">RSS</a>
    </div>

    <nav class="crumb">
      <a href="../../?scope=total&amp;lang=${encodeURIComponent(detail.language || 'all')}">总榜</a>
      <span>›</span> ${esc(lang)}
    </nav>

    <h1><span class="owner">${esc(detail.owner)}/</span>${esc(detail.name)}</h1>
    <p class="desc">${esc(detail.desc || '该仓库没有填写简介。')}</p>

    <div class="badges">
      <span class="badge"><span class="dot"></span>${esc(lang)}</span>
      ${detail.license ? `<span class="badge">${esc(detail.license)}</span>` : ''}
      ${detail.archived ? '<span class="badge">已归档</span>' : ''}
      <span class="badge">创建于 ${fmtDate(detail.createdAt)}</span>
    </div>

    <div class="stats">
      <div class="stat"><div class="value">${fmtNum(detail.stars)}</div><div class="label">Star</div></div>
      <div class="stat"><div class="value">${fmtNum(detail.forks)}</div><div class="label">Fork</div></div>
      <div class="stat"><div class="value">${fmtNum(detail.issues)}</div><div class="label">Open Issues</div></div>
      <div class="stat"><div class="value${grow ? ' up' : ''}">${grow ? `+${fmtNum(grow.delta)}` : '—'}</div><div class="label">${grow ? `近 ${grow.days} 天 Star` : 'Star 增量'}</div></div>
    </div>

    ${excerpt ? `<section class="card">
      <h2>README 摘要</h2>
      <p class="excerpt">${esc(excerpt)}</p>
      <p class="excerpt-src">截取自仓库 README · <a href="${esc(detail.url)}/blob/HEAD/README.md" rel="noopener">查看原文</a></p>
    </section>` : ''}

    <section class="card chart">
      <h2>Star 增长曲线</h2>
      ${chart(detail.history)}
    </section>

    <section class="card">
      <h2>仓库信息</h2>
      <dl class="meta-grid">
        <div><dt>最近推送</dt><dd>${fmtDate(detail.pushedAt)}</dd></div>
        <div><dt>首次收录</dt><dd>${fmtDate(detail.firstSeenAt)}</dd></div>
        <div><dt>许可证</dt><dd>${esc(detail.license || '未标注')}</dd></div>
        <div><dt>采样点</dt><dd>${(detail.history || []).length} 个</dd></div>
      </dl>
      ${topics ? `<div class="topics">${topics}</div>` : ''}
    </section>

    <section class="card">
      <h2>${detail.language ? '同语言高星项目' : '榜单高分项目'}</h2>
      ${relatedHtml}
    </section>

    <a class="cta" href="${esc(detail.url)}" rel="noopener">在 GitHub 查看 →</a>

    <footer>
      数据来自 GitHub REST API，每日自动更新 ·
      <a href="../../api/v1/index.json">JSON API</a> ·
      <a href="https://github.com/z324169276/github-rankings">开源仓库</a>
    </footer>
  </div>
</body>
</html>
`;
}
