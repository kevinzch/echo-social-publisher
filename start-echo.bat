@echo off
rem 启动 Echo 服务（供任务计划开机自启使用）
cd /d "%~dp0"
node server/main.js
