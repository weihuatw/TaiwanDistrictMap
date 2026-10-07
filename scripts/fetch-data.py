#!/usr/bin/env python3
"""Download the NLSC releases linked by data.gov.tw. No API key is required."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.parse
import subprocess
import zipfile
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    {
        "level": "county",
        "title": "直轄市、縣市界線(TWD97經緯度)",
        "datasetUrl": "https://data.gov.tw/dataset/7442",
        "downloadUrl": "https://www.tgos.tw/tgos/VirtualDir/Product/1cd4f4c9-6b01-4cf9-bf6c-23a73aa17d24/直轄市、縣(市)界線1140318.zip",
        "metadataUpdated": "2025-12-16",
        "catalogReleaseDate": "2025-04-16",
    },
    {
        "level": "town",
        "title": "鄉鎮市區界線(TWD97經緯度)",
        "datasetUrl": "https://data.gov.tw/dataset/7441",
        "downloadUrl": "https://www.tgos.tw/tgos/VirtualDir/Product/3fe61d4a-ca23-4f45-8aca-4a536f40f290/鄉(鎮、市、區)界線1140318.zip",
        "metadataUpdated": "2025-12-24",
        "catalogReleaseDate": "2025-04-16",
    },
    {
        "level": "village",
        "title": "村里界圖(TWD97經緯度)",
        "datasetUrl": "https://data.gov.tw/dataset/7438",
        "downloadUrl": "https://www.tgos.tw/tgos/VirtualDir/Product/a04697c8-64db-450a-a105-3eb471c45abd/村(里)界(TWD97經緯度).zip",
        "metadataUpdated": "2026-08-25",
        "catalogReleaseDate": "2026-08-26",
    },
]


def download(source):
    folder = ROOT / "data" / "raw" / source["level"]
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / "source.zip"
    url = urllib.parse.quote(source["downloadUrl"], safe=":/()")
    subprocess.run([
        "curl", "--fail", "--location", "--silent", "--show-error",
        "--retry", "2", "--connect-timeout", "20", "--max-time", "180",
        "--output", str(archive), url,
    ], check=True)
    with zipfile.ZipFile(archive) as zipped:
        # Validate paths before extracting the public release.
        for item in zipped.infolist():
            target = (folder / item.filename).resolve()
            if not target.is_relative_to(folder.resolve()):
                raise ValueError(f"Unsafe archive path: {item.filename}")
        zipped.extractall(folder)
    shapes = sorted(folder.rglob("*.shp"))
    main_shapes = [shape for shape in shapes if shape.stem.startswith(("COUNTY_MOI_", "TOWN_MOI_", "VILLAGE_NLSC_"))]
    if len(main_shapes) != 1:
        raise ValueError(f"Expected one national shapefile in {source['level']}, got {len(main_shapes)}")
    main = main_shapes[0]
    result = {
        **source,
        "provider": "內政部國土測繪中心",
        "catalogUrl": "https://whgis-nlsc.moi.gov.tw/Opendata/Files.aspx",
        "catalogVerifiedAt": "2026-10-07",
        "license": "政府資料開放授權條款－第1版",
        "licenseUrl": "https://data.gov.tw/license",
        "downloadedAt": datetime.now(ZoneInfo("Asia/Taipei")).isoformat(timespec="seconds"),
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "archiveBytes": archive.stat().st_size,
        "shapefile": str(main.relative_to(ROOT)),
        "supplementaryFiles": [str(shape.relative_to(ROOT)) for shape in shapes if shape != main],
        "releaseFile": main.stem,
    }
    print(f"{source['level']}: {main.name} ({archive.stat().st_size:,} bytes)", flush=True)
    return result


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        releases = list(pool.map(download, SOURCES))
    output = ROOT / "data" / "sources.json"
    output.write_text(json.dumps(releases, ensure_ascii=False, indent=2) + "\n")
    print(f"Recorded source versions in {output}")
