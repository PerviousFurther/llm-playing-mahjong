#!/usr/bin/env bash
set -e
# Optional: export QODER_BIN=/path/to/qodercli
# Optional: export QODER_MODEL=your-available-model
: "${MAHJONG_PROMPT_FILE:?Run this script through the game in MCP mode}"
: "${MAHJONG_MCP_CONFIG_FILE:?Missing MCP configuration}"
args=(-p --no-session-persistence --output-format text)
tools="$("$MAHJONG_NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.MAHJONG_TOOL_NAMES_FILE,"utf8")).join(","))')"
"$MAHJONG_NODE_BIN" <<'NODE'
const fs = require('fs'), path = require('path'), env = process.env;
const tools = JSON.parse(fs.readFileSync(env.MAHJONG_TOOL_NAMES_FILE, 'utf8'));
const names = tools.map(name => name.replace(/^mcp__mahjong__/, ''));
const mcp = JSON.parse(fs.readFileSync(env.MAHJONG_MCP_CONFIG_FILE, 'utf8'));
Object.assign(mcp.mcpServers.mahjong, { trust: true, alwaysAllow: names, includeTools: names });
fs.writeFileSync(path.join(env.MAHJONG_TASK_DIR, 'qoder.mcp.json'), JSON.stringify(mcp));
fs.writeFileSync(path.join(env.MAHJONG_TASK_DIR, 'qoder.settings.json'), JSON.stringify({ mcp: { lazyLoad: false }, permissions: { allow: tools } }));
NODE
args+=(--mcp-config "$MAHJONG_TASK_DIR/qoder.mcp.json" --strict-mcp-config --allowed-mcp-server-names mahjong --tools "$tools" --allowed-tools "$tools" --settings "$MAHJONG_TASK_DIR/qoder.settings.json" --permission-mode dont_ask)
if [[ -n "${QODER_MODEL:-}" ]]; then args+=(-m "$QODER_MODEL"); fi
binary="${QODER_BIN:-}"
if [[ -z "$binary" ]]; then binary="$(command -v qodercli || command -v qoder)"; fi
exec "$binary" "${args[@]}" < "$MAHJONG_PROMPT_FILE"
