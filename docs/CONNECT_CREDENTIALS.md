# Bluesky / Mastodon 连接指南

这两个平台**不需要开发者应用、不需要审核、没有费用**，用应用凭据直接连接。

## Bluesky（App Password）

1. 登录 <https://bsky.app> → **设置（Settings）→ App Passwords**
2. 点 **Add App Password**，名称随意（如 `Echo`），生成后**复制**形如 `abcd-efgh-ijkl-mnop` 的密码
3. Echo →「账号」页 → Bluesky 卡片：
   - handle：你的完整 handle（如 `kevin.bsky.social`）
   - App Password：刚复制的密码
   - 点 **连接 Bluesky**

> - App Password **不是**你的登录密码，可随时在 Bluesky 设置里撤销
> - accessJwt 约 2 小时过期，Echo 会自动用 refreshJwt 续期并回写，无需手动维护
> - 若提示「Bluesky 登录失败: Invalid identifier or password」，检查 handle 是否带 `.bsky.social` 后缀、密码是否含多余空格

## Mastodon（访问令牌）

1. 登录你的实例（如 <https://mastodon.social>）→ **首选项 → 开发 → 新建应用**
2. 应用名称填 `Echo`，**权限勾选 `write`**（可再勾 `read`），回调地址留空
3. 保存后复制 **你的访问令牌**（Your access token）
4. Echo →「账号」页 → Mastodon 卡片：
   - 实例地址：如 `https://mastodon.social`（可省略 `https://`）
   - 访问令牌：刚复制的令牌
   - 点 **连接 Mastodon**

> - Mastodon 访问令牌**默认长期有效**，除非你撤销或实例管理员设置了过期策略
> - 每个 Mastodon 账号可以来自不同实例，Echo 按账号分别保存实例地址
> - 若提示 401，回到实例重新生成令牌（旧的会被撤销）

## 发布规则

| | Bluesky | Mastodon |
|---|---|---|
| 单帖字数 | 300 | 500（因实例而异） |
| 每帖图片 | 4 张，单张 ≤1MB | 4 张，单张 ≤16MB |
| 分段 | 自动串成 thread（root + parent） | 自动串成 thread（in_reply_to_id） |
| 链接 | 自动生成 facets，可点击 | 原样保留 |

## 常见问题

**Q：发帖报 401 / Unauthorized？**
A：凭据失效。Bluesky 重新生成 App Password；Mastodon 重新生成访问令牌，然后解绑重连。

**Q：Bluesky 图片上传失败？**
A：单张超过 1MB。压缩后再发（Echo 不会自动压缩）。

**Q：Mastodon 发帖后看不到？**
A：Echo 默认 `visibility: public`；若实例有审核或你的账号受限，可能延迟展示。
