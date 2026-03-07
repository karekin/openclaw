#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectFeeds } from "../../market-rss-briefing/scripts/collect.mjs";

const DEFAULT_BUCKETS = [
  "macro",
  "policy",
  "rates",
  "stocks-bonds",
  "commodities",
  "company-events",
];

function printUsage() {
  console.error(
    [
      "Usage:",
      "  node skills/market-intel-hub/scripts/pipeline.mjs --config <feeds.json> [--supplements <items.json>] [--memory-dir <dir>] [--bundle-file <bundle.json>] [--brief-file <brief.md>] [--since-hours <hours>] [--limit <count>]",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function safeDateKey(isoDate) {
  if (!isoDate) {
    return new Date().toISOString().slice(0, 10);
  }
  return isoDate.slice(0, 10);
}

function normalizeSupplement(raw) {
  return {
    id: raw.id ?? slugify(`${raw.source ?? "supplement"}-${raw.title ?? "item"}`),
    title: String(raw.title ?? "").trim(),
    url: String(raw.url ?? "").trim(),
    source: String(raw.source ?? "supplement").trim(),
    sourceType: String(raw.sourceType ?? "manual").trim(),
    bucket: DEFAULT_BUCKETS.includes(raw.bucket) ? raw.bucket : "macro",
    assetClasses: ensureArray(raw.assetClasses).map((item) => String(item)),
    eventTypes: ensureArray(raw.eventTypes).map((item) => String(item)),
    summary: String(raw.summary ?? "").trim(),
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : null,
    keywordHits: ensureArray(raw.keywordHits).map((item) => String(item)),
    score: Number(raw.score ?? 25),
    notes: ensureArray(raw.notes).map((item) => String(item)),
  };
}

async function loadSupplements(filePath) {
  if (!filePath) {
    return [];
  }
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  return ensureArray(parsed.items)
    .map(normalizeSupplement)
    .filter((item) => item.title);
}

function dedupeItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.url || `${item.source}|${item.title.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || Number(item.score ?? 0) >= Number(existing.score ?? 0)) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

function sortItems(items) {
  return items.sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return Number(right.score ?? 0) - Number(left.score ?? 0);
  });
}

function rebuildGroups(items) {
  const groups = Object.fromEntries(DEFAULT_BUCKETS.map((bucket) => [bucket, []]));
  for (const item of items) {
    if (!groups[item.bucket]) {
      groups[item.bucket] = [];
    }
    groups[item.bucket].push(item);
  }
  return groups;
}

function topItemsByBucket(items, maxPerBucket = 3) {
  const picked = [];
  for (const bucket of DEFAULT_BUCKETS) {
    picked.push(...items.filter((item) => item.bucket === bucket).slice(0, maxPerBucket));
  }
  return sortItems(dedupeItems(picked));
}

function buildEventCard(item) {
  const lines = [
    `# ${item.title}`,
    "",
    `- Time: ${item.publishedAt ?? "unknown"}`,
    `- Source: ${item.source}`,
    `- Source Type: ${item.sourceType}`,
    `- Bucket: ${item.bucket}`,
    `- Asset Classes: ${item.assetClasses.join(", ") || "unknown"}`,
    `- Event Types: ${item.eventTypes.join(", ") || "unknown"}`,
    `- Score: ${item.score ?? 0}`,
  ];
  if (item.url) {
    lines.push(`- URL: ${item.url}`);
  }
  if (item.keywordHits?.length) {
    lines.push(`- Keywords: ${item.keywordHits.join(", ")}`);
  }
  lines.push("");
  lines.push("## Summary");
  lines.push(item.summary || "No summary available.");
  if (item.notes?.length) {
    lines.push("");
    lines.push("## Notes");
    for (const note of item.notes) {
      lines.push(`- ${note}`);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function buildDailyDigest(bundle, topItems) {
  const lines = [
    "# 今日资本市场简报草稿",
    "",
    `- Generated: ${bundle.generatedAt}`,
    `- Window Hours: ${bundle.windowHours}`,
    `- Total Items: ${bundle.items.length}`,
    "",
  ];

  for (const bucket of DEFAULT_BUCKETS) {
    const sectionItems = topItems.filter((item) => item.bucket === bucket);
    lines.push(`## ${bucket}`);
    if (sectionItems.length === 0) {
      lines.push("- No priority items");
      lines.push("");
      continue;
    }
    for (const item of sectionItems) {
      lines.push(`- ${item.title}`);
      lines.push(`  - why: ${item.summary || "Needs analyst synthesis."}`);
      lines.push(`  - source: ${item.source} (${item.sourceType})`);
      lines.push(`  - assets: ${item.assetClasses.join(", ") || "unknown"}`);
      if (item.url) {
        lines.push(`  - url: ${item.url}`);
      }
    }
    lines.push("");
  }

  lines.push("## follow-up");
  lines.push("- Verify items that still rely on media summaries.");
  lines.push(
    "- Add structured market confirmation with tushare-finance or scraper supplements where needed.",
  );
  return `${lines.join("\n").trim()}\n`;
}

async function writeEventCards(memoryDir, items) {
  const grouped = new Map();
  for (const item of items) {
    const dateKey = safeDateKey(item.publishedAt);
    const bucket = grouped.get(dateKey) ?? [];
    bucket.push(item);
    grouped.set(dateKey, bucket);
  }

  for (const [dateKey, dateItems] of grouped) {
    const dayDir = path.join(memoryDir, "events", dateKey);
    await rm(dayDir, { recursive: true, force: true });
    await mkdir(dayDir, { recursive: true });
    for (const item of dateItems) {
      const filename = `${item.id ?? slugify(item.title)}.md`;
      await writeFile(path.join(dayDir, filename), buildEventCard(item), "utf8");
    }
  }
}

async function writeDailyDigest(memoryDir, bundle, draft) {
  const dateKey = bundle.generatedAt.slice(0, 10);
  const dailyDir = path.join(memoryDir, "daily");
  await mkdir(dailyDir, { recursive: true });
  await writeFile(path.join(dailyDir, `${dateKey}.md`), draft, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config || args.help) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const config = JSON.parse(await readFile(args.config, "utf8"));
  const baseBundle = await collectFeeds(config, args);
  const supplements = await loadSupplements(args.supplements);
  const mergedItems = sortItems(dedupeItems([...baseBundle.items, ...supplements]));
  const groups = rebuildGroups(mergedItems);
  const bundle = {
    ...baseBundle,
    itemCount: mergedItems.length,
    supplementCount: supplements.length,
    items: mergedItems,
    groups,
  };

  const memoryDir = args["memory-dir"] ?? path.join("memory", "market-intel");
  const topItems = topItemsByBucket(mergedItems, 3).slice(0, 12);
  const draft = buildDailyDigest(bundle, topItems);

  await mkdir(memoryDir, { recursive: true });
  await writeEventCards(memoryDir, mergedItems);
  await writeDailyDigest(memoryDir, bundle, draft);

  if (args["bundle-file"]) {
    await mkdir(path.dirname(args["bundle-file"]), { recursive: true });
    await writeFile(args["bundle-file"], `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  }
  if (args["brief-file"]) {
    await mkdir(path.dirname(args["brief-file"]), { recursive: true });
    await writeFile(args["brief-file"], draft, "utf8");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: bundle.generatedAt,
        itemCount: bundle.itemCount,
        supplementCount: bundle.supplementCount,
        memoryDir,
        dailyDigest: path.join(memoryDir, "daily", `${bundle.generatedAt.slice(0, 10)}.md`),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
