# 本机模型服务

在本目录的 `my-start.ps1` 中配置模型路径和运行参数。此文件被 Git 忽略；不存在时可以按以下内容创建：

```powershell
$llamaConfig = @{
    Server = 'D:\llama\llama-server.exe'
    Model = 'D:\models\your-model.gguf'
    Alias = 'mahjong-model'
    Port = 8080
    ServerArgs = @('--ctx-size', '8192', '--gpu-layers', 'all')
}
& (Join-Path $PSScriptRoot 'start.ps1') @llamaConfig
exit $LASTEXITCODE
```

游戏中选择「OpenAI 兼容 API」，开启「连接前启动本机服务」，填写 `my-start.ps1` 的绝对路径，保存并检查连接。游戏自动启动服务、等待模型加载、识别地址和模型名，不需要手动填写 API 设置。多个角色使用同一脚本和运行设置时共用一个进程。取消单次思考不会卸载模型；修改连接配置或退出游戏时，游戏关闭自己启动且不再使用的服务。

`$llamaConfig` 是脚本局部变量。`ServerArgs` 原样传入 llama-server；思考、上下文和显卡参数按模型与本机 `llama-server --help` 配置。不传思考参数则使用服务默认行为。`start.ps1` 不绑定模型，也不加载额外 MCP 服务。

可在 `my-start.ps1` 中设置 llama-server 环境变量，`start.ps1` 的注释列出常用项；显式命令参数优先于环境变量。模型支持时，也可在 `ServerArgs` 中添加 `--reasoning off`，具体选项以本机版本帮助为准。`my-start.ps1` 仅保存本地配置，通用启动逻辑放在 `start.ps1`。

脚本通过一行 `MAHJONG_MODEL_SERVICE {"baseUrl":"http://127.0.0.1:8080/v1"}` 向游戏报告地址。游戏复用现有 runner 管理进程，共用 API 决策循环和麻将工具校验，工具结果直接传回模型。

也可以手动运行脚本，关闭「连接前启动本机服务」并填写 API 地址；模型名留空可自动检测单个模型。已被占用的端口不会由启动脚本接管，请停止旧服务或修改 `Port`。
