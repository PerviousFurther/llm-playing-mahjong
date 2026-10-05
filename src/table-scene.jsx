import { FloatingWindow } from './floating-window.jsx';
import React, { useEffect, useState } from 'react';
import { m } from 'motion/react';
import { Tile } from './tiles.jsx';
import { bubblePages, bubbleDuration } from '../shared/agent.js';
import { connectionLabel, activityLabel } from './agent-status.jsx';

const typeNames = { human: '玩家', bot: '本地牌友', llm: 'LLM' };
export function TurnIndicator({ state }) {
  const seat = state.turn?.discardSeat;
  if (!state.started || state.matchOver || seat == null) return null;
  const position = ['bottom', 'right', 'top', 'left'][seat];
  return <span className={`turn-indicator turn-${position}${state.paused ? ' turn-paused' : ''}`} role="img" aria-label={`等待${state.seats[seat].name}出牌`} title={`${state.seats[seat].name} · 出牌`}><span><m.span key={seat} style={{ display: 'inline-block' }} initial={{ opacity: 0, scale: .4 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>▲</m.span></span></span>;
}
function characterMedia(state, seat) {
  const media = state.media.characters[seat.id];
  const speech = state.replay && state.publicEvents.find(e => e.id === state.replayEventId && e.type === 'chat' && e.data.seat === seat.id);
  const expression = state.replay ? speech?.data.expression || 'idle' : seat.expression;
  const image = media?.[expression] || media?.idle;
  const group = image?.match(/^\/asset\/([^/]+)\//)?.[1];
  const metadata = state.media.assetMetadata?.[group] || {};
  const accent = { deepseek: '#94b4ff', gpt: '#c8b1f6', 'gpt-mint': '#82ddbd', qwen: '#a0d4ff', robot: '#efc788' }[group] || ['#efc788', '#82ddbd', '#c8b1f6', '#94b4ff'][seat.id];
  return { image, avatar: media?.avatar || metadata.avatar, towardLeft: metadata['toward-left'], accent };
}
export function Character({ seat, state, position }) {
  const { image, towardLeft } = characterMedia(state, seat);
  if (!image) return null;
  const desired = position === 'right' ? true : position === 'left' ? false : towardLeft;
  return <div className={`character character-${position}`}><m.img key={image} initial={{ opacity: .3 }} animate={{ opacity: 1 }} transition={{ duration: .35 }} src={image} alt={`${seat.name}立绘`} draggable="false" style={{ transform: typeof towardLeft === 'boolean' && desired !== towardLeft ? 'scaleX(-1)' : undefined }} /></div>;
}
export function Seat({ seat, state, position, onConfigure }) {
  const { avatar, accent } = characterMedia(state, seat);
  const status = state.agentStatus[`player:${seat.id}`];
  const speech = state.publicEvents.findLast(e => e.type === 'chat' && e.data.seat === seat.id && e.data.target === 'public');
  const label = state.replay ? '回放' : seat.type === 'human' ? '本机玩家' : seat.type === 'bot' ? '本地运行' : connectionLabel(status);
  const activity = !state.replay && activityLabel(status);
  const busy = !state.replay && !state.paused && ['thinking', 'chatting', 'checking'].includes(status?.state);
  return <section style={{ '--seat-accent': accent }} className={`seat seat-${position} ${state.activeSeat === seat.id ? 'active' : ''} ${busy ? 'seat-busy' : ''} ${status?.state === 'error' ? 'seat-error' : ''}`}>
    <button className="seat-identity" onClick={() => onConfigure(seat.id)} title={state.replay ? '查看角色记忆' : '角色设置'}>
      <span className={`avatar avatar-${seat.id}`}>{avatar ? <img src={avatar} alt={seat.name} /> : seat.name.slice(0, 1)}</span>
      <span><strong>{seat.name}</strong><small>{typeNames[seat.type]}</small></span>
      <span className={`seat-connection ${status?.state === 'error' ? 'disconnected' : ''}`}><i />{label}</span>
      <span className="wind">{seat.wind}</span>
    </button>
    {activity && <div className="seat-activity" role="status">{busy && <span className="activity-dots" aria-hidden="true"><i /><i /><i /></span>}<span>{state.paused ? '牌局已暂停 · ' : ''}{activity}</span></div>}
    <div className="seat-details"><div className="seat-score">{seat.score.toLocaleString()} <span>点</span>{seat.riichi && <b className="riichi-tag">立直</b>}</div><small>{seat.handCount || 0} 张手牌 · {seat.melds.length} 组副露</small><small>{state.replay ? '点击卡片查看记忆' : activity || (state.activeSeat === seat.id ? '正在行动' : '等一等，聊一聊')}</small></div>
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
export function Result({ state }) {
  const r = state.lastResult;
  if (!r || state.matchOver) return null;
  if (r.kind === 'false_win') return <FloatingWindow className="result"><strong>{state.seats[r.seat]?.name || '牌友'} · 诈胡</strong><p>{r.reason}</p><small>旧版牌局记录 · 罚分已计入回放</small></FloatingWindow>;
  if (r.kind === 'draw') return <FloatingWindow className="result"><strong>{r.name === '荒牌平局' ? '荒牌流局' : r.name}</strong><p>本局已结算，点击继续进入下一局。</p></FloatingWindow>;
  if (r.kind !== 'win') return null;
  return <FloatingWindow className="result win-result"><small>和牌</small><strong>{state.seats[r.winner].name} · {r.baojia === null ? '自摸' : '荣和'}</strong><div className="winning-tile"><span>和牌张</span><Tile code={state.seats[r.winner].drawn} small /></div><p>{r.damanguan ? `${r.damanguan} 倍役满` : `${r.fanshu || 0} 番 ${r.fu || 0} 符`} · {r.defen.toLocaleString()} 点</p><small>{r.hupai?.map(y => `${y.name} ${y.fanshu}`).join(' / ')}</small></FloatingWindow>;
}
