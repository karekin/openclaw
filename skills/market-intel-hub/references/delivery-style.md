# Daily Delivery Style

Use this style for the user-facing capital-markets brief delivered to chat.

## Scope

Always focus on these four sections, in this order:

1. `A股板块轮动`
2. `港股科技公司`
3. `美股 VOO / QQQ`
4. `国内可转债`

## Required structure

For each section, use exactly these four subheads:

- `消息与出处`
- `现状判断`
- `逻辑`
- `趋势判断`

## Writing rules

- Start directly with the title and section 1. No preface.
- Use concise Chinese for investment research readers.
- Under `消息与出处`, every factual item must include a source line.
- Source lines should use:
  - official / media pages: `出处：<source>` plus URL on the next line
  - Tushare-derived data: `出处：Tushare <interface>` plus trade date
- Under `现状判断`, state the current market condition in 1-2 bullets.
- Under `逻辑`, explain the reasoning behind the judgment in 2-4 bullets.
- Under `趋势判断`, give a directional view for the next 1-4 weeks in 1-2 bullets.
- Keep the tone analytical, not conversational.

## Forbidden content

Do not include any of the following unless the user explicitly asks for system details:

- `先说结论`
- explanations about pipeline, workflow, memory, RSS, or prompt execution
- explanations about which tools or skills were or were not used
- configuration or permission notes such as `hk_daily 权限不足`
- operational notes such as `覆盖偏弱`, `未启用`, `本地 bundle`, `memory_search`
- any mention of `finnhub`

## Fallback behavior

- If one section lacks enough high-confidence fresh items, still keep the section.
- In that case, say there is no new high-confidence catalyst, and only write conclusions supported by the available local sources.
