'use strict';
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const MAX_BYTES = 512 * 1024;
let stream = null;

function ensureDir() {
  if (!fs.existsSync(paths.logDir)) fs.mkdirSync(paths.logDir, { recursive: true });
}

function rotateIfNeeded(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.1.log'));
  } catch {
    /* ignore */
  }
}

function open() {
  if (stream) return stream;
  ensureDir();
  const file = path.join(paths.logDir, 'app.log');
  rotateIfNeeded(file);
  stream = fs.createWriteStream(file, { flags: 'a' });
  return stream;
}

function fmt(level, args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const body = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
  return `${ts} [${level}] ${body}`;
}

function write(level, args) {
  const line = fmt(level, args);
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  try {
    open().write(line + '\n');
  } catch {
    /* ignore */
  }
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  get file() {
    return path.join(paths.logDir, 'app.log');
  },
};
