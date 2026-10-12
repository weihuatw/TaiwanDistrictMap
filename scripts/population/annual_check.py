#!/usr/bin/env python3
"""Validate published annual summaries without requiring ignored raw downloads."""
from collections import defaultdict
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/data'


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_record(code, record, level):
    require(record['code'] == code and isinstance(record['name'], str), f'Invalid annual identity: {code}')
    months = record['monthsCovered']
    require(type(months) is int and 0 <= months <= 12, f'Invalid month coverage: {code}')
    for key in ('observedBirths', 'observedDeaths'):
        require(type(record[key]) is int and record[key] >= 0, f'Invalid observed count: {code}')
    for key, observed in (('births', 'observedBirths'), ('deaths', 'observedDeaths')):
        require(record[key] == (record[observed] if months == 12 else None), f'Partial annual count presented as complete: {code}')
    require(record['naturalIncrease'] == (record['births'] - record['deaths'] if months == 12 else None), f'Natural increase mismatch: {code}')
    start, end = record['startPopulation'], record['endPopulation']
    for value in (start, end):
        require(value is None or type(value) is int and value >= 0, f'Invalid year-end population: {code}')
    require(record['meanPopulation'] == ((start + end) / 2 if start is not None and end is not None else None), f'Wrong rate denominator: {code}')
    area, density_population = record['areaKm2'], record['densityPopulation']
    if level == 'village':
        require(area is None and density_population is None, f'Village density must not be estimated: {code}')
    else:
        require(isinstance(area, (int, float)) and math.isfinite(area) and area > 0, f'Invalid official area: {code}')
        require(type(density_population) is int and density_population >= 0, f'Invalid official density population: {code}')
        require(months == 12 and start is not None and end is not None, f'Incomplete aggregate: {code}')
        require(density_population == end, f'Official density population differs from annual year-end population: {code}')


def main():
    index = load(PUBLIC / 'population/annual/manifest.json')
    years = index['years']
    require(index['schemaVersion'] == 1 and isinstance(years, list) and years and years == sorted(set(years), reverse=True)
            and all(type(year) is int and 2020 <= year <= 2025 for year in years), 'Invalid annual manifest')
    require(years[0] == 2025 and years[-1] == 2020, 'Annual selector is expected to cover 2020–2025')
    counties = {feature['properties']['code'] for feature in load(PUBLIC / 'counties.geojson')['features']}
    towns, current = set(), set()
    for code in counties:
        towns.update(feature['properties']['code'] for feature in load(PUBLIC / f'towns/{code}.geojson')['features'])
    for code in towns:
        current.update(feature['properties']['code'] for feature in load(PUBLIC / f'villages/{code}.geojson')['features'] if not feature['properties']['unassigned'])
    expected_root = ROOT / 'data/population/annual-expected-exceptions.json'
    expected_index = load(expected_root)
    expected_years = expected_index.get('years', {str(expected_index.get('year')): expected_index})
    require(set(expected_years) == {str(year) for year in years}, 'Annual exceptions require review for every published year')

    all_reports = {}
    for year in years:
        manifest = load(PUBLIC / f'population/annual/{year}/manifest.json')
        require(manifest['schemaVersion'] == 1 and manifest['year'] == year, f'Invalid annual metadata: {year}')
        require(manifest['populationType'] == 'registered' and manifest['eventBasis'] == 'registration'
                and manifest['rateDenominator'] == 'mean-of-year-end-populations'
                and manifest['densityLevels'] == ['county', 'town'], f'Annual definitions changed: {year}')
        expected_files = {'counties': f'{year}/counties.json', 'towns': f'{year}/towns/{{countyCode}}.json',
                          'villages': f'{year}/villages/{{townCode}}.json', 'national': f'{year}/national.json', 'report': f'{year}/join-report.json'}
        require(manifest['files'] == expected_files, f'Invalid annual file paths: {year}')
        version = PUBLIC / f'population/annual/{year}'

        def shard(path, level, parent=None):
            data = load(path)
            require(data['schemaVersion'] == 1 and data['year'] == year and data['level'] == level
                    and data.get('parentCode') == parent, f'Wrong annual shard metadata: {path}')
            records = data['records']
            for code, record in records.items():
                length = {'county': 5, 'town': 8, 'village': 11}[level]
                require(re.fullmatch(r'\d{' + str(length) + '}', code) and (not parent or code.startswith(parent)), f'Wrong parent/code: {code}')
                check_record(code, record, level)
            return records

        county_records = shard(version / 'counties.json', 'county')
        town_records, village_records = {}, {}
        for code in counties:
            town_records.update(shard(version / f'towns/{code}.json', 'town', code))
        for code in towns:
            village_records.update(shard(version / f'villages/{code}.json', 'village', code))
        require(set(county_records) == counties and set(town_records) == towns and current <= set(village_records), f'Annual boundary coverage mismatch: {year}')
        national_shard = load(version / 'national.json')
        require(national_shard['schemaVersion'] == 1 and national_shard['year'] == year, f'Wrong national year: {year}')
        national = national_shard['record']
        check_record('TW', national, 'national')
        keys = ('observedBirths', 'observedDeaths', 'startPopulation', 'endPopulation')
        for children, parents, prefix in ((village_records, town_records, 8), (town_records, county_records, 5)):
            totals = defaultdict(lambda: defaultdict(int))
            for code, record in children.items():
                for key in keys:
                    totals[code[:prefix]][key] += record[key] or 0
            for code, record in parents.items():
                require(all(totals[code][key] == record[key] for key in keys), f'Annual aggregate mismatch: {year}/{code}')
        require(all(sum(record[key] for record in county_records.values()) == national[key] for key in (*keys, 'densityPopulation')),
                f'National annual sum mismatch: {year}')
        require(all(sum(record['densityPopulation'] for child, record in town_records.items() if child.startswith(code))
                    == county_records[code]['densityPopulation'] for code in counties), f'County density population mismatch: {year}')
        for code, record in county_records.items():
            require(abs(sum(row['areaKm2'] for child, row in town_records.items() if child.startswith(code)) - record['areaKm2']) < .0001,
                    f'County area mismatch: {year}/{code}')
        require(abs(sum(row['areaKm2'] for row in county_records.values()) - national['areaKm2']) < .0001, f'National area mismatch: {year}')
        months = manifest['monthlyTotals']
        require([row['period'] for row in months] == [f'{year - 1911}{month:02d}' for month in range(1, 13)], f'Missing event month: {year}')
        require(sum(row['births'] for row in months) == national['births'] and sum(row['deaths'] for row in months) == national['deaths'],
                f'Monthly/annual reconciliation failed: {year}')
        report = load(version / 'join-report.json')
        incomplete = sorted(code for code in current if village_records[code]['monthsCovered'] != 12)
        missing = sorted(code for code in current if village_records[code]['meanPopulation'] is None)
        historical = sorted(set(village_records) - current)
        require(sorted(report['incompleteEvents']) == incomplete and sorted(report['missingRateDenominator']) == missing
                and report['historicalWithoutCurrentBoundary'] == historical and report['currentNamedVillages'] == len(current),
                f'Annual join report mismatch: {year}')
        expected = expected_years[str(year)]
        for key in ('incompleteEvents', 'missingRateDenominator', 'historicalWithoutCurrentBoundary', 'excludedDensityRows'):
            require(sorted(report[key]) == sorted(expected[key]), f'Annual exception list changed for {year}: {key}')
        require(report.get('historicalTownCodeAliases', []) == expected.get('historicalTownCodeAliases', []),
                f'Historical township code mapping requires review: {year}')
        require(sorted(row['code'] for row in report['nameDifferences']) == sorted(expected['nameDifferenceCodes']),
                f'Annual name differences require review: {year}')
        coverage = manifest['coverage']
        require(coverage == {'towns': len(towns), 'counties': len(counties), 'currentNamedVillages': len(current),
                             'completeVillageEvents': len(current) - len(incomplete),
                             'completeVillageRates': sum(village_records[code]['monthsCovered'] == 12 and village_records[code]['meanPopulation'] is not None for code in current)},
                f'Annual coverage mismatch: {year}')
        all_reports[year] = national
    for year in years:
        print(f'Verified annual {year}: {all_reports[year]["births"]:,} births, {all_reports[year]["deaths"]:,} deaths.')
    print(f'Annual data verified: {years[-1]}–{years[0]}; {len(counties)} counties / {len(towns)} townships.')


if __name__ == '__main__':
    main()
