import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { agentConfig, migrateProfiles } from './agent-config.js';
import { agentLog } from './agent-log.js';
import { shortReply, replyTarget } from '../shared/agent.js';
import { handReview } from './hand-review.js';

export class Agents {
  constructor(room, profiles = {}) {
    this.room = room; this.profiles = migrateProfiles(profiles); this.workers = new Map(); this.tasks = new Map(); this.status = {};
    this.version = -1; this.queues = new Map(); this.active = new Map(); this.decisionErrors = new Map(); this.drainTimers = new Map();
    this.reviewedHands = new Set();
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
  requireRole(seat, role) {
    if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !['player', 'coach'].includes(role)) throw new Error('角色或座位无效');
    if (role === 'coach' && (seat !== 0 || this.room.seats[0].type !== 'human')) throw new Error('由我游玩时才能使用教练');
  }
  configure(seat, role, config) {
    this.requireRole(seat, role);
    if (this.room.game && !this.room.matchOver) throw new Error('请在对局结束后修改模型配置');
    const key = `${role}:${seat}`;
    this.profiles[key] = agentConfig(config, this.profiles[key], role === 'coach' ? '教练' : this.room.seats[seat].name, role);
    this.reset(key);
    if (role === 'coach') this.lastCoachVersion = -1;
    if (role === 'player') {
      this.room.seats[seat].name = this.profiles[key].name;
      if (this.room.seats[seat].type !== 'human' && this.room.seats[seat].type !== 'external') this.room.seats[seat].type = config.provider === 'builtin' ? 'bot' : 'llm';
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
      for (const [id, t] of this.tasks) if (t.key === key) this.tasks.delete(id);
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
        `刚结束的第 ${review.index + 1} 局：${JSON.stringify(review.facts)}。用你自己的性格在全局聊天中简短复盘：说说自己的感受，以及对一两位其他角色这一局的印象。只依据这些公开事实，不臆造其想法或暗牌，不把某一局的表现当作永久性格。可以分两条短消息发送，无需逐项报分。这是已结束的上一局，不能执行牌局动作。`);
    }
    for (const seat of this.room.seats) {
      const config = this.config(seat.id);
      if (!['bot', 'llm'].includes(seat.type) || this.room.pending.has(seat.id)) continue;
      if (config.eventChat && ['zimo', 'gangzimo', 'dapai', 'fulou', 'gang'].includes(type)) {
        this.task(seat.id, 'player', 'event', this.room.context(seat.id), `Table event: ${type}. You may say one short public comment, or return an empty text. No action is requested.`);
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
      // Keep reply channels separate: legacy agents have only one reply target.
      while (queue.length && ['chat', 'event'].includes(queue[0].mode) && queue[0].replyTo === task.replyTo) batch.push(queue.shift());
      if (batch.length > 1) {
        task.mode = batch.some(t => t.mode === 'chat') ? 'chat' : 'event';
        task.text = `按时间顺序处理以下 ${batch.length} 条通知，可以合并回应；无需逐条复述：\n` + batch.map((t, i) => `${i + 1}. [${t.mode}] ${t.text || '查看最新牌桌事件'}`).join('\n');
        agentLog(task, '合并待处理消息', `${batch.length} 条 · 回复目标=${replyTarget(task)}`);
      }
    }
    if (!['decision', 'advice', 'review'].includes(task.mode)) task.context = this.room.context(task.seat, task.role);
    const { id, seat, role, mode, context, text } = task;
    const child = this.worker(key);
    this.active.set(key, id); this.tasks.set(id, task);
    task.startedAt = Date.now();
    if (this.config(seat, role).provider !== 'builtin') agentLog(task, '开始执行', `${this.room.seats[seat].name}，排队 ${task.startedAt - task.queuedAt}ms，版本=${context.state.version}，阶段=${context.state.phase}，出牌座位=${context.state.turn.discardSeat ?? '无'}，可选动作=${context.state.legalActions.length}`);
    this.status[key] = { state: mode === 'check' ? 'checking' : mode === 'decision' ? 'thinking' : 'chatting', pid: child.pid, error: this.decisionErrors.get(key), errorKind: this.status[key]?.errorKind };
    if (role === 'player' && mode !== 'check') this.room.expression(seat, 'thinking');
    child.send({ type: 'task', id, seat, role, mode, context, text, replyTo: task.replyTo, config: this.config(seat, role) }); this.room.onChange();
  }
  message(seat, text, target, speaker = 'agent', expression) {
    const reply = shortReply(text);
    if (!reply) throw new Error('消息不能为空');
    const event = this.room.chat(seat, reply, target, speaker, expression);
    if (speaker === 'agent' && target.startsWith('seat:')) {
      const recipient = Number(target.slice(5));
      if (this.room.seats[recipient]?.type === 'llm') this.task(recipient, 'player', 'chat', this.room.context(recipient), `${this.room.seats[seat].name} 私聊：${reply}`, seat);
    }
    if (speaker === 'agent') this.room.expression(seat, expression || (this.room.seats[seat].expression === 'thinking' ? 'idle' : this.room.seats[seat].expression), reply);
    return { sent: true, eventId: event.id };
  }
  submitAction(task, reply) {
    if (task.role !== 'player' || task.mode !== 'decision' || task.actionSubmitted) throw new Error('当前任务不能再次执行牌局动作');
    const result = this.room.action(task.seat, { action: reply.action, value: reply.value, stateVersion: task.version, requestId: task.id });
    task.actionSubmitted = true;
    this.decisionErrors.delete(task.key);
    if (shortReply(reply.speech)) this.message(task.seat, reply.speech, 'public', 'agent', reply.expression);
    else this.room.expression(task.seat, 'idle');
    if (this.config(task.seat, task.role).provider !== 'builtin') agentLog(task, '动作已提交', `${reply.action} ${reply.value || ''}`);
    return result;
  }
  receiveTool(key, msg) {
    const task = this.tasks.get(msg.id), child = this.workers.get(key);
    let result, error;
    try {
      if (!task || task.key !== key || task.cancelled) throw new Error('任务已结束或被取消');
      const args = msg.arguments;
      if (msg.name === 'get_table') {
        result = this.room.context(task.seat, task.role);
      } else if (msg.name === 'action') {
        result = this.submitAction(task, args);
      } else if (msg.name === 'send_message') {
        if (task.role === 'coach' && args.target !== 'coach' || task.role === 'player' && args.target !== 'public' && !/^seat:[0-3]$/.test(args.target)
          || args.target === `seat:${task.seat}`) throw new Error('聊天目标无效');
        result = this.message(task.seat, args.text, args.target, task.role === 'coach' ? 'coach' : 'agent', args.expression);
        task.messagesSent = (task.messagesSent || 0) + 1;
        agentLog(task, '消息已发送', args.target);
      } else throw new Error('未知工具操作');
    } catch (e) { error = e.message; }
    if (child?.connected) child.send({ type: 'tool-result', callId: msg.callId, result, error });
  }
  receive(key, msg) {
    if (msg.type === 'tool-call') { this.receiveTool(key, msg); return; }
    const task = this.tasks.get(msg.id); if (!task) return;
    if (this.config(task.seat, task.role).provider !== 'builtin') agentLog(task, msg.type === 'error' ? '任务失败' : '收到结果', `耗时=${Date.now() - task.startedAt}ms${msg.result?.action ? `，动作=${msg.result.action} ${msg.result.value || ''}` : ''}`);
    try {
      if (task.cancelled || !task.actionSubmitted && ['decision', 'advice'].includes(task.mode) && task.version !== this.room.version) {
        this.status[key] = { state: 'ready', pid: this.workers.get(key)?.pid }; this.room.onChange(); return;
      }
      if (msg.type === 'error' && !task.actionSubmitted) throw Object.assign(new Error(msg.error), { errorKind: msg.errorKind });
      const r = task.actionSubmitted ? { toolResult: true, actionSubmitted: true } : msg.result;
      if (!r || typeof r !== 'object') throw new Error('Agent 需要返回 JSON 对象');
      if (task.mode === 'check') {
        if (typeof r.text !== 'string' || !r.text.trim()) throw new Error('连接检查需要返回非空 text');
      } else if (r.toolResult) {
        if (task.mode === 'decision' && !task.actionSubmitted) throw new Error('Agent 没有提交牌局动作');
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
      agentLog(task, '结果校验或动作提交失败', error.message);
      if (task.mode === 'decision') this.decisionErrors.set(key, error.message);
      this.status[key] = { state: 'error', error: error.message, errorKind: error.errorKind, pid: this.workers.get(key)?.pid }; this.room.changed();
    } finally {
      if (task.role === 'player' && this.room.seats[task.seat].expression === 'thinking') this.room.expression(task.seat, 'idle');
      this.tasks.delete(msg.id); this.active.delete(key); this.drain(key);
    }
  }
  retry(seat, role = 'player') { this.reset(`${role}:${seat}`); if (role === 'player') this.room.dispatch(); }
  reset(key) {
    clearTimeout(this.drainTimers.get(key)); this.drainTimers.delete(key);
    this.queues.delete(key); this.active.delete(key); this.decisionErrors.delete(key);
    const child = this.workers.get(key); this.workers.delete(key);
    if (child) {
      if (child.connected) child.send({ type: 'shutdown' }, () => {});
      const timer = setTimeout(() => child.kill(), 5000); timer.unref();
    }
    for (const [id, t] of this.tasks) if (t.key === key) this.tasks.delete(id);
    delete this.status[key];
  }
  close() { for (const key of new Set([...this.workers.keys(), ...this.drainTimers.keys()])) this.reset(key); this.queues.clear(); this.tasks.clear(); this.active.clear(); this.reviewedHands.clear(); }
}
