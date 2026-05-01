[README.md](https://github.com/user-attachments/files/27269242/README.md)
# lottery-data-repo

公共彩票开奖数据仓库。这个仓库只保存公开开奖数据，供 lotto-Agent 或其他客户端读取。

本仓库不保存任何用户私有数据，包括：

- 用户选号记录
- 投入成本
- 兑奖结果
- OpenClaw 用户 ID
- API key

## 数据目录

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

文件说明：

- `latest.json`：每个彩种最新一期，客户端默认优先读取。
- `draws/{lottery_type}.json`：单个彩种最近 50 期。
- `by-year/{lottery_type}/{year}.json`：按年份归档的长期历史。
- `calendar.json`：开奖日历，以及 API 返回的下一期期号、开奖时间、截止购买时间。
- `health.json`：最近一次自动更新状态。
- `index.json`：公共数据索引和 schema 信息。

## 支持彩种

- 双色球 `ssq`
- 福彩3D `fc3d`
- 七乐彩 `qlc`
- 大乐透 `dlt`
- 体彩七星彩 `qxc`
- 排列三 `pl3`
- 排列五 `pl5`
- 快乐8 `kl8`

## 自动更新

本仓库使用 GitHub Actions 自动抓取开奖数据并写回仓库。

定时任务为北京时间：

```text
19:46
20:06
21:26
02:36
```

GitHub cron 使用 UTC，因此 workflow 中对应为：

```text
11:46 UTC
12:06 UTC
13:26 UTC
18:36 UTC
```

自动更新 workflow：

```text
.github/workflows/update-lottery-data.yml
```

## 配置 GitHub Secret

在仓库中配置：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

新增：

```text
Name: JISU_APPKEY
Value: 你的极速数据 appkey
```

不要把 appkey 写进仓库文件。

## 手动运行

在 GitHub 页面：

```text
Actions -> Update lottery public data -> Run workflow
```

也可以本地运行：

```bash
export JISU_APPKEY="your_appkey"
python scripts/update_public_data.py
python scripts/validate_public_data.py
```

## 公共读取地址

如果仓库地址是：

```text
https://github.com/wenjinliuu/lottery-data-repo
```

公共数据 base URL 为：

```text
https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data
```

常用文件：

```text
https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/latest.json
https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/calendar.json
https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/health.json
https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/draws/dlt.json
```

lotto-Agent 可配置：

```bash
export LOTTERY_PUBLIC_DATA_BASE_URL="https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data"
```

## 数据来源

更新脚本调用极速数据接口：

```text
https://api.jisuapi.com/caipiao/query
https://api.jisuapi.com/caipiao/class
```

每期开奖会保留：

- 标准化字段
- 结构化开奖号码
- 奖池、销售额
- 奖项明细、中奖注数、单注奖金、追加奖金
- 下一期期号、下期开奖时间、截止购买时间
- 清洗后的 `raw_public_json`

真实 API key 会在写入前替换为 `***`。

详细字段见：

```text
docs/DATA_SCHEMA.md
```
