import React from 'react';

export function activityLabel(status) {
  if (status?.state === 'error') return connectionLabel(status);
  const tools = { start_model: '等待模型启动', get_turn: '查看牌局', get_hand: '查看手牌', get_player: '观察对手', get_messages: '查看对话', analyze_actions: '比较打法', update_memory: '整理记忆', send_message: '发送对话', finish_task: '结束回应' };
  if (status?.tool) return tools[status.tool] || '提交行动';
  if (['thinking', 'chatting', 'checking'].includes(status?.state) && status.lastTool) return `${tools[status.lastTool] || '提交行动'}完成 · 等待回复`;
  return { thinking: '等待决策回复', chatting: '等待对话回复', checking: '检查连接' }[status?.state];
}

export function connectionLabel(status) {
  if (status?.state === 'error') return status.errorKind === 'reply' ? '回复异常' : '调用失败';
  if (['thinking', 'chatting', 'checking'].includes(status?.state)) return '响应中';
  return status?.checked ? '已验证' : '未验证';
}

export function ErrorDetails({ error }) {
  if (!error) return null;
  return <details className="error-details"><summary>查看诊断 <span>展开 ↗</span></summary>
    <pre tabIndex={0}>{error}</pre>
  </details>;
}

export function ConnectionStatus({ status, label }) {
  return <div className={`agent-status ${status?.state === 'error' ? 'has-error' : ''}`}>
    <div className="agent-status-heading"><i className={`live-dot ${status?.state === 'error' ? 'offline-dot' : ''}`} />
      <strong>{label}</strong><span>{connectionLabel(status)}</span></div>
    <ErrorDetails error={status?.error} />
  </div>;
}
