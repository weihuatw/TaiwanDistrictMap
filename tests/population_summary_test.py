import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("population_build", Path(__file__).resolve().parents[1] / "scripts/population/build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class PopulationSummaryTests(unittest.TestCase):
    def test_age_boundaries_and_open_ended_bucket(self):
        male = [0] * 101
        female = [0] * 101
        for age in (0, 14, 15, 64, 65, 99, 100):
            male[age] = 1
            female[age] = 2
        summary = build.age_summary({"male": male, "female": female})
        self.assertEqual(summary, {"age0to14": 6, "age15to64": 6, "age65plus": 9})
        self.assertEqual(sum(summary.values()), sum(male) + sum(female))

    def test_aggregates_sum_counts_before_calculating_ratios(self):
        records = [dict(zip(build.METRICS, values)) for values in
                   ((1, 10, 4, 6, 2, 7, 1), (30, 90, 46, 44, 10, 40, 40))]
        total = build.sum_records(iter(records))
        self.assertEqual(total["population"], 100)
        self.assertEqual(total["age65plus"], 41)
        self.assertEqual(total["age65plus"] + total["age0to14"] + total["age15to64"], 100)
