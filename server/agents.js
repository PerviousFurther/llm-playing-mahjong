import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { agentConfig } from './agent-config.js';
import { agentLog } from './agent-log.js';
import { shortReply, replyTarget } from '../shared/agent.js';
import { handReview } from './hand-review.js';
import { ModelServices, managedModel, modelServiceKey } from './model-service.js';

export class Agents {
  constructor(room, profiles = {}) {
    this.room = room; this.profiles = profiles; this.workers = new Map(); this.tasks = new Map(); this.status = {};
    this.version = -1; this.queues = new Map(); this.active = new Map(); this.decisionErrors = new Map(); this.drainTimers = new Map();
    this.reviewedHands = new Set();
    this.retiringTasks = new Map();
    this.models = new ModelServices(() => this.room.onChange());
  }
  config(seat, role = 'player') {
    if (role === 'player' && this.room.seats[seat].type === 'bot') return { provider: 'builtin', name: this.room.seats[seat].name };
    return this.profiles[`${role}:${seat}`] || { provider: 'builtin', name: role === 'coach' ? '教练' : this.room.seats[seat].name };
  }
  publicProfiles() {
    return Object.fromEntries(Object.entries(this.profiles).map(([key, value]) => {
      const { apiKey, ...safe } = value; return [key, { ...safe, hasKey: !!apiKey }];
    }));
  }
  publicModelServices() {
    const groups = new Map(), result = {};
    for (const [owner, config] of Object.entries(this.profiles)) {
      if (!managedModel(config)) continue;
      const key = modelServiceKey(config);
      if (!groups.has(key)) groups.set(key, { ...this.models.snapshot(config), owners: [], activeTasks: 0, activeRequests: 0, queuedTasks: 0 });
      const service = groups.get(key);
      service.owners.push({ key: owner, name: config.name || owner });
      service.queuedTasks += this.queues.get(owner)?.length || 0;
      result[owner] = service;
    }
    for (const task of [...this.tasks.values(), ...this.retiringTasks.values()]) {
      if (!managedModel(task.modelConfig)) continue;
      const service = groups.get(modelServiceKey(task.modelConfig));
      if (service) { service.activeTasks++; if (task.modelRequestActive) service.activeRequests++; }
    }
    for (const service of groups.values()) service.canStop = ['running', 'error'].includes(service.state) && !service.activeTasks && !service.queuedTasks;
    return result;
  }
  async stopModelService(seat, role = 'player') {
    this.requireRole(seat, role);
    const owner = `${role}:${seat}`, config = this.profiles[owner];
    if (!managedModel(config)) throw new Error('该连接没有由游戏启动的模型服务');
    if (!this.publicModelServices()[owner].canStop) throw new Error('服务未运行或仍有任务正在使用，请先暂停牌局并等待任务结束');
    await this.models.stopIdle(config);
  }
  requireRole(seat, role) {
    if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !['player', 'coach'].includes(role)) throw new Error('角色或座位无效');
    if (role === 'coach' && (seat !== 0 || this.room.seats[0].type !== 'human')) throw new Error('由我游玩时才能使用教练');
  }
  configure(seat, role, config) {
    this.requireRole(seat, role);
    if (this.room.game && !this.room.matchOver) throw new Error('请在对局结束后修改模型配置');
    const key = `${role}:${seat}`;
    this.profiles[key] = agentConfig(config, this.profiles[key], role === 'coach' ? '教练' : this.room.seats[seat].name, role);
    this.models.release(key);
    this.reset(key);
    if (role === 'coach') this.lastCoachVersion = -1;
    if (role === 'player') {
      this.room.seats[seat].name = this.profiles[key].name;
      if (this.room.seats[seat].type !== 'human') this.room.seats[seat].type = config.provider === 'builtin' ? 'bot' : 'llm';
      if (seat === 0 && this.room.seats[seat].type !== 'human') this.reset('coach:0');
    }
    this.room.changed(); this.room.dispatch();
  }
  worker(key) {
    if (this.workers.has(key)) return this.workers.get(key);
    const child = fork(fileURLToPath(new URL('./agent-worker.js', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    this.workers.set(key, child); this.status[key] = { state: 'ready', pid: child.pid };
    child.on('message', msg => this.receive(key, msg));
    child.on('error', () => { this.status[key] = { state: 'error', error: '子进程启动失败' }; this.room.changed(); });
    child.on('exit', () => {
      if (this.workers.get(key) !== child) return;
      this.workers.delete(key); this.status[key] = { state: 'error', error: '子进程已退出，可重试' };
      for (const [id, t] of this.tasks) if (t.key === key) { this.models.finishTask(t.modelConfig, t, 'error'); this.tasks.delete(id); }
      this.queues.delete(key); this.active.delete(key); this.room.changed();
    });
    return child;
  }
  syncVersion(force = false) {
    if (!force && this.version === this.room.version) return;
    this.version = this.room.version;
    for (const [key, queue] of this.queues) this.queues.set(key, queue.filter(t => !['decision', 'advice'].includes(t.mode)));
    for (const [id, task] of this.tasks) if (['decision', 'advice'].includes(task.mode) && !task.cancelled) {
      if (task.actionSubmitted && !force) continue;
      task.cancelled = true; this.workers.get(task.key)?.send({ type: 'cancel', id });
      agentLog(task, '取消过期任务');
    }
  }
  decision(seat, context) { this.syncVersion(); this.task(seat, 'player', 'decision', context); }
  check(seat, role = 'player') {
    this.requireRole(seat, role);
    const key = `${role}:${seat}`;
    if (this.status[key]?.state === 'error' && !this.active.has(key)) this.reset(key);
    this.task(seat, role, 'check', this.room.context(seat, role), 'Reply briefly to confirm the connection. Do not make a game action.');
  }
  notifyPhase(type) {
    if (this.room.paused) return;
    this.syncVersion();
    const review = handReview(this.room, type);
    if (review && !this.reviewedHands.has(review.index)) {
      this.reviewedHands.add(review.index);
      for (const seat of this.room.seats.filter(s => s.type === 'llm')) this.task(seat.id, 'player', 'review', this.room.context(seat.id),
        `Round ${review.index + 1} ended: ${JSON.stringify(review.facts)}. In character, send short chat messages in Chinese to sharing your feelings and quick thoughts on 1–2 players based strictly on public facts. No game actions.`);
    }
    if (!['dapai', 'fulou', 'gang'].includes(type)) return;
    for (const seat of this.room.seats) {
      const config = this.config(seat.id);
      if (!['bot', 'llm'].includes(seat.type) || this.room.pending.has(seat.id)) continue;
      if (seat.id === this.room.game?.model.player_id[this.room.game.model.lunban]) continue;
      if (config.eventChat) {
        this.task(seat.id, 'player', 'event', this.room.context(seat.id), `Table event: ${type}. React in character to this public play or a recent remark from another player. Prefer a relevant response over narrating the action. Use send_message, then finish_task; if there is nothing new to add, just finish_task. No action is requested.`);
      }
    }
  }
  proactiveCoach(context) {
    if (this.room.seats[0].type !== 'human') return;
    if (!this.config(0, 'coach').proactive || this.room.paused || this.lastCoachVersion === this.room.version) return;
    this.lastCoachVersion = this.room.version;
    this.syncVersion();
    this.task(0, 'coach', 'advice', context, 'Give one short suggestion for my current decision. Do not take any action.');
  }
  task(seat, role, mode, context, text, replyTo) {
    this.requireRole(seat, role);
    const key = `${role}:${seat}`;
    const queue = this.queues.get(key) || [];
    if (['decision', 'advice', 'check'].includes(mode) && ([...this.tasks.values(), ...queue].some(t => t.key === key && t.mode === mode && !t.cancelled && t.version === this.room.version))) return;
    const running = this.tasks.get(this.active.get(key));
    if (mode === 'decision' && running && !running.cancelled && ['chat', 'event', 'advice', 'review'].includes(running.mode)) {
      running.cancelled = true;
      if (['chat', 'review'].includes(running.mode) && !running.messagesSent) queue.unshift({ ...running, id: randomUUID(), cancelled: false, queuedAt: Date.now() });
      this.workers.get(key)?.send({ type: 'cancel', id: running.id });
      agentLog(running, '让位给牌局动作', '未回复的聊天稍后继续');
    }
    const task = { id: randomUUID(), key, seat, role, mode, context, text, replyTo, version: this.room.version, queuedAt: Date.now() };
    if (mode === 'decision') queue.unshift(task); else queue.push(task);
    if (this.config(seat, role).provider !== 'builtin') agentLog(task, '任务入队', `等待=${queue.length}，忙碌=${this.active.has(key)}`);
    this.queues.set(key, queue);
    if (['chat', 'event'].includes(mode) && !this.active.has(key)) {
      if (!this.drainTimers.has(key)) this.drainTimers.set(key, setTimeout(() => { this.drainTimers.delete(key); this.drain(key); }, 80));
    } else { clearTimeout(this.drainTimers.get(key)); this.drainTimers.delete(key); this.drain(key); }
  }
  drain(key) {
    if (this.active.has(key)) return;
    const queue = this.queues.get(key) || [];
    const task = queue.shift(); if (!task) return;
    if (['chat', 'event'].includes(task.mode)) {
      const batch = [task];
      // Batch notifications only when they share a reply target.
      while (queue.length && ['chat', 'event'].includes(queue[0].mode) && queue[0].replyTo === task.replyTo) batch.push(queue.shift());
      if (batch.length > 1) {
        task.mode = batch.some(t => t.mode === 'chat') ? 'chat' : 'event';
        task.text = `Summarize these notifications (combine related updates):\n` + batch.map((t, i) => `${i + 1}. [${t.mode}] ${t.text || 'Table update'}`).join('\n');
        agentLog(task, '合并待处理消息', `${batch.length} 条 · 回复目标=${replyTarget(task)}`);
      }
    }
    if (!['decision', 'advice', 'review'].includes(task.mode)) task.context = this.room.context(task.seat, task.role);
    task.context.memory = this.room.memories[key] || null;
    const { id, seat, role, mode, context, text } = task;
    const child = this.worker(key);
    this.active.set(key, id); this.tasks.set(id, task);
    task.startedAt = Date.now();
    task.modelConfig = this.config(seat, role); task.modelCounted = false; task.modelReadyAt = undefined; task.modelRequestActive = false;
    if (task.modelConfig.provider !== 'builtin') agentLog(task, '开始执行', `${this.room.seats[seat].name}，排队 ${task.startedAt - task.queuedAt}ms，版本=${context.state.version}，阶段=${context.state.phase}，出牌座位=${context.state.turn.discardSeat ?? '无'}，可选动作=${context.state.legalActions.length}`);
    this.status[key] = { state: mode === 'check' ? 'checking' : mode === 'decision' ? 'thinking' : 'chatting', pid: child.pid, error: this.decisionErrors.get(key), errorKind: this.status[key]?.errorKind };
    if (role === 'player' && mode !== 'check') this.room.expression(seat, 'thinking');
    child.send({ type: 'task', id, seat, role, mode, context, text, replyTo: task.replyTo, config: task.modelConfig }); this.room.onChange();
  }
  message(seat, text, target, speaker = 'agent', expression) {
    const reply = shortReply(text);
    if (!reply) throw new Error('send message cannot be empty.');
    const event = this.room.chat(seat, reply, target, speaker, expression);
    if (speaker === 'agent' && target.startsWith('seat:')) {
      const recipient = Number(target.slice(5));
      if (this.room.seats[recipient]?.type === 'llm') this.task(recipient, 'player', 'chat', this.room.context(recipient), `${this.room.seats[seat].name} 私聊：${reply}`, seat);
    }
    if (speaker === 'agent') this.room.expression(seat, expression || (this.room.seats[seat].expression === 'thinking' ? 'idle' : this.room.seats[seat].expression), reply);
    return { sent: true, eventId: event.id };
  }
  submitAction(task, reply) {
    if (task.role !== 'player' || task.mode !== 'decision' || task.actionSubmitted) throw new Error('game action is not allow here.');
    const result = this.room.action(task.seat, { action: reply.action, value: reply.value, stateVersion: task.version, requestId: task.id });
    task.actionSubmitted = true;
    this.decisionErrors.delete(task.key);
    if (shortReply(reply.speech)) this.message(task.seat, reply.speech, 'public', 'agent', reply.expression);
    else this.room.expression(task.seat, 'idle');
    if (this.config(task.seat, task.role).provider !== 'builtin') agentLog(task, '动作已提交', `${reply.action} ${reply.value || ''}`);
    return result;
  }
  async receiveTool(key, msg) {
    const task = this.tasks.get(msg.id), child = this.workers.get(key);
    let result, error;
    try {
      if (!task || task.key !== key || task.cancelled) throw new Error('task is aborted or finished.');
      const args = msg.arguments;
      if (msg.name === 'start_model') {
        const config = this.config(task.seat, task.role);
        if (!managedModel(config)) throw new Error('此连接未配置本机模型服务');
        this.status[key] = { ...this.status[key], tool: 'start_model' }; this.room.onChange();
        result = await this.models.connect(config, key);
        task.modelReadyAt = Date.now();
        if (!task.cancelled) { this.status[key] = { ...this.status[key], tool: null }; this.room.onChange(); }
      } else if (msg.name === 'read_context') {
        result = this.room.context(task.seat, task.role);
      } else if (msg.name === 'update_memory') {
        if (task.mode === 'check' || task.actionSubmitted) throw new Error('Memory update is not allowed after completion or during connection checks');
        result = this.room.updateMemory(task.seat, task.role, args.text);
        if (result.saved) agentLog(task, '记忆已更新', `${this.config(task.seat, task.role).name}\n${args.text.trim() || '（已清空）'}`);
      } else if (msg.name === 'action') {
        result = this.submitAction(task, args);
      } else if (msg.name === 'send_message') {
        if (task.role === 'coach' && args.target !== 'coach' || task.role === 'player' && args.target !== 'public' && !/^seat:[0-3]$/.test(args.target)
          || args.target === `seat:${task.seat}`) throw new Error('target is invalid.');
        result = this.message(task.seat, args.text, args.target, task.role === 'coach' ? 'coach' : 'agent', args.expression);
        task.messagesSent = (task.messagesSent || 0) + 1;
        agentLog(task, '消息已发送', args.target);
      } else throw new Error('unknown operation.');
    } catch (e) { error = e.message; }
    if (child?.connected) child.send({ type: 'tool-result', callId: msg.callId, result, error });
  }
  receive(key, msg) {
    if (msg.type === 'tool-call') { this.receiveTool(key, msg); return; }
    const task = this.tasks.get(msg.id) || (msg.type === 'model-request' && this.retiringTasks.get(msg.id)); if (!task) return;
    if (task.key !== key) return;
    if (msg.type === 'model-request') {
      this.models.request(task.modelConfig, task, msg); this.room.onChange(); return;
    }
    if (msg.type === 'activity') {
      if (!task.cancelled && !task.actionSubmitted) {
        this.status[key] = { ...this.status[key], tool: msg.tool, lastTool: msg.tool || this.status[key]?.lastTool };
        this.room.onChange();
      }
      return;
    }
    if (this.config(task.seat, task.role).provider !== 'builtin') agentLog(task, msg.type === 'error' ? '任务失败' : '收到结果', `耗时=${Date.now() - task.startedAt}ms${msg.result?.action ? `，动作=${msg.result.action} ${msg.result.value || ''}` : ''}`);
    let outcome = 'success';
    try {
      if (task.cancelled || !task.actionSubmitted && ['decision', 'advice'].includes(task.mode) && task.version !== this.room.version) {
        outcome = 'cancelled';
        this.status[key] = { state: 'ready', pid: this.workers.get(key)?.pid }; this.room.onChange(); return;
      }
      if (msg.type === 'error' && !task.actionSubmitted) throw Object.assign(new Error(msg.error), { errorKind: msg.errorKind });
      const r = task.actionSubmitted ? { toolResult: true, actionSubmitted: true } : msg.result;
      if (!r || typeof r !== 'object') throw new Error('Agent need return json object.');
      if (task.mode === 'check') {
        if (typeof r.text !== 'string' || !r.text.trim()) throw new Error('Must return non-null text here.');
      } else if (r.toolResult) {
        if (task.mode === 'decision' && !task.actionSubmitted) throw new Error('Agent havent apply game operation.');
      } else if (task.mode === 'decision') {
        if (this.room.paused) return;
        this.submitAction(task, r);
      } else {
        if (shortReply(r.text)) this.message(task.seat, r.text, replyTarget(task), task.role === 'coach' ? 'coach' : 'agent', r.expression);
      }
      const error = task.mode === 'check' ? undefined : this.decisionErrors.get(key);
      this.status[key] = { state: error ? 'error' : 'ready', checked: !error, checkedAt: new Date().toISOString(),
        error, errorKind: error ? this.status[key]?.errorKind : undefined, pid: this.workers.get(key)?.pid };
      if (task.mode === 'check') this.room.onChange(); else this.room.changed();
    } catch (error) {
      outcome = 'error';
      agentLog(task, '结果校验或动作提交失败', error.message);
      if (task.mode === 'decision') this.decisionErrors.set(key, error.message);
      this.status[key] = { state: 'error', error: error.message, errorKind: error.errorKind, pid: this.workers.get(key)?.pid }; this.room.changed();
    } finally {
      this.models.finishTask(task.modelConfig, task, outcome);
      if (task.role === 'player' && this.room.seats[task.seat].expression === 'thinking') this.room.expression(task.seat, 'idle');
      this.tasks.delete(msg.id); this.active.delete(key); this.drain(key); this.room.onChange();
    }
  }
  retry(seat, role = 'player') { this.reset(`${role}:${seat}`); if (role === 'player') this.room.dispatch(); }
  reset(key) {
    clearTimeout(this.drainTimers.get(key)); this.drainTimers.delete(key);
    this.queues.delete(key); this.active.delete(key); this.decisionErrors.delete(key);
    const child = this.workers.get(key); this.workers.delete(key);
    const retiring = [];
    for (const [id, t] of this.tasks) if (t.key === key) {
      this.models.finishTask(t.modelConfig, t, 'cancelled'); this.tasks.delete(id);
      if (child && managedModel(t.modelConfig)) { this.retiringTasks.set(id, t); retiring.push(id); }
    }
    if (child) {
      child.once('exit', () => { for (const id of retiring) this.retiringTasks.delete(id); this.room.onChange(); });
      if (child.connected) child.send({ type: 'shutdown' }, () => {});
      const timer = setTimeout(() => child.kill(), 5000); timer.unref();
    }
    delete this.status[key];
  }
  async close({ models = false } = {}) { for (const key of new Set([...this.workers.keys(), ...this.drainTimers.keys()])) this.reset(key); this.queues.clear(); this.tasks.clear(); this.active.clear(); this.reviewedHands.clear(); if (models) await this.models.close(); }
}
