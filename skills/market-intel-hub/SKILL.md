---
name: market-intel-hub
description: Orchestrate a local capital-markets intelligence pipeline in OpenClaw. Use when combining RSS intake, Playwright scraping, finance data skills, and OpenClaw memory into one daily Chinese briefing workflow.
metadata: { "openclaw": { "emoji": "🧠", "requires": { "bins": ["node"] } } }
---

# market-intel-hub

Use this skill when you want one repeatable market-intel workflow instead of ad hoc feed reading.

## Installed companion skills

This workspace now includes these community skills:

- `rss-aggregator`
- `playwright-scraper-skill`
- `tushare-finance`

Use them as source adapters. This skill is the orchestration layer.

## What this skill does

1. Pull RSS/Atom feeds into a normalized bundle.
2. Optionally merge supplement items produced by scraping or finance-data tools.
3. Write event cards and daily digest seeds into `memory/market-intel/`.
4. Render a deterministic Chinese brief from the bundle before any optional LLM refinement.
5. Ask OpenClaw to use `memory_search` over those files only when extra historical context is needed.

## Files

- `scripts/pipeline.mjs`: deterministic ingest + memory writer.
- `scripts/render-brief.mjs`: deterministic Chinese brief renderer from the normalized bundle.
- `scripts/fetch-tushare-supplements.py`: optional structured China-market supplement generator.
- `assets/feeds.example.json`: sample feed config.
- `assets/supplements.example.json`: schema for scraped or structured-data supplements.
- `assets/memory-config.example.json`: minimal OpenClaw memory config snippet.
- `references/workflow.md`: exact agent workflow and prompt.

## Quick start

1. Copy and edit the feed config.

```bash
cp skills/market-intel-hub/assets/feeds.example.json /tmp/market-intel-feeds.json
```

2. Optionally prepare supplements from scraper / finance skills.

```bash
cp skills/market-intel-hub/assets/supplements.example.json /tmp/market-intel-supplements.json
```

3. Run the pipeline.

```bash
node skills/market-intel-hub/scripts/pipeline.mjs \
  --config /tmp/market-intel-feeds.json \
  --supplements /tmp/market-intel-supplements.json \
  --memory-dir memory/market-intel \
  --bundle-file /tmp/market-intel-bundle.json \
  --brief-file /tmp/market-intel-brief.md \
  --since-hours 24 \
  --limit 200
```

4. Ask OpenClaw to read `references/workflow.md`, inspect `/tmp/market-intel-bundle.json`, and produce the final Chinese daily brief.

Or run the default deterministic path directly:

```bash
node skills/market-intel-hub/scripts/render-brief.mjs \
  --bundle /tmp/market-intel-bundle.json \
  --out /tmp/market-intel-final.md
```

If you have a local Tushare token and proxy config, refresh China-market supplements first:

```bash
python3 skills/market-intel-hub/scripts/fetch-tushare-supplements.py \
  --config market-intel/tushare.local.json \
  --out market-intel/supplements.json
```

## When to call companion skills

- Use `rss-aggregator` when you want broad RSS coverage and incremental source handling.
- Use `playwright-scraper-skill` for non-RSS pages, JavaScript-heavy sites, or anti-bot pages.
- Use `tushare-finance` for China market structure, macro, bond, index, and company-event data.

## Output contract

The pipeline writes:

- `memory/market-intel/events/YYYY-MM-DD/*.md`
- `memory/market-intel/daily/YYYY-MM-DD.md`
- optional bundle JSON and draft brief files

OpenClaw memory can index those files and retrieve them later through `memory_search`.

## Important guardrails

- Treat RSS as the intake backbone, not full market coverage.
- Use supplements for critical sites without feeds.
- Prefer official or exchange sources over media rewrites.
- Do not use generic web search in the default daily run.
- Do not send facts that are absent from the local bundle, supplements, or memory results.
