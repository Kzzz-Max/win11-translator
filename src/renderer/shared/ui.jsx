import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlass } from 'liquid-glass-component';

/* ==========================================================================
   液态玻璃容器
   - 基于 liquid-glass-component 的基础容器能力（LiquidGlass）
   - 参数刻意压低：scale 2~4、无 hover 形变、无 specular、无 wobble
     → 只保留极轻微的折射，视觉锚点交给 Win11 的淡亚克力 + 1px 描边
   - 若 SVG feDisplacementMap 在 Chromium 的 backdrop-filter 中不生效，
     会自动退化为「半透明叠加 + 描边 + 阴影」，文字可读性不受影响
   ========================================================================== */

const PRESETS = {
  panel: { scale: 3.2 },
  card: { scale: 2.6 },
  control: { scale: 1.8 },
  flyout: { scale: 2.2 },
};

export function Glass({
  as = 'div',
  radius = 8,
  variant = 'card',
  className = '',
  style,
  children,
  interactive = false,
  ...rest
}) {
  const preset = PRESETS[variant] || PRESETS.card;
  const wrapStyle = {
    borderRadius: radius,
    backdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturate))`,
    WebkitBackdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturate))`,
    background: 'var(--glass-tint)',
    ...style,
  };

  return (
    <div
      className={`glass-wrap ${interactive ? 'is-interactive' : ''} ${className}`}
      style={wrapStyle}
      data-variant={variant}
    >
      <LiquidGlass
        as={as}
        radius={radius}
        tint="rgba(255,255,255,0.012)"
        rim="var(--glass-rim)"
        rimWidth={1}
        blur={0}
        saturate={1}
        scale={preset.scale}
        hoverScale={preset.scale}
        frequency={2.6}
        octaves={3}
        noiseType="fbm"
        specular={false}
        animate={false}
        wobble={false}
        fullWidth
        padding="0"
        style={{ height: '100%', borderRadius: radius }}
        {...rest}
      >
        <div className="glass-inner">{children}</div>
      </LiquidGlass>
    </div>
  );
}

/* ==========================================================================
   图标
   ========================================================================== */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Icon = {
  Copy: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <rect x="5.25" y="5.25" width="8" height="8" rx="1.6" {...stroke} />
      <path d="M10.75 3.25H4.4a1.15 1.15 0 0 0-1.15 1.15v6.35" {...stroke} />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M3.25 8.5 6.5 11.75 12.75 4.75" {...stroke} />
    </svg>
  ),
  Swap: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M3.5 5.5h9l-2.4-2.4M12.5 10.5h-9l2.4 2.4" {...stroke} />
    </svg>
  ),
  Close: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
    </svg>
  ),
  Gear: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <circle cx="8" cy="8" r="2.1" {...stroke} />
      <path
        d="M8 1.9v1.5M8 12.6v1.5M2.9 8H4.4M11.6 8h1.5M4.4 4.4l1.1 1.1M10.5 10.5l1.1 1.1M11.6 4.4l-1.1 1.1M5.5 10.5l-1.1 1.1"
        {...stroke}
      />
    </svg>
  ),
  Pin: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M6 2.5h4l-.6 3.4 2.1 2.1H4.5l2.1-2.1L6 2.5Z" {...stroke} />
      <path d="M8 8v5.5" {...stroke} />
    </svg>
  ),
  Refresh: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" {...stroke} />
      <path d="M13.2 2.6v2.9h-2.9" {...stroke} />
    </svg>
  ),
  Chevron: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M4.5 6.5 8 10l3.5-3.5" {...stroke} />
    </svg>
  ),
  Translate: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M2.5 3.5h5M5 2.5v1M6.6 3.5c0 2.6-1.7 4.6-4.1 5.3" {...stroke} />
      <path d="M3.4 6.2c.8 1.5 2 2.4 3.4 2.8" {...stroke} />
      <path d="M8.4 13.5 10.9 6l2.5 7.5M9.3 11.2h3.2" {...stroke} />
    </svg>
  ),
  Bug: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" {...p}>
      <path d="M8 4.2a2.6 2.6 0 0 1 2.6 2.6v2.6a2.6 2.6 0 1 1-5.2 0V6.8A2.6 2.6 0 0 1 8 4.2Z" {...stroke} />
      <path d="M5.4 7.2H3.2M12.8 7.2h-2.2M5.6 10.2l-1.8 1.4M10.4 10.2l1.8 1.4M8 4.2V2.6" {...stroke} />
    </svg>
  ),
  Spinner: (p) => (
    <svg viewBox="0 0 16 16" width="16" height="16" className="spin" {...p}>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.22" />
      <path d="M8 2.4a5.6 5.6 0 0 1 5.6 5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

/* ==========================================================================
   按钮
   ========================================================================== */

export function IconButton({ icon, label, onClick, active, size = 28, radius = 4, disabled }) {
  const Comp = icon;
  return (
    <Tip text={label}>
      <button
        type="button"
        className={`icon-btn ${active ? 'is-active' : ''}`}
        style={{ width: size, height: size, borderRadius: radius }}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        <Comp />
      </button>
    </Tip>
  );
}

export function Button({ children, onClick, kind = 'standard', radius = 4, disabled, style, icon }) {
  const Comp = icon;
  return (
    <button
      type="button"
      className={`btn btn-${kind}`}
      style={{ borderRadius: radius, ...style }}
      onClick={onClick}
      disabled={disabled}
    >
      {Comp ? <Comp /> : null}
      {children}
    </button>
  );
}

/* ==========================================================================
   悬浮提示（玻璃）
   ========================================================================== */

export function Tip({ text, children, placement = 'top' }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const timer = useRef(0);

  const open = () => {
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        x: r.left + r.width / 2,
        y: placement === 'top' ? r.top - 8 : r.bottom + 8,
      });
      setShow(true);
    }, 380);
  };

  const close = () => {
    clearTimeout(timer.current);
    setShow(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <span ref={ref} onMouseEnter={open} onMouseLeave={close} onMouseDown={close} style={{ display: 'inline-flex' }}>
        {children}
      </span>
      {show && pos
        ? createPortal(
            <div
              className="tip-layer"
              style={{
                left: pos.x,
                top: pos.y,
                transform: `translate(-50%, ${placement === 'top' ? '-100%' : '0'})`,
              }}
            >
              <Glass radius={4} variant="flyout" className="tip-body">
                <span>{text}</span>
              </Glass>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* ==========================================================================
   语言选择控件
   ========================================================================== */

export function LangSelect({ value, options, onChange, disabled, align = 'left', minWidth = 132 }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(-1);
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  const current = options.find((o) => o.code === value) || options[0] || { code: value, label: '—' };

  const toggle = () => {
    if (disabled) return;
    const r = btnRef.current.getBoundingClientRect();
    const estH = Math.min(options.length, 8) * 32 + 12;
    const below = window.innerHeight - r.bottom;
    const top = below > estH || r.top < estH ? r.bottom + 4 : r.top - estH - 4;
    setPos({ left: align === 'right' ? r.right - minWidth : r.left, top, width: minWidth });
    setOpen((v) => !v);
    setHover(options.findIndex((o) => o.code === value));
  };

  useLayoutEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (!e.target.closest('.lang-flyout') && !e.target.closest('.lang-trigger')) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const pick = (code) => {
    setOpen(false);
    if (code !== value) onChange(code);
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHover((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHover((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hover >= 0) pick(options[hover].code);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="lang-trigger"
        style={{ minWidth, borderRadius: 4 }}
        onClick={toggle}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-label">{current.label}</span>
        <Icon.Chevron className="lang-chevron" />
      </button>

      {open
        ? createPortal(
            <div className="lang-flyout" style={{ left: pos.left, top: pos.top, width: pos.width }}>
              <Glass radius={8} variant="flyout" className="lang-panel" style={{ boxShadow: 'var(--shadow-flyout)' }}>
                <div role="listbox" className="lang-list">
                  {options.map((o, i) => (
                    <button
                      key={o.code}
                      type="button"
                      role="option"
                      aria-selected={o.code === value}
                      className={`lang-item ${o.code === value ? 'is-selected' : ''} ${i === hover ? 'is-hover' : ''}`}
                      style={{ borderRadius: 4 }}
                      onMouseEnter={() => setHover(i)}
                      onClick={() => pick(o.code)}
                    >
                      {o.label}
                      {o.code === value ? <Icon.Check /> : null}
                    </button>
                  ))}
                </div>
              </Glass>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* ==========================================================================
   工具 hook
   ========================================================================== */

export function useCopy(timeout = 1300) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const copy = useCallback(
    async (text) => {
      if (!text) return false;
      await window.api.invoke('clipboard:write', text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), timeout);
      return true;
    },
    [timeout]
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { copied, copy };
}
