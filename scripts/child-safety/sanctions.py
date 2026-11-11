"""Fetch currently public preschool sanctions, preserving complete county pagination."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from http.cookiejar import CookieJar
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlencode, urljoin
from urllib.request import build_opener, HTTPCookieProcessor

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/child-safety/sanctions"
BASE = "https://ap.ece.moe.edu.tw/webecems/"
SEARCH = BASE + "punishSearch.aspx"

class Document(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.elements = {}
        self.plain_text = []
        self.fields = {}
        self.active = []
        self.options = {}
        self.select = None
        self.option = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        identity = attrs.get("id")
        if tag == "input" and attrs.get("type") == "hidden" and attrs.get("name"):
            self.fields[attrs["name"]] = attrs.get("value", "")
        if identity:
            self.elements[identity] = {"attrs": attrs, "text": ""}
        if tag not in ("input", "br", "img", "meta", "link", "hr"):
            self.active.append((tag, identity))
        if tag == "br":
            self.handle_data("\n")
        if tag == "select":
            self.select = attrs.get("name")
        if tag == "option":
            self.option = attrs.get("value", "")
            self.options[(self.select, self.option)] = ""

    def handle_data(self, text):
        self.plain_text.append(text)
        for _, identity in self.active:
            if identity:
                self.elements[identity]["text"] += text
        if self.option is not None:
            self.options[(self.select, self.option)] += text

    def handle_endtag(self, tag):
        if tag == "option":
            self.option = None
        if tag == "select":
            self.select = None
        for index in range(len(self.active) - 1, -1, -1):
            if self.active[index][0] == tag:
                self.active = self.active[:index]
                break

def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)

def request(opener, url, fields=None):
    for attempt in range(4):
        try:
            response = opener.open(url, urlencode(fields).encode() if fields is not None else None, timeout=40)
            text = response.read().decode("utf-8-sig")
            return Document(text), sha256(text.encode()).hexdigest()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)

def popup(element):
    match = re.search(r"window.open\('([^']+)'", element["attrs"].get("onclick", ""))
    if not match:
        raise ValueError("Missing official detail URL")
    return urljoin(BASE, match[1])

def text(document, identity):
    return re.sub(r"[ \t\r\f\v]+", " ", document.elements[identity]["text"]).strip()

def fetch_county(entry):
    city, name = entry
    destination = RAW / f"{city}.json"
    if destination.exists():
        saved = json.loads(destination.read_text())
        if saved.get("complete") and "--refresh" not in sys.argv and saved["retrievedAt"][:10] == datetime.now(timezone.utc).date().isoformat():
            print(f"{name}: using complete snapshot ({len(saved['schools'])} schools)", flush=True)
            return saved
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    first, _ = request(opener, SEARCH)
    fields = dict(first.fields)
    fields.update(ddlKey="school_name", txtKeyNameS="", ddlCityS=city, ddlAreaS="", btnSearch="搜尋")
    page, _ = request(opener, SEARCH, fields)
    schools = []
    seen_pages = set()
    page_number = 0
    while True:
        page_number += 1
        identities = sorted((key for key in page.elements if re.fullmatch(r"GridView1_lblSchName_\d+", key)),
                            key=lambda key: int(key.rsplit("_", 1)[1]))
        names = tuple(text(page, identity) for identity in identities)
        assert names not in seen_pages, f"Repeated result page: {name}"
        seen_pages.add(names)
        if not identities:
            # Empty results must be explicitly identified by the official page.
            assert any(label in "".join(page.plain_text) for label in ("查無資料", "查無符合", "無符合", "無資料")), name
        for identity in identities:
            index = identity.rsplit("_", 1)[1]
            detail_url = popup(page.elements[f"GridView1_lbView_{index}"])
            detail, detail_digest = request(opener, detail_url)
            sanctions = []
            for key in sorted(detail.elements):
                match = re.fullmatch(r"GridView1_lblPDate_(\d+)", key)
                if not match:
                    continue
                n = match[1]
                fields = {}
                for field, label in [("date", "PDate"), ("schoolName", "PShName"), ("document", "PGNum"),
                                     ("basis", "PName"), ("violation", "PDetail"), ("subject", "PObject"), ("disposition", "PContent")]:
                    fields[field] = text(detail, f"GridView1_lbl{label}_{n}")
                assert re.fullmatch(r"\d{4}/\d{2}/\d{2}", fields["date"]) and fields["document"] and fields["disposition"]
                sanctions.append(fields)
            assert sanctions, f"Missing sanction rows for {name} {names}"
            map_url = popup(page.elements[f"GridView1_hlAddr_{index}"])
            map_document, _ = request(opener, map_url)
            info = map_document.elements.get("hInfo", {}).get("attrs", {}).get("value", "")
            position = None
            parts = info.split(",")
            if len(parts) >= 2:
                try:
                    lat, lon = float(parts[0]), float(parts[1])
                    if 118 <= lon <= 123 and 21 <= lat <= 27:
                        position = [lon, lat]
                except ValueError:
                    pass
            school = {"name": text(page, identity), "city": name,
                      "townName": text(page, f"GridView1_lblArea_{index}"),
                      "address": text(page, f"GridView1_hlAddr_{index}"),
                      "status": text(page, f"GridView1_lblBStatus_{index}"),
                      "sourceUrl": detail_url, "sourceSha256": detail_digest,
                      "position": position, "sanctions": sanctions}
            schools.append(school)
        print(f"{name}: page {page_number}, {len(schools)} schools", flush=True)
        next_link = page.elements.get("PageControl1_lbNextPage", {}).get("attrs", {}).get("href", "")
        if "__doPostBack" not in next_link:
            break
        fields = dict(page.fields)
        fields.update(ddlKey="school_name", txtKeyNameS="", ddlCityS=city, ddlAreaS="",
                      __EVENTTARGET="PageControl1$lbNextPage", __EVENTARGUMENT="")
        page, _ = request(opener, SEARCH, fields)
        assert page_number < 300
    result = {"city": city, "name": name, "complete": True, "pages": page_number, "schools": schools,
              "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sourceUrl": SEARCH}
    dump(destination, result)
    return result

def main():
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    form, _ = request(opener, SEARCH)
    counties = [(code, label.strip()) for (field, code), label in form.options.items() if field == "ddlCityS" and code]
    assert len(counties) == 22
    RAW.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as executor:
        snapshots = list(executor.map(fetch_county, counties))
    dump(RAW / "manifest.json", {"counties": [{"file": row["city"] + ".json", "name": row["name"],
         "pages": row["pages"], "schools": len(row["schools"]),
         "records": sum(len(s["sanctions"]) for s in row["schools"]),
         "sha256": sha256((RAW / (row["city"] + ".json")).read_bytes()).hexdigest()} for row in snapshots]})
    print("Completed all 22 counties", flush=True)

if __name__ == "__main__":
    main()
