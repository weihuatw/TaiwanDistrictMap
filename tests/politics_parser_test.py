import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('politics_build', Path(__file__).parents[1] / 'scripts/politics/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class PoliticalParserTest(unittest.TestCase):
    def row(self, vice=' ', votes=10):
        return {'prv_code':'09','city_code':'007','area_code':'00','dept_code':'010','li_code':'0001','tbox_no':'0000','cand_no':1,'cand_id':1 if vice!='Y' else 2,'cand_name':'甲' if vice!='Y' else '乙','is_vice':vice,'party_name':'A','ticket_num':votes}
    def test_presidential_ballot_pair_is_counted_once(self):
        records = build.candidate_rows([self.row('Y'),self.row()])
        self.assertEqual(records['09_007_00_010_0001'][0]['votes'],10)
        self.assertEqual(records['09_007_00_010_0001'][0]['name'],'甲／乙')
    def test_duplicate_and_precinct_records_fail(self):
        with self.assertRaises(AssertionError):build.candidate_rows([self.row(),self.row()])
        row = self.row();row['tbox_no']='0001'
        with self.assertRaises(AssertionError):build.candidate_rows([row])
    def test_presidential_partner_votes_must_agree(self):
        with self.assertRaises(AssertionError):build.candidate_rows([self.row(),self.row('Y',11)])
    def test_person_names_preserve_official_tai_character(self):
        self.assertEqual(build.person_name(' 李 台華 '), '李台華')
        self.assertEqual(build.person_name('舒贑臺'), '舒贑臺')
        self.assertEqual(build.normal('台北市'), '臺北市')
        self.assertEqual(build.cec_name('江@2F97F@淵'), '江聰淵')
        row = self.row();row['cand_name'] = '江@2F97F@淵'
        candidate = build.candidate_rows([row])['09_007_00_010_0001'][0]
        self.assertEqual(candidate['name'], '江聰淵')
        self.assertEqual(candidate['sourceName'], row['cand_name'])
