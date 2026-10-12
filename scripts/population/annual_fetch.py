#!/usr/bin/env python3
"""Fetch a complete registered-birth/death year and both year-end populations."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import time
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/population/annual"
SOURCES = ROOT / "data/population/annual-sources.json"
API = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore"
DENSITY_RESOURCE_IDS = {
    2020: "F6DC3228-CA65-4F0C-A2B1-39D18D6D29DA",
    2021: "C45AD94C-ED23-4381-8F3E-359CD5C276F0",
    2022: "CA18EE06-4A50-4861-9D97-7853353D7108",
    2023: "D162B6E0-77BB-4E1F-99A6-E3F44A0503BF",
    2024: "9DDF0127-95EE-484E-A439-F98E2C30CA0F",
    2025: "B7938B44-1E42-4ED2-A980-31629877B152",
}
DENSITY_DATASET = "D1450798-F85B-4063-9761-A24B8929A684"
EVENT_CSV_FALLBACKS = {
    (2022, 3): "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/F6CC65BA-B0EF-4C36-843A-27128DDBC824/resource/389A8440-FF51-497F-9AD8-5C201812A10C/download",
}
FIELD_ALIASES = {
    "統計年月": "statistic_yyymm", "區域別代碼": "district_code", "區域別": "site_id", "村里名稱": "village",
    "出生數": "birth_total", "出生數-男": "birth_total_m", "出生數-女": "birth_total_f",
    "死亡數": "death_total", "死亡數-男": "death_m", "死亡數-女": "death_f",
    "人口數_合計": "people_total", "人口數_男": "people_total_m", "人口數_女": "people_total_f",
}


def normalize_row(row):
    return {FIELD_ALIASES.get(key.lstrip("\ufeff"), key.lstrip("\ufeff")): value for key, value in row.items()}


def download(url):
    for attempt in range(3):
        try:
            return subprocess.run(["curl", "-sS", "-L", "--fail", "--max-time", "60",
                                   "--user-agent", "TaiwanDistrictMap/1.0", url], capture_output=True, check=True).stdout
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def fetch_table(api, period, directory):
    records, pages = [], []
    expected = None
    page = 1
    while True:
        url = f"{API}/{api}/{period}?PAGE={page}"
        payload = download(url)
        data = json.loads(payload.decode("utf-8-sig"))
        if not data.get("responseCode", "").endswith("-S") or not isinstance(data.get("responseData"), list):
            raise ValueError(f"Invalid official response: {api}/{period}/{page}")
        total = int(data["totalDataSize"])
        total_pages = int(data["totalPage"])
        if total <= 0 or total_pages <= 0 or page > total_pages:
            raise ValueError("Invalid official pagination limits")
        if expected is not None and expected != (total, total_pages):
            raise ValueError("Official pagination changed during download")
        expected = (total, total_pages)
        if int(data["page"]) != page or len(data["responseData"]) != int(data["pageDataSize"]):
            raise ValueError("Official page count mismatch")
        records.extend(normalize_row(row) for row in data["responseData"])
        pages.append({"url": url, "sha256": hashlib.sha256(payload).hexdigest()})
        if page == total_pages:
            break
        page += 1
    if len(records) != expected[0] or len({row["district_code"] for row in records}) != len(records):
        raise ValueError("Incomplete or duplicate official village data")
    if any(row["statistic_yyymm"] != period for row in records):
        raise ValueError("Wrong official statistics month")
    contents = (json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    filename = f"{api}-{period}.json"
    (directory / filename).write_bytes(contents)
    print(f"Fetched {api} {period}: {len(records):,} villages", flush=True)
    return {"api": api, "period": period, "file": f"data/raw/population/annual/{directory.name}/{filename}",
            "records": len(records), "sha256": hashlib.sha256(contents).hexdigest(), "pages": pages}


def fetch_month(year, api, period, directory):
    try:
        return fetch_table(api, period, directory)
    except ValueError:
        resource_url = EVENT_CSV_FALLBACKS.get((year, int(period[-2:])))
        if not resource_url:
            raise
        payload = download(resource_url)
        rows = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")))
        field_map = {name: target for name, target in FIELD_ALIASES.items() if target in {
            "statistic_yyymm", "district_code", "site_id", "village", "birth_total", "birth_total_m",
            "birth_total_f", "death_total", "death_m", "death_f"}}
        if not rows.fieldnames or not set(field_map).issubset(rows.fieldnames):
            raise ValueError(f"Unexpected official CSV schema: {resource_url}")
        records = [{field_map[key]: value for key, value in row.items() if key in field_map} for row in rows]
        if not records or any(row["statistic_yyymm"] != period for row in records):
            raise ValueError(f"Wrong official CSV month: {period}")
        if any(not re.fullmatch(r"\d{11}", row["district_code"]) for row in records) or len({row["district_code"] for row in records}) != len(records):
            raise ValueError(f"Duplicate or invalid official CSV village codes: {period}")
        contents = (json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        filename = f"{api}-{period}.json"
        (directory / filename).write_bytes(contents)
        print(f"Fetched official CSV fallback {period}: {len(records):,} villages", flush=True)
        return {"api": api, "period": period, "file": f"data/raw/population/annual/{directory.name}/{filename}",
                "records": len(records), "sha256": hashlib.sha256(contents).hexdigest(),
                "pages": [{"url": resource_url, "sha256": hashlib.sha256(payload).hexdigest()}], "format": "CSV fallback"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("years", type=int, nargs="*", help="Complete Gregorian years, e.g. 2020 2021")
    parser.add_argument("--refresh-density", action="store_true", help="Refresh density CSVs for already fetched years")
    args = parser.parse_args()
    years = args.years or list(range(2020, min(2025, datetime.now(timezone.utc).year - 1) + 1))
    if any(year not in DENSITY_RESOURCE_IDS or year >= datetime.now(timezone.utc).year for year in years):
        parser.error("Use completed years from 2020 through 2025")
    try:
        existing = json.loads(SOURCES.read_text(encoding="utf-8"))
    except FileNotFoundError:
        existing = {"schemaVersion": 1, "years": {}}
    # Migrate the original single-year source ledger without discarding its checksums.
    if "years" not in existing:
        existing = {"schemaVersion": 1, "years": {str(existing["year"]): existing}}
    entries = existing["years"]
    for year in years:
        if str(year) in entries:
            if args.refresh_density:
                resource_id = DENSITY_RESOURCE_IDS[year]
                density_url = f"https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/{DENSITY_DATASET}/resource/{resource_id}/download"
                density = download(density_url)
                directory = RAW / str(year)
                directory.mkdir(parents=True, exist_ok=True)
                (directory / "density.csv").write_bytes(density)
                entries[str(year)]["density"] = {"catalogUrl": "https://data.gov.tw/dataset/8410", "url": density_url,
                    "file": f"data/raw/population/annual/{year}/density.csv", "sha256": hashlib.sha256(density).hexdigest()}
                entries[str(year)]["retrievedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                SOURCES.write_text(json.dumps({"schemaVersion": 1, "years": dict(sorted(entries.items(), key=lambda pair: int(pair[0]), reverse=True))}, ensure_ascii=False, indent=2) + "\n")
                print(f"Refreshed official density CSV for {year}", flush=True)
                continue
            print(f"Already fetched {year}; keeping its source snapshot", flush=True)
            continue
        roc = year - 1911
        directory = RAW / str(year)
        directory.mkdir(parents=True, exist_ok=True)
        jobs = [(year, "ODRP010" if year == 2020 and month <= 8 else "ODRP060", f"{roc}{month:02d}", directory) for month in range(1, 13)]
        jobs += [(None, "ODRP013", f"{roc - 1}12", directory), (None, "ODRP013", f"{roc}12", directory)]
        with ThreadPoolExecutor(max_workers=3) as pool:
            tables = list(pool.map(lambda job: fetch_month(*job) if job[0] is not None else fetch_table(job[1], job[2], job[3]), jobs))
        resource_id = DENSITY_RESOURCE_IDS[year]
        density_url = f"https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/{DENSITY_DATASET}/resource/{resource_id}/download"
        density = download(density_url)
        (directory / "density.csv").write_bytes(density)
        event_apis = sorted({table["api"] for table in tables if table["api"].startswith("ODRP") and table["api"] != "ODRP013"})
        log = {"schemaVersion": 1, "year": year, "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "definitionUrl": "https://www.ris.gov.tw/rs-opendata/api/Main/docs/v1",
               "eventsCatalogUrls": ["https://data.gov.tw/dataset/77140" if api == "ODRP010" else "https://data.gov.tw/dataset/131138" for api in event_apis],
               "populationApi": "ODRP013", "eventsApis": event_apis, "tables": tables,
               "density": {"catalogUrl": "https://data.gov.tw/dataset/8410", "url": density_url,
                           "file": f"data/raw/population/annual/{year}/density.csv", "sha256": hashlib.sha256(density).hexdigest()}}
        entries[str(year)] = log
        SOURCES.write_text(json.dumps({"schemaVersion": 1, "years": dict(sorted(entries.items(), key=lambda pair: int(pair[0]), reverse=True))}, ensure_ascii=False, indent=2) + "\n")
        print(f"Fetched official density and year-end population for {year}", flush=True)


if __name__ == "__main__":
    main()
