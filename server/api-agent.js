import { agentPrompt } from './agent-prompt.js';
import { initialContext } from './agent-context.js';
import { agentLog } from './agent-log.js';
import { replyTarget } from '../shared/agent.js';

export async function apiTask(task, signal, session, observeRequest = () => {}) {
  const c = task.config, anthropic = c.provider === 'anthropic';
  const system = agentPrompt(task);
  const context = initialContext(task.context, task.mode);
  const messages = [{ role: 'user', content: JSON.stringify({ ...context, request: task.text || '完成当前任务', replyTarget: replyTarget(task) }) }];
  const tools = session.tools.map(t => {
    if (anthropic) return { name: t.name, description: t.description, input_schema: t.inputSchema };
    if (c.localServer) return { type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } };
    const properties = Object.fromEntries(Object.entries(t.inputSchema.properties).map(([key, property]) => [key, t.inputSchema.required.includes(key)
      ? property : { ...property, type: [property.type, 'null'], ...(property.enum ? { enum: [...property.enum, null] } : {}) }]));
    return { type: 'function', function: { name: t.name, description: t.description,
      parameters: { ...t.inputSchema, properties, required: Object.keys(properties) }, strict: true } };
  });
  const url = `${c.baseUrl.replace(/\/+$/, '')}${anthropic ? '/messages' : '/chat/completions'}`;
  const headers = { 'Content-Type': 'application/json', ...(anthropic ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }
    : c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) };
  let model = c.model;
  if (!anthropic && !model) {
    const response = await fetch(`${c.baseUrl.replace(/\/+$/, '')}/models`, { headers, signal });
    if (!response.ok) throw new Error(`模型检测 HTTP ${response.status}`);
    const available = (await response.json()).data;
    if (!Array.isArray(available) || available.length !== 1 || !available[0]?.id) throw new Error('无法确定当前模型，请填写模型名称');
    model = available[0].id;
  }
  while (!signal.aborted) {
    agentLog(task, 'API 请求', `provider=${c.provider}，model=${model}，工具=${tools.length}`);
    const body = anthropic ? { model, system, messages, tools, max_tokens: 1400, tool_choice: { type: 'any' } }
      : { model, messages: [{ role: 'system', content: system }, ...messages], tools, tool_choice: 'required', parallel_tool_calls: true, stream: false };
    const started = Date.now();
    let data, failed = true;
    observeRequest({ phase: 'start' });
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
      if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}：${(await response.text()).slice(0, 1000)}`);
      data = await response.json(); failed = false;
    } finally {
      const inputTokens = data?.usage?.prompt_tokens ?? data?.usage?.input_tokens;
      const outputTokens = data?.usage?.completion_tokens ?? data?.usage?.output_tokens;
      const timings = data?.timings;
      const outputTokensPerSecond = timings?.predicted_ms > 0 && Number.isFinite(timings.predicted_n) ? timings.predicted_n * 1000 / timings.predicted_ms : undefined;
      const usage = Object.fromEntries(Object.entries({ inputTokens, outputTokens, outputTokensPerSecond }).filter(([, value]) => Number.isFinite(value) && value >= 0));
      observeRequest({ phase: 'end', durationMs: Date.now() - started, failed, usage: Object.keys(usage).length ? usage : undefined });
    }
    if (anthropic) {
      const content = (data.content || []).filter(x => x.type === 'text' || x.type === 'tool_use');
      const calls = content.filter(x => x.type === 'tool_use');
      if (!calls.length) throw new Error('模型没有调用工具，请确认服务支持 tool use');
      messages.push({ role: 'assistant', content });
      const results = [];
      for (const call of calls) {
        const result = await session.call(call.name, call.input);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: result.content[0].text, is_error: !!result.isError });
        if (session.complete) break;
      }
      messages.push({ role: 'user', content: results });
    } else {
      const answer = data.choices?.[0]?.message;
      if (!answer?.tool_calls?.length) throw new Error('模型没有调用工具，请确认 API 兼容服务支持 function calling');
      messages.push({ role: 'assistant', content: answer.content || null, tool_calls: answer.tool_calls });
      for (const call of answer.tool_calls) {
        let args, result;
        try {
          args = JSON.parse(call.function.arguments);
          // Strict API schemas encode omitted optional fields as null.
          const definition = session.tools.find(t => t.name === call.function.name);
          if (args && typeof args === 'object' && !Array.isArray(args) && definition) {
            for (const key of Object.keys(args)) if (args[key] === null && !definition.inputSchema.required.includes(key)) delete args[key];
          }
        }
        catch { result = { content: [{ type: 'text', text: '工具参数不是有效 JSON，请修正后重试' }] }; }
        result ||= await session.call(call.function.name, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.content.filter(x => x.type === 'text').map(x => x.text).join('\n') });
        if (session.complete) break;
      }
    }
    if (session.complete) return session.result();
  }
  signal.throwIfAborted();
}
