import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FloatingWindow } from './floating-window.jsx';
import { eventTime, recordStart } from '../shared/event-time.js';
import { memoryEvents, memoryAt } from '../shared/replay-memory.js';

export function ReplayMemory({ record, frame, memoryKey, onSelect, onSeek, onClose }) {
  const events = useMemo(() => memoryEvents(record), [record]);
  const history = memoryAt(events, memoryKey, frame.eventId), current = history.at(-1);
  const start = recordStart(record);
  return createPortal(<div onPointerDown={e => e.stopPropagation()}><FloatingWindow className="replay-memory" header={<strong>角色记忆</strong>}>
    <button className="memory-close text-button" onClick={onClose} aria-label="关闭角色记忆">×</button>
    <select aria-label="查看角色记忆" value={memoryKey} onChange={e => onSelect(e.target.value)}>
      {frame.state.seats.map(s => <option key={s.id} value={`player:${s.id}`}>{s.name}</option>)}
      {events.some(e => e.data.role === 'coach') && <option value="coach:0">教练</option>}
    </select>
    <p className="form-note">截至回放当前位置的私有记忆，仅供玩家查看。</p>
    <div className="memory-current"><small>当前记忆{current && <> · <time>{eventTime(current, start)}</time></>}</small>
      <pre>{current ? current.data.text || '记忆已清空' : '此时尚未记录记忆'}</pre></div>
    <details className="memory-history" open><summary>更新历史 · {history.length}</summary>
      {history.slice().reverse().map(e => <details key={e.id} className="memory-entry"><summary>
        <time>{eventTime(e, start)}</time><span>第 {e.data.matchHand || 1} 局 · {e.data.text ? '更新' : '清空'}</span>
      </summary><pre>{e.data.text || '记忆已清空'}</pre><button className="text-button" onClick={() => onSeek(e.id)}>跳到这次更新 →</button></details>)}
    </details>
  </FloatingWindow></div>, document.body);
}
