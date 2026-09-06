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
├── calendar/
│   ├── closures.json
│   └── 2026.json
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
- `calendar.json`：开奖日历，以及 API 返回的下一期期号、开奖时间、截止购买时间（只覆盖下一期）。
- `calendar/{year}.json`：**整年**的「期号 ↔ 开奖日期」绑定表，由 `scripts/build_draw_calendar.py` 推演生成。客户端补录旧票或跨期选号时用这个。
- `calendar/closures.json`：休市日。国庆固定 10-01 至 10-04；春节 10 天每年由财政部在上一年 12 月公布后**手工更新这一个文件**，然后重跑生成脚本即可。
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
python scripts/build_draw_calendar.py            # 生成当年的整年期次表
python scripts/validate_public_data.py
python -m unittest discover -s tests
```

### 整年开奖日历

`calendar/{year}.json` 把一整年每个彩种的期号和开奖日期一次性推演出来。
推演规则已用 2026 年 750 期真实开奖记录**全量比对，零不符**：

1. 各彩种按 `config/lotteries.json` 里的 `draw_weekdays` 开奖（0 = 周日）。
2. 期号每年从 001 重新开始。
3. 休市日不开奖、不发期号，期号**顺延**而不是跳号。
   （反证：福彩3D 2026-04-28 的真实期号是 `2026108`，而那天是年内第 118 天，
   差的正好是春节休市的 10 天。）
4. 期号格式两系：福彩 `ssq / fc3d / qlc / kl8` 是 7 位 `YYYYNNN`；
   体彩 `dlt / qxc / pl3 / pl5` 是 5 位 `YYNNN`。

每年只需要做一件事：**春节休市日公布后改 `calendar/closures.json`，重跑脚本。**
`tests/test_draw_calendar.py` 会在 CI 里把推演结果和真实数据再比对一遍，
规则一旦对不上就直接失败。

#### 跨年操作（每年 12 月做一次）

```bash
# 1. 在 closures.json 的 years 下加一年，只有春节需要查，国庆固定 10-01 ~ 10-04
#    "2027": [
#      { "id": "spring_festival", "name": "春节", "start": "2027-…", "end": "2027-…", … },
#      { "id": "national_day",    "name": "国庆", "start": "2027-10-01", "end": "2027-10-04", … }
#    ]

# 2. 生成
python scripts/build_draw_calendar.py --year 2027

# 3. 校验（次年有真实开奖数据之后再跑一次，会自动逐期比对）
python -m unittest discover -s tests
```

漏填这一年的休市日时脚本会**直接报错退出**，不会悄悄生成一份期号全年错位的日历。

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
