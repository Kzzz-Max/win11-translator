'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runScript } = require('./ps');
const paths = require('./paths');
const log = require('./logger');
const store = require('./config');

let workerPromise = null;
let winLangsPromise = null;

function ensureTemp() {
  if (!fs.existsSync(paths.tempDir)) fs.mkdirSync(paths.tempDir, { recursive: true });
  return paths.tempDir;
}

/** 查询本机 Windows OCR 已安装的识别器语言（只需一次）。 */
async function getWinLangs() {
  if (!winLangsPromise) {
    winLangsPromise = (async () => {
      const r = await runScript('ocr-windows.ps1', ['-Mode', 'list'], { timeout: 10000 });
      if (r.code !== 0) return [];
      return String(r.stdout || '')
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    })();
  }
  return winLangsPromise;
}

/**
 * 选择 OCR 引擎：
 *  - windows  ：Windows.Media.Ocr，最快（~70ms），但需要系统装了对应的 OCR 语言包；
 *  - tesseract：内置 WASM 引擎 + 随包 eng.traineddata，稳定、离线、跨机器一致；
 *  - auto     ：本机若有英文 OCR 语言包就用 Windows，否则用 tesseract。
 */
async function resolveEngine() {
  const pref = store.get('ocr.engine') || 'auto';
  if (pref === 'windows') return 'windows';
  if (pref === 'tesseract') return 'tesseract';
  const langs = await getWinLangs();
  const hasEnglish = langs.some((t) => /^en(-|$)/i.test(t));
  return hasEnglish ? 'windows' : 'tesseract';
}

function preparePng(image) {
  const cfg = store.get('ocr');
  const size = image.getSize();
  let img = image;
  // 小图放大能显著提升识别率（截图选区经常只有几百像素宽）
  if (size.width < 700 && (cfg.upscale || 2) > 1) {
    img = image.resize({ width: Math.round(size.width * cfg.upscale), quality: 'best' });
  }
  return img.toPNG();
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const opts = { logger: () => {} };
      const langFile = path.join(paths.tessdata, 'eng.traineddata');
      const coreDir = path.join(paths.root, 'node_modules', 'tesseract.js-core');
      // 用随包的语言数据，避免首次识别才去 CDN 下载（离线也能用）。
      // cachePath 必须一起指向该目录：tesseract 会先读 `cachePath/xxx.traineddata`，
      // 命中后直接加载，从而完全绕开它的网络分支（否则打包后可能走到 fetch 报
      // "Only absolute URLs are supported"）。
      if (fs.existsSync(langFile)) {
        opts.langPath = paths.tessdata;
        opts.cachePath = paths.tessdata;
        opts.gzip = false;
      }
      // 不要覆盖 workerPath：Node/Electron 主进程需要用 tesseract.js 自带的 node worker，
      // 指向 dist/worker.min.js（浏览器版）会直接崩溃。
      if (fs.existsSync(coreDir)) opts.corePath = coreDir;
      const w = await createWorker('eng', 1, opts);
      log.info('tesseract worker ready');
      return w;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** 启动后预热，避免第一次截图等待引擎初始化。 */
function warmup() {
  resolveEngine()
    .then((engine) => {
      if (engine === 'tesseract') return getWorker();
      return null;
    })
    .catch((e) => log.warn('ocr warmup failed:', e.message));
}

async function recognizeTesseract(image) {
  const worker = await getWorker();
  const png = preparePng(image);
  const t0 = Date.now();
  const { data } = await worker.recognize(png);
  const text = String(data.text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return {
    text,
    confidence: Math.round(data.confidence || 0),
    engine: 'tesseract',
    ms: Date.now() - t0,
  };
}

async function recognizeWindows(image) {
  ensureTemp();
  const png = preparePng(image);
  const base = path.join(paths.tempDir, `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const imgPath = `${base}.png`;
  const outPath = `${base}.txt`;
  fs.writeFileSync(imgPath, png);

  const t0 = Date.now();
  const cfg = store.get('ocr');
  const langTag = cfg.engine === 'windows' && cfg.winLang ? cfg.winLang : 'en-US';
  const r = await runScript('ocr-windows.ps1', ['-Mode', 'ocr', '-Path', imgPath, '-OutFile', outPath, '-LangTag', langTag], {
    timeout: 20000,
  });

  let text = '';
  if (fs.existsSync(outPath)) text = fs.readFileSync(outPath, 'utf8').trim();

  try {
    fs.unlinkSync(imgPath);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  } catch {
    /* ignore */
  }

  if (r.code !== 0 && !text) {
    throw new Error(`系统 OCR 失败（${(r.stderr || '').trim().split('\n')[0] || r.code}）`);
  }
  return { text, confidence: null, engine: 'windows', ms: Date.now() - t0 };
}

/**
 * @param {Electron.NativeImage} image 裁剪后的选区图片
 * @returns {Promise<{text:string,confidence:number|null,engine:string,ms:number}>}
 */
async function recognize(image) {
  const engine = await resolveEngine();

  if (engine === 'windows') {
    try {
      const r = await recognizeWindows(image);
      if (r.text) return r;
      log.warn('windows ocr returned empty, falling back to tesseract');
    } catch (e) {
      log.warn('windows ocr failed, falling back:', e.message);
    }
  }

  const r = await recognizeTesseract(image);
  if (!r.text) {
    const err = new Error('OCR 未识别出文字，请重新框选更清晰的区域');
    err.code = 'OCR_EMPTY';
    throw err;
  }
  return r;
}

module.exports = { recognize, warmup, getWinLangs };
