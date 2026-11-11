"""Regression checks for the official WebForms sanctions parser."""
import importlib.util
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts/child-safety"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("child_sanctions", SCRIPTS / "sanctions.py")
sanctions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sanctions)

class SanctionsParserTests(unittest.TestCase):
    def test_official_nested_text_and_encoded_detail_link(self):
        document = sanctions.Document("""
            <form><input type="hidden" name="__VIEWSTATE" value="snapshot&amp;state">
            <span id="GridView1_lblPContent_0">罰鍰：50,000&nbsp;元<br>限期改善</span>
            <a id="detail" onclick="window.open(&#39;./dtl/punish_view.aspx?sch=abc%2Bdef&#39;);return false;">檢視</a>
            </form>""")
        self.assertEqual(document.fields["__VIEWSTATE"], "snapshot&state")
        self.assertEqual(sanctions.text(document, "GridView1_lblPContent_0"), "罰鍰：50,000 元\n限期改善")
        self.assertEqual(sanctions.popup(document.elements["detail"]),
                         "https://ap.ece.moe.edu.tw/webecems/dtl/punish_view.aspx?sch=abc%2Bdef")

    def test_county_values_are_read_from_the_current_official_form(self):
        document = sanctions.Document("""
            <select name="ddlCityS"><option value="">全國</option>
              <option value="03">新北市</option><option value="25">連江縣</option>
            </select><select name="ddlAreaS"><option value="">全部鄉鎮</option></select>""")
        self.assertEqual([(code, name) for (field, code), name in document.options.items()
                          if field == "ddlCityS" and code], [("03", "新北市"), ("25", "連江縣")])

if __name__ == "__main__":
    unittest.main()
