import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const SITE = 'https://estate.kuras-plus.com';

export default defineConfig({
  site: SITE,
  output: 'static',
  trailingSlash: 'never',
  integrations: [
    sitemap({
      serialize(item) {
        const url = item.url;

        // トップページ
        if (url === SITE || url === SITE + '/') {
          return { ...item, changefreq: 'weekly', priority: 1.0, lastmod: new Date() };
        }

        // 計算ツールページ
        if (url.includes('/calculators/')) {
          return { ...item, changefreq: 'monthly', priority: 0.8, lastmod: new Date() };
        }

        // 記事一覧
        if (url === SITE + '/articles') {
          return { ...item, changefreq: 'weekly', priority: 0.8, lastmod: new Date() };
        }

        // 各記事ページ
        if (url.includes('/articles/')) {
          return { ...item, changefreq: 'monthly', priority: 0.7, lastmod: new Date() };
        }

        // エリア一覧
        if (url === SITE + '/city') {
          return { ...item, changefreq: 'monthly', priority: 0.7, lastmod: new Date() };
        }

        // 各エリアページ
        if (url.includes('/city/')) {
          return { ...item, changefreq: 'monthly', priority: 0.6, lastmod: new Date() };
        }

        return { ...item, changefreq: 'monthly', priority: 0.5, lastmod: new Date() };
      },
    }),
  ],
});
