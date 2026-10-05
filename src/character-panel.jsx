import React, { useState } from 'react';
import { Settings } from './settings.jsx';
import { api } from './api.js';
import { ConnectionStatus } from './agent-status.jsx';

export function CharacterPanel({ state, seat, run, onClose }) {
  const [page, setPage] = useState('character');
  const locked = state.started && !state.matchOver;
  const player = state.seats[seat], role = player.type === 'human' ? 'coach' : 'player';
  const status = state.agentStatus[`${role}:${seat}`];
  if (page !== 'character') return <><button className="text-button panel-back" onClick={() => setPage('character')}>← {player.name}</button><Settings key={`${page}:${role}`} state={state} run={run} initialSeat={seat} initialRole={role} scope={page} onClose={onClose} /></>;
  const current = state.media.characters[seat]?.idle;
  return <><div className="modal-heading"><small>{player.wind} · {player.score.toLocaleString()} 点</small><h2>{player.name}</h2></div>
    {player.type !== 'bot' && status?.error && <ConnectionStatus status={status} label={role === 'coach' ? '教练连接' : '牌友连接'} />}
    <div className="character-options"><label>游玩方式<select disabled={locked} value={player.type} onChange={e => run(() => api('seats', { seat, type: e.target.value }))}>{seat === 0 && <option value="human">由我游玩</option>}<option value="bot">本地牌友</option><option value="llm">LLM 自动游玩</option></select></label>
      {player.type !== 'bot' && <button className="secondary" onClick={() => setPage('models')}>{player.type === 'human' ? '设置教练' : locked ? '查看连接' : '设置连接'} ↗</button>}</div>
    <div className="portrait-gallery">{Object.entries(state.media.assetMetadata || {}).filter(([, asset]) => asset.images?.idle).map(([id, asset]) => <button key={id} className={current === asset.images.idle ? 'chosen' : ''} onClick={() => run(() => api('media/select', { seat, asset: id }))} aria-pressed={current === asset.images.idle}><img src={asset.images.idle} alt={asset.name || id} /><span>{asset.name || id}</span></button>)}</div>
    <button className="text-button" onClick={() => setPage('portrait')}>＋ 导入立绘</button>
    {locked && <small className="locked-label">对局中 · 玩家已锁定</small>}
  </>;
}

export function RoomMenu({ state, onOpen, onSeat }) {
  const locked = state.started && !state.matchOver;
  return <><div className="modal-heading"><h2>这张桌</h2></div><div className="room-seats">{state.seats.map(s => <button key={s.id} onClick={() => onSeat(s.id)}><span>{s.wind}</span><strong>{s.name}</strong><small>角色 ↗</small></button>)}</div><div className="table-menu-links">
    {!locked && <button onClick={() => onOpen('room-rules')}>房规与开局 <span>↗</span></button>}
    <button onClick={() => onOpen('scene')}>场景 <span>↗</span></button>{state.seats[0].type === 'human' && <button onClick={() => onOpen('coach')}>我的教练 <span>↗</span></button>}<button onClick={() => onOpen('context')}>牌局记录 <span>↗</span></button>
  </div></>;
}
