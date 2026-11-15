'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');
const paths = require('./paths');
const log = require('./logger');

/** Chromium 会在 userData 下写这几个缓存目录，长期使用会慢慢变大 */
const CACHE_DIRS = ['Cache', 'GPUCache', 'Code Cache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary'];

/** 超过这个体积就在启动时清一次（清缓存只影响首屏速度，不影响功能） */
const CACHE_SOFT_LIMIT = 80 * 1024 * 1024;

function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else {
      try {
        total += fs.statSync(p).size;
      } catch {
        /* 正在被占用，忽略 */
      }
    }
  }
  return total;
}

function rmQuiet(target) {
  try {
    const st = fs.statSync(target);
    if (st.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/** 当前磁盘缓存总量（Byte） */
function cacheSize() {
  return CACHE_DIRS.reduce((sum, name) => sum + dirSize(path.join(paths.userData, name)), 0);
}

/**
 * 清掉 OCR 临时文件。
 * 正常流程用完就删，只有进程被强杀时才会残留，这里做兜底。
 */
function purgeOcrTemp(olderThanMs = 60 * 60 * 1000) {
  let count = 0;
  try {
    if (!fs.existsSync(paths.tempDir)) return 0;
    const now = Date.now();
    for (const name of fs.readdirSync(paths.tempDir)) {
      const p = path.join(paths.tempDir, name);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > olderThanMs) {
          fs.unlinkSync(p);
          count++;
        }
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    log.warn('purge ocr temp failed:', e.message);
  }
  return count;
}

/** 清掉崩溃转储 */
function purgeCrashDumps() {
  let count = 0;
  for (const sub of ['Crashpad/reports', 'Crashpad/pending', 'Crashpad/completed']) {
    const dir = path.join(paths.userData, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (rmQuiet(path.join(dir, name))) count++;
    }
  }
  return count;
}

/** 清 Chromium 磁盘 + 内存缓存（会话级，立即生效） */
async function clearChromiumCache() {
  try {
    await session.defaultSession.clearCache();
  } catch (e) {
    log.warn('clearCache failed:', e.message);
  }
  // 目录里可能还有上一次会话留下的文件，能删就删
  for (const name of CACHE_DIRS) {
    const dir = path.join(paths.userData, name);
    if (fs.existsSync(dir)) {
      for (const sub of fs.readdirSync(dir)) rmQuiet(path.join(dir, sub));
    }
  }
}

/** 设置页用的汇总信息 */
function report() {
  return {
    cacheBytes: cacheSize(),
    userDataDir: paths.userData,
    tempDir: paths.tempDir,
  };
}

/** 启动时跑一次：清残留临时文件 + 崩溃转储；缓存超阈值才清 */
async function runStartupCleanup() {
  const temp = purgeOcrTemp();
  const crash = purgeCrashDumps();
  const size = cacheSize();
  let cleared = false;
  if (size > CACHE_SOFT_LIMIT) {
    await clearChromiumCache();
    cleared = true;
  }
  log.info(
    `housekeeping: temp=${temp} crashdump=${crash} cache=${(size / 1024 / 1024).toFixed(1)}MB` +
      (cleared ? ' → 已清理' : '（未超阈值，保留以加速首屏）')
  );
}

module.exports = { runStartupCleanup, clearChromiumCache, purgeOcrTemp, cacheSize, report };
