import React, { useEffect, useRef, useState } from 'react';
import { createTableRenderer } from './table-renderer.js';
import { handAction } from './table-layout.js';
import { tileName } from '../shared/tiles.js';
import './three-table.css';

export function ThreeTable({ state, riichiMode, onAction, onHover, children }) {
  const host = useRef(null), renderer = useRef(null);
  const latest = useRef({ state, riichiMode, onAction, onHover });
  latest.current = { state, riichiMode, onAction, onHover };
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    try {
      renderer.current = createTableRenderer(host.current, {
        onAction: action => latest.current.onAction(action),
        onHover: code => latest.current.onHover(code), onError: setError,
      });
      renderer.current.update(latest.current.state, latest.current.riichiMode);
    } catch (e) { setError(`无法创建 3D 牌桌：${e.message}`); }
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, [attempt]);
  useEffect(() => { renderer.current?.update(state, riichiMode); }, [state, riichiMode]);
  return <div ref={host} className="three-table" role="group" aria-label="3D 麻将牌桌">
    {children}
    <div className="keyboard-hand" aria-label="手牌操作">{state.seats[0].hand.map((code, index) => {
      const action = handAction(state, index, riichiMode);
      return <button key={index} disabled={!action} onFocus={() => renderer.current?.focus(index)} onBlur={() => renderer.current?.focus(null)} onClick={() => action && onAction(action)}>{tileName(code)} · {riichiMode ? '立直打出' : '打出'}</button>;
    })}</div>
    {error && <div className="three-error" role="alert"><span>{error}</span><button className="secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重试</button></div>}
  </div>;
}
