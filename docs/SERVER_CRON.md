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
36 22 * * * JISU_APPKEY=your_appkey bash /root/lottery-data/scripts/server_update_and_push.sh /root/lottery-data
36 2 * * * JISU_APPKEY=your_appkey bash /root/lottery-data/scripts/server_update_and_push.sh /root/lottery-data
```

The helper script updates JSON, validates schema, commits only when files changed, and pushes to GitHub.
