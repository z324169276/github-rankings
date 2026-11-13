/**
 * 构建期抓取仓库 README 并压成一段纯文本摘要。
 * 优先用 raw.githubusercontent.com（CI 环境稳定），本地（国内网络）常被 DNS 拦截，
 * 因此再退回 jsDelivr 的 GitHub 镜像。只取前 60KB，失败返回 null，详情页照常生成。
 */

const CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README.rst', 'README.txt'];
const MAX_SOURCE = 60000;
const MAX_EXCERPT = 320;

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

let rawAvailable = true;

/** 返回 { status, text }；网络层失败时 status 为 0 */
async function request(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Range: `bytes=0-${MAX_SOURCE}`, 'User-Agent': 'github-rankings' },
    });
    return { status: res.status, text: res.ok ? (await res.text()).slice(0, MAX_SOURCE) : '' };
  } catch {
    return { status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** 依次尝试 raw、jsDelivr 镜像与常见 README 文件名，返回第一段可用摘要 */
export async function fetchReadmeExcerpt(fullName, { timeout = 8000 } = {}) {
  const sources = [];
  if (rawAvailable) {
    sources.push({ kind: 'raw', base: `https://raw.githubusercontent.com/${fullName}/HEAD` });
  }
  sources.push({ kind: 'mirror', base: `https://cdn.jsdelivr.net/gh/${fullName}@main` });
  sources.push({ kind: 'mirror', base: `https://cdn.jsdelivr.net/gh/${fullName}@master` });

  for (const source of sources) {
    for (const name of CANDIDATES) {
      const res = await request(`${source.base}/${name}`, timeout);
      if (res.status === 0) {
        // DNS 被拦或超时：本地常见的 raw 不可达，后续仓库直接跳过它
        if (source.kind === 'raw') rawAvailable = false;
        break;
      }
      if (res.status === 404) continue;
      if (res.status < 200 || res.status >= 300) break;
      const excerpt = toExcerpt(res.text);
      return excerpt || null;
    }
  }
  return null;
}
