# Lottery API V2

基础地址：

    https://wenjin-cloudbase-d1empq882391ac1-1311287495.ap-shanghai.app.tcloudbase.com/lottery

## 路由

    GET|HEAD /v2
    GET|HEAD /v2/bootstrap
    GET|HEAD /v2/draws/{lottery_type}
    GET|HEAD /v2/by-year/{lottery_type}/{year}
    GET|HEAD /v2/calendar/{year}
    GET|HEAD /v2/health
    GET|HEAD /v2/status
    OPTIONS /v2/*

支持彩种：ssq、dlt、kl8、fc3d、pl3、qlc、qxc、pl5。

访问保护：所有 GET/HEAD 必须带 `X-Lottery-Api-Key`；GitHub 镜像无需密钥。配置方式和启用顺序见 [API_ACCESS_CONTROL.md](API_ACCESS_CONTROL.md)。

规则：

- 最近开奖最多返回 30 期。
- 年份范围为 2000 至 2100。
- 只允许 GET、HEAD、OPTIONS，其它方法返回 405；唯一的例外是 `POST /v2/devices`，见下一节。
- 未知彩种和非法年份返回 404。
- /v1/* 已删除并返回 404。
- 所有响应允许跨域读取。

## 推送设备登记

    POST /v2/devices

带 `X-Lottery-Api-Key`，请求体最多 16KB，响应 `no-store`：

    {"token": "<APNs 设备令牌，十六进制>", "environment": "production|sandbox",
     "bundle_id": "com.wenjinliu.lotterywallet", "lotteries": ["ssq", "dlt"]}

同一个令牌重复登记就是覆盖；`lotteries` 传空数组即退订。错误：400（`invalid_token`、`invalid_lotteries`、`invalid_json`、`body_too_large`）、401、503。

开奖号码落库后，订了该彩种的设备各收到一条通知（每期一次）：标题「双色球 2026130 期开奖」，正文是开奖号码，带 `mutable-content`。自定义字段 `lottery_type` 和 `draw`（`issue`、`date`、`numbers`、`prizes[{name, amount, extra_amount}]`，与 `/v2/draws` 的单条开奖同构；奖级放不下时省略）。云端不知道用户有什么票，中奖情况由 App 的通知扩展在本机算出来后改写正文。

## GitHub 静态镜像

基础地址：

    https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/v2

| CloudBase | GitHub |
| --- | --- |
| /v2/bootstrap | /bootstrap.json |
| /v2/draws/{type} | /draws/{type}.json |
| /v2/by-year/{type}/{year} | /by-year/{type}/{year}.json |
| /v2/calendar/{year} | /calendar/{year}.json |
| /v2/health | 无镜像 |

GitHub 镜像由每天 08:14 的 Actions 工作流导出，不保证与每一次 CloudBase 抓取实时同步。
