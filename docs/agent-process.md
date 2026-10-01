# 本机 Agent 进程

点击牌友名字 → 设置连接 → 本机 Agent 进程 → 启动脚本，交互方式选择「MCP 工具 · 单次任务」，填写脚本绝对路径。支持 `.sh`、`.bat`、`.cmd`、`.ps1`。保存后点击「检查连接」，无需开局；这会实际调用一次 Agent。座位选择「LLM 自动游玩」即可自动打牌。本地牌友不需要连接，只有「由我游玩」启用教练。局内玩家、模型及房规锁定。

脚本运行方式：

| 扩展名 | 默认解释器 |
| --- | --- |
| `.sh` | `bash`，Windows 可在「运行与网络」填写 Git Bash 的 `bash.exe` 绝对路径 |
| `.ps1` | Windows 使用 `powershell.exe`；其他系统使用 `pwsh`，可指定解释器路径 |
| `.bat` / `.cmd` | Windows 使用 `cmd.exe` |

单次任务默认在独立临时目录运行；「运行与网络」中的工作目录可覆盖此默认值。脚本路径支持空格，BAT / CMD 路径不能含命令控制字符或变量展开字符。PowerShell 以 UTF-8 模板、无配置文件和非交互模式启动，ExecutionPolicy Bypass 只用于该进程。

`shortcut/codex`、`shortcut/qoder` 和 `shortcut/dsh` 是现成的 CLI 脚本；`examples/agent` 是通用模板。脚本把输入和临时工具配置交给 CLI，无需编写专用 JavaScript 桥接器。旧 JSON 模式另需保存最终回复。模型、可执行程序路径和其他 CLI 参数写在脚本中。dsh 使用 headless 配置补丁，仅支持 MCP 模式，详见 [dsh 接入说明](../shortcut/dsh/README.md)。

## MCP 工具与 API 工具调用

Codex、Qoder 共用 `server/mahjong-mcp.js`。连接设置选择「MCP 工具 · 单次任务」。已有指向 `shortcut/codex/start.*` 或 `shortcut/qoder/start.*` 的单次任务配置启动时自动升级；原 JSONL 配置不变。自定义脚本需读取临时 MCP 配置。

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| get_table | 无 | 实时牌桌状态、自己的手牌、本局公共记录和自己的私聊；连接检查中成功调用即完成任务 |
| discard / riichi | tile、speech、expression | 打牌或立直；tile 如 p6，游戏匹配合法的摸切后缀 |
| chi / pon / kan | meld、speech、expression | 副露或杠；meld 复制合法选项中的面子代码 |
| pass / declare_win / abort / continue | speech、expression | 无牌参数的动作；仅在允许时提供 |
| send_message | target、text、expression | public 全局，seat:0..3 私聊；教练只能发到 coach |
| finish_task | 无 | 完成聊天、事件、教练或连接检查 |

参数错误返回工具反馈，模型可以修正重试。一次决策只允许成功执行一个动作，成功后立即推进牌局并结束当前 CLI，不等待最终文字或 JSON。send_message 可多次调用，随后 finish_task。speech 可为空；expression 为可选参数，默认可选 hello、laugh、unhappy，完整列表见 state.expressionOptions。thinking 由游戏在等待回复时设置，气泡显示结束后回到 idle。没有调用动作工具的决策显示「回复异常」，不会从文字猜测出牌。

MCP 连接检查要求模型成功调用 `get_table`，文字确认不算通过。日志会显示工具加载、调用次数和读牌成功次数，失败时附上 CLI 输出预览。

运行游戏的终端默认逐行打印脚本 / JSONL Agent 的 stdout 和 stderr，带角色、任务 ID 和来源标记；未换行的末段在进程退出时打印。默认隐藏 Codex 的 user 输入回显及包含历史的单行 JSON，单行最多显示 1200 字符。查看原始输出可在启动前设置 `$env:MAHJONG_AGENT_OUTPUT='raw'; pnpm dev`，此时单行最多显示 16384 字符，常见密钥仍遮盖。关闭 CLI 输出使用 `$env:MAHJONG_AGENT_OUTPUT='0'; pnpm dev`，任务状态和错误日志仍保留。这些输出不写入牌局历史。

模型提示词使用简短房规，完整规则仍供界面及外部接入读取。`get_table` 向主进程读取最新状态，返回值不含规则文本或规则配置。`state.turn.discardSeat` 是需要出牌的座位，`respondingSeats` 是尚未完成吃碰杠和牌响应的座位，`yourActionRequired` 表示当前是否需要自己操作。`activeSeat` 在等待响应时仍指向刚出牌的玩家。公共与私聊记录只保留最近四次摸牌覆盖的一巡，未满一巡时从本局开始，各最多 32 条，事件只传 type/data，不传时间与编号。当前手牌、副露、全部弃牌、分数和合法动作仍完整提供。排队的聊天和事件在开始执行时刷新上下文；游戏保存的完整记录不受压缩影响。

每个任务的临时配置通过以下环境变量传入；工具接口只监听本机随机端口，使用任务专属随机令牌，完成或取消后撤销并清理。

| 环境变量 | 内容 |
| --- | --- |
| MAHJONG_MCP_CONFIG_FILE | 标准 MCP JSON 配置 |
| MAHJONG_CODEX_CONFIG_FILE | Codex 任务配置 TOML |
| MAHJONG_CODEX_PROFILE / MAHJONG_CODEX_PROFILE_FILE | 临时 profile 名称与路径；游戏负责清理 |
| MAHJONG_TOOL_NAMES_FILE | 当前任务允许的完整 MCP 工具名 JSON 数组 |
| MAHJONG_NODE_BIN | 游戏使用的 Node 可执行程序 |

Qoder 使用 strict MCP 配置，关闭内置工具，只允许本任务的麻将工具。Codex 在 CODEX_HOME 中创建任务专属临时 profile，保留原登录和模型提供方配置，临时禁用其他 MCP，并关闭 shell、网页搜索、其他 Agent、应用、插件、记忆和 hooks。完成或取消后删除 profile，不修改 config.toml；需要支持新式 profile 的 Codex CLI。工具只提供该座位可见的信息，动作由游戏引擎校验；本地 CLI 仍是本机程序，这不等于操作系统隔离。

API 模型通过 OpenAI 兼容 function calling 或 Anthropic tool use 复用同一套工具和处理逻辑，支持多轮调用。服务必须支持工具接口；无需给 API 服务暴露本机 MCP 端口。不支持时显示明确错误。本次不收集推理或思考链。

LLM 私聊其他 LLM 会自动入队回复，不限制双方互相触发的轮数。牌局记录的「全桌私聊记录」和导出的 allPrivateEvents 包含全桌私聊，仅本机管理界面可见，模型输入仍按座位隔离。公共发言进入公共上下文；Agent 的公共发言不会自动触发全桌模型回复。

## 单次脚本接口（旧 JSON 模式）

### 代理

角色连接设置 →「运行与网络」→「代理地址」，填写代理软件的 HTTP 端口，例如 `http://127.0.0.1:7890`，保存后检查连接。Codex、Qoder 及其他读取标准代理环境变量的 CLI 共用此设置，PS1 / BAT / SH 不需添加代理代码。

游戏只为该角色的子进程设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`WS_PROXY`、`WSS_PROXY` 及对应小写变量；绕过列表写入 `NO_PROXY` / `no_proxy`。留空继承启动游戏服务时的环境变量。此设置用于本机 Agent，不影响浏览器或其他角色。

也可以在启动游戏前设置环境变量，或直接在自己的脚本中设置；脚本设置会覆盖游戏传入的值。PowerShell 示例：

```powershell
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = $env:HTTP_PROXY
$env:WSS_PROXY = $env:HTTP_PROXY
pnpm dev
```

具体端口以代理软件为准。CLI 是否使用这些变量由其版本和自身网络配置决定；配置后通过「检查连接」验证实际调用。Qoder 的标准变量见[官方代理说明](https://docs.qoder.com/cli/troubleshoot-network)。Codex 企业证书设置见[官方认证说明](https://learn.chatgpt.com/docs/auth)。

连接失败时，角色卡片只显示断开状态。点击角色后，顶部连接区的「查看诊断」可展开完整错误，长日志在区域内滚动。

### 文件契约

游戏用环境变量传递文件路径，也将完整提示词写入 stdin 后关闭输入。所有文件都是 UTF-8。

| 环境变量 | 内容 |
| --- | --- |
| `MAHJONG_PROMPT_FILE` | 游戏整理好的规则、角色性格、当前事件、座位上下文与返回格式 |
| `MAHJONG_REPLY_FILE` | 脚本应写入最终回复的路径，初始不存在 |
| `MAHJONG_TASK_FILE` | 原始任务 JSON，供自定义脚本使用；不含连接密钥 |
| `MAHJONG_SCHEMA_FILE` | 当前任务的 JSON Schema，可交给支持结构化输出的 CLI |
| `MAHJONG_TASK_DIR` | 当前任务的临时目录 |

脚本正常完成时返回退出码 0。游戏优先读取回复文件；文件不存在时读取 stdout。两者都应是最终回复 JSON，可包一层 Markdown JSON 代码块。不要写 CLI 自身的事件流或包裹元数据。stdout 可以记录日志的前提是回复已写入文件，否则日志请写 stderr。非零退出码会显示 stderr 中的错误。输出上限 1 MB；完成或取消后清理临时目录。

原始任务示例：

```json
{"type":"task","id":"unique-id","seat":1,"role":"player","mode":"decision","context":{"rules":"...","state":{"version":12,"legalActions":[]},"publicContext":[],"privateContext":[]},"persona":{"name":"青竹","personality":"..."}}
```

## 任务与返回

| mode | 用途 | result |
| --- | --- | --- |
| check | 开局前检查进程及模型调用 | `{"text":"连接正常"}` |
| decision | 轮到座位弃牌或响应 | `{"action":"discard","value":"m1","speech":"轮到我了。"}` |
| event | 无需操作的牌桌事件 | `{"text":"刚才那张牌有意思。"}`，不发言返回 `{"text":""}` |
| chat | 用户发来公共或私聊消息 | `{"text":"回复"}` |
| review | 正常和牌或流局后的复盘与角色印象 | `{"text":"本局感受"}`，工具模式可多次 send_message |
| advice | 教练主动建议 | `{"text":"建议"}` |

单次脚本只返回结果对象，任务 id 由游戏管理：

```json
{"action":"pass","value":null,"speech":"我跳过。"}
```

聊天、事件、连接检查或建议示例：

```json
{"text":"收到，一起慢慢打。","expression":"laugh"}
```

无动作参数时 `value` 可以省略或为 null。Codex 的 schema 要求所有字段齐全；其他 CLI 可按提示词返回。回复建议不超过 60 个中文字，只发送一个表情。游戏统一处理回复长度、表情与合法动作，最后交给麻将引擎校验；脚本不用复制这些逻辑。

## 队列与上下文

通用提示词在 `server/agent-prompt.js`：CLI 脚本和 HTTP 模型共用，工具模式与旧 JSON 模式分别提供指令。角色口吻也可以在界面的「角色性格」修改。决策必须提交动作；`pass` 只表示跳过他人的弃牌或杠，自己的回合需要打牌。公开发言中的单张牌代码会转换为中文牌名，动作里的原始代码保持不变。

「桌边主动发言」控制无操作事件是否调用模型，默认关闭；出牌及用户聊天始终调用。出牌任务优先于尚未开始的闲聊，并为其取消正在执行的闲聊。运行游戏的终端会输出任务入队、执行、脚本启动/退出、收到结果、提交动作及耗时；等待期间每 15 秒输出一次状态。回复解析失败时，还会输出来源、字节数、具体解析错误、最多 2000 字符的回复/stdout 预览和最多 4000 字符的 stderr 尾部；空回复有独立提示。常见凭据字段会遮盖，预览可能含模型发言或 CLI 诊断内容。

游戏按角色维护任务队列，同一角色一次只执行一个任务；看牌期间收到聊天会排队。出牌和响应吃碰杠的决策插入队头；正在闲聊时取消闲聊进程，尚未回复的聊天留到之后处理。单次脚本及 CLI 每个任务启动一次，完成后退出。牌桌事件携带触发时的上下文快照，聊天在出队时刷新上下文。轮到该角色行动时，不额外重复发送同一阶段的 event。

状态变化或暂停会取消过期决策、主动建议；游戏终止对应脚本进程树，丢弃旧结果，然后执行下一条任务。技术超时为 120 秒，失败后牌桌等待重试。重试、修改配置或开新对局会清除相关旧任务并关闭旧进程。

开新对局时，游戏清空旧上下文。每次 CLI 调用也创建新会话：Codex 使用 `--ephemeral`，Qoder 使用 `--no-session-persistence`；不使用 resume / continue。CLI 的全局配置、插件或记忆不等同于会话历史，需由用户按实际 CLI 设置管理。

## 持续 JSONL 协议

已有持续通信程序可选择「持续协议 · JSONL」，脚本或高级命令均可。它们默认在脚本目录运行，空闲 30 秒后关闭。原有高级命令配置未指定交互方式时继续使用 JSONL；旧的自定义持续脚本需明确选 JSONL，Codex / Qoder 的新脚本需选单次任务。

输入为一行一个 `{"type":"task","id":"...",...}`，字段与原始任务相同；返回 `{"type":"result","id":"...","result":{...}}` 或 `{"type":"error","id":"...","error":"..."}`。取消时收到 `{"type":"cancel","id":"..."}`。stdout 仅用于协议，日志写 stderr，程序需要自己处理取消。

每条消息是完整 JSON，占一行并以换行符结束；不能把一个对象分成多行。请求和回复的 `id` 必须相同。例如收到决策任务后输出：

```json
{"type":"result","id":"unique-id","result":{"action":"discard","value":"p6","speech":"打出六筒。"}}
```

`value` 必须复制该任务 `context.state.legalActions` 中提供的值，可能带摸切等后缀。普通 Codex/Qoder CLI 不直接实现此协议，现有脚本使用「单次任务」即可。

进程是可自行访问本机文件的本地程序，输入过滤只控制游戏推送的信息，不是操作系统沙箱。需要严格隔离时请使用独立目录和受限运行环境。

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
| 模型提示词 | `server/agent-prompt.js` |
| 模型输入压缩、简短房规与最近一巡记录 | `server/agent-context.js` |
| 工具定义、参数校验、工具会话 | `server/agent-tools.js` |
| API 工具调用 | `server/api-agent.js` |
| 脚本任务、临时配置与进程清理 | `server/script-agent.js` |
| JSONL 进程通信 | `server/process-agent.js` |
| 表情、回复格式、聊天目标 | `shared/agent.js` |
| 页面入口与牌局操作 | `src/main.jsx` |
| 牌桌、角色、气泡和结算展示 | `src/table-scene.jsx` |
| 聊天、拖动与新消息定位 | `src/chat.jsx` |
| 房规、素材与外部接入设置 | `src/settings.jsx` |
| 模型与脚本连接设置 | `src/connection-settings.jsx` |

接入新的 CLI，先在启动脚本中适配参数，复用现有麻将 MCP。新增麻将工具时修改 `agent-tools.js`，通过 `agents.js` 提交到 `Room`；API 和 CLI 共用这条路径。连接配置改动放在 `agent-config.js` 和连接面板，机器人策略放在 `builtin-agent.js`。
