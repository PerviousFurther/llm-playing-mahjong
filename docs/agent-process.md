# 本机 Agent 接入

点击角色 → 设置连接 → 本机 Agent 进程，选择启动脚本或高级命令，保存后检查连接。座位设为「LLM 自动游玩」即可自动打牌。只有「由我游玩」启用教练；局内玩家和连接配置锁定。

本机 Agent 只支持 MCP，每个任务启动一个进程。原来的单次 JSON 回复和持续 JSONL 接口已删除，旧配置统一迁移为 MCP。自定义旧脚本须改为加载 MCP 配置并调用工具，输出 JSON 不再执行牌局动作。

## 启动脚本

现成脚本在 `shortcut/codex`、`shortcut/qoder` 和 `shortcut/dsh`，模型、CLI 路径及额外参数在脚本中设置。填写脚本绝对路径：

| 扩展名 | 默认解释器 |
| --- | --- |
| `.sh` | bash；Windows 可指定 Git Bash 的 bash.exe |
| `.ps1` | Windows 使用 powershell.exe，其他系统使用 pwsh |
| `.bat` / `.cmd` | Windows 使用 cmd.exe |

每个任务默认在独立临时目录运行，可在「运行与网络」覆盖工作目录。脚本路径支持空格；BAT / CMD 路径不能含命令控制字符或变量展开字符。PowerShell 使用 UTF-8、无配置文件、非交互模式，ExecutionPolicy Bypass 仅用于该进程。

## 文件与环境变量

游戏将提示词写入 stdin 后关闭输入，以下文件均为 UTF-8。任务完成或取消后关闭工具端口并清理临时文件。

| 环境变量 | 内容 |
| --- | --- |
| MAHJONG_PROMPT_FILE | 房规、角色、当前任务和精简上下文 |
| MAHJONG_TASK_FILE | 任务 JSON，不含模型连接密钥 |
| MAHJONG_TASK_DIR | 任务临时目录 |
| MAHJONG_MCP_CONFIG_FILE | 标准 MCP JSON 配置 |
| MAHJONG_CODEX_CONFIG_FILE | Codex 任务配置 TOML |
| MAHJONG_CODEX_PROFILE / MAHJONG_CODEX_PROFILE_FILE | 临时 profile 名称和路径 |
| MAHJONG_TOOL_NAMES_FILE | 当前任务允许的完整 MCP 工具名 JSON 数组 |
| MAHJONG_NODE_BIN | 游戏使用的 Node 可执行程序 |

stdout / stderr 只用于诊断，不解析为动作或聊天。完成动作工具调用后，游戏结束 CLI 进程，无需等待最终文字。未调用工具就退出会报错。

## 工具与任务

所有 CLI 共用 `server/mahjong-mcp.js`，工具由 `server/agent-tools.js` 定义并校验。

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| get_turn | 无 | 当前轮次、合法动作和最新事件；连接检查调用一次即完成 |
| get_hand | 无 | 自己的手牌、向听数、进张与役牌提示 |
| get_player | seat | 指定座位公开的弃牌、副露、立直和分数 |
| get_messages | after、limit | 可见的近期聊天；after=0 取最新，否则增量读取 |
| analyze_actions | action、value、limit | 比较合法弃牌或副露；value 空串比较该类动作 |
| discard / riichi | tile、speech、expression | 打牌或立直；牌参数按合法动作匹配 |
| chi / pon / kan | meld、speech、expression | 吃碰杠；meld 使用合法面子代码 |
| pass / declare_win / abort / continue | speech、expression | 无牌参数的动作，仅在允许时提供 |
| send_message | target、text、expression | public 全局、seat:0..3 私聊；教练仅能发到 coach |
| finish_task | 无 | 结束聊天、事件、建议或复盘 |

speech、expression 可省略。一次决策可连续看牌、分析和聊天，但只能成功执行一个牌局动作。参数错误可以修正重试；收到 cancelled=true 或 retryable=false 后停止。连接检查只提供 get_turn，文字确认不算通过。

| mode | 完成方式 |
| --- | --- |
| check | 调用 get_turn |
| decision | 调用一个合法动作工具；可先聊天 |
| chat / advice / review | send_message 后 finish_task |
| event | 可发言，也可直接 finish_task |

初始上下文提供精简轮次、座位分数和最近四条可见聊天；决策和建议任务附带自己的手牌。其他信息按需读取。state.turn.discardSeat 是需要出牌的座位，respondingSeats 是仍在响应弃牌或杠的座位。不要从旧事件或聊天推断当前轮次。

分析只使用自己的手牌与公开信息。unseen 包含他人暗牌和死牌墙，不等于牌山剩余；向听数不保证有役，也不是胜率或完整防守评分。完整牌局记录保存在本机，不作为整份上下文发送。

API 模型通过 OpenAI 兼容 function calling 或 Anthropic tool use 复用同一套工具；无需暴露本机 MCP 端口，服务必须支持工具调用。

## 队列与取消

每个角色一次执行一个任务。决策优先于闲聊，状态变化或暂停会取消过期任务；失败时牌桌等待重试，不自动代打。技术超时为 120 秒。公共发言不会触发全桌模型回复，LLM 私聊会触发接收者回复。「桌边主动发言」控制无需操作时的牌桌事件反馈。

提示词在 `server/agent-prompt.js` 中直接返回 Markdown 格式的字符串，填入角色名、性格、房规和当前任务。修改后重启服务生效。角色性格可在界面设置；thinking、idle 由游戏控制，发言表情使用当前工具定义允许的值。

## 网络与诊断

「运行与网络」可填写 HTTP(S) 代理地址和绕过列表。游戏仅为该角色的子进程设置 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY、WS_PROXY、WSS_PROXY 及对应小写变量，绕过列表写入 NO_PROXY / no_proxy；留空继承服务环境。CLI 是否使用这些变量由其实现决定，保存后通过检查连接验证。

终端打印队列、工具调用、退出和耗时，等待期间每 15 秒输出状态。角色面板可展开错误诊断。MAHJONG_AGENT_OUTPUT=raw 显示完整 CLI 输出，0 隐藏 CLI 输出；日志不进入牌局历史。

工具只提供对应座位可见的信息，动作由引擎校验。附带脚本限制 CLI 可用工具，但 MCP 本身不是操作系统沙箱；自定义脚本仍须限制文件、终端和其他 MCP 能力。各 CLI 的配置说明见 shortcut/。

## 立绘元数据

`asset/<角色>/metadata.json`：

```json
{"toward-left":true,"avatar":"portrait.png"}
```

`toward-left` 描述原立绘的朝向。左边座位朝右、右边座位朝左，方向不符时自动水平翻转。`avatar`（也兼容 `avatar-path`）是相对该角色目录的头像路径；未提供头像时身份栏显示名字首字。全身立绘放在桌后，桌面遮挡下半身。更改 metadata 后重启服务。

角色面板会列出带 metadata 的素材目录，同一角色素材可以重复分配给多个座位。普通立绘使用 `idle.png`；表情支持 `thinking.png`、`happy.png` / `laugh.png`、`surprised.png` / `hello.png`、`embarrassed.png` / `unhappy.png`。也兼容旧的 `gpt-` 文件名。可以在角色面板单独导入立绘或表情。服务器启动时扫描带 metadata 的角色目录中的 PNG，文件名即表情名（小写英文、数字、下划线或连字符）。排除 idle、thinking、头像和背景后与默认三种表情合并，静态生成 expressionOptions；添加表情文件后需重启服务器。旧名 happy/surprised/embarrassed 分别映射为 laugh/hello/unhappy。缺少对应素材时使用 idle。

## 修改代码的位置

| 内容 | 文件 |
| --- | --- |
| 角色配置校验、旧配置迁移 | `server/agent-config.js` |
| 排队、决策优先级、结果提交 | `server/agents.js` |
| 任务取消、超时与执行分发 | `server/agent-worker.js` |
| 本地机器人与本地教练策略 | `server/builtin-agent.js` |
| Markdown 格式的模型提示词 | `server/agent-prompt.js` |
| 精简模型输入、简短房规与聊天分页 | `server/agent-context.js` |
| 工具定义、参数校验、工具会话 | `server/agent-tools.js` |
| API 工具调用 | `server/api-agent.js` |
| 脚本任务、临时配置与进程清理 | `server/script-agent.js` |
| 表情、回复格式、聊天目标 | `shared/agent.js` |
| 页面入口与牌局操作 | `src/main.jsx` |
| 牌桌、角色、气泡和结算展示 | `src/table-scene.jsx` |
| 聊天、拖动与新消息定位 | `src/chat.jsx` |
| 房规、素材与外部接入设置 | `src/settings.jsx` |
| 模型与脚本连接设置 | `src/connection-settings.jsx` |

接入新的 CLI，先在启动脚本中适配参数，复用现有麻将 MCP。新增麻将工具时修改 `agent-tools.js`，通过 `agents.js` 提交到 `Room`；API 和 CLI 共用这条路径。连接配置改动放在 `agent-config.js` 和连接面板，机器人策略放在 `builtin-agent.js`。

## 私有短记忆

`update_memory({ text })` 替换当前角色的记忆，建议英文，最多 1000 字符。未调用则保留，空字符串清空；追加内容时自行保留有用的旧笔记。动作工具和 `finish_task` 会结束任务，需在它们之前更新。

后续任务直接收到 `memory: { text, matchHand, version }`（无记忆时为 `null`），不需要额外读取。可记录策略、角色印象和待接的话题，当前牌况仍以游戏状态为准。玩家和教练各自隔离，跨小局保留，新对战清空，并随存档保存。更新作为 `memory` 事件进入对应私有记录池，本机可在上下文池查看，导出的回放也包含这些记录。连接检查不提供记忆写入工具。

只有复用笔记减少了重复分析或历史查询时才可能提速；每轮重写会增加一次工具往返，不应为保持原样而调用。
