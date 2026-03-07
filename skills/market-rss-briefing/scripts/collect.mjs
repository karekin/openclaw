#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { XMLParser } from "fast-xml-parser";

const DEFAULT_BUCKETS = [
  "macro",
  "policy",
  "rates",
  "stocks-bonds",
  "commodities",
  "company-events",
];

const BUCKET_KEYWORDS = {
  macro: [
    "gdp",
    "cpi",
    "ppi",
    "payroll",
    "inflation",
    "employment",
    "growth",
    "pmi",
    "trade balance",
    "retail sales",
    "宏观",
    "经济",
    "通胀",
    "就业",
    "增长",
  ],
  policy: [
    "ministry",
    "regulator",
    "sec",
    "policy",
    "regulation",
    "guidance",
    "consultation",
    "政策",
    "监管",
    "规则",
    "征求意见",
  ],
  rates: [
    "fomc",
    "federal reserve",
    "ecb",
    "yield",
    "rate",
    "rates",
    "treasury",
    "bond auction",
    "liquidity",
    "央行",
    "利率",
    "国债",
    "收益率",
    "流动性",
  ],
  "stocks-bonds": [
    "equity",
    "stock",
    "stocks",
    "bond",
    "bonds",
    "credit",
    "issuance",
    "index",
    "sector",
    "shares",
    "股市",
    "债券",
    "信用",
    "指数",
    "板块",
  ],
  commodities: [
    "oil",
    "crude",
    "gas",
    "gold",
    "copper",
    "iron ore",
    "commodity",
    "commodities",
    "shipping",
    "原油",
    "黄金",
    "铜",
    "铁矿",
    "商品",
    "航运",
  ],
  "company-events": [
    "earnings",
    "guidance",
    "merger",
    "acquisition",
    "buyback",
    "listing",
    "ipo",
    "dividend",
    "profit warning",
    "财报",
    "指引",
    "收购",
    "并购",
    "回购",
    "上市",
    "分红",
  ],
};

const ASSET_KEYWORDS = {
  macro: ["macro"],
  rates: ["rates", "bonds"],
  policy: ["equities", "bonds", "macro"],
  "stocks-bonds": ["equities", "bonds"],
  commodities: ["commodities", "fx"],
  "company-events": ["equities"],
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
});

const DEFAULT_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; OpenClaw-Market-Intel/1.0; +https://openclaw.ai)",
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

function printUsage() {
  console.error(
    [
      "Usage:",
      "  node skills/market-rss-briefing/scripts/collect.mjs --config <feeds.json> [--out <bundle.json>] [--markdown <brief.md>] [--since-hours <hours>] [--limit <count>]",
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

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => [key.toLowerCase(), value.trim()]),
  );
}

function buildFeedHeaders(feed) {
  const customHeaders = normalizeHeaders(feed.headers);
  const headers = {
    ...DEFAULT_HEADERS,
    ...customHeaders,
  };

  try {
    const hostname = new URL(feed.url).hostname;
    if (hostname === "www.sec.gov" || hostname.endsWith(".sec.gov")) {
      if (!customHeaders["user-agent"]) {
        headers["user-agent"] = "OpenClaw Market Intel local@example.invalid";
      }
      if (!customHeaders.referer) {
        headers.referer = "https://www.sec.gov/";
      }
    }
  } catch {
    return headers;
  }

  return headers;
}

function pickFirstString(...values) {
  for (const value of values) {
    const text = extractText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function extractText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (typeof value["#text"] === "string") {
    return value["#text"].trim();
  }
  if (typeof value["@_href"] === "string") {
    return value["@_href"].trim();
  }
  return "";
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function stripHtml(text) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl);
    const paramsToDrop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
    ];
    for (const key of paramsToDrop) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function scoreSourceType(sourceType) {
  switch (sourceType) {
    case "official":
      return 3;
    case "media":
      return 2;
    default:
      return 1;
  }
}

function choosePrimaryBucket(feed, text) {
  if (feed.bucket && DEFAULT_BUCKETS.includes(feed.bucket)) {
    return feed.bucket;
  }
  const haystack = text.toLowerCase();
  let bestBucket = "macro";
  let bestScore = -1;
  for (const bucket of DEFAULT_BUCKETS) {
    const score = BUCKET_KEYWORDS[bucket].reduce(
      (count, keyword) => count + (haystack.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestBucket = bucket;
      bestScore = score;
    }
  }
  return bestBucket;
}

function inferAssetClasses(feed, bucket, text) {
  const configured = ensureArray(feed.assetClasses).map((item) => String(item));
  if (configured.length > 0) {
    return configured;
  }
  const haystack = text.toLowerCase();
  const assetClasses = new Set(ASSET_KEYWORDS[bucket] ?? ["macro"]);
  if (
    haystack.includes("fx") ||
    haystack.includes("foreign exchange") ||
    haystack.includes("汇率")
  ) {
    assetClasses.add("fx");
  }
  if (haystack.includes("commodity") || haystack.includes("原油") || haystack.includes("黄金")) {
    assetClasses.add("commodities");
  }
  return [...assetClasses];
}

function summarizeSnippet(...values) {
  const raw = pickFirstString(...values);
  if (!raw) {
    return "";
  }
  const cleaned = stripHtml(raw);
  return cleaned.slice(0, 320);
}

function normalizeRssItem(item, feed) {
  const link = canonicalizeUrl(pickFirstString(item.link, item.guid));
  const title = pickFirstString(item.title);
  const snippet = summarizeSnippet(item.description, item["content:encoded"], item.content);
  const publishedAt = toIsoDate(
    pickFirstString(item.pubDate, item.published, item.updated, item.dcDate, item["dc:date"]),
  );
  return {
    title,
    url: link,
    summary: snippet,
    publishedAt,
    rawCategories: ensureArray(item.category).map((entry) => pickFirstString(entry)),
    externalId: pickFirstString(item.guid),
    author: pickFirstString(item.author, item["dc:creator"]),
  };
}

function normalizeAtomLink(linkValue) {
  const links = ensureArray(linkValue);
  for (const candidate of links) {
    if (candidate && typeof candidate === "object") {
      const rel = candidate["@_rel"];
      if (!rel || rel === "alternate") {
        const href = pickFirstString(candidate["@_href"], candidate.href);
        if (href) {
          return canonicalizeUrl(href);
        }
      }
    }
  }
  return canonicalizeUrl(pickFirstString(linkValue));
}

function normalizeAtomItem(entry, feed) {
  const link = normalizeAtomLink(entry.link);
  const title = pickFirstString(entry.title);
  const snippet = summarizeSnippet(entry.summary, entry.content, entry.subtitle);
  const publishedAt = toIsoDate(pickFirstString(entry.published, entry.updated, entry.issued));
  return {
    title,
    url: link,
    summary: snippet,
    publishedAt,
    rawCategories: ensureArray(entry.category).map((item) =>
      pickFirstString(item?.["@_term"], item?.term, item),
    ),
    externalId: pickFirstString(entry.id),
    author: pickFirstString(entry.author?.name, entry.author),
  };
}

function parseFeedItems(xmlText, feed) {
  const document = parser.parse(xmlText);
  if (document?.rss?.channel) {
    const channel = document.rss.channel;
    return ensureArray(channel.item).map((item) => ({
      sourceTitle: pickFirstString(channel.title, feed.name),
      ...normalizeRssItem(item, feed),
    }));
  }
  if (document?.feed) {
    const atomFeed = document.feed;
    return ensureArray(atomFeed.entry).map((entry) => ({
      sourceTitle: pickFirstString(atomFeed.title, feed.name),
      ...normalizeAtomItem(entry, feed),
    }));
  }
  throw new Error(`Unsupported feed format for ${feed.name}`);
}

function buildRecord(feed, item) {
  const text = [item.title, item.summary, ...item.rawCategories].filter(Boolean).join(" ");
  const bucket = choosePrimaryBucket(feed, text);
  const normalizedTitle = normalizeTitle(item.title);
  const canonicalUrl = canonicalizeUrl(item.url);
  const fingerprint = sha256(`${normalizedTitle}|${canonicalUrl || item.externalId || ""}`);
  const keywordHits = BUCKET_KEYWORDS[bucket].filter((keyword) =>
    text.toLowerCase().includes(keyword),
  );
  const minimumKeywordHits = Number(feed.minimumKeywordHits ?? 0);
  if (keywordHits.length < minimumKeywordHits) {
    return null;
  }
  const score =
    scoreSourceType(feed.sourceType) * 10 +
    Number(feed.priority ?? 0) * 2 +
    keywordHits.length +
    (item.summary ? 1 : 0);

  return {
    id: fingerprint.slice(0, 16),
    fingerprint,
    title: item.title,
    url: canonicalUrl,
    source: feed.name,
    sourceTitle: item.sourceTitle,
    sourceType: feed.sourceType ?? "media",
    bucket,
    assetClasses: inferAssetClasses(feed, bucket, text),
    eventTypes: ensureArray(feed.eventTypes).map((itemValue) => String(itemValue)),
    summary: item.summary,
    publishedAt: item.publishedAt,
    rawCategories: item.rawCategories,
    author: item.author,
    score,
    keywordHits,
  };
}

function dedupeRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const identity = record.url || `${record.source}|${normalizeTitle(record.title)}`;
    const existing = byKey.get(identity);
    if (!existing) {
      byKey.set(identity, record);
      continue;
    }
    const existingTime = existing.publishedAt ? Date.parse(existing.publishedAt) : 0;
    const nextTime = record.publishedAt ? Date.parse(record.publishedAt) : 0;
    const nextWins =
      record.sourceType === "official" && existing.sourceType !== "official"
        ? true
        : record.sourceType === existing.sourceType
          ? nextTime >= existingTime || record.summary.length > existing.summary.length
          : false;
    if (nextWins) {
      byKey.set(identity, record);
    }
  }
  return [...byKey.values()];
}

export function buildMarkdown(bundle) {
  const lines = [
    "# Capital Markets RSS Intake",
    "",
    `Generated: ${bundle.generatedAt}`,
    `Window hours: ${bundle.windowHours}`,
    `Items: ${bundle.items.length}`,
    "",
  ];

  for (const bucket of DEFAULT_BUCKETS) {
    const items = bundle.groups[bucket] ?? [];
    lines.push(`## ${bucket}`);
    if (items.length === 0) {
      lines.push("- No items");
      lines.push("");
      continue;
    }
    for (const item of items) {
      const published = item.publishedAt ?? "unknown-time";
      const tags = [item.sourceType, ...item.assetClasses].join(", ");
      lines.push(`- ${published} | ${item.title}`);
      lines.push(`  source: ${item.source}`);
      lines.push(`  tags: ${tags}`);
      if (item.url) {
        lines.push(`  url: ${item.url}`);
      }
      if (item.summary) {
        lines.push(`  summary: ${item.summary}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function writeMaybe(filePath, content) {
  if (!filePath) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

export async function collectFeeds(config, args) {
  const now = Date.now();
  const windowHours = Number(args["since-hours"] ?? config.windowHours ?? 24);
  const cutoff = now - windowHours * 60 * 60 * 1000;
  const limit = Number(args.limit ?? 200);
  const feedEntries = ensureArray(config.feeds);

  const settled = await Promise.allSettled(
    feedEntries.map(async (feed) => {
      const response = await fetch(feed.url, {
        headers: buildFeedHeaders(feed),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const xmlText = await response.text();
      return parseFeedItems(xmlText, feed)
        .map((item) => buildRecord(feed, item))
        .filter(Boolean);
    }),
  );

  const items = [];
  const errors = [];
  settled.forEach((result, index) => {
    const feed = feedEntries[index];
    if (result.status === "fulfilled") {
      items.push(...result.value);
      return;
    }
    errors.push({
      source: feed.name,
      url: feed.url,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  const freshItems = items.filter((item) => {
    if (!item.publishedAt) {
      return true;
    }
    return Date.parse(item.publishedAt) >= cutoff;
  });

  const deduped = dedupeRecords(freshItems)
    .sort((left, right) => {
      const timeRight = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      const timeLeft = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      if (timeRight !== timeLeft) {
        return timeRight - timeLeft;
      }
      return right.score - left.score;
    })
    .slice(0, limit);

  const groups = Object.fromEntries(DEFAULT_BUCKETS.map((bucket) => [bucket, []]));
  for (const item of deduped) {
    groups[item.bucket].push(item);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    windowHours,
    itemCount: deduped.length,
    errorCount: errors.length,
    errors,
    groups,
    items: deduped,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config || args.help) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const config = JSON.parse(await readFile(args.config, "utf8"));
  const bundle = await collectFeeds(config, args);
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  const markdown = buildMarkdown(bundle);

  await writeMaybe(args.out, json);
  await writeMaybe(args.markdown, markdown);

  if (!args.out) {
    process.stdout.write(json);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
