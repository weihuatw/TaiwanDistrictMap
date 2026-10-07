from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'scripts/income/build.py'
spec = spec_from_file_location('income_build', source)
module = module_from_spec(spec)
spec.loader.exec_module(module)


class ParserTests(unittest.TestCase):
    def test_nested_town_cell_retains_the_first_village_record(self):
        html = '<table><tr><td></td><td><table><tr><td>松山區</td></tr></table></td><td>中崙里</td><td>1464</td><td>2745453</td></tr></table>'
        result = module.rows(html)
        self.assertIn(['', '松山區', '中崙里', '1464', '2745453'], result)

    def test_spelling_normalization_does_not_allocate_renamed_villages(self):
        self.assertEqual(module.name_key('瓦磘里'), module.name_key('瓦[磘]里'))
        self.assertEqual(module.name_key('石𥕢里'), module.name_key('石[曹]里'))
        self.assertNotEqual(module.name_key('龍水里'), module.name_key('南美術館里'))


if __name__ == '__main__':
    unittest.main()
