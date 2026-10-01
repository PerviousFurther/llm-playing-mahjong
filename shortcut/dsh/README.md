# DeepSeek Harness 牌友

安装支持 `headless` 和 `--patch` 的官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli)：

```powershell
npm install -g @deepseek-ai/dsh
$env:DEEPSEEK_API_KEY = '你的密钥'
pnpm dev
```

密钥通过启动游戏的终端环境或 dsh 自身凭据管理提供，不要写入仓库。已有 dsh 凭据可继续使用。

点击角色 → 设置连接 → 本机 Agent 进程 → 启动脚本 → **MCP 工具 · 单次任务**，填写 `shortcut/dsh/start.ps1` 的绝对路径，保存并检查连接。Windows 也可用 `start.bat`；Linux / macOS 用 `start.sh`。将座位设为「LLM 自动游玩」后开局。

## 模型和思考深度

脚本顶部有可取消注释的设置，也可以在启动游戏前设置环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DSH_BIN` | PATH 中的 dsh | CLI 路径；Windows 支持 npm 的 dsh.cmd |
| `MAHJONG_DSH_PROVIDER` | deepseek-official | 提供方；已登录的账户可选择 deepseek-account |
| `MAHJONG_DSH_MODEL` | deepseek-flash | 实际可用的模型 ID |
| `MAHJONG_DSH_EFFORT` | low | off / low / high / max |

例如使用 dsh 账户登录：

```powershell
$env:MAHJONG_DSH_PROVIDER = 'deepseek-account'
pnpm dev
```

提供方必须已在 dsh 配好凭据；模型可用性取决于账户和服务端。参考[默认模型设置](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/agent-default-model)和[DeepSeek 提供方](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-deepseek)。

## 工作方式

PS1 / BAT / SH 共用 `mahjong.patch.yml`，从游戏的临时配置读取麻将 MCP。只有一小段 Node 命令读取 JSON，复用游戏现有 MCP 桥接器。

每次用 headless 创建新会话，不传 session-id。会话日志和存储放在任务临时目录，结束后由游戏清理。补丁关闭默认的文件、终端、网页、子 Agent 和技能工具，不读取项目角色指令；麻将工具无须交互批准。此配置继承用户的 dsh home 和 headless 配置以保留凭据，**自行添加的插件或其他 MCP 仍需在 dsh 中禁用**，并非操作系统沙箱。

stdout 使用 dsh `--json` 事件流，便于在游戏控制台查看工具调用；游戏按 MCP 动作判断结果，不解析这份事件流为出牌 JSON。聊天可以多次调用 `send_message`，之后 `finish_task`；出牌调用相应动作工具即可。只支持游戏 MCP 模式。

代理在角色的「运行与网络」中填写，脚本继承代理变量并设置 `NODE_USE_ENV_PROXY=1`。dsh 使用 Node 内置 fetch，此开关需要 Node 24.0+ 或 22.21+；HTTPS 代理所需证书按本机 Node 配置处理。

接口见 [Agent 接入说明](../../docs/agent-process.md)。配置依据：[headless](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/headless)、[MCP client](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client)。
