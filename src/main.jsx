import { recordStart } from '../shared/event-time.js';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, domAnimation, LazyMotion, m, MotionConfig } from 'motion/react';
import { FloatingWindow } from './floating-window.jsx';
import { GameEffects } from './game-effects.jsx';
import { tileName } from './tiles.jsx';
import { ThreeTable } from './three-table.jsx';
import { Rulebook, ContextPanel } from './panels.jsx';
import { Settings } from './settings.jsx';
import { CharacterPanel, RoomMenu } from './character-panel.jsx';
import { api } from './api.js';
import { Chat } from './chat.jsx';
import { Replay } from './replay.jsx';
import { Character, Seat, Result, TurnIndicator } from './table-scene.jsx';
import './style.css';
import './scene.css';
const phases = { lobby: '等待开局', kaiju: '准备', qipai: '发牌', zimo: '摸牌', gangzimo: '岭上摸牌', dapai: '等待响应', fulou: '副露', gang: '杠', hule: '和牌结算', pingju: '本局结束', jieju: '对局结束', aborted: '对局作废' };
const opponents = [[2, 'top'], [3, 'left'], [1, 'right']];
function App() {
  const [liveState, setState] = useState(null), [connection, setConnection] = useState('connecting'), [error, setError] = useState('');
  const [panel, setPanel] = useState(null), [settingsSeat, setSettingsSeat] = useState(1), [riichiMode, setRiichiMode] = useState(false), [terminateOpen, setTerminateOpen] = useState(false);
  const [replaying, setReplaying] = useState(false), [replayData, setReplayData] = useState(null), [replayId, setReplayId] = useState(null);
  const [replayMemory, setReplayMemory] = useState(null);
  const replayFrame = replayData?.frame;
  const record = replayData?.record;
  const until = list => (list || []).filter(e => e.id <= (replayFrame?.eventId ?? Infinity));
  const state = liveState && replaying && replayFrame ? { ...liveState, ...replayFrame.state, rules: record.rules, matchStartedAt: recordStart(record), replay: true, replayEventId: replayFrame.eventId, version: replayFrame.eventId, matchOver: false, paused: false, legalActions: [], canWin: false, waiting: [], turn: {}, agentStatus: {}, publicChatEvents: [], publicEvents: until(record.events), privateEvents: until(record.myPrivateEvents), observerPrivateEvents: until(record.allPrivateEvents), coachEvents: until(record.myCoachEvents) } : liveState;
  const [hoveredTile, setHoveredTile] = useState(null);
  useEffect(() => { if (state && state.seats[0].type !== 'human' && panel === 'coach') setPanel(null); }, [state?.seats[0].type, panel]);
  const run = async fn => { try { return await fn(); } catch (e) { setError(e.message); return null; } };
  useEffect(() => {
    let ws, stopped = false, timer;
    async function connect() {
      try {
        await api('session'); const s = await api('state'); if (stopped) return; setState(s);
        ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);
        ws.onopen = () => setConnection('connected');
        ws.onmessage = e => { const data = JSON.parse(e.data); if (data.type === 'state') setState(data.state); };
        ws.onclose = () => { if (!stopped) { setConnection('reconnecting'); timer = setTimeout(connect, 2000); } };
        ws.onerror = () => ws.close();
      } catch (e) { if (!stopped) { setError(e.message); setConnection('reconnecting'); timer = setTimeout(connect, 3000); } }
    }
    connect(); return () => { stopped = true; clearTimeout(timer); ws?.close(); };
  }, []);
  useEffect(() => { setRiichiMode(false); setHoveredTile(null); }, [state?.version]);
  useEffect(() => {
    const close = e => { if (e.key === 'Escape') { setPanel(null); setTerminateOpen(false); } };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  if (!state) return <div className="loading"><span className="brand-mark">雀</span><h2>正在铺好牌桌…</h2><p>{error || '连接本地牌局服务'}</p></div>;
  const openReplay = id => { setPanel(null); setReplayId(id || null); setReplayData(null); setReplaying(true); };
  const configure = seat => { if (replaying) { setReplayMemory(`player:${seat}`); return; } setSettingsSeat(seat); setPanel('character'); };
  const act = option => !replaying && run(() => api('action', { action: option.action, ...(option.value === undefined ? {} : { value: option.value }), stateVersion: state.version, requestId: crypto.randomUUID() }));
  const me = state.seats[0], choices = state.legalActions;
  const canRiichi = choices.some(a => a.action === 'riichi');
  const others = choices.filter(a => !['discard', 'riichi'].includes(a.action)).sort((a, b) => Number(b.action === 'pass') - Number(a.action === 'pass'));
  const hoverText = hoveredTile && `${tileName(hoveredTile)} · 手中 ${me.hand.filter(p => p === hoveredTile).length} 张${riichiMode ? choices.some(a => a.action === 'riichi' && a.value?.slice(0, 2) === hoveredTile) ? ' · 点击立直打出' : ' · 不能立直打出' : choices.some(a => a.action === 'discard' && a.value?.slice(0, 2) === hoveredTile) ? ' · 点击打出' : ' · 当前不能打出'}`;
  const statusText = state.paused ? '牌局已暂停' : state.matchOver ? '对局结束，可以再开一桌' : choices.some(a => a.action === 'discard') ? riichiMode ? '立直：点击可立直的牌' : '轮到你了，点击手牌打出' : choices.some(a => a.action === 'pass') ? '可以响应这张牌，或选择跳过' : choices.some(a => a.action === 'continue') ? '查看结算后继续' : state.started ? '等待牌友行动 · 没有时间限制' : '先配置牌友，再开一桌';
  return <div className={`app-shell immersive ${replaying ? 'replaying' : ''}`} style={{ '--room-background': `url("${state.media.background || '/asset/background-0.png'}")` }}>
    <div className="workspace"><header className="topbar"><div><h1>雀伴 <span>RIICHI COMPANIONS</span></h1></div><div className="topbar-actions"><span className={`connection ${connection !== 'connected' ? 'offline' : ''}`}><i />{connection === 'connected' ? '牌局服务已连接' : '正在重连'}</span><button className="subtle" onClick={() => setPanel('rules')}>规则手册 ↗</button><button className="subtle" onClick={() => setPanel('settings')}>这张桌</button>{!replaying && state.started && !state.matchOver && <button className="subtle" onClick={() => run(() => api('pause', { paused: !state.paused }))}>{state.paused ? '▶ 继续牌局' : 'Ⅱ 暂停'}</button>}</div></header>
    <main className="main-layout"><section className="table-panel">
      <div className="table-scene">
        {opponents.map(([id, position]) => <Character key={id} seat={state.seats[id]} state={state} position={position} />)}
        {[...opponents, [0, 'bottom']].map(([id, position]) => <Seat key={id} seat={state.seats[id]} state={state} position={position} onConfigure={configure} />)}
        <ThreeTable state={state} riichiMode={riichiMode} onAction={act} onHover={setHoveredTile}>
        <button className="table-center" onClick={() => setPanel('table')} aria-label="打开牌局菜单"><TurnIndicator state={state} /><small>{state.paused && state.started ? '已暂停' : state.started ? phases[state.phase] : 'RIICHI'}</small><strong>{['东', '南', '西', '北'][state.round]}<span>{state.handNumber + 1} 局</span></strong><div className="center-meta"><span>{state.honba} 本场</span><span>{state.sticks} 供托</span></div><div className="remaining">余牌 <b>{state.started ? state.remaining : '—'}</b></div><span className="center-hover">轻触桌心 · 牌局菜单 ↗</span></button>
        <span className="hand-hint">{hoverText || (!state.paused && me.type === 'human' && choices.some(a => a.action === 'discard') ? statusText : '')}</span>
        {!replaying && !state.paused && me.type === 'human' && (others.length > 0 || canRiichi || state.canWin) && <div className="table-actions" aria-label="可用操作">{others.map((a, i) => <button key={i} className="secondary" disabled={state.paused} onClick={() => act(a)}>{a.label}{a.value && <span className="action-value">{a.value}</span>}</button>)}{canRiichi && <button className={`secondary gold ${riichiMode ? 'chosen' : ''}`} aria-pressed={riichiMode} disabled={state.paused} onClick={() => setRiichiMode(!riichiMode)}>{riichiMode ? '取消立直' : '立直'}</button>}{state.canWin && me.type === 'human' && <button className="declare-button" disabled={state.paused} onClick={() => act({ action: 'declare_win' })}>{['zimo', 'gangzimo'].includes(state.phase) ? '自摸' : '荣和'}</button>}</div>}
        </ThreeTable>
        <GameEffects state={state} suspended={replaying} />
        <Result state={state} />
        {!replaying && state.started && state.paused && !state.matchOver && <button className="resume-game primary" onClick={() => run(() => api('pause', { paused: false }))}>▶ 继续牌局</button>}
        {!state.started && <FloatingWindow className="welcome-card"><small>WELCOME TO THE TABLE</small><h2>今晚，和谁打麻将？</h2><button className="primary" onClick={() => setPanel('settings')}>布置牌桌 →</button><button className="text-button" onClick={() => run(() => api('start', { rules: state.rules }))}>先和本地牌友玩一局</button></FloatingWindow>}
        {!replaying && state.matchOver && <FloatingWindow className="match-over"><strong>{state.aborted ? '对局已作废' : '对局结束'}</strong>{state.replayId && <button className="secondary" onClick={() => openReplay(state.replayId)}>回看本次对战</button>}<button className="primary" onClick={() => setPanel('settings')}>再开一桌 →</button></FloatingWindow>}
        <Chat state={state} run={run} readOnly={replaying} />
      </div>
    </section></main></div>
    <AnimatePresence>{panel && <m.div key="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .16 }} className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPanel(null); }}><m.section key={panel} initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { type: 'tween', duration: .16 } }} transition={{ type: 'spring', stiffness: 360, damping: 28 }} className={`modal ${['table', 'settings', 'character'].includes(panel) ? 'table-menu' : ''}`} role="dialog" aria-modal="true" aria-label="牌局面板"><button className="modal-close" onClick={() => setPanel(null)} aria-label="关闭">×</button>{panel === 'table' ? <><div className="modal-heading"><small>桌心 · 一局之间</small><h2>{['东', '南', '西', '北'][state.round]} {state.handNumber + 1} 局</h2><p>{statusText}</p></div><div className="table-standings">{state.seats.slice().sort((a, b) => b.score - a.score).map((s, i) => <button key={s.id} onClick={() => configure(s.id)}><span>0{i + 1} · {s.wind}</span><strong>{s.name}</strong><b>{s.score.toLocaleString()}</b></button>)}</div><div className="table-menu-links"><button onClick={() => setPanel('rules')}>翻翻规则 <span>册 ↗</span></button><button onClick={() => setPanel('context')}>看看牌局记录 <span>池 ↗</span></button><button onClick={() => setPanel('settings')}>这张桌 <span>⚙ ↗</span></button>{!replaying && state.started && !state.matchOver && <button onClick={() => setTerminateOpen(true)}>终止对局 <span>×</span></button>}{!replaying && state.started && !state.matchOver && <button onClick={() => run(() => api('pause', { paused: !state.paused }))}>{state.paused ? '继续这局' : '歇一会儿'} <span>{state.paused ? '▶' : 'Ⅱ'}</span></button>}</div></> : panel === 'settings' ? <RoomMenu state={state} onOpen={setPanel} onSeat={configure} /> : panel === 'character' ? <CharacterPanel key={settingsSeat} state={state} seat={settingsSeat} run={run} onClose={() => setPanel(null)} /> : ['room-rules', 'scene', 'coach'].includes(panel) ? <><button className="text-button panel-back" onClick={() => setPanel('settings')}>← 这张桌</button><Settings key={panel} state={state} run={run} initialSeat={0} initialRole={panel === 'coach' ? 'coach' : 'player'} scope={panel === 'room-rules' ? 'room' : panel === 'scene' ? 'media' : 'models'} onClose={() => setPanel(null)} /></> : panel === 'rules' ? <Rulebook state={state} /> : <ContextPanel state={state} run={run} onReplay={openReplay} />}</m.section></m.div>}</AnimatePresence>
    {replaying && <FloatingWindow className="scene-replay-controls"><Replay key={replayId || 'history'} initialId={replayId} run={run} memoryKey={replayMemory} onMemoryKey={setReplayMemory} onBack={() => { setReplaying(false); setReplayData(null); setReplayMemory(null); }} onFrame={(record, frame) => setReplayData({ record, frame })} /></FloatingWindow>}
    {terminateOpen && <div className="modal-backdrop"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="terminate-title"><small>作废对局</small><h2 id="terminate-title">终止这桌对战？</h2><p>本次对战作废，点数重置，不计排名或存入历史对战。</p><div><button className="secondary" onClick={() => setTerminateOpen(false)}>返回牌桌</button><button className="declare-button" onClick={() => run(async () => { const result = await api('terminate', {}); if (result) { setTerminateOpen(false); setPanel(null); } })}>终止对局</button></div></section></div>}
    {error && <FloatingWindow className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></FloatingWindow>}
  </div>;
}
createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation} strict><MotionConfig reducedMotion="user"><App /></MotionConfig></LazyMotion>);
