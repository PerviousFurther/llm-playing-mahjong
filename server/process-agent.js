import { spawnAgent, terminateAgent, taskInput } from './agent-runtime.js';
import { scriptTask, closeScriptProcesses } from './script-agent.js';
import { agentOutput } from './agent-log.js';

let child, buffer = '', pending = new Map(), idleTimer, currentTask;
const IDLE_MS = 30000;
function stop(error) {
  clearTimeout(idleTimer); idleTimer = undefined;
  const previous = child; child = undefined; buffer = '';
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  return terminateAgent(previous);
}
function scheduleIdle() {
  clearTimeout(idleTimer);
  if (pending.size || !child) return;
  idleTimer = setTimeout(() => { if (!pending.size) stop(new Error('Agent 空闲退出')); }, IDLE_MS);
  idleTimer.unref();
}
function start(task) {
  currentTask = task;
  clearTimeout(idleTimer); idleTimer = undefined;
  if (child) return child;
  const process = spawnAgent(task.config);
  const output = agentOutput(() => currentTask);
  let diagnostics = '';
  child = process;
  process.on('error', error => { if (child === process) stop(new Error(`Agent 进程启动失败：${error.message}`)); });
  process.on('close', (code, signal) => { output.flush(); if (child === process) stop(new Error(`Agent 进程退出（${signal || code}）${diagnostics.trim() ? `：${diagnostics.trim()}` : '，请检查路径与参数并重试'}`)); });
  process.stdin.on('error', error => { if (child === process && error.code !== 'EPIPE') stop(error); });
  // stdout is reserved for protocol messages; logs belong on stderr.
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', chunk => { output.write('stderr', chunk); diagnostics = (diagnostics + chunk).slice(-6000); });
  process.stdout.on('data', chunk => {
    if (child !== process) return;
    output.write('stdout', chunk);
    buffer += chunk.toString('utf8');
    if (buffer.length > 1024 * 1024) { stop(new Error('Agent 输出超过 1 MB')); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line), request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id); scheduleIdle();
        if (message.type === 'error') request.reject(new Error(String(message.error || 'Agent 返回错误')));
        else request.resolve(message.result);
      } catch { stop(new Error('Agent 标准输出需要是一行一个 JSON 对象；日志请写入 stderr')); return; }
    }
  });
  process.stdout.setEncoding('utf8');
  return process;
}

export function processTask(task, signal, session) {
  if (task.config.transport === 'mcp') return scriptTask(task, signal, session);
  if ((task.config.transport || (task.config.launchMode === 'script' ? 'task' : 'jsonl')) === 'task') return scriptTask(task, signal);
  return new Promise((resolve, reject) => {
    const process = start(task);
    const finish = callback => value => { signal.removeEventListener('abort', cancel); callback(value); };
    const cancel = () => {
      pending.delete(task.id);
      scheduleIdle();
      if (process.stdin.writable) process.stdin.write(JSON.stringify({ type: 'cancel', id: task.id }) + '\n');
      reject(new Error('请求已取消或进程响应超时'));
    };
    pending.set(task.id, { resolve: finish(resolve), reject: finish(reject) });
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    process.stdin.write(JSON.stringify(taskInput(task)) + '\n');
  });
}

export async function closeProcess() { await Promise.all([stop(new Error('进程已关闭')), closeScriptProcesses()]); }
process.on('disconnect', async () => { await closeProcess(); process.exit(0); });
process.on('SIGTERM', async () => { await closeProcess(); process.exit(0); });
