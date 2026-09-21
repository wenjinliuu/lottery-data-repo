# V2 数据契约

所有公共响应使用 version: 2，时间语义按 Asia/Shanghai。

## bootstrap

字段：schema、version、generated_at、timezone、latest、schedule。

latest.<type> 是单条 V2 开奖；schedule.<type> 包含 weekdays、draw_time、sale_close_time 和 next。

latest.<type>.time 允许省略。常规开奖时刻读取 schedule.<type>.draw_time。

## 开奖对象

字段：

- issue：期号字符串。
- date：开奖日期。
- time：可选开奖时刻。
- numbers：按彩种变化的号码对象。
- pool、sales：可选金额字符串。
- prizes：奖级数组。
- fetched_at：可选抓取时间。

奖级字段为 name、match、winners、amount、extra_winners、extra_amount。

空值可能省略。winners: 0 表示接口明确返回零注；字段缺失表示该奖级尚未完整返回，二者不能混为一谈。

## 最近 30 期

- schema：duigehao.lottery.recent
- version：2
- lottery_type
- generated_at
- limit：30
- draws

## 按年历史

- schema：duigehao.lottery.year
- version：2
- lottery_type
- year：JSON 数字
- earliest_year：JSON 数字
- generated_at
- draws

## 年度日历

- schema：duigehao.lottery.calendar
- version：2
- year：JSON 数字
- generated_at
- entries：扁平数组

每条日历记录包含 lottery_type、issue、date、draw_time、sale_close_time。日历没有 weekday；两个时间字段只有时刻，客户端比较前必须与 date 按北京时间组合。

## health

字段为 schema、version、ok、generated_at、source、latest。schema 固定为 duigehao.lottery.health，source 固定为 cloudbase_postgresql。

health 只存在于 CloudBase，不生成 GitHub文件。
