# Echo 架构设计文档

> 仿 Typefully 的个人贴文发布平台。本地优先（local-first）、零 npm 依赖、平台适配器可扩展。

## 1. 目标与范围

### 1.1 本期实现（v1.0）

| 能力 | 说明 |
| --- | --- |
| 平台支持 | X (Twitter) + Threads，均支持 OAuth 2.0 登录认证，支持同一平台多账号 |
| 图片发布 | X 每条最多 4 张（≤5MB/张），Threads 每条最多 10 张（CAROUSEL），与 Typefully 对齐 |
| 字符统计 | 分别显示**中文字符数 / 英文及其他字符数**；X 加权字数（CJK×2、URL=23），Threads 原始 500 字 |
| 手动分段 | 插入 `---` 分隔线或工具栏按钮手动切分；分段预览、每段独立计数与配图 |
| 草稿箱 | 本地 JSON 持久化，支持增删改查、另存副本 |
| 定时发送 | 进程内调度器（默认 30s 轮询），支持立即发布、定时发布、失败重试 |
| 预览 | 模拟 X / Threads 的帖子样式预览 |

### 1.2 明确不在本期（对齐 Typefully 时的取舍）

| 能力 | 原因 | 后续 |
| --- | --- | --- |
| 数据洞察 / 分析看板 | X 洞察接口需付费层级；Threads 洞察接口能力有限 | 订阅付费 API 后作为只读模块扩展 |
| AI 写作助手 | 需 LLM 接入 | 走 planner/LLM 扩展点 |
| X Premium 长贴文（25k 字） | 需 note_tweet 媒体类型发布链路 | 见 §7 扩展说明 |
| 云端常驻 / 团队协作 | 个人本地工具 | 可用部署能力迁到服务器 |
| 微博 / 小红书 | 按 §3 的适配器规范预留 | 见 §7 |

## 2. 技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 22（`node:http`，**零第三方依赖**） | 个人工具无需构建链；避免依赖安装失败 |
| 存储 | JSON 文件（原子写入）+ 本地媒体文件，`data/` 目录 | 草稿/账号数据量小；无需数据库进程；搬迁 = 拷目录 |
| 前端 | 无构建静态 SPA（vanilla JS + hash 路由） | 双击即用；`public/` 直接静态服务 |
| 定时 | 进程内 setInterval 轮询 + 启动时补发错过的任务 | 简单可靠； scheduler 逻辑与平台解耦，可替换为系统 cron 触发 |
| 测试 | `node:test` 内置测试器 + 内存级 mock HTTP 服务 | 无依赖；可离线完整覆盖认证/发布链路 |

> 取舍说明：JSON 存储不提供并发写事务与全文检索，但对"单人、单浏览器、几十条草稿"的场景无实际影响；媒体文件走本地磁盘 + HTTP 路由服务（Threads 发布时通过公网 URL 传图片，见 §5.3）。

## 3. 平台适配器模式（可扩展性核心）

所有平台差异被收敛到 `server/platforms/` 下的适配器。新平台（微博/小红书）= 新增一个实现以下接口的文件 + 在 `server/platforms.js` 注册一行，**不需要改动调度、存储、HTTP API、前端**：

```js
// server/platforms/base.js
class PlatformAdapter {
  static id;                 // 'x' | 'threads' | 'weibo' | 'xiaohongshu'
  static name;               // 展示名
  static authDocPath;        // 申请指南文档锚点

  isConfigured();            // 环境变量凭证是否就绪
  limits();                  // { maxChars, weighted, maxImages, maxImageBytes, imageMimes, dailyPostCap }
  buildAuthorizeUrl(p);      // 授权 URL（PKCE/state 由 auth 层统一注入）
  exchangeCode(p);           // code → { profile, tokens }
  refreshToken(tokens);      // 刷新令牌
  resolveMediaUrl(localUrl);// 本地媒体 URL → 平台可用 URL（X 直传 / Threads 需公网 URL）
  uploadMedia(account, media);// 上传本地媒体 → 平台 media id 列表
  publishPost(account, msg);// 发单条（可带 mediaIds / replyToId）
  publishThread(account, segs);// 默认实现：顺序逐条发布（X 用 reply 链，Threads 顺序发布）
}
```

统一消息模型（前后端一致）：

```js
Post draft / 消息单元 = {
  platforms: ['x', 'threads'],        // 目标平台
  segments: [ { text: '...', media: ['<mediaId>', ...] }, ... ] // 手动分段
}
```

发布流水线（`server/publish.js`）只依赖适配器接口：

```
Post(队列记录) ──▶ 选账号 ──▶ 校验(平台限制) ──▶ 刷新令牌(如需要)
   ──▶ 上传媒体 ──▶ publishThread ──▶ 记录结果(链接/IDs) ──▶ 更新状态
```

## 4. 数据模型（`data/*.json`）

```
accounts.json  Account { id, platform, externalId, username, displayName,
                         tokens{ accessToken, refreshToken, expiresAt, scope },
                         createdAt, updatedAt, enabled }
drafts.json    Draft { id, title, platforms:[], segments:[{text, media:[]}],
                       createdAt, updatedAt }
posts.json     Post { id, draftId, platform, accountId, segments,
                      media:[{mediaId, mime, size}], scheduledAt,
                      status: pending|publishing|published|failed|canceled,
                      attempts, nextAttemptAt, result{ ids, urls, permalinks },
                      error, createdAt, updatedAt }
settings.json  { schedulerIntervalMs, defaultQueueTimes[], threadsImageBaseUrl, logRetention }
logs.json      Log { id, ts, level, scope, message, data }
```

**草稿与队列解耦**：定时发布时把草稿内容快照进 `Post`，之后编辑草稿不影响已排队内容（与 Typefully 行为一致）。

## 5. 关键流程

### 5.1 X 登录认证（OAuth 2.0 + PKCE）

```
前端 ──POST /api/auth/x/start──▶ 服务端生成 state + code_verifier(S256) ──▶ 返回授权 URL
用户浏览器跳转 twitter.com/i/oauth2/authorize（scope: tweet.read tweet.write users.read offline.access）
X ──302 /auth/x/callback?code&state──▶ 服务端校验 state ──▶ POST /2/oauth2/token 换取令牌
   ──▶ GET /2/users/me 拉取身份 ──▶ 写入 accounts.json ──▶ 302 回 SPA
```

- Access token 有效期约 2h；发布前 5 分钟自动用 refresh_token 续期。
- Callback URL 需在 X App 设置中登记：`http://localhost:8787/auth/x/callback`（本地开发可用）。

### 5.2 Threads 登录认证（OAuth 2.0）

```
scope: threads_basic,threads_content_publish
threads.net/oauth/authorize ──▶ /auth/threads/callback ──▶ graph.threads.net/oauth/access_token（短期 token，1h）
   ──▶ th_exchange_token 换取 60 天长 token ──▶ tokens 剩余 <7 天时自动 th_refresh_token 续期
```

- 开发模式下 `threads_content_publish` 对 App 管理员（= 本人）可用，无需 App Review；给其他用户发帖才需要审核。

### 5.3 图片链路（两平台差异点）

```
上传: 前端 base64 ──▶ POST /api/media ──▶ data/media/<id> + mime 记录
X:    直传二进制 ──▶ upload.twitter.com/1.1/media/upload.json（失败回退 v2 initialize/append/finalize）
      ──▶ tweet 上挂 media_ids（最多 4 个）
Threads: 需公网 URL ──▶ 容器 image_url = <threadsImageBaseUrl>/media/<id>
      ──▶ 多图 = 建多个 IMAGE 容器 + CAROUSEL 父容器（children 上限 10）
```

Threads 的 `threadsImageBaseUrl` 默认取 `APP_BASE_URL`（本地即 `http://localhost:8787`）。**localhost 对 Threads 服务器不可达**，本机发图需配置隧道（如 cloudflared/ngrok）得到的公网地址，纯文字发帖不受影响。设置页可改。

### 5.4 定时调度

```
scheduler.start() → 每 schedulerIntervalMs(默认 30s):
  捞出 status=pending && scheduledAt<=now 的 Post
    → executor(post)：校验 → 认证 → 上传 → 发布 → 落库
    → 成功: published（记录 permalink）
    → 失败: attempts+1，attempts<3 则回到 pending 并设 nextAttemptAt(+5/15/60 分钟)
          否则 failed（保留可手动重试）
进程重启时立即补投启动窗口内已到期的任务（补发 grace 内不重复发送）
```

## 6. HTTP API（摘要）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/config` | 平台清单、限额、凭证是否就绪 |
| POST | `/api/auth/:platform/start` | 生成授权 URL |
| GET | `/auth/:platform/callback` | OAuth 回调（浏览器导航） |
| GET/DELETE | `/api/accounts[/:id]` | 账号列表 / 解绑 |
| GET/POST | `/api/drafts`、PUT/DELETE `/api/drafts/:id` | 草稿 CRUD |
| POST | `/api/drafts/:id/schedule` `{scheduledAt}` | 入队（按所选平台账号各生成一条 Post） |
| GET | `/api/posts?status=` | 队列 / 历史 |
| POST | `/api/posts/:id/publish-now` `/retry`、DELETE `/api/posts/:id` | 立即发/重试/取消 |
| POST | `/api/me`dia | base64 上传 |
| GET/PUT | `/api/settings`、GET `/api/logs` | 设置 / 日志 |

## 7. 扩展新平台（微博 / 小红书）落地清单

1. `server/platforms/weibo.js`（或 xiaohongshu.js）实现 §3 接口：
   - `limits()`：字数/图片数/图片大小；微博 140~2000 字（会员）、图片上限按微博开放平台文档填写
   - 认证：走各平台 OAuth2（小红书为 OAuth2 + 可能需企业资质；微博为 OAuth2）
   - 发布：上传媒体 → 发帖；长文适配各自格式
2. `server/platforms.js` 注册一行。
3. `docs/API_APPLY_GUIDE.md` 补一节申请流程。
4. 前端：`index.html` 平台页签自动从 `/api/config` 渲染，**无需改前端代码**（平台卡片、限额、预览样式在 `PLATFORM_VIEWS` 中按需补一段视图定义）。

## 8. 安全与运维

- 令牌写入 `data/accounts.json`（本地单用户工具；建议 `data/` 不要同步到网盘，详见 README 加固建议）。
- OAuth `state` 一次性有效（5 分钟）；PKCE verifier 仅存内存。
- 所有外部请求带超时（默认 20s）；发布失败指数退避重试。
- 日志按 `logRetention` 滚动裁剪。

## 9. 目录结构

```
Echo/
├── docs/
│   ├── ARCHITECTURE.md         # 本文
│   └── API_APPLY_GUIDE.md      # X/Threads 开发者账号申请指南
├── server/
│   ├── index.js                # 入口: HTTP 服务 + 调度器
│   ├── config.js               # 环境变量/默认配置
│   ├── store.js                # JSON 原子存储
│   ├── http.js                 # 路由/静态/JSON 帮助函数
│   ├── routes.js               # REST API
│   ├── media.js                # 本地媒体存储
│   ├── oauth.js                # PKCE/state/HTTP 工具
│   ├── auth.js                 # 账号连接与令牌刷新服务
│   ├── publish.js              # 发布执行器（平台无关）
│   ├── scheduler.js            # 定时调度
│   └── platforms/
│       ├── base.js             # 适配器基类 + 注册表
│       ├── x.js                # X API v2
│       └── threads.js          # Threads API
├── shared/
│   ├── chars.js                # 中英计数 + X 加权（前后端共用）
│   └── threadText.js           # 手动分段解析（前后端共用）
├── public/
│   ├── index.html              # SPA 外壳
│   ├── styles.css
│   └── app.js
├── test/
│   ├── chars.test.js
│   ├── threadText.test.js
│   ├── store.test.js
│   ├── x.test.js               # X 适配器（mock HTTP）
│   ├── threads.test.js         # Threads 适配器（mock HTTP）
│   ├── scheduler.test.js
│   └── api.test.js             # REST 集成测试
├── data/                       # 运行时生成（gitignore）
├── package.json                # scripts: start / test
└── .env.example
```
