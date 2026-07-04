import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // No data: URLs — keeps CSP strict (font-src 'self') and assets cacheable
    assetsInlineLimit: 0,
  },
});
