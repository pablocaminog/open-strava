// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

// Cloudflare Pages adapter — server output for SSR routes (auth, API
// proxy). Static-only pages still emit as HTML.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: false })],
  vite: {
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:8787',
      },
    },
  },
});
