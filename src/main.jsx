import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tile, Melds, tileName } from './tiles.jsx';
import { Rulebook, ContextPanel } from './panels.jsx';
import { Settings } from './settings.jsx';
import { CharacterPanel, RoomMenu } from './character-panel.jsx';
import { api } from './api.js';
import { matchLabel } from '../shared/rules.js';
import { Chat } from './chat.jsx';
import { Replay } from './replay.jsx';
import { Character, Seat, TableHand, Discards, Result, TurnIndicator, shapeTableTiles } from './table-scene.jsx';
import './style.css';
import './scene.css';
const phases = { lobby: '等待开局', kaiju: '准备', qipai: '发牌', zimo: '摸牌', gangzimo: '岭上摸牌', dapai: '等待响应', fulou: '副露', gang: '杠', hule: '和牌结算', pingju: '本局结束', jieju: '对局结束', aborted: '对局作废' };
function App() {
  const [liveState, setState] = useState(null), [connection, setConnection] = useState('connecting'), [error, setError] = useState('');
  const [panel, setPanel] = useState(null), [settingsSeat, setSettingsSeat] = useState(1), [riichiMode, setRiichiMode] = useState(false), [terminateOpen, setTerminateOpen] = useState(false);
  const [replaying, setReplaying] = useState(false), [replayData, setReplayData] = useState(null), [replayId, setReplayId] = useState(null);
  const replayFrame = replayData?.frame;
  const record = replayData?.record;
  const until = list => (list || []).filter(e => e.id <= (replayFrame?.eventId ?? Infinity));
  const state = liveState && replaying && replayFrame ? { ...liveState, ...replayFrame.state, rules: record.rules, replay: true, replayEventId: replayFrame.eventId, version: replayFrame.eventId, matchOver: false, paused: false, legalActions: [], canDeclare: false, canWin: false, waiting: [], turn: {}, agentStatus: {}, publicChatEvents: [], publicEvents: until(record.events).slice(-160), privateEvents: until(record.myPrivateEvents), observerPrivateEvents: until(record.allPrivateEvents), coachEvents: until(record.myCoachEvents) } : liveState;
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
  useEffect(() => { console.info('[牌桌操作]', '拖动聊天标题栏移动窗口；桌心打开菜单；角色标签打开该角色设置。Enter 发送，Shift+Enter 换行。模型与外部 Agent 使用独立座位上下文。'); }, []);
  useLayoutEffect(() => {
    const surface = document.querySelector('.table-surface');
    if (!surface) return;
    const update = () => shapeTableTiles(surface);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [state?.version, state?.started]);
  useEffect(() => { setRiichiMode(false); setHoveredTile(null); }, [state?.version]);
  useEffect(() => {
    const close = e => { if (e.key === 'Escape') { setPanel(null); setTerminateOpen(false); } };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  if (!state) return <div className="loading"><span className="brand-mark">雀</span><h2>正在铺好牌桌…</h2><p>{error || '连接本地牌局服务'}</p></div>;
  const openReplay = id => { setPanel(null); setReplayId(id || null); setReplayData(null); setReplaying(true); };
  const configure = seat => { if (replaying) return; setSettingsSeat(seat); setPanel('character'); };
  const act = option => !replaying && run(() => api('action', { action: option.action, ...(option.value === undefined ? {} : { value: option.value }), stateVersion: state.version, requestId: crypto.randomUUID() }));
  const me = state.seats[0], choices = state.legalActions;
  const canRiichi = choices.some(a => a.action === 'riichi');
  const others = choices.filter(a => !['discard', 'riichi'].includes(a.action));
  const hoverText = hoveredTile && `${tileName(hoveredTile)} · 手中 ${me.hand.filter(p => p === hoveredTile).length} 张${riichiMode ? choices.some(a => a.action === 'riichi' && a.value?.slice(0, 2) === hoveredTile) ? ' · 点击立直打出' : ' · 不能立直打出' : choices.some(a => a.action === 'discard' && a.value?.slice(0, 2) === hoveredTile) ? ' · 点击打出' : ' · 当前不能打出'}`;
  const statusText = state.paused ? '牌局已暂停' : state.matchOver ? '对局结束，可以再开一桌' : choices.some(a => a.action === 'discard') ? riichiMode ? '立直：点击可立直的牌' : '轮到你了，点击手牌打出' : choices.some(a => a.action === 'pass') ? '可以响应这张牌，或选择跳过' : choices.some(a => a.action === 'continue') ? '查看结算后继续' : state.started ? '等待牌友行动 · 没有时间限制' : '先配置牌友，再开一桌';
  return <div className={`app-shell immersive ${replaying ? 'replaying' : ''}`} style={{ '--room-background': `url("${state.media.background || '/asset/background-0.png'}")` }}>
    <nav className="rail"><span className="brand-mark">雀</span><button className="rail-active" title="牌桌" onClick={() => setPanel(null)}>▦</button><button title="规则手册" onClick={() => setPanel('rules')}>册</button><button title="上下文" onClick={() => setPanel('context')}>池</button><button title="配置" onClick={() => setPanel('settings')}>⚙</button><span className="rail-bottom">雀伴</span></nav>
    <div className="workspace"><header className="topbar"><div><h1>雀伴 <span>RIICHI COMPANIONS</span></h1></div><div className="topbar-actions"><span className={`connection ${connection !== 'connected' ? 'offline' : ''}`}><i />{connection === 'connected' ? '牌局服务已连接' : '正在重连'}</span><button className="subtle" onClick={() => setPanel('rules')}>规则手册 ↗</button><button className="subtle" onClick={() => setPanel('settings')}>这张桌</button>{!replaying && state.started && !state.matchOver && <button className="subtle" onClick={() => run(() => api('pause', { paused: !state.paused }))}>{state.paused ? '▶ 继续牌局' : 'Ⅱ 暂停'}</button>}</div></header>
    <main className="main-layout"><section className="table-panel"><div className="table-toolbar"><div><span className="room-tag">慢慢打，慢慢聊</span><span>日麻 · {matchLabel(state.rules)}{state.handLimit && state.started ? ' · ' + state.matchHand + '/' + state.handLimit + ' 局' : ''}</span></div><div>{!replaying && state.started && !state.matchOver && <button className="subtle" onClick={() => run(() => api('pause', { paused: !state.paused }))}>{state.paused ? '▶ 继续' : 'Ⅱ 暂停'}</button>}<button className="subtle" onClick={() => setPanel('context')}>上下文池</button></div></div>
      <div className="table-scene">
        <div className="table-grain" />
        <Character seat={state.seats[2]} state={state} position="top" />
        <Character seat={state.seats[3]} state={state} position="left" />
        <Character seat={state.seats[1]} state={state} position="right" />
        <Seat seat={state.seats[2]} state={state} position="top" onConfigure={configure} />
        <Seat seat={state.seats[3]} state={state} position="left" onConfigure={configure} />
        <Seat seat={state.seats[1]} state={state} position="right" onConfigure={configure} />
        <Seat seat={me} state={state} position="bottom" onConfigure={configure} />
        <div className="table-perspective"><div className="table-surface">
        <div className="mahjong-table" aria-hidden="true"><div className="table-felt" /><span className="table-brand">雀伴 · RIICHI</span></div>
        <TableHand seat={state.seats[2]} state={state} position="top" /><TableHand seat={state.seats[3]} state={state} position="left" /><TableHand seat={state.seats[1]} state={state} position="right" />
        <div className="discard-ring"><Discards seat={state.seats[2]} position="top" /><Discards seat={state.seats[3]} position="left" /><Discards seat={state.seats[1]} position="right" /><Discards seat={me} position="bottom" /></div>
        <div className="table-my-hand">{(me.hand.length ? me.hand : Array(13).fill('_')).map((p, i) => {
          const drawn = i === me.hand.length - 1 && me.drawn?.length === 2;
          const value = p + (drawn ? '_' : '');
          const discard = choices.find(a => a.action === 'discard' && a.value === value) || choices.find(a => a.action === 'discard' && a.value === p);
          const riichi = choices.find(a => a.action === 'riichi' && (a.value === value || a.value === p));
          const option = riichiMode ? riichi : discard;
          return <Tile key={i} code={p} drawn={drawn} onClick={() => option && act(option)} onHover={setHoveredTile} disabled={!option || state.paused || me.type !== 'human'} />;
        })}<Melds values={me.melds} /></div>
        <button className="table-center" onClick={() => setPanel('table')} aria-label="打开牌局菜单"><TurnIndicator state={state} /><small>{state.paused && state.started ? '已暂停' : state.started ? phases[state.phase] : 'RIICHI'}</small><strong>{['东', '南', '西', '北'][state.round]}<span>{state.handNumber + 1} 局</span></strong><div className="center-meta"><span>{state.honba} 本场</span><span>{state.sticks} 供托</span></div><div className="remaining">余牌 <b>{state.started ? state.remaining : '—'}</b></div><span className="center-hover">轻触桌心 · 牌局菜单 ↗</span></button>
        <div className="dora-indicators"><span>宝牌指示</span><div>{state.dora.length ? state.dora.map((p, i) => <Tile key={i} code={p} small />) : <Tile small />}</div></div>
        </div></div>
        <span className="table-caption">慢慢打，慢慢聊。</span>
        <Result state={state} />
        {!replaying && state.started && state.paused && !state.matchOver && <button className="resume-game primary" onClick={() => run(() => api('pause', { paused: false }))}>▶ 继续牌局</button>}
        {!state.started && <div className="welcome-card"><small>WELCOME TO THE TABLE</small><h2>今晚，和谁打麻将？</h2><button className="primary" onClick={() => setPanel('settings')}>布置牌桌 →</button><button className="text-button" onClick={() => run(() => api('start', { rules: state.rules }))}>先和本地牌友玩一局</button></div>}
        {!replaying && state.matchOver && <div className="match-over"><strong>{state.aborted ? '对局已作废' : '对局结束'}</strong>{state.replayId && <button className="secondary" onClick={() => openReplay(state.replayId)}>回看本次对战</button>}<button className="primary" onClick={() => setPanel('settings')}>再开一桌 →</button></div>}
      </div>
      <div className="my-area"><div className="action-bar"><span className="action-hint">{hoverText || statusText}{me.revealed && ' · 手牌已公开'}</span><div>{others.map((a, i) => <button key={i} className="secondary" disabled={state.paused} onClick={() => act(a)}>{a.label}{a.value && <span className="action-value">{a.value}</span>}</button>)}{canRiichi && <button className={`secondary gold ${riichiMode ? 'chosen' : ''}`} aria-pressed={riichiMode} disabled={state.paused} onClick={() => setRiichiMode(!riichiMode)}>{riichiMode ? '取消立直' : '立直'}</button>}{state.canDeclare && me.type === 'human' && <button className="declare-button" disabled={state.paused} onClick={() => act({ action: 'declare_win' })}>{['zimo', 'gangzimo'].includes(state.phase) ? '自摸' : '荣和'}</button>}</div></div></div><footer className="table-footer"><span><i className="live-dot" />自动保存到本机</span><span>无回合时限</span></footer>
    </section><Chat state={state} run={run} readOnly={replaying} /></main></div>
    {panel && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPanel(null); }}><section className={`modal ${['table', 'settings', 'character'].includes(panel) ? 'table-menu' : ''}`} role="dialog" aria-modal="true" aria-label="牌局面板"><button className="modal-close" onClick={() => setPanel(null)} aria-label="关闭">×</button>{panel === 'table' ? <><div className="modal-heading"><small>桌心 · 一局之间</small><h2>{['东', '南', '西', '北'][state.round]} {state.handNumber + 1} 局</h2><p>{statusText}</p></div><div className="table-standings">{state.seats.slice().sort((a, b) => b.score - a.score).map((s, i) => <button key={s.id} onClick={() => configure(s.id)}><span>0{i + 1} · {s.wind}</span><strong>{s.name}</strong><b>{s.score.toLocaleString()}</b></button>)}</div><div className="table-menu-links"><button onClick={() => setPanel('rules')}>翻翻规则 <span>册 ↗</span></button><button onClick={() => setPanel('context')}>看看牌局记录 <span>池 ↗</span></button><button onClick={() => setPanel('settings')}>这张桌 <span>⚙ ↗</span></button>{!replaying && state.started && !state.matchOver && <button onClick={() => setTerminateOpen(true)}>终止对局 <span>×</span></button>}{!replaying && state.started && !state.matchOver && <button onClick={() => run(() => api('pause', { paused: !state.paused }))}>{state.paused ? '继续这局' : '歇一会儿'} <span>{state.paused ? '▶' : 'Ⅱ'}</span></button>}</div></> : panel === 'settings' ? <RoomMenu state={state} onOpen={setPanel} onSeat={configure} /> : panel === 'character' ? <CharacterPanel key={settingsSeat} state={state} seat={settingsSeat} run={run} onClose={() => setPanel(null)} /> : ['room-rules', 'scene', 'coach'].includes(panel) ? <><button className="text-button panel-back" onClick={() => setPanel('settings')}>← 这张桌</button><Settings key={panel} state={state} run={run} initialSeat={0} initialRole={panel === 'coach' ? 'coach' : 'player'} scope={panel === 'room-rules' ? 'room' : panel === 'scene' ? 'media' : 'models'} onClose={() => setPanel(null)} /></> : panel === 'rules' ? <Rulebook state={state} /> : <ContextPanel state={state} run={run} onReplay={openReplay} />}</section></div>}
    {replaying && <div className="scene-replay-controls"><Replay key={replayId || 'history'} initialId={replayId} run={run} onBack={() => { setReplaying(false); setReplayData(null); }} onFrame={(record, frame) => setReplayData({ record, frame })} /></div>}
    {terminateOpen && <div className="modal-backdrop"><section className="confirm-modal"><small>作废对局</small><h2>终止这桌对战？</h2><p>本次对战作废，点数重置，不计排名或存入历史对战。</p><div><button className="secondary" onClick={() => setTerminateOpen(false)}>返回牌桌</button><button className="declare-button" onClick={() => run(async () => { const result = await api('terminate', {}); if (result) { setTerminateOpen(false); setPanel(null); } })}>终止对局</button></div></section></div>}
    {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
