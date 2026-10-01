#!/usr/bin/env bash
set -euo pipefail
# Optional: export DSH_BIN=/path/to/dsh
# Optional: export MAHJONG_DSH_PROVIDER=deepseek-account
# Optional: export MAHJONG_DSH_MODEL=deepseek-flash
# Optional: export MAHJONG_DSH_EFFORT=low # off | low | high | max
: "${MAHJONG_PROMPT_FILE:?Run this script through the game in MCP single-task mode}"
: "${MAHJONG_MCP_CONFIG_FILE:?Missing MCP configuration}"
: "${MAHJONG_TASK_DIR:?Missing task directory}"
: "${MAHJONG_NODE_BIN:?Missing Node executable}"
MAHJONG_DSH_MCP=$("$MAHJONG_NODE_BIN" -p 'JSON.stringify(JSON.parse(require("fs").readFileSync(process.env.MAHJONG_MCP_CONFIG_FILE,"utf8")).mcpServers.mahjong)')
export MAHJONG_DSH_MCP
export NODE_USE_ENV_PROXY=1 DSH_TELEMETRY_DISABLED=1
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec "${DSH_BIN:-dsh}" --profile headless --patch "$script_dir/mahjong.patch.yml" --json < "$MAHJONG_PROMPT_FILE"
