"""Keep the previous iOS /public_data/v2/v2/... fallback URLs readable."""
from pathlib import Path
import shutil


def sync(root):
    root = Path(root)
    # Snapshot sources before creating output. Never recurse into the alias tree.
    sources = [p for p in root.rglob("*.json") if p.relative_to(root).parts[0] != "v2"]
    alias = root / "v2"
    if alias.exists():
        shutil.rmtree(alias)
    for source in sources:
        target = alias / source.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    return len(sources)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1] / "public_data/v2"
    print(f"Synced {sync(root)} legacy fallback files.")
