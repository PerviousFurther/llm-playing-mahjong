param(
    [Parameter(Mandatory = $true)][string]$Model,
    [string]$Server = 'llama-server',
    [string]$Alias = 'mahjong-model',
    [int]$Port = 8080,
    [string[]]$ServerArgs = @()
)
# Optional llama-server environment settings inherited by the child process:
# $env:LLAMA_ARG_CTX_SIZE = '8192'
# $env:LLAMA_ARG_N_GPU_LAYERS = 'all'
# $env:LLAMA_ARG_FLASH_ATTN = 'on'
# Set these in the caller (my-start.ps1); explicit ServerArgs take precedence.
# Model, Alias and Port are passed explicitly by this launcher, overriding
# LLAMA_ARG_MODEL, LLAMA_ARG_ALIAS and LLAMA_ARG_PORT.
# The game runner also passes HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY
# (and lowercase variants) when configured in the connection settings.
# No MAHJONG_PROMPT_FILE or MAHJONG_MCP_CONFIG_FILE is required for this service.
$ErrorActionPreference = 'Stop'
$serverPath = (Get-Command $Server -ErrorAction Stop).Source
$modelPath = (Resolve-Path -LiteralPath $Model -ErrorAction Stop).Path
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch { throw "Port $Port is already in use. Stop the existing service or choose another port in my-start.ps1." }
finally { $listener.Stop() }
$service = @{ baseUrl = "http://127.0.0.1:$Port/v1" } | ConvertTo-Json -Compress
Write-Output "MAHJONG_MODEL_SERVICE $service"
& $serverPath @ServerArgs --model $modelPath --alias $Alias --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
