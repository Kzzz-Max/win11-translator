'use strict';
const path = require('node:path');
const {
  app,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  screen,
  desktopCapturer,
  nativeImage,
  nativeTheme,
  shell,
} = require('electron');

const paths = require('./paths');
const store = require('./config');
const log = require('./logger');
const windows = require('./windows');
const housekeeping = require('./housekeeping');
const hotkeys = require('./hotkeys');
const selection = require('./selection');
const ocr = require('./ocr');
const { translateStream, LANGS } = require('./translate');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tray = null;
let pending = null; // { text, source }
let hotkeyStatus = { registered: {}, failed: [] };
let currentJob = null; // { id, controller }
let jobSeq = 0;

/* ------------------------------------------------------------------ */
/* 单实例                                                              */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windows.showResult({ source: 'idle' });
  });
}

app.setAppUserModelId('com.k.win11translator');

// 给 Chromium 磁盘缓存一个硬上限，避免长期使用无限增长
app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024));

/* ------------------------------------------------------------------ */
/* 托盘                                                                */
/* ------------------------------------------------------------------ */

function trayIcon() {
  const p = path.join(paths.assets, 'tray.png');
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) {
    // 兜底：1x1 透明图，避免 Tray 创建失败
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVQ4jWNgYGD4z0AswK4YXzGuYnzFuIoBAF0kBAF7o1Z8AAAAAElFTkSuQmCC'
    );
  }
  return img.resize({ width: 16, height: 16 });
}

function buildTrayMenu() {
  const hk = hotkeys.current();
  const alwaysOnTop = store.get('alwaysOnTop') !== false;
  const autoStart = app.getLoginItemSettings().openAtLogin;

  return Menu.buildFromTemplate([
    {
      label: `截图翻译\t${hk.region || '未设置'}`,
      click: () => runRegionFlow(),
    },
    {
      label: `划词翻译\t${hk.selection || '未设置'}`,
      click: () => runSelectionFlow(),
    },
    { type: 'separator' },
    {
      label: '显示翻译窗口',
      click: () => windows.showResult({ source: 'idle' }),
    },
    {
      label: '设置…',
      click: () => windows.openSettings({ hotkeyStatus }),
    },
    { type: 'separator' },
    {
      label: '窗口始终置顶',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        store.set({ alwaysOnTop: item.checked });
        windows.setResultAlwaysOnTop(item.checked);
        refreshTray();
      },
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autoStart,
      click: (item) => toggleAutoStart(item.checked),
    },
    { type: 'separator' },
    { label: '打开日志目录', click: () => shell.openPath(paths.logDir) },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip('Win11 翻译 · 后台常驻');
}

function createTray() {
  tray = new Tray(trayIcon());
  refreshTray();
  tray.on('click', () => windows.showResult({ source: 'idle' }));
  tray.on('double-click', () => windows.openSettings({ hotkeyStatus }));
}

function notify(title, content) {
  log.info(`notify: ${title} - ${content}`);
  if (tray) {
    try {
      tray.displayBalloon({ title, content, icon: trayIcon() });
    } catch {
      /* ignore */
    }
  }
}

function toggleAutoStart(flag) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!flag,
      path: process.execPath,
      args: app.isPackaged ? [] : [paths.root],
    });
    store.set({ autoStart: !!flag });
  } catch (e) {
    log.error('setLoginItemSettings failed:', e);
    notify('设置开机启动失败', e.message);
  }
  refreshTray();
}

/* ------------------------------------------------------------------ */
/* 截图与 OCR                                                          */
/* ------------------------------------------------------------------ */

async function captureRegion(displayId, rect) {
  const display = screen.getAllDisplays().find((d) => String(d.id) === String(displayId)) ||
    screen.getPrimaryDisplay();

  const targetW = Math.round(display.size.width * display.scaleFactor);
  const targetH = Math.round(display.size.height * display.scaleFactor);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetW, height: targetH },
    fetchWindowIcons: false,
  });

  const src = sources.find((s) => String(s.display_id) === String(displayId)) || sources[0];
  if (!src) throw new Error('无法获取屏幕画面');

  const image = src.thumbnail;
  const size = image.getSize();
  const ratio = size.width / display.bounds.width || 1;

  const x = Math.max(0, Math.round(rect.x * ratio));
  const y = Math.max(0, Math.round(rect.y * ratio));
  const width = Math.min(Math.round(rect.width * ratio), size.width - x);
  const height = Math.min(Math.round(rect.height * ratio), size.height - y);

  if (width < 8 || height < 8) throw new Error('框选区域太小');

  return image.crop({ x, y, width, height });
}

/* ------------------------------------------------------------------ */
/* 空闲回收                                                            */
/* ------------------------------------------------------------------ */

let idleSweep = null;

/**
 * 空闲回收：每 30 秒扫一次，把「已经隐藏超过 90 秒」的结果窗/快捷菜单直接销毁，
 * 渲染进程随之退出，回到只有托盘的 ~200MB 占用。下次触发会重建（约 300ms）。
 */
function startIdleSweep() {
  clearInterval(idleSweep);
  idleSweep = setInterval(() => {
    const now = Date.now();
    for (const key of ['result', 'popup']) {
      const w = windows.wins[key];
      if (!w || w.isDestroyed()) continue;
      if (!w.isVisible() && w.__hiddenAt && now - w.__hiddenAt > 90_000) {
        w.destroy();
        log.info(`idle recycle: ${key} window destroyed (hidden ${Math.round((now - w.__hiddenAt) / 1000)}s)`);
      }
    }
  }, 30_000);
  idleSweep.unref?.();
}

/* ------------------------------------------------------------------ */
/* 业务流程                                                            */
/* ------------------------------------------------------------------ */

async function runRegionFlow() {
  windows.hidePopup();
  // 截图前顺手把 OCR 引擎热起来：用户拖框的 1 秒左右刚好够初始化，等于不花钱
  ocr.warmup();
  const n = windows.createOverlays();
  log.info(`region flow: overlays=${n}`);
  if (!n) notify('截图翻译', '无法创建框选遮罩，请检查显示设置');
}

async function runSelectionFlow() {
  windows.hidePopup();
  const t0 = Date.now();
  const res = await selection.captureSelection();
  log.info(`selection flow: ok=${res.ok} ${res.ok ? `${res.text.length} chars` : res.error} in ${Date.now() - t0}ms`);
  if (!res.ok) {
    pending = null;
    windows.showPopupAtCursor({ mode: 'error', message: res.error });
    return;
  }
  pending = { text: res.text, source: 'selection' };
  // 文字已经在手里了，立刻把用户的剪贴板还原，不占着不放
  selection.restoreClipboard(res.restore);
  const preview = res.text.replace(/\s+/g, ' ').slice(0, 90);
  windows.showPopupAtCursor({
    mode: 'ready',
    preview,
    chars: res.text.length,
    external: true,
  });
}

function startTranslateJob({ text, from, to, targetWin }) {
  if (currentJob) {
    try {
      currentJob.controller.abort();
    } catch {
      /* ignore */
    }
  }
  const id = ++jobSeq;
  const controller = new AbortController();
  currentJob = { id, controller };
  const win = targetWin || windows.wins.result;
  const send = (ch, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(ch, { id, ...data });
  };

  translateStream({
    text,
    from,
    to,
    signal: controller.signal,
    onDelta: (piece) => send('result:delta', { text: piece }),
    onMeta: (m) => {
      if (m.reset) send('result:reset', {});
      send('result:meta', m);
    },
  })
    .then((r) => {
      if (currentJob && currentJob.id === id) currentJob = null;
      log.info(`translate done: job=${id} provider=${r.provider} ms=${r.ms} chars=${r.text.length}`);
      send('result:done', { ms: r.ms, provider: r.provider });
    })
    .catch((e) => {
      if (currentJob && currentJob.id === id) currentJob = null;
      log.warn(`translate failed: job=${id} ${e.message}`);
      send('result:error', { message: e.message });
    });

  return id;
}

function showResultWindow(payload) {
  windows.showResult(payload);
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  /* --- 启动时拉取整体状态 --- */
  ipcMain.handle('app:bootstrap', () => ({
    config: store.get(),
    langs: LANGS,
    surface: windows.SURFACE,
    hasAcrylic: windows.HAS_ACRYLIC,
    hotkeyStatus,
    version: app.getVersion(),
    paths: { log: log.file, config: paths.config },
    ocrEngines: null,
  }));

  /* --- 结果窗：开始翻译 --- */
  ipcMain.handle('translate:start', (e, { text, from, to }) => {
    if (!text || !String(text).trim()) return { ok: false, error: '没有可翻译的内容' };
    const win = windows.wins.result;
    const id = startTranslateJob({ text: String(text), from, to, targetWin: win });
    return { ok: true, id };
  });

  ipcMain.handle('translate:cancel', () => {
    if (currentJob) {
      currentJob.controller.abort();
      currentJob = null;
    }
    return { ok: true };
  });

  /* --- 结果窗：复制 --- */
  ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());

  /* --- 结果窗控制 --- */
  ipcMain.handle('result:hide', () => {
    const w = windows.wins.result;
    if (w && !w.isDestroyed()) w.hide();
    return { ok: true };
  });

  ipcMain.handle('result:minimize', () => {
    const w = windows.wins.result;
    if (w && !w.isDestroyed()) w.minimize();
    return { ok: true };
  });

  ipcMain.handle('window:drag', (e, { dx, dy }) => {
    const win = require('electron').BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
    return { ok: true };
  });

  /* --- 快捷菜单 --- */
  ipcMain.on('popup:action', async (_e, { action }) => {
    log.info(`popup action: ${action} pending=${pending ? pending.text.length : 0}`);
    windows.hidePopup();
    if (action === 'translate') {
      if (!pending) return;
      const text = pending.text;
      const source = pending.source;
      pending = null;
      showResultWindow({ source, sourceText: text, autoStart: true });
    } else if (action === 'copy') {
      if (pending) clipboard.writeText(pending.text);
      pending = null;
    }
  });

  ipcMain.on('popup:invalid', () => {
    pending = null;
    windows.hidePopup();
  });

  /* --- 框选遮罩 --- */
  ipcMain.on('overlay:cancel', () => {
    windows.closeOverlays();
  });

  ipcMain.on('overlay:select', async (_e, { displayId, rect }) => {
    windows.closeOverlays();
    log.info(`overlay select: display=${displayId} rect=${JSON.stringify(rect)}`);
    // 等遮罩真正消失再截图，否则会把蒙层一起截进去
    await sleep(120);
    let image;
    try {
      image = await captureRegion(displayId, rect);
    } catch (e) {
      log.warn('capture region failed:', e.message);
      showResultWindow({ source: 'error', error: { message: e.message, phase: 'capture' } });
      return;
    }
    showResultWindow({ source: 'ocr', sourceImage: image.toDataURL(), ocrLoading: true });

    try {
      const result = await ocr.recognize(image);
      log.info(`ocr done: engine=${result.engine} conf=${result.confidence} ms=${result.ms} chars=${result.text.length}`);
      const win = windows.wins.result;
      if (!win || win.isDestroyed()) return;
      win.webContents.send('result:data', {
        source: 'ocr',
        sourceText: result.text,
        ocr: {
          confidence: result.confidence,
          engine: result.engine,
          ms: result.ms,
        },
        autoStart: true,
      });
    } catch (e) {
      const win = windows.wins.result;
      if (win && !win.isDestroyed()) {
        win.webContents.send('result:data', {
          source: 'error',
          error: { message: e.message, phase: 'ocr' },
        });
      }
    }
  });

  /* --- 设置 --- */
  ipcMain.handle('settings:save', (_e, patch) => {
    const before = JSON.stringify(store.get('hotkeys'));
    store.set(patch);

    if (JSON.stringify(store.get('hotkeys')) !== before) {
      hotkeyStatus = hotkeys.registerAll(actionHandlers());
      refreshTray();
    }
    if (patch.theme) nativeTheme.themeSource = store.get('theme');
    if (patch.alwaysOnTop !== undefined) {
      windows.setResultAlwaysOnTop(store.get('alwaysOnTop'));
      refreshTray();
    }
    if (patch.autoStart !== undefined) toggleAutoStart(store.get('autoStart'));

    return { ok: true, config: store.get(), hotkeyStatus };
  });

  ipcMain.handle('settings:test-hotkey', (_e, { action, accel }) => {
    const cur = hotkeys.current()[action];
    if (cur === accel) return { ok: true, same: true };
    const r = hotkeys.testAccel(accel);
    if (!r.ok) {
      const suggestion = hotkeys.suggestFor(action, [accel]);
      return { ok: false, reason: r.reason, suggestion };
    }
    return { ok: true };
  });

  ipcMain.handle('settings:check-hotkeys', () => {
    hotkeyStatus = hotkeys.registerAll(actionHandlers());
    refreshTray();
    const fixed = {};
    for (const f of hotkeyStatus.failed) {
      const s = hotkeys.suggestFor(f.action, [f.accel]);
      if (s) fixed[f.action] = s;
    }
    return { hotkeyStatus, suggestion: fixed };
  });

  ipcMain.handle('settings:test-translate', async (_e, { text, from, to }) => {
    const started = Date.now();
    let out = '';
    let provider = '';
    try {
      const r = await translateStream({
        text: text || 'Hello, world.',
        from: from || 'auto',
        to: to || 'zh',
        onDelta: (s) => (out += s),
        onMeta: (m) => {
          if (m.provider) provider = m.provider;
        },
      });
      return { ok: true, text: out.trim(), provider: r.provider, ms: Date.now() - started };
    } catch (e) {
      return { ok: false, error: e.message, ms: Date.now() - started };
    }
  });

  ipcMain.handle('settings:ocr-info', async () => {
    const langs = await ocr.getWinLangs();
    return {
      hasEnglish: langs.some((t) => /^en(-|$)/i.test(t)),
      langs,
      build: process.getSystemVersion(),
      acrylic: windows.HAS_ACRYLIC,
    };
  });

  ipcMain.handle('settings:open-external', (_e, url) => shell.openExternal(url));

  ipcMain.handle('cache:info', () => housekeeping.report());

  ipcMain.handle('cache:clear', async () => {
    await housekeeping.clearChromiumCache();
    housekeeping.purgeOcrTemp(0);
    const info = housekeeping.report();
    log.info(`cache cleared → ${(info.cacheBytes / 1024 / 1024).toFixed(1)}MB`);
    return { ok: true, ...info };
  });

  ipcMain.handle('settings:open', () => {
    windows.openSettings({ hotkeyStatus });
    return { ok: true };
  });

  ipcMain.handle('settings:close', () => {
    const w = windows.wins.settings;
    if (w && !w.isDestroyed()) w.close();
    return { ok: true };
  });

  ipcMain.handle('hotkeys:suspend', () => {
    hotkeys.unregisterAll();
    return { ok: true };
  });

  ipcMain.handle('hotkeys:resume', () => {
    hotkeyStatus = hotkeys.registerAll(actionHandlers());
    refreshTray();
    return { ok: true, hotkeyStatus };
  });

  ipcMain.handle('settings:open-path', (_e, which) => {    const target =
      which === 'config'
        ? require('node:path').dirname(paths.config)
        : which === 'log'
          ? paths.logDir
          : String(which || '');
    return shell.openPath(target);
  });

  ipcMain.handle('overlay:get-display-info', (e) => {
    const win = require('electron').BrowserWindow.fromWebContents(e.sender);
    const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    return {
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      id: String(display.id),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

function actionHandlers() {
  return {
    region: () => runRegionFlow(),
    selection: () => runSelectionFlow(),
  };
}

if (gotLock) {
  app.whenReady().then(async () => {
  log.info(`app start v${app.getVersion()} surface=${windows.SURFACE} build=${process.getSystemVersion()}`);

  nativeTheme.themeSource = store.get('theme') || 'system';

  createTray();
  registerIpc();
  hotkeyStatus = hotkeys.registerAll(actionHandlers());
  refreshTray();

  // 同步开机自启的真实状态
  try {
    const real = app.getLoginItemSettings().openAtLogin;
    if (real !== store.get('autoStart')) store.set({ autoStart: real });
  } catch {
    /* ignore */
  }

  // 不预热任何窗口：托盘常驻时只留主进程，空闲内存压到最低。
  // 结果窗/快捷菜单按需创建，隐藏 90 秒后自动销毁回收内存。
  startIdleSweep();

  // 清理上次运行留下的 OCR 临时文件 / 崩溃转储；缓存超过阈值才清
  housekeeping.runStartupCleanup().catch((e) => log.warn('housekeeping failed:', e.message));
  // 之后每次启动再补一次，防止长时间不退出时临时文件堆积
  setInterval(() => housekeeping.purgeOcrTemp(), 30 * 60 * 1000).unref?.();

  // OCR 引擎改为「第一次截图时预热」，托盘空转时不再常驻一个 WASM worker（省 ~80MB）

  if (hotkeyStatus.failed.length) {
    const first = hotkeyStatus.failed[0];
    notify(
      '快捷键冲突',
      `${first.accel} 已被其他程序占用（${hotkeys.LABELS[first.action]}）。请在设置里换一个组合键。`
    );
  }

  // 首次启动给出引导
  if (!store.get('onboarded')) {
    store.set({ onboarded: true });
    windows.openSettings({ firstRun: true, hotkeyStatus });
  }
  });
}

app.on('window-all-closed', () => {
  // 后台常驻：窗口全关也不退出，靠托盘菜单退出
});

app.on('before-quit', () => {
  app.isQuitting = true;
  hotkeys.unregisterAll();
});

app.on('will-quit', () => {
  hotkeys.unregisterAll();
});

app.on('activate', () => {
  windows.showResult({ source: 'idle' });
});

process.on('uncaughtException', (e) => log.error('uncaught:', e));
process.on('unhandledRejection', (e) => log.error('unhandled rejection:', e));

module.exports = {};
