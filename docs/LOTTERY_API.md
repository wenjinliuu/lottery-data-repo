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
    OPTIONS /v2/*

支持彩种：ssq、dlt、kl8、fc3d、pl3、qlc、qxc、pl5。

规则：

- 最近开奖最多返回 30 期。
- 年份范围为 2000 至 2100。
- 只允许 GET、HEAD、OPTIONS；其它方法返回 405。
- 未知彩种和非法年份返回 404。
- /v1/* 已删除并返回 404。
- 所有响应允许跨域读取。

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
