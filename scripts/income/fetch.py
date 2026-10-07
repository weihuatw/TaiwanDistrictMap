#!/usr/bin/env python3
"""Fetch the official 2024 preliminary HTML archive, without an API key."""
from pathlib import Path
import subprocess
from zipfile import ZipFile

root = Path(__file__).resolve().parents[2]
folder = root / "data/raw/income/113"
folder.mkdir(parents=True, exist_ok=True)
destination = folder / "source.zip"
temporary = folder / "source.download.zip"
subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2", "--connect-timeout", "20", "--max-time", "120",
                "https://www.fia.gov.tw/download/13a9ac5e8b8e479d82c95daf9424dc08", "--output", str(temporary)], check=True)
with ZipFile(temporary) as archive:
    assert sum(n.endswith('.html') and '/113_165-' in n for n in archive.namelist()) == 22
temporary.replace(destination)
print(f"Saved official HTML archive: {destination}")
