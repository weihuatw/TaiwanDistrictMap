import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'scripts/population/{filename}.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
build = module('annual_build', 'annual_build')
fetch = module('annual_fetch', 'annual_fetch')


class AnnualPopulationTests(unittest.TestCase):
    def test_full_year_counts_and_year_end_average(self):
        row = build.annual_record('TW', '全臺', [(10, 15)] * 12, 8000, 12000, 2)
        self.assertEqual((row['births'], row['deaths'], row['naturalIncrease'], row['meanPopulation']), (120, 180, -60, 10000))
        zero = build.annual_record('x', '零', [(0, 0)] * 12, 0, 0)
        self.assertEqual(zero['births'], 0)

    def test_partial_months_keep_observed_counts_but_do_not_claim_full_year(self):
        row = build.annual_record('x', '新里', [(10, 15)] * 11, None, 12000)
        self.assertEqual(row['observedBirths'], 110)
        for key in ('births', 'deaths', 'naturalIncrease', 'meanPopulation'):
            self.assertIsNone(row[key])

    def test_sex_totals_and_numeric_fields_must_reconcile(self):
        row = {'birth_total': '3', 'birth_total_m': '1', 'birth_total_f': '2', 'death_total': '4', 'death_m': '2', 'death_f': '2'}
        self.assertEqual(build.event_counts(row), (3, 4))
        with self.assertRaises(ValueError):
            build.event_counts({**row, 'birth_total': '4'})
        for value in ('…', '-1', '1.5', ''):
            with self.assertRaises(ValueError):
                build.integer(value)

    def test_pagination_fetches_all_pages_and_checks_uniqueness(self):
        def response(page, code):
            return json.dumps({'responseCode': 'ODRP060-S', 'totalDataSize': '2', 'totalPage': '2', 'page': str(page),
                               'pageDataSize': '1', 'responseData': [{'district_code': code, 'statistic_yyymm': '11401'}]}).encode()
        pages = [response(1, '63000010001'), response(2, '63000010002')]
        with tempfile.TemporaryDirectory() as directory, patch.object(fetch, 'download', side_effect=pages) as download:
            row = fetch.fetch_table('ODRP060', '11401', Path(directory))
            self.assertEqual(row['records'], 2)
            self.assertEqual(download.call_count, 2)
            self.assertTrue(row['pages'][1]['url'].endswith('PAGE=2'))
        with tempfile.TemporaryDirectory() as directory, patch.object(fetch, 'download', side_effect=[pages[0], response(2, '63000010001')]):
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                fetch.fetch_table('ODRP060', '11401', Path(directory))
