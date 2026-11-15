'use strict';
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const paths = require('./paths');
const store = require('./config');
const log = require('./logger');

const PRELOAD = path.join(__dirname, '..', 'preload.js');

/** 隐藏时间戳：供主进程的定时清理判断窗口闲置多久了 */
function trackVisibility(win) {
  win.on('hide', () => {
    win.__hiddenAt = Date.now();
  });
  win.on('show', () => {
    win.__hiddenAt = null;
  });
}

/** Win11 22H2(22621) 起支持系统级亚克力背景材质 */
const BUILD = (() => {
  try {
    const v = process.getSystemVersion(); // e.g. "10.0.26100"
    return parseInt(String(v).split('.').pop(), 10) || 0;
  } catch {
    return 0;
  }
})();
const HAS_ACRYLIC = process.platform === 'win32' && BUILD >= 22621;
const SURFACE = HAS_ACRYLIC ? 'acrylic' : 'solid';

const wins = { popup: null, result: null, settings: null, overlays: [] };

function baseOptions(extra) {
  return {
    frame: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    ...(HAS_ACRYLIC ? { backgroundMaterial: 'acrylic' } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: [`--surface=${SURFACE}`],
    },
    ...extra,
  };
}

function loadPage(win, page, query) {
  const file = paths.page(page);
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log.warn(`[${page}] ${message} (${source}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => log.error(`load ${page} failed: ${desc} (${code})`));
  win.loadFile(file, query ? { query } : undefined).catch((e) => log.error(`load ${page} failed:`, e.message));
}

/* ------------------------------------------------------------------ */
/* 迷你快捷菜单（光标附近）                                             */
/* ------------------------------------------------------------------ */

const POPUP_W = 284;
const POPUP_H = 66;

function ensurePopup() {
  if (wins.popup && !wins.popup.isDestroyed()) return wins.popup;
  const win = new BrowserWindow(
    baseOptions({
      width: POPUP_W,
      height: POPUP_H,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      focusable: true,
      hasShadow: HAS_ACRYLIC,
      thickFrame: false,
    })
  );
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadPage(win, 'popup');
  win.on('blur', () => {
    if (win.__keepOpen) return;
    win.hide();
  });
  trackVisibility(win);
  win.on('closed', () => (wins.popup = null));
  wins.popup = win;
  return win;
}

/** 在光标附近弹出快捷菜单，自动避让屏幕边缘。 */
function showPopupAtCursor(payload) {
  const win = ensurePopup();

  const reveal = () => {
    if (win.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const wa = display.workArea;

    let x = Math.round(pt.x + 14);
    let y = Math.round(pt.y + 18);
    if (x + POPUP_W > wa.x + wa.width) x = Math.round(pt.x - POPUP_W - 14);
    if (y + POPUP_H > wa.y + wa.height) y = Math.round(pt.y - POPUP_H - 14);
    x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - POPUP_W - 4));
    y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - POPUP_H - 4));

    win.setBounds({ x, y, width: POPUP_W, height: POPUP_H });
    // 用 show() 而不是 showInactive()：全局快捷键触发后需要拿到键盘焦点，
    // 这样用户既能点，也能直接回车确认。
    win.show();
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.moveTop();
    win.focus();
    win.webContents.send('popup:data', payload);
    // 不给用户留一个"永远赖在屏幕上"的浮条：8 秒没动作自动收起来
    clearTimeout(win.__autoHide);
    win.__autoHide = setTimeout(() => {
      if (win.isDestroyed() || !win.isVisible()) return;
      win.hide();
      log.info('popup auto-hidden (8s idle)');
    }, 8000);
    setTimeout(() => {
      if (win.isDestroyed()) return;
      log.info(`popup shown at ${x},${y} focused=${win.isFocused()}`);
    }, 120);
    return { x, y };
  };

  // 首次弹出时渲染进程可能还没加载完，此时发过去的数据和按键都会丢
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', () => setTimeout(reveal, 40));
    return { pending: true };
  }
  return reveal();
}

function hidePopup() {
  const w = wins.popup;
  if (w && !w.isDestroyed()) w.hide();
}

/* ------------------------------------------------------------------ */
/* 区域框选遮罩                                                         */
/* ------------------------------------------------------------------ */

function closeOverlays() {
  for (const w of wins.overlays) {
    if (w && !w.isDestroyed()) w.close();
  }
  wins.overlays = [];
}

function createOverlays() {
  closeOverlays();
  const displays = screen.getAllDisplays();
  wins.overlays = displays.map((d, i) => {
    const win = new BrowserWindow(
      baseOptions({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        transparent: true,
        backgroundColor: '#00000000',
        backgroundMaterial: 'none',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        enableLargerThanScreen: true,
      })
    );
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    loadPage(win, 'overlay', { display: String(d.id), index: String(i), scale: String(d.scaleFactor) });
    win.once('ready-to-show', () => {
      win.show();
      if (i === 0) win.focus();
    });
    win.on('closed', () => {
      wins.overlays = wins.overlays.filter((x) => x !== win);
    });
    return win;
  });
  return wins.overlays.length;
}

/* ------------------------------------------------------------------ */
/* 结果窗                                                              */
/* ------------------------------------------------------------------ */

const RESULT_W = 600;
const RESULT_H = 500;

function ensureResult() {
  if (wins.result && !wins.result.isDestroyed()) return wins.result;

  const saved = store.get('resultBounds');
  const opts = baseOptions({
    width: saved?.width || RESULT_W,
    height: saved?.height || RESULT_H,
    minWidth: 420,
    minHeight: 280,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: store.get('alwaysOnTop') !== false,
    hasShadow: HAS_ACRYLIC,
  });
  if (saved?.x != null) Object.assign(opts, { x: saved.x, y: saved.y });

  const win = new BrowserWindow(opts);
  win.setAlwaysOnTop(store.get('alwaysOnTop') !== false, 'floating');
  win.setMenuBarVisibility(false);
  loadPage(win, 'result');

  trackVisibility(win);
  win.on('moved', saveResultBounds);
  win.on('resized', saveResultBounds);
  win.on('closed', () => (wins.result = null));
  wins.result = win;
  return win;
}

function saveResultBounds() {
  const w = wins.result;
  if (!w || w.isDestroyed()) return;
  const b = w.getBounds();
  if (b.width > 300 && b.height > 200) store.set({ resultBounds: b });
}

function showResult(payload) {
  const win = ensureResult();
  const place = () => {
    if (!win.isVisible() && !store.get('resultBounds')) positionResultNearCursor(win);
    win.show();
    win.focus();
    win.webContents.send('result:data', payload);
  };
  if (win.webContents.isLoading()) win.once('ready-to-show', place);
  else place();
  return win;
}

function positionResultNearCursor(win) {
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const [w, h] = win.getSize();
  let x = Math.round(pt.x - w / 2);
  let y = Math.round(pt.y - h - 24);
  if (y < wa.y + 8) y = Math.round(pt.y + 32);
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
  win.setPosition(x, y, false);
}

function setResultAlwaysOnTop(flag) {
  if (wins.result && !wins.result.isDestroyed()) win.setAlwaysOnTop(!!flag, 'floating');
}

/* ------------------------------------------------------------------ */
/* 设置窗                                                              */
/* ------------------------------------------------------------------ */

function openSettings(payload) {
  if (wins.settings && !wins.settings.isDestroyed()) {
    wins.settings.show();
    wins.settings.focus();
    if (payload) wins.settings.webContents.send('settings:data', payload);
    return wins.settings;
  }
  const win = new BrowserWindow(
    baseOptions({
      width: 620,
      height: 720,
      minWidth: 560,
      minHeight: 540,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: false,
      hasShadow: HAS_ACRYLIC,
      backgroundColor: '#00000000',
    })
  );
  win.setMenuBarVisibility(false);
  loadPage(win, 'settings');
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (payload) win.webContents.send('settings:data', payload);
  });
  win.on('closed', () => (wins.settings = null));
  wins.settings = win;
  return win;
}

function closeAll() {
  for (const key of Object.keys(wins)) {
    const v = wins[key];
    if (Array.isArray(v)) v.forEach((w) => w && !w.isDestroyed() && w.close());
    else if (v && !v.isDestroyed()) v.close();
  }
}

function broadcast(channel, data) {
  for (const key of Object.keys(wins)) {
    const v = wins[key];
    const list = Array.isArray(v) ? v : [v];
    for (const w of list) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  }
}

module.exports = {
  wins,
  SURFACE,
  HAS_ACRYLIC,
  ensurePopup,
  showPopupAtCursor,
  hidePopup,
  createOverlays,
  closeOverlays,
  ensureResult,
  showResult,
  setResultAlwaysOnTop,
  openSettings,
  closeAll,
  broadcast,
  positionResultNearCursor,
};
