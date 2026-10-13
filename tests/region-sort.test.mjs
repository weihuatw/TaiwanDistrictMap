import test from 'node:test';
import assert from 'node:assert/strict';
import { sortByName, sortRegionsByValue } from '../src/map-core/region-sort.ts';

const region = (code, name, value) => ({ properties: { code, name }, value });
const code = items => items.map(item => item.properties.code);

test('metric sorting supports both directions, keeps missing values last, and uses a stable code tie-break', () => {
  const rows = [region('03', '丙', 2), region('02', '乙', 2), region('01', '甲', 8), region('04', '丁', null)];
  const value = item => item.value;
  assert.deepEqual(code(sortRegionsByValue(rows, value, 'desc')), ['01', '02', '03', '04']);
  assert.deepEqual(code(sortRegionsByValue(rows, value, 'asc')), ['02', '03', '01', '04']);
});

test('name sorting supports both directions and keeps the supplied tie-break order', () => {
  const rows = [
    { name: 'Banana', code: '02' },
    { name: 'Apple', code: '03' },
    { name: 'Apple', code: '01' },
  ];
  const tieByCode = (a, b) => a.code.localeCompare(b.code);
  assert.deepEqual(sortByName(rows, row => row.name, 'desc', tieByCode).map(row => row.code), ['02', '01', '03']);
  assert.deepEqual(sortByName(rows, row => row.name, 'asc', tieByCode).map(row => row.code), ['01', '03', '02']);
});
