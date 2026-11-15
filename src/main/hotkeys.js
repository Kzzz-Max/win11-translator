'use strict';
const { globalShortcut } = require('electron');
const store = require('./config');
const log = require('./logger');

const LABELS = {
  region: '截图翻译',
  selection: '划词翻译',
};

let current = { region: null, selection: null };

function isValidAccel(accel) {
  return typeof accel === 'string' && accel.trim().length > 0 && /[+A-Za-z0-9]/.test(accel);
}

/**
 * 检测某个快捷键是否可用（不会长期占用）。
 * 已被本进程注册的直接视为可用。
 */
function testAccel(accel) {
  if (!isValidAccel(accel)) return { ok: false, reason: '快捷键格式无效' };
  if (globalShortcut.isRegistered(accel)) return { ok: true };
  try {
    const ok = globalShortcut.register(accel, () => {});
    if (ok) globalShortcut.unregister(accel);
    return ok ? { ok: true } : { ok: false, reason: '已被其他程序占用' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function unregisterAll() {
  for (const action of Object.keys(current)) {
    if (current[action]) {
      try {
        globalShortcut.unregister(current[action]);
      } catch {
        /* ignore */
      }
      current[action] = null;
    }
  }
}

/**
 * 注册全局快捷键。返回 { registered, failed: [{action,accel,reason}] }
 * 冲突时不影响其它快捷键，并把失败项上报给界面（托盘气泡 + 设置页提示）。
 */
function registerAll(handlers) {
  unregisterAll();
  const cfg = store.get('hotkeys') || {};
  const failed = [];
  const registered = {};

  for (const action of Object.keys(LABELS)) {
    const accel = cfg[action];
    if (!isValidAccel(accel)) {
      failed.push({ action, accel, reason: '未配置' });
      continue;
    }
    if (globalShortcut.isRegistered(accel)) {
      failed.push({ action, accel, reason: '已被占用' });
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accel, handlers[action]);
    } catch (e) {
      log.warn(`register ${accel} failed:`, e.message);
    }
    if (ok && globalShortcut.isRegistered(accel)) {
      current[action] = accel;
      registered[action] = accel;
    } else {
      failed.push({ action, accel, reason: '已被其他程序占用' });
    }
  }

  if (failed.length) {
    log.warn('hotkey conflicts:', failed.map((f) => `${f.action}=${f.accel}(${f.reason})`).join(', '));
  }
  return { registered, failed };
}

/** 建议一个可用的替代快捷键（用于冲突后一键修复）。 */
function suggestFor(action, taken = []) {
  const pools = {
    region: ['Ctrl+Alt+S', 'Ctrl+Shift+S', 'Ctrl+Alt+F9', 'Alt+F9', 'Ctrl+Alt+9'],
    selection: ['Ctrl+Alt+W', 'Ctrl+Shift+W', 'Ctrl+Alt+F10', 'Alt+F10', 'Ctrl+Alt+0'],
  };
  const list = pools[action] || pools.region;
  for (const accel of list) {
    if (taken.includes(accel)) continue;
    if (testAccel(accel).ok) return accel;
  }
  return null;
}

module.exports = { registerAll, unregisterAll, testAccel, suggestFor, LABELS, current: () => ({ ...current }) };
