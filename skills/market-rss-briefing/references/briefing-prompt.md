# Market RSS Briefing Prompt

Use this reference after `scripts/collect.mjs` has generated the normalized feed bundle.

## Required extraction fields

For each candidate item, extract at least:

- time
- source
- title
- url
- assetClass: A-share / Hong Kong / US / bonds / FX / commodities / macro
- eventType: policy / earnings / guidance / rating / liquidity / geopolitics / supply-chain
- impactDirection: bullish / bearish / neutral / unconfirmed
- impactHorizon: pre-market / intraday / one-week / one-month / medium-term
- affectedTargets: index / sector / company / style factor
- confidence: official / media / second-hand

## Dedupe rules

Treat items as duplicates when any of these hold:

1. Same canonical URL.
2. Same normalized title after removing ticker noise, UTM params, and duplicate whitespace.
3. Same source + same title within a short time window, even if GUID differs.

Prefer to keep the record that has:

1. Official source over media.
2. Newer publish time.
3. Longer summary/body snippet.

## Tagging buckets

Map each final item into one primary bucket:

- `macro`
- `policy`
- `rates`
- `stocks-bonds`
- `commodities`
- `company-events`

Secondary tags are allowed, but keep exactly one primary bucket.

## Daily output format

Write the final brief in Chinese with this structure:

```md
# 今日资本市场简报

## 1. 宏观/政策

- 发生了什么
- 为什么重要
- 影响的资产与逻辑

## 2. 利率/流动性

- 发生了什么
- 对估值、风险偏好、久期资产的含义

## 3. 股债市场

- 受影响的板块、风格、信用风险或发行面变化

## 4. 商品/外汇

- 价格驱动、供需变化、跨资产联动

## 5. 重点公司/产业链

- 公司事件
- 产业链传导
- 潜在交易含义

## 6. 继续跟踪的问题

- 尚未证实的判断
- 需要补充验证的数据点
```

## Prompt template

```text
你是资本市场研究助理。请基于归一化后的 RSS 数据包生成中文简报。

要求：
1. 只保留今天最重要的 5-10 条。
2. 每条都要说明“为什么重要”，不能只复述标题。
3. 先使用官方源，其次是高质量媒体源。
4. 如果同一事件出现多条，请合并，不要重复。
5. 对每条事件给出：资产类别、事件类型、影响方向、影响期限、影响对象、置信度。
6. 最后列出仍需继续跟踪的问题。

输出格式：严格按《今日资本市场简报》模板。
```
