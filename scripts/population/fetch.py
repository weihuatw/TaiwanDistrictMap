#!/usr/bin/env python3
"""Fetch one pinned monthly village population CSV from the MOI open-data API."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILE = ROOT / "data/population/sources.json"
RAW_DIR = ROOT / "data/raw/population"
CATALOG_URL = "https://data.gov.tw/dataset/77132"
API_TEMPLATE = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{month}"
AGE_COLUMNS = {f"{age}歲-{sex}" for age in range(100) for sex in ("男", "女")} | {f"100歲以上-{sex}" for sex in ("男", "女")}
REQUIRED_COLUMNS = {"統計年月", "區域別代碼", "區域別", "村里", "戶數", "人口數", "人口數-男", "人口數-女"} | AGE_COLUMNS


def validate_csv(payload: bytes, month: str) -> None:
    try:
        reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig", errors="strict")))
        if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
            raise ValueError("下載內容缺少戶政司村里人口 CSV 欄位")
        first = next(reader, None)
        if first is None or first.get("統計年月", "").strip() != month:
            raise ValueError(f"下載內容不是 {month} 統計年月")
    except UnicodeDecodeError as error:
        raise ValueError("官方資料不是預期的 UTF-8 CSV") from error


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("month", help="民國年月，例如 11508")
    args = parser.parse_args()
    month = args.month.strip()
    if not re.fullmatch(r"\d{5}", month) or not 1 <= int(month[-2:]) <= 12:
        parser.error("年月須為民國五碼格式，例如 11508")

    url = API_TEMPLATE.format(month=month)
    request = urllib.request.Request(url, headers={"User-Agent": "TaiwanDistrictMap/1.0", "Accept": "text/csv,application/octet-stream,*/*"})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read()
        if response.status != 200:
            raise RuntimeError(f"戶政司 API 回傳 HTTP {response.status}")
    validate_csv(payload, month)

    digest = hashlib.sha256(payload).hexdigest()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    destination = RAW_DIR / f"{month}.csv"
    temporary = destination.with_suffix(".download.csv")
    temporary.write_bytes(payload)
    temporary.replace(destination)

    SOURCE_FILE.parent.mkdir(parents=True, exist_ok=True)
    sources = json.loads(SOURCE_FILE.read_text(encoding="utf-8")) if SOURCE_FILE.exists() else {"schemaVersion": 1, "months": []}
    record = {
        "month": month,
        "period": f"{int(month[:3]) + 1911}-{month[3:]}",
        "catalogUrl": CATALOG_URL,
        "downloadUrl": url,
        "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": digest,
    }
    months = {item["month"]: item for item in sources.get("months", [])}
    months[month] = record
    sources = {"schemaVersion": 1, "months": [months[key] for key in sorted(months)]}
    SOURCE_FILE.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved official population CSV for {month} ({len(payload):,} bytes, SHA-256 {digest}).")


if __name__ == "__main__":
    main()
