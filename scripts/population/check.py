#!/usr/bin/env python3
"""Check published population shards, boundary coverage, and known exceptions."""
from collections import defaultdict
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data"
DATA = PUBLIC / "population"
EXCEPTIONS = json.loads((ROOT / "data/population/expected-exceptions.json").read_text(encoding="utf-8"))


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_record(code: str, record: dict, level: str) -> None:
    require(record.get("code") == code, f"Record code mismatch: {code}")
    require(isinstance(code, str), f"Code must remain a string: {code}")
    require(all(type(record.get(key)) is int and record[key] >= 0 for key in ("households", "population", "male", "female")), f"Invalid population metrics: {code}")
    require(record["population"] == record["male"] + record["female"], f"Male/female total mismatch: {code}")
    if level == "village":
        require(re.fullmatch(r"\d{11}", code) is not None, f"Invalid village code: {code}")
        require(record.get("townCode") == code[:8] and record.get("countyCode") == code[:5], f"Invalid village hierarchy: {code}")
    elif level == "town":
        require(re.fullmatch(r"\d{8}", code) is not None, f"Invalid town code: {code}")
        require(record.get("countyCode") == code[:5], f"Invalid town hierarchy: {code}")
    elif level == "county":
        require(re.fullmatch(r"\d{5}", code) is not None, f"Invalid county code: {code}")


def main() -> None:
    manifest = load(DATA / "manifest.json")
    period = manifest["period"]
    month = manifest["sourceMonth"]
    require(manifest["schemaVersion"] == 1 and manifest["populationType"] == "registered", "Unsupported population manifest")
    require(re.fullmatch(r"\d{4}-\d{2}", period) is not None, "Invalid published period")
    require(f"{int(month[:3]) + 1911}-{month[3:]}" == period, "Manifest month/period mismatch")
    require(re.fullmatch(r"[0-9a-f]{64}", manifest["source"]["sha256"]) is not None, "Invalid raw-source checksum")
    expected = EXCEPTIONS.get(month)
    require(expected is not None, f"Review and register expected exceptions for source month {month}")

    age_buckets = manifest["ageBuckets"]
    require(age_buckets == [f"{age}歲" for age in range(100)] + ["100歲以上"], "Age buckets must cover 0–99 and 100+")
    version = DATA / period
    version_manifest = load(version / "manifest.json")
    require(version_manifest == manifest, "Root and version manifests differ")
    report = load(version / "join-report.json")
    require(report["period"] == period, "Join report period mismatch")

    county_geo = load(PUBLIC / "counties.geojson")
    county_codes = {feature["properties"]["code"] for feature in county_geo["features"]}
    named_boundaries = {}
    unassigned = set()
    town_codes = set()
    for county_code in county_codes:
        towns = load(PUBLIC / f"towns/{county_code}.geojson")
        for town_feature in towns["features"]:
            town_code = town_feature["properties"]["code"]
            town_codes.add(town_code)
            villages = load(PUBLIC / f"villages/{town_code}.geojson")
            for feature in villages["features"]:
                properties = feature["properties"]
                code = properties["code"]
                if properties["unassigned"]:
                    unassigned.add(code)
                else:
                    named_boundaries[code] = properties

    village_records = {}
    age_records = {}
    grouped_towns = defaultdict(dict)
    for town_code in sorted(town_codes):
        village_shard = load(version / f"villages/{town_code}.json")
        ages_shard = load(version / f"ages/{town_code}.json")
        require(village_shard["level"] == "village" and village_shard["parentCode"] == town_code, f"Invalid village shard: {town_code}")
        require(ages_shard["level"] == "village-age" and ages_shard["parentCode"] == town_code, f"Invalid age shard: {town_code}")
        require(set(village_shard["records"]) == set(ages_shard["records"]), f"Age/population code mismatch: {town_code}")
        for code, record in village_shard["records"].items():
            check_record(code, record, "village")
            require(record["townCode"] == town_code, f"Wrong village shard parent: {code}")
            ages = ages_shard["records"][code]
            require(len(ages["male"]) == len(age_buckets) and len(ages["female"]) == len(age_buckets), f"Invalid age bucket length: {code}")
            require(all(type(value) is int and value >= 0 for value in ages["male"] + ages["female"]), f"Invalid age count: {code}")
            require(sum(ages["male"]) == record["male"] and sum(ages["female"]) == record["female"], f"Age totals mismatch: {code}")
            require(code not in village_records, f"Duplicate village record: {code}")
            village_records[code] = record
            age_records[code] = ages
            grouped_towns[town_code][code] = record

    source_codes = set(village_records)
    source_without_boundary = sorted(source_codes - set(named_boundaries) - unassigned)
    missing_named_boundaries = sorted(set(named_boundaries) - source_codes)
    source_on_unassigned = sorted(source_codes & unassigned)
    mismatch_codes = sorted(item["code"] for item in report["nameMismatches"])
    require(source_without_boundary == sorted(expected["sourceWithoutBoundary"]), f"Unexpected source-only village codes: {source_without_boundary}")
    require(mismatch_codes == sorted(expected["nameMismatches"]), f"Unexpected code/name differences: {mismatch_codes}")
    require(not missing_named_boundaries, f"Named map villages without population data: {missing_named_boundaries[:10]}")
    require(not source_on_unassigned, f"Population assigned to unassigned map areas: {source_on_unassigned}")
    require(sorted(item["code"] for item in report["sourceWithoutBoundary"]) == source_without_boundary, "Source-only report mismatch")
    require(manifest["coverage"]["sourceWithoutBoundaryCodes"] == source_without_boundary, "Source-only coverage codes mismatch")
    require(report["boundaryWithoutPopulation"]["unassignedCodes"] == sorted(unassigned), "Unassigned boundary report mismatch")
    require(manifest["counts"]["sourceVillages"] == len(village_records), "Source village count mismatch")
    require(manifest["counts"]["matchedNamedVillages"] == len(named_boundaries), "Matched named village count mismatch")
    require(manifest["counts"]["sourceWithoutBoundary"] == len(source_without_boundary), "Source-only count mismatch")
    require(manifest["counts"]["namedBoundaryVillages"] == len(named_boundaries), "Named boundary count mismatch")
    require(manifest["counts"]["unassignedBoundaries"] == len(unassigned), "Unassigned boundary count mismatch")
    require(manifest["coverage"]["unassignedWithoutPopulation"] == len(unassigned), "Unassigned coverage mismatch")
    require(report["sourceVillages"] == len(village_records) and report["matchedNamedVillages"] == len(named_boundaries), "Join report counts mismatch")

    grouped_counties = defaultdict(dict)
    for town_code, records in grouped_towns.items():
        totals = {key: sum(row[key] for row in records.values()) for key in ("households", "population", "male", "female")}
        county_code = town_code[:5]
        grouped_counties[county_code][town_code] = totals
    all_metrics = {key: sum(record[key] for record in village_records.values()) for key in ("households", "population", "male", "female")}

    county_shard = load(version / "counties.json")
    require(county_shard["level"] == "county", "Invalid county aggregate shard")
    county_records = county_shard["records"]
    require(set(county_records) == set(grouped_counties), "County aggregate code coverage mismatch")
    for code, record in county_records.items():
        check_record(code, record, "county")
        for key in ("households", "population", "male", "female"):
            require(record[key] == sum(group[key] for group in grouped_counties[code].values()), f"County aggregate mismatch: {code} {key}")

    town_records = {}
    for county_code in sorted(county_codes):
        shard = load(version / f"towns/{county_code}.json")
        require(shard["level"] == "town" and shard["parentCode"] == county_code, f"Invalid town aggregate shard: {county_code}")
        for code, record in shard["records"].items():
            check_record(code, record, "town")
            require(record["countyCode"] == county_code, f"Wrong town aggregate parent: {code}")
            town_records[code] = record
    require(set(town_records) == set(grouped_towns), "Town aggregate code coverage mismatch")
    for code, records in grouped_towns.items():
        for key in ("households", "population", "male", "female"):
            require(town_records[code][key] == sum(row[key] for row in records.values()), f"Town aggregate mismatch: {code} {key}")

    national = load(version / "national.json")["record"]
    check_record("TW", national, "national")
    for key, value in all_metrics.items():
        require(national[key] == value, f"National aggregate mismatch: {key}")
    require(sum(record["population"] for record in county_records.values()) == national["population"], "County/national population totals differ")
    require(sum(record["population"] for record in town_records.values()) == national["population"], "Town/national population totals differ")
    require(len(village_records) == manifest["counts"]["sourceVillages"], "Village data count differs from manifest")
    print(f"Verified {period}: {len(named_boundaries):,} named map villages, {len(village_records):,} source villages, {len(unassigned):,} unassigned areas.")
    print(f"Aggregates and single-age totals reconcile; {len(source_without_boundary)} documented source-only village and {len(mismatch_codes)} documented name differences.")


if __name__ == "__main__":
    main()
