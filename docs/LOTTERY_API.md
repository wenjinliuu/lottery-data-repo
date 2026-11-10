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
- 开奖查询只允许 GET、HEAD、OPTIONS；其它方法返回 405。个人票据接口见下一节。
- 未知彩种和非法年份返回 404。
- /v1/* 已删除并返回 404。
- 所有响应允许跨域读取。

## 个人票据（自用）

    GET  /v2/me/tickets?since={cursor}&limit={n}
    POST /v2/me/tickets
    POST /v2/me/devices

都必须带 `X-Lottery-User-Key`（个人密钥，和读取密钥是两把）；响应一律 `no-store`，没有 GitHub 镜像。

- **上传** `POST /v2/me/tickets`：`{"tickets":[{"id","updated_at","deleted","record"}]}`，一次最多 200 条，请求体最多 1MB。`record` 就是 App 备份文件里的单条记录。同一张票以 `updated_at` 为准，新的覆盖旧的，相同或更旧的跳过，所以可以放心重传。返回 `accepted`、`skipped`、`cursor`。
- **拉取** `GET /v2/me/tickets`：返回序号大于 `since` 的票据（升序，每页最多 500），以及新的 `cursor` 和 `has_more`。每条带 `id`、`updated_at`、`deleted`、`record`；云端核对过的还带 `settlement`：`status`（`won` / `lost` / `prize_float`）、`prize_name`、`amount`（已乘倍数）、`matched`、`settled_at`。
- **登记推送** `POST /v2/me/devices`：`{"token","environment","bundle_id"}`，`environment` 为 `production` 或 `sandbox`。
- 错误：400（`invalid_json`、`invalid_ticket`、`too_many_tickets` 等）、401、405、503（服务端没配个人密钥）。

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
