#!/usr/bin/env python3
"""Download official school campuses and Taipei's 115 catchment tables."""
import hashlib
import json
import subprocess
import urllib.parse
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [
    dict(id='campus-119', title='各級學校範圍圖_119分帶', provider='內政部國土測繪中心',
         datasetUrl='https://data.gov.tw/dataset/174605', release='1150127',
         downloadUrl='https://www.tgos.tw/tgos/VirtualDir/Product/d8e02080-95b2-499f-b1e1-fb33dfd6bb90/各級學校範圍圖_119_1150127.zip'),
    dict(id='campus-121', title='各級學校範圍圖_121分帶', provider='內政部國土測繪中心',
         datasetUrl='https://data.gov.tw/dataset/174606', release='1150409',
         downloadUrl='https://www.tgos.tw/tgos/VirtualDir/Product/5f346c6b-edde-4fe7-8685-5585c0fb7852/各級學校範圍圖_121_1150409.zip'),
    dict(id='taipei-elementary', title='臺北市115學年度國民小學里鄰學區對照表', provider='臺北市政府教育局',
         datasetUrl='https://data.taipei/dataset/detail?id=678c5215-f14a-47e3-92bd-da43f9d7c7a9', release='115學年度',
         downloadUrl='https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=4ebe14e0-5539-4b43-985c-d3a0a5b351c9'),
    dict(id='taipei-junior', title='臺北市115學年度國民中學里鄰學區對照表', provider='臺北市政府教育局',
         datasetUrl='https://data.taipei/dataset/detail?id=678c5215-f14a-47e3-92bd-da43f9d7c7a9', release='115學年度',
         downloadUrl='https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=bb9a06d4-69b1-4987-8660-858790f389b3'),
    dict(id='taipei-shelters', title='避難收容處所點位檔（長安國小位置）', provider='內政部消防署',
         datasetUrl='https://data.gov.tw/dataset/73242', release='2026-10-08下載',
         downloadUrl='https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/ED6CF735-6C03-4573-A882-72C1BEC799CB/resource/54550E2F-4567-4C8F-BD2E-E54E9D0386B8/download'),
    dict(id='taipei-garden', title='和平實驗國小校園田園位置', provider='臺北市政府教育局環境教育網',
         datasetUrl='https://ee.tp.edu.tw/report_history/?id=4874&mode=detail&node=27&type=rural', release='2026-10-08核對',
         downloadUrl='https://ee.tp.edu.tw/report_history/?id=4874&mode=detail&node=27&type=rural'),
]


def record(source, file):
    return {**source, 'downloadedAt': datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds'),
            'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size,
            'licenseUrl': 'https://data.gov.tw/license'}


def main():
    raw = ROOT / 'data/raw/school'
    raw.mkdir(parents=True, exist_ok=True)
    releases = []
    for source in SOURCES:
        campus = source['id'].startswith('campus')
        file = raw / source['id'] / 'source.zip' if campus else raw / (source['id'] + ('.html' if source['id']=='taipei-garden' else '.csv'))
        file.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--retry', '2',
                        '--max-time', '180', '--output', str(file),
                        urllib.parse.quote(source['downloadUrl'], safe=':/?=&')], check=True)
        if campus:
            with zipfile.ZipFile(file) as archive:
                for entry in archive.infolist():
                    suffix = Path(entry.filename).suffix.lower()
                    if suffix in ('.shp', '.dbf', '.shx', '.prj', '.cpg'):
                        # Ignore archive paths; extract known component types to fixed local names.
                        (file.parent / ('campus' + suffix)).write_bytes(archive.read(entry))
        releases.append(record(source, file))
        print(source['id'], file.stat().st_size)
    output = ROOT / 'data/school/sources.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(releases, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
