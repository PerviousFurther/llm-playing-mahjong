import { spawnAgent, terminateAgent } from './agent-runtime.js';

export const modelServiceKey = config => JSON.stringify(['script', 'command', 'args', 'launchMode', 'cwd', 'interpreter', 'proxy', 'noProxy'].map(k => config[k] || ''));
export const managedModel = config => config?.provider === 'openai-compatible' && config.localServer;

// Services are shared across seats; task cancellation does not unload a model.
export class ModelServices {
  constructor(onChange = () => {}) {
    this.services = new Map(); this.owners = new Map(); this.stopping = new Map(); this.records = new Map(); this.onChange = onChange;
  }
  record(config) {
    const key = modelServiceKey(config);
    if (!this.records.has(key)) this.records.set(key, { tasks: 0, failedTasks: 0, cancelledTasks: 0, totalTaskMs: 0, requests: 0, failedRequests: 0, totalRequestMs: 0 });
    return this.records.get(key);
  }
  finishTask(config, task, outcome) {
    if (!managedModel(config) || task.modelCounted || !task.startedAt) return;
    task.modelCounted = true;
    const record = this.record(config);
    if (outcome === 'cancelled') record.cancelledTasks++;
    else if (outcome === 'error') record.failedTasks++;
    else {
      record.tasks++;
      record.lastTaskMs = Date.now() - (task.modelReadyAt || task.startedAt);
      record.totalTaskMs += record.lastTaskMs;
    }
  }
  request(config, task, message) {
    if (!managedModel(config)) return;
    task.modelRequestActive = message.phase === 'start';
    if (message.phase !== 'end') return;
    const record = this.record(config);
    record.requests++; record.failedRequests += message.failed ? 1 : 0;
    record.lastRequestMs = message.durationMs; record.totalRequestMs += message.durationMs;
    record.lastUsage = message.usage;
  }
  snapshot(config) {
    const key = modelServiceKey(config), service = this.services.get(key), record = this.record(config);
    return { ...record, state: this.stopping.has(key) ? 'stopping' : service?.state || 'stopped',
      pid: service?.child?.pid, startedAt: service?.startedAt, readyAt: service?.readyAt,
      model: service?.model || record.model, baseUrl: service?.baseUrl || record.baseUrl,
      averageTaskMs: record.tasks ? record.totalTaskMs / record.tasks : null,
      averageRequestMs: record.requests ? record.totalRequestMs / record.requests : null };
  }
  async connect(config, owner) {
    const key = modelServiceKey(config);
    if (this.owners.get(owner) !== key) this.release(owner);
    this.owners.set(owner, key);
    await this.stopping.get(key);
    if (this.owners.get(owner) !== key) throw new Error('模型连接已取消');
    let service = this.services.get(key);
    if (!service) {
      service = { owners: new Set([...this.owners].filter(([, value]) => value === key).map(([name]) => name)), controller: new AbortController(), state: 'starting', startedAt: Date.now(), record: this.record(config) };
      this.services.set(key, service);
      service.ready = this.start(config, service).catch(error => { service.failed = true; service.state = 'error'; service.record.lastError = error.message; this.onChange(); throw error; });
      service.ready.catch(() => {});
      this.onChange();
    }
    service.owners.add(owner);
    if (service.failed) {
      await this.stop(service);
      if (this.services.get(key) === service) this.services.delete(key);
      return this.connect(config, owner);
    }
    return service.ready;
  }
  async start(config, service) {
    const child = service.child = spawnAgent(config);
    service.closed = new Promise(resolve => child.once('close', resolve));
    child.stdin.end();
    let diagnostics = '', pending = '', address, failure;
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-6000); });
    child.stdout.on('data', chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop().slice(-6000);
      for (const line of lines) {
        if (!line.startsWith('MAHJONG_MODEL_SERVICE ')) continue;
        try {
          const data = JSON.parse(line.slice('MAHJONG_MODEL_SERVICE '.length));
          const url = new URL(data.baseUrl);
          if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            || url.username || url.password || url.search || url.hash) throw new Error('模型服务地址必须是本机 HTTP 地址');
          address = { baseUrl: url.href.replace(/\/+$/, ''), apiKey: data.apiKey || '' };
          service.baseUrl = address.baseUrl; this.onChange();
        } catch (error) { failure = error; }
      }
    });
    const fail = error => {
      failure = error; service.failed = true;
      if (!service.controller.signal.aborted) { service.state = 'error'; service.record.lastError = error.message; this.onChange(); }
    };
    child.on('error', fail);
    child.on('close', code => fail(new Error(`模型服务脚本退出（${code}）：${diagnostics.trim()}`)));
    const signal = service.controller.signal;
    const deadline = Date.now() + 180000;
    try {
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (failure) throw failure;
        if (address) {
          try {
            const response = await fetch(`${address.baseUrl}/models`, {
              headers: address.apiKey ? { Authorization: `Bearer ${address.apiKey}` } : {},
              signal: AbortSignal.any([signal, AbortSignal.timeout(2000)])
            });
            if (response.ok) {
              const models = (await response.json()).data;
              if (!Array.isArray(models) || models.length !== 1 || !models[0]?.id) throw new Error('启动的模型服务必须提供一个模型');
              if (failure) throw failure;
              service.state = 'running'; service.readyAt = Date.now(); service.model = models[0].id; service.baseUrl = address.baseUrl;
              service.record.startupMs = service.readyAt - service.startedAt; service.record.lastError = undefined;
              service.record.model = service.model; service.record.baseUrl = service.baseUrl;
              this.onChange();
              return { ...address, model: models[0].id };
            }
          } catch (error) {
            if (signal.aborted || failure || error.message === '启动的模型服务必须提供一个模型') throw error;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(address ? '模型服务启动超时' : '启动脚本未报告模型服务地址，请使用 shortcut/llama/start.ps1');
    } catch (error) {
      service.failed = true;
      await terminateAgent(child);
      await service.closed;
      throw error;
    }
  }
  async stop(service) {
    if (service.stopped) return service.stopped;
    service.stopped = this.stopProcess(service);
    return service.stopped;
  }
  async stopProcess(service) {
    service.state = 'stopping'; this.onChange();
    service.controller.abort();
    await terminateAgent(service.child);
    await service.closed;
    await service.ready.catch(() => {});
  }
  release(owner) {
    const key = this.owners.get(owner); this.owners.delete(owner);
    const service = this.services.get(key);
    if (!service) return;
    service.owners.delete(owner);
    if (!service.owners.size) {
      this.services.delete(key);
      const stopping = this.stop(service);
      this.stopping.set(key, stopping);
      void stopping.finally(() => { if (this.stopping.get(key) === stopping) this.stopping.delete(key); });
    }
  }
  async stopIdle(config) {
    const key = modelServiceKey(config), service = this.services.get(key);
    if (!service) return;
    const stopping = this.stop(service);
    this.stopping.set(key, stopping); this.onChange();
    try { await stopping; }
    finally {
      if (this.services.get(key) === service) this.services.delete(key);
      if (this.stopping.get(key) === stopping) this.stopping.delete(key);
      this.onChange();
    }
  }
  async close() {
    const services = [...this.services.values()];
    this.services.clear(); this.owners.clear();
    await Promise.all([...this.stopping.values(), ...services.map(service => this.stop(service))]);
  }
}
