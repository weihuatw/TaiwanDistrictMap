#!/usr/bin/env python3
"""Build deterministic, browser-ready housing summaries and transaction shards."""
import csv
import hashlib
import gzip
import io
import json
import pathlib
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

from normalize import classify, deduplicate_address_prefix, normalize_address, number, percentile, roc_date, summary

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw/housing'
PUBLIC = ROOT / 'public/data/housing'
STAGING = ROOT / 'public/data/.housing-building'
PAGE_SIZE = 250
GROUPS = ('standard', 'apartment', 'elevator_low', 'elevator_high', 'house')
ALIAS = {'台北市':'臺北市','台中市':'臺中市','台南市':'臺南市','台東縣':'臺東縣'}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')


def dump_gzip(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload=(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    path.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))


def name_key(s):
    return re.sub(r'\s+', '', s or '').replace('台', '臺')


def codes():
    counties = json.loads((ROOT / 'public/data/counties.geojson').read_text())['features']
    towns_by_county, code_by_name = {}, {}
    for county in counties:
        p = county['properties']; county_name = name_key(p['name']); county_code = p['code']
        file = ROOT / f'public/data/towns/{county_code}.geojson'
        features = json.loads(file.read_text())['features']
        town_map = {}
        for feature in features:
            q = feature['properties']; name = name_key(q['name'])
            town_map[name] = q['code']
        towns_by_county[county_name] = town_map
        code_by_name[county_name] = county_code
    return towns_by_county, code_by_name


def rows_from_archives():
    manifest = json.loads((ROOT / 'data/housing/sources.json').read_text())
    ranks = {b['batch']: i for i,b in enumerate(manifest['batches'])}
    selected, conflicts, input_counts = {}, [], Counter()
    for batch_info in manifest['batches']:
        batch = batch_info['batch']
        archive_path = RAW / batch_info['file']
        if not archive_path.exists(): continue
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            manifest_rows = list(csv.DictReader(io.StringIO(archive.read('manifest.csv').decode('utf-8-sig'))))
            for item in manifest_rows:
                file_name = item.get('name','')
                if not file_name.endswith('_lvr_land_a.csv') or file_name not in names: continue
                county = name_key(item.get('description','').split('不動產')[0])
                if county.endswith('買賣'): county = county[:-2]
                county = ALIAS.get(county, county)
                content = archive.read(file_name).decode('utf-8-sig')
                parsed = list(csv.DictReader(io.StringIO(content)))
                if parsed and parsed[0].get('鄉鎮市區') == 'The villages and towns urban district':
                    parsed = parsed[1:]
                elif parsed and parsed[0].get('鄉鎮市區','').startswith('The villages'):
                    raise ValueError(f'Unexpected English row: {batch}/{file_name}')
                for row_no, row in enumerate(parsed, start=2):
                    input_counts[batch] += 1
                    date_value = roc_date(row.get('交易年月日'))
                    if not date_value or date_value[:4] not in ('2024','2025'): continue
                    input_counts['candidateRowsInPeriod'] += 1
                    serial = (row.get('編號') or '').strip()
                    identity = f'{county}:{serial}' if serial else hashlib.sha256((batch+file_name+json.dumps(row,ensure_ascii=False,sort_keys=True)).encode()).hexdigest()
                    row_hash = hashlib.sha256(json.dumps(row,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
                    current = {'row': row, 'county': county, 'date': date_value, 'batch': batch,
                               'file': file_name, 'rowNumber': row_no, 'rowHash': row_hash, 'rank': ranks[batch]}
                    previous = selected.get(identity)
                    if previous and previous['rowHash'] != row_hash:
                        conflicts.append({'id': identity,'keptBatch':batch if current['rank']>=previous['rank'] else previous['batch'],
                                          'otherBatch':previous['batch'] if current['rank']>=previous['rank'] else batch})
                    if previous is None or current['rank'] >= previous['rank']:
                        selected[identity] = current
    input_counts['duplicateRowsInPeriod'] = input_counts['candidateRowsInPeriod'] - len(selected)
    return list(selected.values()), conflicts, input_counts, manifest


def main():
    towns_by_county, county_codes = codes()
    source_rows, conflicts, input_counts, source = rows_from_archives()
    normalized, outcomes, unresolved, reasons, town_misses, county_misses = [], Counter(), Counter(), Counter(), Counter(), Counter()
    for item in source_rows:
        row = item['row']; county = item['county']; town_name = name_key(row.get('鄉鎮市區',''))
        county_code = county_codes.get(county); town_code = towns_by_county.get(county,{}).get(town_name)
        if not county_code: outcomes['county_unresolved'] += 1; county_misses[county] += 1; continue
        outcome = classify(row); building_area=number(row.get('建物移轉總面積平方公尺'))
        address = deduplicate_address_prefix(row.get('土地位置建物門牌',''), county, row.get('鄉鎮市區',''))
        sale = {'id': f"{county_code}:{(row.get('編號') or item['rowHash'])}",
            'countyCode': county_code, 'townCode': town_code, 'townName': row.get('鄉鎮市區',''),
            'tradeDate': item['date'], 'address': address, 'addressNormalized':normalize_address(address),
            'target': row.get('交易標的',''), 'buildingType': row.get('建物型態',''),
            'buildingTypeGroup': outcome['buildingTypeGroup'], 'mainUse': row.get('主要用途',''),
            'totalPriceTwd': int(number(row.get('總價元'))) if number(row.get('總價元')) is not None else None,
            'buildingAreaM2': building_area, 'parkingAreaM2': number(row.get('車位移轉總面積平方公尺')),
            'parkingPriceTwd': int(number(row.get('車位總價元'))) if number(row.get('車位總價元')) is not None else None, 'parkingCount': outcome['parkingCount'],
            'sourceUnitPriceTwdM2': number(row.get('單價元平方公尺')),
            'unitPriceTwdM2': outcome['unitPriceTwdM2'], 'priceBasis': outcome['priceBasis'],
            'rooms': int(number(row.get('建物現況格局-房'))) if number(row.get('建物現況格局-房')) is not None else None,
            'halls': int(number(row.get('建物現況格局-廳'))) if number(row.get('建物現況格局-廳')) is not None else None,
            'bathrooms': int(number(row.get('建物現況格局-衛'))) if number(row.get('建物現況格局-衛')) is not None else None,
            'floor': row.get('移轉層次',''),
            'note': row.get('備註',''), 'flags': outcome['flags'], 'eligible': outcome['eligible'],
            'reasons': outcome['reasons'], 'sourceBatch': item['batch'], 'sourceSerial': row.get('編號','')}
        if town_code is None:
            outcomes['town_unresolved'] += 1; town_misses[(county,town_name)] += 1; sale['reasons'] = [*sale['reasons'],'town_unresolved']
        else: outcomes['assigned_town'] += 1
        outcomes['source_rows_2024_2025'] += 1
        for reason in sale['reasons']: reasons[reason] += 1
        normalized.append(sale)

    by_town_year = defaultdict(list)
    for sale in normalized:
        in_housing_scope = sale['buildingTypeGroup'] in GROUPS and sale['mainUse'] == '住家用'
        flagged_residential_case = bool(sale['flags']) and sale['buildingTypeGroup'] in GROUPS
        if sale['townCode'] and (in_housing_scope or flagged_residential_case):
            by_town_year[(sale['tradeDate'][:4],sale['townCode'])].append(sale)
    stats = {year:{group:{'county':defaultdict(list),'town':defaultdict(list)} for group in GROUPS} for year in ('2024','2025')}
    for (year, town), sales in by_town_year.items():
        for group in GROUPS:
            members=[]
            for sale in sales:
                applies = (sale['buildingTypeGroup'] == group if group != 'standard' else sale['buildingTypeGroup'] in GROUPS[:-1])
                if applies and sale['mainUse'] == '住家用': members.append(sale)
            stats[year][group]['town'][town].extend(members)
            if members: stats[year][group]['county'][members[0]['countyCode']].extend(members)
    # Keep sales that lack a reliable town match in the county roll-up. The
    # source only provides free-form addresses, so do not infer a town from
    # street names or land-section names without an authoritative geocoder.
    for sale in normalized:
        if sale['townCode'] is not None:
            continue
        for group in GROUPS:
            applies = (sale['buildingTypeGroup'] == group if group != 'standard' else sale['buildingTypeGroup'] in GROUPS[:-1])
            if applies and sale['mainUse'] == '住家用':
                stats[sale['tradeDate'][:4]][group]['county'][sale['countyCode']].append(sale)

    import shutil
    if STAGING.exists(): shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)
    # Write a full new version alongside the last usable output.
    for year in ('2024','2025'):
        for group in GROUPS:
            subset = stats[year][group]
            national_records = [sale for sale in normalized
                                if sale['tradeDate'].startswith(year)
                                and sale['mainUse'] == '住家用'
                                and (sale['buildingTypeGroup'] == group if group != 'standard' else sale['buildingTypeGroup'] in GROUPS[:-1])]
            national = {'code':'TW', **summary([x for x in national_records if x['eligible']]),
                        'transactionCount':len(national_records),'residentialCount':len(national_records),
                        'parkingUnknownCount':sum(x['priceBasis']=='parking_included_unknown' for x in national_records),
                        'excludedCount':sum(not x['eligible'] for x in national_records)}
            dump(STAGING/'summary'/year/group/'national.json', {'year':int(year),'group':group,'summary':national})
            for level in ('county','town'):
                records={}
                if level == 'county': codes_to_write = county_codes.values()
                else: codes_to_write = [code for town_map in towns_by_county.values() for code in town_map.values()]
                for code in codes_to_write:
                    transactions = subset[level].get(code, [])
                    records[code] = {'code':code, **summary([x for x in transactions if x['eligible']]),
                                     'transactionCount':len(transactions),
                                     'residentialCount':len(transactions),
                                     'parkingUnknownCount':sum(x['priceBasis']=='parking_included_unknown' for x in transactions),
                                     'excludedCount':sum(not x['eligible'] for x in transactions)}
                if level == 'county': path=STAGING / 'summary' / year / group / 'counties.json'
                else:
                    # One file per owning county, keyed by current official town string code.
                    all_county_codes=set(county_codes.values())
                    for county_code in all_county_codes:
                        feature_codes=set(towns_by_county.get(next((n for n,c in county_codes.items() if c==county_code),''),{}).values())
                        part={k:records[k] for k in feature_codes if k in records}
                        if part: dump(STAGING/'summary'/year/group/'towns'/f'{county_code}.json', {'year':int(year),'group':group,'countyCode':county_code,'records':part})
                    continue
                dump(path, {'year':int(year),'group':group,'level':level,'records':records})
        for (sale_year,town_code), sales in by_town_year.items():
            if sale_year != year: continue
            ordered=sorted(sales,key=lambda x:(x['tradeDate'],x['id']),reverse=True)
            directory=STAGING/'transactions'/year/town_code
            index={'year':int(year),'townCode':town_code,'count':len(ordered),'pageSize':PAGE_SIZE,'pages':[]}
            for i in range(0,len(ordered),PAGE_SIZE):
                # Keep the compressed bytes under a neutral extension. Static
                # servers often auto-set Content-Encoding for .gz files, which
                # makes Fetch decompress them before the client stream does.
                part=ordered[i:i+PAGE_SIZE]; filename=f'part-{i//PAGE_SIZE:04d}.json.bin'
                dump_gzip(directory/filename,{'year':int(year),'townCode':town_code,'page':i//PAGE_SIZE,'records':part})
                index['pages'].append({'file':filename,'count':len(part)})
            dump(directory/'index.json',index)
    sources_index=json.loads((ROOT/'data/housing/sources.json').read_text())
    coverage_by_year=Counter(x['tradeDate'][:4] for x in normalized)
    trade_dates=sorted(x['tradeDate'] for x in normalized)
    manifest={'schemaVersion':1,'datasetVersion':'moi-sales-2024-2025-v1',
        'builtAt':datetime.now(timezone.utc).isoformat(),'provider':'內政部地政司','catalogUrl':source['catalogUrl'],
        'license':'政府資料開放授權條款第1版','licenseUrl':'https://data.gov.tw/license',
        'retrievedAt':sources_index['retrievedAt'],'batches':sources_index['batches'],
        'periods':['2024','2025'],'groups':list(GROUPS),'pageSize':PAGE_SIZE,
        'transactionCoverage':{'recordsByYear':dict(coverage_by_year),'earliestTradeDate':trade_dates[0] if trade_dates else None,'latestTradeDate':trade_dates[-1] if trade_dates else None,
                               'publicationBatches':list(sources_index['batches'])},
        'boundaryVersion':{'counties':'1140318'},
        'limitations':['本成果依官方批次檔，不保證完整涵蓋延遲申報或後續更正撤銷。',
          '免費主檔不含坐標；無法定位或對照村里，MVP 只顯示至已對照行政區。',
          '2024/2025依各批次可取得的交易年月日篩選；不同交易類別未納入。'],
        'counts':{'deduplicatedSaleRows':len(normalized),'outcomes':dict(outcomes),'reasons':dict(reasons),
                  'conflictingSerials':len(conflicts),'inputRowsByBatch':dict(input_counts)}}
    outcomes['publicTransactionRows'] = sum(len(rows) for rows in by_town_year.values())
    manifest['counts']['outcomes']['publicTransactionRows'] = outcomes['publicTransactionRows']
    dump(STAGING/'manifest.json',manifest)
    dump(STAGING/'reports/serial-conflicts.json',conflicts)
    dump(STAGING/'reports/unresolved.json',{'townUnresolved':outcomes['town_unresolved'],'countyUnresolved':outcomes['county_unresolved'],
        'unmatchedCountyNames':[{'name':name,'count':count} for name,count in county_misses.most_common()],
        'unmatchedTownNames':[{'county':county,'town':town,'count':count} for (county,town),count in town_misses.most_common()]})
    old = ROOT/'public/.housing-previous'
    if old.exists(): shutil.rmtree(old)
    if PUBLIC.exists(): PUBLIC.rename(old)
    STAGING.rename(PUBLIC)
    if old.exists(): shutil.rmtree(old)
    print(json.dumps(manifest['counts'],ensure_ascii=False,indent=2))


if __name__=='__main__': main()
