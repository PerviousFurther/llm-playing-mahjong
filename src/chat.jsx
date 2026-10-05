import React, { useEffect, useRef, useState } from 'react';
import { tileName } from './tiles.jsx';
import { FloatingWindow } from './floating-window.jsx';
import { api } from './api.js';
import { ConnectionStatus } from './agent-status.jsx';

function eventText(event, state) {
  const d = event.data, name = id => state.seats[id]?.name || '牌友';
  if (event.type === 'dapai') return `${name((state.seats.find(s => s.wind === ['东', '南', '西', '北'][d.l]) || {}).id)} 打出 ${tileName(d.p)}${d.p.includes('*') ? '，宣告立直' : ''}`;
  if (event.type === 'false_win') return `${name(d.seat)} 诈胡，程序已执行罚分`;
  if (event.type === 'declaration') return `${name(d.seat)} 推牌${d.valid ? '，和牌成立' : ''}`;
  if (event.type === 'hand_started') return `${['东', '南', '西', '北'][d.round]} ${d.hand + 1} 局开始`;
  if (event.type === 'fulou') return `副露 ${d.m}`;
  if (event.type === 'gang') return `宣告杠 ${d.m}`;
  if (event.type === 'hule') return '程序完成和牌计分';
  if (event.type === 'pingju') return `流局 · ${d.name}`;
  if (event.type === 'match_ended') return '对局结束';
  return null;
}
export function Chat({ state, run, readOnly = false }) {
  const coachEnabled = state.seats[0].type === 'human';
  const [tab, setTab] = useState('public'), [text, setText] = useState(''), [recipient, setRecipient] = useState(1), [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!coachEnabled && tab === 'coach') setTab('public'); }, [coachEnabled, tab]);
  const messages = useRef(null);
  const followLatest = useRef(true);
  const [unread, setUnread] = useState(false), [awayFromBottom, setAwayFromBottom] = useState(false);
  const showLatest = () => {
    const box = messages.current;
    if (box) box.scrollTop = box.scrollHeight;
    followLatest.current = true; setUnread(false); setAwayFromBottom(false);
  };
  const publicEvents = [...new Map([...state.publicEvents, ...(state.publicChatEvents || [])].map(e => [e.id, e])).values()].sort((a, b) => a.id - b.id);
  const events = (tab === 'public' ? publicEvents : tab === 'coach' ? state.coachEvents || [] : state.privateEvents).filter(e => {
    if (tab === 'public') return e.type === 'chat' || eventText(e, state);
    if (e.type !== 'chat') return false;
    return tab === 'coach' ? e.data.target === 'coach' : e.data.target === `seat:${recipient}` || e.data.target === 'seat:0' && e.data.seat === recipient;
  });
  useEffect(() => { showLatest(); }, [tab, recipient]);
  const latestEvent = events.at(-1)?.id;
  useEffect(() => {
    if (followLatest.current) showLatest();
    else setUnread(true);
  }, [latestEvent]);
  const send = async (value = text) => {
    if (readOnly) return;
    if (!value.trim() || sending) return;
    setSending(true);
    const target = tab === 'private' ? `seat:${recipient}` : tab;
    await run(() => api('chat', { text: value, target, ...(tab === 'private' ? { recipient } : {}) })); setText(''); setSending(false);
  };
  const coachStatus = state.agentStatus['coach:0'];
  return <FloatingWindow as="aside" sizeKey={expanded} className={`chat-panel scene-chat ${expanded ? 'expanded' : 'compact'}`} header={<><i className="live-dot" /><span>{tab === 'public' ? '全局聊天' : tab === 'private' ? '私聊' : '我的教练'}</span><button className="chat-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? '↙' : '↗'}</button></>}>
    <div className="tabs">{[['public', '全局'], ['private', '私聊'], ...(coachEnabled ? [['coach', '我的教练']] : [])].map(([id, label]) => <button key={id} className={tab === id ? 'chosen' : ''} onClick={() => { setTab(id); setExpanded(true); }}>{label}</button>)}</div>
    {tab === 'private' && <div className="chat-recipient"><span>聊天对象</span><select value={recipient} onChange={e => setRecipient(+e.target.value)}>{state.seats.filter(s => s.id !== 0).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><small>仅双方可见</small></div>}
    {tab === 'coach' && <div className="coach-card"><img src={state.media.coach || '/asset/gpt/idle.png'} alt="教练" /><div><strong>{state.profiles['coach:0']?.name || '你的麻将教练'}</strong><button onClick={() => send('请分析我当前的手牌，给我一个行动建议。')} disabled={sending}>帮我看看这手牌 ↗</button></div></div>}
    <div className="chat-messages" ref={messages} onScroll={e => {
      const box = e.currentTarget, atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
      followLatest.current = atBottom; setAwayFromBottom(!atBottom); if (atBottom) setUnread(false);
    }}>{!events.length && <div className="chat-empty"><span>{tab === 'coach' ? '✧' : '茶'}</span><p>{tab === 'coach' ? '问问教练，下一张该怎么打。' : '牌不急着打，话可以慢慢聊。'}</p></div>}
      {events.map(e => e.type !== 'chat' ? <div className="system-message" key={e.id}>{eventText(e, state)}</div> : <div key={e.id} className={`message ${e.data.seat === 0 && e.data.speaker === 'player' ? 'mine' : ''}`}><span className="message-name">{e.data.speaker === 'coach' ? state.profiles['coach:0']?.name || '教练' : state.seats[e.data.seat].name}<time>{new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></span><p>{e.data.text}</p></div>)}
      {coachStatus?.state === 'chatting' && tab === 'coach' && <div className="system-message">教练正在看牌…</div>}
      {coachStatus?.state === 'error' && tab === 'coach' && <><ConnectionStatus status={coachStatus} label="教练连接" /><button className="text-button" onClick={() => run(() => api('retry', { seat: 0, role: 'coach' }))}>重置教练</button></>}
    </div>
    {awayFromBottom && <button type="button" className="chat-latest" onClick={showLatest}>{unread ? '新消息' : '回到最新'} ↓</button>}
    {!readOnly && <form className="chat-compose" onSubmit={e => { e.preventDefault(); send(); }}><textarea aria-label="聊天消息" value={text} onChange={e => setText(e.target.value)} placeholder={tab === 'coach' ? '这张牌危险吗？' : '和牌友说点什么…'} maxLength={4000} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><div><small>Enter 发送 · Shift + Enter 换行</small><button className="send-button" disabled={!text.trim() || sending}>↑</button></div></form>}
  </FloatingWindow>;
}
