import React from 'react';

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
