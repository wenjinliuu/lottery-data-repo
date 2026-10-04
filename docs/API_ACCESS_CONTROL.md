# 彩票接口：App 读取密钥与宽松限流

GitHub 静态镜像继续公开。腾讯云彩票 API 使用专用读取密钥，不接受腾讯云管理凭据，也不要求 App 用户登录。

## 配置与上线

在 `lottery-data-repo` 和 `lottery-ios` 两个仓库分别设置同名 Repository Actions Secret：`LOTTERY_READ_API_KEY`。两个值必须相同，使用密码管理器生成 32–128 位随机英文字母、数字、下划线或短横线（推荐 64 位随机十六进制）。不要把值写入源码、文档、Issue、工作流参数或聊天。它与 `CLOUDBASE_API_KEY`、`JISU_APPKEY` 无关。

1. iOS Build & Test 可在没有生产读取密钥时运行；测试显式使用测试密钥。中央 TestFlight 工作流仅在归档准备步骤提供 `APP_RUNTIME_API_KEY`，调用方把它映射到自己的 `LOTTERY_READ_API_KEY` Secret。生成的 Swift 文件不入库。不配置密钥时 TestFlight 归档会阻断，避免误发缺少密钥的安装包。
2. 先运行 iOS TestFlight、安装带密钥的版本。
3. 再在开奖仓库手动运行 **Deploy CloudBase lottery functions**。工作流先跑测试，部署 API，再增量更新彩票网关限流，检查无密钥/错误密钥返回 401、正确密钥返回 200，然后执行权限迁移、重新验收。
4. 没有 Secret 时部署任务跳过并在 summary 明确提示，保持已有线上服务；这不表示已经启用访问保护。

## 调用契约

- `GET` 和 `HEAD` 的所有彩票路由（包括 index、health、status）必须带 `X-Lottery-Api-Key` 请求头。
- 密钥缺失或错误：401，`{"error":"unauthorized"}`。
- 服务端没有配置有效密钥：503，默认拒绝读取；不会自动退回公开模式。
- 不接受 URL 查询参数里的密钥。响应与日志不回传密钥。
- `OPTIONS` 只返回跨域预检；不查询数据库。
- 鉴权数据响应使用 `Cache-Control: private` 和 `Vary: x-lottery-api-key`，防止共享 CDN 绕过校验；拒绝响应为 `no-store`。

## 限流

`config/lottery-gateway-access.json` 只更新 `/lottery` 路由的 `qpsPolicy`：

| 范围 | 限额 |
| --- | --- |
| 同一客户端源 IP | 每秒 10 个请求 |
| 彩票路由全部请求 | 每秒 100 个请求 |

使用平台识别的 `ClientIP`，不信任 App 自报的设备 ID 或自行解析的转发头。这是网关限频，不是每用户配额；同一家庭/公司网络共享 IP。配置宽松，正常首页、切换彩种、连续浏览年度数据无需等待。超限时 App 使用 GitHub 镜像或已有缓存。部署后读取实际路由配置并核对两个限额，不主动刷线上接口做压力测试。函数调用、流量仍按实际资源计费，限流不等于费用硬上限。

## 数据库与兼容

迁移 `20261004080500_lottery_private_reads.sql` 撤销开奖表/日历表对 `anon`、`authenticated` 的直接读取权限，保留 `service_role`，不改开奖内容。CI 只从临时迁移目录提交这一份新迁移，不重跑历史迁移。权限回退 SQL 在迁移文件注释中。

旧版 iOS 多拼了一层 `/v2/` 的 GitHub 兜底路径由 `scripts/sync_legacy_mirror.py` 保持兼容。镜像工作流在生成日历之后同步别名；新 App 改为正确的规范地址。旧版没有读取密钥时只能使用每日同步的 GitHub 镜像，无法查看云端实时抓取状态。

固定 App 读取密钥可能被从安装包提取。它用于阻挡普通直接调用，不能证明调用方一定是官方 App。轮换密钥必须先发新 App，再更新云端；若以后需要更强保证，可升级 App Attest。
