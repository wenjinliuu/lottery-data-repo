# 开奖仓库维护说明

README 面向外部使用者，只介绍 GitHub 镜像；项目自用云服务不作为公共 API。源码和维护文档仍公开，减少 README 展示不是访问控制，实际保护靠读取密钥、数据库权限和网关限流。

## 数据链路与责任文件

| 环节 | 维护位置 | 约束 |
| --- | --- | --- |
| 抓取和补抓 | `cloudbase/src/handler.mjs`、`repository.mjs`、`config/lotteries.json` | 已完整彩种跳过；自动调用共享预算；号码和奖级都完整才结束补抓 |
| 自用 API | `cloudbase/src/api-handler.mjs`、`api-access.mjs` | GET/HEAD 先验证读取密钥，再访问数据库；不返回或记录密钥 |
| 网关限流 | `config/lottery-gateway-access.json` | 仅 `/lottery`：每 IP 10 QPS，总计 100 QPS；不影响同环境其他项目 |
| 数据库权限 | `cloudbase/migrations` | 匿名/普通认证角色不直接读取开奖表；保留服务角色；新增版本迁移，不重放历史迁移 |
| GitHub 同步 | `.github/workflows/update-lottery-data.yml` | 北京时间 08:14 补前一天未完成数据、导出、生成日历、提交镜像；排队会延迟 |
| 年度日历 | `scripts/build_draw_calendar.py`、`config/closures.json` | 春节/国庆休市由生成端体现；客户端不能按星期补猜 |
| 旧版 App 别名 | `scripts/sync_legacy_mirror.py` | 保留 `/public_data/v2/v2/...`；从规范目录同步，禁止递归复制别名 |

## 密钥、修改与发布

- `LOTTERY_READ_API_KEY` 在本仓库和 `lottery-ios` 分别存为 Actions Repository Secret，值相同；32–128 位英文字母、数字、`_`、`-`，建议 64 位随机十六进制。它不是云管理凭据 `CLOUDBASE_API_KEY` 或上游 `JISU_APPKEY`。
- App 构建、服务端校验及验收脚本统一去除 Secret 首尾空白，兼容复制带换行；内部空白/其他非法字符仍拒绝。不得对请求头随意宽松转换。
- 禁止将真实密钥写入源码、工作流参数、测试 fixture、日志、Issue、文档。固定 App 读取密钥可能被从安装包提取，只提供基础限制。
- 改字段前读 [DATA_SCHEMA.md](DATA_SCHEMA.md)，同时核对 iOS 的 DTO/Mapper：云端与 GitHub 使用同一 V2 JSON 契约。
- CloudBase 功能先读官方 cloudbase-guidelines；部署只走 git → GitHub Actions。MCP 只用于查数据、日志和排查。
- 验证命令：`npm --prefix cloudbase ci`、`npm --prefix cloudbase test`、`python -m unittest discover -s tests`、`python scripts/validate_public_data.py`。
- 腾讯云网关会追加或替换缓存头为 `no-store, no-cache, must-revalidate, max-age=0`。验收按指令含义判断：拒绝响应必须有 `no-store`；成功响应必须有 `private` 或更严格的 `no-store`。不要求整串响应头与函数代码完全一致，也不能接受公开共享缓存。
- **Deploy CloudBase lottery functions**：部署函数 → 更新并回读限流 → 验证缺失/错误密钥 401 与正确密钥 200 → 执行本次权限迁移 → 再验收。工作流绿色不代表已部署，deploy job 可能因缺 Secret 跳过。
- 普通 push/PR 只检查。云端部署需在 main 手动运行工作流；如果手动入口不可用，可合入标题以 `deploy: lottery access protection` 开头的明确发布提交。仅这个前缀的 main push 会启用部署，不对普通文档/配置更新自动部署。合入这种发布提交之前必须确认带密钥的 TestFlight 已上传。格式失败日志不显示密钥。
- 权限迁移在隔离目录运行；该目录重新登录 API Key，先 fetch 远端已应用迁移，再 preview/up。不能把本仓库未应用的历史 SQL 一起推上去，也不能把迁移登录失败当成权限已完成。
- 首次启用/轮换密钥先构建并安装带新密钥的 App，再启用云端对应密钥。详细步骤见 [API_ACCESS_CONTROL.md](API_ACCESS_CONTROL.md)。
- 改休市配置后重新生成受影响年份日历、跑测试和结构验证、同步兼容别名；没有权威新年度安排时不假称已确认。

## 排查顺序

- GitHub 数据未更新：检查 08:14 工作流和文件生成时间，镜像通常次日更新，不能代答云端实时状态。
- 401：检查两个仓库 Secret 是否一致、TF 构建是否在设置 Secret 后生成，禁止打印值。
- 503：检查函数读取密钥环境变量，缺配置时必须拒绝读取。
- 429：查 `/lottery` 限流；App 可回落 GitHub/缓存，不随意取消限制。
- 旧版兜底失败：检查镜像别名同步；新版应使用规范路径。
- 日历漏下半年：检查分页、完整性校验、年度文件；不改用星期掩盖缺数据。

技术接口细节见 [LOTTERY_API.md](LOTTERY_API.md)；访问保护和权限回退 SQL 见 [API_ACCESS_CONTROL.md](API_ACCESS_CONTROL.md)。
