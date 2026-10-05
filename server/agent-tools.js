import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { agentLog } from './agent-log.js';
import { taskExpressions } from '../shared/agent.js';
import { turnInfo, messageInfo } from './agent-context.js';
import { handInfo, analyzeActions } from './agent-analysis.js';

const labels = { discard: 'Discard', riichi: 'Riichi', chi: 'Chi', pon: 'Pon', kan: 'Kan', pass: 'Pass to next one', declare_win: 'Submit winning hand signal', abort: 'Nine terminals draw', continue: 'begin next round' };
const schema = (properties, optional = []) => ({ type: 'object', properties, required: Object.keys(properties).filter(key => !['speech', 'expression', ...optional].includes(key)), additionalProperties: false });

// CLI MCP and HTTP models share this registry and the same authoritative handler.
export function toolDefinitions(task) {
  const expressions = taskExpressions(task);
  let tools = [
    { name: 'get_turn', description: 'Get current turn status, active events, and valid actions.', inputSchema: schema({}) },
    { name: 'get_hand', description: 'Get your hand, shanten count, tile acceptances, and Yaku hints.', inputSchema: schema({}) },
    { name: 'get_player', description: "Get a player's public discards, melds, Riichi status, and score (excludes hidden cards).", inputSchema: schema({ seat: { type: 'number', enum: [0, 1, 2, 3] } }) },
    { name: 'get_messages', description: 'Get recent chat messages. Use after=0 for latest, or pass an event ID for incremental updates.', inputSchema: schema({ after: { type: 'number', minimum: 0 }, limit: { type: 'number', minimum: 1, maximum: 20 } }) },
    { name: 'analyze_actions', description: 'Compare legal actions by shanten, unseen acceptances, and Yaku. Omit value for all candidates; limit defaults to 5.', inputSchema: schema({ action: { type: 'string', enum: ['discard', 'riichi', 'chi', 'pon', 'kan'] }, value: { type: 'string', maxLength: 12 }, limit: { type: 'number', minimum: 1, maximum: 14 } }, ['value', 'limit']) }
  ];
  if (task.mode === 'check') return tools.filter(tool => tool.name === 'get_turn');
  tools = task.mode === 'decision' ? tools.filter(tool => ['get_player', 'analyze_actions'].includes(tool.name))
    : task.mode === 'advice' ? tools : [];
  tools.push({ name: 'update_memory', description: 'Replace your private scratchpad for the next task, preferably in English, at most 1000 characters. Keep useful old notes when adding new ones. Include strategy, impressions of other players, or anything useful to remember. Empty text clears it; no call keeps it. Call before the final action or finish_task, only when needed.', inputSchema: schema({ text: { type: 'string', maxLength: 1000 } }) });
  if (task.mode !== 'decision') tools.push({ name: 'send_message', description: 'send brief message to specified player.', inputSchema: schema({
    target: { type: 'string', enum: task.role === 'coach' ? ['coach'] : ['public', ...task.context.state.seats.filter(s => s.id !== task.seat).map(s => `seat:${s.id}`)] },
    text: { type: 'string', minLength: 1, maxLength: 120 }, expression: { type: 'string', enum: expressions }
  }) });
  if (task.mode === 'decision' && task.role === 'player') {
    const actions = [...task.context.state.legalActions];
    if (task.context.state.canWin) actions.push({ action: 'declare_win' });
    for (const name of new Set(actions.map(a => a.action))) {
      const values = actions.filter(a => a.action === name && a.value !== undefined).map(a => a.value);
      const argument = ['discard', 'riichi'].includes(name) ? 'tile' : 'meld';
      tools.push({ name, description: `${labels[name]}. this action will end your turn. ${values.length ? `optional args: ${values.join(', ')}. Tile parameters can omit the tsumogiri suffix—the game matches it automatically.` : ''}`,
        inputSchema: schema({ ...(values.length ? { [argument]: { type: 'string', enum: [...new Set([...values, ...(['discard', 'riichi'].includes(name) ? values.map(v => v.slice(0, 2)) : [])])] } } : {}), speech: { type: 'string', maxLength: 120, description: '随动作发送的可选公开聊天。接别人话题或表达角色感受，不必复述动作；无话可说可省略。' }, expression: { type: 'string', enum: expressions } }) });
    }
  }
  if (task.mode !== 'decision') tools.push({ name: 'finish_task', description: 'end this conversation, you can call `send_message` before calling it.', inputSchema: schema({}) });
  return tools;
}

function actionArguments(task, name, args) {
  const choices = task.context.state.legalActions.filter(a => a.action === name);
  if (name === 'declare_win' && task.context.state.canWin) return { action: name };
  const value = ['discard', 'riichi'].includes(name) ? args.tile : args.meld;
  let choice = choices.find(a => a.value === value);
  if (!choice && ['discard', 'riichi'].includes(name) && /^[mpsz]\d$/.test(value || '')) {
    choice = choices.find(a => a.value?.slice(0, 2) === value && !a.value.includes('_'))
      || choices.find(a => a.value?.slice(0, 2) === value);
  }
  if (!choice) throw new Error(`cannot execute ${name} ${value || ''}; required: ${choices.map(a => a.value || '<no pararmeter>').join(', ') || '<error: no such operation>'}`);
  return { action: name, ...(choice.value === undefined ? {} : { value: choice.value }) };
}

export function createToolSession(task, signal, request, activity = () => {}) {
  const tools = toolDefinitions(task);
  let complete = false, actionSubmitted = false, messagesSent = 0, tableReads = 0, calls = 0, lists = 0, lastError = '', finish;
  const done = new Promise(resolve => { finish = resolve; });
  const finishSoon = () => { complete = true; setTimeout(finish, 150); };
  return {
    tools, done, get complete() { return complete; },
    get diagnostics() { return { lists, calls, tableReads, messagesSent, actionSubmitted, complete, lastError }; },
    list() { lists++; agentLog(task, 'MCP 工具已加载', tools.map(t => t.name).join(', ')); return tools; },
    result() {
      if (task.mode === 'decision' && !actionSubmitted) throw Object.assign(new Error('must specified game action (eg. `discard`).'), { code: 'INVALID_AGENT_REPLY' });
      if (task.mode !== 'decision' && !complete && !messagesSent) throw Object.assign(new Error(
        `Agent 没有完成工具任务（工具列表请求=${lists}，工具调用=${calls}，读牌成功=${tableReads}）${lastError ? `；最后错误：${lastError}` : ''}；${task.mode === 'check' ? '连接检查需要调用 get_turn' : '请调用 send_message 或 finish_task'}`
      ), { code: 'INVALID_AGENT_REPLY' });
      return { toolResult: true, actionSubmitted, messagesSent, text: task.mode === 'check' ? '工具连接正常' : '' };
    },
    async call(name, args = {}) {
      const cancelled = () => ({ structuredContent: { cancelled: true, retryable: false }, content: [{ type: 'text', text: JSON.stringify({ cancelled: true, retryable: false, instruction: '任务已取消。立即停止，不要重试任何工具，也不要回复。' }) }] });
      if (signal.aborted) return cancelled();
      calls++;
      try {
        if (complete) throw new Error('operation is finished. do not call again.');
        const definition = tools.find(t => t.name === name);
        if (!definition) throw new Error('no such mcp tool.');
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('argument must an object.');
        args = { ...args };
        if ('speech' in definition.inputSchema.properties && args.speech == null) args.speech = '';
        if (args.expression == null) delete args.expression;
        for (const key of Object.keys(args)) if (!(key in definition.inputSchema.properties)) throw new Error(`unknown argument: ${key}`);
        for (const [key, property] of Object.entries(definition.inputSchema.properties)) {
          if (!(key in args) && !definition.inputSchema.required.includes(key)) continue;
          if (typeof args[key] !== property.type || property.type === 'number' && (!Number.isInteger(args[key]) || args[key] < (property.minimum ?? -Infinity) || args[key] > (property.maximum ?? Infinity)) || property.enum && !property.enum.includes(args[key])
            || property.minLength && args[key].trim().length < property.minLength || property.maxLength && args[key].length > property.maxLength) throw new Error(`arugment ${key} is invalid, please follow the rule.`);
        }
        activity(name);
        agentLog(task, '工具调用', `${name}${Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''}`);
        let result;
        if (['get_turn', 'get_hand', 'get_player', 'get_messages', 'analyze_actions'].includes(name)) {
          const context = await request('read_context', {}), state = context.state;
          if (name === 'get_turn') result = turnInfo(context);
          else if (name === 'get_hand') result = { version: state.version, ...handInfo(state) };
          else if (name === 'get_messages') result = { version: state.version, ...messageInfo(context, args.after, args.limit) };
          else if (name === 'analyze_actions') result = analyzeActions(state, args.action, args.value, args.limit);
          else {
            const seat = state.seats[args.seat];
            result = { version: state.version, id: seat.id, name: seat.name, wind: seat.wind, score: seat.score, discards: seat.discards, melds: seat.melds, riichi: seat.riichi };
          }
          tableReads++;
          if (task.mode === 'check' && name === 'get_turn') finishSoon();
        } else if (name === 'update_memory') {
          result = await request(name, args);
        } else if (name === 'finish_task') {
          result = { completed: true }; finishSoon();
        }
        else if (name === 'send_message') {
          result = await request(name, args); messagesSent++;
        } else {
          result = await request('action', { ...actionArguments(task, name, args), speech: args.speech, expression: args.expression });
          actionSubmitted = true; finishSoon();
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        if (signal.aborted) return cancelled();
        lastError = `${name}：${error.message}`;
        agentLog(task, '工具拒绝', `${name}：${error.message}`);
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      } finally { activity(null); }
    }
  };
}

// A random task capability, bound only to loopback, expires with the task.
export async function serveTools(session) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin) { res.writeHead(403).end('{}'); return; }
    try {
      if (req.method === 'GET' && req.url === '/tools') { res.end(JSON.stringify(session.list())); return; }
      if (req.method !== 'POST' || req.url !== '/call') { res.writeHead(404).end('{}'); return; }
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) throw new Error('工具请求过大'); }
      const { name, arguments: args } = JSON.parse(body);
      res.end(JSON.stringify(await session.call(name, args)));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, token,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
