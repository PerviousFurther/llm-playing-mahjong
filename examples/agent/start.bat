@echo off
setlocal
rem Replace the command below with your CLI's single-task invocation.
rem Send only the final game JSON to stdout, or write MAHJONG_REPLY_FILE.
your-agent --print < "%MAHJONG_PROMPT_FILE%" > "%MAHJONG_REPLY_FILE%"
exit /b %errorlevel%
