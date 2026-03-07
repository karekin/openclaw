#!/usr/bin/env python3
"""
Fetch structured China market supplements from Tushare and write them
into the market-intel supplements schema.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from datetime import datetime, timedelta

SCRIPT_DIR = Path(__file__).resolve().parent
TUSHARE_SKILL_DIR = SCRIPT_DIR.parents[1] / "tushare-finance" / "scripts"
if str(TUSHARE_SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(TUSHARE_SKILL_DIR))

from api_client import TushareAPI  # noqa: E402


INDEXES = [
    ("000001.SH", "上证综指"),
    ("399001.SZ", "深证成指"),
    ("399006.SZ", "创业板指"),
    ("000300.SH", "沪深300"),
    ("000688.SH", "科创50"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Tushare market supplements for market-intel-hub."
    )
    parser.add_argument("--config", required=True, help="Path to local tushare config JSON")
    parser.add_argument("--out", required=True, help="Supplements JSON output path")
    return parser.parse_args()


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    token = str(config.get("token", "")).strip()
    http_url = str(config.get("httpUrl", "")).strip()
    if not token:
      raise ValueError("Missing token in tushare config")
    return {"token": token, "http_url": http_url}


def latest_trade_date(api: TushareAPI) -> str:
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
    cal = api.pro.trade_cal(
        exchange="SSE",
        start_date=start_date,
        end_date=end_date,
        is_open="1",
    )
    if cal.empty:
        raise RuntimeError("No open SSE trade calendar rows returned")
    latest = str(cal.sort_values("cal_date").iloc[-1]["cal_date"])
    return latest


def build_index_item(label: str, row: dict, trade_date: str) -> dict:
    pct = float(row.get("pct_chg", 0.0))
    close = float(row.get("close", 0.0))
    amount = float(row.get("amount", 0.0))
    direction = "上涨" if pct >= 0 else "下跌"
    published_at = (
        f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}T15:00:00+08:00"
    )
    return {
        "id": f"tushare-index-{label}-{trade_date}",
        "title": f"{label}{direction}{abs(pct):.2f}%（{trade_date}）",
        "url": "",
        "source": "Tushare Finance",
        "sourceType": "manual",
        "bucket": "stocks-bonds",
        "assetClasses": ["equities"],
        "eventTypes": ["market", "index"],
        "summary": (
            f"{label}{trade_date}收于{close:.2f}点，日内{direction}{abs(pct):.2f}%，"
            f"成交额约{amount / 1000:.2f}亿元。"
        ),
        "publishedAt": published_at,
        "score": 34,
        "notes": [
            "来自 Tushare 指数日线数据",
            f"trade_date={trade_date}",
        ],
    }


def main() -> None:
    args = parse_args()
    config_path = Path(args.config).expanduser()
    out_path = Path(args.out).expanduser()
    loaded = load_config(config_path)

    api = TushareAPI(token=loaded["token"], http_url=loaded["http_url"])
    trade_date = latest_trade_date(api)

    items = []
    for ts_code, label in INDEXES:
        df = api.pro.index_daily(ts_code=ts_code, start_date=trade_date, end_date=trade_date)
        if df.empty:
            continue
        row = df.iloc[0].to_dict()
        items.append(build_index_item(label, row, trade_date))

    payload = {"items": items}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    print(
        json.dumps(
            {
                "tradeDate": trade_date,
                "itemCount": len(items),
                "output": str(out_path),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
