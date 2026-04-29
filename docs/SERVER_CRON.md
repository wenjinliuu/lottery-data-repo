# Server Cron Backup

GitHub Actions is the main updater. A personal Tencent Cloud server can also run the updater as a backup.

## Clone Repository

```bash
cd /root
git clone git@github.com:<owner>/<repo>.git lottery-data
cd /root/lottery-data
```

## Environment

```bash
export JISU_APPKEY="your_appkey"
```

For permanent configuration, put it in a secure shell profile or systemd environment file.

## Manual Update

```bash
python scripts/update_public_data.py
python scripts/validate_public_data.py
git add public_data
git commit -m "Update lottery public data"
git push
```

## Cron Example

Beijing time examples:

```cron
36 22 * * * JISU_APPKEY=your_appkey LOTTERY_NOTIFY_WEBHOOK_URL=https://your-webhook bash /root/lottery-data-repo/scripts/server_update_and_push.sh /root/lottery-data-repo
36 2 * * * JISU_APPKEY=your_appkey LOTTERY_NOTIFY_WEBHOOK_URL=https://your-webhook bash /root/lottery-data-repo/scripts/server_update_and_push.sh /root/lottery-data-repo
```

The helper script updates JSON, validates schema, commits only when files changed, and pushes to GitHub.

## Logs

The updater writes logs to:

```text
/root/lottery-data-repo/update.log
```

Override it with:

```bash
export LOTTERY_UPDATE_LOG="/var/log/lottery-data-update.log"
```

## Failure Notification

If `LOTTERY_NOTIFY_WEBHOOK_URL` is set, failures are sent to that webhook. Success stays silent unless:

```bash
export LOTTERY_NOTIFY_ON_SUCCESS=1
```

See `docs/LOBSTER_CONTROL.md` for Lobster/OpenClaw command mapping.
