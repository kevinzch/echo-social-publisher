# X / Threads 开发者账号与 API 申请指南

> Echo 是本地个人工具：两个平台都走 OAuth 2.0 用户授权，**只需要你自己以应用所有者身份登录授权一次**，不涉及其他用户，因此两边的免费/开发模式都够用。
> 全程免费，预计 20–40 分钟。

---

## 一、X (Twitter) API

### 1.1 申请开发者账号与创建应用

1. 打开 <https://developer.x.com>，用你要发帖的 X 账号登录，点 **Sign up for Free Account**（免费账户即可）。
2. 如实填写用途描述（个人/爱好者用途选 "Hobbyist" 或 "Exploring the API"，说明 "personal single-user posting tool" 即可，一般秒过）。
3. 进入 <https://console.x.com> → **Projects & Apps** → **Create App**：
   - 名称随意（如 `echo-personal`）。
   - 记下 **API Key / Client ID** 和 **API Key Secret / Client Secret**（Client ID/Secret 就是 Echo 需要的 `X_CLIENT_ID` / `X_CLIENT_SECRET`）。
4. 进入 App 的 **Settings** → **User authentication settings** → **Set up**：
   - **App permissions**：选 **Read and write**（只读无法发帖）。
   - **Type of App**：Native App（客户端工具）或 Web App 均可。
   - **Callback URI**：`http://127.0.0.1:8787/auth/x/callback`（⚠️ 必须用 `127.0.0.1`，**不能用 `localhost`**，否则保存时报 "Not a valid URL format"）
   - **Website URL**：`http://127.0.0.1:8787`（同样不要用 localhost）
5. 保存。

### 1.2 免费层限制（够不够用？）

- 官方文档（<https://docs.x.com/x-api/fundamentals/rate-limits>）中发帖端点 `POST /2/tweets` 的限额是 **每用户 100 次 / 15 分钟**、每应用 10,000 次 / 24 小时；具体到账层级（Free / Basic / Pro）还可能受月度发帖量约束——个人日常发帖（每天几条到几十条）用**免费层完全够**。
- 2026 年起 X 推出按量付费（Pay-Per-Use）模式，高频使用可在 console 中开通。
- **字符规则**：280 加权字数（中日韩字符、URL=23、多数 emoji=2）——Echo 已内置同样的计数规则。
- **图片规则**：每条最多 4 张，单张 ≤5MB，支持 JPEG/PNG/WebP/GIF。

### 1.3 把凭证填进 Echo

复制 `.env.example` 为 `.env`，填：

```bash
X_CLIENT_ID=你的ClientID
X_CLIENT_SECRET=你的ClientSecret
```

保存后重启 `npm start`，在 Echo「账号」页点击 **连接 X 账号**，浏览器跳转 X 授权页，点 **Authorize app** 即完成绑定。

---

## 二、Threads API

### 2.1 创建 Meta 应用

1. 打开 <https://developers.facebook.com>，用**已绑定 Instagram 的账号**登录（Threads 账号即 Instagram 账号）。
2. 右上 **我的应用 → 创建应用**：类型选 **其他 → 消费者（Consumer）**（或"无"）。
3. 应用创建后，在左侧 **添加用例 / Add use case** 中找到 **Threads**，选择 **Threads API**，点添加。
4. 在 **应用 → 设置 → 基本** 里记下 **应用编号（App ID）** 和 **应用密钥（App Secret）**：
   - `THREADS_CLIENT_ID` = App ID
   - `THREADS_CLIENT_SECRET` = App Secret
5. **产品 → Threads API → 设置**：
   - **OAuth 重定向 URI**：填 `http://127.0.0.1:8787/auth/threads/callback` 并保存。
   - 取消勾选 "Require HTTPS"（如果该选项存在）。
6. **应用 → 应用权限（App Review）**：确认需要的权限 `threads_basic`（读身份）与 `threads_content_publish`（发帖）。
   - 这两个权限在**开发模式（Development Mode）**下对**应用管理员本人**即可用——正是 Echo 这种单人工具的场景，**无需提交审核**。
   - 只有当你未来想让其他 Threads 用户也通过 Echo 发帖时，才需要提交 App Review（Advanced Access）。

### 2.2 免费层限制（够不够用？）

- **每账号每 24 小时最多通过 API 发 250 条**（Meta 官方限制），个人使用远够。
- **单条 500 字**（不做加权，中英文都按 1 字计）。
- **图片**：每条最多 10 张（轮播 CAROUSEL），单张 ≤8MB；API 只接受**公网可访问的 `image_url`**（详见 2.4）。
- 授权后 Echo 会把短期 token 自动换成 **60 天长期 token**，并在到期前自动续期，基本无感。

### 2.3 把凭证填进 Echo

```bash
THREADS_CLIENT_ID=你的AppID
THREADS_CLIENT_SECRET=你的AppSecret
```

重启后在「账号」页点 **连接 Threads 账号**，授权页点允许即可。

### 2.4 发图片的关键限制：图片必须公网可达

Threads 的 API 与 X 不同：它不接收上传的二进制文件，而是去**抓取你给的图片 URL**。Echo 本地启动时图片地址是 `http://127.0.0.1:8787/...`，Meta 的服务器访问不到，所以：

- **纯文字帖**：不受影响，直接可发。
- **带图帖**：需要一个公网地址。最省事的做法是用临时隧道把本地服务暴露出去，例如：

```bash
# 任选其一，运行后会得到类似 https://random-name.trycloudflare.com 的地址
cloudflared tunnel --url http://127.0.0.1:8787
npx localtunnel --port 8787
ngrok http 8787
```

然后把隧道地址填到 Echo「设置 → Threads 图片公网地址」（或写入 `.env` 的 `THREADS_IMAGE_BASE_URL`），再发布带图贴文。

---

## 三、常见问题

**Q：授权后提示"令牌已过期 / 401"？**
A：在「账号」页解绑后重新连接一次即可。Echo 会在发布前自动刷新 X/Threads 令牌，长期不启动服务（Threads >60 天）才需要重新授权。

**Q：免费层够吗？**
A：个人使用（每天几条贴文）完全够。X 免费层若遇到月度发帖硬上限，可在 console.x.com 升级 Basic 或开通按量付费；Threads 250 条/天对个人不可能用完。

**Q：可以给别人用吗？**
A：Threads 需要 App Review 才能给非管理员账号发帖；X 只要你的应用本身允许。Echo 定位为**单人本地工具**，`data/` 目录里有你的令牌，请勿随意分享。

**Q：回调地址必须用 8787 端口吗？**
A：可以用其他端口，但三处要一致：`PORT`、`APP_BASE_URL`、平台后台登记的回调 URL。**一律使用 `127.0.0.1` 而非 `localhost`**（X 控制台会拒绝 localhost，见下条）。

**Q：X 后台保存时报 "Not a valid URL format" / 授权时提示 "Something went wrong"？**
A：X 的开发者控制台**拒绝 `localhost` 形式**的回调/网站 URL（错误提示很含糊，这是已知行为）。改用 `127.0.0.1`：

- Callback URI：`http://127.0.0.1:8787/auth/x/callback`
- Website URL：`http://127.0.0.1:8787`

同时 Echo 的 `APP_BASE_URL` 默认已是 `http://127.0.0.1:8787`，无需改动。若个别情况下 X 连 `127.0.0.1` 也拒绝，可用自定义本地域名兜底：在 `C:\Windows\System32\drivers\etc\hosts`（管理员权限）加一行 `127.0.0.1 echo.local`，然后把三处地址都换成 `http://echo.local:8787`（Echo 侧设 `APP_BASE_URL=http://echo.local:8787`）。

**Q：.env 会被提交到 git 吗？**
A：不会，`.gitignore` 已排除 `.env` 和 `data/`。
