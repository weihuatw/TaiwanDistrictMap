"""Download, build, or check the public child safety map data."""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.request import urlretrieve
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/child-safety"
PUBLIC = ROOT / "public/data/child-safety"
DATA = PUBLIC.parent
YEARS = (2024, 2025)
TOTALS = {2024: (118497, 25003, 10810, 3342385), 2025: (136592, 24665, 9898, 3243464)}
MOHW = "https://www.mohw.gov.tw/"
POPULATION = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/"
SOURCES = {
    "reports.xlsx": MOHW + "dl-22362-ef8b40e4-3ea4-4004-a1a6-2017c70da9d4.html",
    "abused.xlsx": MOHW + "dl-22367-6cf8f862-9c05-49e9-9f1c-25185bd8bc36.html",
    "preschool.xlsx": "https://crc.sfaa.gov.tw/Uploadfile/Statiscs/80_20260907145222_3302322.xlsx",
    "schools.csv": "https://stats.moe.gov.tw/files/opendata/k1_new.csv",
}
for year in YEARS:
    month = f"{year - 1911}12"
    for page in range(1, 5):
        SOURCES[f"{month}-{page}.json"] = f"{POPULATION}{month}?page={page}"

def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

def boundaries(file):
    return {f["properties"]["code"]: f["properties"]["name"] for f in read_json(DATA / file)["features"]}

def normalized(name):
    return re.sub(r"\s+", "", name).replace("台", "臺")

def workbook_rows(file, sheet_name):
    with ZipFile(RAW / file) as book:
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        sheet, = (s for s in workbook.findall(".//{*}sheet") if s.get("name") == sheet_name and s.get("state", "visible") == "visible")
        relation_id = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        target, = (r.get("Target") for r in relations if r.get("Id") == relation_id)
        shared = ["".join(t.text or "" for t in item.findall(".//{*}t"))
                  for item in ET.fromstring(book.read("xl/sharedStrings.xml"))]
        for row in ET.fromstring(book.read("xl/" + target)).findall(".//{*}row"):
            yield {c.get("r").rstrip("0123456789"): shared[int(v.text)] if c.get("t") == "s" else v.text
                   for c in row if (v := c.find("{*}v")) is not None and v.text is not None}

def population(year, counties):
    month = f"{year - 1911}12"
    people = dict.fromkeys(counties, 0)
    seen = set()
    for page in range(1, 5):
        data = read_json(RAW / f"{month}-{page}.json")
        assert data["responseCode"] == "OD-0101-S" and int(data["page"]) == page and int(data["totalPage"]) == 4
        assert int(data["pageDataSize"]) == len(data["responseData"])
        for record in data["responseData"]:
            code = record["district_code"]
            assert record["statistic_yyymm"] == month and re.fullmatch(r"\d{11}", code) and code not in seen
            seen.add(code)
            ages = [int(record[f"people_age_{age:03}_{sex}"]) for age in range(18) for sex in "mf"]
            assert min(ages) >= 0 and sum(ages) <= int(record["people_total"])
            people[code[:5]] += sum(ages)
    assert len(seen) == int(data["totalDataSize"])
    return {"TW": sum(people.values()), **people}

def build_statistics(counties):
    codes = {normalized(name): code for code, name in counties.items()} | {"總計": "TW"}
    snapshots = {}
    for year in YEARS:
        report_rows = list(workbook_rows("reports.xlsx", str(year)))
        assert "兒少保護通報案件" in report_rows[3]["B"] and "社會安全網事件諮詢" in report_rows[3]["V"]
        assert "有效案件總計" in report_rows[4]["AK"]
        abuse_rows = list(workbook_rows("abused.xlsx", str(year)))
        assert abuse_rows[4]["D"].startswith("合計")
        records = {}
        for row in report_rows[7:30]:
            name = normalized(re.split(r"[A-Za-z]", row["A"], maxsplit=1)[0])
            code = codes[name]
            assert code not in records
            fields = dict(zip(("reports", "consultations", "valid", "protection", "exploitation", "welfare", "referrals", "other"),
                              (int(row[column]) for column in ("B", "V", "AK", "AL", "AM", "AN", "AO", "AP"))))
            records[code] = fields
        people = population(year, counties)
        for row in abuse_rows:
            if row.get("B") == "計":
                code = codes[normalized(row["A"])]
                assert "abused" not in records[code]
                records[code].update(abused=int(row["D"]), population=people[code])
        snapshots[str(year)] = records
    preschool = {}
    for row in workbook_rows("preschool.xlsx", "工作表1"):
        if row.get("A") == "年別":
            categories = {column: label for column, label in row.items() if column not in ("A", "B")}
        elif re.fullmatch(r"20\d{2}", row.get("A", "")):
            preschool[row["A"]] = {"total": int(row["B"]), "categories": {label: int(row[column]) for column, label in categories.items()}}
    return {"schemaVersion": 1, "years": snapshots, "preschool": preschool,
            "sources": {name: {"url": url, "sha256": hashlib.sha256((RAW / name).read_bytes()).hexdigest()}
                        for name, url in SOURCES.items()}}

def build_directory(counties):
    codes = {normalized(name): code for code, name in counties.items()}
    towns = {code: {normalized(name): key for key, name in boundaries(f"towns/{code}.geojson").items()}
             for code in counties}
    with (RAW / "schools.csv").open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    year = max(int(row["學年度"]) for row in rows)
    directory = {code: [] for code in counties}
    seen = set()
    for row in rows:
        if int(row["學年度"]) != year:
            continue
        code = codes[normalized(re.sub(r"^\[\d+\]", "", row["縣市名稱"]))]
        town = normalized(row["鄉鎮市區名稱"])
        identity = row["代碼"].strip()
        assert identity and identity not in seen
        seen.add(identity)
        directory[code].append({"id": identity, "name": row["學校名稱"].strip(),
                                "town": towns[code][town], "townName": town,
                                "address": re.sub(r"^\[\d+\]", "", row["地址"]).strip()})
    for code, records in directory.items():
        write_json(PUBLIC / "schools" / f"{code}.json", {"year": year, "records": sorted(records, key=lambda row: row["id"])})
    return year

def check(counties):
    data = read_json(PUBLIC / "statistics.json")
    assert data["schemaVersion"] == 1 and list(map(int, data["years"])) == list(YEARS)
    for year, records in data["years"].items():
        assert set(records) == {"TW", *counties}
        expected = TOTALS[int(year)]
        for field, total in zip(("reports", "consultations", "abused", "population"), expected):
            assert records["TW"][field] == total, (year, field, records["TW"][field])
        for field, value in records["TW"].items():
            assert sum(records[code][field] for code in counties) == value, (year, field)
        for code, row in records.items():
            assert all(type(value) is int and value >= 0 for value in row.values()) and row["population"] > 0
            assert sum(row[key] for key in ("protection", "exploitation", "welfare", "referrals", "other")) == row["valid"], (year, code)
    assert data["preschool"]["2025"]["total"] == 262
    for row in data["preschool"].values():
        assert sum(row["categories"].values()) == row["total"]
    seen = set()
    for code in counties:
        directory = read_json(PUBLIC / "schools" / f"{code}.json")
        assert directory["year"] == data["schoolYear"] and directory["records"]
        towns = boundaries(f"towns/{code}.geojson")
        for record in directory["records"]:
            assert record["id"] not in seen and record["town"] in towns and record["name"] and record["address"]
            seen.add(record["id"])
    print(f"Child safety: {len(counties)} counties, {len(YEARS)} years, {len(seen)} kindergartens")

def main(action):
    if action == "fetch":
        RAW.mkdir(parents=True, exist_ok=True)
        for name, url in SOURCES.items():
            temporary = RAW / f"{name}.download"
            urlretrieve(url, temporary)
            temporary.replace(RAW / name)
        return
    counties = boundaries("counties.geojson")
    if action == "build":
        statistics = build_statistics(counties)
        statistics["schoolYear"] = build_directory(counties)
        write_json(PUBLIC / "statistics.json", statistics)
    check(counties)

if __name__ == "__main__":
    main(sys.argv[1])
