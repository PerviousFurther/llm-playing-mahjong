import React, { useEffect, useState } from 'react';
import { Tile, Melds } from './tiles.jsx';
import { bubblePages, bubbleDuration } from '../shared/agent.js';
import { connectionLabel } from './agent-status.jsx';

const typeNames = { human: '玩家', bot: '本地牌友', llm: 'LLM', external: '外部 Agent' };
export function TurnIndicator({ state }) {
  const seat = state.turn?.discardSeat;
  if (!state.started || state.matchOver || seat == null) return null;
  const position = ['bottom', 'right', 'top', 'left'][seat];
  return <span className={`turn-indicator turn-${position}${state.paused ? ' turn-paused' : ''}`} role="img" aria-label={`等待${state.seats[seat].name}出牌`} title={`${state.seats[seat].name} · 出牌`}><span>▲</span></span>;
}
export function shapeTableTiles(surface) {
  const table = surface.getBoundingClientRect();
  if (!table.width || !table.height) return;
  const clamp = value => Math.max(-1, Math.min(1, value));
  for (const tile of surface.querySelectorAll('.tile')) {
    const box = tile.getBoundingClientRect();
    const x = clamp((box.left + box.width / 2 - table.left - table.width / 2) / (table.width / 2));
    const y = clamp((box.top + box.height / 2 - table.top - table.height / 2) / (table.height / 2));
    let angle = tile.closest('.table-hand-top, .discard-top') ? 180
      : tile.closest('.table-hand-left, .discard-left') ? 90
      : tile.closest('.table-hand-right, .discard-right') ? -90 : 0;
    if (tile.classList.contains('sideways')) angle += 90;
    const radians = angle * Math.PI / 180;
    const towardCenter = -x * 0.7, towardPlayer = 0.6 + (y + 1) * 0.25;
    const localX = towardCenter * Math.cos(radians) + towardPlayer * Math.sin(radians);
    const localY = -towardCenter * Math.sin(radians) + towardPlayer * Math.cos(radians);
    const depth = Math.min(tile.classList.contains('small') ? 5 : 9, box.width * 0.23);
    const edge = value => `${Math.max(0, value).toFixed(1)}px`;
    tile.style.setProperty('--edge-top', edge(-localY * depth));
    tile.style.setProperty('--edge-right', edge(localX * depth * 0.85));
    tile.style.setProperty('--edge-bottom', edge(localY * depth));
    tile.style.setProperty('--edge-left', edge(-localX * depth * 0.85));
    tile.style.setProperty('--shadow-x', `${(-x * 2).toFixed(1)}px`);
    tile.style.setProperty('--shadow-y', `${(4 + Math.abs(localY) * depth * 0.8).toFixed(1)}px`);
    tile.style.setProperty('--face-angle', `${(135 - x * 25).toFixed(0)}deg`);
  }
}
function characterMedia(state, seat) {
  const media = state.media.characters[seat.id];
  const image = media?.[seat.expression] || media?.idle;
  const group = image?.match(/^\/asset\/([^/]+)\//)?.[1];
  const metadata = state.media.assetMetadata?.[group] || {};
  return { image, avatar: media?.avatar || metadata.avatar, towardLeft: metadata['toward-left'] };
}
export function Character({ seat, state, position }) {
  const { image, towardLeft } = characterMedia(state, seat);
  if (!image) return null;
  const desired = position === 'right' ? true : position === 'left' ? false : towardLeft;
  return <div className={`character character-${position}`}><img src={image} alt={`${seat.name}立绘`} draggable="false" style={{ transform: typeof towardLeft === 'boolean' && desired !== towardLeft ? 'scaleX(-1)' : undefined }} /></div>;
}
export function Seat({ seat, state, position, onConfigure }) {
  const { avatar } = characterMedia(state, seat);
  const status = state.agentStatus[`player:${seat.id}`];
  const speech = state.publicEvents.findLast(e => e.type === 'chat' && e.data.seat === seat.id && e.data.target === 'public');
  const label = seat.type === 'human' ? '本机玩家' : seat.type === 'external' ? '状态未知' : seat.type === 'bot' ? '本地运行' : connectionLabel(status);
  return <section className={`seat seat-${position} ${state.activeSeat === seat.id ? 'active' : ''}`}>
    <button className="seat-identity" onClick={() => onConfigure(seat.id)} title="角色设置">
      <span className={`avatar avatar-${seat.id}`}>{avatar ? <img src={avatar} alt={seat.name} /> : seat.name.slice(0, 1)}</span>
      <span><strong>{seat.name}</strong><small>{typeNames[seat.type]}</small></span>
      <span className={`seat-connection ${status?.state === 'error' ? 'disconnected' : ''}`}><i />{label}</span>
      <span className="wind">{seat.wind}</span>
    </button>
    <div className="seat-details"><div className="seat-score">{seat.score.toLocaleString()} <span>点</span>{seat.riichi && <b className="riichi-tag">立直</b>}</div><small>{seat.handCount || 0} 张手牌 · {seat.melds.length} 组副露</small><small>{status?.state === 'thinking' ? '正在想下一步…' : state.activeSeat === seat.id ? '正在行动' : '等一等，聊一聊'}</small></div>
    <SpeechBubble event={state.replay ? speech?.id === state.replayEventId ? { ...speech, at: new Date().toISOString() } : null : speech} />
  </section>;
}
function SpeechBubble({ event }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!event) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - new Date(event.at).getTime() >= 30000) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [event?.id, event?.at]);
  if (!event) return null;
  const pages = bubblePages(event.data.text);
  const elapsed = now - new Date(event.at).getTime();
  if (!pages.length || elapsed < 0 || elapsed >= bubbleDuration(event.data.text)) return null;
  return <div className="speech-bubble" role="status">{pages[Math.min(pages.length - 1, Math.floor(elapsed / 3000))]}</div>;
}
export function TableHand({ seat, state, position }) {
  return <div className={`table-hand table-hand-${position}`}><div className="opponent-hand">{Array.from({ length: seat.handCount || (state.started ? 0 : 13) }, (_, i) => <Tile key={i} code={seat.revealed ? seat.hand[i] : '_'} drawn={i === seat.handCount - 1 && seat.drawn?.length === 2} small />)}</div><Melds values={seat.melds} /></div>;
}
export function Discards({ seat, position }) {
  return <div className={`discard-area discard-${position}`} aria-label={`${seat.name}的弃牌`}>
    <span className="discard-label">{seat.name}</span>
    <div className="discard-grid">{seat.discards.map((p, i) => <Tile key={i} code={p} small sideways={p.includes('*')} />)}</div>
  </div>;
}
export function Result({ state, onContinue }) {
  const r = state.lastResult;
  if (!r || state.matchOver) return null;
  if (r.kind === 'draw') return <div className="result"><strong>{r.name === '荒牌平局' ? '荒牌流局' : r.name}</strong><p>本局已结算，点击继续进入下一局。</p></div>;
  return <div className="result win-result"><small>和牌</small><strong>{state.seats[r.winner].name} · {r.baojia === null ? '自摸' : '荣和'}</strong><div className="winning-tile"><span>和牌张</span><Tile code={state.seats[r.winner].drawn} small /></div><p>{r.damanguan ? `${r.damanguan} 倍役满` : `${r.fanshu || 0} 番 ${r.fu || 0} 符`} · {r.defen.toLocaleString()} 点</p><small>{r.hupai?.map(y => `${y.name} ${y.fanshu}`).join(' / ')}</small></div>;
}
