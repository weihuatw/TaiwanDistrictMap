import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { collectInitialAssets, initialPreloadScript, initialPreloadPlugin } from '../scripts/vite/initial-preload.mjs';
import { parseRoute, themes } from '../src/routing/hash-router.ts';

const index = Object.fromEntries(themes.map(theme => [theme, {
  scripts: ['assets/core.js', `assets/${theme}.js`], styles: [`assets/${theme}.css`],
}]));
function execute(hash, base = '/TaiwanDistrictMap/', assets = index) {
  const links = [];
  runInNewContext(initialPreloadScript(assets, base), {
    location: { hash }, URL,
    document: { baseURI: 'https://example.com/TaiwanDistrictMap/index.html',
      createElement: () => ({}), head: { appendChild: link => links.push(link) } },
  });
  return links;
}

test('Initial hints follow the router for all themes, deep links and invalid hashes', () => {
  const hashes = ['', '#/', '#/admin/63000', '#/income/63000/63000020?x=1',
    '#school/63000/63000020/323604-elementary', '#/school/09007/09007010',
    '#/housing/63000/63000020?year=2024&type=apartment', '#/politics?mode=president',
    '#/unknown', '#/__proto__', '#/school/臺北市', '#/school/a/b/c/d', '#/housing/a/b/c'];
  for (const hash of hashes) {
    let theme; try { theme = parseRoute(hash).theme; } catch { theme = 'admin'; }
    const links = execute(hash);
    assert.deepEqual(links.filter(link => link.rel === 'modulepreload').map(link => new URL(link.href).pathname),
      ['/TaiwanDistrictMap/assets/core.js', `/TaiwanDistrictMap/assets/${theme}.js`], hash);
    assert.equal(links.filter(link => link.as === 'fetch').length, 1);
    assert.equal(links.at(-1).href, 'https://example.com/TaiwanDistrictMap/data/counties.geojson');
    assert.ok(links.every(link => link.crossOrigin === 'anonymous'));
    const style = links.find(link => link.as === 'style');
    assert.equal(style.rel, 'preload'); // Normal import must still apply/wait for CSS.
    assert.equal(style.href, `https://example.com/TaiwanDistrictMap/assets/${theme}.css`);
  }
});

test('Relative and CDN build bases resolve assets and geometry consistently', () => {
  for (const [base, expected] of [['./', 'https://example.com/TaiwanDistrictMap/'],
    ['https://cdn.example.com/maps/', 'https://cdn.example.com/maps/']]) {
    const links = execute('#/school', base);
    assert.equal(links[0].href, expected + 'assets/core.js');
    assert.equal(links.at(-1).href, expected + 'data/counties.geojson');
  }
});

test('Build hints traverse static dependencies, deduplicate CSS and exclude other dynamic themes and workers', () => {
  const chunk = (fileName, imports = [], css = [], size = 10) => ({ type: 'chunk', fileName, imports,
    code: 'x'.repeat(size), viteMetadata: { importedCss: new Set(css) } });
  const bundle = { 'core.js': chunk('core.js', ['shared.js'], ['common.css'], 1000),
    'shared.js': chunk('shared.js', ['core.js'], ['common.css']) };
  for (const theme of themes) bundle[`${theme}.js`] = {
    ...chunk(`${theme}.js`, ['core.js'], [`${theme}.css`]),
    facadeModuleId: `/project/src/apps/${theme}/main.ts`, dynamicImports: ['unused-theme.js', 'worker.js'],
  };
  const result = collectInitialAssets(bundle, '/project');
  assert.deepEqual(result.school.scripts, ['core.js', 'school.js', 'shared.js']);
  assert.deepEqual(result.school.styles, ['school.css', 'common.css']);
  delete bundle['housing.js'];
  assert.throws(() => collectInitialAssets(bundle, '/project'), /Missing initial map chunk: housing/);
});

test('Build hook inserts hints before stylesheets, keeps charset first, and leaves compatibility entries alone', () => {
  const plugin = initialPreloadPlugin(); plugin.configResolved({ root: '/project', base: './' });
  const bundle = Object.fromEntries(themes.map(theme => [`${theme}.js`, {
    type: 'chunk', fileName: `${theme}.js`, facadeModuleId: `/project/src/apps/${theme}/main.ts`, imports: [], code: '',
  }]));
  const html = '<head><meta charset="UTF-8"><!-- initial-map-preload --><link rel="stylesheet" href="base.css"></head>';
  const transformed = plugin.transformIndexHtml.handler(html, { filename: '/project/index.html', bundle });
  assert.ok(transformed.indexOf('charset') < transformed.indexOf('<script'));
  assert.ok(transformed.indexOf('<script') < transformed.indexOf('<link'));
  assert.equal(plugin.transformIndexHtml.handler(html, { filename: '/project/school.html', bundle }), undefined);
  assert.throws(() => plugin.transformIndexHtml.handler('<head></head>', { filename: '/project/index.html', bundle }), /Missing initial map preload position/);
  assert.ok(!initialPreloadScript(index, '</script>').includes('</script>'));
});
