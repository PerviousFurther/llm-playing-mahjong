#!/usr/bin/env bash
set -e
# Replace your-agent and flags with your CLI's invocation.
if [[ -n "${MAHJONG_MCP_CONFIG_FILE:-}" ]]; then
  # Adapt MCP loading; disable built-in/other tools and allow mahjong tools only.
  exec your-agent --print --mcp-config "$MAHJONG_MCP_CONFIG_FILE" < "$MAHJONG_PROMPT_FILE"
else
  # Legacy JSON mode: stdout is the final JSON; logs belong on stderr.
  exec your-agent --print < "$MAHJONG_PROMPT_FILE" > "$MAHJONG_REPLY_FILE"
fi
