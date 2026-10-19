# 迁移到 NAS 运行（Docker）

> 目标：把 Echo 从当前 Windows 电脑搬到家庭 NAS 上 7×24 常驻，公网域名 `https://echo.digitalgarden.party` 保持不变，X / Threads 授权**不需要重新做**。
>
> 为什么值得迁：调度器（`server/scheduler.js`）跑在 Echo 进程内，电脑关机期间到期的贴文只能等下次开机补投。NAS 常开才是定时发布的正确姿势。

---

## 0. 最终结构

```
浏览器 / Meta 服务器
        │  HTTPS
        ▼
Cloudflare 边缘（digitalgarden.party）
        │  命名隧道（由 NAS 上的 cloudflared 主动外拨）
        ▼
NAS   docker compose 网络
      ├─ echo-tunnel (cloudflare/cloudflared)  ──►  http://echo:8787
      └─ echo        (node:22-alpine)          ──►  /app/data  ◄── ./data（宿主机卷）
```

- 不需要公网 IP、不需要端口转发、不需要路由器设置（隧道是主动外拨的长连接）
- DNS 记录、Cloudflare Access 策略、`/media` 放行规则**全部不用动**
- `APP_BASE_URL` 不变 → OAuth 回调地址不变 → 已连接的账号继续可用

---

## 1. 迁移前必读：三个坑

### 1.1 绝不能让两台机器同时跑

这是最容易踩、后果最麻烦的一条。同时运行会同时踩三个雷：

| 问题 | 后果 |
| --- | --- |
| X 的 refresh token 是**一次性轮换**的 | 两台各自刷新，先刷的那台把后刷的令牌作废，账号连接直接失效，只能重新授权 |
| `data/*.json` 无文件锁，整份重写 | 两边互相覆盖，草稿/发布记录可能丢失或回退 |
| 同一条隧道两个 cloudflared 副本 | Cloudflare 把流量随机分给两台，电脑休眠时公网间歇性 502 |
| 调度器各跑一份 | 同一条定时贴文可能发两次 |

**顺序：先停旧机，再启动 NAS，中间不要并行。**

### 1.2 域名不变就不需要重新授权

`data/accounts.json` 里的访问令牌与刷新令牌照搬即可继续用。只有当你想换域名时，才需要去 X / Meta 后台改回调地址并重新连接账号。

### 1.3 `data/` 和 `.env` 是密钥

`data/accounts.json` 是明文的平台令牌，`.env` 里有 Client Secret。**不要放进任何双向同步目录**（iCloud / OneDrive / Syncthing 之类）——JSON 被同步工具改写会直接损坏，且等于把令牌散播到多处。用一次性拷贝（scp / SMB 拖过去）即可。

---

## 2. 旧机收尾（Windows）

```powershell
# 1) 确认没有"待发布"的定时贴文，或确认它们可以被 NAS 接管
#    （Echo 启动时会把已到期的 pending 贴文立即补投——迁移那一刻到期就会直接发出去）

# 2) 先跑一遍测试，确认代码是干净状态
cd "C:\Users\shibun.tei\WorkBuddy AI\Echo"
npm test

# 3) 停掉 Echo 进程（任务管理器结束 node.exe，或关掉 start-echo.bat 窗口）

# 4) 打包要带走的东西（只有这两样）
#    - 整个 data\ 目录（accounts / drafts / posts / logs / media.json / settings.json / media\）
#    - .env
```

打包示例（PowerShell）：

```powershell
$src = "C:\Users\shibun.tei\WorkBuddy AI\Echo"
$dst = "$env:USERPROFILE\Desktop\echo-backup-$(Get-Date -f yyyyMMdd)"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\data" "$dst\data" -Recurse -Force
Copy-Item "$src\.env" "$dst\.env" -Force
Compress-Archive -Path "$dst\*" -DestinationPath "$dst.zip" -Force
```

这份 zip 就是回滚用的冷备，**先别删**。

---

## 3. 代码上 NAS

NAS 上建一个目录，例如群晖的 `/volume1/docker/echo`（QNAP：`/share/Container/echo`）。

**方式 A：git clone（推荐，后续更新只要 `git pull`）**

```bash
git clone https://github.com/kevinzch/echo-social-publisher.git echo
```

> 私有仓库需要 PAT。仓库里不含 `.env` 与 `data/`（已在 `.gitignore`），所以克隆下来是干净的。

**方式 B：直接拷贝整个目录**，但**排除** `.git`、`.env`、`data`、`node_modules`（本来也没有）。

最终目录应长这样：

```
echo/
├─ Dockerfile
├─ docker-compose.yml
├─ .dockerignore
├─ .env                    ← 从旧机拷来
├─ data/                   ← 从旧机拷来（含 media/）
├─ cloudflared/
│  ├─ config.yml           ← 从旧机拷来后改一行
│  └─ <TUNNEL_ID>.json     ← 从旧机拷来（隧道凭据）
├─ server/  shared/  public/
└─ docs/
```

---

## 4. 隧道搬家（关键：改一行）

1. 从旧机复制这两个文件到 NAS 的 `echo/cloudflared/`：

   | 旧机位置 | 说明 |
   | --- | --- |
   | `C:\Users\shibun.tei\.cloudflared\b8214a71-9392-4df3-8952-609558117354.json` | 隧道凭据（当前 Tunnel ID） |
   | `C:\Users\shibun.tei\cloudflared\config.yml` | 隧道配置（**注意不在默认路径**，当时因文件锁改到了这里） |

   到 NAS 后分别改名为 `cloudflared/<TUNNEL_ID>.json` 和 `cloudflared/config.yml`。

2. 改 `config.yml` 里的源站地址与凭据路径：

```yaml
tunnel: b8214a71-9392-4df3-8952-609558117354
credentials-file: /home/nonroot/.cloudflared/b8214a71-9392-4df3-8952-609558117354.json

ingress:
  - hostname: echo.digitalgarden.party
    service: http://echo:8787     # 旧值 http://127.0.0.1:8787 在容器里指的是 cloudflared 自己
  - service: http_status:404
```

   直接拿 `cloudflared/config.example.yml` 填空也行。`hostname` 与 `tunnel` 保持原样。

3. **停掉旧机上的隧道**，否则两个副本会同时在线：

```powershell
# 旧机隧道是用 start-tunnel.bat 手动/计划任务启动的
schtasks /delete /tn "Echo Tunnel" /f
# 如果装过 Windows 服务
Stop-Service cloudflared -ErrorAction SilentlyContinue
Set-Service cloudflared -StartupType Disabled -ErrorAction SilentlyContinue

# Echo 的开机自启也一起删
schtasks /delete /tn "Echo Server" /f
```

   然后结束残留进程：`Get-Process cloudflared | Stop-Process -Force`

4. 文件权限（容器内以非 root 用户 `nonroot` 读取）：

```bash
chmod 644 cloudflared/config.yml cloudflared/*.json
```

---

## 5. 启动

### 群晖 DSM 7.2+（Container Manager）

1. **项目 → 新增 → 创建项目**
2. 路径选 `/volume1/docker/echo`，来源选「**使用现有的 docker-compose.yml**」
3. 下一步 → 完成 → 启动（首次会自动 build，拉 `node:22-alpine` 与 `cloudflare/cloudflared`，约 1–3 分钟）

### QNAP（Container Station 3）

**应用程序 → 创建 → 粘贴 YAML**（把 `docker-compose.yml` 内容粘进去），项目目录设为 `/share/Container/echo`。

### 绿联 / 极空间 / Unraid / TrueNAS

Docker 面板里的「项目 / 编排 / Compose」入口，指向该目录的 `docker-compose.yml` 即可；Unraid 可装 Compose Manager 插件。

### 命令行（任何支持 SSH 的 NAS）

```bash
cd /volume1/docker/echo
sudo docker compose up -d --build      # 老版本可能是 docker-compose
sudo docker compose ps                 # 期望：echo = healthy，echo-tunnel = running
sudo docker compose logs -f echo       # 看到「Echo 已启动」与「数据目录: /app/data」
```

---

## 6. 验证清单

- [ ] `docker compose ps`：`echo` 为 **healthy**，`echo-tunnel` 为 **running**
- [ ] 局域网 `http://<NAS-IP>:8787` 能打开 Echo
- [ ] `curl -I https://echo.digitalgarden.party` → 302 跳 `cloudflareaccess.com`（Access 生效）
- [ ] 浏览器过 OTP → 「账号」页 X / Threads 仍是**已连接**（令牌搬家成功）
- [ ] 发一条 **X 纯文字**测试帖
- [ ] 发一条 **Threads 带图**测试帖（验证 Meta 能抓 `https://echo.digitalgarden.party/media/...`）
- [ ] 设一条 3 分钟后的定时帖，确认 NAS 到点发出
- [ ] 重启 NAS，等 2 分钟后域名仍可访问（`restart: unless-stopped` 生效）
- [ ] 旧机的开机自启任务已删除

---

## 7. NAS 差异与注意事项

| 项目 | 说明 |
| --- | --- |
| 架构 | `node:22-alpine` 与 `cloudflared` 都有 arm64 版本，ARM 机型（如 DS223 / DS124）可直接跑 |
| 端口 | 8787 一般空闲；DSM 占用 5000/5001，QNAP 占用 8080，注意避开 |
| 时区 | compose 里 `TZ` 已设 `Asia/Kuala_Lumpur`（与 `Asia/Shanghai` 同为 UTC+8）。时区只影响界面显示与日志时间，定时帖按 ISO 时间戳比对，不会错点 |
| 内存 | 常驻约 60–80 MB，任何 NAS 都够 |
| 磁盘 | `data/media` 是图片缓存，单张 ≤8MB，长期可定期清理不再被引用的图 |
| 备份 | 建议给 `echo/data` 开 NAS 快照（Btrfs/快照中心），比手工拷贝可靠 |
| 权限 | 镜像默认以 root 运行以规避 uid 映射问题；想收紧就在 `Dockerfile` 取消 `USER node` 注释，并 `chown -R 1000:1000 data` |
| 安全 | **Cloudflare Access 必须保持开启**。Echo 自身没有登录功能，谁能打开域名谁就能用你的账号发帖；`/media` 的 Bypass 策略保留（Meta 抓图需要） |

---

## 8. 常见问题

**Q：容器起不来，日志报 `EACCES: permission denied, mkdir '/app/data'`**
A：宿主机 `data` 目录权限不对。`chmod -R 777 data` 先验证，再改成合适属主；或保持默认 root 运行（本仓库镜像默认如此）。

**Q：域名 502 / Cloudflare 1033**
A：三种可能：① `cloudflared` 容器没起来；② `config.yml` 的 `service` 还写着 `127.0.0.1:8787`（容器内指向自己）；③ 旧机隧道没停，流量被分走。

**Q：`cloudflared` 报 `Cannot determine default configuration path` 或读不到凭据**
A：`config.yml` 与 `<TUNNEL_ID>.json` 的路径/权限不对。容器内路径必须是 `/home/nonroot/.cloudflared/...`，文件权限 644。

**Q：账号显示"令牌已过期" / 发帖 401**
A：基本可以确定是迁移期间两台同时刷新过令牌。到「账号」页解绑后重新连接一次即可（域名没变，回调能直接用）。

**Q：NAS 拉不到 Docker Hub 镜像**
A：在能上网的机器上 `docker pull` 后 `docker save` → 拷到 NAS → `docker load`；或给 NAS 的 Docker 配镜像加速地址。

**Q：迁移后发现某条定时帖重复发了**
A：旧机停机前已发出、NAS 启动时又补投（或反之）。确认只保留一台在跑即可，历史记录里删掉多余那条。

**Q：以后怎么更新代码**
A：`git pull` 后 `docker compose up -d --build`。数据在 `./data`，不受影响。前端静态资源带 ETag 与构建指纹，Cloudflare 那边建议保持 `Browser Cache TTL = Respect Existing Headers`。

---

## 9. 回滚

```bash
# NAS 上停掉
sudo docker compose down
```

然后：解压第 2 步的备份 → 恢复旧机的 `data/` 与 `.env` → 重新启用开机任务 → `cloudflared tunnel run echo`。

> 注意：回滚前若 NAS 上已刷新过 X 令牌，旧备份里的刷新令牌可能已失效，需要重新连接 X 账号。

---

## 10. 相关文档

- `docs/DEPLOY_TUNNEL.md` —— 域名接入 Cloudflare、命名隧道、Access 策略（第 9 节 Q4 已预留迁移说明）
- `docs/API_APPLY_GUIDE.md` —— X / Meta 开发者应用申请与回调配置
- `docs/ARCHITECTURE.md` —— 调度器与发布流水线设计
