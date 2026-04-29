#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [[ -z "${JISU_APPKEY:-}" ]]; then
  echo "Missing JISU_APPKEY" >&2
  exit 1
fi

cd "$REPO_DIR"
python scripts/update_public_data.py
python scripts/validate_public_data.py
git add public_data
if git diff --cached --quiet; then
  echo "No public data changes to commit."
else
  git commit -m "Update lottery public data"
  git push
fi
