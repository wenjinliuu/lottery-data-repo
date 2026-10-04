# AI 维护入口

- 先读 `docs/MAINTENANCE.md`、相关字段契约和测试。
- README 面向外部读者，只介绍 GitHub 镜像和通常次日更新；项目自用云服务不作为公共 API。
- CloudBase 功能先读官方 cloudbase-guidelines。部署只走 git → CI；MCP 只用于查数据、日志和排查。
- 密钥只保存 Actions Secrets，不进入源码、参数、测试 fixture、日志或文档。
- 修改 V2 契约同时核对 `lottery-ios`；保留旧 App 的 GitHub 镜像兼容路径。
- 修改休市配置后验证年度日历，不能靠星期推断代替实际日历。
