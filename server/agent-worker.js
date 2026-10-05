import { builtinTask } from './builtin-agent.js';
import { randomUUID } from 'node:crypto';
import { scriptTask, closeScriptProcesses } from './script-agent.js';
import { createToolSession } from './agent-tools.js';
import { apiTask } from './api-agent.js';
import { agentLog } from './agent-log.js';

const active = new Map();
const toolRequests = new Map();
async function shutdown() {
  const tasks = [...active.values()];
  for (const task of tasks) task.controller.abort();
  await closeScriptProcesses();
  await Promise.all(tasks.map(task => task.done));
  process.exit(0);
}
process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
function requestTool(task, signal, name, args) {
  return new Promise((resolve, reject) => {
    const callId = randomUUID();
    const abort = () => { toolRequests.delete(callId); reject(new Error('工具任务已取消')); };
    const finish = callback => value => { toolRequests.delete(callId); signal.removeEventListener('abort', abort); callback(value); };
    toolRequests.set(callId, { resolve: finish(resolve), reject: finish(reject) });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    process.send?.({ type: 'tool-call', id: task.id, callId, name, arguments: args });
  });
}
process.on('message', async message => {
  if (message.type === 'tool-result') {
    const request = toolRequests.get(message.callId);
    if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result);
    return;
  }
  if (message.type === 'shutdown') {
    await shutdown();
    return;
  }
  if (message.type === 'cancel') {
    const item = active.get(message.id); item?.controller.abort();
    return;
  }
  if (message.type !== 'task') return;
  const controller = new AbortController();
  let complete;
  active.set(message.id, { controller, done: new Promise(resolve => { complete = resolve; }) });
  // Only the network request has a technical timeout; the table waits on failure.
  const timeout = setTimeout(() => controller.abort(), message.config.localServer ? 300000 : 120000);
  const started = Date.now();
  const heartbeat = setInterval(() => agentLog(message, '仍在等待回复', `${Math.round((Date.now() - started) / 1000)} 秒`), 15000);
  try {
    let result;
    const session = message.config.provider !== 'builtin' ? createToolSession(message, controller.signal,
      (name, args) => requestTool(message, controller.signal, name, args),
      tool => process.send?.({ type: 'activity', id: message.id, tool })) : undefined;
    if (message.config.provider === 'process') result = await scriptTask(message, controller.signal, session);
    else if (message.config.provider === 'builtin') result = builtinTask(message);
    else {
      if (message.config.localServer) {
        agentLog(message, '等待模型服务', '复用脚本 runner 启动，模型跨任务保留');
        const service = await requestTool(message, controller.signal, 'start_model', {});
        message.config = { ...message.config, ...service };
      }
      result = await apiTask(message, controller.signal, session, event => {
        if (message.config.localServer) process.send?.({ type: 'model-request', id: message.id, ...event });
      });
    }
    process.send?.({ type: 'result', id: message.id, result });
  } catch (error) {
    const detail = error.name === 'AbortError' ? '请求已取消或 API 请求超时，可重试' : error.message;
    agentLog(message, '任务执行失败', `${detail}\n耗时=${Date.now() - started}ms`);
    process.send?.({ type: 'error', id: message.id, error: detail, errorKind: error.code === 'INVALID_AGENT_REPLY' ? 'reply' : 'call' });
  } finally { clearTimeout(timeout); clearInterval(heartbeat); active.delete(message.id); complete(); }
});
