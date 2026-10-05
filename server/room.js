import Majiang from '@kobalab/majiang-core';
import { DEFAULT_RULES, validateRules, coreRules, englishRules, matchLength } from '../shared/rules.js';
import { expressions, expressionAliases, bubbleDuration } from '../shared/agent.js';
import { elapsedTime } from '../shared/event-time.js';

const clone = x => JSON.parse(JSON.stringify(x));
const winds = ['东', '南', '西', '北'];
export function handTiles(hand) {
  if (!hand) return [];
  const result = [];
  for (const s of ['m', 'p', 's', 'z']) for (let n = 0; n < hand._bingpai[s].length; n++) {
    const count = hand._bingpai[s][n] - (s !== 'z' && n === 5 ? hand._bingpai[s][0] : 0);
    for (let i = 0; i < count; i++) result.push(s + n);
  }
  if (hand._zimo?.length === 2) {
    const i = result.lastIndexOf(hand._zimo);
    if (i >= 0) result.push(...result.splice(i, 1));
  }
  return result;
}
export class Room {
  constructor({ onChange = () => {}, onDecision = () => {}, onCoach = () => {}, onPhase = () => {}, persist = () => {}, expressionOptions = expressions } = {}) {
    this.onChange = onChange; this.onDecision = onDecision; this.onCoach = onCoach; this.onPhase = onPhase; this.persist = persist;
    this.expressionOptions = expressionOptions; this.expressionTimers = new Map(); this.aborted = false;
    this.rules = { ...DEFAULT_RULES }; this.version = 0; this.eventId = 0;
    this.events = []; this.publicChatEvents = []; this.privateEvents = Array.from({ length: 4 }, () => []); this.coachEvents = [];
    this.memories = {};
    this.seats = ['你', '青竹', '白露', '晚风'].map((name, id) => ({ id, name, type: id ? 'bot' : 'human', expression: 'idle' }));
    this.pending = new Map(); this.processed = new Map(); this.paused = false;
    this.revealed = []; this.game = null; this.lastResult = null; this.matchOver = false;
    this.replayId = null; this.completedAt = null; this.matchStartedAt = null;
  }
  event(type, data, owner = null) {
    const at = new Date().toISOString();
    const e = { id: ++this.eventId, type, data: clone(data), at, elapsed: elapsedTime(at, this.matchStartedAt) };
    (owner === null ? this.events : owner === 'coach' ? this.coachEvents : this.privateEvents[owner]).push(e);
    return e;
  }
  changed() { this.persist(this); this.onChange(); }
  ruleText() { return englishRules(this.rules, this.game?._rule || Majiang.rule(coreRules(this.rules))); }
  start(input = {}) {
    if (this.game && !this.matchOver) throw new Error('当前对局尚未结束');
    this.rules = validateRules(input); this.aborted = false; this.clearExpressions(); this.matchOver = false; this.paused = false;
    this.replayId = null; this.completedAt = null;
    this.matchStartedAt = new Date().toISOString();
    this.events = []; this.privateEvents = Array.from({ length: 4 }, () => []); this.coachEvents = [];
    this.memories = {};
    this.pending.clear(); this.processed.clear(); this.lastResult = null; this.revealed = [];
    this.game = new Majiang.Game([], () => { this.matchOver = true; this.changed(); }, Majiang.rule(coreRules(this.rules)), '雀伴');
    this.game.model.player = this.seats.map(s => s.name);
    this.bindGame(); this.event('rules', { text: this.ruleText(), settings: this.rules });
    this.game.kaiju(0);
  }
  bindGame() {
    const game = this.game;
    game._dwell = 0; game._wait = 0;
    // Override asynchronous player dispatch: one atomic phase, no response deadline.
    game.call_players = (type, messages) => {
      if (this.game !== game) return;
      game._status = type; game._reply = []; this.version++;
      this.pending.clear();
      if (type === 'qipai') { this.revealed = []; this.lastResult = null; }
      if (type === 'jieju') this.matchOver = true;
      const msg = messages[0];
      if (type === 'hule') {
        const winner = game.model.player_id[msg.hule.l];
        const winningHands = { ...(this.lastResult?.kind === 'win' ? this.lastResult.winningHands : {}), [winner]: msg.hule.shoupai };
        this.lastResult = { kind: 'win', ...msg.hule, winner, winningHands };
        this.revealed = this.seats.map(s => s.id);
      }
      if (type === 'pingju') this.lastResult = { kind: 'draw', ...msg.pingju };
      // Never publish a dealt hand or the value of a concealed draw.
      if (type === 'zimo' || type === 'gangzimo') this.event('draw', { seat: game.model.player_id[game.model.lunban], rinshan: type === 'gangzimo' });
      else if (type === 'qipai') this.event('hand_started', { round: game.model.zhuangfeng, hand: game.model.jushu });
      else if (type === 'jieju') this.event('match_ended', { scores: game.model.defen, rank: game._paipu.rank });
      else if (type !== 'kaiju') this.event(type, msg[type]);
      for (let id = 0; id < 4; id++) {
        const options = this.options(id);
        if (options.length) this.pending.set(id, options);
        else game._reply[id] = {};
      }
      this.changed(); this.dispatch(); this.onPhase(type);
      if (!this.paused && this.seats[0].type === 'human' && this.pending.has(0)
        && !['hule', 'pingju'].includes(type)) this.onCoach(this.context(0, 'coach'));
      this.advance();
    };
    game.notify_players = (type, messages) => { this.event(type, messages[0][type]); this.changed(); };
    game._callback = () => { this.matchOver = true; this.changed(); };
    // Fixed-length matches count dealt hands, independent of dealer repeats.
    game.last = () => {
      const limit = matchLength(this.rules);
      if (!limit) return Majiang.Game.prototype.last.call(game);
      const m = game.model;
      m.lunban = -1;
      if (game._paipu.log.length >= limit || m.defen.some(score => score < 0)) {
        return game.delay(() => game.jieju());
      }
      if (!game._lianzhuang) {
        m.jushu++;
        m.zhuangfeng += Math.floor(m.jushu / 4);
        m.jushu %= 4;
      }
      game.delay(() => game.qipai());
    };
    // Guard delayed transitions after replacing or terminating a room.
    game.delay = callback => { const generation = this.version; setTimeout(() => {
      if (this.game === game && generation === this.version) callback();
    }, 0); };
    game.view = { kaiju() {}, redraw() {}, update() {}, say() {}, summary() {} };
  }
  options(id) {
    const g = this.game, m = g?.model;
    if (!m || !m.shan || this.matchOver) return [];
    const l = m.player_id.indexOf(id), ownTurn = l === m.lunban, opts = [];
    const add = (action, value, label) => opts.push({ action, ...(value === undefined ? {} : { value }), label });
    const turn = ['zimo', 'gangzimo'].includes(g._status) || (g._status === 'fulou' && !g._gang);
    if (turn && ownTurn) {
      for (const p of g.get_dapai()) { add('discard', p, '打牌'); if (g._status !== 'fulou' && g.allow_lizhi(p)) add('riichi', p, '立直'); }
      if (g._status !== 'fulou') {
        for (const p of g.get_gang_mianzi() || []) add('kan', p, '杠');
        if (g.allow_pingju()) add('abort', undefined, '九种九牌');
      }
    }
    if (['dapai', 'gang'].includes(g._status) && !ownTurn) {
      const robbable = g._status !== 'gang' || !g._gang.match(/^[mpsz]\d{4}$/);
      if (robbable) {
        add('pass', undefined, '跳过');
        if (g._status === 'dapai') {
          for (const p of g.get_chi_mianzi(l) || []) add('chi', p, '吃');
          for (const p of g.get_peng_mianzi(l) || []) add('pon', p, '碰');
          for (const p of g.get_gang_mianzi(l) || []) add('kan', p, '明杠');
        }
      }
    }
    if (['hule', 'pingju'].includes(g._status) && id === 0) add('continue', undefined, '继续对局');
    return opts;
  }
  advance() {
    if (this.paused || !this.game || this.pending.size || this.matchOver) return;
    const g = this.game, version = this.version;
    clearTimeout(this.advanceTimer);
    this.advanceTimer = setTimeout(() => {
      if (g === this.game && version === this.version && !this.paused && !this.pending.size) g.next();
    }, 40);
  }
  dispatch() {
    if (this.paused) return;
    for (const [id] of this.pending) if (['bot', 'llm'].includes(this.seats[id].type)) this.onDecision(id, this.context(id));
  }
  action(id, payload) {
    if (!Number.isInteger(id) || id < 0 || id > 3) throw new Error('座位无效');
    if (!payload || typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 100) throw new Error('需要唯一 requestId');
    const key = `${id}:${payload.requestId}`;
    if (this.processed.has(key)) return this.processed.get(key);
    if (payload.stateVersion !== this.version) throw new Error('状态版本已过期，请重新读取牌局');
    if (this.paused) throw new Error('对局已暂停');
    if (!this.game || this.matchOver) throw new Error('请先开局');
    if (payload.action === 'declare_win') return this.declare(id, payload, key);
    const choices = this.pending.get(id);
    const option = choices?.find(o => o.action === payload.action && o.value === payload.value);
    if (!option) throw new Error('此动作当前不可执行，或已响应');
    let reply = {};
    if (['discard', 'riichi'].includes(option.action)) reply = { dapai: option.value + (option.action === 'riichi' ? '*' : '') };
    if (['chi', 'pon', 'kan'].includes(option.action)) reply = { [this.game._status === 'dapai' ? 'fulou' : 'gang']: option.value };
    if (option.action === 'abort') reply = { daopai: '-' };
    this.pending.delete(id); this.game._reply[id] = reply;
    const result = { accepted: true, stateVersion: this.version };
    this.remember(key, result); this.changed(); this.advance(); return result;
  }
  remember(key, result) { this.processed.set(key, result); if (this.processed.size > 4096) this.processed.delete(this.processed.keys().next().value); }
  declare(id, payload, key) {
    const g = this.game, m = g.model, l = m.player_id.indexOf(id);
    if (!m.shan || ['kaiju', 'qipai', 'hule', 'pingju', 'jieju'].includes(g._status)) throw new Error('当前不在可推牌的活动牌局中');
    const ownTurn = l === m.lunban;
    const tsumo = ownTurn && ['zimo', 'gangzimo'].includes(g._status);
    const ron = !ownTurn && (g._status === 'dapai' || (g._status === 'gang' && !g._gang.match(/^[mpsz]\d{4}$/)));
    const legal = (tsumo || ron) && g.allow_hule(tsumo ? undefined : l);
    if (!legal || !this.pending.has(id)) throw new Error('当前不能和牌');
    const result = { accepted: true, valid: true, stateVersion: this.version };
    this.remember(key, result);
    this.pending.delete(id); g._reply[id] = { hule: '-' };
    this.changed(); this.advance();
    return result;
  }
  terminate() {
    if (!this.game || this.matchOver) throw new Error('当前没有进行中的对局');
    clearTimeout(this.advanceTimer); this.version++;
    this.pending.clear(); this.matchOver = true; this.aborted = true; this.paused = false;
    this.lastResult = null; this.game._status = 'aborted'; this.game._reply = [];
    this.game.model.defen = [25000, 25000, 25000, 25000];
    this.game.model.lizhibang = 0; this.game.model.lunban = -1; this.clearExpressions();
    this.changed();
  }
  clearExpressions() {
    for (const timer of this.expressionTimers.values()) clearTimeout(timer);
    this.expressionTimers.clear();
    for (const seat of this.seats) seat.expression = 'idle';
  }
  setPaused(value) {
    this.paused = !!value; this.changed();
    if (!this.paused) {
      this.dispatch();
      if (this.seats[0].type === 'human' && this.pending.has(0)
        && !['hule', 'pingju'].includes(this.game?._status)) this.onCoach(this.context(0, 'coach'));
      this.advance();
    }
  }
  chat(id, text, target = 'public', speaker = 'player', expression) {
    if (!Number.isInteger(id) || id < 0 || id > 3 || !(target === 'public' || id === 0 && target === 'coach' || /^seat:[0-3]$/.test(target))) throw new Error('聊天目标无效');
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('消息长度需要在 1–4000 字之间');
    const data = { seat: id, speaker, text: text.trim(), target,
      ...(this.expressionOptions.includes(expression) ? { expression } : {}) };
    const e = this.event('chat', data, target === 'public' ? null : target === 'coach' ? 'coach' : id);
    if (target === 'public') this.publicChatEvents.push(e);
    if (target.startsWith('seat:')) { const other = Number(target.slice(-1)); if (other !== id) this.privateEvents[other].push(e); }
    this.changed(); return e;
  }
  expression(id, value, text) {
    value = expressionAliases[value] || value;
    if (!['idle', 'thinking', ...this.expressionOptions].includes(value)) return;
    clearTimeout(this.expressionTimers.get(id)); this.expressionTimers.delete(id);
    this.seats[id].expression = value;
    if (text && value !== 'thinking') {
      const timer = setTimeout(() => { this.expressionTimers.delete(id); this.seats[id].expression = 'idle'; this.changed(); }, bubbleDuration(text));
      timer.unref(); this.expressionTimers.set(id, timer);
    }
    this.changed();
  }
  snapshot(id = 0) {
    const m = this.game?.model;
    let canWin = false;
    if (m?.shan && !this.matchOver && this.pending.has(id)) {
      const l = m.player_id.indexOf(id), g = this.game;
      if (l === m.lunban && ['zimo', 'gangzimo'].includes(g._status)) canWin = g.allow_hule();
      else if (l !== m.lunban && (g._status === 'dapai' || g._status === 'gang' && !g._gang.match(/^[mpsz]\d{4}$/))) canWin = g.allow_hule(l);
    }
    return {
      version: this.version, eventId: this.eventId, started: !!this.game, paused: this.paused, matchOver: this.matchOver, aborted: this.aborted, expressionOptions: this.expressionOptions,
      matchHand: this.game?._paipu?.log.length || 0, handLimit: matchLength(this.rules), matchStartedAt: this.matchStartedAt,
      rules: this.rules, englishRules: this.ruleText(), phase: this.game?._status || 'lobby', viewer: id,
      round: m?.zhuangfeng || 0, handNumber: m?.jushu || 0, honba: m?.changbang || 0, sticks: m?.lizhibang || 0,
      remaining: m?.shan?.paishu || 0, dora: m?.shan?.baopai || [],
      activeSeat: m && m.lunban >= 0 ? m.player_id[m.lunban] : null,
      turn: {
        discardSeat: m && !this.matchOver && (['zimo', 'gangzimo'].includes(this.game._status) || this.game._status === 'fulou' && !this.game._gang) ? m.player_id[m.lunban] : null,
        respondingSeats: ['dapai', 'gang'].includes(this.game?._status) ? [...this.pending.keys()] : [],
        yourActionRequired: this.pending.has(id) && !this.matchOver,
        paused: this.paused
      },
      seats: this.seats.map(s => {
        const l = m?.player_id.indexOf(s.id);
        const winHand = this.lastResult?.kind === 'win' && (this.lastResult.winningHands?.[s.id] || (this.lastResult.winner === s.id ? this.lastResult.shoupai : null));
        const hand = winHand ? Majiang.Shoupai.fromString(winHand) : m?.shoupai[l];
        const revealed = this.matchOver || this.lastResult?.kind === 'win' || this.revealed.includes(s.id);
        const visible = s.id === id || revealed;
        const tiles = handTiles(hand);
        return { ...s, wind: winds[l ?? s.id], score: m?.defen[s.id] ?? 25000,
          hand: visible ? tiles : [], handCount: tiles.length,
          handString: visible ? hand?.toString() : undefined, drawn: visible ? hand?._zimo : undefined,
          melds: hand?._fulou || [], discards: m?.he[l]?._pai || [], riichi: !!hand?.lizhi, revealed };
      }),
      legalActions: this.pending.get(id) || [], canWin,
      waiting: [...this.pending.keys()], lastResult: this.lastResult,
      publicEvents: this.events.slice(-160), ...(id === 0 ? { publicChatEvents: this.publicChatEvents.slice(-500) } : {}), privateEvents: this.privateEvents[id].slice(-100),
      ...(id === 0 && this.seats[0].type === 'human' ? { coachEvents: this.coachEvents.slice(-100) } : {})
    };
  }
  context(id, role = 'player') {
    const state = this.snapshot(id);
    delete state.coachEvents;
    delete state.publicEvents; delete state.privateEvents; delete state.englishRules;
    delete state.publicChatEvents;
    return { state, memory: this.memories[`${role}:${id}`] || null, publicContext: this.events.slice(-100),
      privateContext: role === 'coach' && id === 0 ? this.coachEvents.slice(-60) : this.privateEvents[id].slice(-60) };
  }
  allPrivateEvents(limit = 160) {
    return [...new Map(this.privateEvents.flatMap(events => events.slice(-limit)).map(e => [e.id, e])).values()]
      .sort((a, b) => a.id - b.id).slice(-limit);
  }
  updateMemory(id, role, text) {
    if (!Number.isInteger(id) || id < 0 || id > 3 || !['player', 'coach'].includes(role) || role === 'coach' && id !== 0) throw new Error('Invalid memory owner');
    if (typeof text !== 'string' || text.length > 1000) throw new Error('Memory must be a string of at most 1000 characters');
    const key = `${role}:${id}`, value = text.trim();
    if (value === (this.memories[key]?.text || '')) return { saved: false, unchanged: true };
    const memory = { text: value, matchHand: this.game?._paipu?.log.length || 0, version: this.version };
    if (value) this.memories[key] = memory; else delete this.memories[key];
    const data = { seat: id, role, ...memory };
    this.event('memory', data, role === 'coach' ? 'coach' : id);
    this.changed();
    return { saved: true, eventId: this.eventId, length: value.length };
  }
  serialize() {
    const excluded = ['_players', '_view', '_callback', '_timeout_id', '_stop', '_handler'];
    const game = this.game && Object.fromEntries(Object.entries(this.game).filter(([k, v]) => !excluded.includes(k) && typeof v !== 'function'));
    return clone({ schema: 2, rules: this.rules, version: this.version, eventId: this.eventId, events: this.events, publicChatEvents: this.publicChatEvents, privateEvents: this.privateEvents, coachEvents: this.coachEvents,
      seats: this.seats, memories: this.memories, revealed: this.revealed, lastResult: this.lastResult, matchOver: this.matchOver,
      processed: [...this.processed], aborted: this.aborted, replayId: this.replayId, completedAt: this.completedAt, matchStartedAt: this.matchStartedAt, game });
  }
  restore(saved) {
    if (![1, 2].includes(saved.schema)) throw new Error('存档版本不支持');
    for (const k of ['rules', 'version', 'eventId', 'events', 'privateEvents', 'seats', 'revealed', 'lastResult', 'matchOver', 'aborted']) this[k] = saved[k];
    this.seats = this.seats.map(seat => seat.type === 'external' ? { ...seat, type: 'bot' } : seat);
    this.rules = validateRules(this.rules); this.aborted = !!saved.aborted; this.clearExpressions();
    this.replayId = saved.replayId || null; this.completedAt = saved.completedAt || null;
    this.matchStartedAt = saved.matchStartedAt || (saved.game ? this.events[0]?.at : null) || null;
    this.publicChatEvents = saved.publicChatEvents || this.events.filter(e => e.type === 'chat');
    this.memories = saved.memories || {};
    this.coachEvents = saved.coachEvents || this.privateEvents[0].filter(e => e.type === 'chat' && e.data.target === 'coach');
    if (saved.schema === 1) this.privateEvents = this.privateEvents.map(events => events.filter(e => e.type !== 'chat' || e.data.target !== 'coach'));
    this.processed = new Map(saved.processed); this.paused = true;
    if (saved.game) {
      this.game = Object.assign(new Majiang.Game([]), saved.game);
      const m = this.game.model;
      m.shoupai = m.shoupai.map(x => Object.assign(new Majiang.Shoupai(), x));
      m.he = m.he.map(x => Object.assign(new Majiang.He(), x));
      if (m.shan) m.shan = Object.assign(Object.create(Majiang.Shan.prototype), m.shan);
      this.bindGame();
      for (let id = 0; id < 4; id++) if (!this.game._reply[id]) { const opts = this.options(id); if (opts.length) this.pending.set(id, opts); else this.game._reply[id] = {}; }
    }
  }
}
