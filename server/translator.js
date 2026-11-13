const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const MAX_CHUNK = 2600; // 单次请求的 Markdown 字符上限
const CONCURRENCY = 3;

const SYSTEM_PROMPT = `你是资深技术文档译者。把用户给出的 Markdown 片段翻译成简体中文，规则：
1. 严格保留原 Markdown 结构：标题层级、列表符号、表格竖线、引用符号、空行位置。
2. 代码块、行内代码、命令、文件名、变量名、URL、图片地址、HTML 标签、徽章（badge）一律不翻译、不改写、不删除。
3. 技术专有名词（如 React、Kubernetes、Docker）保留英文原文。
4. 不添加原文没有的内容，不输出解释、注释或任何前后缀说明。
5. 只输出翻译后的 Markdown 本身。`;

/** 按代码围栏切块，代码块整体跳过翻译 */
function splitBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let buffer = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length) {
      blocks.push({ type: inFence ? 'code' : 'text', text: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of lines) {
    const isFence = /^\s*(```|~~~)/.test(line);
    if (isFence) {
      if (!inFence) {
        flush();
        inFence = true;
        buffer.push(line);
      } else {
        buffer.push(line);
        blocks.push({ type: 'code', text: buffer.join('\n') });
        buffer = [];
        inFence = false;
      }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** 超长文本按空行切成段落，再合并成不超过上限的请求体 */
function splitLongText(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const pieces = [];
  let current = '';
  for (const p of paragraphs) {
    if (p.length > MAX_CHUNK) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      for (let i = 0; i < p.length; i += MAX_CHUNK) pieces.push(p.slice(i, i + MAX_CHUNK));
      continue;
    }
    if (current.length + p.length + 2 > MAX_CHUNK) {
      pieces.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** 把文档拆成「原文块」与「待翻译片段」两类，保持原始顺序 */
function buildParts(markdown) {
  const blocks = splitBlocks(markdown);
  const parts = [];
  let current = [];

  const flushProse = () => {
    if (!current.length) return;
    const text = current.join('\n');
    for (const piece of splitLongText(text)) parts.push({ kind: 'prose', text: piece });
    current = [];
  };

  for (const block of blocks) {
    if (block.type === 'code') {
      flushProse();
      parts.push({ kind: 'code', text: block.text });
    } else {
      current.push(block.text);
    }
  }
  flushProse();
  return parts;
}

async function callDeepSeek(text, apiKey, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        return callDeepSeek(text, apiKey, attempt + 1);
      }
      throw new Error(`DeepSeek 接口返回 ${res.status}${body ? `：${body.slice(0, 160)}` : ''}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) throw new Error('DeepSeek 返回内容为空');
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 翻译整篇 Markdown：代码块原样保留，其余分段并发翻译
 * @returns {Promise<string>} 中文 Markdown
 */
export async function translateMarkdown(markdown, { apiKey, onProgress } = {}) {
  const parts = buildParts(markdown);
  const pending = parts.filter((p) => p.kind === 'prose');
  if (!pending.length) return markdown;

  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < pending.length) {
      const part = pending[cursor++];
      part.translated = await callDeepSeek(part.text, apiKey);
      done += 1;
      onProgress?.(done, pending.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));

  // 片段之间用空行分隔，避免相邻段落被合并
  return parts
    .map((p) => (p.kind === 'code' ? p.text : p.translated).replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .join('\n\n');
}
