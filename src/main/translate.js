'use strict';
const crypto = require('node:crypto');
const store = require('./config');
const log = require('./logger');

/* ------------------------------------------------------------------ */
/* 语言表                                                              */
/* ------------------------------------------------------------------ */

const LANGS = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh', label: '中文（简体）' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'ar', label: 'العربية' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Bahasa Indonesia' },
];

const LABEL = Object.fromEntries(LANGS.map((l) => [l.code, l.label]));
const LLM_NAME = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  pt: 'Portuguese',
  it: 'Italian',
  ar: 'Arabic',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
};

const CLIENT_KEY = `browser-chrome-131.0.0-Windows-10-${crypto.randomUUID()}-${Date.now()}`;

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withTimeout(promiseFactory, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await promiseFactory(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, times = 2, delay = 220) {
  let last;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < times - 1) await sleep(delay * (i + 1));
    }
  }
  throw last;
}

function splitLongSentence(s, maxLen) {
  const out = [];
  let buf = '';
  for (const w of s.split(/\s+/)) {
    if (buf && buf.length + w.length + 1 > maxLen) {
      out.push(buf);
      buf = w;
    } else {
      buf = buf ? `${buf} ${w}` : w;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 切成句子级片段，保留段落边界。
 * 逐句翻译并发请求，才能做到“边翻边出”的流式观感；同时在语义上按句聚合，避免上下文碎裂。
 */
function makeChunks(raw, maxLen = 320) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const paras = text.split('\n');
  const chunks = [];

  paras.forEach((para, idx) => {
    const isLast = idx === paras.length - 1;
    const s = para.trim();

    if (!s) {
      if (!isLast && chunks.length && !chunks[chunks.length - 1].breakAfter) {
        chunks[chunks.length - 1].breakAfter = true;
      }
      return;
    }

    let sentences = s.split(/(?<=[.!?。！？；;])\s+/).filter((x) => x.trim());
    if (!sentences.length) sentences = [s];

    const expanded = [];
    for (const sen of sentences) {
      if (sen.length > maxLen * 1.6) expanded.push(...splitLongSentence(sen, maxLen));
      else expanded.push(sen);
    }

    let buf = '';
    for (const sen of expanded) {
      if (buf && buf.length + sen.length + 1 > maxLen) {
        chunks.push({ text: buf, breakAfter: false });
        buf = sen;
      } else {
        buf = buf ? `${buf} ${sen}` : sen;
      }
    }
    if (buf) chunks.push({ text: buf, breakAfter: false });

    if (!isLast) {
      const last = chunks[chunks.length - 1];
      if (last) last.breakAfter = true;
    }
  });

  if (!chunks.length) chunks.push({ text: text.trim(), breakAfter: false });
  return chunks;
}

/* ------------------------------------------------------------------ */
/* 缓存                                                                */
/* ------------------------------------------------------------------ */

const CACHE_LIMIT = 300;
const cache = new Map();

function cacheKey(text, from, to) {
  return `${from}|${to}|${text}`;
}

function cacheGet(text, from, to) {
  const k = cacheKey(text, from, to);
  const v = cache.get(k);
  if (v == null) return null;
  cache.delete(k);
  cache.set(k, v);
  return v;
}

function cacheSet(text, from, to, value) {
  if (!value) return;
  cache.set(cacheKey(text, from, to), value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/* ------------------------------------------------------------------ */
/* Provider: 腾讯交互翻译（默认，无需 key，~150ms）                     */
/* ------------------------------------------------------------------ */

async function tencentBatch(texts, from, to) {
  const payload = {
    header: { fn: 'auto_translation', client_key: CLIENT_KEY },
    type: 'plain',
    model_category: 'normal',
    source: { lang: from === 'auto' ? 'auto' : from, text_list: texts },
    target: { lang: to },
  };

  const json = await withTimeout(
    (signal) =>
      fetch('https://transmart.qq.com/api/imt', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://transmart.qq.com/zh-CN/index',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(payload),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    12000
  );

  if (!json || !json.header || json.header.ret_code !== 'succ' || !Array.isArray(json.auto_translation)) {
    const msg = (json && (json.message || (json.header && json.header.ret_code))) || '未知错误';
    throw new Error(`腾讯翻译返回异常：${msg}`);
  }
  return { lines: json.auto_translation, detected: json.src_lang || null };
}

/**
 * 分片并发翻译，按原始顺序增量吐出。
 */
async function streamChunked(chunks, fn, { onDelta, concurrency = 3, signal }) {
  const results = new Array(chunks.length).fill(null);
  let cursor = 0;
  let emitIdx = 0;
  let failure = null;

  const flush = () => {
    while (emitIdx < results.length && results[emitIdx] !== null) {
      const c = chunks[emitIdx];
      onDelta(results[emitIdx] + (c.breakAfter ? '\n' : ''));
      emitIdx++;
    }
  };

  const runner = async () => {
    for (;;) {
      if (failure || (signal && signal.aborted)) return;
      const i = cursor++;
      if (i >= chunks.length) return;
      try {
        results[i] = await withRetry(() => fn(chunks[i].text));
      } catch (e) {
        failure = e;
        return;
      }
      flush();
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, chunks.length)) }, runner));
  if (failure) throw failure;
  if (emitIdx < chunks.length) throw new Error('翻译未完成');
}

async function runTencent({ text, from, to, onDelta, signal, onMeta }) {
  const chunks = makeChunks(text);
  let detected = null;

  await streamChunked(
    chunks,
    async (piece) => {
      const { lines, detected: d } = await tencentBatch([piece], from, to);
      if (d && !detected) {
        detected = d;
        onMeta && onMeta({ detected: d });
      }
      return String(lines[0] || '');
    },
    { onDelta, signal, concurrency: 3 }
  );

  return { detected };
}

/* ------------------------------------------------------------------ */
/* Provider: MyMemory（免费兜底，限 500 字符/次）                        */
/* ------------------------------------------------------------------ */

async function runMyMemory({ text, from, to, onDelta, signal, onMeta }) {
  const chunks = makeChunks(text, 450);
  const src = from === 'auto' ? 'en' : from;

  await streamChunked(
    chunks,
    async (piece) => {
      const url =
        'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(piece) +
        `&langpair=${encodeURIComponent(src)}|${encodeURIComponent(to)}`;
      const json = await withTimeout(
        (s) => fetch(url, { signal: s }).then((r) => r.json()),
        15000
      );
      const out = json && json.responseData && json.responseData.translatedText;
      if (!out) throw new Error('MyMemory 返回为空');
      return String(out);
    },
    { onDelta, signal, concurrency: 2 }
  );

  onMeta && onMeta({ detected: from === 'auto' ? null : from });
  return {};
}

/* ------------------------------------------------------------------ */
/* Provider: OpenAI 兼容大模型（真·token 流式，质量最高，需配 key）      */
/* ------------------------------------------------------------------ */

async function runLLM({ text, from, to, onDelta, signal }) {
  const cfg = store.get('llm') || {};
  if (!cfg.apiKey) throw new Error('未配置大模型 API Key');

  const target = LLM_NAME[to] || LABEL[to] || to;
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const sys = [
    `You are a professional translator. Translate the user's text into ${target}.`,
    'Rules: output ONLY the translation, no notes or explanations.',
    'Preserve the original line breaks, list markers and formatting.',
    'Keep technical terms, product names, code identifiers and numbers unchanged when appropriate.',
  ].join(' ');

  const res = await withTimeout(
    (s) =>
      fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: s,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model || 'deepseek-chat',
          stream: true,
          temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.2,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: text },
          ],
        }),
      }),
    60000
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`大模型接口 HTTP ${res.status} ${body.slice(0, 160)}`);
  }
  if (!res.body) throw new Error('大模型接口未返回流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let acc = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        const piece = delta && delta.content;
        if (piece) {
          acc += piece;
          onDelta(piece);
        }
      } catch {
        /* 忽略不完整行 */
      }
    }
  }

  if (!acc.trim()) throw new Error('大模型返回空结果');
  return {};
}

/* ------------------------------------------------------------------ */
/* 调度                                                                */
/* ------------------------------------------------------------------ */

const PROVIDER_LABEL = { tencent: '腾讯交互翻译', llm: '大模型', mymemory: 'MyMemory' };

function buildChain() {
  const pref = store.get('provider') || 'tencent';
  const hasKey = !!store.get('llm.apiKey');
  const order = [];
  if (pref === 'llm') {
    if (hasKey) order.push('llm');
    order.push('tencent', 'mymemory');
  } else if (pref === 'mymemory') {
    order.push('mymemory', 'tencent');
  } else {
    order.push('tencent', 'mymemory');
    if (hasKey) order.push('llm');
  }
  return order;
}

const RUNNERS = { tencent: runTencent, mymemory: runMyMemory, llm: runLLM };

/**
 * 流式翻译主入口。
 * @param {{text:string, from:string, to:string, onDelta:(s:string)=>void, onMeta:(m:object)=>void, signal?:AbortSignal}} opts
 * @returns {Promise<{provider:string, detected:string|null, ms:number, text:string}>}
 */
async function translateStream({ text, from, to, onDelta, onMeta, signal }) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('没有可翻译的文本');

  const started = Date.now();
  const cached = cacheGet(clean, from, to);
  if (cached) {
    onMeta && onMeta({ provider: 'cache', cached: true, detected: null });
    onDelta(cached);
    return { provider: 'cache', detected: null, ms: Date.now() - started, text: cached };
  }

  const chain = buildChain();
  let lastError = null;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    let emitted = '';
    try {
      onMeta && onMeta({ provider, attempt: i, label: PROVIDER_LABEL[provider] || provider });
      await RUNNERS[provider]({
        text: clean,
        from,
        to,
        signal,
        onDelta: (piece) => {
          emitted += piece;
          onDelta(piece);
        },
        onMeta: (m) => onMeta && onMeta({ ...m, provider }),
      });

      const finalText = emitted.trim();
      if (!finalText) throw new Error('返回空结果');
      cacheSet(clean, from, to, finalText);
      return { provider, detected: null, ms: Date.now() - started, text: finalText };
    } catch (e) {
      lastError = e;
      log.warn(`translate via ${provider} failed:`, e.message);
      if (signal && signal.aborted) throw new Error('已取消');
      if (emitted.trim() && i < chain.length - 1) {
        onMeta && onMeta({ reset: true });
      }
    }
  }

  const err = new Error(`翻译失败：${lastError ? lastError.message : '所有通道都不可用'}`);
  err.code = 'TRANSLATE_FAILED';
  throw err;
}

module.exports = { translateStream, LANGS };
