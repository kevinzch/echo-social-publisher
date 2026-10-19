# 固定域名部署手册（Cloudflare 命名隧道）

> 目标：把 Echo 通过 `https://echo.digitalgarden.party` 永久暴露到公网，替代每次重启都会变的 `*.trycloudflare.com` 临时隧道。
> 完成后 X / Meta 后台的回调地址**只需配置一次，永不再改**。

## 0. 最终结构

```
浏览器 / Meta 服务器
        │  HTTPS
        ▼
Cloudflare 边缘（digitalgarden.party 的 DNS）
        │  命名隧道（由本机 cloudflared 主动拨出的长连接）
        ▼
你的电脑  cloudflared ──► Echo http://127.0.0.1:8787
```

- 域名：`digitalgarden.party`（已购买）
- 使用子域：`echo.digitalgarden.party`（主域留给你的数字花园站点，互不影响）
- 无需公网 IP、无需端口转发、无需路由器设置

---

## 1. 域名接入 Cloudflare（一次性，约 5–30 分钟生效）

1. 登录 <https://dash.cloudflare.com> → **添加站点 / Add a site** → 输入 `digitalgarden.party` → 选 **Free** 套餐。
2. Cloudflare 会给出两个 **Nameserver**（形如 `xxx.ns.cloudflare.com`）。
3. 到你的域名注册商后台，把域名的 **NS 记录**改成这两个地址（删掉原来的 NS）。
4. 回 Cloudflare 点 **Check nameservers**，等待状态变为 **Active**（通常几分钟，最长 24 小时）。
5. 生效前不要进行下一步——`tunnel route dns` 需要域名处于 Active 状态。

---

## 2. 创建命名隧道（本机 PowerShell）

```powershell
# ① 登录并授权（会打开浏览器，选择 digitalgarden.party 并点击 Authorize）
cloudflared tunnel login

# ② 创建隧道（名字随意，这里叫 echo）
cloudflared tunnel create echo
# 输出会包含 Tunnel ID，形如 6ff42ae2-765d-4b4a-8c3e-1f2d3e4f5a6b
# 记下它，下一步要用

# ③ 把子域指向这条隧道（自动创建 CNAME 记录）
cloudflared tunnel route dns echo echo.digitalgarden.party
```

检查：`cloudflared tunnel list` 应能看到 `echo` 隧道及其 ID。

---

## 3. 写配置文件

新建 `C:\Users\shibun.tei\.cloudflared\config.yml`：

```yaml
tunnel: <第 2 步的 Tunnel ID>
credentials-file: C:\Users\shibun.tei\.cloudflared\<Tunnel ID>.json

ingress:
  - hostname: echo.digitalgarden.party
    service: http://127.0.0.1:8787
  - service: http_status:404
```

> 凭据文件 `~/.cloudflared/<Tunnel ID>.json` 由 `tunnel create` 自动生成，路径照抄即可。

---

## 4. 先手动测试

```powershell
cloudflared tunnel run echo
```

另开一个窗口验证：

```powershell
curl.exe -I https://echo.digitalgarden.party
# 期望：HTTP/2 200
```

浏览器打开 <https://echo.digitalgarden.party>，应能看到 Echo 界面。

---

## 5. 安装为 Windows 服务（开机自启，管理员 PowerShell）

```powershell
cloudflared service install
```

之后无需手动开窗口。常用命令：

```powershell
Get-Service cloudflared          # 查看状态
Start-Service cloudflared        # 启动
Restart-Service cloudflared      # 重启（改配置后需要）
```

> 服务读取的是 `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` 或安装时指定的配置路径。
> 如果服务启动后不生效，把 `config.yml` 和凭据 JSON 复制到 `C:\Windows\System32\config\systemprofile\.cloudflared\`，或改用 `cloudflared service install --config <你的 config.yml 绝对路径>`。

---

## 6. Echo 配置（已替你改好）

`.env` 当前内容：

```bash
APP_BASE_URL=https://echo.digitalgarden.party
THREADS_REDIRECT_URI=https://echo.digitalgarden.party/auth/threads/callback
THREADS_IMAGE_BASE_URL=https://echo.digitalgarden.party
```

改完需重启 Echo（`npm start`）才生效。重启后 `/api/config` 会显示新的回调地址。

> 已连接的 X / Threads 令牌**不受影响**，无需重新授权；只有下次主动重新连接时才会用到新回调。

---

## 7. 平台后台各更新一次

### X（developer.x.com → 你的 App → User authentication settings）

| 字段 | 值 |
| --- | --- |
| Callback URI | `https://echo.digitalgarden.party/auth/x/callback` |
| Website URL | `https://echo.digitalgarden.party` |

### Meta（developers.facebook.com → 你的应用 → Threads API → 设置）

| 字段 | 值 |
| --- | --- |
| 跳转回调网址 | `https://echo.digitalgarden.party/auth/threads/callback` |

---

## 8. 验证清单

- [ ] `https://echo.digitalgarden.party` 能打开 Echo（HTTPS 锁标正常）
- [ ] Echo「账号」页显示的回调地址为 `https://echo.digitalgarden.party/...`
- [ ] 在 Echo 发一条 Threads **带图**帖成功（验证 Meta 能抓取 `https://echo.digitalgarden.party/media/...`）
- [ ] 解绑并重新连接一次 X（验证新回调可用）
- [ ] 重启电脑后 `Get-Service cloudflared` 为 Running，域名仍可访问

---

## 9. 常见问题

**Q：域名解析成功但打开是 502 / 1033？**
A：隧道没在跑，或 config.yml 里的 hostname/service 写错。检查 `cloudflared tunnel list` 与 `Get-Service cloudflared`。

**Q：`tunnel route dns` 报 "zone not found"？**
A：域名还没在 Cloudflare 激活（NS 未生效），等 Active 后再执行。

**Q：改了 config.yml 不生效？**
A：`Restart-Service cloudflared`；服务模式下确认读取的是正确的配置文件路径。

**Q：以后换机器（比如迁到 NAS）怎么办？**
A：把 `config.yml` + 凭据 JSON 复制到新机器，`cloudflared service install` 即可；DNS 记录不用动。NAS 上也可以用 Docker 跑 cloudflared，挂载同一份配置。

**Q：隧道一直开着安全吗？**
A：Cloudflare 只转发到 `127.0.0.1:8787`，不暴露其他端口。**必须配合 Cloudflare Access 使用**（见第 10 节）——否则任何知道域名的人都能操作你的账号。

---

## 10. 访问保护：Cloudflare Access（邮箱验证码）

公网可达后必须加鉴权。用 Cloudflare Access 的 **One-time PIN（邮箱验证码）**，零代码、免费（50 用户以内）。

### 10.1 添加 One-time PIN 登录方式

> ⚠️ 新版 Zero Trust 组织默认使用「Cloudflare 账号」作为登录方式，**OTP 不再自动添加**。

1. Zero Trust → **Integrations → Identity providers**
2. **Add new identity provider** → 选 **One-time PIN** → 保存

### 10.2 创建 Access 应用

1. Zero Trust → **Access controls → Applications → Create new application → Self-hosted and private**
2. **Public hostname**：Subdomain `echo` + Domain `digitalgarden.party`（Path 留空）
3. **Access policies**：新建策略
   - Action：**Allow**
   - Include：**Emails** → 你自己的邮箱
   - **Policy session duration：1 month**（这就是"记住我 30 天"）
4. **Authentication**：保持「Accept all available identity providers」开启（OTP 加入后会出现在登录页）；若只想显示验证码，可关闭此项并只选 One-time PIN
5. 保存

> 会话时长优先级：**Policy > Application > Global**。policy 级设置会覆盖另外两者，所以只需在策略里设 1 month。
> Application 级时长位置：Applications → 选择应用 → **Configure → Overview → Session Duration**。

### 10.3 放行图片路径（否则 Threads 带图帖失败）

Meta 的服务器抓取图片时不带登录 Cookie，必须放行 `/media/*`：

1. 再建一个 Self-hosted 应用
2. Hostname 同上，**Path 填 `media`**
3. Policy：Action = **Bypass**，Include = **Everyone**
4. 保存（Bypass 策略优先级最高）

### 10.4 验证

```powershell
# 首页应 302 跳转到 <team>.cloudflareaccess.com
curl.exe -I https://echo.digitalgarden.party

# 媒体文件应 200（Meta 抓图依赖）
curl.exe -I https://echo.digitalgarden.party/media/<任一图片>
```

浏览器无痕窗口访问 → 输入白名单邮箱 → 收 6 位验证码 → 登录；非白名单邮箱收不到验证码（且页面提示一致，不泄露白名单信息）。

### 10.5 可选加固

在 cloudflared 隧道设置中开启 **Protect with Access**，让源站再校验一次 Access 令牌，防止绕过 Cloudflare 边缘直连隧道。

---

## 11. 开机自启（Echo + 隧道）

隧道和 Echo 都需要开机自启，否则重启后公网会 502。

`C:\Users\shibun.tei\cloudflared\start-tunnel.bat`（隧道）已生成；再为 Echo 建一个 `start-echo.bat`：

```bat
@echo off
cd /d "C:\Users\shibun.tei\WorkBuddy AI\Echo"
node server/main.js
```

然后注册两个登录时任务：

```powershell
schtasks /create /tn "Echo Server" /tr "C:\Users\shibun.tei\WorkBuddy AI\Echo\start-echo.bat" /sc onlogon
schtasks /create /tn "Echo Tunnel" /tr "C:\Users\shibun.tei\cloudflared\start-tunnel.bat" /sc onlogon
```
