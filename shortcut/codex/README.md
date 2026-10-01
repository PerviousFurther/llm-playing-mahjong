# Codex 牌友

1. 安装并登录 Codex CLI，先确认 `codex --version`、`codex login status` 能运行。Windows 会查找 PATH 和 npm 默认安装目录；也可在 `start.ps1` 中设置 `CODEX_BIN` 为 `codex.exe` 或 `codex.cmd` 的绝对路径。
2. 点击牌友名字 → 设置连接 → 本机 Agent 进程 → 启动脚本 → MCP 工具 · 单次任务。填写本目录 `start.ps1`、`start.bat` 或 `start.sh` 的绝对路径，保存并检查连接。BAT 使用同目录 PS1 中的设置。 已有该目录的单次任务配置会自动升级。
3. 将座位游玩方式设为「LLM 自动游玩」，然后开局。

脚本直接调用 codex exec，加载游戏生成的临时 MCP 配置，禁用其他 MCP 和通用工具。出牌通过工具提交，聊天可多次调用 send_message，随后 finish_task。游戏管理队列、上下文、校验、取消和临时文件。所有 CLI 共用麻将 MCP 服务，不需要专用 mjs。旧「单次任务」模式仍使用 JSON Schema 和回复文件。

设置 `CODEX_MODEL` 可指定模型；留空使用 Codex 默认模型。每个任务是独立 CLI 调用，使用只读沙箱和 `--ephemeral`，不恢复旧会话。默认在游戏生成的临时目录运行，历史由游戏提供。

代理可在角色连接的「运行与网络」中设置，例如 `http://127.0.0.1:7890`；脚本继承游戏传入的代理环境变量。留空继承游戏服务的环境，无需修改脚本。

连接检查失败时，展开「查看诊断」可见具体启动错误。修正安装、登录或脚本路径后，重新点击「检查连接」。修改系统 PATH 后，需要重启游戏服务，让它取得新的环境变量。

通用接口见 [Agent 接入说明](../../docs/agent-process.md)。依据：[Codex 非交互调用官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)。
