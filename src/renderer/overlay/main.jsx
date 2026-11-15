import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MIN_SIZE = 8;

function App() {
  const [rect, setRect] = useState(null);
  const [info, setInfo] = useState(null);
  const startRef = useRef(null);
  const rectRef = useRef(null);

  useEffect(() => {
    window.api.invoke('overlay:get-display-info').then(setInfo).catch(() => {});
  }, []);

  const cancel = () => window.api.send('overlay:cancel');

  const update = (r) => {
    rectRef.current = r;
    setRect(r);
  };

  useEffect(() => {
    const onDown = (e) => {
      if (e.button === 2) {
        cancel();
        return;
      }
      if (e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      update({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    };

    const onMove = (e) => {
      const s = startRef.current;
      if (!s) return;
      update({
        x: Math.min(s.x, e.clientX),
        y: Math.min(s.y, e.clientY),
        w: Math.abs(e.clientX - s.x),
        h: Math.abs(e.clientY - s.y),
      });
    };

    const onUp = (e) => {
      if (!startRef.current) return;
      startRef.current = null;
      const r = rectRef.current;
      if (!r || r.w < MIN_SIZE || r.h < MIN_SIZE) {
        cancel();
        return;
      }
      window.api.send('overlay:select', {
        displayId: info ? info.id : null,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.w),
          height: Math.round(r.h),
        },
      });
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };

    const noMenu = (e) => e.preventDefault();

    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', noMenu);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', noMenu);
    };
  }, [info]);

  const drawing = rect && rect.w > 0 && rect.h > 0;

  return (
    <div className="stage">
      {!drawing ? <div className="mask" /> : null}
      {!drawing ? (
        <div className="hint">
          拖动鼠标框选要翻译的区域
          <kbd>Esc</kbd> 取消
        </div>
      ) : null}

      {drawing ? (
        <>
          <div className="sel" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
          {[
            [rect.x, rect.y],
            [rect.x + rect.w - 8, rect.y],
            [rect.x, rect.y + rect.h - 8],
            [rect.x + rect.w - 8, rect.y + rect.h - 8],
          ].map(([cx, cy], i) => (
            <div key={i} className="corner" style={{ left: cx, top: cy, borderWidth: 1.5 }} />
          ))}
          <div
            className="size"
            style={{
              left: Math.min(Math.max(rect.x + rect.w - 62, 8), window.innerWidth - 90),
              top: rect.y + rect.h + 8 > window.innerHeight - 26 ? rect.y - 26 : rect.y + rect.h + 8,
            }}
          >
            {Math.round(rect.w)} × {Math.round(rect.h)}
          </div>
        </>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
