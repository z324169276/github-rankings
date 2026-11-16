import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');

/* ---------- 极简 Markdown 渲染（仅覆盖榜单报告用到的语法） ---------- */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function inline(text) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[i])}</code>`);
  return s;
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableSep = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-');

function splitRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function renderTable(rows) {
  const [head, , ...body] = rows;
  const th = splitRow(head)
    .map((c) => `<th>${inline(c)}</th>`)
    .join('');
  const tr = body
    .map((r) => `<tr>${splitRow(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** 返回 { title, html, excerpt } */
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let title = '';
  let excerpt = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // 分割线
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      if (level === 1) {
        title = text;
      } else {
        const tag = level === 2 ? 'h2' : 'h3';
        out.push(`<${tag}>${inline(text)}</${tag}>`);
      }
      i++;
      continue;
    }

    // 表格
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      out.push(renderTable(rows));
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map((l) => (l.trim() ? `<p>${inline(l)}</p>` : '')).join('')}</blockquote>`);
      continue;
    }

    // 列表
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        const task = /^\[([ xX])\]\s+/.exec(raw);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(
            `<li class="task${checked ? ' done' : ''}"><span class="box">${checked ? '✓' : ''}</span>${inline(
              raw.replace(/^\[[ xX]\]\s+/, ''),
            )}</li>`,
          );
        } else {
          items.push(`<li>${inline(raw)}</li>`);
        }
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}${items.some((x) => x.includes('class="task')) ? ' class="task-list"' : ''}>${items.join('')}</${tag}>`);
      continue;
    }

    // 段落
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !isTableRow(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    const html = inline(buf.join(' '));
    if (!excerpt && buf.length) excerpt = buf.join(' ').replace(/[*`\[\]]/g, '').slice(0, 96);
    out.push(`<p>${html}</p>`);
  }

  return { title, html: out.join('\n'), excerpt };
}

/* ---------- 页面骨架 ---------- */

function shell({ title, desc, body, page }) {
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta name="theme-color" content="#0a84ff" />
<link rel="stylesheet" href="${page === 'index' ? '' : '../'}style.css" />
<link rel="stylesheet" href="${page === 'index' ? '' : '../'}reports.css" />
</head>
<body>
<div class="orb orb-a"></div>
<div class="orb orb-b"></div>
<div class="orb orb-c"></div>
<header class="topbar">
  <a class="brand" href="${page === 'index' ? '' : '../'}index.html">
    <div class="logo">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z"/>
      </svg>
    </div>
    <div class="brand-text"><h1>GitHub 榜单</h1><p>往期榜单</p></div>
  </a>
  <div class="top-actions">
    <a class="btn ghost" href="${page === 'index' ? '' : '../'}index.html">趋势榜</a>
    <a class="btn ghost" href="${page === 'index' ? '' : '../'}radar.html">商业化雷达</a>
  </div>
</header>
<main>
${body}
</main>
<p class="footnote">数据来自 GitHub 公开 API · <a href="${page === 'index' ? '' : '../'}index.html">趋势榜</a> · <a href="${
    page === 'index' ? '' : '../'
  }radar.html">商业化雷达</a></p>
</body>
</html>`;
}

/* ---------- 构建 ---------- */

export function buildReports(distDir) {
  if (!fs.existsSync(REPORTS_DIR)) {
    console.warn('⚠ 未找到 reports 目录，跳过往期榜单');
    return;
  }

  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    console.warn('⚠ reports 目录为空，跳过往期榜单');
    return;
  }

  const outDir = path.join(distDir, 'reports');
  fs.mkdirSync(outDir, { recursive: true });

  const items = files.map((file) => {
    const md = fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8');
    const { title, html, excerpt } = renderMarkdown(md);
    const slug = file.replace(/\.md$/, '');
    // 只有文件名带日期才算一期榜单，其余归为专题
    const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(file);
    const date = dateMatch ? dateMatch[1] : '';

    const pageHtml = shell({
      title: `${title || slug} · GitHub 榜单`,
      desc: excerpt,
      page: 'article',
      body: `<article class="article">
  <a class="back" href="../reports.html">← 全部榜单</a>
  <h1>${escapeHtml(title || slug)}</h1>
  ${date ? `<p class="article-meta">${date}</p>` : ''}
  <div class="md">
${html}
  </div>
</article>`,
    });
    fs.writeFileSync(path.join(outDir, `${slug}.html`), pageHtml, 'utf8');

    return { slug, title, excerpt, html, date };
  });

  items.sort((a, b) => {
    const byDate = (b.date || '').localeCompare(a.date || '');
    if (byDate !== 0) return byDate;
    // 同期按文件名倒序，让新一期排在前面（用码点比较，避免拼音排序打乱）
    return a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0;
  });

  const cards = items
    .map(
      (it) => `<a class="report-card" href="reports/${encodeURI(it.slug)}.html">
  <div class="report-date">${it.date || '专题'}</div>
  <h2>${escapeHtml(it.title)}</h2>
  <p>${escapeHtml(it.excerpt)}</p>
  <span class="report-more">阅读全文 →</span>
</a>`,
    )
    .join('\n');

  const indexHtml = shell({
    title: '往期榜单 · GitHub 商业化雷达',
    desc: '从 GitHub 热门仓库中筛出个人能接住的商业机会，每期一份榜单，含切入点和收钱方式。',
    page: 'index',
    body: `<section class="hero">
  <p class="eyebrow">Published Reports</p>
  <h2>往期<em>榜单</em></h2>
  <p class="hero-desc">每期从热榜里筛出一个人能接住的商业机会，给出切入点、变现方式和风险提示。免费阅读，无需登录。</p>
</section>
<section class="report-list">
${cards}
</section>`,
  });
  fs.writeFileSync(path.join(distDir, 'reports.html'), indexHtml, 'utf8');

  console.log(`  往期榜单  ${items.length} 篇 → dist/reports.html`);
}
