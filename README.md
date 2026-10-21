# Echo · 个人贴文发布台（仿 Typefully）

本地优先的单人贴文发布工具：一次编辑，发布到 **X (Twitter)**、**Threads**、**Bluesky**、**Mastodon**；分段卡片内直接编辑长贴文、中英文字符分别计数、平台限额实时校验、图片、本地草稿箱与定时发布。零 npm 依赖，Node ≥ 22 即可运行。

> API / 开发者账号申请步骤见 **[docs/API_APPLY_GUIDE.md](docs/API_APPLY_GUIDE.md)**（X 为按量付费约 $0.015/条、新账号有最多 $70 免费积分；Threads 免费 250 条/天，个人使用成本极低）。

## 快速开始

```bash
# 1. 配置凭证（可选；不配置也能启动，账号页会引导申请）
cp .env.example .env
#   编辑 .env 填入 X_CLIENT_ID / THREADS_CLIENT_ID 等

# 2. 启动
npm start          # → http://127.0.0.1:8787

# 3. 运行测试（56 个用例，全部离线可跑）
npm test
```

## 功能对照（与 Typefully 对齐）

| 功能 | Echo 实现 |
| --- | --- |
| 平台 | X + Threads，均 OAuth 2.0 授权，支持同平台多账号 |
| 字符统计 | 中文字符 / 英文及其他**分别计数**；X 按加权规则（CJK×2、URL=23）；Threads 500 字平计 |
| 图片清理 | 可选开启（默认关闭）：每 24h 清理不被草稿/发布记录引用的孤儿图片，开启时需确认 |
| 分段编辑 | 每段一张卡片、直接在卡片内编辑；末段 Enter 新建、段首退格合并、`+ 添加分段`；每段独立计数与配图 |
| 图片 | X 每条 ≤4 张（≤5MB/张）；Threads 每条 ≤10 张（≤8MB/张），上限与 Typefully 一致 |
| 草稿箱 | 本地持久化（`data/drafts.json`），增删改查 |
| 定时发布 | 进程内调度器 30s 轮询，失败自动重试（5/15/60 分钟退避，共 3 次） |
| 分段卡片 | 每段独立计数、配图与超限提示（替代原预览功能） |
| 发布记录 | 每条贴文的状态、失败原因、原文链接 |

**未实现（有意取舍，原因见架构文档 §1.2）**：数据洞察看板（需付费 API）、AI 写作助手、团队协作。X Premium 25k 长贴文为预留扩展点。

## 使用要点

1. **连接账号**：「账号」页 → 连接 X / Threads（首次需在平台侧授权）。
2. **写作台**：在分段卡片里直接写 → 末段按 Enter 新建下一段 → 卡片内点「添加图片」或 Ctrl+V 粘贴截图 → 右侧勾选目标账号 → 保存草稿 / 定时 / 立即发布。
3. **Threads 带图/授权**：Threads API 要求**回调和图片都必须是 HTTPS 公网地址**（Meta 强制）。本机直连只能纯文字发 X；Threads 授权与带图发布需先跑隧道（如 `cloudflared tunnel --url http://127.0.0.1:8787`），把地址配到「设置 → Threads 图片公网地址」和 `.env` 的 `THREADS_REDIRECT_URI`，并在 Meta 后台登记 `https://<隧道域名>/auth/threads/callback`。详见 docs/API_APPLY_GUIDE.md §2.4。
4. **定时可靠性**：调度器在 Echo 进程内运行——**关机/退出期间到期的贴文，会在下次启动时自动补投**。需要 7×24 常驻时建议部署到 NAS / 服务器：仓库已自带 `Dockerfile` + `docker-compose.yml`（含 cloudflared 隧道），步骤见 **[docs/MIGRATE_TO_NAS.md](docs/MIGRATE_TO_NAS.md)**。

## 目录结构

```
server/          后端（零依赖 Node）
  platforms/     平台适配器：x.js / threads.js（新平台照 base.js 实现即可接入）
  auth.js        OAuth 连接与令牌自动刷新
  publish.js     发布流水线（校验 → 传媒体 → 发布 → 落库）
  scheduler.js   定时调度与重试
shared/          前后端共用：中英计数（chars.js）、分段解析（threadText.js）
public/          前端 SPA（无构建）
test/            56 个测试（node:test + mock HTTP，无需真实凭证）
docs/            架构设计、API 申请指南
data/            运行时数据（账号令牌、草稿、队列、媒体；gitignore）
```

## 扩展新平台（微博 / 小红书）

1. 在 `server/platforms/` 新增适配器，实现 `base.js` 定义的接口（限额、OAuth、上传、发布）。
2. 在 `server/platforms.js` 注册一行。
3. 在 `docs/API_APPLY_GUIDE.md` 补申请流程。

前端平台页签、限额徽标、发布流水线会自动识别新平台，无需改动。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 测试

```bash
npm test     # 56 passed
```

覆盖：中英计数/加权规则、分段解析、X/Threads 适配器（授权、媒体上传 v1.1→v2 回退、reply 链、CAROUSEL、令牌刷新）、调度器（到期/退避/补投）、REST API 与端到端发布（mock 平台服务）。**需要真实凭证的联调留给提供凭证后进行**。

## 安全提示

- `data/accounts.json` 保存平台访问令牌，勿同步到网盘或提交 git；`.env` 同理。
- OAuth state 一次性 5 分钟有效，PKCE S256。

## License

MIT
