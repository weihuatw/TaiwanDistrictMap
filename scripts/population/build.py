#!/usr/bin/env python3
"""Normalize one official monthly population CSV into reusable static map data."""
import csv
import calendar
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data/raw/population"
SOURCE_FILE = ROOT / "data/population/sources.json"
PUBLIC = ROOT / "public/data"
DEST = PUBLIC / "population"
STAGING = PUBLIC / "population.next"
CATALOG_URL = "https://data.gov.tw/dataset/77132"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def sum_records(records):
    return {key: sum(record[key] for record in records) for key in ("households", "population", "male", "female")}


def main() -> None:
    source_log = load_json(SOURCE_FILE)
    available = {entry["month"]: entry for entry in source_log["months"]}
    month = sys.argv[1] if len(sys.argv) > 1 else (max(available) if available else "")
    if month not in available or not re.fullmatch(r"\d{5}", month):
        raise SystemExit("請先執行 npm run population:fetch -- <民國年月>，例如 11508")
    source = available[month]
    source_path = RAW_DIR / f"{month}.csv"
    payload = source_path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != source["sha256"]:
        raise ValueError(f"原始資料 SHA-256 不符：{source_path}")

    period = f"{int(month[:3]) + 1911}-{month[3:]}"
    if source.get("period") != period:
        raise ValueError("來源年月詮釋資料不一致")
    last_day = calendar.monthrange(int(period[:4]), int(period[5:]))[1]
    age_labels = [f"{age}歲" for age in range(100)] + ["100歲以上"]
    age_columns = [(f"{label}-{sex}", sex) for label in age_labels for sex in ("男", "女")]

    county_geo = load_json(PUBLIC / "counties.geojson")
    county_by_code = {f["properties"]["code"]: f["properties"] for f in county_geo["features"]}
    town_by_code = {}
    for county_code in county_by_code:
        towns = load_json(PUBLIC / f"towns/{county_code}.geojson")
        town_by_code.update({f["properties"]["code"]: f["properties"] for f in towns["features"]})
    boundary_by_code = {}
    unassigned_codes = set()
    for path in sorted((PUBLIC / "villages").glob("*.geojson")):
        collection = load_json(path)
        for feature in collection["features"]:
            properties = feature["properties"]
            code = properties["code"]
            boundary_by_code[code] = properties
            if properties["unassigned"]:
                unassigned_codes.add(code)

    village_records = {}
    age_records = {}
    rows_by_code = {}
    area_by_code = {}
    with source_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"統計年月", "區域別代碼", "區域別", "村里", "戶數", "人口數", "人口數-男", "人口數-女", *(column for column, _ in age_columns)}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("原始 CSV 欄位與戶政司格式不符")
        for row in reader:
            if not row.get("區域別代碼"):
                continue
            code = row["區域別代碼"].strip()
            if not re.fullmatch(r"\d{11}", code):
                raise ValueError(f"村里區域代碼不是 11 碼字串：{code}")
            if row["統計年月"].strip() != month:
                raise ValueError(f"資料含其他統計年月：{code}")
            if code in rows_by_code:
                raise ValueError(f"重複村里區域代碼：{code}")
            try:
                values = {key: int(row[key].strip()) for key in ("戶數", "人口數", "人口數-男", "人口數-女")}
                ages = {sex: [int(row[column].strip()) for column, column_sex in age_columns if column_sex == sex] for sex in ("男", "女")}
            except (TypeError, ValueError) as error:
                raise ValueError(f"非整數人口資料：{code}") from error
            if any(value < 0 for value in values.values()) or any(value < 0 for values_by_age in ages.values() for value in values_by_age):
                raise ValueError(f"人口統計不可為負數：{code}")
            if values["人口數"] != values["人口數-男"] + values["人口數-女"]:
                raise ValueError(f"男女合計不符：{code}")
            if sum(ages["男"]) != values["人口數-男"] or sum(ages["女"]) != values["人口數-女"]:
                raise ValueError(f"單一年齡人口加總不符：{code}")

            town_code = code[:8]
            county_code = code[:5]
            boundary = boundary_by_code.get(code)
            town = town_by_code.get(town_code)
            county = county_by_code.get(county_code)
            area_name = row["區域別"].strip()
            county_name = county["name"] if county else area_name[:3]
            town_name = town["name"] if town else area_name[len(county_name):]
            record = {
                "code": code,
                "name": row["村里"].strip(),
                "countyCode": county_code,
                "countyName": county_name,
                "townCode": town_code,
                "townName": town_name,
                "households": values["戶數"],
                "population": values["人口數"],
                "male": values["人口數-男"],
                "female": values["人口數-女"],
            }
            rows_by_code[code] = record
            area_by_code[code] = area_name
            village_records.setdefault(town_code, {})[code] = record
            age_records.setdefault(town_code, {})[code] = {"male": ages["男"], "female": ages["女"]}

    named_boundary_codes = {code for code, feature in boundary_by_code.items() if code not in unassigned_codes}
    source_codes = set(rows_by_code)
    missing_named = sorted(named_boundary_codes - source_codes)
    if missing_named:
        raise ValueError(f"具名村里界線缺少人口資料：{missing_named[:10]}")
    if source_codes & unassigned_codes:
        raise ValueError("戶籍資料代碼與未編定範圍重疊，需人工確認")

    name_mismatches = [
        {"code": code, "sourceName": rows_by_code[code]["name"], "boundaryName": boundary_by_code[code]["name"]}
        for code in sorted(source_codes & named_boundary_codes)
        if rows_by_code[code]["name"] != boundary_by_code[code]["name"]
    ]
    source_only = [
        {"code": code, "area": area_by_code[code], **rows_by_code[code]}
        for code in sorted(source_codes - set(boundary_by_code))
    ]

    town_aggregates = {}
    county_aggregates = {}
    for town_code, records in village_records.items():
        sample = next(iter(records.values()))
        values = sum_records(records.values())
        town = town_by_code.get(town_code)
        town_aggregates[town_code] = {
            "code": town_code, "name": town["name"] if town else sample["townName"],
            "countyCode": sample["countyCode"], "countyName": sample["countyName"],
            "townCode": town_code, "townName": town["name"] if town else sample["townName"], **values,
        }
        county_aggregates.setdefault(sample["countyCode"], []).append((sample, values))
    county_records = {}
    for county_code, rows in county_aggregates.items():
        values = {key: sum(item[1][key] for item in rows) for key in ("households", "population", "male", "female")}
        county = county_by_code.get(county_code)
        sample = rows[0][0]
        county_records[county_code] = {
            "code": county_code, "name": county["name"] if county else sample["countyName"],
            "countyCode": county_code, "countyName": county["name"] if county else sample["countyName"], **values,
        }
    national_values = sum_records(rows_by_code.values())
    national_record = {"code": "TW", "name": "全臺", "countyCode": "TW", "countyName": "全臺", **national_values}

    source_without_boundary_codes = sorted(source_codes - set(boundary_by_code))
    unassigned_without_population = sorted(unassigned_codes - source_codes)
    manifest = {
        "schemaVersion": 1,
        "period": period,
        "sourceMonth": month,
        "label": f"民國{month[:3]}年{int(month[3:])}月底（{period}-{last_day:02d}）",
        "populationType": "registered",
        "ageBuckets": age_labels,
        "source": {
            "title": "村里戶數、單一年齡人口（新增區域代碼）",
            "agency": "內政部戶政司",
            "catalogUrl": source.get("catalogUrl", CATALOG_URL),
            "downloadUrl": source["downloadUrl"],
            "retrievedAt": source["retrievedAt"],
            "sha256": digest,
        },
        "counts": {
            "sourceVillages": len(rows_by_code),
            "matchedNamedVillages": len(source_codes & named_boundary_codes),
            "sourceWithoutBoundary": len(source_without_boundary_codes),
            "namedBoundaryVillages": len(named_boundary_codes),
            "unassignedBoundaries": len(unassigned_codes),
        },
        "coverage": {
            "matchedNamedVillages": len(source_codes & named_boundary_codes),
            "sourceWithoutBoundaryCodes": source_without_boundary_codes,
            "unassignedWithoutPopulation": len(unassigned_without_population),
        },
        "files": {
            "villages": f"{period}/villages/{{townCode}}.json",
            "towns": f"{period}/towns/{{countyCode}}.json",
            "counties": f"{period}/counties.json",
            "national": f"{period}/national.json",
            "ages": f"{period}/ages/{{townCode}}.json",
        },
    }
    report = {
        "period": period,
        "sourceVillages": len(rows_by_code),
        "matchedNamedVillages": len(source_codes & named_boundary_codes),
        "sourceWithoutBoundary": source_only,
        "boundaryWithoutPopulation": {"unassignedCount": len(unassigned_without_population), "unassignedCodes": unassigned_without_population},
        "nameMismatches": name_mismatches,
    }

    shutil.rmtree(STAGING, ignore_errors=True)
    if DEST.exists():
        shutil.copytree(DEST, STAGING)
    else:
        STAGING.mkdir(parents=True)
    period_dir = STAGING / period
    shutil.rmtree(period_dir, ignore_errors=True)
    for town_code in sorted(village_records):
        write_json(period_dir / f"villages/{town_code}.json", {
            "schemaVersion": 1, "period": period, "level": "village", "parentCode": town_code,
            "records": dict(sorted(village_records[town_code].items())),
        })
        write_json(period_dir / f"ages/{town_code}.json", {
            "schemaVersion": 1, "period": period, "level": "village-age", "parentCode": town_code,
            "records": dict(sorted(age_records[town_code].items())),
        })
    for county_code in sorted(county_records):
        records = {code: town_aggregates[code] for code in sorted(town_aggregates) if town_aggregates[code]["countyCode"] == county_code}
        write_json(period_dir / f"towns/{county_code}.json", {
            "schemaVersion": 1, "period": period, "level": "town", "parentCode": county_code, "records": records,
        })
    version_manifest = {**manifest, "report": f"{period}/join-report.json"}
    write_json(period_dir / "counties.json", {"schemaVersion": 1, "period": period, "level": "county", "records": dict(sorted(county_records.items()))})
    write_json(period_dir / "national.json", {"schemaVersion": 1, "period": period, "record": national_record})
    write_json(period_dir / "join-report.json", report)
    write_json(period_dir / "manifest.json", version_manifest)
    write_json(STAGING / "manifest.json", version_manifest)
    shutil.rmtree(DEST, ignore_errors=True)
    STAGING.replace(DEST)
    print(f"Built {len(rows_by_code):,} village records for {period}; matched {len(source_codes & named_boundary_codes):,} named boundaries.")


if __name__ == "__main__":
    main()
