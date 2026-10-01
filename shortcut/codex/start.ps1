$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
# optional: $env:CODEX_BIN = "path\to\codex.exe"
# optional: $env:CODEX_MODEL = 'gpt-6-luna'
if (!$env:MAHJONG_PROMPT_FILE -or !$env:MAHJONG_REPLY_FILE) { throw '请由游戏以单次任务模式运行此脚本' }
$binary = $env:CODEX_BIN
if (!$binary) {
  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command) { $binary = $command.Source }
  elseif ($env:APPDATA -and (Test-Path -LiteralPath (Join-Path $env:APPDATA 'npm\codex.cmd'))) { $binary = Join-Path $env:APPDATA 'npm\codex.cmd' }
  else { throw '找不到 Codex CLI，请安装并登录，或在脚本中设置 CODEX_BIN' }
}
$cliArgs = @('exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'model_reasoning_effort="low"')
if ($env:MAHJONG_MCP_CONFIG_FILE) {
  $servers = & $binary mcp list --json | Out-String | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw '无法读取 Codex MCP 配置，取消启动以避免加载其他工具' }
  $disabled = @()
  foreach ($server in $servers) {
    if ($server.name -eq 'mahjong') { continue }
    $key = ConvertTo-Json -InputObject $server.name -Compress
    $disabled += "mcp_servers.$key.enabled=false"
  }
  $configText = ($disabled -join "`n") + "`n" + (Get-Content -LiteralPath $env:MAHJONG_CODEX_CONFIG_FILE -Raw -Encoding UTF8)
  [System.IO.File]::WriteAllText($env:MAHJONG_CODEX_PROFILE_FILE, $configText, $utf8)
  $cliArgs += @('--profile', $env:MAHJONG_CODEX_PROFILE)
} else {
  $cliArgs += @('--output-schema', $env:MAHJONG_SCHEMA_FILE, '--output-last-message', $env:MAHJONG_REPLY_FILE)
}

if ($env:CODEX_MODEL) { $cliArgs += @('--model', $env:CODEX_MODEL) }
Get-Content -LiteralPath $env:MAHJONG_PROMPT_FILE -Raw -Encoding UTF8 | & $binary @cliArgs '-'
exit $LASTEXITCODE
