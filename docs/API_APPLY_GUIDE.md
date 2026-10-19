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

### 1.2 价格与限额（2026-10 核实：已无免费层，按量付费）

**X API 自 2026 年 2 月起取消了面向新开发者的免费层**，现在是唯一的自助模式是 **按量付费（Pay-Per-Use）**：预先购买积分，按调用扣费，无订阅、无月费门槛（<https://docs.x.com/x-api/getting-started/pricing>）。旧的 Free / Basic / Pro 订阅层均已停止新注册并陆续迁移完毕（仅“Public Utility Apps”等特批应用保留免费额度）。

**发帖成本（官方定价，写操作按请求计费）**：

| 操作 | 价格 | 对 Echo 的含义 |
| --- | --- | --- |
| 发布普通贴文 | **$0.015 / 条** | 分段的每一段都算一条 |
| 发布含 URL 的贴文 | **$0.200 / 条**（13 倍） | 带链接的贴文成本陡增，注意 |
| 被召唤的回复（bot 被 @） | $0.010 / 条 | 不适用 |
| 读取自己的数据（Owned Reads） | $0.001 / 资源 | 授权时拉一次身份 ≈ $0.001 |
| 媒体元数据 | $0.005 / 请求 | 图片上传/处理相关 |

**个人使用成本估算**：每天 10 条（纯文字）≈ **$4.5/月**；每天 1–3 条 ≈ **$0.5–1.5/月**。每月读取上限 300 万条（个人永远够不到）。

**新账号福利**（console.x.com）：绑定第一张支付卡得 **$20** 免费积分，首次自动充值再匹配最高 **$50**（合计最多 $70）。建议顺手**设置月度消费上限**（如 $5），防止意外超支。

**速率限制**（与计费并存，官方 rate-limits 页）：`POST /2/tweets` 每用户 100 次/15 分钟、每应用 10,000 次/24 小时；媒体上传每用户 500 次/15 分钟。个人使用不可能触及。

> Echo 代码无需任何改动——API 端点和 OAuth 流程都没变，只是计费模型变了。你的开发者账号若在 2026-02 之前创建且曾是 Free 层，官方已自动迁移并赠送 $10 代金券；新账号则按上述按量付费执行。

**平台规则（不变）**：280 加权字数（中日韩字符×2、URL=23、多数 emoji×2）——Echo 已内置同样的计数规则；每条最多 4 张图片、单张 ≤5MB，支持 JPEG/PNG/WebP/GIF。

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
   - **跳转回调网址（Redirect URI）**：填 **HTTPS** 地址并保存。
     - ⚠️ **Meta 强制要求回调必须使用 HTTPS**：填 `http://127.0.0.1:8787/auth/threads/callback` 会被拒绝并提示「表单无法保存：所有跳转网址都必须使用 HTTPS」（与 X 相反，X 接受 `http://127.0.0.1`）。
     - 本机方案：用隧道拿到 HTTPS 地址（见 2.4），回调填 `https://<隧道域名>/auth/threads/callback`，同时在 Echo `.env` 设置 `THREADS_REDIRECT_URI=https://<隧道域名>/auth/threads/callback`。
   - 如果有 "Require HTTPS" 之类的开关，保持开启。
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

> 「账号」页每个平台卡片会显示当前生效的回调地址（带复制按钮），把它原样填进平台后台即可——**两处必须逐字符一致**，否则授权会报 redirect_uri 不匹配。

### 2.4 关键限制：回调与图片都要求 HTTPS 公网地址

Threads 与 X 有两点根本差异，都需要一个**公网 HTTPS 地址**：

1. **授权回调必须 HTTPS**（Meta 强制；`http://127.0.0.1` 会被控制台拒绝）。
2. **发布图片必须公网可达**：Threads API 不接收上传的二进制文件，而是去抓取你给的 `image_url`；`http://127.0.0.1` 对 Meta 服务器不可达（纯文字帖不受影响）。

**一次性解决：给本地服务开一条 HTTPS 隧道**

```bash
# 任选其一（任一条都会打印 https://xxx.trycloudflare.com / https://xxx.ngrok-free.app 之类的地址）
cloudflared tunnel --url http://127.0.0.1:8787
npx localtunnel --port 8787
ngrok http 8787
```

拿到隧道地址（记为 `<TUNNEL>`）后配置三处：

| 位置 | 填什么 |
| --- | --- |
| Meta 应用设置 → 跳转回调网址 | `https://<TUNNEL>/auth/threads/callback` |
| Echo `.env` → `THREADS_REDIRECT_URI` | `https://<TUNNEL>/auth/threads/callback` |
| Echo `.env` → `THREADS_IMAGE_BASE_URL`（或设置页） | `https://<TUNNEL>` |

X 不受影响，继续用 `http://127.0.0.1:8787/auth/x/callback`（X 接受 HTTP + 127.0.0.1）。

⚠️ cloudflared 快速隧道的域名每次重启都会变——**换域名后要同步更新 Meta 后台和 `.env` 两处**；ngrok 免费版的域名同样会变，需要固定域名可升级或改用自托管方案。隧道只在需要连接/发图时开着即可，日常纯文字 X 发帖不需要。

### 2.5 备用通道：手动令牌连接（绕开回调配置）

如果 Meta 后台的「跳转回调网址」反复无法保存，或你不想折腾隧道，可以用 Meta 自带的**用户口令生成器**直接拿长期令牌：

1. Meta 应用后台 → **Threads API → 设置** → 找到**用户口令生成器**（截图底部那个区域）。
2. 为你的**公开** Threads 账户生成长期访问口令（约 60 天有效），复制。
3. Echo「账号」页 → Threads 卡片底部 → 粘贴到「令牌连接」输入框 → 点**令牌连接**。
   - Echo 会先调用 Threads 接口验证令牌，通过后直接保存账号。
4. 到期前 Echo 会自动用 `th_refresh_token` 续期；若解绑/失效，重新生成再粘贴即可。

**这条路径的效果**：
- ✅ Threads **纯文字帖**完全可用，且不需要隧道、不需要配回调地址
- ⚠️ **带图帖**仍需要隧道（Threads API 抓取图片 URL 需公网可达），即 `THREADS_IMAGE_BASE_URL` 仍要配
- ⚠️ 若生成的令牌权限不含 `threads_content_publish`，发帖会报权限错误——那就仍需回到 OAuth 授权流程（先排查 2.4 的回调配置）

---

## 三、常见问题

**Q：授权后提示"令牌已过期 / 401"？**
A：在「账号」页解绑后重新连接一次即可。Echo 会在发布前自动刷新 X/Threads 令牌，长期不启动服务（Threads >60 天）才需要重新授权。

**Q：免费层够吗？还要花钱吗？**
A：X 已于 2026 年 2 月取消面向新开发者的免费层，现在自助模式只有**按量付费**：发一条普通贴文 $0.015、含 URL 的 $0.200（分段每段各计一条）。个人每天几条 ≈ $1–5/月；新账号绑卡有最多 $70 免费积分可先抵用。Threads 仍完全免费（250 条/天）。

**Q：可以给别人用吗？**
A：Threads 需要 App Review 才能给非管理员账号发帖；X 只要你的应用本身允许。Echo 定位为**单人本地工具**，`data/` 目录里有你的令牌，请勿随意分享。

**Q：回调地址必须用 8787 端口吗？**
A：可以用其他端口，但要保证「Echo 侧地址」与「平台后台登记的回调」逐字符一致：`PORT`、`APP_BASE_URL`（或各平台的 `X_REDIRECT_URI` / `THREADS_REDIRECT_URI` 覆盖值）。注意两平台规则不同：**X 用 `http://127.0.0.1`（拒绝 localhost），Threads 必须 HTTPS**。

**Q：Threads 后台保存时报「表单无法保存：所有跳转网址都必须使用 HTTPS」？**
A：Meta 强制 Threads 的回调必须是 HTTPS，不接受 `http://127.0.0.1`（这与 X 相反）。解决：开一条 HTTPS 隧道（cloudflared/ngrok，见 2.4），把 `https://<隧道域名>/auth/threads/callback` 填入 Meta 后台，同时在 Echo `.env` 设置 `THREADS_REDIRECT_URI` 为同一地址。

**Q：授权时跳转到 error.json，报「The user has not accepted the invite to test the app」（error_code 1349245）？**
A：这是 **Meta 应用角色问题**，与 Echo 无关。开发模式（未发布）的 App 只允许**有已接受角色**的账号授权。按以下顺序排查：

1. **确认两个账号是否同一个**：
   - A = 创建 Meta 应用的 Facebook 账号（developers.facebook.com 右上角头像看到的）
   - B = 你的 Threads 账号所绑定的 Facebook/Instagram 账号
   - **A 和 B 必须是同一个**，否则授权必然报此错。
2. **如果是同一个账号**：进「应用角色（App Roles）→ 角色（Roles）」看有没有**待接受的邀请**——用该 Facebook 账号登录后接受（通知中心或邮件里的邀请链接）；确认角色是「管理员」。
3. **如果不是同一个账号**：用账号 A 进「应用角色 → 角色 → 添加测试者」，把账号 B 加为测试者；然后**用账号 B 登录 Facebook 接受邀请**（这一步骤常被遗漏——不加不接受就没权限）。
4. 另外确保该 Facebook 账号已完成手机/邮箱验证（未验证账号无法持有角色）。

角色搞定后重试「连接 Threads 账号」即可。开发模式下这一条是唯一必经之路（不存在"跳过角色直接授权"的选项）。

**Q：X 后台保存时报 "Not a valid URL format" / 授权时提示 "Something went wrong"？**
A：X 的开发者控制台**拒绝 `localhost` 形式**的回调/网站 URL（错误提示很含糊，这是已知行为）。改用 `127.0.0.1`：

- Callback URI：`http://127.0.0.1:8787/auth/x/callback`
- Website URL：`http://127.0.0.1:8787`

同时 Echo 的 `APP_BASE_URL` 默认已是 `http://127.0.0.1:8787`，无需改动。若个别情况下 X 连 `127.0.0.1` 也拒绝，可用自定义本地域名兜底：在 `C:\Windows\System32\drivers\etc\hosts`（管理员权限）加一行 `127.0.0.1 echo.local`，然后把三处地址都换成 `http://echo.local:8787`（Echo 侧设 `APP_BASE_URL=http://echo.local:8787`）。

**Q：.env 会被提交到 git 吗？**
A：不会，`.gitignore` 已排除 `.env` 和 `data/`。
