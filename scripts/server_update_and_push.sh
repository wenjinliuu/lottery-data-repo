#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MODE="${2:-}"
PUSH_ENABLED="1"
if [[ "$MODE" == "--no-push" ]]; then
  PUSH_ENABLED="0"
fi
LOG_FILE="${LOTTERY_UPDATE_LOG:-$REPO_DIR/update.log}"
LOCK_DIR="${LOTTERY_UPDATE_LOCK:-/tmp/lottery-data-update.lock}"

if [[ -z "${JISU_APPKEY:-}" ]]; then
  echo "Missing JISU_APPKEY" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")"
exec >> "$LOG_FILE" 2>&1

cd "$REPO_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date '+%F %T')] Another update is already running; skip."
  exit 0
fi

cleanup() {
  rm -rf "$LOCK_DIR"
}

notify_failure() {
  local message="$1"
  python scripts/write_health.py --fail --stage "server_update_and_push" --message "$message" || true
  python scripts/notify.py --status failure --title "开奖数据更新失败" --message "$message" || true
}

notify_success() {
  local message="$1"
  if [[ "${LOTTERY_NOTIFY_ON_SUCCESS:-0}" == "1" ]]; then
    python scripts/notify.py --status success --title "开奖数据更新成功" --message "$message" || true
  fi
}

on_error() {
  local line="$1"
  local command="$2"
  local message="line $line failed: $command"
  echo "[$(date '+%F %T')] ERROR: $message"
  notify_failure "$message"
}

trap cleanup EXIT
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

echo "[$(date '+%F %T')] Start lottery public data update."

if [[ "$PUSH_ENABLED" == "1" ]]; then
  git pull --rebase --autostash
fi

python scripts/update_public_data.py
python scripts/validate_public_data.py

if [[ "$PUSH_ENABLED" == "1" ]]; then
  git add public_data
  if git diff --cached --quiet; then
    echo "[$(date '+%F %T')] No public data changes to commit."
    notify_success "无新变化，数据已校验。"
  else
    git commit -m "Update lottery public data"
    git push
    notify_success "已更新并推送到 GitHub。"
  fi
else
  echo "[$(date '+%F %T')] Push disabled; local update only."
  notify_success "本地更新完成，未推送。"
fi

echo "[$(date '+%F %T')] Lottery public data update finished."
