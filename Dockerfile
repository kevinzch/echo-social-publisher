# Echo 运行镜像 —— 零 npm 依赖，只需要 Node 22+
# 构建：docker build -t echo-local .
# 说明见 docs/MIGRATE_TO_NAS.md
FROM node:22-alpine

ENV NODE_ENV=production \
    TZ=Asia/Kuala_Lumpur \
    ECHO_DATA_DIR=/app/data \
    PORT=8787

WORKDIR /app

# 无第三方依赖，直接拷源码（package.json 仅用于 engines/main 声明）
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public

# 数据目录占位（实际由 compose 的 ./data 挂载覆盖）
RUN mkdir -p /app/data

# 默认以 root 运行，避免 NAS 上 bind mount 的 uid/gid 映射导致 EACCES。
# 想以非 root 运行：取消下一行注释，并先把宿主机目录 chown -R 1000:1000 ./data
# USER node

EXPOSE 8787

# 供 docker compose 的 depends_on: condition: service_healthy 使用
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/config > /dev/null || exit 1

CMD ["node", "server/main.js"]
