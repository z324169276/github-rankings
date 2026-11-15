// 生成「个人可二次开发」项目雷达数据
// 用法: node scripts/build-radar.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const db = JSON.parse(readFileSync(new URL('../data/db.json', import.meta.url)));
const repos = Object.values(db.repos);
const NOW = Date.now();
const DAY = 86400000;
const HOUR = 3600000;

const PERMISSIVE = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'MPL-2.0'];
const INDIVIDUAL_LANGS = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Vue', 'Svelte', 'HTML'];

// 排除纯资料合集：不是可二次开发的产品
const LIST_ONLY = /(awesome|curated list|roadmap|interview questions|cheat sheet|读书笔记|教程合集)/i;

// 合规风险：破解、越狱、绕过付费墙、盗版分发，商业上不可碰
const RISKY = /(jailbreak|prompt-injection|prompt injection|crack(ed)?\b|pirat|drm|rom\b|cheat|bypass (paywall|drm|licen)|account generator|破解|越狱|翻墙)/i;

// 赛道识别：按名称、描述、话题关键词归类，顺序即优先级
const TRACKS = [
  { id: 'ai-app', name: 'AI 应用 / Agent', re: /(agent|llm|rag|prompt|gpt|openai|claude|mcp|chatbot|copilot|inference|embedding|vector|ai-)/i },
  { id: 'devtool', name: '开发者工具 / CLI', re: /(cli|devtool|developer-tool|terminal|shell|editor|ide|debug|linter|formatter|build-tool)/i },
  { id: 'automation', name: '自动化 / 工作流', re: /(automation|workflow|n8n|low-code|no-code|scraper|crawler|integration|scheduler)/i },
  { id: 'saas', name: '自托管 SaaS / 效率', re: /(self-hosted|saas|dashboard|cms|analytics|newsletter|notes|wiki|kanban|booking|crm|erp)/i },
  { id: 'content', name: '内容 / 教育 / 知识', re: /(tutorial|course|book|learn|guide|docs|templates)/i },
  { id: 'frontend', name: '前端 / UI / 扩展', re: /(ui|component|frontend|design|react|vue|tailwind|extension|chrome)/i },
  { id: 'data', name: '数据 / 爬虫 / API', re: /(crawl|scrape|api|dataset|etl|pipeline|markdown|parser)/i },
];

function pickTrack(r) {
  const hay = `${r.fullName} ${r.desc || ''} ${(r.topics || []).join(' ')}`;
  for (const t of TRACKS) if (t.re.test(hay)) return t;
  return { id: 'other', name: '基础工具 / 其他' };
}

// 人工精选：编辑判断写在这里，页面与报告共用同一份数据
// angle = 二次开发切入点，money = 变现方式，risk = 主要风险
const EDITORIAL = {
  'kajisho5/ffmpeg-skill': {
    angle: '封成口播视频一键工具，去停顿、上字幕、切三个竖版尺寸',
    money: '买断 ¥99–299，或按条计费',
    risk: '纯本地工具容易被白嫖，壁垒在模板和易用性',
  },
  'openfilm/openfilm': {
    angle: '电商商品短视频批量生成，卖模板不卖模型',
    money: '按条 ¥5–20 或月付，企业版私有部署',
    risk: '模型成本波动，必须靠模板压缩调用次数',
  },
  'JuneYaooo/rea-video': {
    angle: '做爆款视频拆解报告，输出分镜、钩子类型、复刻方案',
    money: '单条 ¥50–200，十条件包 ¥800–1500',
    risk: '涉及内容抓取，只做诊断不做下载分发',
  },
  'KKKKhazix/AIHOT': {
    angle: '换成垂直行业信源，做行业情报日报站',
    money: '订阅 ¥99–499/年，企业内网版按单报价',
    risk: '版权与同质化，护城河只在信源质量',
  },
  'kanboard/kanboard': {
    angle: '给十到五十人的公司做私有看板，配 HTTPS、备份、企业微信通知',
    money: '部署 ¥2000–5000，年运维 ¥1000–3000',
    risk: '客户自己也能装，价值在省事和兜底',
  },
  'wallabag/wallabag': {
    angle: '给律所、咨询公司做资料归档与全文检索',
    money: '部署加数据迁移 ¥5000 起',
    risk: '需要长期运维，交付周期比工具长',
  },
  'krayin/laravel-crm': {
    angle: '裁剪成传统行业销售专用 CRM，只留线索、跟进、报价',
    money: '定制开发 ¥1–5 万/项目，按模块报价',
    risk: '需求蔓延，必须先锁范围再开工',
  },
  'binwiederhier/ntfy': {
    angle: '作为通知底座打包进其他交付方案',
    money: '附加模块收费，或按消息量做托管',
    risk: '单独卖不动，只能做配套',
  },
  'aureuserp/aureuserp': {
    angle: '外贸、批发企业的轻量 ERP，重点是 Excel 数据迁移',
    money: '实施 ¥2–8 万，迁移是主要利润点',
    risk: '需要行业资源，没有客户别先投入',
  },
  'bagisto/bagisto': {
    angle: '做垂直品类商城，比如汽配、工业耗材',
    money: '建站加数据导入 ¥2–10 万',
    risk: '涉及支付、备案、售后，比工具重得多',
  },
  'filamentphp/filament': {
    angle: '不直接卖，作为接单能力底座',
    money: '提升定制单的报价和交付速度',
    risk: '自身不是产品，只能间接变现',
  },
  'Clipy/Clipy': {
    angle: '加行业专用能力，做垂直剪贴板工具',
    money: '买断 ¥30–68，或上订阅制软件平台',
    risk: '仅 macOS，平台限制明显',
  },
  'anmolkapil/plexo': {
    angle: '面向素材团队的批量下载与整理，加去重和命名规范',
    money: '买断加团队授权',
    risk: '下载类工具注意合规边界',
  },
};

function licenseScore(license) {
  if (['MIT', 'Apache-2.0', 'ISC', '0BSD'].includes(license)) return 20;
  if (['BSD-3-Clause', 'BSD-2-Clause', 'Unlicense', 'CC0-1.0'].includes(license)) return 18;
  if (license === 'MPL-2.0') return 12;
  return 0;
}

function activityScore(daysSincePush) {
  if (daysSincePush <= 3) return 20;
  if (daysSincePush <= 14) return 17;
  if (daysSincePush <= 30) return 14;
  if (daysSincePush <= 90) return 9;
  if (daysSincePush <= 180) return 4;
  return 0;
}

// 体量甜区：1500~4 万星。太小没有验证，太大个人难以吃透
function tractionScore(stars) {
  if (stars < 1500) return 4;
  if (stars < 5000) return 12;
  if (stars < 15000) return 20;
  if (stars < 40000) return 18;
  if (stars < 80000) return 10;
  return 4;
}

// 产品成熟度：有官网、描述完整、话题标签丰富、已形成使用生态
function productScore(r) {
  let s = 0;
  if (r.homepage) s += 8;
  if (r.desc && r.desc.length > 20) s += 5;
  if ((r.topics || []).length >= 5) s += 4;
  if (r.forks / Math.max(r.stars, 1) > 0.05) s += 3; // 有人真的在用
  return Math.min(20, s);
}

// 个人可行性：主流语言、体量可控、标签清晰
function feasibilityScore(r) {
  let s = 0;
  if (INDIVIDUAL_LANGS.includes(r.language)) s += 8;
  else if (['Rust', 'Java', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'C#', 'Dart'].includes(r.language)) s += 5;
  else s += 2;
  if (r.stars <= 25000) s += 6;
  else if (r.stars <= 50000) s += 3;
  if ((r.topics || []).length >= 3) s += 3;
  if (!r.archived) s += 3;
  return Math.min(20, s);
}

const scored = repos
  .filter(r => !r.archived)
  .filter(r => PERMISSIVE.includes(r.license))
  .filter(r => NOW - r.pushedAt < 180 * DAY)
  .filter(r => r.stars >= 1000)
  .filter(r => !LIST_ONLY.test(`${r.fullName} ${r.desc || ''}`))
  .filter(r => !RISKY.test(`${r.fullName} ${r.desc || ''} ${(r.topics || []).join(' ')}`))
  .map(r => {
    const daysSincePush = Math.round((NOW - r.pushedAt) / DAY);
    const track = pickTrack(r);
    const first = r.history?.[0];
    const last = r.history?.[r.history.length - 1];
    const gain = first && last ? last.s - first.s : 0;
    const hoursTracked = first && last ? Math.max(1, (last.t - first.t) / HOUR) : 1;
    const score =
      licenseScore(r.license) +
      activityScore(daysSincePush) +
      productScore(r) +
      tractionScore(r.stars) +
      feasibilityScore(r);
    return {
      fullName: r.fullName,
      url: r.url,
      desc: r.desc || '',
      homepage: r.homepage || '',
      language: r.language || '',
      license: r.license || '',
      stars: r.stars,
      forks: r.forks,
      issues: r.issues,
      topics: r.topics || [],
      createdAt: new Date(r.createdAt).toISOString().slice(0, 10),
      daysSincePush,
      starGain24h: gain,
      hoursTracked: Math.round(hoursTracked),
      track: track.name,
      trackId: track.id,
      score,
    };
  })
  .sort((a, b) => b.score - a.score || b.starGain24h - a.starGain24h);

const byTrack = {};
for (const r of scored) {
  byTrack[r.trackId] ||= { name: r.track, items: [] };
  if (byTrack[r.trackId].items.length < 15) byTrack[r.trackId].items.push(r);
}

// 人工精选（含编辑判断），页面与报告共用
const byName = new Map(scored.map(r => [r.fullName, r]));
const featured = Object.keys(EDITORIAL)
  .map(name => {
    const item = byName.get(name);
    return item ? { ...item, ...EDITORIAL[name] } : null;
  })
  .filter(Boolean);

mkdirSync(new URL('../data', import.meta.url), { recursive: true });
const out = {
  generatedAt: new Date().toISOString(),
  source: 'data/db.json',
  totalRepos: repos.length,
  eligible: scored.length,
  criteria: {
    license: 'MIT / Apache-2.0 / BSD / ISC 等宽松许可',
    activity: '180 天内有推送',
    stars: '≥ 1000，排除纯资料合集',
    archived: '已排除',
  },
  scoring: 'license 20 + activity 20 + traction 20 + product 20 + feasibility 20 = 100',
  featured,
  top: scored.slice(0, 40),
  byTrack,
};
writeFileSync(new URL('../data/radar.json', import.meta.url), JSON.stringify(out, null, 2));

console.log(`总仓库 ${repos.length}，符合条件 ${scored.length}，人工精选 ${featured.length}`);
console.log('--- TOP 30 ---');
scored.slice(0, 30).forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(2)}. [${r.score}] ${r.fullName} | ${r.stars}★ | ${r.license} | ${r.language} | ${r.track}`
  );
});
console.log('\n--- 赛道分布 ---');
Object.values(byTrack).forEach(t => console.log(`${t.name}: ${t.items.length}`));
