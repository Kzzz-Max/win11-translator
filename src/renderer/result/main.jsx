import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Glass, Button, IconButton, Icon, LangSelect, useCopy } from '../shared/ui';

document.body.classList.add(`surface-${window.api?.surface || 'solid'}`);

const KIND_LABEL = {
  ocr: '截图 OCR',
  selection: '选中文本',
  clipboard: '剪贴板',
  manual: '手动输入',
};

function App() {
  const [langs, setLangs] = useState([{ code: 'auto', label: '自动检测' }]);
  const [from, setFrom] = useState('auto');
  const [to, setTo] = useState('zh');
  const [sourceText, setSourceText] = useState('');
  const [translated, setTranslated] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | loading | streaming | done | error
  const [ocr, setOcr] = useState(null);
  const [kind, setKind] = useState('idle');
  const [provider, setProvider] = useState('');
  const [detected, setDetected] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);

  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const { copied, copy } = useCopy();

  const fromOptions = useMemo(
    () => langs.filter((l) => l.code === 'auto' || l.code !== to),
    [langs, to]
  );
  const toOptions = useMemo(() => langs.filter((l) => l.code !== 'auto'), [langs]);

  /* ---------------- 启动 ---------------- */
  useEffect(() => {
    let alive = true;
    window.api.invoke('app:bootstrap').then((s) => {
      if (!alive) return;
      setLangs(s.langs);
      setConfig(s.config);
      setFrom(s.config.sourceLang || 'auto');
      setTo(s.config.targetLang || 'zh');
    });
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------- 流式渲染 + 自动滚动 ---------------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [translated]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
  };

  /* ---------------- 翻译 ---------------- */
  const runTranslate = useCallback(async (text, f, t) => {
    const body = String(text || '');
    if (!body.trim()) return;
    setTranslated('');
    setError('');
    setElapsed(0);
    setProvider('');
    setPhase('loading');
    stickRef.current = true;
    const r = await window.api.invoke('translate:start', { text: body, from: f, to: t });
    if (!r.ok) {
      setPhase('error');
      setError(r.error || '翻译启动失败');
    }
  }, []);

  /* ---------------- 主进程事件 ---------------- */
  useEffect(() => {
    const offs = [
      window.api.on('result:data', (payload) => {
        if (!payload) return;
        if (payload.source === 'idle') {
          setPhase('idle');
          setKind('idle');
          setSourceText('');
          setTranslated('');
          setOcr(null);
          setError('');
          return;
        }
        if (payload.source === 'error') {
          setPhase('error');
          setError(payload.error?.message || '出错了');
          return;
        }
        setKind(payload.source);
        setSourceText(payload.sourceText || '');
        setOcr(payload.ocr || null);
        setError('');
        if (payload.autoStart) runTranslate(payload.sourceText, from, to);
      }),
      window.api.on('result:delta', ({ text }) => {
        setTranslated((prev) => prev + text);
        setPhase('streaming');
      }),
      window.api.on('result:reset', () => {
        setTranslated('');
        stickRef.current = true;
      }),
      window.api.on('result:meta', (m) => {
        if (m.label) setProvider(m.label);
        if (m.detected) setDetected(m.detected);
      }),
      window.api.on('result:done', ({ ms }) => {
        setPhase('done');
        setElapsed(ms || 0);
        stickRef.current = true;
      }),
      window.api.on('result:error', ({ message }) => {
        setPhase('error');
        setError(message || '翻译失败');
      }),
    ];
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, runTranslate]);

  /* ---------------- 快捷键 ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.api.invoke('result:hide');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------- 交互 ---------------- */
  const doSwap = () => {
    const nextFrom = to;
    const nextTo = from === 'auto' ? detected || 'en' : from;
    const finalTo = nextTo === nextFrom ? (nextFrom === 'zh' ? 'en' : 'zh') : nextTo;
    setFrom(nextFrom);
    setTo(finalTo);

    if (phase === 'done' && translated.trim()) {
      setSourceText(translated);
      setKind('manual');
      setOcr(null);
      runTranslate(translated, nextFrom, finalTo);
    } else if (sourceText.trim()) {
      runTranslate(sourceText, nextFrom, finalTo);
    }
  };

  const changeFrom = (code) => {
    setFrom(code);
    if (sourceText.trim()) runTranslate(sourceText, code, to);
  };

  const changeTo = (code) => {
    setTo(code);
    if (sourceText.trim()) runTranslate(sourceText, from, code);
  };

  const retranslate = () => {
    if (sourceText.trim()) runTranslate(sourceText, from, to);
  };

  const fromClipboard = async () => {
    const text = await window.api.invoke('clipboard:read');
    if (!text || !text.trim()) {
      setPhase('error');
      setError('剪贴板里没有文本');
      return;
    }
    setSourceText(text);
    setKind('clipboard');
    setOcr(null);
    runTranslate(text, from, to);
  };

  const onSourceKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      retranslate();
    }
  };

  const onSourceChange = (e) => {
    setSourceText(e.target.value);
    if (kind === 'idle') setKind('manual');
  };

  const togglePin = async () => {
    const next = !(config?.alwaysOnTop !== false);
    setConfig((c) => ({ ...c, alwaysOnTop: next }));
    await window.api.invoke('settings:save', { alwaysOnTop: next });
  };

  const streaming = phase === 'loading' || phase === 'streaming';
  const chars = sourceText.trim().length;

  return (
    <div className="shell">
      <div className="app-bg" />

      <header className="titlebar drag">
        <div className="title">
          <Icon.Translate />
          翻译
        </div>
        <div className="spacer" />
        <div className="actions no-drag">
          <IconButton
            icon={Icon.Pin}
            label={config?.alwaysOnTop !== false ? '取消置顶' : '窗口置顶'}
            active={config?.alwaysOnTop !== false}
            onClick={togglePin}
          />
          <IconButton icon={Icon.Gear} label="设置" onClick={() => window.api.invoke('settings:open')} />
          <IconButton icon={Icon.Close} label="关闭 (Esc)" onClick={() => window.api.invoke('result:hide')} />
        </div>
      </header>

      <div className="langbar">
        <LangSelect value={from} options={fromOptions} onChange={changeFrom} minWidth={120} />
        <IconButton icon={Icon.Swap} label="交换语言" onClick={doSwap} size={28} />
        <LangSelect value={to} options={toOptions} onChange={changeTo} minWidth={120} />
        <div style={{ flex: 1 }} />
        <IconButton icon={Icon.Refresh} label="重新翻译 (Ctrl+Enter)" onClick={retranslate} disabled={!sourceText.trim()} />
        <Button
          kind={phase === 'done' ? 'accent' : 'standard'}
          icon={copied ? Icon.Check : Icon.Copy}
          onClick={() => copy(translated)}
          disabled={!translated.trim()}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>

      {error ? (
        <div className="err-banner">
          <Icon.Bug style={{ flex: '0 0 auto', marginTop: 1 }} />
          <span className="grow">{error}</span>
          <Button kind="standard" onClick={retranslate} style={{ height: 24, padding: '0 10px' }}>
            重试
          </Button>
        </div>
      ) : null}

      <main className="body">
        <section className="pane">
          <div className="pane-head">
            <span>原文</span>
            {KIND_LABEL[kind] ? <span className="badge">{KIND_LABEL[kind]}</span> : null}
            {ocr ? (
              <span className="badge">
                OCR {ocr.confidence != null ? `${ocr.confidence}%` : '系统'} · {ocr.engine} · {ocr.ms}ms
              </span>
            ) : null}
            <span className="grow" />
            <span className="badge" style={{ background: 'transparent' }}>
              {chars ? `${chars} 字符` : ''}
            </span>
          </div>
          <Glass className="pane-card" radius={8} variant="card">
            <textarea
              className="src-input"
              value={sourceText}
              onChange={onSourceChange}
              onKeyDown={onSourceKeyDown}
              placeholder="截图、划词会自动填入；也可以直接粘贴文本后按 Ctrl+Enter 翻译"
              spellCheck={false}
            />
          </Glass>
        </section>

        <section className="pane">
          <div className="pane-head">
            <span>译文</span>
            {streaming ? <span className="badge">翻译中…</span> : null}
            <span className="grow" />
            {translated.trim() ? (
              <IconButton
                icon={copied ? Icon.Check : Icon.Copy}
                label="复制译文"
                size={22}
                onClick={() => copy(translated)}
              />
            ) : null}
          </div>
          <Glass className="pane-card" radius={8} variant="panel">
            <div className="tr-scroll" ref={scrollRef} onScroll={onScroll}>
              {translated ? (
                <div className="tr-text">
                  {translated}
                  {streaming ? <span className="caret" /> : null}
                </div>
              ) : phase === 'idle' ? (
                <div className="empty">
                  <div className="title">准备就绪</div>
                  <div className="desc">
                    <kbd>{config?.hotkeys?.region || 'Ctrl+Alt+S'}</kbd> 框选屏幕区域，或{' '}
                    <kbd>{config?.hotkeys?.selection || 'Ctrl+Alt+W'}</kbd> 取当前选中的文字。
                    结果会自动翻译成目标语言。
                  </div>
                  <div className="row">
                    <Button kind="accent" icon={Icon.Copy} onClick={fromClipboard}>
                      翻译剪贴板内容
                    </Button>
                    <Button onClick={() => window.api.invoke('settings:open')}>快捷键与设置</Button>
                  </div>
                </div>
              ) : phase === 'error' ? (
                <div className="tr-placeholder">翻译未完成，可点上方「重试」。</div>
              ) : (
                <div className="tr-placeholder">
                  <Icon.Spinner style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  正在连接翻译通道…
                </div>
              )}
            </div>
          </Glass>
        </section>
      </main>

      <footer className="statusbar">
        <span className="live">{streaming ? '● 流式输出' : phase === 'done' ? '✓ 完成' : '待机'}</span>
        {provider ? (
          <>
            <span className="dot" />
            <span>{provider}</span>
          </>
        ) : null}
        {phase === 'done' && elapsed ? (
          <>
            <span className="dot" />
            <span>{elapsed} ms</span>
          </>
        ) : null}
        <span className="grow" />
        <span>Esc 隐藏 · Ctrl+Enter 重译</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
