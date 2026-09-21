# 对个号开奖数据 V2

这是“对个号”使用的公共彩票开奖数据仓库。生产数据由腾讯云开发 CloudBase PostgreSQL 保存，本仓库只提供延迟的 GitHub V2 静态镜像和部署源码。

仓库不保存用户选号、投入、核对结果、账号或 API Key。

## 当前架构

- CloudBase lottery-ingest：按定时器调用极速数据并写入 PostgreSQL。
- CloudBase lottery-api-http：提供只读 /v2/* API。
- GitHub Actions：北京时间 08:14 对前一天未完成彩种做最后兜底，然后把 CloudBase 数据导出到 public_data/v2。
- iOS App：CloudBase V2 为主源，GitHub V2 为在线兜底，本地缓存为离线兜底。
- 网页版：只读取 GitHub public_data/v2，不直接连接 CloudBase。

CloudBase 每次抓取后不会立即提交 GitHub。七个 CloudBase 定时点实时更新数据库；GitHub 镜像通常每天 08:14 更新一次，也可以手动运行工作流更新。

## V2 公共镜像

基础地址：

    https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/v2

目录：

    public_data/v2/
    ├── index.json
    ├── bootstrap.json
    ├── draws/{lottery_type}.json
    ├── by-year/{lottery_type}/{year}.json
    └── calendar/{year}.json

- bootstrap.json：八个彩种最新一期以及开奖安排、下一期推算。
- draws/{type}.json：单彩种最近 30 期。
- by-year/{type}/{year}.json：单彩种单年度数据。
- calendar/{year}.json：年度期号与开奖日期。
- index.json：V2 文件索引。

public_data/v2/health.json 不存在。健康检查只检查 CloudBase 自身，因此只能调用 CloudBase /v2/health，不能使用 GitHub 镜像代答。

支持彩种：ssq、dlt、kl8、fc3d、pl3、qlc、qxc、pl5。

## CloudBase API

基础地址：

    https://wenjin-cloudbase-d1empq882391ac1-1311287495.ap-shanghai.app.tcloudbase.com/lottery

只读接口：

    GET /v2
    GET /v2/bootstrap
    GET /v2/draws/{lottery_type}
    GET /v2/by-year/{lottery_type}/{year}
    GET /v2/calendar/{year}
    GET /v2/health

V1 接口和 V1 静态文件已经删除。

## 抓取与镜像时间

| 执行位置 | 北京时间 | 作用 |
| --- | --- | --- |
| CloudBase | 21:34 | 福彩早期抓取 |
| CloudBase | 21:44 | 当日全部应开奖彩种 |
| CloudBase | 21:54 | 只补未完成彩种 |
| CloudBase | 22:14 | 只补未完成彩种 |
| CloudBase | 22:34 | 只补未完成彩种 |
| CloudBase | 00:34 | 补前一天未完成彩种 |
| CloudBase | 02:44 | 最后一次云端恢复 |
| GitHub Actions | 08:14 | 最终兜底并导出 GitHub V2 镜像 |

同一目标开奖日自动调用共享 60 次硬上限；已完整的彩种会跳过。号码已返回但奖级仍不完整时不会提前结束补抓。

## 工作流

部署工作流 .github/workflows/deploy-cloudbase-ingest.yml 会安装依赖、运行测试、部署三个函数并调用 /v2/health 验证。

08:14 工作流 .github/workflows/update-lottery-data.yml 会：

1. 对前一天未完成彩种执行最后兜底。
2. 从 CloudBase PostgreSQL 导出 public_data/v2。
3. 生成并校验年度日历。
4. 提交 V2 镜像到 main。

所需 GitHub Repository Secrets：CLOUDBASE_API_KEY、JISU_APPKEY。

## 年度日历

休市配置位于 config/closures.json。春节日期公布后补充下一年配置，然后运行：

    python scripts/build_draw_calendar.py --year 2027
    python -m unittest discover -s tests
    python scripts/validate_public_data.py

日历生成器直接输出 V2 扁平 entries 结构。

## 本地验证

    cd cloudbase
    npm ci
    npm test
    cd ..
    python -m unittest discover -s tests
    python scripts/validate_public_data.py

字段契约见 docs/DATA_SCHEMA.md，API 说明见 docs/LOTTERY_API.md。
