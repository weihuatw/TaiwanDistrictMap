import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundaryRepository } from '../src/map-core/boundaries.ts';

const collection = { type: 'FeatureCollection', features: [] };

test('Boundary data uses the configured root and caches each successful file independently', async () => {
  const requests = [];
  const repository = new BoundaryRepository('/TaiwanDistrictMap/data', async (url, options) => {
    requests.push(url); assert.ok(options.signal instanceof AbortSignal);
    return Response.json(collection);
  });
  const first = await repository.load('counties.geojson');
  assert.equal(await repository.load('counties.geojson'), first);
  await repository.load('towns/09007.geojson');
  assert.deepEqual(requests, ['/TaiwanDistrictMap/data/counties.geojson', '/TaiwanDistrictMap/data/towns/09007.geojson']);
});

test('A failed HTTP response is not cached and can be retried', async () => {
  let requests = 0;
  const repository = new BoundaryRepository('/data/', async () => ++requests === 1 ? new Response(null, { status: 503 }) : Response.json(collection));
  await assert.rejects(repository.load('counties.geojson'), /request failed/);
  assert.deepEqual(await repository.load('counties.geojson'), collection);
  assert.equal(requests, 2);
});

test('Invalid boundary JSON is rejected instead of entering the cache', async () => {
  let requests = 0;
  const repository = new BoundaryRepository('/data/', async () => Response.json(++requests === 1 ? { type: 'Feature', features: [] } : collection));
  await assert.rejects(repository.load('counties.geojson'), /Invalid administrative data/);
  await repository.load('counties.geojson'); assert.equal(requests, 2);
});

test('Manifest loading uses the same configurable data root and reports HTTP failure', async () => {
  const urls = [];
  const manifest = { counts: { county: 22, town: 368, village: 7986 }, unassignedCount: 206, sources: [], notes: [] };
  const repository = new BoundaryRepository('/versioned-boundaries/2026/', async (url) => {
    urls.push(url); return urls.length === 1 ? new Response(null, { status: 404 }) : Response.json(manifest);
  });
  await assert.rejects(repository.manifest(), /Manifest unavailable/);
  assert.deepEqual(await repository.manifest(), manifest);
  assert.deepEqual(urls, ['/versioned-boundaries/2026/manifest.json', '/versioned-boundaries/2026/manifest.json']);
});
