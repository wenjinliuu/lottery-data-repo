# CloudBase V2 生产状态

迁移已经完成，当前只维护 V2 公共契约。

## 数据真相与镜像

CloudBase PostgreSQL 是生产数据真相。CloudBase 七个定时器负责抓取与补抓，GitHub Actions 在北京时间 08:14 做最后兜底并导出 public_data/v2。

这不是逐次同步：21:34 至 02:44 的每一次 CloudBase 抓取只更新 PostgreSQL；GitHub 镜像通常在 08:14 才统一更新。

## 生产资源

- 环境：wenjin-cloudbase-d1empq882391ac1
- 地域：ap-shanghai
- 数据库：CloudBase PostgreSQL
- 抓取函数：lottery-ingest
- 只读函数：lottery-api、lottery-api-http
- 自动调用上限：每个目标开奖日 60 次
- GitHub 镜像：public_data/v2

## 数据库迁移历史

- 20260920143500_lottery_schema_baseline
- 20260920233000_lottery_class_sync：历史迁移，class 功能已废止
- 20260921005000_remove_class_sync：删除 class 同步表和字段

迁移文件是数据库演进记录，不得删除、改写或重新编号。废止功能通过后续迁移前向清理。

## 已删除内容

- /caipiao/class 同步链路
- lottery_next_status
- CloudBase /v1/* 路由
- GitHub V1 静态文件
- GitHub 直接抓取的旧 Python 主流程
- 最近 50 期契约

## 当前客户端

- iOS：CloudBase V2 → GitHub V2 → 本地缓存。
- Web：GitHub V2 → Service Worker 缓存。

V2 health 仅存在于 CloudBase /v2/health，不生成 GitHub health 镜像。
