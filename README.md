# Echo · 个人贴文发布台（仿 Typefully）

本地优先的单人贴文发布工具：一次编辑，发布到 **X (Twitter)**、**Threads**、**Bluesky**、**Mastodon**。
分段卡片内直接编辑长贴文、中英文字符分别计数、平台限额实时校验、图片拖拽排序、本地草稿箱、定时发布与发布记录。
**零 npm 依赖**，Node ≥ 22 即可运行。

> 各平台申请/连接步骤见 **[docs/API_APPLY_GUIDE.md](docs/API_APPLY_GUIDE.md)**。
> 只有 X 与 Threads 需要开发者账号；Bluesky 用 App Password、Mastodon 用实例令牌，几分钟就能连上。

## 快速开始

```bash
# 1. 配置凭证（可选；不配置也能启动，账号页会引导）
cp .env.example .env
#   填 X_CLIENT_ID / THREADS_CLIENT_ID 等（Bluesky / Mastodon 在页面里填即可）

# 2. 启动
npm start          # → http://127.0.0.1:8787

# 3. 测试（170 个用例，全部离线可跑）
npm test
```

## 功能

### 写作台

| 功能 | 说明 |
| --- | --- |
| 分段卡片 | 每段一张卡片、就地编辑；末段 Enter 新建、段首退格合并 |
| 键盘快捷键 | `Ctrl/⌘+Enter` 加分段；`Alt+↑/↓` 上下移动分段 |
| 拖拽排序 | 拖段号徽标移动整段；拖图片缩略图调整段内图片顺序 |
| 字符统计 | 中文 / 英文分别计数；按平台规则算限额（见下表） |
| 图片 | 粘贴截图或选择文件；点击缩略图放大查看（← → 切换、Esc 关闭） |
| 平台开关 | 每段独立勾选发到哪些平台；含链接时 X 自动取消（可手动改回） |
| 目标账号 | 右侧勾选账号；勾选平台会自动选中该平台账号，反之亦然 |
| 本地暂存 | 内容与勾选实时写入 localStorage，刷新/切页不丢 |

### 发布

| 功能 | 说明 |
| --- | --- |
| 立即发布 | 逐账号发布，弹窗实时显示每个账号的进度与结果链接 |
| 定时发布 | 进程内调度器 30 秒轮询；失败自动重试（5/15/60 分钟退避，共 3 次） |
| 部分成功 | 线程中途失败时显示「已发布 N/M 段」并列出已发段的链接 |
| 发布前校验 | 字数/图片数量/单图大小/格式/平台权限，任一不过则整体阻止 |
| 发布记录 | 每条贴文的状态、失败原因、原文链接 |

### 数据与运维

| 功能 | 说明 |
| --- | --- |
| 草稿箱 | 服务端持久化（`data/drafts.json`），保存文字、图片、**每段平台勾选**、目标账号 |
| 图片存储 | `data/media/` + `data/media.json` 索引 |
| 孤儿清理 | 可选开启（默认关闭）：清理不被草稿/发布记录引用的图片，支持「新图保护期」 |
| 设置页 | 调度间隔、默认发布时间、Threads 图片地址、图片清理策略 |
| 多实例 | 自带 `Dockerfile` + `docker-compose.yml`（含 cloudflared 隧道），可迁到 NAS 常驻 |

**有意不做**：数据洞察看板（需付费 API）、AI 写作助手、团队协作、小红书自动发布（无官方发布 API，见 docs/ARCHITECTURE.md）。

## 平台支持

| | X (Twitter) | Threads | Bluesky | Mastodon |
| --- | --- | --- | --- | --- |
| 授权方式 | OAuth 2.0 + PKCE | OAuth 2.0 / 长期令牌 | Handle + App Password | 实例地址 + 访问令牌 |
| 字数上限 | 280（加权） | 500 | 300 | 500 |
| 链接计法 | 按 23 字符 | 按字面长度 | 按字面长度 | 按 23 字符 |
| 图片 | ≤4 张 / 5MB | ≤10 张 / 8MB | ≤4 张 / 1MB | ≤4 张 / 16MB |
| 图片传输 | v2 `/2/media/upload`（base64） | 需公网 `image_url` | 二进制上传 | 二进制上传 |
| 线程 | reply 链 | reply 链 | reply 链 | reply 链 |
| 费用 | 按量付费 ≈ $0.015/条（含 URL $0.2） | 免费（250 条/天） | 免费 | 免费（实例自付） |

> X 的图片上传必须走 **v2 接口**：OAuth 2.0 令牌对 v1.1 `/1.1/media/upload.json` 一律返回 403。
> 授权 scope 需要包含 `media.write`，否则带图发布会被拒绝。

## 使用要点

1. **连接账号**：「账号」页 → X / Threads 走 OAuth 授权；Bluesky 填 handle + App Password；Mastodon 填实例地址 + 令牌。
2. **写作**：在分段卡片里写 → `Ctrl+Enter` 加段 → 粘贴/选择图片 → 右侧勾选目标账号 → 保存草稿 / 定时 / 立即发布。
3. **Threads 带图/授权**：Threads API 要求**回调和图片都是 HTTPS 公网地址**。本机直连只能发纯文字；授权与带图发布需先开隧道（如 `cloudflared tunnel --url http://127.0.0.1:8787`），把地址填到「设置 → Threads 图片公网地址」和 `.env` 的 `THREADS_REDIRECT_URI`，并在 Meta 后台登记 `https://<隧道域名>/auth/threads/callback`。详见指南 §2.4。
4. **定时可靠性**：调度器在 Echo 进程内运行——**关机/退出期间到期的贴文，会在下次启动时立即补发**（可能一次连发多条）。需要 7×24 常驻请部署到 NAS/服务器，见 [docs/MIGRATE_TO_NAS.md](docs/MIGRATE_TO_NAS.md)。
5. **图片不会被"刚传就删"**：清理只针对不被草稿/发布记录引用的图片，且受「新图保护期」（默认 24 小时）保护。把内容保存成草稿即可长期保留其图片。

## 目录结构

```
server/            后端（零依赖 Node）
  platforms/       平台适配器：x.js / threads.js / bluesky.js / mastodon.js
  auth.js          账号连接与令牌自动刷新
  publish.js       发布流水线（校验 → 传媒体 → 发布 → 落库）
  scheduler.js     定时调度与重试
  mediaCleanup.js  孤儿图片判定与清理（含新图保护期）
shared/            前后端共用：中英计数（chars.js）、分段解析（threadText.js）、发布前预检（preflight.js）
public/            前端 SPA（无构建，index.html + app.js + styles.css）
test/              170 个测试（node:test + mock HTTP，无需真实凭证）
docs/              架构、申请指南、部署与迁移
data/              运行时数据（账号令牌、草稿、队列、媒体；gitignore）
```

## 扩展新平台

1. 在 `server/platforms/` 新增适配器，实现 `base.js` 接口（限额、`connect`/OAuth、`publishPost`/`publishThread`）。
2. 在 `server/platforms.js` 注册一行。
3. 在 `docs/API_APPLY_GUIDE.md` 补申请流程。

前端平台页签、限额徽标、发布流水线、预检会自动识别新平台，无需改动。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 测试

```bash
npm test     # 170 passed
```

覆盖：中英计数与加权规则（X 加权 / Mastodon URL=23 / 字面计数）、分段解析、四个平台适配器（授权、媒体上传、reply 链、轮播、令牌刷新）、调度器（到期/退避/补投/清理钩子）、孤儿判定与保护期、REST API 与端到端发布（mock 平台服务）。**需要真实凭证的联调需自备凭证。**

## 安全提示

- `data/accounts.json` 保存平台访问令牌，勿同步到网盘或提交 git；`.env` 同理。
- OAuth state 一次性 5 分钟有效，PKCE S256。
- 服务默认监听所有网卡（方便局域网/隧道访问）；只在本机使用时可自行加防火墙规则。

## License

MIT
