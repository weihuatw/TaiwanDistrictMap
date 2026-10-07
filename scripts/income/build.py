#!/usr/bin/env python3
"""Normalize official 113-year HTML tables; conserve totals before any spatial join."""
from collections import defaultdict
from datetime import datetime
from hashlib import sha256
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import shutil
import unicodedata
from zipfile import ZipFile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "data/raw/income/113/source.zip"
TARGET = ROOT / "public/data/income/2024"
SOURCE_URL = "https://www.fia.gov.tw/download/13a9ac5e8b8e479d82c95daf9424dc08"
CATALOG_URL = "https://www.fia.gov.tw/singlehtml/43?cntId=4c3fc1e8a7c545179280b6a50a27cd35"
# FIA's HTML uses legacy/private-use glyphs; NLSC brackets some rare glyphs.
# These are spelling equivalents, not allocations across renamed/split villages.
GLYPH_EQUIVALENTS = {"\U000fb56f": "塭", "\U000fc355": "磘", "\U000fffb5": "獇", "\U000fffc0": "萡",
                     "𥂁": "塩", "𦰡": "那", "𥕢": "曹", "𣐤": "欍", "濓": "濂", "売": "壳", "啓": "啟"}


def normalize(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).replace("台", "臺")


def name_key(value):
    value = normalize(value).replace("[", "").replace("]", "")
    return "".join(GLYPH_EQUIVALENTS.get(c, c) for c in value)


class HTMLRows(HTMLParser):
    """Nested cells occur in Jasper's vertically aligned town-name cells."""
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row_stack = []
        self.cell_stack = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row_stack.append([])
        elif tag in ("td", "th"):
            cell = []
            if self.row_stack:
                self.row_stack[-1].append(cell)
            self.cell_stack.append(cell)

    def handle_data(self, value):
        # A parent cell's text must include text inside its nested table.
        for cell in self.cell_stack:
            cell.append(value)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell_stack:
            self.cell_stack.pop()
        elif tag == "tr" and self.row_stack:
            self.rows.append([normalize("".join(cell)) for cell in self.row_stack.pop()])


def rows(html):
    parser = HTMLRows()
    parser.feed(html)
    return parser.rows


def number(value):
    text = value.replace(",", "").replace("−", "-")
    if text in ("", "-", "—", "…"):
        return None
    if re.fullmatch(r"-?\d+(?:\.\d+)?", text):
        return float(text) if "." in text else int(text)
    raise ValueError(f"Invalid numerical cell: {value!r}")


def record(code, level, name, county_code, town_code, values, origin):
    units, total, reported, median, q1, q3, sd, cv = values
    assert isinstance(units, int) and units >= 0
    assert total is not None and math.isfinite(total)
    mean = total / units if units else None
    if mean is not None and reported is not None:
        assert abs(mean - reported) <= 1.01, (name, mean, reported)
    return dict(code=code, level=level, name=name, countyCode=county_code,
                townCode=town_code, taxUnits=units, incomeTotalK=total,
                meanK=mean, reportedMeanK=reported, medianK=median,
                q1K=q1, q3K=q3, standardDeviationK=sd,
                coefficientOfVariation=cv, origin=origin)


def build():
    boundaries = json.loads((ROOT / "public/data/manifest.json").read_text())
    counties = json.loads((ROOT / "public/data/counties.geojson").read_text())["features"]
    county_by_name = {normalize(f["properties"]["name"]): f for f in counties}
    towns_by_county = {}
    villages_by_town = {}
    for county in counties:
        code = county["id"]
        towns = json.loads((ROOT / f"public/data/towns/{code}.geojson").read_text())["features"]
        towns_by_county[code] = {normalize(f["properties"]["name"]): f for f in towns}
        for town in towns:
            villages = json.loads((ROOT / f"public/data/villages/{town['id']}.geojson").read_text())["features"]
            named = [f for f in villages if not f["properties"]["unassigned"]]
            villages_by_town[town["id"]] = {name_key(f["properties"]["name"]): f for f in named}
            assert len(villages_by_town[town["id"]]) == len(named), "Ambiguous normalized village names"

    county_records = {}
    town_records = {}
    village_records = {}
    unmatched = []
    reconciliations = []
    source_village_count = 0
    source_town_count = 0
    with ZipFile(ARCHIVE) as archive:
        county_table = next(n for n in archive.namelist() if n.endswith("/113_6-1.html"))
        for row in rows(archive.read(county_table).decode("utf-8-sig")):
            if len(row) < 4 or row[1] not in county_by_name:
                continue
            county = county_by_name[row[1]]
            values = [number(row[2]), number(row[3]), None, None, None, None, None, None]
            county_records[county["id"]] = record(county["id"], "county", county["properties"]["name"], county["id"], None, values, "official-county-total")
        assert len(county_records) == 22

        tables = [n for n in archive.namelist() if re.search(r"/113_165-[A-Z]\.html$", n)]
        assert len(tables) == 22
        for table in tables:
            html = archive.read(table).decode("utf-8-sig")
            county_name = normalize(re.search(r"縣市別：([^<]+)", html)[1])
            county_code = county_by_name[county_name]["id"]
            groups = defaultdict(lambda: dict(villages=[], summary=None))
            current_town = ""
            for row in rows(html):
                if len(row) < 12:
                    continue
                try:
                    values = [number(cell) for cell in row[3:11]]
                except ValueError:
                    continue
                if values[0] is None or values[1] is None:
                    continue
                if row[1]:
                    current_town = row[1]
                assert current_town, (table, row)
                village_name = row[2] or "其他"
                group = groups[current_town]
                if village_name == "合計":
                    assert group["summary"] is None, (county_name, current_town)
                    group["summary"] = values
                else:
                    group["villages"].append((village_name, values))

            county_units = 0
            county_total = 0
            county_mapped_units = 0
            for town_name, group in groups.items():
                entries = group["villages"]
                units = sum(v[0] for _, v in entries)
                total = sum(v[1] for _, v in entries)
                summary = group["summary"] or [units, total, None, None, None, None, None, None]
                assert units == summary[0], (county_name, town_name, units, summary[0])
                assert abs(total - summary[1]) <= max(1, len(entries)), (county_name, town_name, total, summary[1])
                county_units += summary[0]
                county_total += summary[1]
                town = towns_by_county[county_code].get(town_name)
                if town is None:
                    unmatched.append(dict(level="town", county=county_name, town=town_name,
                                          taxUnits=summary[0], incomeTotalK=summary[1], kind="unlocated" if town_name == "其他" else "unmatched"))
                    continue
                source_town_count += 1
                town_code = town["id"]
                origin = "official-town-summary" if group["summary"] else "village-weighted"
                town_record = record(town_code, "town", town["properties"]["name"], county_code, town_code, summary, origin)
                town_records[town_code] = town_record
                mapped_units = 0
                matched_villages = 0
                seen = set()
                for village_name, values in entries:
                    assert village_name not in seen, (county_name, town_name, village_name)
                    seen.add(village_name)
                    if village_name != "其他":
                        source_village_count += 1
                    village = villages_by_town[town_code].get(name_key(village_name))
                    if village is None:
                        unmatched.append(dict(level="village", county=county_name, town=town_name,
                                              village=village_name, taxUnits=values[0], incomeTotalK=values[1],
                                              kind="unlocated" if village_name == "其他" else "unmatched"))
                        continue
                    village_record = record(village["id"], "village", village["properties"]["name"], county_code, town_code, values, "official-village")
                    if village_name != normalize(village["properties"]["name"]):
                        village_record["sourceName"] = village_name
                        village_record["joinMethod"] = "glyph-normalization"
                    assert village["id"] not in village_records
                    village_records[village["id"]] = village_record
                    mapped_units += values[0]
                    matched_villages += 1
                town_record["coverage"] = dict(mappedTaxUnits=mapped_units, totalTaxUnits=summary[0], matchedVillages=matched_villages,
                                               sourceVillages=sum(n != "其他" for n, _ in entries))
                county_mapped_units += mapped_units
            official = county_records[county_code]
            assert county_units == official["taxUnits"], (county_name, county_units, official["taxUnits"])
            assert abs(county_total - official["incomeTotalK"]) <= len(groups), (county_name, county_total, official["incomeTotalK"])
            official["coverage"] = dict(mappedTaxUnits=county_mapped_units, totalTaxUnits=official["taxUnits"])
            reconciliations.append(dict(countyCode=county_code, taxUnits=county_units, incomeTotalK=county_total,
                                        officialTaxUnits=official["taxUnits"], officialIncomeTotalK=official["incomeTotalK"],
                                        roundingToleranceK=len(groups), townGroups=len(groups)))

    missing_towns = [f["id"] for group in towns_by_county.values() for f in group.values() if f["id"] not in town_records]
    assert not missing_towns, missing_towns
    missing_villages = [dict(code=f["id"], county=f["properties"]["countyName"], town=f["properties"]["townName"], village=f["properties"]["name"])
                        for group in villages_by_town.values() for f in group.values() if f["id"] not in village_records]
    national_units = sum(r["taxUnits"] for r in county_records.values())
    national_total = sum(r["incomeTotalK"] for r in county_records.values())
    means = sorted(r["meanK"] / 10 for r in village_records.values() if r["meanK"] is not None)
    report = dict(reconciliations=reconciliations, unmatched=unmatched, missingBoundaries=missing_villages,
                  glyphEquivalents=GLYPH_EQUIVALENTS,
                  spellingMatches=[dict(code=r["code"], name=r["name"], sourceName=r["sourceName"]) for r in village_records.values() if "sourceName" in r])
    manifest = dict(year=2024, rocYear=113, status="preliminary", statusLabel="初步核定", publishedAt="2026-06-30", verifiedAt="2026-10-07",
                    provider="財政部財政資訊中心", catalogUrl=CATALOG_URL, downloadUrl=SOURCE_URL,
                    archiveSha256=sha256(ARCHIVE.read_bytes()).hexdigest(), unit="千元", metric="綜合所得總額",
                    generatedAt=datetime.now(ZoneInfo("Asia/Taipei")).isoformat(timespec="seconds"),
                    counts=dict(county=len(county_records), town=len(town_records), village=len(village_records), sourceVillages=source_village_count),
                    national=dict(taxUnits=national_units, incomeTotalK=national_total, meanK=national_total/national_units),
                    coverage=dict(mappedTaxUnits=sum(r["coverage"]["mappedTaxUnits"] for r in county_records.values()), totalTaxUnits=national_units,
                                  unmatchedNamedVillages=sum(r["level"] == "village" and r["kind"] == "unmatched" for r in unmatched),
                                  missingNamedBoundaries=len(missing_villages), unassignedBoundaries=boundaries["unassignedCount"]),
                    villageDistributionWan=dict(min=means[0], p10=means[int(len(means)*.1)], median=means[len(means)//2], p90=means[int(len(means)*.9)], max=means[-1]),
                    boundarySources=[dict(level=s["level"], releaseFile=s["releaseFile"]) for s in boundaries["sources"]],
                    notes=["各層統一採綜合所得總額；平均數以該層所得總額除以納稅戶數計算。",
                           "縣市使用表6-1；鄉鎮市區與村里使用表165。其他未定位統計保留於上層，不分配至未編定polygon。",
                           "所得為2024年初步核定資料；界線採現有官方發布版本，以完整縣市／鄉鎮／村里名稱對照。未對應及零戶數以無資料呈現。",
                           "本統計不含免稅、分離課稅及非課稅所得，不等同個人薪資或可支配所得。"])
    staging = TARGET.with_name("2024.next")
    shutil.rmtree(staging, ignore_errors=True)
    (staging / "towns").mkdir(parents=True)
    (staging / "villages").mkdir()
    def save(name, value):
        (staging / name).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    def part(level, parent, records):
        return dict(year=2024, level=level, parentCode=parent, records=records)
    save("counties.json", part("county", None, county_records))
    for county in counties:
        code = county["id"]
        save(f"towns/{code}.json", part("town", code, {k:r for k,r in town_records.items() if r["countyCode"]==code}))
    for town_code in villages_by_town:
        save(f"villages/{town_code}.json", part("village", town_code, {k:r for k,r in village_records.items() if r["townCode"]==town_code}))
    save("manifest.json", manifest)
    save("join-report.json", report)
    shutil.rmtree(TARGET, ignore_errors=True)
    staging.rename(TARGET)
    (ROOT / "data/income").mkdir(exist_ok=True)
    (ROOT / "data/income/sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print("Income records:", manifest["counts"])
    print("Coverage:", manifest["coverage"])
    print("Village income distribution (萬元):", manifest["villageDistributionWan"])
    print("Unmatched named income villages:", [(r["county"],r["town"],r.get("village")) for r in unmatched if r["kind"] == "unmatched"])
    print("Current named polygons without 2024 data:", len(missing_villages))


if __name__ == "__main__":
    build()
