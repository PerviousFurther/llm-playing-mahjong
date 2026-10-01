import { extname, dirname, isAbsolute } from 'node:path';
import { existsSync, statSync } from 'node:fs';

export function agentLaunch(config) {
  if (config.launchMode !== 'script') {
    if (!String(config.command || '').trim()) throw new Error('请输入 Agent 可执行程序路径');
    if (!Array.isArray(config.args || []) || !(config.args || []).every(a => typeof a === 'string')) throw new Error('进程参数需要是 JSON 字符串数组');
    return { command: config.command, args: config.args || [], cwd: config.cwd || undefined };
  }
  const script = String(config.script || '').trim();
  if (!isAbsolute(script) || !existsSync(script) || !statSync(script).isFile()) throw new Error('请输入存在的启动脚本绝对路径');
  const extension = extname(script).toLowerCase(), windows = process.platform === 'win32';
  const cwd = config.cwd || dirname(script);
  if (extension === '.sh') return { command: config.interpreter || 'bash', args: [script.replace(/\\/g, '/')], cwd };
  if (extension === '.ps1') return { command: config.interpreter || (windows ? 'powershell.exe' : 'pwsh'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], cwd };
  if (['.bat', '.cmd'].includes(extension)) {
    if (!windows) throw new Error('BAT / CMD 启动脚本需要 Windows');
    if (/["%&|<>^!\r\n]/.test(script)) throw new Error('BAT / CMD 脚本路径不能包含引号或命令控制字符');
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `""${script}""`], cwd, windowsVerbatimArguments: true };
  }
  throw new Error('启动脚本支持 .sh、.bat、.cmd 或 .ps1');
}
