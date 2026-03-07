# Market Intel Hub Workflow

Use this reference after running `scripts/pipeline.mjs`.

## Goal

Produce a Chinese capital-markets brief that combines:

- normalized RSS intake,
- supplement items from scraper or finance skills,
- prior stored event cards in `memory/market-intel/`.
- the user-facing style contract in `references/delivery-style.md`.

## Workflow

1. Run the pipeline to refresh the day’s bundle and memory files.
2. Run `scripts/render-brief.mjs` against the bundle and use that as the default daily brief.
3. If a local `tushare.local.json` config is available, run `scripts/fetch-tushare-supplements.py` first and feed its output into the pipeline.
4. If an important source has no RSS coverage:
   - use `playwright-scraper-skill`,
   - normalize the result into `supplements.example.json` shape,
   - rerun the pipeline with `--supplements`.
5. If a key item needs structured market confirmation:
   - use `tushare-finance` for China market and macro data,
   - summarize that result into supplement items or analyst notes.
6. Use `memory_search` if you need related historical context from `memory/market-intel/`.
7. Produce the final brief by following `references/delivery-style.md`.

## Default path

- Prefer the deterministic path first:
  1. `pipeline.mjs`
  2. `render-brief.mjs`
  3. treat the rendered brief as a source notebook, not the final user-facing format
- Do not use generic web search for routine daily runs.
- Do not add facts that are absent from the bundle, supplements, or memory search results.
- If coverage is thin, explicitly say coverage is thin instead of filling gaps with outside assumptions.

## Final brief requirements

- Language: Chinese
- Follow `references/delivery-style.md` exactly.
- Keep only the most important facts needed to support the four target sections.
- Every factual bullet must have a source.
- Every `现状判断` and `趋势判断` must be backed by explicit reasoning in `逻辑`.
- Do not include any system/process/tooling preface.

## Prompt template

```text
你是资本市场研究助理。请基于 market-intel-hub 生成的 bundle、memory/market-intel 中的事件卡片、render-brief 产生的数据草稿，以及必要时补充的 scraper / finance 数据，输出一份中文日报。

要求：
1. 严格遵循 references/delivery-style.md 的结构和禁用项。
2. 只保留最重要的事实和判断。
3. 相同事件必须合并。
4. 优先引用官方源和交易所/监管源。
5. 不允许引入 bundle / supplements / memory 之外的新事实。
6. 不要写任何系统说明、数据源说明、权限说明或工具说明。
```
