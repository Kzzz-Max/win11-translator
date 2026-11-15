import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Glass, Icon } from '../shared/ui';

document.body.classList.add(`surface-${window.api?.surface || 'solid'}`);

function App() {
  const [mode, setMode] = useState('ready');
  const [preview, setPreview] = useState('');
  const [chars, setChars] = useState(0);
  const [message, setMessage] = useState('');
  const firstBtn = useRef(null);

  useEffect(() => {
    const off = window.api.on('popup:data', (d) => {
      if (!d) return;
      setMode(d.mode || 'ready');
      setPreview(d.preview || '');
      setChars(d.chars || 0);
      setMessage(d.message || '');
      requestAnimationFrame(() => {
        if (d.mode !== 'error') firstBtn.current?.focus();
      });
    });
    return off;
  }, []);

  const act = (action) => window.api.send('popup:action', { action });
  const close = () => window.api.send('popup:invalid');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Enter' && mode !== 'error') {
        e.preventDefault();
        act('translate');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  return (
    <div className="shell">
      <Glass className="popup-glass" radius={8} variant="flyout">
        <div className="popup-body">
          {mode === 'error' ? (
            <div className="err">
              <Icon.Bug />
              <span className="msg">{message || '没有取到可翻译的内容'}</span>
              <button type="button" className="btn-ghost" onClick={close} style={{ height: 22, padding: '0 8px' }}>
                知道了
              </button>
            </div>
          ) : (
            <>
              <div className="preview">
                <Icon.Translate style={{ width: 12, height: 12, flex: '0 0 auto' }} />
                <span className="txt">{preview || '已取到选中文本'}</span>
                {chars ? <span className="chars">· {chars}</span> : null}
              </div>
              <div className="actions">
                <button type="button" ref={firstBtn} className="btn-translate" onClick={() => act('translate')}>
                  <Icon.Translate />
                  翻译
                </button>
                <button type="button" className="btn-ghost" onClick={() => act('copy')}>
                  <Icon.Copy />
                  复制
                </button>
                <span className="grow" />
                <button type="button" className="btn-ghost" onClick={close} title="取消 (Esc)" style={{ padding: '0 7px' }}>
                  <Icon.Close />
                </button>
              </div>
            </>
          )}
        </div>
      </Glass>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
