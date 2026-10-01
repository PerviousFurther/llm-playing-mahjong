import { agentLaunch } from './agent-launch.js';
import { proxyAddress } from './agent-runtime.js';

export function migrateProfiles(profiles) {
  for (const config of Object.values(profiles)) {
    if (config.launchMode === 'script' && config.transport !== 'jsonl'
      && /[\\/]shortcut[\\/](codex|qoder|dsh)[\\/]start\.(ps1|bat|cmd|sh)$/i.test(config.script || '')) config.transport = 'mcp';
  }
  return profiles;
}

export function agentConfig(config, previous, name, role) {
  if (!['builtin', 'openai-compatible', 'anthropic', 'process'].includes(config.provider)) throw new Error('模型协议无效');
  if (config.provider === 'process') {
    if (config.transport !== undefined && !['mcp', 'task', 'jsonl'].includes(config.transport)) throw new Error('Agent 交互方式无效');
    agentLaunch(config);
    proxyAddress(config.proxy);
  } else if (config.provider !== 'builtin') {
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址需要是 HTTP(S) 基础地址');
    if (!config.model?.trim()) throw new Error('请输入模型名称');
  }
  const launchMode = config.launchMode === 'script' ? 'script' : 'command';
  return {
    provider: config.provider, baseUrl: config.baseUrl || '', model: config.model || '',
    apiKey: config.apiKey === undefined || config.apiKey === '' ? previous?.apiKey || '' : config.apiKey,
    name: String(config.name || name).slice(0, 40), personality: String(config.personality || '').slice(0, 2000),
    proactive: role === 'coach' && !!config.proactive, eventChat: !!config.eventChat,
    ...Object.fromEntries(['command', 'cwd', 'script', 'interpreter', 'proxy', 'noProxy'].map(key => [key, String(config[key] || '').trim()])),
    args: config.args || [], launchMode, transport: config.transport || (launchMode === 'script' ? 'mcp' : 'jsonl')
  };
}
