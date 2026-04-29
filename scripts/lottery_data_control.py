from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def status_text() -> str:
    health = load_json(ROOT / "public_data" / "health.json", {})
    latest = load_json(ROOT / "public_data" / "latest.json", {})
    results = health.get("results") or []
    latest_draws = latest.get("draws") or {}
    lines = [
        "开奖数据仓库状态",
        f"状态：{'成功' if health.get('ok') else '异常'}",
        f"更新时间：{health.get('updated_at') or '-'}",
        f"消息：{health.get('message') or '-'}",
        f"最近更新彩种：{len(results) or len(latest_draws)}",
    ]
    if latest_draws:
        preview = []
        for lottery_type, draw in latest_draws.items():
            preview.append(f"{lottery_type}:{draw.get('issue', '-')}")
        lines.append("最新期号：" + "，".join(preview))
    return "\n".join(lines)


def run_update(repo_dir: Path, push: bool = True) -> int:
    script = repo_dir / "scripts" / "server_update_and_push.sh"
    command = ["bash", str(script), str(repo_dir)]
    if not push:
        command.append("--no-push")
    completed = subprocess.run(command, cwd=repo_dir, text=True, check=False)
    return completed.returncode


def main() -> None:
    parser = argparse.ArgumentParser(description="Lobster/OpenClaw control helper for lottery public data.")
    parser.add_argument("action", choices=["status", "update"])
    parser.add_argument("--repo-dir", type=Path, default=ROOT)
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args()
    if args.action == "status":
        print(status_text())
        return
    code = run_update(args.repo_dir, push=not args.no_push)
    if code == 0:
        print("开奖数据更新任务已完成。")
    else:
        print(f"开奖数据更新任务失败，退出码：{code}")
    raise SystemExit(code)


if __name__ == "__main__":
    main()
