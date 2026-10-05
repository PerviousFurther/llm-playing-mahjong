$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
# Native pipelines also need UTF-8 in the caller scope (my-start.ps1).
$global:OutputEncoding = $utf8
# Optional: $env:DSH_BIN = 'path\to\dsh.ps1' | 'path\to\dsh.cmd'
# Optional: $env:MAHJONG_DSH_PROVIDER = 'deepseek-account'
# Optional: $env:MAHJONG_DSH_MODEL = 'deepseek-flash'
# Optional: $env:MAHJONG_DSH_EFFORT = 'low' # off | low | high | max
if (!$env:MAHJONG_PROMPT_FILE -or !$env:MAHJONG_MCP_CONFIG_FILE -or !$env:MAHJONG_TASK_DIR -or !$env:MAHJONG_NODE_BIN) {
  throw '请由游戏以 MCP 模式运行此脚本'
}
$binary = $env:DSH_BIN
if (!$binary) {
  $command = Get-Command dsh.cmd,dsh -ErrorAction SilentlyContinue | Select-Object -First 1
  if (!$command) { throw '找不到 DeepSeek Harness，请安装 @deepseek-ai/dsh 或设置 DSH_BIN' }
  $binary = $command.Source
}
# Node preserves case-sensitive env keys such as NO_PROXY and no_proxy.
$env:MAHJONG_DSH_MCP = & $env:MAHJONG_NODE_BIN -p 'JSON.stringify(JSON.parse(require(''fs'').readFileSync(process.env.MAHJONG_MCP_CONFIG_FILE,''utf8'')).mcpServers.mahjong)'
if ($LASTEXITCODE -ne 0) { throw 'Failed to read Mahjong MCP configuration' }
$env:NODE_USE_ENV_PROXY = '1'
$env:DSH_TELEMETRY_DISABLED = '1'
$cliArgs = @('--profile', 'headless', '--patch', (Join-Path $PSScriptRoot 'mahjong.patch.yml'), '--json')
Get-Content -LiteralPath $env:MAHJONG_PROMPT_FILE -Raw -Encoding UTF8 | & $binary @cliArgs
exit $LASTEXITCODE
