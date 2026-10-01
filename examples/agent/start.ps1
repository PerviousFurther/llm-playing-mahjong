$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
# Replace your-agent and flags with your CLI's invocation.
if ($env:MAHJONG_MCP_CONFIG_FILE) {
  # Adapt MCP loading, disable built-in/other tools, and allow mahjong tools only.
  Get-Content -LiteralPath $env:MAHJONG_PROMPT_FILE -Raw -Encoding UTF8 | & your-agent --print --mcp-config $env:MAHJONG_MCP_CONFIG_FILE
} else {
  # Legacy single-task JSON mode: stdout is the final JSON; logs go to stderr.
  Get-Content -LiteralPath $env:MAHJONG_PROMPT_FILE -Raw -Encoding UTF8 | & your-agent --print
}
exit $LASTEXITCODE
