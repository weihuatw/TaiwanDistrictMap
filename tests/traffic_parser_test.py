import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('traffic_parser',Path(__file__).resolve().parents[1]/'scripts/traffic/parse.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TrafficParserTest(unittest.TestCase):
    def row(self,**extra):
        r={'當事者順位':'1','死亡受傷人數':'死亡2;受傷3','發生年度':'2024','發生日期':'20240101','發生時間':'93000','事故類別名稱':'A1','發生地點':'臺北市','經度':'121.5','緯度':'25'}
        r.update(extra)
        return r
    def test_one_event_per_first_party(self):
        self.assertIsNone(module.event(self.row(當事者順位='2')))
        event=module.event(self.row())
        self.assertEqual((event['deaths'],event['injuries']),(2,3))
        self.assertEqual(event['time'],'093000')
        self.assertNotIn('當事者順位',event)
    def test_invalid_coordinates_do_not_drop_event_or_casualties(self):
        self.assertIsNone(module.event(self.row(經度='0',緯度='0'))['coordinates'])
        self.assertEqual(module.event(self.row(經度=''))['deaths'],2)
    def test_unknown_casualty_format_is_not_zero(self):
        with self.assertRaises(ValueError):
            module.event(self.row(死亡受傷人數='不明'))
