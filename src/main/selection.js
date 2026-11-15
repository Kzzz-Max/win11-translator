'use strict';
const { clipboard } = require('electron');
const { runScript } = require('./ps');
const store = require('./config');
const log = require('./logger');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let captureDepth = 0;

/**
 * 取“光标选中的文本”。
 *
 * 原理：不动前台窗口焦点，只向前台程序注入一次 Ctrl+C（keybd_event），
 * 然后靠 GetClipboardSequenceNumber 的变化判断剪贴板是否真的被写入了。
 * 这样即使"选中的内容和剪贴板原有内容一样"也能正确判定，
 * 且不需要预先清空用户的剪贴板。
 *
 * 已知限制：全屏独占程序、以管理员权限运行且本程序未提权的窗口，
 * 可能收不到注入的按键（Windows UIPI 机制），此时会提示用户手动复制。
 */
async function captureSelection() {
  if (captureDepth > 0) {
    return { ok: false, code: 'busy', error: '正在取词，请稍候' };
  }
  captureDepth++;
  const prevText = clipboard.readText();
  const prevImage = clipboard.readImage();
  const hadPrev = !!(prevText && prevText.length) || !(prevImage == null || prevImage.isEmpty());

  try {
    const res = await runScript('copy-selection.ps1', [], { timeout: 6000 });
    const fg = ((/FG:(.*)/.exec(res.stdout || '') || [])[1] || '').trim();
    const seq = ((/SEQ:(.*)/.exec(res.stdout || '') || [])[1] || '').trim();
    const changed = /CHANGED:1/.test(res.stdout || '');
    log.info(`copy-selection: code=${res.code} changed=${changed} seq=${seq} foreground="${fg}"`);

    if (res.code !== 0) {
      return { ok: false, code: 'sendkeys', error: '取词失败：无法向前台窗口发送复制指令' };
    }
    if (!changed) {
      return {
        ok: false,
        code: 'noselect',
        error: '没有检测到选中的文本（目标窗口可能不支持复制，或被管理员权限隔离）',
      };
    }

    // 等剪贴板内容真正可读
    let text = '';
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      await sleep(30);
      text = clipboard.readText();
      if (text && text.trim()) break;
    }

    text = normalize(text);
    if (!text) {
      return { ok: false, code: 'empty', error: '选中的内容不是文本（可能是图片或空选区）' };
    }
    if (text.length > 8000) {
      return { ok: false, code: 'toolong', error: '选中的内容太长（超过 8000 字符），请只选需要翻译的部分' };
    }
    return { ok: true, text, restore: { text: prevText, image: hadPrev ? prevImage : null } };
  } finally {
    captureDepth--;
  }
}

/** 把取词时被覆盖的剪贴板内容还原回去。 */
function restoreClipboard(saved) {
  if (!saved || !store.get('restoreClipboard')) return;
  try {
    if (saved.image && !saved.image.isEmpty()) clipboard.writeImage(saved.image);
    else if (saved.text) clipboard.writeText(saved.text);
  } catch (e) {
    log.warn('clipboard restore failed:', e.message);
  }
}

function normalize(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

module.exports = { captureSelection, restoreClipboard };
