import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';

function announcement(event, seats) {
  const { type, data } = event;
  const name = seats.find(s => s.wind === ['东', '南', '西', '北'][data.l])?.name || '';
  if (type === 'hand_started') return { title: '开局', detail: `${['东', '南', '西', '北'][data.round]} ${data.hand + 1} 局`, tone: 'jade' };
  if (type === 'dapai' && data.p.includes('*')) return { title: '立直', detail: name, tone: 'gold' };
  if (type === 'hule') return { title: data.baojia == null ? '自摸' : '荣和', detail: `${name} · ${data.defen.toLocaleString()} 点`, tone: 'gold' };
  if (type === 'gang') return { title: '杠', detail: name, tone: 'jade' };
  if (type === 'fulou') {
    const tiles = data.m.match(/\d/g) || [];
    return { title: tiles.length === 4 ? '杠' : new Set(tiles.map(n => n === '0' ? '5' : n)).size === 1 ? '碰' : '吃', detail: name, tone: 'jade' };
  }
  if (type === 'pingju') return { title: '流局', detail: data.name === '荒牌平局' ? '荒牌流局' : data.name, tone: 'jade' };
  return null;
}

export function GameEffects({ state, suspended }) {
  const reduce = useReducedMotion();
  const seen = useRef(state.publicEvents.at(-1)?.id || 0);
  const wasSuspended = useRef(suspended);
  const [cue, setCue] = useState(null);
  useEffect(() => {
    const events = state.publicEvents.filter(e => e.id > seen.current);
    seen.current = state.publicEvents.at(-1)?.id || 0;
    const switchingReplay = wasSuspended.current !== suspended;
    wasSuspended.current = suspended;
    if (switchingReplay || suspended || state.paused || !state.started || state.aborted) { setCue(null); return; }
    // Only announce new events, never old history after connecting or seeking a replay.
    const next = events.map(event => ({ id: event.id, ...announcement(event, state.seats) })).findLast(e => e.title);
    if (next) setCue(next);
  }, [state.publicEvents, state.paused, state.started, state.aborted, suspended]);
  useEffect(() => {
    if (!cue) return;
    const timer = setTimeout(() => setCue(null), 1700);
    return () => clearTimeout(timer);
  }, [cue]);
  return <div className="game-effects" aria-hidden="true"><AnimatePresence>
    {cue && <m.div key={cue.id} className={`game-cue cue-${cue.tone}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
      {!reduce && <div className="cue-burst">
        <m.div className="cue-ring" initial={{ scale: .25, opacity: .8 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
        {Array.from({ length: 12 }, (_, i) => <m.i key={i} className="cue-spark" initial={{ x: 0, y: 0, opacity: 0, rotate: i * 30 }} animate={{ x: Math.cos(i * Math.PI / 6) * (110 + i % 3 * 28), y: Math.sin(i * Math.PI / 6) * 75, opacity: [0, 1, 0], scale: [.5, 1, .2] }} transition={{ duration: .8, delay: i % 3 * .04, ease: 'easeOut' }} />)}
      </div>}
      <m.div className="cue-label" initial={{ scale: .65, y: 18 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 340, damping: 20 }}>
        <span className="cue-rule" /><strong>{cue.title}</strong><small>{cue.detail}</small><span className="cue-rule" />
      </m.div>
    </m.div>}
  </AnimatePresence></div>;
}
