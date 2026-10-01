import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnAgent, terminateAgent, taskInput } from './agent-runtime.js';
import { agentPrompt } from './agent-prompt.js';
import { taskExpressions } from '../shared/agent.js';
import { agentLog, agentOutput, outputPreview } from './agent-log.js';
import { serveTools, agentContext } from './agent-tools.js';

const active = new Set();
const MAX_OUTPUT = 1024 * 1024;

function responseSchema(task) {
  const properties = task.mode === 'decision'
    ? { action: { type: 'string' }, value: { type: ['string', 'null'] }, speech: { type: 'string' } }
    : { text: { type: 'string' } };
  properties.expression = { type: 'string', enum: taskExpressions(task) };
  return { type: 'object', properties, required: Object.keys(properties).filter(key => key !== 'expression'), additionalProperties: false };
}

function parseReply(task, raw) {
  const clean = raw.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let output;
  try { output = JSON.parse(clean); } catch (error) {
    throw new Error(clean ? `Agent 回复不是有效 JSON：${error.message}` : 'Agent 回复为空；脚本正常退出但没有写入最终回复');
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Agent 回复需要是 JSON 对象');
  const expression = taskExpressions(task).includes(output.expression) ? output.expression : undefined;
  if (task.mode !== 'decision') {
    if (typeof output.text !== 'string') throw new Error('Agent 回复缺少 text');
    return { text: output.text.slice(0, 120), expression };
  }
  const value = output.value === null ? undefined : output.value;
  const offered = task.context?.state?.legalActions?.find(a => a.action === output.action && a.value === value);
  if (!offered && !(output.action === 'declare_win' && value === undefined && task.context?.state?.canWin)) throw new Error('Agent 选择了当前未提供的动作');
  return { action: output.action, ...(value === undefined ? {} : { value }),
    speech: typeof output.speech === 'string' ? output.speech.slice(0, 120) : '', expression };
}

export async function scriptTask(task, signal, session) {
  if (signal.aborted) throw new Error('请求已取消');
  // This directory is created here and only this task-owned path is removed.
  const directory = await mkdtemp(join(tmpdir(), 'mahjong-task-'));
  const input = taskInput(task), promptFile = join(directory, 'prompt.txt'), replyFile = join(directory, 'reply.json');
  const taskFile = join(directory, 'task.json'), schemaFile = join(directory, 'response-schema.json');
  const mcpFile = join(directory, 'mcp.json'), codexFile = join(directory, 'codex.config.toml'), namesFile = join(directory, 'tools.json');
  const codexProfile = `mahjong-${randomUUID()}`, codexProfileFile = join(process.env.CODEX_HOME || join(homedir(), '.codex'), `${codexProfile}.config.toml`);
  const toolMode = !!session;
  if (toolMode) input.context = agentContext(task.context);
  const text = `${agentPrompt({ ...task, toolMode })}\nTask JSON:\n${JSON.stringify(input)}\n`;
  const scriptPath = path => process.platform === 'win32' && task.config.script?.toLowerCase().endsWith('.sh') ? path.replace(/\\/g, '/') : path;
  let record, recordClosed, endpoint;
  try {
    if (toolMode) {
      endpoint = await serveTools(session);
      const mcp = { command: process.execPath, args: [fileURLToPath(new URL('./mahjong-mcp.js', import.meta.url))],
        env: { MAHJONG_TOOL_URL: endpoint.url, MAHJONG_TOOL_TOKEN: endpoint.token, NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' } };
      const tomlEnv = Object.entries(mcp.env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',');
      const toml = `{command=${JSON.stringify(mcp.command)},args=${JSON.stringify(mcp.args)},enabled=true,required=true,enabled_tools=${JSON.stringify(session.tools.map(t => t.name))},disabled_tools=[],default_tools_approval_mode="approve",env={${tomlEnv}}}`;
      const overrides = [`mcp_servers.mahjong=${toml}`, 'features.shell_tool=false', 'features.unified_exec=false', 'features.multi_agent=false',
        'features.apps=false', 'features.remote_plugin=false', 'features.memories=false', 'features.hooks=false', 'features.code_mode.enabled=false', 'web_search="disabled"'];
      await Promise.all([writeFile(mcpFile, JSON.stringify({ mcpServers: { mahjong: mcp } }), 'utf8'),
        writeFile(codexFile, overrides.join('\n') + '\n', 'utf8'),
        writeFile(namesFile, JSON.stringify(session.tools.map(t => `mcp__mahjong__${t.name}`)), 'utf8')]);
    }
    await Promise.all([writeFile(promptFile, text, 'utf8'), writeFile(taskFile, JSON.stringify(input), 'utf8'),
      writeFile(schemaFile, JSON.stringify(responseSchema(task)), 'utf8')]);
    if (signal.aborted) throw new Error('请求已取消');
    return await new Promise((resolve, reject) => {
      const child = spawnAgent(task.config, { cwd: task.config.cwd || directory,
        env: { MAHJONG_PROMPT_FILE: scriptPath(promptFile), MAHJONG_REPLY_FILE: scriptPath(replyFile),
          MAHJONG_TASK_FILE: scriptPath(taskFile), MAHJONG_SCHEMA_FILE: scriptPath(schemaFile), MAHJONG_TASK_DIR: scriptPath(directory),
          MAHJONG_MCP_CONFIG_FILE: toolMode ? scriptPath(mcpFile) : '', MAHJONG_CODEX_CONFIG_FILE: toolMode ? scriptPath(codexFile) : '',
          MAHJONG_CODEX_PROFILE: toolMode ? codexProfile : '', MAHJONG_CODEX_PROFILE_FILE: toolMode ? scriptPath(codexProfileFile) : '',
          MAHJONG_TOOL_NAMES_FILE: toolMode ? scriptPath(namesFile) : '', MAHJONG_NODE_BIN: process.execPath } });
      agentLog(task, '脚本启动', `pid=${child.pid || '?'}，script=${task.config.script || '高级命令'}，transport=${toolMode ? 'mcp' : 'task'}，prompt=${Buffer.byteLength(text, 'utf8')} bytes`);
      let receivedOutput = false;
      let receivedDiagnostics = false;
      const output = agentOutput(task);
      let stdout = '', diagnostics = '', failure, killing;
      const cancel = (error = new Error('请求已取消或进程响应超时')) => {
        failure ||= error;
        if (!killing) {
          agentLog(task, '终止脚本进程树', `pid=${child.pid || '?'}，原因=${error.message}`);
          killing = terminateAgent(child).then(() => agentLog(task, '进程终止命令已完成', `pid=${child.pid || '?'}`));
        }
        return killing;
      };
      record = { cancel, done: new Promise(resolve => { recordClosed = resolve; }) }; active.add(record);
      if (toolMode) session.done.then(() => {
        if (child.exitCode !== null || child.signalCode || signal.aborted) return;
        agentLog(task, '工具任务完成', '结束当前 CLI 进程');
        killing ||= terminateAgent(child);
      });
      const abort = () => { void cancel(); };
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        output.write('stdout', chunk);
        if (!receivedOutput) { receivedOutput = true; agentLog(task, '收到首段 stdout'); }
        stdout += chunk;
        if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT) { stdout = ''; void cancel(new Error('Agent 输出超过 1 MB')); }
      });
      child.stderr.on('data', chunk => {
        output.write('stderr', chunk);
        if (!receivedDiagnostics) { receivedDiagnostics = true; agentLog(task, 'CLI 开始输出诊断'); }
        diagnostics = (diagnostics + chunk).slice(-6000);
      });
      child.on('error', error => { failure ||= new Error(`Agent 脚本启动失败：${error.message}`); });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') void cancel(error); });
      child.on('close', async (code, exitSignal) => {
        output.flush();
        agentLog(task, toolMode && session.complete ? '工具完成后退出' : '脚本退出', `code=${code} signal=${exitSignal || '-'}`);
        if (toolMode) agentLog(task, '工具会话状态', JSON.stringify(session.diagnostics));
        signal.removeEventListener('abort', abort);
        try {
          if (killing) await killing;
          if (failure) throw failure;
          if (signal.aborted) throw new Error('请求已取消');
          if (toolMode && session.complete) { resolve(session.result()); return; }
          if (code !== 0) throw new Error(`Agent 脚本退出（${exitSignal || code}）${diagnostics.trim() ? `：${diagnostics.trim()}` : ''}`);
          if (toolMode) { resolve(session.result()); return; }
          let reply, source = 'reply.json';
          try {
            const info = await stat(replyFile);
            if (!info.isFile() || info.size > MAX_OUTPUT) throw new Error('Agent 回复文件无效或超过 1 MB');
            reply = await readFile(replyFile, 'utf8');
          } catch (error) { if (error.code !== 'ENOENT') throw error; source = 'stdout（回复文件不存在）'; reply = stdout; }
          agentLog(task, '读取最终回复', `来源=${source}，reply=${Buffer.byteLength(reply, 'utf8')} bytes，stdout=${Buffer.byteLength(stdout, 'utf8')} bytes，stderr尾部=${Buffer.byteLength(diagnostics, 'utf8')} bytes`);
          try { resolve(parseReply(task, reply)); }
          catch (error) {
            error.code = 'INVALID_AGENT_REPLY';
            const detail = `${error.message}\n来源：${source}\n回复预览：\n${outputPreview(reply)}`;
            error.message = detail;
            throw error;
          }
        } catch (error) {
          agentLog(task, signal.aborted ? '脚本任务已取消' : '脚本任务失败', error.message);
          if (!signal.aborted && diagnostics) agentLog(task, 'stderr 尾部', outputPreview(diagnostics.slice(-4000), 4000));
          if (!signal.aborted && stdout) agentLog(task, 'stdout 预览', outputPreview(stdout));
          reject(error);
        }
      });
      if (signal.aborted) abort();
      else child.stdin.end(text, 'utf8');
    });
  } finally {
    if (record) active.delete(record);
    await endpoint?.close();
    if (toolMode) await rm(codexProfileFile, { force: true }).catch(error => console.error('Agent 临时 profile 清理失败:', error.message));
    await rm(directory, { recursive: true, force: true }).catch(error => console.error('Agent 临时目录清理失败:', error.message));
    recordClosed?.();
  }
}

export async function closeScriptProcesses() {
  await Promise.all([...active].map(async record => { await record.cancel(new Error('Agent 已关闭')); await record.done; }));
}
