import { spawn } from 'node:child_process';
import { agentLaunch } from './agent-launch.js';
import { replyTarget } from '../shared/agent.js';
import { agentContext, compactRules } from './agent-context.js';

export function proxyAddress(value) {
  const address = String(value || '').trim();
  if (!address) return '';
  let url;
  try { url = new URL(address); } catch { throw new Error('代理地址需要是完整的 HTTP(S) 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('代理地址需要是 HTTP(S) 地址，不含账号、密码或路径');
  }
  return address;
}

function environment(config) {
  const env = { ...process.env }, proxy = proxyAddress(config.proxy);
  if (proxy) {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'WS_PROXY', 'WSS_PROXY']) {
      env[key] = env[key.toLowerCase()] = proxy;
    }
  }
  if (config.noProxy?.trim()) env.NO_PROXY = env.no_proxy = config.noProxy.trim();
  return env;
}

export function spawnAgent(config, options = {}) {
  const { command, args, ...launchOptions } = agentLaunch(config);
  return spawn(command, args, { ...launchOptions, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], ...options,
    env: { ...environment(config), ...options.env } });
}

export function terminateAgent(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => { child.kill(); resolve(); });
    killer.on('close', code => { if (code) child.kill(); resolve(); });
  });
}

export function taskInput(task) {
  return { type: 'task', id: task.id, seat: task.seat, role: task.role, mode: task.mode,
    context: { ...agentContext(task.context), rules: compactRules(task.context.state.rules) }, text: task.text || '', replyTarget: replyTarget(task),
    persona: { name: task.config.name, personality: task.config.personality } };
}
