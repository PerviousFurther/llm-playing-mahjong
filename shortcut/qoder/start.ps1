$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
# $env:QODER_BIN = '%USERDIR%\.qoder\bin\qodercli\qodercli-1.1.65.exe'
# $env:QODER_MODEL = 'Qwen3.8-Flash'
if (!$env:MAHJONG_PROMPT_FILE -or !$env:MAHJONG_REPLY_FILE) { throw '请由游戏以单次任务模式运行此脚本' }
$binary = $env:QODER_BIN
if (!$binary) {
  $command = Get-Command qodercli,qoder -ErrorAction SilentlyContinue | Select-Object -First 1
  if (!$command) { throw '找不到 Qoder CLI, 请在脚本中设置 QODER_BIN' }
  $binary = $command.Source
}
$cliArgs = @('-p', '--no-session-persistence', '--output-format', 'text', '--reasoning-effort', 'low')
if ($env:MAHJONG_MCP_CONFIG_FILE) {
  $tools = @(Get-Content -LiteralPath $env:MAHJONG_TOOL_NAMES_FILE -Raw -Encoding UTF8 | ConvertFrom-Json)
  $settingsFile = Join-Path $env:MAHJONG_TASK_DIR 'qoder.settings.json'
  $settings = @{ mcp = @{ lazyLoad = $false }; permissions = @{ allow = $tools } }
  [System.IO.File]::WriteAllText($settingsFile, ($settings | ConvertTo-Json -Depth 8), $utf8)
  $mcpFile = Join-Path $env:MAHJONG_TASK_DIR 'qoder.mcp.json'
  # Node preserves case-sensitive env keys such as NO_PROXY and no_proxy.
  $prepareMcp = @'
const fs = require('fs'), path = require('path'), env = process.env;
const tools = JSON.parse(fs.readFileSync(env.MAHJONG_TOOL_NAMES_FILE, 'utf8'));
const names = tools.map(name => name.replace(/^mcp__mahjong__/, ''));
const mcp = JSON.parse(fs.readFileSync(env.MAHJONG_MCP_CONFIG_FILE, 'utf8'));
Object.assign(mcp.mcpServers.mahjong, { trust: true, alwaysAllow: names, includeTools: names });
fs.writeFileSync(path.join(env.MAHJONG_TASK_DIR, 'qoder.mcp.json'), JSON.stringify(mcp));
'@
  & $env:MAHJONG_NODE_BIN -e $prepareMcp
  if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare Qoder MCP configuration' }
  $cliArgs += @('--mcp-config', $mcpFile, '--strict-mcp-config', '--allowed-mcp-server-names', 'mahjong',
    '--tools', ($tools -join ','), '--allowed-tools', ($tools -join ','), '--settings', $settingsFile, '--permission-mode', 'dont_ask')
} else { $cliArgs += '--tools=' }
if ($env:QODER_MODEL) { $cliArgs += @('-m', $env:QODER_MODEL) }
if ($env:MAHJONG_MCP_CONFIG_FILE) {
  # Stream CLI output to the runner so failed tool sessions retain diagnostics.
  Get-Content -LiteralPath $env:MAHJONG_PROMPT_FILE -Raw -Encoding UTF8 | & $binary @cliArgs
  exit $LASTEXITCODE
}
$reply = Get-Content -LiteralPath $env:MAHJONG_PROMPT_FILE -Raw -Encoding UTF8 | & $binary @cliArgs
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) { exit $exitCode }
[System.IO.File]::WriteAllText($env:MAHJONG_REPLY_FILE, ($reply -join "`n"), $utf8)
exit 0
