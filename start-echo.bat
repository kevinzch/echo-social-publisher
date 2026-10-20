@echo off
rem 启动 Echo 服务（本地 HTTP 服务，不依赖网络，开机即可运行）
rem Windows 上建议手动双击启动；NAS 部署请用 docker compose（自带重启策略）
cd /d "%~dp0"
node server/main.js
