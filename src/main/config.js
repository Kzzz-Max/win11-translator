'use strict';
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');
const log = require('./logger');

const DEFAULTS = {
  // v2：把快捷键从 Alt+Shift+* 换掉——Alt+Shift 本身是 Windows 的输入法语言切换键，
  // 按住它再按字母时，注入的 Ctrl+C 容易被叠加成别的组合键（见 README「已知限制」）。
  hotkeyVersion: 2,
  hotkeys: {
    region: 'Ctrl+Alt+S',
    selection: 'Ctrl+Alt+W',
  },
  provider: 'tencent', // tencent | llm | mymemory
  llm: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.2,
  },
  sourceLang: 'auto',
  targetLang: 'zh',
  ocr: {
    engine: 'auto', // auto | tesseract | windows
    lang: 'eng',
    upscale: 2,
    minConfidence: 30,
  },
  restoreClipboard: true,
  alwaysOnTop: true,
  autoStart: false,
  theme: 'system', // system | dark | light
  keepResultOnNew: false,
  resultBounds: null,
};

function isPlain(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlain(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (isPlain(v) && isPlain(out[k])) out[k] = deepMerge(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

class Store {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(paths.config)) {
        const raw = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
        // 版本号要在合并默认值之前取：合并会把 DEFAULTS.hotkeyVersion 填进来，
        // 那样永远判断不出这是老配置。
        const rawVersion = raw.hotkeyVersion || 1;
        this.data = deepMerge(DEFAULTS, raw);
        this.migrate(rawVersion);
      }
    } catch (e) {
      log.warn('config load failed, using defaults:', e.message);
      this.data = { ...DEFAULTS };
    }
  }

  /** 老版本配置里仍是旧的默认快捷键时，自动迁到新默认值（用户自己改过的不动）。 */
  migrate(version) {
    if (version >= 2) return;
    const hk = this.data.hotkeys || {};
    if (hk.region === 'Alt+Shift+S') hk.region = DEFAULTS.hotkeys.region;
    if (hk.selection === 'Alt+Shift+D') hk.selection = DEFAULTS.hotkeys.selection;
    this.data.hotkeys = hk;
    this.data.hotkeyVersion = 2;
    log.info(`config migrated: hotkeys → ${hk.region} / ${hk.selection}`);
    this.save();
  }

  save() {
    try {
      const dir = path.dirname(paths.config);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${paths.config}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, paths.config);
    } catch (e) {
      log.error('config save failed:', e);
    }
  }

  get(key) {
    if (!key) return this.data;
    return key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), this.data);
  }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }
}

module.exports = new Store();
module.exports.DEFAULTS = DEFAULTS;
