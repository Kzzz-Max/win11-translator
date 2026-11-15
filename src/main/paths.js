'use strict';
const path = require('node:path');
const { app } = require('electron');

// 项目根目录（开发态 = 仓库根；打包态 = resources/app）
const ROOT = path.resolve(__dirname, '..', '..');

const paths = {
  root: ROOT,
  renderer: path.join(ROOT, 'dist', 'renderer'),
  assets: path.join(ROOT, 'assets'),
  ps: path.join(ROOT, 'src', 'ps'),
  tessdata: path.join(ROOT, 'assets', 'tessdata'),
  userData: app.getPath('userData'),
  get config() {
    return path.join(app.getPath('userData'), 'config.json');
  },
  get logDir() {
    return path.join(app.getPath('userData'), 'logs');
  },
  get tempDir() {
    return path.join(app.getPath('temp'), 'win11-translator');
  },
  page(name) {
    return path.join(ROOT, 'dist', 'renderer', name, 'index.html');
  },
};

module.exports = paths;
