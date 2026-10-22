> Echo 是本地单人工具，**只需要你自己的账号授权一次**，不涉及第三方用户，因此各平台的开发模式/免费额度都够用。

## 0. 先看这张表：哪个平台要折腾

| 平台 | 需要开发者账号吗 | 大概耗时 | 难点 |
| --- | --- | --- | --- |
| **Bluesky** | ❌ 不需要 | 2 分钟 | 用 App Password，不是主密码 |
| **Mastodon** | ❌ 不需要 | 3 分钟 | 在自己实例里建应用拿令牌 |
| **X (Twitter)** | ✅ 需要 | 15–20 分钟 | 控制台拒绝 `localhost`；图片要 `media.write` |
| **Threads** | ✅ 需要（Meta 应用） | 20–30 分钟 | 回调必须 HTTPS；图片要公网可达 |

建议顺序：**先连 Bluesky / Mastodon**（几乎零门槛），跑通后再折腾 X 和 Threads。

---

## 一、Bluesky（最快）

1. 打开 <https://bsky.app> 登录 → **Settings（设置）** → **Privacy and security** → **App Passwords**。
2. 点 **Add App Password**，名字随便填（如 `echo`），生成后复制那串 `xxxx-xxxx-xxxx-xxxx`。
   - ⚠️ 这是**应用专用密码**，不是你登录 bsky.app 的密码；主密码填进去会报认证失败。
3. Echo「账号」页 → Bluesky 卡片 → 填 **handle**（如 `yourname.bsky.social`）+ **App Password** → 点连接。

**限制**：300 字（按字面计，链接也算实际长度）；每条最多 4 张图、单张 ≤1MB。
**撤销**：随时在 App Passwords 页面删除该密码，Echo 里的账号随即失效。

---

## 二、Mastodon

1. 在**你自己的实例**（如 mastodon.social）登录 → **首选项（Preferences）** → **开发（Development）** → **新建应用（New application）**。
2. 应用名称填 `Echo`，重定向 URI 留空即可；**权限**勾选：
   - `write:statuses`（发帖）
   - `write:media`（传图）
   - `read`（读自己的身份，可选但建议勾）
3. 保存后，在应用详情页复制 **你的访问令牌（Your access token）**。
4. Echo「账号」页 → Mastodon 卡片 → 填 **实例地址**（如 `https://mastodon.social`）+ **访问令牌** → 点连接。

**限制**：500 字（**链接按 23 字符计**，与 X 一致）；每条最多 4 张图、单张 ≤16MB。
**令牌**：默认不过期；如需撤销，回到该应用的详情页删除。

---

## 三、X (Twitter) API

### 3.1 申请开发者账号与创建应用

1. 打开 <https://developer.x.com>，用你要发帖的 X 账号登录，点 **Sign up for Free Account**（免费账户即可）。
2. 如实填写用途描述（个人/爱好者用途选 "Hobbyist" 或 "Exploring the API"，说明 "personal single-user posting tool" 即可，一般秒过）。
3. 进入 <https://console.x.com> → **Projects & Apps** → **Create App**：
   - 名称随意（如 `echo-personal`）。
   - 记下 **API Key / Client ID** 和 **API Key Secret / Client Secret**（就是 Echo 需要的 `X_CLIENT_ID` / `X_CLIENT_SECRET`）。
4. 进入 App 的 **Settings** → **User authentication settings** → **Set up**：
   - **App permissions**：选 **Read and write**（只读无法发帖）。
   - **Type of App**：Native App（客户端工具）或 Web App 均可。
   - **Callback URI**：`http://127.0.0.1:8787/auth/x/callback`（⚠️ 必须用 `127.0.0.1`，**不能用 `localhost`**，否则保存时报 "Not a valid URL format"）
   - **Website URL**：`http://127.0.0.1:8787`（同样不要用 localhost）
5. 保存。

### 3.2 授权范围（scope）：带图必须含 `media.write`

Echo 申请的 scope 是：

```
tweet.read  tweet.write  users.read  media.write  offline.access
```

| scope | 作用 | 缺了会怎样 |
| --- | --- | --- |
| `tweet.write` | 发帖 | 发帖 403 |
| `media.write` | **上传图片** | **带图发布 403**（纯文字不受影响） |
| `offline.access` | 拿 refresh token | 2 小时后失效，需频繁重连 |

> 如果账号页的 X 卡片上出现 **「缺图片权限」** 标记，说明当前令牌是旧版授权（不含 `media.write`）。
> **解决**：解绑 X → 重新点「连接 X」走一次授权（新授权会带上该权限）。旧令牌不会自动升级。

### 3.3 价格与限额（2026-10 核实：已无免费层，按量付费）

**X API 自 2026 年 2 月起取消了面向新开发者的免费层**，自助模式只有 **按量付费（Pay-Per-Use）**：预购积分、按调用扣费，无订阅、无月费门槛（<https://docs.x.com/x-api/getting-started/pricing>）。旧的 Free / Basic / Pro 订阅层已停止新注册。

**发帖成本（官方定价，写操作按请求计费）**：

| 操作 | 价格 | 对 Echo 的含义 |
| --- | --- | --- |
| 发布普通贴文 | **$0.015 / 条** | 分段的每一段都算一条 |
| 发布含 URL 的贴文 | **$0.200 / 条**（13 倍） | 带链接成本陡增 |
| 媒体上传（v2 `/2/media/upload`） | **$0.010 / 次** | 每张图一次 |
| 读取自己的数据 | $0.001 / 资源 | 授权时拉一次身份 ≈ $0.001 |

**个人成本估算**：每天 10 条纯文字 ≈ **$4.5/月**；每天 1–3 条 ≈ **$0.5–1.5/月**。

**新账号福利**（console.x.com）：绑定第一张支付卡得 **$20** 免费积分，首次自动充值再匹配最高 **$50**（合计最多 $70）。建议顺手**设置月度消费上限**（如 $5）。

**平台规则**：280 加权字数（CJK×2、URL=23、多数 emoji×2）——Echo 已内置同样规则；每条最多 4 张图、单张 ≤5MB，支持 JPEG/PNG/WebP/GIF。

### 3.4 把凭证填进 Echo

```bash
X_CLIENT_ID=你的ClientID
X_CLIENT_SECRET=你的ClientSecret
```

重启 `npm start`，在「账号」页点 **连接 X 账号**，浏览器跳转授权页，点 **Authorize app** 完成绑定。

---

## 四、Threads API

### 4.1 创建 Meta 应用

1. 打开 <https://developers.facebook.com>，用**已绑定 Instagram 的账号**登录（Threads 账号即 Instagram 账号）。
2. 右上 **我的应用 → 创建应用**：类型选 **其他 → 消费者（Consumer）**（或"无"）。
3. 应用创建后，左侧 **添加用例 / Add use case** → 找到 **Threads** → 选择 **Threads API** 添加。
4. **应用 → 设置 → 基本** 里记下 **应用编号（App ID）** 和 **应用密钥（App Secret）**：
   - `THREADS_CLIENT_ID` = App ID
   - `THREADS_CLIENT_SECRET` = App Secret
5. **产品 → Threads API → 设置**：
   - **跳转回调网址**：必须 **HTTPS**（`http://127.0.0.1` 会被拒绝，提示「所有跳转网址都必须使用 HTTPS」）。
   - 本机方案：用隧道拿 HTTPS 地址（见 4.4），回调填 `https://<隧道域名>/auth/threads/callback`，同时在 `.env` 设 `THREADS_REDIRECT_URI` 为同一地址。
6. **应用 → 应用权限**：确认 `threads_basic`（读身份）与 `threads_content_publish`（发帖）。
   - 这两个权限在**开发模式**下对**应用管理员本人**即可用——正是 Echo 的场景，**无需 App Review**。

### 4.2 免费层限制

- 每账号每 24 小时最多 **250 条**，个人远够。
- 单条 **500 字**（不加权，中英文都按 1 字计）。
- 图片每条最多 10 张（轮播），单张 ≤8MB；API 只接受**公网可访问的 `image_url`**（见 4.4）。
- 授权后 Echo 会把短期 token 换成 **60 天长期 token**，到期前自动续期。

### 4.3 把凭证填进 Echo

```bash
THREADS_CLIENT_ID=你的AppID
THREADS_CLIENT_SECRET=你的AppSecret
```

重启后在「账号」页点 **连接 Threads 账号**。

> 「账号」页每个平台卡片会显示当前生效的回调地址（带复制按钮），原样填进平台后台即可——**两处必须逐字符一致**。

### 4.4 关键限制：回调与图片都要求 HTTPS 公网地址

Threads 与 X 有两点根本差异，都需要**公网 HTTPS 地址**：

1. **授权回调必须 HTTPS**（Meta 强制）。
2. **发布图片必须公网可达**：Threads 不接收二进制上传，而是去抓 `image_url`；`http://127.0.0.1` 对 Meta 不可达（纯文字不受影响）。

**一次性解决：给本地服务开一条 HTTPS 隧道**

```bash
cloudflared tunnel --url http://127.0.0.1:8787
# 或 npx localtunnel --port 8787 / ngrok http 8787
```

拿到隧道地址（记为 `<TUNNEL>`）后配置三处：

| 位置 | 填什么 |
| --- | --- |
| Meta 应用设置 → 跳转回调网址 | `https://<TUNNEL>/auth/threads/callback` |
| Echo `.env` → `THREADS_REDIRECT_URI` | 同上 |
| Echo `.env` 或设置页 → `THREADS_IMAGE_BASE_URL` | `https://<TUNNEL>` |

⚠️ 快速隧道域名每次重启都会变——**换域名后要同步更新 Meta 后台和 `.env` 两处**。日常纯文字发 X 不需要隧道。

### 4.5 备用通道：手动令牌连接

如果 Meta 后台的回调反复保存不了，可以用**用户口令生成器**：

1. Meta 应用后台 → **Threads API → 设置** → **用户口令生成器**。
2. 为你的**公开** Threads 账号生成长期访问口令（约 60 天），复制。
3. Echo「账号」页 → Threads 卡片底部 → 粘贴 → 点 **令牌连接**。

效果：✅ 纯文字完全可用，不需要隧道/回调；⚠️ **带图仍需要隧道**；⚠️ 若令牌不含 `threads_content_publish`，发帖会报权限错误。

---

## 五、常见问题

**Q：授权后提示"令牌已过期 / 401"？**
A：在「账号」页解绑后重新连接。Echo 会在发布前自动刷新 X/Threads 令牌；长期不启动（Threads >60 天）才需要重新授权。

**Q：X 带图发布报 403 Forbidden？**
A：两种情况，Echo 都已处理并会给出提示：
1. **授权缺 `media.write`** → 账号页会显示「缺图片权限」，解绑后重新授权。
2. **调用了 v1.1 媒体接口** → OAuth 2.0 令牌对 `/1.1/media/upload.json` 一律 403，Echo 已改用 v2 `POST /2/media/upload`。
若仍失败，错误信息里会带上 X 返回的 `detail`，可据此排查。

**Q：X 发帖报 402 credits depleted？**
A：API 积分用完了。去 console.x.com 充值或等免费积分到账。

**Q：Threads 报「无效的链接附件」（subcode 4279047）？**
A：Threads 无法为这条链接生成预览（目标站点拦截了 Meta 抓取，Reddit 等站点常见）。换短链，或把链接放进正文而不是单独一段。

**Q：Threads 报「Media not found / 资源不存在」（code 24）？**
A：容器还没处理完就发布了。Echo 现在会等容器 `FINISHED` 再发，并在失败时重建容器重试一次；若仍出现，重试发布即可。

**Q：Bluesky 登录失败？**
A：`password` 要填 **App Password**（形如 `xxxx-xxxx-xxxx-xxxx`），不是主密码。App Password 可在 bsky.app → Settings → App Passwords 生成。

**Q：Mastodon 令牌验证失败（401）？**
A：令牌权限不足。新建应用时至少要勾 `write:statuses` 和 `write:media`；只勾 `read` 无法发帖。

**Q：Threads 后台保存时报「所有跳转网址都必须使用 HTTPS」？**
A：Meta 强制 HTTPS（与 X 相反）。开一条隧道（见 4.4），把 `https://<隧道域名>/auth/threads/callback` 填进 Meta 后台，并在 `.env` 设置同一地址。

**Q：授权跳转报「The user has not accepted the invite to test the app」（error_code 1349245）？**
A：**Meta 应用角色问题**，与 Echo 无关。开发模式的 App 只允许**有已接受角色**的账号授权：

1. **确认是同一个账号**：A = 创建 Meta 应用的 Facebook 账号；B = Threads 所绑定的账号。**A 和 B 必须相同**。
2. 同一个账号：进「应用角色 → 角色」看有无**待接受邀请**，用该账号登录接受，确认角色是「管理员」。
3. 不同账号：用账号 A 在「应用角色 → 角色 → 添加测试者」把 B 加进去，再用 **B 登录接受邀请**（这一步常被遗漏）。
4. 确保该 Facebook 账号已完成手机/邮箱验证。

**Q：X 后台保存时报 "Not a valid URL format"？**
A：X 控制台**拒绝 `localhost`**。改用 `127.0.0.1`：
- Callback：`http://127.0.0.1:8787/auth/x/callback`
- Website：`http://127.0.0.1:8787`

若 X 连 `127.0.0.1` 也拒绝，可在 hosts 里加 `127.0.0.1 echo.local`，三处地址统一换成 `http://echo.local:8787`（Echo 侧设 `APP_BASE_URL`）。

**Q：可以给别人用吗？**
A：Threads 需要 App Review 才能给非管理员发帖；X 取决于你的应用设置。Echo 定位**单人本地工具**，`data/` 里有你的令牌，请勿随意分享。

**Q：回调必须用 8787 端口吗？**
A：可以换，但要保证「Echo 侧地址」与「平台后台登记的回调」逐字符一致：`PORT`、`APP_BASE_URL`（或 `X_REDIRECT_URI` / `THREADS_REDIRECT_URI`）。注意两平台规则不同：**X 用 `http://127.0.0.1`（拒绝 localhost），Threads 必须 HTTPS**。

**Q：.env 会被提交到 git 吗？**
A：不会，`.gitignore` 已排除 `.env` 和 `data/`。
