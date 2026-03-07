---
name: market-rss-briefing
description: Build a capital-markets news intake from RSS/Atom feeds. Use when aggregating market feeds, deduplicating updates, tagging them into macro/policy/rates/stocks-bonds/commodities/company-event buckets, and preparing a daily Chinese briefing for OpenClaw.
metadata: { "openclaw": { "emoji": "📈", "requires": { "bins": ["node"] } } }
---

# market-rss-briefing

Use this skill to turn RSS/Atom feeds into a daily capital-markets briefing input.

## When to use

- Build or maintain a market-news intake channel driven by RSS/Atom.
- Prepare a daily briefing grouped into: macro, policy, rates, stocks-bonds, commodities, company-events.
- Normalize feed items before sending them to an LLM for extraction, summarization, and knowledge-base storage.

## What this skill includes

- `scripts/collect.mjs`: fetches RSS/Atom feeds, normalizes items, deduplicates them, and writes JSON + Markdown.
- `assets/feeds.example.json`: starter feed config template with a small number of verified official examples and several placeholders you should replace.
- `references/briefing-prompt.md`: extraction fields, dedupe rules, and briefing prompt/template.

## Quick start

1. Copy the example config and replace the sample feed URLs with your real sources.

```bash
cp skills/market-rss-briefing/assets/feeds.example.json /tmp/market-feeds.json
```

2. Run the collector.

```bash
node skills/market-rss-briefing/scripts/collect.mjs \
  --config /tmp/market-feeds.json \
  --out /tmp/market-rss.json \
  --markdown /tmp/market-rss.md \
  --since-hours 24 \
  --limit 200
```

3. Ask OpenClaw to read `/tmp/market-rss.json` and follow `references/briefing-prompt.md`.

## Expected workflow

1. Maintain a curated feed list by source quality.
2. Run the collector on a schedule.
3. Feed the JSON or Markdown output to OpenClaw.
4. Have OpenClaw produce:
   - top 5-10 items,
   - why each item matters,
   - affected assets / sectors / companies,
   - follow-up questions for later verification.

## Scheduling with OpenClaw cron

Use an isolated cron job so the run stays self-contained and can announce the final brief:

```bash
openclaw cron add \
  --name "Capital markets RSS brief" \
  --cron "0 9 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "Use the market-rss-briefing skill in this workspace. Run the collector with the project feed config, read the generated JSON and references/briefing-prompt.md, then produce a Chinese daily capital-markets brief grouped into macro, policy, rates, stocks-bonds, commodities, and company-events. Save intermediate files under /tmp." \
  --announce
```

## Notes

- RSS is the intake layer, not full market coverage.
- Prefer official or exchange sources when possible; tag them as `official` in the config.
- Keep feed quality control outside the prompt: maintain it in the config file.
- If you need a longer-term memory layer, store the JSON output and LLM event cards separately.
