"""Build current official sanctions into county shards and a small map index."""
from hashlib import sha256
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).parent))
from data import ROOT, PUBLIC, boundaries, normalized, read_json, write_json
RAW = ROOT / "data/raw/child-safety/sanctions"

def inside_ring(point, ring):
    x, y = point
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside

def inside_geometry(point, geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return any(inside_ring(point, polygon[0]) and not any(inside_ring(point, hole) for hole in polygon[1:])
               for polygon in polygons)

def build():
    manifest = read_json(RAW / "manifest.json")
    assert len(manifest["counties"]) == 22
    counties = {normalized(name): code for code, name in boundaries("counties.geojson").items()}
    index = {"schemaVersion": 1, "sourceUrl": "https://ap.ece.moe.edu.tw/webecems/punishSearch.aspx",
             "counties": {}, "schools": [], "snapshots": []}
    seen = set()
    for entry in manifest["counties"]:
        path = RAW / entry["file"]
        assert sha256(path.read_bytes()).hexdigest() == entry["sha256"], "Snapshot changed after completed crawl"
        snapshot = read_json(path)
        assert snapshot["complete"] and snapshot["name"] == entry["name"]
        county = counties[normalized(snapshot["name"])]
        towns = {normalized(name): code for code, name in boundaries(f"towns/{county}.geojson").items()}
        town_features = {f["properties"]["code"]: f for f in read_json(PUBLIC.parent / f"towns/{county}.geojson")["features"]}
        records = []
        for school in snapshot["schools"]:
            town = towns.get(normalized(school["townName"]))
            # Keep records from any obsolete/unknown township in the county list.
            identity = sha256((county + school["name"] + school["address"]).encode()).hexdigest()[:16]
            assert identity not in seen
            seen.add(identity)
            position = school["position"]
            position_status = "official" if position else "missing"
            if position and (not town or not inside_geometry(position, town_features[town]["geometry"])):
                position = None
                position_status = "outside-town"
            records.append({"id": identity, "county": county, "name": school["name"], "town": town,
                            "townName": school["townName"], "address": re.sub(r"^\[\d+\]", "", school["address"]),
                            "status": school["status"], "position": position, "positionStatus": position_status,
                            "sourceUrl": index["sourceUrl"], "sourceSha256": school["sourceSha256"],
                            "sanctions": school["sanctions"]})
            index["schools"].append({key: records[-1][key] for key in ("id", "county", "name", "position")}
                                   | {"count": len(school["sanctions"])})
        summary = {"schools": len(records), "records": sum(len(s["sanctions"]) for s in records),
                   "positioned": sum(s["position"] is not None for s in records), "pages": snapshot["pages"],
                   "retrievedAt": snapshot["retrievedAt"]}
        assert summary["schools"] == entry["schools"] and summary["records"] == entry["records"]
        index["counties"][county] = summary
        index["snapshots"].append({"county": county, "sha256": sha256(path.read_bytes()).hexdigest()})
        write_json(PUBLIC / "sanctions" / f"{county}.json", {"county": county, **summary, "schools": records})
    write_json(PUBLIC / "sanctions.json", index)
    check()

def check():
    index = read_json(PUBLIC / "sanctions.json")
    assert index["schemaVersion"] == 1
    assert set(index["counties"]) == set(boundaries("counties.geojson"))
    seen = {}
    for county, summary in index["counties"].items():
        shard = read_json(PUBLIC / "sanctions" / f"{county}.json")
        assert shard["county"] == county
        assert summary["schools"] == len(shard["schools"])
        assert summary["records"] == sum(len(s["sanctions"]) for s in shard["schools"])
        assert summary["positioned"] == sum(s["position"] is not None for s in shard["schools"])
        town_features = {f["properties"]["code"]: f for f in read_json(PUBLIC.parent / f"towns/{county}.geojson")["features"]}
        for school in shard["schools"]:
            assert school["id"] not in seen and school["county"] == county
            assert school["sourceUrl"] == index["sourceUrl"]
            assert re.fullmatch(r"[a-f0-9]{64}", school["sourceSha256"]) and school["sanctions"] and school["name"]
            if school["position"] is not None:
                lon, lat = school["position"]
                assert 118 <= lon <= 123 and 21 <= lat <= 27
                assert school["town"] in town_features and inside_geometry(school["position"], town_features[school["town"]]["geometry"])
            seen[school["id"]] = school
            for sanction in school["sanctions"]:
                assert re.fullmatch(r"\d{4}/\d{2}/\d{2}", sanction["date"])
                assert sanction["document"] and sanction["disposition"]
    assert {s["id"] for s in index["schools"]} == set(seen)
    for school in index["schools"]:
        assert school["count"] == len(seen[school["id"]]["sanctions"])
        assert school["position"] == seen[school["id"]]["position"]
    print(f"Sanctions: {len(seen)} schools, {sum(len(s['sanctions']) for s in seen.values())} records, "
          f"{sum(s['position'] is not None for s in seen.values())} positions")

if __name__ == "__main__":
    (check if "check" in sys.argv else build)()
