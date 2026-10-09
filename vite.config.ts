import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { initialPreloadPlugin } from './scripts/vite/initial-preload.mjs';

export default defineConfig({
  base: './',
  plugins: [initialPreloadPlugin()],
  build: { target: 'es2022', rolldownOptions: { input: {
    admin: resolve(import.meta.dirname, 'index.html'),
    income: resolve(import.meta.dirname, 'income.html'),
    school: resolve(import.meta.dirname, 'school.html'),
    housing: resolve(import.meta.dirname, 'housing.html'),
    politics: resolve(import.meta.dirname, 'politics.html'),
  } } },
});
