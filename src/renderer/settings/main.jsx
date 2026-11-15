import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Glass, Button, IconButton, Icon } from '../shared/ui';

document.body.classList.add(`surface-${window.api?.surface || 'solid'}`);

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function mergeDeep(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] ? mergeDeep(base[k], v) : v;
  }
  return out;
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const KEY_NAME = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  '+': 'Plus',
  '-': 'Minus',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '`': 'Backquote',
  '=': 'Equal',
};

function toAccelerator(e) {
  if (MODIFIER_KEYS.has(e.key) || e.key === 'Escape') return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');

  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  else key = KEY_NAME[key] || key;

  const isFn = /^F\d{1,2}$/.test(key);
  if (!parts.length && !isFn) return null;
  parts.push(key);
  return parts.join('+');
}

/* ------------------------------------------------------------------ */
/* 基础组件                                                            */
/* ------------------------------------------------------------------ */

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

function Row({ name, hint, children, stack }) {
  return (
    <div className={`row ${stack ? 'stack' : ''}`}>
      <div className="label">
        <span className="name">{name}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <>
      <div className="section-title">{title}</div>
      <Glass radius={8} variant="card" className="card">
        {children}
      </Glass>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 快捷键录入                                                          */
/* ------------------------------------------------------------------ */

function HotkeyField({ action, value, conflict, onCommit, onCaptureStart, onCaptureEnd }) {
  const [capturing, setCapturing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => setDraft(value), [value]);

  const begin = () => {
    setCapturing(true);
    onCaptureStart();
  };

  const end = (commit) => {
    setCapturing(false);
    onCaptureEnd();
    if (commit && draft && draft !== value) onCommit(draft);
  };

  const onKeyDown = (e) => {
    if (!capturing) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        begin();
      }
      return;
    }
    e.preventDefault();
    if (e.key === 'Escape') {
      setDraft(value);
      end(false);
      inputRef.current?.blur();
      return;
    }
    const accel = toAccelerator(e);
    if (!accel) return;
    setDraft(accel);
    end(true);
    inputRef.current?.blur();
  };

  return (
    <div className="control">
      <input
        ref={inputRef}
        className={`hotkey-input ${capturing ? 'is-capturing' : ''}`}
        value={capturing ? '请按下组合键…' : draft || '未设置'}
        readOnly
        onFocus={begin}
        onBlur={() => capturing && end(false)}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {conflict ? <span className="pill bad">冲突</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主界面                                                              */
/* ------------------------------------------------------------------ */

function App() {
  const [cfg, setCfg] = useState(null);
  const [langs, setLangs] = useState([]);
  const [hotkeyStatus, setHotkeyStatus] = useState({ registered: {}, failed: [] });
  const [ocrInfo, setOcrInfo] = useState(null);
  const [savedAt, setSavedAt] = useState(0);
  const [testOut, setTestOut] = useState(null);
  const [testing, setTesting] = useState(false);
  const [cache, setCache] = useState(null);

  const pending = useRef({});
  const timer = useRef(0);

  const langLabel = useMemo(() => Object.fromEntries(langs.map((l) => [l.code, l.label])), [langs]);

  useEffect(() => {
    window.api.invoke('app:bootstrap').then((s) => {
      setCfg(s.config);
      setLangs(s.langs);
      setHotkeyStatus(s.hotkeyStatus || { registered: {}, failed: [] });
    });
    window.api.invoke('settings:ocr-info').then(setOcrInfo).catch(() => {});
    window.api
      .invoke('cache:info')
      .then((r) => setCache({ ...r, mb: (r.cacheBytes / 1024 / 1024).toFixed(1) }))
      .catch(() => {});
  }, []);

  const clearCache = async () => {
    const r = await window.api.invoke('cache:clear');
    if (r?.ok) setCache({ ...r, mb: (r.cacheBytes / 1024 / 1024).toFixed(1) });
  };

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!patch || !Object.keys(patch).length) return;
    const r = await window.api.invoke('settings:save', patch);
    if (r?.hotkeyStatus) setHotkeyStatus(r.hotkeyStatus);
    setSavedAt(Date.now());
  }, []);

  const update = useCallback(
    (patch) => {
      setCfg((c) => mergeDeep(c, patch));
      pending.current = mergeDeep(pending.current, patch);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 320);
    },
    [flush]
  );

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (Object.keys(pending.current).length) {
        window.api.invoke('settings:save', pending.current);
        pending.current = {};
      }
    },
    []
  );

  const conflictFor = (action) =>
    (hotkeyStatus.failed || []).find((f) => f.action === action && f.accel === cfg?.hotkeys?.[action]);

  const commitHotkey = (action, accel) => {
    update({ hotkeys: { [action]: accel } });
  };

  const checkHotkeys = async () => {
    const r = await window.api.invoke('settings:check-hotkeys');
    setHotkeyStatus(r.hotkeyStatus);
    if (Object.keys(r.suggestion || {}).length) {
      const patch = { hotkeys: r.suggestion };
      update(patch);
      setTestOut({ ok: true, text: `已自动改用可用的组合键：${Object.entries(r.suggestion).map(([k, v]) => `${k === 'region' ? '截图' : '划词'} ${v}`).join('，')}` });
    } else {
      setTestOut({ ok: window.api && true, text: '快捷键全部注册成功，没有冲突。' });
    }
  };

  const testTranslate = async () => {
    setTesting(true);
    setTestOut(null);
    const r = await window.api.invoke('settings:test-translate', {
      text: 'The quick brown fox jumps over the lazy dog.',
      from: 'en',
      to: cfg?.targetLang || 'zh',
    });
    setTesting(false);
    setTestOut(r.ok ? { ok: true, text: `${r.text}（${r.provider} · ${r.ms}ms）` } : { ok: false, text: r.error });
  };

  if (!cfg) return <div className="shell"><div className="app-bg" /></div>;

  const providerHint = {
    tencent: '免费、无需 Key、约 150ms，默认通道',
    llm: 'OpenAI 兼容接口，真·token 流式，质量最好',
    mymemory: '仅作兜底，速度较慢，单次 500 字符限制',
  };

  return (
    <div className="shell">
      <div className="app-bg" />

      <header className="titlebar drag">
        <span className="title">设置</span>
        <div className="spacer" />
        <div className="no-drag">
          <IconButton icon={Icon.Close} label="关闭" onClick={() => window.api.invoke('settings:close')} />
        </div>
      </header>

      <div className="content">
        {/* ---------- 快捷键 ---------- */}
        <Section title="快捷键">
          <Row name="截图翻译" hint="框选屏幕区域 → OCR → 翻译">
            <HotkeyField
              action="region"
              value={cfg.hotkeys.region}
              conflict={!!conflictFor('region')}
              onCommit={(a) => commitHotkey('region', a)}
              onCaptureStart={() => window.api.invoke('hotkeys:suspend')}
              onCaptureEnd={() => window.api.invoke('hotkeys:resume')}
            />
          </Row>
          <Row name="划词翻译" hint="复制当前选中的文字 → 弹出快捷菜单">
            <HotkeyField
              action="selection"
              value={cfg.hotkeys.selection}
              conflict={!!conflictFor('selection')}
              onCommit={(a) => commitHotkey('selection', a)}
              onCaptureStart={() => window.api.invoke('hotkeys:suspend')}
              onCaptureEnd={() => window.api.invoke('hotkeys:resume')}
            />
          </Row>
          <Row name="冲突检测" hint="注册失败会列出占用项，并可一键换成可用的组合键">
            <Button onClick={checkHotkeys}>检测并修复</Button>
          </Row>
          {(hotkeyStatus.failed || []).length ? (
            <div className="note">
              {hotkeyStatus.failed.map((f) => (
                <div key={f.action}>
                  <b>{f.action === 'region' ? '截图翻译' : '划词翻译'}</b> <code>{f.accel}</code> 注册失败：{f.reason}
                </div>
              ))}
            </div>
          ) : null}
        </Section>

        {/* ---------- 翻译通道 ---------- */}
        <Section title="翻译通道">
          <Row name="默认通道" hint={providerHint[cfg.provider] || ''}>
            <select value={cfg.provider} onChange={(e) => update({ provider: e.target.value })}>
              <option value="tencent">腾讯交互翻译（推荐）</option>
              <option value="llm">大模型（OpenAI 兼容）</option>
              <option value="mymemory">MyMemory</option>
            </select>
          </Row>
          <Row name="默认目标语言">
            <select value={cfg.targetLang} onChange={(e) => update({ targetLang: e.target.value })}>
              {langs
                .filter((l) => l.code !== 'auto')
                .map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
            </select>
          </Row>
          <Row name="默认源语言">
            <select value={cfg.sourceLang} onChange={(e) => update({ sourceLang: e.target.value })}>
              {langs.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>
          <Row name="大模型 Base URL" stack hint="任意 OpenAI 兼容端点，例如 https://api.deepseek.com/v1">
            <input
              type="text"
              value={cfg.llm.baseUrl}
              onChange={(e) => update({ llm: { baseUrl: e.target.value } })}
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
            />
          </Row>
          <Row name="大模型名称" stack>
            <input
              type="text"
              value={cfg.llm.model}
              onChange={(e) => update({ llm: { model: e.target.value } })}
              spellCheck={false}
              placeholder="deepseek-chat / gpt-4o-mini"
            />
          </Row>
          <Row name="API Key" stack hint="只保存在本机 config.json，不上传任何地方">
            <input
              type="password"
              value={cfg.llm.apiKey}
              onChange={(e) => update({ llm: { apiKey: e.target.value } })}
              spellCheck={false}
              placeholder="sk-..."
            />
          </Row>
          <Row name="连通性测试" hint="用一句话跑一遍当前配置">
            <Button onClick={testTranslate} disabled={testing}>
              {testing ? '测试中…' : '测试翻译'}
            </Button>
          </Row>
          {testOut ? <div className={`test-out ${testOut.ok ? '' : 'bad'}`}>{testOut.text}</div> : null}
        </Section>

        {/* ---------- OCR ---------- */}
        <Section title="截图识别（OCR）">
          <Row
            name="识别引擎"
            hint={
              ocrInfo
                ? ocrInfo.hasEnglish
                  ? '系统英文 OCR 语言包已安装，Windows 引擎可用'
                  : '系统未安装英文 OCR 语言包，自动模式会用内置引擎'
                : '检测中…'
            }
          >
            <select value={cfg.ocr.engine} onChange={(e) => update({ ocr: { engine: e.target.value } })}>
              <option value="auto">自动</option>
              <option value="tesseract">内置引擎（Tesseract）</option>
              <option value="windows">Windows 系统 OCR</option>
            </select>
          </Row>
          <Row name="小图放大倍数" hint="截图选区较小时放大再识别，显著提升准确率">
            <select value={String(cfg.ocr.upscale)} onChange={(e) => update({ ocr: { upscale: Number(e.target.value) } })}>
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
            </select>
          </Row>
          {ocrInfo ? (
            <div className="note">
              <b>检测到系统 OCR 语言：</b>
              {ocrInfo.langs.length ? <code>{ocrInfo.langs.join(', ')}</code> : '无'}
              <br />
              如需更高精度的英文截图识别，可在「设置 → 时间和语言 → 语言和区域 → English (United States) → 语言选项 →
              可选功能」中安装「光学字符识别」。不安装也能正常使用内置引擎。
            </div>
          ) : null}
        </Section>

        {/* ---------- 外观与行为 ---------- */}
        <Section title="外观与行为">
          <Row name="窗口始终置顶" hint="翻译结果窗不会被其他窗口盖住">
            <Switch
              checked={cfg.alwaysOnTop !== false}
              onChange={(v) => update({ alwaysOnTop: v })}
              label="窗口始终置顶"
            />
          </Row>
          <Row name="复制后还原剪贴板" hint="划词取词需要占用剪贴板，开启后自动还原原内容">
            <Switch
              checked={cfg.restoreClipboard !== false}
              onChange={(v) => update({ restoreClipboard: v })}
              label="复制后还原剪贴板"
            />
          </Row>
          <Row name="开机自动启动" hint="登录 Windows 后静默进入托盘">
            <Switch checked={!!cfg.autoStart} onChange={(v) => update({ autoStart: v })} label="开机自动启动" />
          </Row>
          <Row name="主题">
            <select value={cfg.theme} onChange={(e) => update({ theme: e.target.value })}>
              <option value="system">跟随系统</option>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </Row>
        </Section>

        {/* ---------- 关于 ---------- */}
        <Section title="关于">
          <Row name="后台运行" hint="关闭窗口不会退出，程序常驻系统托盘">
            <span className="pill ok">托盘常驻</span>
          </Row>
          <Row name="数据与隐私" hint="截图与文字只发往你选择的翻译服务，本地不留存">
            <span className="pill">本地存储</span>
          </Row>
          <Row name="日志与配置">
            <Button onClick={() => window.api.invoke('settings:open-path', 'log')}>日志</Button>
            <Button onClick={() => window.api.invoke('settings:open-path', 'config')}>配置目录</Button>
          </Row>
          <Row
            name="本地缓存"
            hint="翻译缓存只在内存里，退出即消失；这里清的是浏览器内核的磁盘缓存，清完不影响功能"
          >
            <span className="pill">{cache ? `${cache.mb} MB` : '统计中…'}</span>
            <Button onClick={clearCache} disabled={!cache}>
              清理
            </Button>
          </Row>
        </Section>
      </div>

      <footer className="footer">
        <span>{savedAt ? '✓ 已自动保存' : '修改即时生效并自动保存'}</span>
        <span className="grow" />
        <span>v{cfg.version || '1.0.0'}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
