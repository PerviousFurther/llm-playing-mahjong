import { eventTime, recordStart } from '../shared/event-time.js';
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { ReplayMemory } from './replay-memory.jsx';

import './replay.css';

export function Replay({ run, onBack, onFrame, initialId, memoryKey, onMemoryKey }) {
  const [records, setRecords] = useState([]), [record, setRecord] = useState(null);
  const [selected, setSelected] = useState(initialId || ''), [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1000), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; run(() => api('replays')).then(data => {
    if (active && data) { setRecords(data); setSelected(id => data.some(r => r.id === id) ? id : data[0]?.id || ''); }
  }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!selected) return;
    let active = true; setBusy(true); setPlaying(false); setRecord(null); onMemoryKey(null);
    run(() => api(`replays/${selected}`)).then(data => {
      if (active) { setRecord(data); setIndex(0); setBusy(false); }
    });
    return () => { active = false; };
  }, [selected]);
  const frames = record?.frames || [], frame = frames[index], state = frame?.state;
  useEffect(() => {
    if (!playing || index >= frames.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(i => i + 1), speed);
    return () => clearTimeout(timer);
  }, [playing, index, speed, frames.length]);
  useEffect(() => { onFrame(record, frame); }, [record, frame]);
  const seek = value => { setPlaying(false); setIndex(Math.max(0, Math.min(frames.length - 1, value))); };
  return <><div className="replay-view">
    <button className="text-button panel-back" onClick={onBack}>返回实时牌桌 ↗</button>
    <div className="modal-heading"><small>OPEN TABLE REPLAY</small><h2>明牌回放</h2></div>
    <div className="replay-selector"><select aria-label="选择对局" value={selected} onChange={e => setSelected(e.target.value)}>
      {!records.length && <option value="">暂无历史对战</option>}{records.map(r => <option key={r.id} value={r.id}>{new Date(r.savedAt).toLocaleString()} · {r.hands} 局 · {r.players.join(' / ')}</option>)}
    </select><label className="secondary replay-import">导入回放<input type="file" accept=".json,application/json" onChange={e => {
      const file = e.target.files?.[0]; if (!file) return;
      setPlaying(false); onMemoryKey(null);
      run(async () => { const data = JSON.parse(await file.text());
        if (!Array.isArray(data.frames) || !data.frames.length || data.frames.some(f => !Array.isArray(f.state?.seats) || f.state.seats.length !== 4)) throw new Error('请选择包含明牌回放的导出文件');
        setRecord(data); setIndex(0);
      }); e.target.value = '';
    }} /></label></div>
    {busy ? <p>正在读取牌谱…</p> : !state ? <p>暂无回放。完成对战后会自动保存到历史记录。</p> : <>
      <div className="replay-controls"><button className="secondary" disabled={!index} onClick={() => seek(index - 1)}>← 上一步</button>
        <button className="primary" disabled={frames.length < 2} onClick={() => { if (index === frames.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? '暂停' : '▶ 播放'}</button>
        <button className="secondary" disabled={index === frames.length - 1} onClick={() => seek(index + 1)}>下一步 →</button>
        <select aria-label="播放速度" value={speed} onChange={e => setSpeed(+e.target.value)}><option value={2000}>0.5×</option><option value={1000}>1×</option><option value={500}>2×</option><option value={250}>4×</option></select>
        <button className="secondary" onClick={() => onMemoryKey(memoryKey ? null : `player:${state.activeSeat ?? 0}`)}>角色记忆</button>
      </div>
      <input className="replay-progress" type="range" aria-label="回放进度" min="0" max={frames.length - 1} value={index} onChange={e => seek(+e.target.value)} />
      <div className="replay-caption"><span>第 {state.matchHand} 局 · {frame.label}{state.activeSeat != null && ` · ${state.seats[state.activeSeat].name}`}</span><span><time title="距整场对局开始">{eventTime(frame.at || frame.elapsed ? frame : record.events?.find(e => e.id === frame.eventId), recordStart(record))}</time> · {index + 1} / {frames.length}</span></div>

    </>}
  </div>{state && memoryKey && <ReplayMemory record={record} frame={frame} memoryKey={memoryKey} onSelect={onMemoryKey} onClose={() => onMemoryKey(null)} onSeek={id => {
    const target = frames.findIndex(f => f.eventId === id);
    if (target >= 0) seek(target);
  }} />}</>;
}
