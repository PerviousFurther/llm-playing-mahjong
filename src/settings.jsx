import React, { useState } from 'react';
import { api } from './api.js';
import { ConnectionSettings } from './connection-settings.jsx';
import { Switch } from './settings-controls.jsx';

export function Settings({ state, run, initialSeat, onClose, scope = 'room', initialRole = 'player' }) {
  const props = { state, run, initialSeat, initialRole, onClose };
  if (scope === 'models') return <ConnectionSettings key={`${initialRole}:${initialSeat}`} {...props} />;
  if (scope === 'room') return <RoomSettings {...props} />;
  return <MediaSettings key={scope} {...props} kind={scope === 'portrait' ? 'character' : 'background'} />;
}

function RoomSettings({ state, run, onClose }) {
  const [rules, setRules] = useState(state.rules);
  const locked = state.started && !state.matchOver;
  const rule = (key, value) => setRules(r => ({ ...r, [key]: value }));
  return <><div className="modal-heading"><h2>房规</h2></div><div className="settings-content"><fieldset disabled={locked}><div className="form-grid"><label>对局长度<select value={rules.handLimit != null ? 'custom' : rules.rounds} onChange={e => setRules(r => ({ ...r, ...(e.target.value === 'custom' ? { handLimit: 3 } : { rounds: +e.target.value, handLimit: null }) }))}><option value={0}>一局战</option><option value={1}>东风战</option><option value={2}>半庄战</option><option value="custom">自定义局数</option></select></label><label>多人荣和<select value={rules.multipleRon} onChange={e => rule('multipleRon', +e.target.value)}><option value={1}>头跳 · 仅最近一人</option><option value={2}>双响 · 三家和流局</option><option value={3}>允许三家荣和</option></select></label>{rules.handLimit != null && <label>局数<input type="number" min={1} max={16} step={1} value={rules.handLimit} onChange={e => rule('handLimit', +e.target.value)} /></label>}</div>
      <Switch label="赤五" checked={rules.redFives} onChange={v => rule('redFives', v)} />
      <Switch label="食断" checked={rules.openTanyao} onChange={v => rule('openTanyao', v)} />

      </fieldset><div className="modal-actions"><span>{locked ? '对局中 · 房规已锁定' : '25000 点起始'}</span><button className="primary" disabled={state.started && !state.matchOver} onClick={async () => { const result = await run(() => api('start', { rules })); if (result) onClose(); }}>开局 →</button></div>
    </div></>;
}

function MediaSettings({ state, run, initialSeat: seat, kind }) {
  const [expression, setExpression] = useState('idle'), [uploading, setUploading] = useState(false);
  async function upload(file) {
    if (!file) return;
    setUploading(true);
    await run(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error('PNG 文件不能超过 10 MB');
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      return api('media', { kind, seat, expression, base64 });
    }); setUploading(false);
  }
  return <><div className="modal-heading"><h2>{kind === 'character' ? '导入立绘' : '场景'}</h2></div><div className="settings-content">
      {kind === 'character' && <label>表情状态<select value={expression} onChange={e => setExpression(e.target.value)}>{['idle', 'thinking', ...state.expressionOptions].map(id => <option key={id} value={id}>{{ idle: '普通', thinking: '思考', hello: '打招呼', laugh: '笑', unhappy: '不开心' }[id] || id}</option>)}</select></label>}
      <label className="upload-zone"><span>＋</span><strong>{uploading ? '正在导入…' : '选择 PNG 图片'}</strong><small>最大 10 MB</small><input type="file" accept="image/png" disabled={uploading} onChange={e => upload(e.target.files[0])} /></label>
      <div className="media-preview">{kind === 'background' ? <img src={state.media.background || '/asset/background-0.png'} alt="当前背景" /> : <img src={state.media.characters[seat]?.[expression] || state.media.characters[seat]?.idle || '/tiles/Regular/Back.svg'} alt="当前角色素材" />}</div>
      {kind === 'background' && <button className="secondary" onClick={() => run(() => api('media/reset', {}))}>恢复默认场景</button>}
    </div></>;
}
