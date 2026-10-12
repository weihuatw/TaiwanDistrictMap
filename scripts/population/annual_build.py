#!/usr/bin/env python3
"""Build annual registered births/deaths and official population density."""
from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data"
DEST = PUBLIC / "population/annual"
TOWN_CODE_ALIASES = {"64000051": "64000050", "64000052": "64000050",
                     "64000121": "64000120", "64000122": "64000120"}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def integer(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d+", value):
        raise ValueError("Official counts must be nonnegative integers")
    return int(value)


def event_counts(row):
    births, deaths = integer(row["birth_total"]), integer(row["death_total"])
    if births != integer(row["birth_total_m"]) + integer(row["birth_total_f"]):
        raise ValueError("Birth sex totals mismatch")
    if deaths != integer(row["death_m"]) + integer(row["death_f"]):
        raise ValueError("Death sex totals mismatch")
    return births, deaths


def annual_record(code, name, monthly, start, end, area=None, density_population=None):
    complete = len(monthly) == 12
    births = sum(count[0] for count in monthly) if complete else None
    deaths = sum(count[1] for count in monthly) if complete else None
    mean = (start + end) / 2 if start is not None and end is not None else None
    return {"code": code, "name": name, "monthsCovered": len(monthly),
            "observedBirths": sum(count[0] for count in monthly), "observedDeaths": sum(count[1] for count in monthly),
            "births": births, "deaths": deaths, "naturalIncrease": births - deaths if complete else None,
            "startPopulation": start, "endPopulation": end, "meanPopulation": mean,
            "densityPopulation": density_population, "areaKm2": area}


def normalize(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).replace("台", "臺")


def sources_by_year(source_index):
    if "years" in source_index:
        return source_index["years"]
    return {str(source_index["year"]): source_index}


def build_year(source, counties, towns, current):
    year, roc = source["year"], source["year"] - 1911
    tables = {}
    for item in source["tables"]:
        path = ROOT / item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Source checksum mismatch: {path}")
        rows = load(path)
        if year == 2020:
            for row in rows:
                old_town_code = row["district_code"][:8]
                if old_town_code in TOWN_CODE_ALIASES:
                    row["district_code"] = TOWN_CODE_ALIASES[old_town_code] + row["district_code"][8:]
                    row["site_id"] = ("高雄市三民區" if old_town_code.startswith("6400005") else "高雄市鳳山區")
        if len(rows) != item["records"] or len({row["district_code"] for row in rows}) != len(rows):
            raise ValueError("Duplicate or incomplete source table")
        if any(not re.fullmatch(r"\d{11}", row["district_code"]) or row["statistic_yyymm"] != item["period"] for row in rows):
            raise ValueError("Wrong source codes or months")
        key = (item["api"], item["period"])
        if key in tables:
            raise ValueError("Duplicate source month")
        tables[key] = rows
    event_apis = {"ODRP010" if year == 2020 and month <= 8 else "ODRP060" for month in range(1, 13)}
    required = {("ODRP010" if year == 2020 and month <= 8 else "ODRP060", f"{roc}{month:02d}") for month in range(1, 13)}
    required |= {("ODRP013", f"{roc - 1}12"), ("ODRP013", f"{roc}12")}
    if set(tables) != required or set(source.get("eventsApis", event_apis)) != event_apis:
        raise ValueError("A complete year requires the correct twelve event months and both year-end population snapshots")

    names = {code: item["name"] for code, item in current.items()}
    events = defaultdict(list)
    grouped = defaultdict(lambda: defaultdict(list))
    monthly_totals = []
    for month in range(1, 13):
        period = f"{roc}{month:02d}"
        api = "ODRP010" if year == 2020 and month <= 8 else "ODRP060"
        month_groups = defaultdict(lambda: [0, 0])
        rows = tables[(api, period)]
        for row in rows:
            code = row["district_code"]
            if code[:8] not in towns:
                raise ValueError(f"Unknown source township: {code}")
            counts = event_counts(row)
            events[code].append(counts)
            names.setdefault(code, row["village"])
            for scope in (code[:8], code[:5], "TW"):
                month_groups[scope][0] += counts[0]
                month_groups[scope][1] += counts[1]
        for scope, values in month_groups.items():
            grouped[scope][period] = tuple(values)
        monthly_totals.append({"period": period, "sourceVillages": len(rows), "births": month_groups["TW"][0], "deaths": month_groups["TW"][1]})

    population = {}
    for label, period in (("start", f"{roc - 1}12"), ("end", f"{roc}12")):
        by_code, aggregates = {}, defaultdict(int)
        for row in tables[("ODRP013", period)]:
            code = row["district_code"]
            total = integer(row["people_total"])
            if total != integer(row["people_total_m"]) + integer(row["people_total_f"]):
                raise ValueError("Year-end population sex totals mismatch")
            if code[:8] not in towns:
                raise ValueError("Unknown year-end population township")
            by_code[code] = total
            names.setdefault(code, row["village"])
            for scope in (code[:8], code[:5], "TW"):
                aggregates[scope] += total
        population[label] = {**by_code, **aggregates}

    density_path = ROOT / source["density"]["file"]
    if hashlib.sha256(density_path.read_bytes()).hexdigest() != source["density"]["sha256"]:
        raise ValueError("Density source checksum mismatch")
    town_names = {normalize(town["countyName"] + town["name"]): code for code, town in towns.items()}
    areas, density_populations = {}, {}
    excluded_density = []
    with density_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if not row["statistic_yyy"] or row["statistic_yyy"] == "統計年":
                continue
            if row["statistic_yyy"] != str(roc):
                raise ValueError("Wrong density year")
            if row["site_id"] in ("東沙群島", "南沙群島") and row["people_total"].strip() == "…":
                excluded_density.append(row["site_id"])
                continue
            code = town_names.get(normalize(row["site_id"]))
            if not code or code in areas:
                raise ValueError(f"Ambiguous density township: {row['site_id']}")
            area, residents = float(row["area"]), integer(row["people_total"])
            if not math.isfinite(area) or area <= 0:
                raise ValueError(f"Invalid official area: {code}")
            density = float(row["population_density"])
            density_precision = len(row["population_density"].partition(".")[2])
            if not math.isfinite(density) or round(residents / area, density_precision) != density:
                raise ValueError("Official density calculation mismatch")
            areas[code], density_populations[code] = area, residents
    if set(areas) != set(towns):
        raise ValueError("Official area coverage must match all townships")
    for code in counties:
        child_codes = [town_code for town_code in towns if town_code.startswith(code)]
        areas[code] = round(sum(areas[town_code] for town_code in child_codes), 4)
        density_populations[code] = sum(density_populations[town_code] for town_code in child_codes)
    areas["TW"] = round(sum(areas[code] for code in counties), 4)
    density_populations["TW"] = sum(density_populations[code] for code in counties)

    villages = {code: annual_record(code, names[code], events.get(code, []), population["start"].get(code), population["end"].get(code))
                for code in sorted(names)}
    aggregates = {code: annual_record(code, "全臺" if code == "TW" else (towns if len(code) == 8 else counties)[code]["name"],
                                      list(grouped[code].values()), population["start"].get(code), population["end"].get(code),
                                      areas[code], density_populations[code]) for code in [*towns, *counties, "TW"]}
    event_titles = {"ODRP010": "出生死亡登記月報（ODRP010）", "ODRP060": "出生死亡登記月報（ODRP060）"}
    sources = [{"title": event_titles[api], "url": "https://data.gov.tw/dataset/77140" if api == "ODRP010" else "https://data.gov.tw/dataset/131138"}
               for api in sorted(event_apis)]
    sources += [{"title": "年底戶籍人口（ODRP013）", "url": source["definitionUrl"]},
                {"title": "各鄉鎮市區人口密度與土地面積", "url": source["density"]["catalogUrl"]}]
    report = {"excludedDensityRows": excluded_density, "year": year, "currentNamedVillages": len(current),
              "historicalTownCodeAliases": ([{"sourceTownCode": old_code, "currentTownCode": new_code}
                                             for old_code, new_code in sorted(TOWN_CODE_ALIASES.items())] if year == 2020 else []),
              "incompleteEvents": [code for code in current if villages[code]["monthsCovered"] != 12],
              "missingRateDenominator": [code for code in current if villages[code]["meanPopulation"] is None],
              "historicalWithoutCurrentBoundary": sorted(set(villages) - set(current)),
              "nameDifferences": [{"code": row["district_code"], "sourceName": row["village"], "boundaryName": current[row["district_code"]]["name"]}
                                  for row in tables[("ODRP060", f"{roc}12")] if row["district_code"] in current
                                  and normalize(row["village"]) != normalize(current[row["district_code"]]["name"])]}
    manifest = {"schemaVersion": 1, "year": year, "period": f"{year}-01-01–{year}-12-31", "populationType": "registered",
                "eventBasis": "registration", "rateDenominator": "mean-of-year-end-populations", "densityLevels": ["county", "town"],
                "sources": sources, "retrievedAt": source["retrievedAt"], "monthlyTotals": monthly_totals,
                "coverage": {"towns": len(towns), "counties": len(counties), "currentNamedVillages": len(current),
                             "completeVillageEvents": len(current) - len(report["incompleteEvents"]),
                             "completeVillageRates": sum(villages[code]["monthsCovered"] == 12 and villages[code]["meanPopulation"] is not None for code in current)},
                "files": {"counties": f"{year}/counties.json", "towns": f"{year}/towns/{{countyCode}}.json",
                          "villages": f"{year}/villages/{{townCode}}.json", "national": f"{year}/national.json", "report": f"{year}/join-report.json"}}
    return year, villages, aggregates, report, manifest


def main():
    source_index = load(ROOT / "data/population/annual-sources.json")
    sources = sources_by_year(source_index)
    counties = {feature["properties"]["code"]: feature["properties"] for feature in load(PUBLIC / "counties.geojson")["features"]}
    towns = {}
    for county_code in counties:
        towns.update({feature["properties"]["code"]: feature["properties"] for feature in load(PUBLIC / f"towns/{county_code}.geojson")["features"]})
    current = {}
    for town_code in towns:
        current.update({feature["properties"]["code"]: feature["properties"] for feature in load(PUBLIC / f"villages/{town_code}.geojson")["features"] if not feature["properties"]["unassigned"]})

    built = [build_year(source, counties, towns, current) for _, source in sorted(sources.items(), key=lambda pair: int(pair[0]))]
    staging = DEST.with_name("annual.next")
    shutil.rmtree(staging, ignore_errors=True)
    if DEST.exists():
        shutil.copytree(DEST, staging)
    else:
        staging.mkdir(parents=True)
    for year, villages, aggregates, report, manifest in built:
        version = staging / str(year)
        shutil.rmtree(version, ignore_errors=True)
        def shard(level, records, parent=None):
            return {"schemaVersion": 1, "year": year, "level": level, **({"parentCode": parent} if parent else {}), "records": records}
        write(version / "counties.json", shard("county", {code: aggregates[code] for code in sorted(counties)}))
        for county_code in sorted(counties):
            write(version / f"towns/{county_code}.json", shard("town", {code: aggregates[code] for code in sorted(towns) if code.startswith(county_code)}, county_code))
        for town_code in sorted(towns):
            write(version / f"villages/{town_code}.json", shard("village", {code: villages[code] for code in villages if code.startswith(town_code)}, town_code))
        write(version / "national.json", {"schemaVersion": 1, "year": year, "record": aggregates["TW"]})
        write(version / "join-report.json", report)
        write(version / "manifest.json", manifest)
        print(f"Built {year}: {aggregates['TW']['births']:,} births, {aggregates['TW']['deaths']:,} deaths; village coverage {manifest['coverage']}", flush=True)
    years = sorted((row[0] for row in built), reverse=True)
    write(staging / "manifest.json", {"schemaVersion": 1, "years": years})
    shutil.rmtree(DEST, ignore_errors=True)
    staging.replace(DEST)


if __name__ == "__main__":
    main()
