// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

// In Cloudflare Workers with nodejs_compat, process has [object process]
// toString tag, making Astro's isNode check return true. This causes
// renderToAsyncIterable to be used instead of renderToReadableStream.
// Async iterables are not valid Response body types in workerd, producing
// "[object Object]" responses. This plugin forces isNode = false so the
// ReadableStream path is always used in Workers.
const fixIsNodePlugin = {
  name: 'fix-astro-is-node-workers',
  transform(/** @type {string} */ code, /** @type {string} */ id) {
    if (id.includes('node_modules') && id.endsWith('.js') && code.includes('Object.prototype.toString.call(process)')) {
      return code.replace(
        /const isNode\s*=\s*typeof process[^;]+;/,
        'const isNode = false;',
      );
    }
  },
};

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [tailwind({ applyBaseStyles: false })],
  vite: {
    plugins: [fixIsNodePlugin],
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:8787',
      },
    },
  },
});
