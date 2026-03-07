import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://estate.kuras-plus.com',
  output: 'static',
  trailingSlash: 'never',
  integrations: [sitemap()],
});
