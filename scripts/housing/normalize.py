"""Shared normalization and statistic functions for the offline housing pipeline."""
from datetime import date
import math
import re
import unicodedata

PING_M2 = 400 / 121
SPECIAL = ('親友', '關係人', '共有人', '急買急賣', '附條件買賣', '瑕疵物件', '持分交易', '特殊交易')
TYPE_GROUP = {
    '公寓(5樓含以下無電梯)': 'apartment', '公寓(無電梯)': 'apartment',
    '華廈(10層含以下有電梯)': 'elevator_low', '華廈': 'elevator_low',
    '住宅大樓(11層含以上有電梯)': 'elevator_high', '住宅大樓': 'elevator_high',
    '透天厝': 'house',
}


def number(value):
    if value is None: return None
    value = unicodedata.normalize('NFKC', str(value)).strip().replace(',', '')
    if value in ('', '-', '--', '無'): return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except ValueError: return None


def roc_date(value, month_only=False):
    value = unicodedata.normalize('NFKC', str(value or '')).strip()
    digits = re.sub(r'\D', '', value)
    if not digits or set(digits) == {'0'}: return None
    if len(digits) < (5 if month_only else 7): return None
    year = int(digits[:-4]); year += 1911 if year < 1911 else 0
    month = int(digits[-4:-2]); day = 1 if month_only else int(digits[-2:])
    try: return date(year, month, day).isoformat()
    except ValueError: return None


def normalize_address(value):
    s = unicodedata.normalize('NFKC', str(value or '')).strip()
    s = re.sub(r'\s+', '', s).replace('台', '臺')
    return s


def classify(row):
    target = row.get('交易標的', '')
    building_type = row.get('建物型態', '')
    use = row.get('主要用途', '')
    group = TYPE_GROUP.get(building_type)
    reasons = []
    flags = [term for term in SPECIAL if term in (row.get('備註') or '')]
    if target not in ('房地(土地+建物)', '房地(土地+建物)+車位'):
        reasons.append('not_building_sale')
    if use != '住家用': reasons.append('main_use_not_residential')
    if group is None: reasons.append('building_type_unmapped')
    if flags: reasons.append('special_transaction')
    total = number(row.get('總價元'))
    area = number(row.get('建物移轉總面積平方公尺'))
    park_count_match = re.search(r'車位\s*(\d+)', row.get('交易筆棟數') or '')
    park_count = int(park_count_match.group(1)) if park_count_match else None
    park_area = number(row.get('車位移轉總面積平方公尺'))
    park_price = number(row.get('車位總價元'))
    has_park = target.endswith('+車位') or bool(park_count)
    basis, unit = 'invalid', None
    if total is not None and area is not None and total > 0 and area >= 1:
        if not has_park:
            basis, unit = 'no_parking', total / area
        elif park_price is not None and park_area is not None and park_price > 0 and park_area > 0 and total > park_price and area > park_area:
            basis, unit = 'parking_deducted', (total - park_price) / (area - park_area)
        elif not park_price and not park_area and park_count == 0:
            basis, unit = 'no_parking', total / area
        else:
            basis = 'parking_included_unknown'
    if basis == 'invalid': reasons.append('invalid_area_or_price')
    return {'buildingTypeGroup': group, 'priceBasis': basis, 'unitPriceTwdM2': unit,
            'parkingCount': park_count, 'flags': flags, 'eligible': not reasons and unit is not None,
            'reasons': reasons}


def percentile(values, p):
    """R type 7 linear interpolation, matching h=(n-1)p."""
    xs = sorted(values)
    if not xs: return None
    h = (len(xs) - 1) * p; lo = math.floor(h); hi = math.ceil(h)
    return xs[lo] + (xs[hi] - xs[lo]) * (h - lo)


def summary(records):
    prices = [r['unitPriceTwdM2'] for r in records if r['eligible']]
    n = len(prices)
    median = percentile(prices, .5)
    return {'transactionCount': len(records), 'eligibleCount': n,
            'medianTwdM2': median, 'p25TwdM2': percentile(prices, .25),
            'p75TwdM2': percentile(prices, .75),
            'medianWanPing': median * PING_M2 / 10000 if median is not None else None,
            'status': 'no_samples' if n == 0 else 'insufficient' if n < 10 else 'low_sample' if n < 30 else 'ok'}
