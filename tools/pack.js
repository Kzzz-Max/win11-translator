'use strict';
/**
 * 免安装（portable）打包：把 Electron 运行时 + 应用代码放进 release/Win11Translator。
 * 用法：node tools/pack.js
 *
 * 原理：Electron 的可执行文件改名后仍会到同目录的 resources/app 下找应用，
 * 所以不需要 electron-builder，也不需要联网签名工具。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'release');
const DIST = path.join(OUT, 'Win11Translator');
const APP = path.join(DIST, 'resources', 'app');

const EXCLUDE_MODULES = new Set([
  '.bin',
  'electron',
  'esbuild',
  '@esbuild',
  '@types',
  'cross-env',
  'cross-spawn',
  'path-key',
  'shebang-command',
  'shebang-regex',
]);

function log(...a) {
  console.log('[pack]', ...a);
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else {
      try {
        fs.copyFileSync(s, d);
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          log(`跳过被占用的文件 ${entry.name}（先退出正在运行的程序再打包）`);
        } else {
          throw e;
        }
      }
    }
  }
}

function main() {
  const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronDist)) {
    console.error('找不到 Electron 运行时，请先 npm install');
    process.exit(1);
  }

  log('清理 release/');
  if (fs.existsSync(OUT)) {
    try {
      fs.rmSync(OUT, { recursive: true, force: true });
    } catch (e) {
      // 目录被占用/被安全软件锁定时无法删除，直接覆盖写入即可
      log('无法删除旧目录，改为覆盖写入（' + e.code + '）');
    }
  }

  log('复制 Electron 运行时');
  copyDir(electronDist, DIST);

  log('复制应用代码');
  fs.mkdirSync(APP, { recursive: true });
  for (const item of ['package.json', 'src', 'dist', 'assets']) {
    const s = path.join(ROOT, item);
    if (!fs.existsSync(s)) continue;
    if (fs.statSync(s).isDirectory()) copyDir(s, path.join(APP, item));
    else fs.copyFileSync(s, path.join(APP, item));
  }

  log('复制运行时依赖（跳过 electron / 构建工具）');
  copyDir(path.join(ROOT, 'node_modules'), path.join(APP, 'node_modules'), (name) => !EXCLUDE_MODULES.has(name));

  // 改名成产品名
  const from = path.join(DIST, 'electron.exe');
  const to = path.join(DIST, 'Win11Translator.exe');
  if (fs.existsSync(from)) fs.renameSync(from, to);

  const size = (dir) => {
    let total = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? size(p) : fs.statSync(p).size;
    }
    return total;
  };

  log(`完成 → ${DIST}`);
  log(`体积 ${(size(DIST) / 1024 / 1024).toFixed(1)} MB`);
  log(`启动：双击 ${to}`);
}

main();
