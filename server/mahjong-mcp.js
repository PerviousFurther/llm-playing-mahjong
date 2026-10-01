import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = process.env.MAHJONG_TOOL_URL, token = process.env.MAHJONG_TOOL_TOKEN;
if (!url || !token) throw new Error('麻将 MCP 需要由游戏为当前任务启动');
async function request(path, body) {
  const response = await fetch(url + path, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`麻将任务接口 HTTP ${response.status}`);
  return response.json();
}
const server = new Server({ name: 'mahjong', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await request('/tools') }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const result = await request('/call', { name: params.name, arguments: params.arguments || {} });
    if (result.structuredContent?.cancelled) {
      setTimeout(() => { void server.close().finally(() => process.exit(0)); }, 100);
    }
    return result;
  }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
