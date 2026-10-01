export function agentLog(task, event, details = '') {
  console.error(`[Agent ${new Date().toISOString()} ${task.role}:${task.seat} ${task.mode} ${task.id.slice(0, 8)}] ${event}${details ? ` · ${details}` : ''}`);
}

export function outputPreview(value, limit = 2000) {
  const text = String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|MAHJONG_TOOL_TOKEN)["']?\s*[=:]\s*)[^\s,}]+/gi, '$1[redacted]');
  return text.length > limit ? `${text.slice(0, limit)}\n…（截断，共 ${text.length} 字符）` : text || '（空）';
}

// Keep partial lines together so stream chunk boundaries do not split credentials.
export function agentOutput(task) {
  const buffers = { stdout: '', stderr: '' };
  const inputEcho = { stdout: false, stderr: false };
  const enabled = process.env.MAHJONG_AGENT_OUTPUT !== '0';
  const raw = process.env.MAHJONG_AGENT_OUTPUT === 'raw';
  const print = (channel, line) => {
    const clean = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
    if (!clean) return;
    if (!raw) {
      if (/^user$/.test(clean)) {
        inputEcho[channel] = true;
        agentLog(typeof task === 'function' ? task() : task, channel, '输入上下文回显已隐藏（MAHJONG_AGENT_OUTPUT=raw 可查看）');
        return;
      }
      if (inputEcho[channel]) {
        if (!/^(?:thinking|codex|assistant|mcp(?: startup)?:|error:|warning:)/.test(clean)) return;
        inputEcho[channel] = false;
      }
      // Tool snapshots can contain long histories; runner logs already record calls.
      if (/^\{.*"(?:publicContext|privateContext|publicEvents)"/.test(clean)) return;
    }
    agentLog(typeof task === 'function' ? task() : task, channel, outputPreview(line, raw ? 16384 : 1200));
  };
  return {
    write(channel, chunk) {
      if (!enabled) return;
      const lines = (buffers[channel] + chunk).split(/\r\n|[\r\n]/);
      buffers[channel] = lines.pop();
      for (const line of lines) print(channel, line);
      if (buffers[channel].length > 65536) { print(channel, buffers[channel]); buffers[channel] = ''; }
    },
    flush() {
      if (!enabled) return;
      for (const channel of Object.keys(buffers)) { print(channel, buffers[channel]); buffers[channel] = ''; }
    }
  };
}
