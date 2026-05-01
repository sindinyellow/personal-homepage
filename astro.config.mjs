import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://scintillating-malasada-cb96d8.netlify.app',
  integrations: [sitemap()],
  experimental: {
    clientPrerender: true,
  },
});
