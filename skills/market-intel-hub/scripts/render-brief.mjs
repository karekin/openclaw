#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const SECTION_DEFS = [
  { title: "宏观/政策", buckets: ["macro", "policy"], perBucketLimit: 2 },
  { title: "利率/流动性", buckets: ["rates"], perBucketLimit: 3 },
  { title: "股债市场", buckets: ["stocks-bonds"], perBucketLimit: 5 },
  { title: "商品/外汇", buckets: ["commodities"], perBucketLimit: 3 },
  { title: "重点公司/产业链", buckets: ["company-events"], perBucketLimit: 3 },
];

const ASSET_LABELS = {
  macro: "宏观",
  rates: "利率",
  bonds: "债券",
  equities: "权益",
  fx: "外汇",
  commodities: "商品",
};

const CONFIDENCE_LABELS = {
  official: "高（官方源）",
  media: "中（媒体源）",
  manual: "中（补充录入）",
};

function printUsage() {
  console.error(
    "Usage: node skills/market-intel-hub/scripts/render-brief.mjs --bundle <bundle.json> [--out <brief.md>] [--tz <tz>]",
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

function sortItems(items) {
  return [...items].sort((left, right) => {
    const leftScore = Number(left.score ?? 0);
    const rightScore = Number(right.score ?? 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return String(left.title ?? "").localeCompare(String(right.title ?? ""), "zh-CN");
  });
}

function pickSectionItems(bundle, section) {
  if (section.title === "股债市场") {
    const bucketItems = sortItems(bundle.groups?.["stocks-bonds"] ?? []);
    const tushareItems = bucketItems
      .filter((item) => item.source === "Tushare Finance")
      .slice(0, 2);
    const otherItems = bucketItems
      .filter((item) => item.source !== "Tushare Finance")
      .slice(0, Math.max(section.perBucketLimit - tushareItems.length, 0));
    return sortItems([...tushareItems, ...otherItems]).slice(0, section.perBucketLimit);
  }

  const selected = [];
  for (const bucket of section.buckets) {
    const items = sortItems(bundle.groups?.[bucket] ?? []).slice(0, section.perBucketLimit);
    selected.push(...items);
  }
  return sortItems(selected);
}

function formatDate(isoDate, tz) {
  if (!isoDate) {
    return "时间未知";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeSummary(text) {
  if (!text) {
    return "标题未附摘要，需阅读全文确认具体表述。";
  }
  return text.replace(/\s+/g, " ").trim();
}

function inferImportance(item) {
  switch (item.bucket) {
    case "macro":
      return "这是宏观层面的新增线索，可能影响增长、通胀或风险偏好的主线判断。";
    case "policy":
      return "这是政策或监管口径变化，可能直接影响相关板块估值与交易预期。";
    case "rates":
      return "这类央行/利率/支付体系信息，通常会影响利率路径、汇率和风险偏好。";
    case "stocks-bonds":
      return "这类股债市场事件更接近盘面和风格切换，适合跟踪对指数与行业的传导。";
    case "commodities":
      return "这类商品和汇率线索会影响通胀预期、上游周期品以及跨资产定价。";
    case "company-events":
      return "这类公司与产业链事件更可能形成个股催化或行业分化。";
    default:
      return "这是一条值得继续跟踪的市场线索。";
  }
}

function formatAssets(item) {
  const assets = (item.assetClasses ?? [])
    .map((asset) => ASSET_LABELS[asset] ?? asset)
    .filter(Boolean);
  if (assets.length === 0) {
    return "待研判";
  }
  return [...new Set(assets)].join("、");
}

function formatConfidence(item) {
  return CONFIDENCE_LABELS[item.sourceType] ?? `中（${item.sourceType ?? "未知"}）`;
}

function renderItem(item, tz) {
  const lines = [
    `- ${item.title}`,
    `  - 来源：${item.source}｜${formatDate(item.publishedAt, tz)}｜${formatConfidence(item)}`,
    `  - 发生了什么：${normalizeSummary(item.summary)}`,
    `  - 为什么重要：${inferImportance(item)}`,
    `  - 影响对象：${formatAssets(item)}`,
  ];
  if (item.url) {
    lines.push(`  - 链接：${item.url}`);
  }
  return lines;
}

function buildFollowUps(bundle) {
  const lines = [];
  if (bundle.itemCount < 5) {
    lines.push(
      `- 当前 24 小时内仅入库 ${bundle.itemCount} 条高优先级条目，覆盖偏窄；建议补充 scraper 或金融数据 supplements。`,
    );
  }
  if (bundle.supplementCount === 0) {
    lines.push("- 本次未启用非 RSS supplements，A股/港股/美股盘面级事件覆盖仍偏弱。");
  }
  for (const error of bundle.errors ?? []) {
    lines.push(`- 采集失败待排查：${error.source}（${error.error}）`);
  }
  if (lines.length === 0) {
    lines.push("- 暂无额外异常；下一次运行继续关注新事件是否形成连续叙事。");
  }
  return lines;
}

function buildBrief(bundle, tz) {
  const generatedAt = formatDate(bundle.generatedAt, tz);
  const lines = [
    "# 资本市场日报",
    "",
    `- 生成时间：${generatedAt}`,
    `- 采集窗口：近 ${bundle.windowHours} 小时`,
    `- 入库条目：${bundle.itemCount}`,
    `- 说明：以下内容仅基于本地 bundle / memory 对应的已采集条目整理，未覆盖到的市场信息不做外推。`,
    "",
  ];

  for (const section of SECTION_DEFS) {
    const items = pickSectionItems(bundle, section);
    lines.push(`## ${section.title}`);
    if (items.length === 0) {
      lines.push("- 暂无高优先级新增条目。");
      lines.push("");
      continue;
    }
    for (const item of items) {
      lines.push(...renderItem(item, tz));
    }
    lines.push("");
  }

  lines.push("## 继续跟踪的问题");
  lines.push(...buildFollowUps(bundle));
  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bundle || args.help) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const tz = String(args.tz ?? "Asia/Shanghai");
  const bundle = JSON.parse(await readFile(args.bundle, "utf8"));
  const output = buildBrief(bundle, tz);

  if (args.out) {
    await writeFile(args.out, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
