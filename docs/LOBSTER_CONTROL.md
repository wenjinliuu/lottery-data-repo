# Lobster / OpenClaw Control

The updater can run automatically through cron and GitHub Actions. Lobster can participate in two useful ways:

1. Manually trigger an update when you ask.
2. Query the latest update status.
3. Receive failure-only notifications through a webhook.

## Manual Update Command

Let Lobster execute:

```bash
cd /root/lottery-data-repo
JISU_APPKEY=your_appkey bash scripts/server_update_and_push.sh /root/lottery-data-repo
```

Or through the control helper:

```bash
cd /root/lottery-data-repo
JISU_APPKEY=your_appkey python scripts/lottery_data_control.py update
```

Suggested natural language mapping:

```text
更新开奖数据
抓取最新开奖
刷新 GitHub 开奖库
```

## Query Status Command

Let Lobster execute:

```bash
cd /root/lottery-data-repo
python scripts/lottery_data_control.py status
```

Suggested natural language mapping:

```text
开奖数据更新了吗
昨晚抓取成功了吗
查看开奖数据状态
```

The command reads:

```text
public_data/health.json
public_data/latest.json
```

## Failure Notification

Set this environment variable if Lobster, ClawBot, or another notification service provides a webhook:

```bash
export LOTTERY_NOTIFY_WEBHOOK_URL="https://your-webhook-url"
```

The updater sends a POST request with this JSON shape:

```json
{
  "text": "开奖数据更新失败...",
  "title": "开奖数据更新失败",
  "status": "failure",
  "message": "error detail",
  "created_at": "2026-04-29T22:36:00+08:00",
  "source": "lottery-data-repo"
}
```

By default, success does not notify. To notify on success too:

```bash
export LOTTERY_NOTIFY_ON_SUCCESS=1
```

Recommended mode:

```text
Success: silent, write log and health.json only.
Failure: notify you.
Manual update: Lobster replies with command result.
```
