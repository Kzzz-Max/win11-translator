'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const paths = require('./paths');
const log = require('./logger');

/**
 * 以子进程方式调用 src/ps 下的 PowerShell 脚本。
 * 使用 -ExecutionPolicy Bypass 绕过默认 Restricted 策略（本机实测默认策略为 Restricted）。
 * 脚本内部统一把 OutputEncoding 设为 UTF-8，避免 GBK 代码页把非 ASCII 打乱。
 */
function runScript(name, args = [], opts = {}) {
  const { timeout = 15000, input } = opts;
  const script = path.join(paths.ps, name);
  const argv = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
    ...args.map((a) => String(a)),
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    const child = spawn('powershell.exe', argv, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        log.warn(`powershell timeout: ${name}`);
        resolve({ code: -1, stdout, stderr: stderr + '\n[timeout]' });
      }
    }, timeout);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: -2, stdout, stderr: e.message });
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) log.warn(`powershell ${name} exit=${code}: ${stderr.trim().slice(0, 400)}`);
      resolve({ code: code == null ? -3 : code, stdout, stderr });
    });

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

module.exports = { runScript };
