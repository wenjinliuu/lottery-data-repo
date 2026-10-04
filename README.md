# 彩票开奖数据 V2

这是一个公开的彩票开奖数据镜像。外部应用请自行读取本仓库的 GitHub JSON 文件；项目自用云服务不作为公共接口开放。

仓库不保存用户选号、投入、核对结果、账号或密钥。

## 读取数据

基础地址：

```text
https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/v2
```

| 文件 | 内容 |
| --- | --- |
| `index.json` | V2 文件索引 |
| `bootstrap.json` | 八个彩种最新一期、开奖安排及下一期信息 |
| `draws/{type}.json` | 单彩种最近 30 期 |
| `by-year/{type}/{year}.json` | 单彩种单年度开奖记录 |
| `calendar/{year}.json` | 年度期号与实际开奖日期，含休市安排 |

支持彩种：`ssq`、`dlt`、`kl8`、`fc3d`、`pl3`、`qlc`、`qxc`、`pl5`。

## 更新时间

GitHub 镜像通常在每天北京时间 **08:14** 的工作流执行后更新，提供前一天的开奖数据。它不是实时接口；当晚开奖结果通常要到次日同步后才能读取。GitHub Actions 排队或上游补抓可能导致延迟，手动同步也可能提前更新，请以文件中的生成时间和开奖日期为准。

请优先使用 `bootstrap.json`，按需读取最近开奖、年度历史和日历，并缓存数据，避免频繁重复下载。判断某日是否开奖应查询年度日历中的实际日期，不能只按星期判断。

字段说明见 [数据契约](docs/DATA_SCHEMA.md)。维护者及 AI 请先读 [维护说明](docs/MAINTENANCE.md)。
