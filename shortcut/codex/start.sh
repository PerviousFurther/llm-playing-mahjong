#!/usr/bin/env bash
set -e
# Optional: export CODEX_BIN=/path/to/codex
# Optional: export CODEX_MODEL=your-available-model
: "${MAHJONG_PROMPT_FILE:?Run this script through the game in single-task mode}"
: "${MAHJONG_REPLY_FILE:?Missing reply path}"
binary="${CODEX_BIN:-codex}"
args=(exec --ephemeral --skip-git-repo-check --sandbox read-only)
if [[ -n "${MAHJONG_MCP_CONFIG_FILE:-}" ]]; then
  "$binary" mcp list --json > "$MAHJONG_TASK_DIR/codex-servers.json"
  "$MAHJONG_NODE_BIN" -e 'const fs=require("fs"); const disabled=JSON.parse(fs.readFileSync(process.env.MAHJONG_TASK_DIR+"/codex-servers.json","utf8")).filter(s=>s.name!=="mahjong").map(s=>"mcp_servers."+JSON.stringify(s.name)+".enabled=false").join("\n"); fs.writeFileSync(process.env.MAHJONG_CODEX_PROFILE_FILE,disabled+"\n"+fs.readFileSync(process.env.MAHJONG_CODEX_CONFIG_FILE,"utf8"),"utf8")'
  args+=(--profile "$MAHJONG_CODEX_PROFILE")
else
  args+=(--output-schema "$MAHJONG_SCHEMA_FILE" --output-last-message "$MAHJONG_REPLY_FILE")
fi
if [[ -n "${CODEX_MODEL:-}" ]]; then args+=(--model "$CODEX_MODEL"); fi
exec "$binary" "${args[@]}" - < "$MAHJONG_PROMPT_FILE"
