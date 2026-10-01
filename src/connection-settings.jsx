import React, { useState } from 'react';
import { api } from './api.js';
import { ConnectionStatus } from './agent-status.jsx';
import { Switch } from './settings-controls.jsx';

export function ConnectionSettings({ state, run, initialSeat, initialRole }) {
  const seat = initialSeat, role = initialRole;
  const status = state.agentStatus[`${role}:${seat}`];
  const profile = state.profiles[`${role}:${seat}`];
  const commandMode = profile?.launchMode === 'command' || !!profile?.command;
  const [form, setForm] = useState(() => ({
    provider: 'builtin', baseUrl: '', model: '', personality: '',
    launchMode: commandMode ? 'command' : 'script', transport: commandMode ? 'jsonl' : 'mcp',
    name: role === 'coach' ? '教练' : state.seats[seat].name, ...profile, apiKey: ''
  }));
  const [saved, setSaved] = useState(!!profile);
  const [argsText, setArgsText] = useState(() => JSON.stringify(profile?.args || []));
  const locked = state.started && !state.matchOver;
  const change = (key, value) => { setForm(f => ({ ...f, [key]: value })); setSaved(false); };
  return <><div className="modal-heading"><h2>{role === 'coach' ? '教练连接' : `${state.seats[seat].name} · 连接`}</h2>{locked && <p>对局中 · 配置已锁定</p>}</div><div className="settings-content"><ConnectionStatus status={status} label={role === 'coach' ? '教练连接' : '牌友连接'} /><fieldset disabled={locked}>
      <div className="form-grid"><label>角色名字<input value={form.name || ''} onChange={e => change('name', e.target.value)} maxLength={40} /></label><label>服务协议<select value={form.provider || 'builtin'} onChange={e => change('provider', e.target.value)}><option value="builtin">本地机器人（无需 API）</option><option value="openai-compatible">OpenAI 兼容协议</option><option value="anthropic">Anthropic Messages</option><option value="process">本机 Agent 进程（事件推送）</option></select></label></div>
      {form.provider === 'process' && <><label>启动方式<select value={form.launchMode || 'script'} onChange={e => change('launchMode', e.target.value)}><option value="script">启动脚本</option><option value="command">高级命令</option></select></label>
        <label>交互方式<select value={form.transport || 'mcp'} onChange={e => change('transport', e.target.value)}><option value="mcp">MCP 工具 · 单次任务</option><option value="task">单次任务 · 执行后退出</option><option value="jsonl">持续协议 · JSONL</option></select></label>
        {form.launchMode !== 'command' ? <label>脚本路径<input placeholder="D:/my-agent/start.ps1" value={form.script || ''} onChange={e => change('script', e.target.value)} /></label> : <><label>可执行程序路径<input placeholder="D:/my-agent/agent.exe" value={form.command || ''} onChange={e => change('command', e.target.value)} /></label><label>进程参数（JSON 数组）<textarea rows={2} value={argsText} onChange={e => { setArgsText(e.target.value); setSaved(false); }} placeholder={'["--print"]'} /></label></>}
        <details className="runtime-options"><summary>运行与网络</summary>
          {form.launchMode !== 'command' && <label>解释器路径（可选）<input placeholder="自动使用 bash / PowerShell / cmd" value={form.interpreter || ''} onChange={e => change('interpreter', e.target.value)} /></label>}
          <label>工作目录（可选）<input value={form.cwd || ''} onChange={e => change('cwd', e.target.value)} /></label>
          <label>代理地址（可选）<input placeholder="http://127.0.0.1:7890" value={form.proxy || ''} onChange={e => change('proxy', e.target.value)} /></label>
          <label>绕过代理（可选）<input placeholder="localhost,127.0.0.1" value={form.noProxy || ''} onChange={e => change('noProxy', e.target.value)} /></label>
        </details>
      </>}
      {['openai-compatible', 'anthropic'].includes(form.provider) && <><label>API 基础地址<input placeholder="http://localhost:11434/v1" value={form.baseUrl || ''} onChange={e => change('baseUrl', e.target.value)} /></label><div className="form-grid"><label>模型名称<input placeholder="服务中可用的模型名称" value={form.model || ''} onChange={e => change('model', e.target.value)} /></label><label>API 密钥<input type="password" autoComplete="off" placeholder={form.hasKey ? '已保存；留空保留原密钥' : '本地服务可留空'} value={form.apiKey || ''} onChange={e => change('apiKey', e.target.value)} /></label></div></>}
      <label>角色性格<textarea rows={3} value={form.personality || ''} maxLength={2000} placeholder="喜欢聊天，偶尔嘴硬，出牌谨慎。" onChange={e => change('personality', e.target.value)} /></label>
      {role === 'coach' && <Switch label="主动提示" checked={!!form.proactive} onChange={v => change('proactive', v)} />}
      {role === 'player' && ['openai-compatible', 'anthropic', 'process'].includes(form.provider) && <Switch label="桌边主动发言" checked={!!form.eventChat} onChange={v => change('eventChat', v)} />}
      </fieldset>
      <div className="modal-actions"><span>{status?.state === 'checking' ? '正在检查连接…' : status?.checked ? '连接检查通过' : saved ? '配置已保存' : '未保存'}</span><button className="secondary" disabled={!saved || status?.state === 'checking'} onClick={() => run(() => api('profile/check', { seat, role }))}>检查连接</button><button className="primary" disabled={locked} onClick={async () => { const result = await run(() => { const config = { ...form, args: form.provider === 'process' && form.launchMode === 'command' ? JSON.parse(argsText) : [] }; return api('profile', { seat, role, config }); }); if (result) setSaved(true); }}>保存配置</button></div>
    </div></>;
}
