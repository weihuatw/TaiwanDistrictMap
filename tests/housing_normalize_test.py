import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/housing'))
from normalize import classify, deduplicate_address_prefix, number, percentile, roc_date, normalize_address, summary


def row(**overrides):
    result = {'交易標的':'房地(土地+建物)', '建物型態':'住宅大樓(11層含以上有電梯)',
        '主要用途':'住家用', '總價元':'20000000', '建物移轉總面積平方公尺':'100',
        '車位移轉總面積平方公尺':'0', '車位總價元':'0', '交易筆棟數':'土地1建物1車位0', '備註':''}
    result.update(overrides)
    return result


class HousingNormalizeTest(unittest.TestCase):
    def test_roc_dates_and_blank(self):
        self.assertEqual(roc_date('1150902'),'2026-09-02')
        self.assertEqual(roc_date('0711130',True),'1982-11-01')
        self.assertIsNone(roc_date('0000000'))
        self.assertIsNone(roc_date('1150230'))

    def test_number_and_address_normalization(self):
        self.assertEqual(number('２０，０００'),20000)
        self.assertIsNone(number('Infinity'))
        self.assertEqual(normalize_address('台北市  仁愛路 １２之３號'),'臺北市仁愛路12之3號')
        self.assertEqual(deduplicate_address_prefix('連江縣南竿鄉連江縣南竿鄉仁愛村４－１號２樓','連江縣','南竿鄉'),'連江縣南竿鄉仁愛村４－１號２樓')

    def test_no_parking(self):
        result=classify(row())
        self.assertTrue(result['eligible'])
        self.assertEqual(result['priceBasis'],'no_parking')
        self.assertEqual(result['unitPriceTwdM2'],200000)

    def test_parking_is_deducted_only_when_both_values_are_present(self):
        result=classify(row(**{'交易標的':'房地(土地+建物)+車位','交易筆棟數':'土地1建物1車位1','建物移轉總面積平方公尺':'100','車位移轉總面積平方公尺':'20','車位總價元':'2000000'}))
        self.assertEqual(result['priceBasis'],'parking_deducted')
        self.assertEqual(result['unitPriceTwdM2'],225000)
        unknown=classify(row(**{'交易標的':'房地(土地+建物)+車位','交易筆棟數':'土地1建物1車位1','車位移轉總面積平方公尺':'0','車位總價元':'0'}))
        self.assertEqual(unknown['priceBasis'],'parking_included_unknown')
        self.assertFalse(unknown['eligible'])

    def test_main_use_type_and_notes_control_default_sample(self):
        self.assertNotIn('main_use_not_residential',classify(row())['reasons'])
        self.assertIn('main_use_not_residential',classify(row(**{'主要用途':'住商用'}))['reasons'])
        self.assertIn('special_transaction',classify(row(**{'備註':'親友交易'}))['reasons'])
        self.assertEqual(classify(row(**{'建物型態':'透天厝'}))['buildingTypeGroup'],'house')
        self.assertIsNone(classify(row(**{'建物型態':'未知型態'}))['buildingTypeGroup'])

    def test_type_seven_percentiles_and_small_sample_status(self):
        self.assertEqual(percentile([10,20,100],.5),20)
        self.assertEqual(percentile([10,20,100],.25),15)
        self.assertEqual(summary([])['status'],'no_samples')
        self.assertEqual(summary([{'eligible':True,'unitPriceTwdM2':10}])['status'],'insufficient')


if __name__ == '__main__': unittest.main()
