import { agentPrompt } from './agent-prompt.js';
import { agentContext } from './agent-tools.js';
import { agentLog } from './agent-log.js';
import { replyTarget } from '../shared/agent.js';

export async function apiTask(task, signal, session) {
  const c = task.config, anthropic = c.provider === 'anthropic';
  const system = agentPrompt({ ...task, toolMode: true });
  const context = agentContext(task.context);
  const messages = [{ role: 'user', content: JSON.stringify({ ...context, request: task.text || '完成当前任务', replyTarget: replyTarget(task) }) }];
  const tools = session.tools.map(t => {
    if (anthropic) return { name: t.name, description: t.description, input_schema: t.inputSchema };
    const properties = Object.fromEntries(Object.entries(t.inputSchema.properties).map(([key, property]) => [key, t.inputSchema.required.includes(key)
      ? property : { ...property, type: [property.type, 'null'], ...(property.enum ? { enum: [...property.enum, null] } : {}) }]));
    return { type: 'function', function: { name: t.name, description: t.description,
      parameters: { ...t.inputSchema, properties, required: Object.keys(properties) }, strict: true } };
  });
  const url = `${c.baseUrl.replace(/\/+$/, '')}${anthropic ? '/messages' : '/chat/completions'}`;
  const headers = { 'Content-Type': 'application/json', ...(anthropic ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }
    : c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) };
  while (!signal.aborted) {
    agentLog(task, 'API 请求', `provider=${c.provider}，model=${c.model}，工具=${tools.length}`);
    const body = anthropic ? { model: c.model, system, messages, tools, max_tokens: 1400, tool_choice: { type: 'any' } }
      : { model: c.model, messages: [{ role: 'system', content: system }, ...messages], tools, tool_choice: 'required', parallel_tool_calls: false, stream: false };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}：${(await response.text()).slice(0, 1000)}`);
    const data = await response.json();
    if (anthropic) {
      const content = (data.content || []).filter(x => x.type === 'text' || x.type === 'tool_use');
      const calls = content.filter(x => x.type === 'tool_use');
      if (!calls.length) throw new Error('模型没有调用工具，请确认服务支持 tool use');
      messages.push({ role: 'assistant', content });
      const results = [];
      for (const call of calls) {
        const result = await session.call(call.name, call.input);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: result.content[0].text, is_error: !!result.isError });
      }
      messages.push({ role: 'user', content: results });
    } else {
      const answer = data.choices?.[0]?.message;
      if (!answer?.tool_calls?.length) throw new Error('模型没有调用工具，请确认 API 兼容服务支持 function calling');
      messages.push({ role: 'assistant', content: answer.content || null, tool_calls: answer.tool_calls });
      for (const call of answer.tool_calls) {
        let result;
        try { result = await session.call(call.function.name, JSON.parse(call.function.arguments)); }
        catch { result = { content: [{ text: '工具参数不是有效 JSON，请修正后重试' }] }; }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.content[0].text });
      }
    }
    if (session.complete) return session.result();
  }
  signal.throwIfAborted();
}
