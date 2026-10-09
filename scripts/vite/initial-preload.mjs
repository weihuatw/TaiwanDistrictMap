import { normalizePath } from 'vite';
import { themes } from '../../src/routing/hash-router.ts';

/** Resolve only static dependencies of each theme; dynamic imports stay lazy. */
export function collectInitialAssets(bundle, root) {
  const index = {};
  for (const theme of themes) {
    const entry = Object.values(bundle).find(chunk => chunk.type === 'chunk'
      && chunk.facadeModuleId === `${normalizePath(root)}/src/apps/${theme}/main.ts`);
    if (!entry) throw new Error(`Missing initial map chunk: ${theme}`);
    const scripts = new Map(), styles = new Set();
    const visit = file => {
      const chunk = bundle[file];
      if (chunk?.type !== 'chunk' || scripts.has(file)) return;
      scripts.set(file, chunk.code.length);
      for (const style of chunk.viteMetadata?.importedCss ?? []) styles.add(style);
      for (const dependency of chunk.imports) visit(dependency);
    };
    visit(entry.fileName);
    // Discover the large map core before smaller modules compete for bandwidth.
    index[theme] = {
      scripts: [...scripts].sort((a, b) => b[1] - a[1]).map(([file]) => file),
      styles: [...styles],
    };
  }
  return index;
}

// Self-contained: serialized into HTML so discovery does not wait for entry JS.
function preloadInitialMap(index, base) {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [requested = 'admin', ...ids] = path.split('/').filter(Boolean);
  const valid = Object.hasOwn(index, requested)
    && ids.length <= (requested === 'housing' ? 2 : 3)
    && ids.every(id => /^[A-Za-z0-9_-]+$/.test(id));
  const selected = index[valid ? requested : 'admin'];
  const hint = (file, rel, as) => {
    const link = document.createElement('link');
    link.rel = rel;
    if (as) link.as = as;
    link.crossOrigin = 'anonymous';
    link.href = new URL(base + file, document.baseURI).href;
    document.head.appendChild(link);
  };
  for (const file of selected.scripts) hint(file, 'modulepreload');
  // A preload does not pretend the stylesheet is applied. Vite still attaches
  // it and waits for its load event before starting the selected application.
  for (const file of selected.styles) hint(file, 'preload', 'style');
  hint('data/counties.geojson', 'preload', 'fetch');
}

export function initialPreloadScript(index, base) {
  const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  return `(${preloadInitialMap.toString()})(${json(index)},${json(base)});`;
}

export function initialPreloadPlugin() {
  let root, base;
  return {
    name: 'initial-map-preload',
    apply: 'build',
    configResolved(config) { root = config.root; base = config.base; },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle || normalizePath(context.filename) !== `${normalizePath(root)}/index.html`) return;
        const marker = '<!-- initial-map-preload -->';
        if (!html.includes(marker)) throw new Error('Missing initial map preload position');
        const script = initialPreloadScript(collectInitialAssets(context.bundle, root), base);
        // Keep charset first, and run before any blocking stylesheet in the head.
        return html.replace(marker, `<script id="initial-map-preload">${script}</script>`);
      },
    },
  };
}
