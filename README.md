# Lottery Public Data

This repository stores public lottery draw data for RandomDrawAgent-compatible clients.

It is intentionally separate from any private Skill runtime. It must never contain user tickets, cost records, prize results, OpenClaw user IDs, or API keys.

## Files

```text
public_data/
├── index.json
├── latest.json
├── calendar.json
├── health.json
├── draws/
│   ├── ssq.json
│   ├── dlt.json
│   └── ...
└── by-year/
    ├── dlt/2026.json
    └── ...
```

- `latest.json`: latest draw for each lottery. Normal clients read this first.
- `draws/{lottery_type}.json`: recent 50 draws for one lottery, capped by `config/lotteries.json`.
- `by-year/{lottery_type}/{year}.json`: long-term yearly archive.
- `calendar.json`: draw calendar plus API-provided next issue and next open time.
- `health.json`: last update result.

## Update Locally

```bash
export JISU_APPKEY="your_appkey"
python scripts/update_public_data.py
python scripts/validate_public_data.py
```

## GitHub Actions

Add a repository secret:

```text
JISU_APPKEY
```

The workflow `.github/workflows/update-lottery-data.yml` runs at several times after normal draw windows and can also be started manually.

## Public Base URL

After pushing to GitHub, RandomDrawAgent clients can read:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/public_data
```

Use that as:

```bash
export LOTTERY_PUBLIC_DATA_BASE_URL="https://raw.githubusercontent.com/<owner>/<repo>/main/public_data"
```

## API Fields

The updater calls:

- `https://api.jisuapi.com/caipiao/query`
- `https://api.jisuapi.com/caipiao/class`

It preserves standardized fields and sanitized raw payloads in every draw record.

The real API key is replaced with `***` before data is written.
