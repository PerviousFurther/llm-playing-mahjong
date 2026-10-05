import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { ErrorDetails } from './agent-status.jsx';
import { elapsedTime } from '../shared/event-time.js';
import './model-service-status.css';

const labels = { stopped: '未启动', starting: '启动中', running: '运行中', stopping: '停止中', error: '运行失败' };
const seconds = value => value == null ? '—' : `${(value / 1000).toFixed(1)} 秒`;

export function ModelServiceStatus({ service, seat, role, run }) {
  const [now, setNow] = useState(Date.now()), [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!['starting', 'running'].includes(service?.state)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [service?.state, service?.startedAt]);
  return <section className="model-service-status" aria-label="本机模型服务">
    <div className="model-service-heading"><strong>本机模型服务</strong><span className={`model-service-state service-${service?.state || 'stopped'}`}><i />{labels[service?.state] || '未启动'}</span></div>
    <div className="model-service-address"><strong>{service?.model || '模型待检测'}</strong><small>{service?.baseUrl || '连接时启动并检测地址'}{service?.pid && ` · PID ${service.pid}`}</small></div>
    {service?.owners?.length > 0 && <p className="model-service-owners">共用角色：{service.owners.map(owner => `${owner.name}${owner.key.startsWith('coach:') ? '（教练）' : ''}`).join('、')}</p>}
    <dl className="model-service-metrics">
      <div><dt>运行时长</dt><dd>{service?.state === 'running' && service.readyAt ? elapsedTime(new Date(Math.max(now, service.readyAt)).toISOString(), new Date(service.readyAt).toISOString()) : '—'}</dd></div>
      <div><dt>启动耗时</dt><dd>{service?.state === 'starting' ? seconds(Math.max(0, now - service.startedAt)) : seconds(service?.startupMs)}</dd></div>
      <div><dt>当前请求 / 执行任务</dt><dd>{service?.activeRequests || 0} / {service?.activeTasks || 0}</dd></div>
      <div><dt>等待任务</dt><dd>{service?.queuedTasks || 0}</dd></div>
      <div><dt>最近任务 / 平均</dt><dd>{seconds(service?.lastTaskMs)} / {seconds(service?.averageTaskMs)}</dd></div>
      <div><dt>最近请求 / 平均</dt><dd>{seconds(service?.lastRequestMs)} / {seconds(service?.averageRequestMs)}</dd></div>
      <div><dt>成功 / 失败 / 取消任务</dt><dd>{service?.tasks || 0} / {service?.failedTasks || 0} / {service?.cancelledTasks || 0}</dd></div>
      <div><dt>请求总数 / 失败</dt><dd>{service?.requests || 0} / {service?.failedRequests || 0}</dd></div>
      {service?.lastUsage && <div><dt>最近请求 Token · 输入 / 输出</dt><dd>{service.lastUsage.inputTokens ?? '—'} / {service.lastUsage.outputTokens ?? '—'}</dd></div>}
      {service?.lastUsage?.outputTokensPerSecond != null && <div><dt>服务报告的生成速度</dt><dd>{service.lastUsage.outputTokensPerSecond.toFixed(1)} t/s</dd></div>}
    </dl>
    <ErrorDetails error={service?.lastError} />
    <div className="model-service-actions"><small>{service?.activeTasks || service?.queuedTasks ? '任务使用中，暂不可停止' : '停止后，下次连接会自动启动'}</small><button className="secondary" disabled={!service?.canStop || stopping} onClick={async () => {
      setStopping(true);
      try { await run(() => api('model-service/stop', { seat, role })); }
      finally { setStopping(false); }
    }}>{stopping ? '正在停止…' : '停止服务'}</button></div>
    <p className="form-note">统计自游戏服务启动起累计。任务耗时仅统计成功任务，不含模型启动和排队；请求耗时包含输入处理与生成。</p>
  </section>;
}
