import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { agentLog } from './agent-log.js';
import { taskExpressions } from '../shared/agent.js';
import { agentContext } from './agent-context.js';
export { agentContext } from './agent-context.js';

const labels = { discard: '打牌', riichi: '立直并打牌', chi: '吃', pon: '碰', kan: '杠', pass: '跳过他人的弃牌或杠', declare_win: '和牌', abort: '九种九牌流局', continue: '继续对局' };
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties).filter(key => !['speech', 'expression'].includes(key)), additionalProperties: false });

// CLI MCP and HTTP models share this registry and the same authoritative handler.
export function toolDefinitions(task) {
  const expressions = taskExpressions(task);
  const tools = [{ name: 'get_table', description: `查看自己可见的牌局和聊天。无法读取他人暗牌、牌墙或其他人的私聊。${task.mode === 'check' ? '本次是连接检查，成功调用此工具即完成任务。' : ''}`, inputSchema: schema({}) }];
  if (task.mode !== 'check') tools.push({ name: 'send_message', description: '发送一条简短聊天。可重复调用；私聊会通知接收者。', inputSchema: schema({
    target: { type: 'string', enum: task.role === 'coach' ? ['coach'] : ['public', ...task.context.state.seats.filter(s => s.id !== task.seat).map(s => `seat:${s.id}`)] },
    text: { type: 'string', minLength: 1, maxLength: 120 }, expression: { type: 'string', enum: expressions }
  }) });
  if (task.mode === 'decision' && task.role === 'player') {
    const actions = [...task.context.state.legalActions];
    if (task.context.state.canWin) actions.push({ action: 'declare_win' });
    for (const name of new Set(actions.map(a => a.action))) {
      const values = actions.filter(a => a.action === name && a.value !== undefined).map(a => a.value);
      const argument = ['discard', 'riichi'].includes(name) ? 'tile' : 'meld';
      tools.push({ name, description: `${labels[name]}。成功后结束当前决策；一次任务只能成功执行一个牌局动作。${values.length ? `可选参数：${values.join('、')}。牌参数可省略摸切后缀，由游戏匹配。` : ''}`,
        inputSchema: schema({ ...(values.length ? { [argument]: { type: 'string', enum: [...new Set([...values, ...(['discard', 'riichi'].includes(name) ? values.map(v => v.slice(0, 2)) : [])])] } } : {}), speech: { type: 'string', maxLength: 120 }, expression: { type: 'string', enum: expressions } }) });
    }
  }
  if (task.mode !== 'decision') tools.push({ name: 'finish_task', description: '结束当前聊天、事件、教练或连接检查任务。需要发言时先调用 send_message。', inputSchema: schema({}) });
  return tools;
}

export function actionArguments(task, name, args) {
  const choices = task.context.state.legalActions.filter(a => a.action === name);
  if (name === 'declare_win' && task.context.state.canWin) return { action: name };
  const value = ['discard', 'riichi'].includes(name) ? args.tile : args.meld;
  let choice = choices.find(a => a.value === value);
  if (!choice && ['discard', 'riichi'].includes(name) && /^[mpsz]\d$/.test(value || '')) {
    choice = choices.find(a => a.value?.slice(0, 2) === value && !a.value.includes('_'))
      || choices.find(a => a.value?.slice(0, 2) === value);
  }
  if (!choice) throw new Error(`当前不能执行 ${name} ${value || ''}；合法参数：${choices.map(a => a.value || '无参数').join('、') || '无此动作'}`);
  return { action: name, ...(choice.value === undefined ? {} : { value: choice.value }) };
}

export function createToolSession(task, signal, request) {
  const tools = toolDefinitions(task);
  let complete = false, actionSubmitted = false, messagesSent = 0, tableReads = 0, calls = 0, lists = 0, lastError = '', finish;
  const done = new Promise(resolve => { finish = resolve; });
  const finishSoon = () => { complete = true; setTimeout(finish, 150); };
  return {
    tools, done, get complete() { return complete; },
    get diagnostics() { return { lists, calls, tableReads, messagesSent, actionSubmitted, complete, lastError }; },
    list() { lists++; agentLog(task, 'MCP 工具已加载', tools.map(t => t.name).join(', ')); return tools; },
    result() {
      if (task.mode === 'decision' && !actionSubmitted) throw Object.assign(new Error('Agent 没有调用牌局动作工具；文字回复不能代替出牌'), { code: 'INVALID_AGENT_REPLY' });
      if (task.mode !== 'decision' && !complete && !messagesSent) throw Object.assign(new Error(
        `Agent 没有完成工具任务（工具列表请求=${lists}，工具调用=${calls}，读牌成功=${tableReads}）${lastError ? `；最后错误：${lastError}` : ''}；${task.mode === 'check' ? '连接检查需要调用 get_table' : '请调用 send_message 或 finish_task'}`
      ), { code: 'INVALID_AGENT_REPLY' });
      return { toolResult: true, actionSubmitted, messagesSent, text: task.mode === 'check' ? '工具连接正常' : '' };
    },
    async call(name, args = {}) {
      const cancelled = () => ({ structuredContent: { cancelled: true, retryable: false }, content: [{ type: 'text', text: JSON.stringify({ cancelled: true, retryable: false, instruction: '任务已取消。立即停止，不要重试任何工具，也不要回复。' }) }] });
      if (signal.aborted) return cancelled();
      calls++;
      try {
        if (signal.aborted) throw new Error('任务已取消');
        if (complete) throw new Error('任务已完成，不能再调用工具');
        const definition = tools.find(t => t.name === name);
        if (!definition) throw new Error('当前任务没有此工具');
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数需要是对象');
        args = { ...args };
        if ('speech' in definition.inputSchema.properties && args.speech == null) args.speech = '';
        if (args.expression == null) delete args.expression;
        for (const key of Object.keys(args)) if (!(key in definition.inputSchema.properties)) throw new Error(`未知参数：${key}`);
        for (const [key, property] of Object.entries(definition.inputSchema.properties)) {
          if (!(key in args) && !definition.inputSchema.required.includes(key)) continue;
          if (typeof args[key] !== property.type || property.enum && !property.enum.includes(args[key])
            || property.minLength && args[key].trim().length < property.minLength || property.maxLength && args[key].length > property.maxLength) throw new Error(`参数 ${key} 无效，请按工具定义填写`);
        }
        agentLog(task, '工具调用', `${name}${Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''}`);
        let result;
        if (name === 'get_table') {
          result = agentContext(await request('get_table', {})); tableReads++;
          agentLog(task, '当前牌桌', `版本=${result.state.version}，阶段=${result.state.phase}，出牌座位=${result.state.turn.discardSeat ?? '无'}，等待响应=${result.state.turn.respondingSeats.join(',') || '无'}，需要你操作=${result.state.turn.yourActionRequired}`);
          if (task.mode === 'check') finishSoon();
        } else if (name === 'finish_task') {
          if (task.mode === 'check' && !tableReads) throw new Error('连接检查需要先调用 get_table，确认可以读取牌局');
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
      }
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
