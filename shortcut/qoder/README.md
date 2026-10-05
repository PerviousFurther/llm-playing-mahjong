# Qoder 牌友

1. 安装并登录 Qoder CLI。命令名可以是 `qodercli` 或 `qoder`。在 `start.ps1` 中设置 `QODER_BIN` 为实际可执行文件的绝对路径；已保留原脚本中的本地路径和模型设置，升级版本时更新路径。
2. 点击牌友名字 → 设置连接 → 本机 Agent 进程 → 启动脚本。填写本目录 `start.ps1`、`start.bat`、`start.cmd` 或 `start.sh` 的绝对路径，保存并检查连接。BAT / CMD 使用同目录 PS1 中的设置。
3. 将座位游玩方式设为「LLM 自动游玩」，然后开局。

脚本直接调用 qodercli -p，加载游戏生成的临时 MCP 配置；strict 模式跳过其他 MCP，关闭内置工具，并仅允许本任务的麻将工具。出牌通过工具提交，聊天可多次调用 send_message，随后 finish_task。使用 no-session-persistence，不恢复旧会话。所有 CLI 共用麻将 MCP 服务。

MCP 模式同时设置工具可见列表与自动批准列表，并通过任务临时 settings 文件关闭工具懒加载。连接检查只需成功调用 `get_turn`。CLI 输出直接交给游戏，失败时终端显示工具会话统计和输出预览；无需修改 Qoder 的全局配置。[工具列表与批准列表的区别](https://docs.qoder.com/cli/sdk/mcp)、[懒加载说明](https://docs.qoder.com/cli/mcp-reference)。

脚本为当前任务另生成 `qoder.mcp.json`，仅将游戏的 mahjong 服务设为 `trust: true`，并按任务填入 `includeTools` / `alwaysAllow`；临时 settings 同时声明精确的 `permissions.allow`。保留 `dont_ask`，麻将工具自动批准，其他工具不会弹出批准提示。任务结束后临时文件一起删除。[MCP 信任与自动批准配置](https://docs.qoder.com/cli/mcp-reference)。

设置 `QODER_MODEL` 可指定模型；删除该设置可使用 Qoder 默认模型。游戏默认提供独立临时工作目录，每个任务启动一次 CLI，结束后清理输入输出文件。

代理可在角色连接的「运行与网络」中设置，例如 `http://127.0.0.1:7890`；脚本继承游戏传入的代理环境变量。留空继承游戏服务的环境，无需修改脚本。

通用接口见 [Agent 接入说明](../../docs/agent-process.md)。依据：[Qoder 脚本调用](https://docs.qoder.com/cli/run-in-scripts)、[参数说明](https://docs.qoder.com/cli/cli-reference)和[代理说明](https://docs.qoder.com/cli/troubleshoot-network)。
