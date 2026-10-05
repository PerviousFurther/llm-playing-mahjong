import React, { useLayoutEffect, useRef, useState } from 'react';
import './floating-window.css';

const arrows = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

// Layout and appearance stay with the caller; all window interactions live here.
export function FloatingWindow({ as: Component = 'div', children, header, sizeKey, minWidth = 240, minHeight = 100, style, className = '', ...props }) {
  const ref = useRef(null), gesture = useRef(null), anchor = useRef(null);
  const offset = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState(offset.current), [size, setSize] = useState(null);
  const move = (x, y) => {
    const box = ref.current.getBoundingClientRect();
    const left = box.left - offset.current.x, top = box.top - offset.current.y;
    const next = { x: clamp(x, 8 - left, window.innerWidth - 8 - box.width - left), y: clamp(y, 8 - top, window.innerHeight - 8 - box.height - top) };
    if (next.x !== offset.current.x || next.y !== offset.current.y) {
      // Resize and observer callbacks can run before React commits the new position.
      ref.current.style.translate = `${next.x}px ${next.y}px`;
      offset.current = next; setPosition(next);
    }
  };
  const resize = (width, height, box = ref.current.getBoundingClientRect()) => {
    anchor.current = { left: box.left, top: box.top };
    const availableWidth = window.innerWidth - 8 - box.left, availableHeight = window.innerHeight - 8 - box.top;
    setSize({ width: clamp(width, Math.min(minWidth, availableWidth), availableWidth), height: clamp(height, Math.min(minHeight, availableHeight), availableHeight) });
  };
  useLayoutEffect(() => { setSize(null); }, [sizeKey]);
  useLayoutEffect(() => {
    if (anchor.current) {
      const box = ref.current.getBoundingClientRect(), target = anchor.current;
      anchor.current = null;
      move(offset.current.x + target.left - box.left, offset.current.y + target.top - box.top);
    }
  }, [size]);
  useLayoutEffect(() => {
    const keepVisible = () => { if (!anchor.current) move(offset.current.x, offset.current.y); };
    const observer = new ResizeObserver(keepVisible);
    observer.observe(ref.current);
    window.addEventListener('resize', keepVisible);
    return () => { observer.disconnect(); window.removeEventListener('resize', keepVisible); };
  }, []);
  const reset = () => { gesture.current = null; anchor.current = null; offset.current = { x: 0, y: 0 }; setPosition(offset.current); setSize(null); };
  const start = (e, resizing = false) => {
    if (e.button !== 0) return;
    gesture.current = { x: e.clientX, y: e.clientY, offset: offset.current, box: ref.current.getBoundingClientRect(), resizing };
    e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const keyboard = (e, resizing = false) => {
    const delta = arrows[e.key];
    if (!delta) return;
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    if (resizing) resize(box.width + delta[0], box.height + delta[1]);
    else move(offset.current.x + delta[0], offset.current.y + delta[1]);
  };
  return <Component {...props} ref={ref} className={`floating-window ${className}`} style={{ ...style, ...size, translate: `${position.x}px ${position.y}px` }}
    onPointerDown={e => {
      if (e.target.closest('.window-heading, .modal-heading') && !e.target.closest('button, input, select, textarea, a')) start(e);
    }}
    onPointerMove={e => {
      const g = gesture.current;
      if (!g) return;
      const x = e.clientX - g.x, y = e.clientY - g.y;
      if (g.resizing) resize(g.box.width + x, g.box.height + y, g.box);
      else move(g.offset.x + x, g.offset.y + y);
    }} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} onLostPointerCapture={() => { gesture.current = null; }}>
    <div className={`window-heading ${header ? '' : 'window-heading-minimal'}`}>
      <button type="button" className="window-move" aria-label="移动窗口" title="拖动或方向键移动；双击复位" onPointerDown={start} onKeyDown={keyboard} onDoubleClick={reset}>⠿</button>
      {header}
    </div>
    <div className="window-body">{children}</div>
    <button type="button" className="window-resize" aria-label="调整窗口大小" title="拖动或方向键缩放；双击复位" onPointerDown={e => start(e, true)} onKeyDown={e => keyboard(e, true)} onDoubleClick={reset}>◢</button>
  </Component>;
}
