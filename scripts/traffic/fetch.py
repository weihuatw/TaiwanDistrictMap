"""Download pinned official resources; keep original bytes and SHA-256 provenance."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]

def main():
    path = ROOT / 'data/traffic/sources.json'
    sources = json.loads(path.read_text())
    folder = ROOT / 'data/raw/traffic'
    folder.mkdir(parents=True, exist_ok=True)
    def fetch(row):
        target = folder / row['file']
        if not target.exists() or target.stat().st_size == 0:
            subprocess.run(['curl', '-L', '--fail', '--retry', '3', '--max-time', '600', '-sS', row['url'], '-o', str(target)], check=True)
        row['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        row['bytes'] = target.stat().st_size
        row.setdefault('retrievedAt', datetime.now(timezone.utc).isoformat())
        print(row['file'], row['bytes'], flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, sources['resources']))
    path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
